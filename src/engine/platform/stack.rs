/// The stack grows from `origin` down to `end`.
#[derive(Clone, Copy, Debug)]
pub struct StackBounds {
    pub origin: usize,
    pub end: usize,
}

impl StackBounds {
    /// Of the current thread.
    pub fn current() -> StackBounds {
        current()
    }

    /// From then on the stack of the current thread, whose bounds these are, can be touched in any order above
    /// `lowest`. Windows makes it grow only when the page is touched that follows the last.
    #[inline(never)]
    pub fn commit_down_to(&self, lowest: usize) {
        const SMALLEST_PAGE: usize = 4096;
        if cfg!(windows) {
            let here = 0u8;
            let (first, last) = ((&raw const here).addr(), lowest.max(self.end));
            for address in (last..first).rev().step_by(SMALLEST_PAGE).chain([last]) {
                // SAFETY: in the range that is reserved for the stack, above the pages that end it, and in order.
                unsafe { core::ptr::with_exposed_provenance::<u8>(address).read_volatile() };
            }
        }
    }

    pub fn contains(&self, address: usize) -> bool {
        self.end < address && address <= self.origin
    }
}

#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
fn from_thread_attributes() -> StackBounds {
    let mut attributes = core::mem::MaybeUninit::<libc::pthread_attr_t>::uninit();
    let (mut end, mut size) = (core::ptr::null_mut(), 0);
    // SAFETY: the attributes are initialized, read and destroyed in that order.
    unsafe {
        libc::pthread_attr_init(attributes.as_mut_ptr());
        #[cfg(target_os = "freebsd")]
        libc::pthread_attr_get_np(libc::pthread_self(), attributes.as_mut_ptr());
        #[cfg(not(target_os = "freebsd"))]
        libc::pthread_getattr_np(libc::pthread_self(), attributes.as_mut_ptr());
        libc::pthread_attr_getstack(attributes.as_ptr(), &raw mut end, &raw mut size);
        libc::pthread_attr_destroy(attributes.as_mut_ptr());
    }
    StackBounds {
        origin: end.addr() + size,
        end: end.addr(),
    }
}

/// How far the stack of the first thread may grow, if there is a limit.
#[cfg(unix)]
fn resource_limit() -> Option<usize> {
    let mut limit = libc::rlimit {
        rlim_cur: libc::RLIM_INFINITY,
        rlim_max: libc::RLIM_INFINITY,
    };
    // SAFETY: writes the struct.
    unsafe { libc::getrlimit(libc::RLIMIT_STACK, &raw mut limit) };
    (limit.rlim_cur != libc::RLIM_INFINITY).then_some(limit.rlim_cur as usize)
}

#[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
const SIZE_WITHOUT_LIMIT: usize = 8 << 20;

#[cfg(any(target_os = "linux", target_os = "android"))]
fn current() -> StackBounds {
    use core::sync::atomic::{AtomicUsize, Ordering};

    unsafe extern "C" {
        static environ: *const *const libc::c_char;
    }
    /// `setenv` moves the pointers to the heap.
    static FIRST_ENVIRONMENT: AtomicUsize = AtomicUsize::new(0);

    // SAFETY: neither has preconditions.
    if unsafe { i64::from(libc::getpid()) != libc::syscall(libc::SYS_gettid) } {
        return from_thread_attributes();
    }
    // SAFETY: the pointer is not followed.
    let environment = unsafe { (&raw const environ).read() }.addr();
    // musl reports only what the first thread has touched so far.
    let top = top_of_first_stack(environment).unwrap_or_else(|| from_thread_attributes().origin);
    let size = resource_limit().unwrap_or(SIZE_WITHOUT_LIMIT) - bun_alloc::page_size();
    let mut bounds = StackBounds {
        origin: top,
        end: top.saturating_sub(size),
    };
    if FIRST_ENVIRONMENT.load(Ordering::Relaxed) == 0 {
        FIRST_ENVIRONMENT.store(environment, Ordering::Relaxed);
    }
    // No frame is above them.
    let environment = FIRST_ENVIRONMENT.load(Ordering::Relaxed);
    if bounds.contains(environment) {
        bounds.origin = environment;
    }
    bounds
}

/// `execve` puts the path of the executable last. glibc would parse `/proc/self/maps` instead.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn top_of_first_stack(environment: usize) -> Option<usize> {
    const MORE_THAN_ALL_STRINGS: usize = 8 << 20;
    // SAFETY: no preconditions.
    let path = unsafe { libc::getauxval(libc::AT_EXECFN) } as usize;
    // Tracers and emulators put it elsewhere.
    let frame = (&raw const path).addr();
    if environment < frame || path < environment || path - environment > MORE_THAN_ALL_STRINGS {
        return None;
    }
    // SAFETY: a string that lasts as long as the process.
    let length = unsafe { libc::strlen(core::ptr::with_exposed_provenance(path)) };
    Some((path + length + 1).next_multiple_of(bun_alloc::page_size()))
}

#[cfg(target_os = "macos")]
fn current() -> StackBounds {
    // SAFETY: questions about the current thread.
    let (origin, size) = unsafe {
        let thread = libc::pthread_self();
        let size = if libc::pthread_main_np() != 0 {
            resource_limit().unwrap_or(SIZE_WITHOUT_LIMIT)
        } else {
            libc::pthread_get_stacksize_np(thread)
        };
        (libc::pthread_get_stackaddr_np(thread).addr(), size)
    };
    StackBounds {
        origin,
        end: origin - size,
    }
}

#[cfg(target_os = "freebsd")]
fn current() -> StackBounds {
    let mut bounds = from_thread_attributes();
    // SAFETY: no preconditions.
    if unsafe { libc::pthread_main_np() } == 1
        && let Some(size) = freebsd::usable_size_of_first_stack()
    {
        bounds.end = bounds.end.max(bounds.origin.saturating_sub(size));
    }
    bounds
}

/// The thread library reports the resource limit, but the kernel maps no more than the executable asks for.
#[cfg(target_os = "freebsd")]
mod freebsd {
    use core::ffi::{c_int, c_ulong, c_void};

    const AT_USRSTACKLIM: c_int = 36;
    const PT_GNU_STACK: u32 = 0x6474_e551;

    fn size_in_executable() -> usize {
        unsafe extern "C" fn read_first(
            object: *mut libc::dl_phdr_info,
            _: usize,
            size: *mut c_void,
        ) -> c_int {
            // SAFETY: the loader passes the headers of an object, and `size` is the number below.
            unsafe {
                let object = &*object;
                let headers =
                    core::slice::from_raw_parts(object.dlpi_phdr, object.dlpi_phnum.into());
                if let Some(header) = headers.iter().find(|it| it.p_type == PT_GNU_STACK) {
                    *size.cast::<usize>() = header.p_memsz as usize;
                }
            }
            1
        }
        let mut size = 0usize;
        // SAFETY: the callback does not outlive the call. The executable comes first.
        unsafe { libc::dl_iterate_phdr(Some(read_first), (&raw mut size).cast()) };
        size & !(bun_alloc::page_size() - 1)
    }

    fn limit_at_start() -> usize {
        let mut limit: c_ulong = 0;
        let size = size_of_val(&limit) as c_int;
        // SAFETY: writes no more than the size.
        unsafe { libc::elf_aux_info(AT_USRSTACKLIM, (&raw mut limit).cast(), size) };
        limit as usize
    }

    fn guard_size() -> usize {
        let mut status: c_int = 0;
        // SAFETY: the command writes an `int`.
        let is_known = unsafe {
            let (process, status) = (libc::getpid().into(), (&raw mut status).cast());
            libc::procctl(libc::P_PID, process, libc::PROC_STACKGAP_STATUS, status) == 0
        };
        if is_known && status & libc::PROC_STACKGAP_DISABLE != 0 {
            return 0;
        }
        let mut pages: c_int = 1;
        let _ = bun_sys::posix::sysctl_read(c"security.bsd.stack_guard_page", &mut pages);
        pages.max(0) as usize * bun_alloc::page_size()
    }

    pub(super) fn usable_size_of_first_stack() -> Option<usize> {
        let limit = super::resource_limit().unwrap_or(0);
        let sizes = [size_in_executable(), limit_at_start(), limit];
        let mapped = sizes.into_iter().filter(|&size| size != 0).min()?;
        mapped.checked_sub(guard_size()).filter(|&size| size != 0)
    }
}

#[cfg(windows)]
fn current() -> StackBounds {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        safe fn GetCurrentThreadStackLimits(low: &mut usize, high: &mut usize);
    }
    const GUARD_PAGES: usize = 4;
    let (mut low, mut high) = (0, 0);
    GetCurrentThreadStackLimits(&mut low, &mut high);
    StackBounds {
        origin: high,
        end: low + GUARD_PAGES * bun_alloc::page_size(),
    }
}

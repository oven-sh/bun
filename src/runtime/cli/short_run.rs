//! Settings of the allocators for `bun check`, `bun lint` and `bun fmt`, which start many threads and end soon.

use bun_alloc::mimalloc::{Option as Setting, mi_option_set};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// The executable allocates with mimalloc, but glibc allocates a few bytes for each new thread, and by default maps a
/// heap for the thread to take them from. The page faults of all threads wait for that.
pub(crate) fn share_heaps_of_libc() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    // SAFETY: it has no preconditions.
    unsafe {
        libc::mallopt(libc::M_ARENA_MAX, 4);
    }
}

static HAS_MEMORY_TO_SPARE: AtomicBool = AtomicBool::new(false);

/// Trades memory for time, until the process has a quarter of what the machine or the container has left.
pub(crate) fn spend_spare_memory() {
    let is_set = |name| bun_core::getenv_z(name).is_some();
    if cfg!(bun_asan)
        || is_set(bun_core::zstr!("MIMALLOC_PURGE_DELAY"))
        || is_set(bun_core::zstr!("MIMALLOC_PURGE_HOLES"))
        || is_set(bun_core::zstr!("MIMALLOC_ALLOW_THP"))
    {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("Bun Memory".into())
        .stack_size(256 << 10)
        .spawn(watch_memory);
}

fn watch_memory() {
    std::thread::sleep(Duration::from_millis(4));
    let spare = super::lint_js::memory_to_spare() / 2;
    let used = || bun_sys::self_process_memory_usage().unwrap_or(usize::MAX);
    if used() >= spare {
        return;
    }
    // Memory that is given back is faulted in again for the next file.
    mi_option_set(Setting::purge_delay, 10_000);
    mi_option_set(Setting::purge_holes, 0);
    HAS_MEMORY_TO_SPARE.store(true, Ordering::Relaxed);
    bun_sema::session::keep_free_memory_while(|| HAS_MEMORY_TO_SPARE.load(Ordering::Relaxed));

    let (mut huge_pages, mut pause) = (None, Duration::from_millis(4));
    loop {
        let used = used();
        if used >= spare {
            break;
        }
        if used >= HugePages::WORTH_IT_FROM && huge_pages.is_none() {
            huge_pages = Some(HugePages::begin(spare));
        }
        std::thread::sleep(pause);
        pause = (pause + pause / 8).min(Duration::from_millis(50));
    }
    drop(huge_pages);
    mi_option_set(Setting::purge_delay, 100);
    mi_option_set(Setting::purge_holes, 1);
    HAS_MEMORY_TO_SPARE.store(false, Ordering::Relaxed);
}

/// The start and the size of the mappings that get pages of 2 MB, until this is dropped. A large program misses the
/// TLB all the time: 59,000 files are checked in 82 % of the time with them.
#[derive(Default)]
struct HugePages(#[cfg(target_os = "linux")] Vec<(usize, usize)>);

impl HugePages {
    /// Partly filled pages add up to 30 MB for each thread, which a smaller process spends more time clearing than it
    /// gains.
    const WORTH_IT_FROM: usize = 192 << 20;

    #[cfg(not(target_os = "linux"))]
    fn begin(_spare: usize) -> HugePages {
        HugePages::default()
    }

    #[cfg(target_os = "linux")]
    fn begin(spare: usize) -> HugePages {
        use bun_alloc::mimalloc::{mi_arena_area, mi_free, mi_malloc, mi_reserve_os_memory_ex};
        let threads = usize::from(bun_core::get_thread_count());
        if spare < (threads * (128 << 20)).max(2 << 30) {
            return HugePages::default();
        }
        let block = mi_malloc(1);
        let mut mappings = Vec::from_iter(mapping_around(block.addr()));
        // SAFETY: it's from `mi_malloc`.
        unsafe { mi_free(block) };
        // mimalloc has decided not to ask for huge pages for the arenas that it reserves itself.
        let mut arena = core::ptr::null_mut();
        if is_address_space_free()
            && mi_reserve_os_memory_ex(spare.min(16 << 30), true, false, false, &mut arena) == 0
        {
            let mut size = 0;
            // SAFETY: the call before has set `arena`.
            let start = unsafe { mi_arena_area(arena, &mut size) };
            mappings.push((start.addr(), size));
        }
        let pages = HugePages(mappings);
        pages.advise(libc::MADV_HUGEPAGE);
        pages
    }

    #[cfg(target_os = "linux")]
    fn advise(&self, advice: core::ffi::c_int) {
        for &(start, size) in &self.0 {
            // SAFETY: neither advice changes what the memory holds, and the kernel checks the range.
            unsafe { libc::madvise(core::ptr::without_provenance_mut(start), size, advice) };
        }
    }
}

#[cfg(target_os = "linux")]
impl Drop for HugePages {
    fn drop(&mut self) {
        self.advise(libc::MADV_NOHUGEPAGE);
    }
}

#[cfg(target_os = "linux")]
fn mapping_around(address: usize) -> Option<(usize, usize)> {
    use bun_core::strings;
    let maps = bun_sys::File::read_from(bun_sys::Fd::cwd(), b"/proc/self/maps").ok()?;
    let hex = |text| usize::from_str_radix(core::str::from_utf8(text).ok()?, 16).ok();
    strings::split(&maps, b"\n").find_map(|line| {
        let (start, rest) = strings::split_once_char(line, b'-')?;
        let (start, end) = (hex(start)?, hex(strings::split_once_char(rest, b' ')?.0)?);
        (start..end)
            .contains(&address)
            .then(|| (start, end - start))
    })
}

/// True if a mapping that isn't used doesn't count towards any limit.
#[cfg(target_os = "linux")]
fn is_address_space_free() -> bool {
    use bun_sys::posix::{RlimitResource, getrlimit};
    let is_unlimited = |resource| getrlimit(resource).is_ok_and(|it| it.cur == libc::RLIM_INFINITY);
    is_unlimited(RlimitResource::AS)
        && is_unlimited(RlimitResource::DATA)
        && bun_sys::File::read_from(bun_sys::Fd::cwd(), b"/proc/sys/vm/overcommit_memory")
            .is_ok_and(|it| matches!(it.first(), Some(b'0' | b'1')))
}

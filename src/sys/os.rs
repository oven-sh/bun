//! `node:os` platform queries. Each C API that hands back a list it owns
//! (`getifaddrs(3)`, `host_processor_info`, `uv_cpu_info`,
//! `uv_interface_addresses`) gets an owning type that frees it on drop and
//! lends typed entries, so callers never see the raw pointers.

#[allow(unused_imports)]
use core::ffi::{c_char, c_int, c_uint};

use crate::net::Address;

// ──────────────────────────────────────────────────────────────────────────
// getifaddrs(3)
// ──────────────────────────────────────────────────────────────────────────

/// The interface list of one `getifaddrs(3)` call; `freeifaddrs` on drop.
#[cfg(unix)]
pub struct InterfaceAddresses {
    head: *mut libc::ifaddrs,
}

#[cfg(unix)]
impl InterfaceAddresses {
    /// `Err` is the `errno` `getifaddrs` failed with.
    pub fn get() -> Result<Self, c_int> {
        let mut head: *mut libc::ifaddrs = core::ptr::null_mut();
        // SAFETY: `head` is a stack out-param; on success it receives the list.
        if unsafe { libc::getifaddrs(&raw mut head) } != 0 {
            return Err(crate::posix::errno());
        }
        Ok(Self { head })
    }

    /// Every entry, in the order `getifaddrs` returned them.
    pub fn iter(&self) -> impl Iterator<Item = InterfaceAddress<'_>> + Clone {
        // SAFETY: `head` and each `ifa_next` are null or a node of this list,
        // all of which live until `self` is dropped.
        core::iter::successors(unsafe { self.head.as_ref() }, |ifa| unsafe {
            ifa.ifa_next.as_ref()
        })
        .map(InterfaceAddress)
    }
}

#[cfg(unix)]
impl Drop for InterfaceAddresses {
    fn drop(&mut self) {
        if !self.head.is_null() {
            // SAFETY: the list `getifaddrs` allocated, freed exactly once.
            unsafe { libc::freeifaddrs(self.head) }
        }
    }
}

/// One node of an [`InterfaceAddresses`] list.
#[cfg(unix)]
#[derive(Clone, Copy)]
pub struct InterfaceAddress<'a>(&'a libc::ifaddrs);

#[cfg(unix)]
impl<'a> InterfaceAddress<'a> {
    pub fn name(self) -> &'a [u8] {
        // SAFETY: getifaddrs(3) sets `ifa_name` to a NUL-terminated string owned by the list.
        unsafe { core::ffi::CStr::from_ptr(self.0.ifa_name) }.to_bytes()
    }

    /// `IFF_*` bits.
    pub fn flags(self) -> c_uint {
        self.0.ifa_flags
    }

    /// The address family of `ifa_addr`, if the entry has one.
    pub fn family(self) -> Option<c_int> {
        // SAFETY: a non-null `ifa_addr` points at a sockaddr owned by the list.
        unsafe { self.0.ifa_addr.as_ref() }.map(|sa| c_int::from(sa.sa_family))
    }

    pub fn address(self) -> Option<Address> {
        if self.0.ifa_addr.is_null() {
            return None;
        }
        // SAFETY: getifaddrs(3) — a non-null `ifa_addr` points into the list's
        // block at a sockaddr for the family it declares (libuv copies it the same way).
        Some(unsafe { Address::init_posix(self.0.ifa_addr) })
    }

    /// The netmask, read and tagged by the entry's *address* family, as libuv
    /// does: BSD kernels report masks whose own `sa_family` is `AF_UNSPEC`
    /// (and whose `sa_len` may be shorter than the full sockaddr, the missing
    /// tail meaning zero bits).
    pub fn netmask(self) -> Option<Address> {
        if self.0.ifa_netmask.is_null() {
            return None;
        }
        let family = self.family()?;
        let want = match family {
            libc::AF_INET6 => core::mem::size_of::<libc::sockaddr_in6>(),
            libc::AF_INET => core::mem::size_of::<libc::sockaddr_in>(),
            _ => core::mem::size_of::<libc::sockaddr>(),
        };
        // SAFETY: getifaddrs(3) stores each entry's netmask in the list's block
        // with room for a sockaddr of the entry's address family (libuv copies
        // `sizeof(sockaddr_in6)` from it for AF_INET6 entries); on the BSDs
        // `sa_len` says how much of it the kernel filled in.
        let mask = unsafe {
            let src = self.0.ifa_netmask;
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            let len = want.min(usize::from((*src).sa_len));
            #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
            let len = want;
            let mut any: libc::sockaddr_storage = core::mem::zeroed();
            core::ptr::copy_nonoverlapping(src.cast::<u8>(), (&raw mut any).cast::<u8>(), len);
            any.ss_family = family as _;
            Address { any }
        };
        Some(mask)
    }

    /// The hardware-address bytes of a link-layer (`AF_PACKET`) entry.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn link_layer_address(self) -> Option<&'a [u8]> {
        if self.family()? != libc::AF_PACKET {
            return None;
        }
        // SAFETY: an `AF_PACKET` `ifa_addr` is a `sockaddr_ll` owned by the list.
        let ll = unsafe { &*self.0.ifa_addr.cast::<libc::sockaddr_ll>() };
        Some(&ll.sll_addr[..])
    }

    /// The hardware-address bytes of a link-layer (`AF_LINK`) entry.
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub fn link_layer_address(self) -> Option<&'a [u8]> {
        if self.family()? != libc::AF_LINK {
            return None;
        }
        let dl = self.0.ifa_addr.cast::<libc::sockaddr_dl>();
        // SAFETY: an `AF_LINK` `ifa_addr` is a `sockaddr_dl` of `sdl_len`
        // bytes owned by the list; the address follows the name in `sdl_data`.
        unsafe {
            let total = usize::from((*dl).sdl_len);
            let start = (core::mem::offset_of!(libc::sockaddr_dl, sdl_data)
                + usize::from((*dl).sdl_nlen))
            .min(total);
            let len = usize::from((*dl).sdl_alen).min(total - start);
            Some(core::slice::from_raw_parts(dl.cast::<u8>().add(start), len))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// getpwuid_r(3), getloadavg(3)
// ──────────────────────────────────────────────────────────────────────────

/// The effective user's home directory from the passwd database
/// (`getpwuid_r(geteuid())`). `Ok(None)`: no entry for this uid; an entry
/// with no `pw_dir` yields an empty path. `Err` is the errno `getpwuid_r`
/// returned.
#[cfg(unix)]
pub fn passwd_home_dir() -> Result<Option<Vec<u8>>, c_int> {
    // From libuv:
    // > Calling sysconf(_SC_GETPW_R_SIZE_MAX) would get the suggested size, but it
    // > is frequently 1024 or 4096, so we can just use that directly. The pwent
    // > will not usually be large.
    let mut stack = [0u8; 4096];
    let mut heap: Vec<u8>;
    let mut buf: &mut [u8] = &mut stack;
    let mut pw: libc::passwd = bun_core::ffi::zeroed();
    let mut result: *mut libc::passwd = core::ptr::null_mut();
    loop {
        // SAFETY: `pw`/`result` are stack out-params; `buf` is writable for `buf.len()`.
        let rc = unsafe {
            libc::getpwuid_r(
                libc::geteuid(),
                &raw mut pw,
                buf.as_mut_ptr().cast::<c_char>(),
                buf.len(),
                &raw mut result,
            )
        };
        if rc == libc::EINTR {
            continue;
        }
        if rc == libc::ERANGE {
            let len = buf.len();
            heap = vec![0u8; len * 2];
            buf = &mut heap;
            continue;
        }
        if rc != 0 {
            return Err(rc);
        }
        break;
    }
    if result.is_null() {
        return Ok(None);
    }
    if pw.pw_dir.is_null() {
        return Ok(Some(Vec::new()));
    }
    // SAFETY: on success `pw_dir` is a NUL-terminated string inside `buf`.
    Ok(Some(
        unsafe { core::ffi::CStr::from_ptr(pw.pw_dir) }
            .to_bytes()
            .to_vec(),
    ))
}

/// `getloadavg(3)`; `None` unless all three samples were returned.
#[cfg(target_os = "freebsd")]
pub fn loadavg() -> Option<[f64; 3]> {
    let mut avg = [0.0f64; 3];
    // SAFETY: `avg` has room for the 3 samples requested.
    (unsafe { libc::getloadavg(avg.as_mut_ptr(), 3) } == 3).then_some(avg)
}

// ──────────────────────────────────────────────────────────────────────────
// host_processor_info (macOS)
// ──────────────────────────────────────────────────────────────────────────

/// Per-CPU tick counters from `host_processor_info(PROCESSOR_CPU_LOAD_INFO)`;
/// the Mach buffer is `vm_deallocate`d on drop.
#[cfg(target_os = "macos")]
pub struct ProcessorCpuLoadInfo {
    info: *mut libc::processor_cpu_load_info,
    count: libc::natural_t,
    info_size: libc::mach_msg_type_number_t,
}

#[cfg(target_os = "macos")]
impl ProcessorCpuLoadInfo {
    /// `None` if the call fails or returns a buffer of unexpected size.
    pub fn get() -> Option<Self> {
        let mut count: libc::natural_t = 0;
        let mut info: *mut libc::processor_cpu_load_info = core::ptr::null_mut();
        let mut info_size: libc::mach_msg_type_number_t = 0;
        // SAFETY: all three are stack out-params.
        if unsafe {
            libc::host_processor_info(
                crate::c::mach_host_self(),
                libc::PROCESSOR_CPU_LOAD_INFO,
                &raw mut count,
                (&raw mut info).cast::<libc::processor_info_array_t>(),
                &raw mut info_size,
            )
        } != 0
        {
            return None;
        }
        let this = Self {
            info,
            count,
            info_size,
        };
        (info_size == crate::c::PROCESSOR_CPU_LOAD_INFO_COUNT * count).then_some(this)
    }

    pub fn as_slice(&self) -> &[libc::processor_cpu_load_info] {
        // SAFETY: `get` checked that `info` holds exactly `count` entries; they live until drop.
        unsafe { core::slice::from_raw_parts(self.info, self.count as usize) }
    }
}

#[cfg(target_os = "macos")]
impl Drop for ProcessorCpuLoadInfo {
    fn drop(&mut self) {
        // SAFETY: the buffer `host_processor_info` mapped into this task:
        // `info_size` `integer_t`s starting at `info`.
        unsafe {
            let _ = libc::vm_deallocate(
                crate::c::mach_task_self(),
                self.info as usize,
                self.info_size as usize * core::mem::size_of::<libc::integer_t>(),
            );
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// libuv (Windows)
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
use crate::windows::libuv as uv;

/// The result of `uv_cpu_info`; `uv_free_cpu_info` on drop.
#[cfg(windows)]
pub struct CpuInfoList {
    ptr: *mut uv::uv_cpu_info_t,
    count: c_int,
}

#[cfg(windows)]
impl CpuInfoList {
    /// `Err` is the libuv error code.
    pub fn get() -> Result<Self, c_int> {
        let mut ptr = core::ptr::null_mut();
        let mut count: c_int = 0;
        // SAFETY: both are stack out-params.
        let rc = unsafe { uv::uv_cpu_info(&mut ptr, &mut count) };
        if rc != 0 {
            return Err(rc);
        }
        Ok(Self { ptr, count })
    }

    pub fn iter(&self) -> impl Iterator<Item = CpuInfo<'_>> {
        let entries: &[uv::uv_cpu_info_t] = if self.ptr.is_null() {
            &[]
        } else {
            // SAFETY: `uv_cpu_info` returned `count` entries at `ptr`; they live until drop.
            unsafe { core::slice::from_raw_parts(self.ptr, self.count.max(0) as usize) }
        };
        entries.iter().map(CpuInfo)
    }
}

#[cfg(windows)]
impl Drop for CpuInfoList {
    fn drop(&mut self) {
        // SAFETY: the array `uv_cpu_info` allocated, freed exactly once.
        unsafe { uv::uv_free_cpu_info(self.ptr, self.count) }
    }
}

/// One entry of a [`CpuInfoList`].
#[cfg(windows)]
#[derive(Clone, Copy)]
pub struct CpuInfo<'a>(&'a uv::uv_cpu_info_t);

#[cfg(windows)]
impl<'a> CpuInfo<'a> {
    pub fn model(self) -> &'a [u8] {
        if self.0.model.is_null() {
            return b"";
        }
        // SAFETY: libuv sets `model` to a NUL-terminated string owned by the list.
        unsafe { core::ffi::CStr::from_ptr(self.0.model) }.to_bytes()
    }
    pub fn speed(self) -> c_int {
        self.0.speed
    }
    pub fn times(self) -> &'a uv::uv_cpu_times_t {
        &self.0.cpu_times
    }
}

/// The result of `uv_interface_addresses`; `uv_free_interface_addresses` on drop.
#[cfg(windows)]
pub struct InterfaceAddresses {
    ptr: *mut uv::uv_interface_address_t,
    count: c_int,
}

#[cfg(windows)]
impl InterfaceAddresses {
    /// `Err` is the libuv error code.
    pub fn get() -> Result<Self, c_int> {
        let mut ptr = core::ptr::null_mut();
        let mut count: c_int = 0;
        // SAFETY: both are stack out-params.
        let rc = unsafe { uv::uv_interface_addresses(&mut ptr, &mut count) };
        if rc != 0 {
            return Err(rc);
        }
        Ok(Self { ptr, count })
    }

    pub fn iter(&self) -> impl Iterator<Item = InterfaceAddress<'_>> {
        let entries: &[uv::uv_interface_address_t] = if self.ptr.is_null() {
            &[]
        } else {
            // SAFETY: `uv_interface_addresses` returned `count` entries at `ptr`; they live until drop.
            unsafe { core::slice::from_raw_parts(self.ptr, self.count.max(0) as usize) }
        };
        entries.iter().map(InterfaceAddress)
    }
}

#[cfg(windows)]
impl Drop for InterfaceAddresses {
    fn drop(&mut self) {
        // SAFETY: the array `uv_interface_addresses` allocated, freed exactly once.
        unsafe { uv::uv_free_interface_addresses(self.ptr, self.count) }
    }
}

/// One entry of an [`InterfaceAddresses`] list.
#[cfg(windows)]
#[derive(Clone, Copy)]
pub struct InterfaceAddress<'a>(&'a uv::uv_interface_address_t);

#[cfg(windows)]
impl<'a> InterfaceAddress<'a> {
    pub fn name(self) -> &'a [u8] {
        if self.0.name.is_null() {
            return b"";
        }
        // SAFETY: libuv sets `name` to a NUL-terminated string owned by the list.
        unsafe { core::ffi::CStr::from_ptr(self.0.name) }.to_bytes()
    }
    pub fn phys_addr(self) -> [u8; 6] {
        self.0.phys_addr
    }
    pub fn is_internal(self) -> bool {
        self.0.is_internal != 0
    }
    pub fn address(self) -> Address {
        // SAFETY: the union holds a `sockaddr_in` or `sockaddr_in6` tagged by
        // its family, and is as large as the larger, so `init_posix`'s
        // family-sized copy stays inside it.
        unsafe { Address::init_posix(core::ptr::from_ref(&self.0.address).cast()) }
    }
    pub fn netmask(self) -> Address {
        // SAFETY: as for `address`.
        unsafe { Address::init_posix(core::ptr::from_ref(&self.0.netmask).cast()) }
    }
}

/// `uv_os_homedir` into `buf`; `Ok` is the length written.
#[cfg(windows)]
pub fn homedir(buf: &mut [u8]) -> Result<usize, uv::ReturnCode> {
    let mut size = buf.len();
    // SAFETY: `buf` is writable for `size` bytes; `size` is a stack in/out-param.
    let rc = unsafe { uv::uv_os_homedir(buf.as_mut_ptr(), &mut size) };
    if rc.int() != 0 {
        return Err(rc);
    }
    Ok(size)
}

/// `uv_os_uname`; `Err` is the libuv error code.
#[cfg(windows)]
pub fn uname() -> Result<uv::uv_utsname_t, c_int> {
    let mut info = uv::uv_utsname_t {
        sysname: [0; 256],
        release: [0; 256],
        version: [0; 256],
        machine: [0; 256],
    };
    // SAFETY: `info` is a stack out-param.
    let rc = unsafe { uv::uv_os_uname(&mut info) };
    if rc != 0 {
        return Err(rc);
    }
    Ok(info)
}

/// `uv_get_total_memory`.
#[cfg(windows)]
pub fn total_memory() -> u64 {
    // SAFETY: no arguments, no preconditions.
    unsafe { uv::uv_get_total_memory() }
}

/// `uv_uptime`; `Err` is the libuv error code.
#[cfg(windows)]
pub fn uptime() -> Result<f64, c_int> {
    let mut value = 0.0f64;
    // SAFETY: `value` is a stack out-param.
    let rc = unsafe { uv::uv_uptime(&mut value) };
    if rc != 0 {
        return Err(rc);
    }
    Ok(value)
}

/// `GetHostNameW` into `buf` (Winsock initialised first); the name up to its
/// NUL, or `None` on failure.
#[cfg(windows)]
pub fn hostname_w(buf: &mut [u16]) -> Option<&[u16]> {
    let cap = c_int::try_from(buf.len().checked_sub(1)?).ok()?;
    // SAFETY: idempotent Winsock init (libuv defers it to first use).
    unsafe { uv::uv__winsock_ensure() };
    // SAFETY: `buf` has room for `cap` characters plus the terminating NUL.
    if unsafe { crate::windows::GetHostNameW(buf.as_mut_ptr(), cap) } != 0 {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(&buf[..len])
}

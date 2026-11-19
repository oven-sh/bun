//! Host names to addresses.

use core::ffi::c_int;
use core::mem::offset_of;
use core::ptr::{self, NonNull};

use bun_core::WStr;

use super::ws2_32;
use crate::windows_format::resolver::{encode_name, ip_sockaddr};

#[repr(C)]
struct ADDRINFOW {
    ai_flags: c_int,
    ai_family: c_int,
    ai_socktype: c_int,
    ai_protocol: c_int,
    ai_addrlen: usize,
    ai_canonname: *mut u16,
    ai_addr: *mut u8,
    ai_next: *mut ADDRINFOW,
}
const _: () = assert!(size_of::<ADDRINFOW>() == 48);
const _: () = assert!(offset_of!(ADDRINFOW, ai_addrlen) == 16);
const _: () = assert!(offset_of!(ADDRINFOW, ai_addr) == 32);
const _: () = assert!(offset_of!(ADDRINFOW, ai_next) == 40);

#[link(name = "ws2_32")]
unsafe extern "system" {
    fn GetAddrInfoW(
        node: *const u16,
        service: *const u16,
        hints: *const ADDRINFOW,
        result: *mut *mut ADDRINFOW,
    ) -> c_int;
    fn FreeAddrInfoW(list: *mut ADDRINFOW);
}

/// What `GetAddrInfoW` returns.
pub struct AddrInfoList(NonNull<ADDRINFOW>);

impl AddrInfoList {
    pub const MAX_NAME_LEN: usize = 255;

    /// Blocks until the resolver answers. `Err` is the `EAI_*` status, or 0 for an empty list.
    pub fn lookup(
        host: Option<&[u8]>,
        service: Option<&[u8]>,
        hints: Option<&ws2_32::addrinfo>,
    ) -> Result<Self, c_int> {
        fn encode<'a>(text: Option<&[u8]>, buf: &'a mut [u16]) -> Result<Option<&'a WStr>, c_int> {
            text.map(|text| encode_name(text, buf).ok_or(ws2_32::EAI_NONAME))
                .transpose()
        }
        const NI_MAXSERV: usize = 32;
        let (mut host_buf, mut service_buf) = ([0; Self::MAX_NAME_LEN + 1], [0; NI_MAXSERV]);
        let host = encode(host, &mut host_buf)?;
        let service = encode(service, &mut service_buf)?;
        let hints = hints.map(|hints| ADDRINFOW {
            ai_flags: hints.ai_flags,
            ai_family: hints.ai_family,
            ai_socktype: hints.ai_socktype,
            ai_protocol: hints.ai_protocol,
            ai_addrlen: 0,
            ai_canonname: ptr::null_mut(),
            ai_addr: ptr::null_mut(),
            ai_next: ptr::null_mut(),
        });

        ws2_32::ensure_started();
        let mut list = ptr::null_mut();
        // SAFETY: each argument is null or valid for the call.
        let status = unsafe {
            GetAddrInfoW(
                host.map_or(ptr::null(), WStr::as_ptr),
                service.map_or(ptr::null(), WStr::as_ptr),
                hints.as_ref().map_or(ptr::null(), ptr::from_ref),
                &raw mut list,
            )
        };
        match NonNull::new(list) {
            Some(list) if status == 0 => Ok(Self(list)),
            _ => Err(status),
        }
    }

    /// The bytes of each `sockaddr_in` and `sockaddr_in6`, in the order of the list.
    pub fn addresses(&self) -> impl Iterator<Item = &[u8]> + Clone {
        // SAFETY: live until `drop`.
        let first = unsafe { self.0.as_ref() };
        // SAFETY: `ai_next` is null or the next entry of the list.
        let entries = core::iter::successors(Some(first), |it| unsafe { it.ai_next.as_ref() });
        entries.filter(|it| !it.ai_addr.is_null()).filter_map(|it| {
            let len = it.ai_addrlen.min(size_of::<ws2_32::sockaddr_in6>());
            // SAFETY: there are `ai_addrlen` bytes at `ai_addr`.
            ip_sockaddr(unsafe { core::slice::from_raw_parts(it.ai_addr, len) })
        })
    }
}

impl Drop for AddrInfoList {
    fn drop(&mut self) {
        // SAFETY: from `GetAddrInfoW`.
        unsafe { FreeAddrInfoW(self.0.as_ptr()) }
    }
}

#[cfg(test)]
mod tests {
    use super::ws2_32::{EAI_FAMILY, EAI_NONAME, EAI_SERVICE, EAI_SOCKTYPE};
    use super::*;

    fn lookup(host: &[u8], family: c_int) -> Result<Vec<Vec<u8>>, c_int> {
        const AI_NUMERICHOST: c_int = 4;
        let mut hints: ws2_32::addrinfo = bun_core::ffi::zeroed();
        hints.ai_flags = AI_NUMERICHOST;
        hints.ai_family = family;
        hints.ai_socktype = ws2_32::SOCK_STREAM;
        hints.ai_addrlen = 1;
        hints.ai_next = ptr::dangling_mut();
        let list = AddrInfoList::lookup(Some(host), Some(b"80"), Some(&hints))?;
        Ok(list.addresses().map(Vec::from).collect())
    }

    #[test]
    fn resolves_numeric_hosts() {
        let v4 = [2, 0, 0, 80, 127, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(lookup(b"127.0.0.1", 0), Ok(vec![v4.to_vec()]));

        let mut v6 = [0; 28];
        (v6[0], v6[3], v6[8], v6[9], v6[23], v6[24]) = (23, 80, 0xFE, 0x80, 1, 1);
        assert_eq!(lookup(b"fe80::1%1", 0), Ok(vec![v6.to_vec()]));
    }

    #[test]
    fn reports_failures() {
        assert_eq!(lookup(b"name", 0), Err(EAI_NONAME));
        assert_eq!(lookup(b"127.0.0.1", 12345), Err(EAI_FAMILY));
        let status = |service: &[u8], ai_flags, ai_socktype| {
            let hints = ws2_32::addrinfo {
                ai_flags,
                ai_socktype,
                ..bun_core::ffi::zeroed()
            };
            AddrInfoList::lookup(Some(b"127.0.0.1"), Some(service), Some(&hints)).err()
        };
        assert_eq!(status(b"no-such-service", 0, 1), Some(EAI_SERVICE));
        assert_eq!(status(b"80", 0, 12345), Some(EAI_SOCKTYPE));
        assert_eq!(lookup(b"", 0), Err(EAI_NONAME));
        assert_eq!(lookup("\u{FC}".as_bytes(), 0), Err(EAI_NONAME));
    }
}

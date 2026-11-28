//! Network adapters and their addresses.

use core::ffi::c_void;
use core::ptr;

use super::{ULONG, Win32Error, Win32ErrorExt as _, ws2_32};
use crate::E;
use crate::windows_format::adapter_addresses::{Interface, parse_interfaces};

#[link(name = "iphlpapi")]
unsafe extern "system" {
    fn GetAdaptersAddresses(
        Family: ULONG,
        Flags: ULONG,
        Reserved: *mut c_void,
        AdapterAddresses: *mut u64,
        SizePointer: *mut ULONG,
    ) -> ULONG;
}

const GAA_FLAG_SKIP_ANYCAST: ULONG = 0x2;
const GAA_FLAG_SKIP_MULTICAST: ULONG = 0x4;
const GAA_FLAG_SKIP_DNS_SERVER: ULONG = 0x8;
const ADDRESS_NOT_ASSOCIATED: Win32Error = Win32Error(1228);

/// An adapter takes about 1.6 KiB, and a call that only returns the required size is as slow as a successful one.
const INITIAL_BUFFER_SIZE: ULONG = 32 * 1024;

pub fn network_interfaces() -> Result<Vec<Interface>, E> {
    query_interfaces(INITIAL_BUFFER_SIZE)
}

fn query_interfaces(mut size: ULONG) -> Result<Vec<Interface>, E> {
    loop {
        let capacity = size;
        let mut buf = vec![0u64; (capacity as usize).div_ceil(size_of::<u64>())];
        // SAFETY: `buf` is aligned for `IP_ADAPTER_ADDRESSES` and writable for `size` bytes.
        let result = unsafe {
            GetAdaptersAddresses(
                ws2_32::AF_UNSPEC as ULONG,
                GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER,
                ptr::null_mut(),
                buf.as_mut_ptr(),
                &raw mut size,
            )
        };
        return match Win32Error::from_u32(result) {
            Win32Error::SUCCESS => {
                let bytes = bun_core::slice_as_bytes(&buf);
                Ok(parse_interfaces(bytes, bytes.as_ptr().addr()))
            }
            Win32Error::BUFFER_OVERFLOW if size > capacity => continue,
            Win32Error::NO_DATA => Ok(Vec::new()),
            ADDRESS_NOT_ASSOCIATED => Err(E::EAGAIN),
            Win32Error::BUFFER_OVERFLOW | Win32Error::INVALID_PARAMETER => Err(E::ENOBUFS),
            error => Err(error.to_node_errno()),
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_initial_buffer_returns_same_list() {
        let list = network_interfaces();
        assert!(list.as_ref().unwrap().iter().any(|entry| entry.is_loopback));
        assert_eq!(query_interfaces(8), list);
    }
}

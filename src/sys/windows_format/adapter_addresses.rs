//! Parser for `GetAdaptersAddresses` output: linked lists with pointers into the same buffer.

use core::iter::successors;
use core::mem::offset_of;
use core::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use bun_core::{AnyBitPattern, Unaligned, read_prefix};

use super::{AF_INET, AF_INET6, wtf16};

/// The leading fields of `IP_ADAPTER_ADDRESSES_LH`.
#[repr(C)]
#[derive(Clone, Copy)]
struct Adapter {
    length: u32,
    if_index: u32,
    next: usize,
    adapter_name: usize,
    first_unicast_address: usize,
    first_anycast_address: usize,
    first_multicast_address: usize,
    first_dns_server_address: usize,
    dns_suffix: usize,
    description: usize,
    friendly_name: usize,
    physical_address: [u8; 8],
    physical_address_length: u32,
    flags: u32,
    mtu: u32,
    if_type: u32,
    oper_status: u32,
    ipv6_if_index: u32,
}

/// `IP_ADAPTER_UNICAST_ADDRESS_LH`.
#[repr(C)]
#[derive(Clone, Copy)]
struct UnicastAddress {
    length: u32,
    flags: u32,
    next: usize,
    sockaddr: usize,
    sockaddr_length: u32,
    padding: u32,
    prefix_origin: u32,
    suffix_origin: u32,
    dad_state: u32,
    valid_lifetime: u32,
    preferred_lifetime: u32,
    lease_lifetime: u32,
    on_link_prefix_length: u8,
    tail_padding: [u8; 7],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SockaddrIn {
    family: u16,
    port: u16,
    address: [u8; 4],
    zero: [u8; 8],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SockaddrIn6 {
    family: u16,
    port: u16,
    flow_info: u32,
    address: [u8; 16],
    scope_id: u32,
}

bun_core::impl_pod!(Adapter, UnicastAddress, SockaddrIn, SockaddrIn6);

const _: () = {
    assert!(offset_of!(Adapter, first_unicast_address) == 24);
    assert!(offset_of!(Adapter, friendly_name) == 72);
    assert!(offset_of!(Adapter, physical_address) == 80);
    assert!(offset_of!(Adapter, physical_address_length) == 88);
    assert!(offset_of!(Adapter, if_type) == 100);
    assert!(offset_of!(Adapter, oper_status) == 104);
    assert!(offset_of!(UnicastAddress, sockaddr) == 16);
    assert!(offset_of!(UnicastAddress, on_link_prefix_length) == 56);
    assert!(size_of::<UnicastAddress>() == 64);
    assert!(size_of::<SockaddrIn>() == 16);
    assert!(size_of::<SockaddrIn6>() == 28);
};

const IF_OPER_STATUS_UP: u32 = 1;
const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;

/// An adapter that is up and has at least one unicast address.
#[derive(Debug, PartialEq, Eq)]
pub struct Interface {
    /// WTF-8.
    pub name: Vec<u8>,
    /// All zeros unless the physical address is six bytes long.
    pub mac: [u8; 6],
    pub is_loopback: bool,
    pub addresses: Vec<InterfaceAddress>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InterfaceAddress {
    pub ip: IpAddr,
    pub prefix_len: u8,
    /// `None` for IPv4.
    pub scope_id: Option<u32>,
}

impl InterfaceAddress {
    pub fn netmask(&self) -> IpAddr {
        let prefix_len = self.prefix_len.into();
        match self.ip {
            IpAddr::V4(_) => Ipv4Addr::from_bits(!u32::MAX.unbounded_shr(prefix_len)).into(),
            IpAddr::V6(_) => Ipv6Addr::from_bits(!u128::MAX.unbounded_shr(prefix_len)).into(),
        }
    }
}

#[derive(Clone, Copy)]
struct Buffer<'a> {
    bytes: &'a [u8],
    base_address: usize,
}

impl<'a> Buffer<'a> {
    /// The bytes from `address` to the end. Empty if `address` does not point into the buffer.
    fn resolve_pointer(self, address: usize) -> &'a [u8] {
        let bytes = self.bytes.get(address.wrapping_sub(self.base_address)..);
        bytes.unwrap_or_default()
    }

    fn iter_list<T: AnyBitPattern>(
        self,
        first: usize,
        next: impl Fn(&T) -> usize,
    ) -> impl Iterator<Item = T> {
        let read = move |address| read_prefix(self.resolve_pointer(address));
        successors(read(first), move |node| read(next(node)))
            .take(self.bytes.len() / size_of::<T>())
    }

    fn parse_address(self, unicast: &UnicastAddress) -> Option<InterfaceAddress> {
        let sockaddr = self.resolve_pointer(unicast.sockaddr);
        let sockaddr = sockaddr.get(..unicast.sockaddr_length as usize)?;
        let (ip, max_prefix_len, scope_id) = match read_prefix(sockaddr)? {
            AF_INET => (
                read_prefix::<SockaddrIn>(sockaddr)?.address.into(),
                32,
                None,
            ),
            AF_INET6 => {
                let sockaddr: SockaddrIn6 = read_prefix(sockaddr)?;
                (sockaddr.address.into(), 128, Some(sockaddr.scope_id))
            }
            _ => return None,
        };
        Some(InterfaceAddress {
            ip,
            prefix_len: unicast.on_link_prefix_length.min(max_prefix_len),
            scope_id,
        })
    }

    fn parse_interface(self, adapter: &Adapter) -> Interface {
        let name = Unaligned::slice_of(self.resolve_pointer(adapter.friendly_name));
        let [mac @ .., _, _] = adapter.physical_address;
        let first = adapter.first_unicast_address;
        let unicast_list = self.iter_list(first, |unicast: &UnicastAddress| unicast.next);
        Interface {
            name: wtf16::decode_until_nul(name.iter().map(|unit| unit.get())),
            mac: match adapter.physical_address_length {
                6 => mac,
                _ => [0; 6],
            },
            is_loopback: adapter.if_type == IF_TYPE_SOFTWARE_LOOPBACK,
            addresses: unicast_list
                .filter_map(|unicast| self.parse_address(&unicast))
                .collect(),
        }
    }
}

/// `base_address` is the address that `bytes` had when the system filled it.
pub(crate) fn parse_interfaces(bytes: &[u8], base_address: usize) -> Vec<Interface> {
    let buffer = Buffer {
        bytes,
        base_address,
    };
    buffer
        .iter_list(base_address, |adapter: &Adapter| adapter.next)
        .filter(|adapter| adapter.oper_status == IF_OPER_STATUS_UP)
        .map(|adapter| buffer.parse_interface(&adapter))
        .filter(|interface| !interface.addresses.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use bun_core::ffi::zeroed;
    use bun_core::{NoUninit, bytes_of, slice_as_bytes};

    use super::*;

    const BASE_ADDRESS: usize = 0x1_0000;

    /// Reserves space for the first adapter, which `finish` writes.
    struct BufferBuilder(Vec<u8>);

    impl BufferBuilder {
        fn new() -> Self {
            Self(vec![0; size_of::<Adapter>()])
        }

        fn append<T: NoUninit>(&mut self, items: &[T]) -> usize {
            let address = BASE_ADDRESS + self.0.len();
            self.0.extend(slice_as_bytes(items));
            address
        }

        fn append_unicast(
            &mut self,
            ip: &str,
            scope_id: u32,
            prefix_len: u8,
            next: usize,
        ) -> usize {
            let (sockaddr, sockaddr_length) = match ip.parse().unwrap() {
                IpAddr::V4(ip) => {
                    let sockaddr = SockaddrIn {
                        family: AF_INET,
                        address: ip.octets(),
                        ..zeroed()
                    };
                    (self.append(&[sockaddr]), 16)
                }
                IpAddr::V6(ip) => {
                    let sockaddr = SockaddrIn6 {
                        family: AF_INET6,
                        address: ip.octets(),
                        scope_id,
                        ..zeroed()
                    };
                    (self.append(&[sockaddr]), 28)
                }
            };
            self.append(&[UnicastAddress {
                next,
                sockaddr,
                sockaddr_length,
                on_link_prefix_length: prefix_len,
                ..zeroed()
            }])
        }

        /// Appends only the name.
        fn new_adapter(
            &mut self,
            name: &[u16],
            first_unicast_address: usize,
            next: usize,
        ) -> Adapter {
            let friendly_name = self.append(name);
            self.append(&[0u16]);
            Adapter {
                next,
                first_unicast_address,
                friendly_name,
                physical_address: [1, 2, 3, 4, 5, 6, 7, 8],
                physical_address_length: 6,
                if_type: 6,
                oper_status: IF_OPER_STATUS_UP,
                ..zeroed()
            }
        }

        fn finish(mut self, first: &Adapter) -> Vec<u8> {
            self.0[..size_of::<Adapter>()].copy_from_slice(bytes_of(first));
            self.0
        }
    }

    fn new_address(ip: &str, prefix_len: u8, scope_id: Option<u32>) -> InterfaceAddress {
        InterfaceAddress {
            ip: ip.parse().unwrap(),
            prefix_len,
            scope_id,
        }
    }

    fn build_three_adapters() -> Vec<u8> {
        let mut builder = BufferBuilder::new();

        let v4 = builder.append_unicast("127.0.0.1", 0, 8, 0);
        let v6 = builder.append_unicast("::1", 0, 128, v4);
        let loopback = Adapter {
            if_type: IF_TYPE_SOFTWARE_LOOPBACK,
            physical_address_length: 0,
            ..builder.new_adapter(&[0x4E16, 0xD83C, 0xDF0D, 0xD800], v6, 0)
        };
        let loopback = builder.append(&[loopback]);

        let v4 = builder.append_unicast("169.254.1.2", 0, 16, 0);
        let down = Adapter {
            oper_status: 2,
            ..builder.new_adapter(&[0x62], v4, loopback)
        };
        let down = builder.append(&[down]);

        let v4 = builder.append_unicast("192.168.1.2", 0, 24, 0);
        let v6 = builder.append_unicast("fe80::1", 12, 64, v4);
        let first = builder.new_adapter(&[0x61], v6, down);
        builder.finish(&first)
    }

    #[test]
    fn lists_only_adapters_that_are_up() {
        let expected = [
            Interface {
                name: b"a".to_vec(),
                mac: [1, 2, 3, 4, 5, 6],
                is_loopback: false,
                addresses: vec![
                    new_address("fe80::1", 64, Some(12)),
                    new_address("192.168.1.2", 24, None),
                ],
            },
            Interface {
                name: b"\xE4\xB8\x96\xF0\x9F\x8C\x8D\xED\xA0\x80".to_vec(),
                mac: [0; 6],
                is_loopback: true,
                addresses: vec![
                    new_address("::1", 128, Some(0)),
                    new_address("127.0.0.1", 8, None),
                ],
            },
        ];
        assert_eq!(
            parse_interfaces(&build_three_adapters(), BASE_ADDRESS),
            expected
        );
    }

    #[test]
    fn no_addresses_yield_no_interfaces() {
        assert_eq!(parse_interfaces(&[], BASE_ADDRESS), []);
        assert_eq!(parse_interfaces(&[0; 512], BASE_ADDRESS), []);

        let mut builder = BufferBuilder::new();
        let first = builder.new_adapter(&[0x61], 0, 0);
        assert_eq!(parse_interfaces(&builder.finish(&first), BASE_ADDRESS), []);
    }

    #[test]
    fn null_friendly_name_yields_empty_name() {
        let mut builder = BufferBuilder::new();
        let unicast = builder.append_unicast("10.0.0.1", 0, 8, 0);
        let first = Adapter {
            friendly_name: 0,
            ..builder.new_adapter(&[0x61], unicast, 0)
        };
        let interfaces = parse_interfaces(&builder.finish(&first), BASE_ADDRESS);
        assert_eq!(interfaces[0].name, b"");
    }

    #[test]
    fn partial_buffer_yields_subset_of_addresses() {
        let bytes = build_three_adapters();
        let complete = parse_interfaces(&bytes, BASE_ADDRESS);
        for len in 0..bytes.len() {
            let partial = parse_interfaces(&bytes[..len], BASE_ADDRESS).into_iter();
            for address in partial.flat_map(|interface| interface.addresses) {
                assert!(
                    complete
                        .iter()
                        .any(|interface| interface.addresses.contains(&address))
                );
            }
        }
        for base_address in [1, BASE_ADDRESS - 8, BASE_ADDRESS + bytes.len(), usize::MAX] {
            assert!(
                parse_interfaces(&bytes, base_address).len() <= bytes.len() / size_of::<Adapter>()
            );
        }
    }

    #[test]
    fn cyclic_lists_terminate() {
        let mut builder = BufferBuilder::new();
        let next = BASE_ADDRESS + builder.0.len() + size_of::<SockaddrIn>();
        let unicast = builder.append_unicast("10.0.0.1", 0, 8, next);
        assert_eq!(unicast, next);
        let first = builder.new_adapter(&[0x61], unicast, BASE_ADDRESS);
        let bytes = builder.finish(&first);
        assert_eq!(parse_interfaces(&bytes, BASE_ADDRESS).len(), 1);
    }

    #[test]
    fn mac_requires_six_byte_physical_address() {
        for (len, mac) in [
            (0, [0; 6]),
            (5, [0; 6]),
            (6, [1, 2, 3, 4, 5, 6]),
            (8, [0; 6]),
        ] {
            let mut builder = BufferBuilder::new();
            let unicast = builder.append_unicast("10.0.0.1", 0, 8, 0);
            let first = Adapter {
                physical_address_length: len,
                ..builder.new_adapter(&[0x61], unicast, 0)
            };
            let interfaces = parse_interfaces(&builder.finish(&first), BASE_ADDRESS);
            assert_eq!(interfaces[0].mac, mac);
        }
    }

    #[test]
    fn skips_sockaddr_with_unexpected_family_or_length() {
        for (family, sockaddr_length) in [
            (AF_INET, 15),
            (AF_INET6, 27),
            (AF_INET6, 0),
            (AF_INET6, u32::MAX),
            (1, 28),
        ] {
            let mut builder = BufferBuilder::new();
            let next = builder.append_unicast("10.0.0.1", 0, 8, 0);
            let sockaddr = builder.append(&[SockaddrIn6 { family, ..zeroed() }]);
            let unicast = builder.append(&[UnicastAddress {
                next,
                sockaddr,
                sockaddr_length,
                ..zeroed()
            }]);
            let first = builder.new_adapter(&[0x61], unicast, 0);
            let interfaces = parse_interfaces(&builder.finish(&first), BASE_ADDRESS);
            assert_eq!(interfaces[0].addresses, [new_address("10.0.0.1", 8, None)]);
        }
    }

    #[test]
    fn netmask_matches_prefix_len() {
        const ALL_ONES: &str = "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff";
        for (ip, prefix_len, netmask) in [
            ("10.0.0.1", 0, "0.0.0.0"),
            ("10.0.0.1", 1, "128.0.0.0"),
            ("10.0.0.1", 9, "255.128.0.0"),
            ("10.0.0.1", 31, "255.255.255.254"),
            ("10.0.0.1", 32, "255.255.255.255"),
            ("fd00::1", 0, "::"),
            ("fd00::1", 1, "8000::"),
            ("fd00::1", 63, "ffff:ffff:ffff:fffe::"),
            ("fd00::1", 64, "ffff:ffff:ffff:ffff::"),
            ("fd00::1", 128, ALL_ONES),
        ] {
            let mut builder = BufferBuilder::new();
            let unicast = builder.append_unicast(ip, 0, prefix_len, 0);
            let first = builder.new_adapter(&[0x61], unicast, 0);
            let address = parse_interfaces(&builder.finish(&first), BASE_ADDRESS)[0].addresses[0];
            assert_eq!(address.prefix_len, prefix_len);
            assert_eq!(address.netmask().to_string(), netmask);
        }
    }
}

//! What `GetAdaptersAddresses` writes: lists whose links are addresses in the buffer that holds them.

use core::iter::successors;
use core::mem::offset_of;
use core::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use bun_core::{AnyBitPattern, Unaligned, read_prefix};

use super::{AF_INET, AF_INET6, wide};

/// The start of `IP_ADAPTER_ADDRESSES_LH`.
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
struct Unicast {
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
    padding_at_end: [u8; 7],
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

bun_core::impl_pod!(Adapter, Unicast, SockaddrIn, SockaddrIn6);

const _: () = {
    assert!(offset_of!(Adapter, first_unicast_address) == 24);
    assert!(offset_of!(Adapter, friendly_name) == 72);
    assert!(offset_of!(Adapter, physical_address) == 80);
    assert!(offset_of!(Adapter, physical_address_length) == 88);
    assert!(offset_of!(Adapter, if_type) == 100);
    assert!(offset_of!(Adapter, oper_status) == 104);
    assert!(offset_of!(Unicast, sockaddr) == 16);
    assert!(offset_of!(Unicast, on_link_prefix_length) == 56);
    assert!(size_of::<Unicast>() == 64);
    assert!(size_of::<SockaddrIn>() == 16);
    assert!(size_of::<SockaddrIn6>() == 28);
};

const IF_OPER_STATUS_UP: u32 = 1;
const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;

/// An adapter that is up and has an address.
#[derive(Debug, PartialEq, Eq)]
pub struct Interface {
    /// WTF-8.
    pub name: Vec<u8>,
    /// Zeros unless the hardware address has six bytes.
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
    base: usize,
}

impl<'a> Buffer<'a> {
    /// Empty if `address` is null or somewhere else.
    fn starting_at(self, address: usize) -> &'a [u8] {
        let bytes = self.bytes.get(address.wrapping_sub(self.base)..);
        bytes.unwrap_or_default()
    }

    fn list<T: AnyBitPattern>(
        self,
        first: usize,
        next: impl Fn(&T) -> usize,
    ) -> impl Iterator<Item = T> {
        let read = move |address| read_prefix(self.starting_at(address));
        successors(read(first), move |it| read(next(it))).take(self.bytes.len() / size_of::<T>())
    }

    fn address(self, unicast: &Unicast) -> Option<InterfaceAddress> {
        let sockaddr = self.starting_at(unicast.sockaddr);
        let sockaddr = sockaddr.get(..unicast.sockaddr_length as usize)?;
        let (ip, bits, scope_id) = match read_prefix(sockaddr)? {
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
            prefix_len: unicast.on_link_prefix_length.min(bits),
            scope_id,
        })
    }

    fn interface(self, adapter: &Adapter) -> Interface {
        let name = Unaligned::slice_of(self.starting_at(adapter.friendly_name));
        let [mac @ .., _, _] = adapter.physical_address;
        let unicast = self.list(adapter.first_unicast_address, |it: &Unicast| it.next);
        Interface {
            name: wide::decode_until_nul(name.iter().map(|unit| unit.get())),
            mac: match adapter.physical_address_length {
                6 => mac,
                _ => [0; 6],
            },
            is_loopback: adapter.if_type == IF_TYPE_SOFTWARE_LOOPBACK,
            addresses: unicast.filter_map(|it| self.address(&it)).collect(),
        }
    }
}

/// `base` is where `bytes` were when they were written.
pub(crate) fn interfaces(bytes: &[u8], base: usize) -> Vec<Interface> {
    let buffer = Buffer { bytes, base };
    buffer
        .list(base, |adapter: &Adapter| adapter.next)
        .filter(|adapter| adapter.oper_status == IF_OPER_STATUS_UP)
        .map(|adapter| buffer.interface(&adapter))
        .filter(|interface| !interface.addresses.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use bun_core::ffi::zeroed;
    use bun_core::{NoUninit, bytes_of, slice_as_bytes};

    use super::*;

    const BASE: usize = 0x1_0000;

    /// Room for the first adapter, which `finish` fills in.
    struct Writer(Vec<u8>);

    impl Writer {
        fn new() -> Self {
            Self(vec![0; size_of::<Adapter>()])
        }

        fn add<T: NoUninit>(&mut self, items: &[T]) -> usize {
            let address = BASE + self.0.len();
            self.0.extend(slice_as_bytes(items));
            address
        }

        fn unicast(&mut self, ip: &str, scope_id: u32, prefix_len: u8, next: usize) -> usize {
            let (sockaddr, sockaddr_length) = match ip.parse().unwrap() {
                IpAddr::V4(ip) => {
                    let sockaddr = SockaddrIn {
                        family: AF_INET,
                        address: ip.octets(),
                        ..zeroed()
                    };
                    (self.add(&[sockaddr]), 16)
                }
                IpAddr::V6(ip) => {
                    let sockaddr = SockaddrIn6 {
                        family: AF_INET6,
                        address: ip.octets(),
                        scope_id,
                        ..zeroed()
                    };
                    (self.add(&[sockaddr]), 28)
                }
            };
            self.add(&[Unicast {
                next,
                sockaddr,
                sockaddr_length,
                on_link_prefix_length: prefix_len,
                ..zeroed()
            }])
        }

        fn adapter(&mut self, name: &[u16], first_unicast_address: usize, next: usize) -> Adapter {
            let friendly_name = self.add(name);
            self.add(&[0u16]);
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

    fn address(ip: &str, prefix_len: u8, scope_id: Option<u32>) -> InterfaceAddress {
        InterfaceAddress {
            ip: ip.parse().unwrap(),
            prefix_len,
            scope_id,
        }
    }

    fn three_adapters() -> Vec<u8> {
        let mut writer = Writer::new();

        let v4 = writer.unicast("127.0.0.1", 0, 8, 0);
        let v6 = writer.unicast("::1", 0, 128, v4);
        let loopback = Adapter {
            if_type: IF_TYPE_SOFTWARE_LOOPBACK,
            physical_address_length: 0,
            ..writer.adapter(&[0x4E16, 0xD83C, 0xDF0D, 0xD800], v6, 0)
        };
        let loopback = writer.add(&[loopback]);

        let v4 = writer.unicast("169.254.1.2", 0, 16, 0);
        let down = Adapter {
            oper_status: 2,
            ..writer.adapter(&[0x62], v4, loopback)
        };
        let down = writer.add(&[down]);

        let v4 = writer.unicast("192.168.1.2", 0, 24, 0);
        let v6 = writer.unicast("fe80::1", 12, 64, v4);
        let first = writer.adapter(&[0x61], v6, down);
        writer.finish(&first)
    }

    #[test]
    fn lists_the_addresses_of_adapters_that_are_up() {
        let expected = [
            Interface {
                name: b"a".to_vec(),
                mac: [1, 2, 3, 4, 5, 6],
                is_loopback: false,
                addresses: vec![
                    address("fe80::1", 64, Some(12)),
                    address("192.168.1.2", 24, None),
                ],
            },
            Interface {
                name: b"\xE4\xB8\x96\xF0\x9F\x8C\x8D\xED\xA0\x80".to_vec(),
                mac: [0; 6],
                is_loopback: true,
                addresses: vec![address("::1", 128, Some(0)), address("127.0.0.1", 8, None)],
            },
        ];
        assert_eq!(interfaces(&three_adapters(), BASE), expected);
    }

    #[test]
    fn can_be_empty() {
        assert_eq!(interfaces(&[], BASE), []);
        assert_eq!(interfaces(&[0; 512], BASE), []);

        let mut writer = Writer::new();
        let without_address = writer.adapter(&[0x61], 0, 0);
        assert_eq!(interfaces(&writer.finish(&without_address), BASE), []);
    }

    #[test]
    fn can_have_no_name() {
        let mut writer = Writer::new();
        let unicast = writer.unicast("10.0.0.1", 0, 8, 0);
        let first = Adapter {
            friendly_name: 0,
            ..writer.adapter(&[0x61], unicast, 0)
        };
        assert_eq!(interfaces(&writer.finish(&first), BASE)[0].name, b"");
    }

    #[test]
    fn stops_where_the_buffer_does() {
        let bytes = three_adapters();
        let all = interfaces(&bytes, BASE);
        for len in 0..bytes.len() {
            let addresses = interfaces(&bytes[..len], BASE).into_iter();
            for address in addresses.flat_map(|it| it.addresses) {
                assert!(all.iter().any(|it| it.addresses.contains(&address)));
            }
        }
        for base in [1, BASE - 8, BASE + bytes.len(), usize::MAX] {
            assert!(interfaces(&bytes, base).len() <= bytes.len() / size_of::<Adapter>());
        }
    }

    #[test]
    fn ends_a_list_that_comes_back_to_itself() {
        let mut writer = Writer::new();
        let next = BASE + writer.0.len() + size_of::<SockaddrIn>();
        let unicast = writer.unicast("10.0.0.1", 0, 8, next);
        assert_eq!(unicast, next);
        let first = writer.adapter(&[0x61], unicast, BASE);
        let bytes = writer.finish(&first);
        assert_eq!(interfaces(&bytes, BASE).len(), 1);
    }

    #[test]
    fn takes_a_hardware_address_of_six_bytes_only() {
        for (len, mac) in [
            (0, [0; 6]),
            (5, [0; 6]),
            (6, [1, 2, 3, 4, 5, 6]),
            (8, [0; 6]),
        ] {
            let mut writer = Writer::new();
            let unicast = writer.unicast("10.0.0.1", 0, 8, 0);
            let first = Adapter {
                physical_address_length: len,
                ..writer.adapter(&[0x61], unicast, 0)
            };
            assert_eq!(interfaces(&writer.finish(&first), BASE)[0].mac, mac);
        }
    }

    #[test]
    fn skips_an_address_of_another_family_or_size() {
        for (family, sockaddr_length) in [
            (AF_INET, 15),
            (AF_INET6, 27),
            (AF_INET6, 0),
            (AF_INET6, u32::MAX),
            (1, 28),
        ] {
            let mut writer = Writer::new();
            let next = writer.unicast("10.0.0.1", 0, 8, 0);
            let sockaddr = writer.add(&[SockaddrIn6 { family, ..zeroed() }]);
            let unicast = writer.add(&[Unicast {
                next,
                sockaddr,
                sockaddr_length,
                ..zeroed()
            }]);
            let first = writer.adapter(&[0x61], unicast, 0);
            let found = interfaces(&writer.finish(&first), BASE);
            assert_eq!(found[0].addresses, [address("10.0.0.1", 8, None)]);
        }
    }

    #[test]
    fn makes_the_mask_from_the_prefix() {
        const ALL: &str = "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff";
        for (ip, given, prefix_len, netmask) in [
            ("10.0.0.1", 0, 0, "0.0.0.0"),
            ("10.0.0.1", 1, 1, "128.0.0.0"),
            ("10.0.0.1", 9, 9, "255.128.0.0"),
            ("10.0.0.1", 31, 31, "255.255.255.254"),
            ("10.0.0.1", 32, 32, "255.255.255.255"),
            ("fd00::1", 0, 0, "::"),
            ("fd00::1", 1, 1, "8000::"),
            ("fd00::1", 63, 63, "ffff:ffff:ffff:fffe::"),
            ("fd00::1", 64, 64, "ffff:ffff:ffff:ffff::"),
            ("fd00::1", 128, 128, ALL),
        ] {
            let mut writer = Writer::new();
            let unicast = writer.unicast(ip, 0, given, 0);
            let first = writer.adapter(&[0x61], unicast, 0);
            let found = interfaces(&writer.finish(&first), BASE)[0].addresses[0];
            assert_eq!(found.prefix_len, prefix_len);
            assert_eq!(found.netmask().to_string(), netmask);
        }
    }
}

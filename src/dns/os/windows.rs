//! The adapters that are up have the servers, and the registry has the rest.

use core::ffi::c_void;
use core::mem::offset_of;
use core::net::{Ipv4Addr, SocketAddr};
use core::ptr;

use bun_collections::index_sort;
use bun_core::{AnyBitPattern, strings};
use bun_dns_client::Config;
use bun_paths::Path;
use bun_sys::net::Address;

/// The start of `IP_ADAPTER_ADDRESSES_LH`
#[repr(C)]
#[derive(Clone, Copy)]
struct Adapter {
    _length_and_index: u64,
    next: usize,
    name: usize,
    _addresses: [usize; 3],
    first_server: usize,
    _link: [u64; 6],
    status: u32,
    ipv6_index: u32,
    _zones_and_speeds: [u64; 13],
    ipv4_metric: u32,
    ipv6_metric: u32,
    luid: u64,
}

/// `IP_ADAPTER_DNS_SERVER_ADDRESS_XP`
#[repr(C)]
#[derive(Clone, Copy)]
struct Server {
    _length: u64,
    next: usize,
    address: usize,
    address_len: u32,
}
bun_core::impl_any_bit_pattern!(Adapter, Server);

/// `MIB_IPFORWARD_ROW2`
#[repr(C, align(8))]
#[derive(Default)]
struct Route {
    _before: [u32; 21],
    metric: u32,
    _after: [u32; 4],
}

const _: () = {
    assert!(offset_of!(Adapter, first_server) == 48 && offset_of!(Adapter, status) == 104);
    assert!(offset_of!(Adapter, ipv4_metric) == 216 && offset_of!(Adapter, luid) == 224);
    assert!(offset_of!(Route, metric) == 84 && size_of::<Route>() == 104);
};

const ERROR_SUCCESS: u32 = 0;
const ERROR_BUFFER_OVERFLOW: u32 = 111;
const ERROR_MORE_DATA: u32 = 234;
/// `GAA_FLAG_SKIP_UNICAST`, `_ANYCAST`, `_MULTICAST` and `_FRIENDLY_NAME`
const SKIP_ALL_BUT_SERVERS: u32 = 0x01 | 0x02 | 0x04 | 0x20;
const IF_OPER_STATUS_UP: u32 = 1;
const HKEY_LOCAL_MACHINE: isize = 0x8000_0002_u32 as i32 as isize;
/// A `REG_EXPAND_SZ` is expanded into one.
const RRF_RT_REG_SZ: u32 = 0x02;

#[link(name = "iphlpapi")]
unsafe extern "system" {
    fn GetAdaptersAddresses(
        family: u32,
        flags: u32,
        reserved: *const c_void,
        adapters: *mut u64,
        size: &mut u32,
    ) -> u32;
    safe fn GetBestRoute2(
        interface_luid: &u64,
        interface_index: u32,
        source: Option<&Address>,
        destination: &Address,
        sort_options: u32,
        best_route: &mut Route,
        best_source: &mut Address,
    ) -> u32;
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn RegGetValueW(
        key: isize,
        sub_key: *const u16,
        value: *const u16,
        flags: u32,
        kind: Option<&mut u32>,
        data: *mut u16,
        size: &mut u32,
    ) -> u32;
}

/// Calls `fill` with a buffer and its size in bytes until it is large enough.
fn filled<T: Copy + Default>(
    mut len: usize,
    too_small: u32,
    mut fill: impl FnMut(*mut T, &mut u32) -> u32,
) -> Option<Vec<T>> {
    loop {
        let mut buffer = vec![T::default(); len];
        let mut size = u32::try_from(size_of_val(&*buffer)).ok()?;
        match fill(buffer.as_mut_ptr(), &mut size) {
            ERROR_SUCCESS => return Some(buffer),
            status if status == too_small => len += size as usize / size_of::<T>(),
            _ => return None,
        }
    }
}

/// `key` and `value` are ASCII.
fn registry_string(key: &[u8], value: &[u8]) -> Option<Vec<u8>> {
    let wide = |text: &[u8]| -> Vec<u16> { text.iter().map(|&it| it.into()).chain([0]).collect() };
    let (key, value) = (wide(key), wide(value));
    let units = filled(256, ERROR_MORE_DATA, |data, size| {
        let (key, value) = (key.as_ptr(), value.as_ptr());
        // SAFETY: both names are NUL-terminated, and `data` has `size` bytes.
        unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                key,
                value,
                RRF_RT_REG_SZ,
                None,
                data,
                size,
            )
        }
    })?;
    let len = strings::index_of_scalar(&units, 0)?;
    Some(strings::to_utf8_alloc(&units[..len]))
}

/// Its pointers point into it.
struct Adapters(Vec<u64>);

impl Adapters {
    fn get() -> Option<Self> {
        let buffer = filled(2048, ERROR_BUFFER_OVERFLOW, |adapters, size| {
            // SAFETY: `adapters` has `size` bytes.
            unsafe { GetAdaptersAddresses(0, SKIP_ALL_BUT_SERVERS, ptr::null(), adapters, size) }
        });
        buffer.map(Self)
    }

    fn bytes_at(&self, pointer: usize) -> Option<&[u8]> {
        let offset = pointer.checked_sub(self.0.as_ptr().addr())?;
        bun_core::slice_as_bytes(&self.0).get(offset..)
    }

    fn list<T: AnyBitPattern>(
        &self,
        first: usize,
        next: impl Fn(&T) -> usize,
    ) -> impl Iterator<Item = T> {
        let read = |pointer| bun_core::read_prefix(self.bytes_at(pointer)?);
        core::iter::successors(read(first), move |item| read(next(item)))
    }

    fn up(&self) -> impl Iterator<Item = Adapter> {
        let all = self.list(self.0.as_ptr().addr(), |adapter: &Adapter| adapter.next);
        all.filter(|adapter| adapter.status == IF_OPER_STATUS_UP)
    }

    fn servers(&self, adapter: &Adapter) -> impl Iterator<Item = Address> {
        let servers = self.list(adapter.first_server, |server: &Server| server.next);
        servers.filter_map(|server| {
            let bytes = self.bytes_at(server.address)?;
            Some(Address::from_bytes(
                bytes.get(..server.address_len as usize)?,
            ))
        })
    }
}

/// Routing goes by its sum with the metric of the interface. Lower is better.
fn route_metric(adapter: &Adapter, server: &Address) -> Option<u32> {
    let (mut route, mut source) = (Route::default(), *server);
    let status = GetBestRoute2(&adapter.luid, 0, None, server, 0, &mut route, &mut source);
    (status == ERROR_SUCCESS).then_some(route.metric)
}

fn default_database_path() -> Option<Vec<u8>> {
    let mut buffer = bun_paths::w_path_buffer_pool::get();
    let len = bun_sys::windows::GetSystemDirectoryW(&mut buffer.0).ok()?;
    let system = strings::to_utf8_alloc(&buffer.0[..len]);
    Some([&system[..], br"\drivers\etc"].concat())
}

/// The metric of a route to a neighbor.
const ON_LINK: u32 = 256;

/// No adapter has a route to a loopback address. It stays next to the other servers of its adapter.
fn lend_routes_to_loopback(servers: &mut [(SocketAddr, Option<u32>)]) {
    let first = |is_it: &dyn Fn(&SocketAddr) -> bool| {
        let mut servers = servers.iter().filter(|(server, _)| is_it(server));
        servers.find_map(|&(_, route)| route)
    };
    let any = first(&|_| true).unwrap_or(ON_LINK);
    let mut last = [SocketAddr::is_ipv4, SocketAddr::is_ipv6].map(|it| first(&it).unwrap_or(any));
    for (server, route) in servers {
        let last = &mut last[usize::from(server.is_ipv6())];
        if server.ip().is_loopback() {
            *route = Some(*last);
        }
        *last = route.unwrap_or(*last);
    }
}

const TCPIP: &[u8] = br"System\CurrentControlSet\Services\Tcpip\Parameters";
const NT_POLICY: &[u8] = br"Software\Policies\Microsoft\Windows NT\DNSClient";
const SYSTEM_POLICY: &[u8] = br"Software\Policies\Microsoft\System\DNSClient";

pub(super) fn configure(config: &mut Config) {
    let directory = registry_string(TCPIP, b"DatabasePath");
    let directory = directory.filter(|it| bun_paths::is_fully_qualified(it));
    let directory = directory.or_else(default_database_path);
    let hosts = directory.map(|it| Path::from_parts(&[&it[..], b"hosts"]));
    config.hosts_path = hosts.unwrap_or_default().to_zbox();
    let mut add_domains = |key: &[u8], values: &[&[u8]]| {
        for value in values {
            config.add_domains(&registry_string(key, value).unwrap_or_default());
        }
    };
    add_domains(TCPIP, &[b"SearchList", b"Domain"]);
    add_domains(NT_POLICY, &[b"SearchList"]);
    add_domains(SYSTEM_POLICY, &[b"PrimaryDNSSuffix"]);

    let Some(adapters) = Adapters::get() else {
        return;
    };
    let mut servers = Vec::new();
    for adapter in adapters.up() {
        if let Some(name) = adapters.bytes_at(adapter.name) {
            let key = [TCPIP, br"\Interfaces\", bun_core::slice_to_nul(name)].concat();
            add_domains(&key, &[b"SearchList", b"Domain", b"DhcpDomain"]);
        }
        let mut of_adapter = Vec::new();
        for address in adapters.servers(&adapter) {
            if let Some(server) = address.to_socket_addr()
                && !server.ip().is_unspecified()
                && server.ip() != Ipv4Addr::BROADCAST
            {
                let route = (!server.ip().is_loopback()).then(|| route_metric(&adapter, &address));
                of_adapter.push((server, route.flatten()));
            }
        }
        lend_routes_to_loopback(&mut of_adapter);
        for (server, route) in of_adapter {
            let interface = match server {
                SocketAddr::V4(_) => adapter.ipv4_metric,
                SocketAddr::V6(_) => adapter.ipv6_metric,
            };
            let metric = route.map_or(u32::MAX, |route| route.saturating_add(interface));
            servers.push((metric, server, adapter.ipv6_index));
        }
    }
    index_sort::sort_slice_by_key(&mut servers, |&(metric, ..)| metric);
    for (_, server, interface) in servers {
        config.add_server(server.ip(), server.port(), interface);
    }
}

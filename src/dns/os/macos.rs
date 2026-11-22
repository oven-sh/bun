//! What `scutil --dns` prints, through `dnsinfo.h` of https://github.com/apple-oss-distributions/configd

use core::ffi::{c_char, c_void};
use core::mem::offset_of;
use core::net::SocketAddr;

use bun_core::zstr;
use bun_dns_client::Config;
use bun_sys::DynLib;
use bun_sys::net::Address;

/// `dns_resolver_t`
#[repr(C, packed(4))]
struct Resolver {
    domain: *const c_char,
    server_count: i32,
    servers: *const *const libc::sockaddr,
    port: u16,
    search_count: i32,
    search: *const *const c_char,
    sort_count: i32,
    sort: *const c_void,
    options: *const c_char,
    timeout: u32,
    search_order: u32,
    interface: u32,
    flags: u32,
    reachability: u32,
}

/// The start of `dns_config_t`
#[repr(C, packed(4))]
struct Configuration {
    resolver_count: i32,
    resolvers: *const *const Resolver,
}

const _: () = {
    assert!(offset_of!(Resolver, port) == 20 && offset_of!(Resolver, options) == 48);
    assert!(offset_of!(Resolver, reachability) == 72 && offset_of!(Configuration, resolvers) == 4);
};

/// `kSCNetworkReachabilityFlags*`
const REACHABLE: u32 = 1 << 1;
const CONNECTION_ON_TRAFFIC: u32 = 1 << 3;

/// # Safety
/// `list` has `count` items for as long as the result is in use.
unsafe fn items<T>(list: *const *const T, count: i32) -> impl Iterator<Item = *const T> {
    // SAFETY: fn contract.
    (0..count.max(0) as usize).map(move |index| unsafe { list.add(index).read_unaligned() })
}

/// # Safety
/// `resolver` is part of what `dns_configuration_copy` returned.
unsafe fn add(resolver: &Resolver, config: &mut Config) {
    // One for a domain, such as `local`, knows nothing else.
    if !{ resolver.domain }.is_null()
        || resolver.reachability & (REACHABLE | CONNECTION_ON_TRAFFIC) == 0
        || resolver.server_count <= 0
    {
        return;
    }
    // SAFETY: fn contract. An address starts with its length.
    unsafe {
        for domain in items(resolver.search, resolver.search_count) {
            config.add_domains(bun_core::ffi::cstr(domain).to_bytes());
        }
        if !{ resolver.options }.is_null() {
            config.set_options(bun_core::ffi::cstr(resolver.options).to_bytes());
        }
        for server in items(resolver.servers, resolver.server_count) {
            let server = core::slice::from_raw_parts(server.cast(), (*server).sa_len.into());
            if let Some(server) = Address::from_bytes(server).to_socket_addr() {
                let port = Some(server.port()).filter(|&port| port != 0);
                let interface = match server {
                    SocketAddr::V6(server) if server.scope_id() != 0 => server.scope_id(),
                    _ => resolver.interface,
                };
                config.add_server(server.ip(), port.unwrap_or(resolver.port), interface);
            }
        }
    }
}

pub(super) fn configure(config: &mut Config) {
    type CopyFn = unsafe extern "C" fn() -> *mut Configuration;
    type FreeFn = unsafe extern "C" fn(*mut Configuration);
    // SAFETY: these are their types in `dnsinfo.h`, and what one returns lives until the other gets it.
    unsafe {
        let system = DynLib::GLOBAL;
        let (Some(copy), Some(free)) = (
            system.lookup_as::<CopyFn>(zstr!("dns_configuration_copy")),
            system.lookup_as::<FreeFn>(zstr!("dns_configuration_free")),
        ) else {
            return;
        };
        let configuration = copy();
        if let Some(it) = configuration.as_ref() {
            items(it.resolvers, it.resolver_count).for_each(|resolver| add(&*resolver, config));
            free(configuration);
        }
    }
}

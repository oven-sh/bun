//! Asks the system what it knows of its resolver. What to make of the answer is `bun_dns_resolver`'s business.

#[cfg(not(windows))]
use bun_dns_resolver::io::Settings;

#[cfg(not(any(windows, target_os = "macos", target_os = "android")))]
pub(super) fn read() -> Settings {
    Settings::Files
}

#[cfg(target_os = "android")]
pub(super) fn read() -> Settings {
    /// `PROP_VALUE_MAX`
    const LONGEST_VALUE: usize = 92;
    let mut servers = Vec::new();
    // None is set since Android 8, where only the Java API knows.
    for name in [
        c"net.dns1",
        c"net.dns2",
        c"net.dns3",
        c"net.dns4",
        c"net.dns5",
        c"net.dns6",
        c"net.dns7",
        c"net.dns8",
    ] {
        let mut value = [0u8; LONGEST_VALUE];
        // SAFETY: `name` is NUL-terminated and `value` has the `PROP_VALUE_MAX` bytes the function may write.
        let len = unsafe { libc::__system_property_get(name.as_ptr(), value.as_mut_ptr().cast()) };
        match usize::try_from(len) {
            Ok(len @ 1..LONGEST_VALUE) => servers.push(value[..len].to_vec()),
            _ => break,
        }
    }
    Settings::Android(servers)
}

#[cfg(target_os = "macos")]
pub(super) fn read() -> Settings {
    Settings::Mac(mac::resolvers())
}

/// <https://github.com/apple-oss-distributions/configd/blob/main/dnsinfo/dnsinfo.h>
#[cfg(target_os = "macos")]
mod mac {
    use core::ffi::{c_char, c_void};

    use bun_dns_resolver::io::MacResolver;
    use bun_sys::net::Address;

    #[repr(C, packed(4))]
    struct DnsResolver {
        domain: *const c_char,
        n_nameserver: i32,
        nameserver: *const *const libc::sockaddr,
        port: u16,
        n_search: i32,
        search: *const *const c_char,
        _n_sortaddr: i32,
        _sortaddr: *const c_void,
        options: *const c_char,
        _timeout: u32,
        _search_order: u32,
        if_index: u32,
        _flags: u32,
        reach_flags: u32,
        _reserved: [u32; 5],
    }

    #[repr(C, packed(4))]
    struct DnsConfig {
        n_resolver: i32,
        resolver: *const *const DnsResolver,
        _n_scoped_resolver: i32,
        _scoped_resolver: *const *const DnsResolver,
        _reserved: [u32; 5],
    }

    /// The `count` pointers at `list`, which is aligned to 4 bytes only.
    ///
    /// # Safety
    /// `list` points to `count` pointers, or is null, or `count` is not positive.
    unsafe fn pointers<T>(list: *const *const T, count: i32) -> impl Iterator<Item = *const T> {
        let count = if list.is_null() { 0 } else { count.max(0) };
        // SAFETY: `index` is within the `count` elements the caller vouches for.
        (0..count as usize).map(move |index| unsafe { list.add(index).read_unaligned() })
    }

    /// # Safety
    /// `text` is null or NUL-terminated.
    unsafe fn bytes(text: *const c_char) -> Option<Vec<u8>> {
        // SAFETY: not null, so NUL-terminated by the caller's word.
        (!text.is_null()).then(|| unsafe { bun_core::ffi::cstr(text) }.to_bytes().to_vec())
    }

    pub(super) fn resolvers() -> Option<Vec<MacResolver>> {
        // In no public header, so not linked against.
        let copy = bun_sys::dlsym_with_handle!(
            unsafe extern "C" fn() -> *mut DnsConfig,
            "dns_configuration_copy",
            Some(libc::RTLD_DEFAULT)
        )?;
        let free = bun_sys::dlsym_with_handle!(
            unsafe extern "C" fn(*mut DnsConfig),
            "dns_configuration_free",
            Some(libc::RTLD_DEFAULT)
        )?;
        // SAFETY: takes nothing and returns a configuration to free, or null.
        let config = unsafe { copy() };
        if config.is_null() {
            return None;
        }
        // SAFETY: `config` came from `dns_configuration_copy` and is not used after this.
        let _free = scopeguard::guard(config, |config| unsafe { free(config) });

        let mut resolvers = Vec::new();
        // SAFETY: every count in a configuration is the length of the list beside it, every pointer in a list is valid
        // until the configuration is freed, and every string is NUL-terminated.
        unsafe {
            let config = config.read_unaligned();
            for resolver in pointers(config.resolver, config.n_resolver) {
                let resolver = resolver.read_unaligned();
                resolvers.push(MacResolver {
                    for_one_domain: !resolver.domain.is_null(),
                    reach_flags: resolver.reach_flags,
                    port: resolver.port,
                    search: pointers(resolver.search, resolver.n_search)
                        .filter_map(|domain| bytes(domain))
                        .collect(),
                    options: bytes(resolver.options),
                    nameservers: pointers(resolver.nameserver, resolver.n_nameserver)
                        .filter(|address| !address.is_null())
                        .filter_map(|address| Address::init_posix(address).to_socket_addr())
                        .collect(),
                    interface: resolver.if_index,
                });
            }
        }
        Some(resolvers)
    }
}

#[cfg(windows)]
pub(super) use windows::{etc_directory, has_interface, interface_index, loopback_addresses, read};

#[cfg(windows)]
mod windows {
    use core::net::{IpAddr, SocketAddr};
    use core::ptr::{null, null_mut};

    use bun_core::{strings, wstr};
    use bun_dns_resolver::io::{Settings, WindowsServer, WindowsSettings};
    use bun_sys::net::Address;
    use bun_sys::windows::advapi32::{self, HKEY};
    use bun_sys::windows::iphlpapi::{self, SOCKADDR_INET};
    use bun_sys::windows::ws2_32;

    const TCPIP_PARAMETERS: &[u16] =
        wstr!("System\\CurrentControlSet\\Services\\Tcpip\\Parameters");

    struct Key(HKEY);

    impl Drop for Key {
        fn drop(&mut self) {
            // SAFETY: open, and closed once.
            unsafe { advapi32::RegCloseKey(self.0) };
        }
    }

    impl Key {
        /// `path` ends with a NUL.
        fn open(parent: HKEY, path: &[u16], access: u32) -> Option<Key> {
            debug_assert_eq!(path.last(), Some(&0));
            let mut key: HKEY = null_mut();
            // SAFETY: `parent` is open, `path` is NUL-terminated and `key` is written on success.
            let status =
                unsafe { advapi32::RegOpenKeyExW(parent, path.as_ptr(), 0, access as _, &mut key) };
            (status == advapi32::ERROR_SUCCESS).then_some(Key(key))
        }

        /// The string under `name`, which ends with a NUL. The result does not.
        fn string(&self, name: &[u16]) -> Option<Vec<u16>> {
            debug_assert_eq!(name.last(), Some(&0));
            let mut size = 0;
            // SAFETY: with no buffer, only `size` is written.
            let status = unsafe {
                advapi32::RegQueryValueExW(
                    self.0,
                    name.as_ptr(),
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    &mut size,
                )
            };
            if (status != advapi32::ERROR_SUCCESS && status != advapi32::ERROR_MORE_DATA)
                || size == 0
            {
                return None;
            }
            // A value may have been stored without its NUL.
            let mut value = vec![0u16; size as usize / 2 + 1];
            // SAFETY: `value` has more than the `size` bytes that may be written.
            let status = unsafe {
                advapi32::RegQueryValueExW(
                    self.0,
                    name.as_ptr(),
                    null_mut(),
                    null_mut(),
                    value.as_mut_ptr().cast(),
                    &mut size,
                )
            };
            if status != advapi32::ERROR_SUCCESS {
                return None;
            }
            let len = strings::index_of_scalar(&value, 0)?;
            value.truncate(len);
            (!value.is_empty()).then_some(value)
        }

        fn add_strings(&self, names: &[&[u16]], out: &mut Vec<Vec<u8>>) {
            for name in names {
                if let Some(value) = self.string(name) {
                    out.push(strings::to_utf8_alloc(&value));
                }
            }
        }

        /// NUL-terminated.
        fn child_name(&self, index: u32) -> Option<[u16; 256]> {
            let mut name = [0u16; 256];
            let mut len = name.len() as _;
            // SAFETY: `name` has the `len` units that may be written, the NUL among them.
            let status = unsafe {
                advapi32::RegEnumKeyExW(
                    self.0,
                    index as _,
                    name.as_mut_ptr(),
                    &mut len,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    null_mut(),
                )
            };
            (status == advapi32::ERROR_SUCCESS).then_some(name)
        }
    }

    fn suffixes() -> Vec<Vec<u8>> {
        use advapi32::{HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE, KEY_READ};
        let (search_list, domain) = (wstr!("SearchList"), wstr!("Domain"));
        let mut found = Vec::new();
        if let Some(key) = Key::open(HKEY_LOCAL_MACHINE, TCPIP_PARAMETERS, KEY_READ as u32) {
            key.add_strings(&[search_list, domain], &mut found);
        }
        let policy = wstr!("Software\\Policies\\Microsoft\\Windows NT\\DNSClient");
        if let Some(key) = Key::open(HKEY_LOCAL_MACHINE, policy, KEY_READ as u32) {
            key.add_strings(&[search_list], &mut found);
        }
        let policy = wstr!("Software\\Policies\\Microsoft\\System\\DNSClient");
        if let Some(key) = Key::open(HKEY_LOCAL_MACHINE, policy, KEY_READ as u32) {
            key.add_strings(&[wstr!("PrimaryDNSSuffix")], &mut found);
        }
        let interfaces =
            wstr!("System\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces");
        if let Some(interfaces) = Key::open(HKEY_LOCAL_MACHINE, interfaces, KEY_READ as u32) {
            for index in 0.. {
                let Some(name) = interfaces.child_name(index) else {
                    break;
                };
                if let Some(key) = Key::open(interfaces.0, &name, KEY_QUERY_VALUE as u32) {
                    key.add_strings(&[search_list, domain, wstr!("DhcpDomain")], &mut found);
                }
            }
        }
        found
    }

    fn route_metric(mut adapter: iphlpapi::NET_LUID, destination: &Address) -> Option<u32> {
        let mut to = SOCKADDR_INET([0; 7]);
        // SAFETY: an `Address` is a `sockaddr_storage`, which is larger than a `SOCKADDR_INET`. Both are plain bytes.
        unsafe {
            core::ptr::copy_nonoverlapping(
                destination.as_sockaddr().cast::<u8>(),
                (&raw mut to).cast::<u8>(),
                size_of::<SOCKADDR_INET>(),
            );
        }
        let mut from = SOCKADDR_INET([0; 7]);
        // SAFETY: all-zero is a valid value of a struct of integers.
        let mut route: iphlpapi::MIB_IPFORWARD_ROW2 = unsafe { bun_core::ffi::zeroed_unchecked() };
        // SAFETY: the index is ignored beside a LUID, no source address is asked for, and the last two are written.
        let status = unsafe {
            iphlpapi::GetBestRoute2(&mut adapter, 0, null(), &to, 0, &mut route, &mut from)
        };
        (status == iphlpapi::NO_ERROR).then_some(route.Metric)
    }

    fn servers() -> Vec<WindowsServer> {
        let mut servers = Vec::new();
        // 15 KiB is what Microsoft recommends to start with. `u64`: the structs hold pointers.
        let mut buffer = vec![0u64; 15 * 1024 / 8];
        let mut status = iphlpapi::ERROR_BUFFER_OVERFLOW;
        for _ in 0..3 {
            let mut size = (buffer.len() * 8) as u32;
            // SAFETY: `buffer` has the `size` bytes that may be written.
            status = unsafe {
                iphlpapi::GetAdaptersAddresses(
                    ws2_32::AF_UNSPEC as u32,
                    0,
                    null_mut(),
                    buffer.as_mut_ptr().cast(),
                    &mut size,
                )
            };
            if status != iphlpapi::ERROR_BUFFER_OVERFLOW {
                break;
            }
            buffer.resize((size as usize).div_ceil(8), 0);
        }
        if status != iphlpapi::NO_ERROR {
            return servers;
        }

        let mut adapter: *const iphlpapi::IP_ADAPTER_ADDRESSES = buffer.as_ptr().cast();
        // SAFETY: on success the buffer starts with an adapter, and every `Next`, `FirstDnsServerAddress` and
        // `lpSockaddr` is null or points into the buffer, which outlives the loop.
        while let Some(it) = unsafe { adapter.as_ref() } {
            adapter = it.Next;
            if it.OperStatus != iphlpapi::IF_OPER_STATUS_UP {
                continue;
            }
            let mut server: *const iphlpapi::IP_ADAPTER_DNS_SERVER_ADDRESS =
                it.FirstDnsServerAddress;
            // SAFETY: as above.
            while let Some(entry) = unsafe { server.as_ref() } {
                server = entry.Next;
                if entry.Address.lpSockaddr.is_null() {
                    continue;
                }
                // SAFETY: a valid address of the family it declares.
                let address = unsafe { Address::init_posix(entry.Address.lpSockaddr.cast()) };
                let Some(socket_address) = address.to_socket_addr() else {
                    continue;
                };
                servers.push(WindowsServer {
                    address: socket_address,
                    interface_metric: match socket_address {
                        SocketAddr::V4(_) => it.Ipv4Metric,
                        SocketAddr::V6(_) => it.Ipv6Metric,
                    },
                    route_metric: route_metric(it.Luid, &address),
                    ipv6_interface: it.Ipv6IfIndex,
                });
            }
        }
        servers
    }

    pub(in super::super) fn read() -> Settings {
        Settings::Windows(WindowsSettings {
            servers: servers(),
            suffixes: suffixes(),
        })
    }

    /// `DatabasePath`, where `hosts` and `services` are. Normally `%SystemRoot%\System32\drivers\etc`.
    pub(in super::super) fn etc_directory() -> Option<Vec<u8>> {
        let key = Key::open(
            advapi32::HKEY_LOCAL_MACHINE,
            TCPIP_PARAMETERS,
            advapi32::KEY_READ as u32,
        )?;
        let mut path = key.string(wstr!("DatabasePath"))?;
        path.push(0);
        let mut expanded = [0u16; 260];
        // SAFETY: `path` is NUL-terminated and `expanded` has the units that may be written.
        let len = unsafe {
            bun_sys::windows::ExpandEnvironmentStringsW(
                path.as_ptr(),
                expanded.as_mut_ptr(),
                expanded.len() as _,
            )
        } as usize;
        // The count includes the NUL, and is what it would take if that is more than there is.
        let expanded = expanded.get(..len.checked_sub(1)?)?;
        Some(strings::to_utf8_alloc(expanded))
    }

    pub(in super::super) fn interface_index(name: &[u8]) -> Option<u32> {
        let name = bun_core::ZBox::from_bytes(name);
        // SAFETY: `name` is NUL-terminated.
        Some(unsafe { iphlpapi::if_nametoindex(name.as_ptr().cast()) }).filter(|&index| index != 0)
    }

    pub(in super::super) fn has_interface(index: u32) -> bool {
        let mut name = [0; iphlpapi::IF_NAMESIZE];
        // SAFETY: the buffer is the `IF_NAMESIZE` bytes the function may write.
        !unsafe { iphlpapi::if_indextoname(index, name.as_mut_ptr()) }.is_null()
    }

    pub(in super::super) fn loopback_addresses() -> Option<Vec<IpAddr>> {
        let mut table: *mut iphlpapi::MIB_UNICASTIPADDRESS_TABLE = null_mut();
        // SAFETY: `table` is written on success.
        let status =
            unsafe { iphlpapi::GetUnicastIpAddressTable(ws2_32::AF_UNSPEC as u16, &mut table) };
        if status != iphlpapi::NO_ERROR || table.is_null() {
            return Some(Vec::new());
        }
        // SAFETY: `table` came from `GetUnicastIpAddressTable` and is not used after this.
        let _free = scopeguard::guard(table, |table| unsafe {
            iphlpapi::FreeMibTable(table.cast())
        });
        // SAFETY: `Table` is `NumEntries` rows long.
        let rows = unsafe {
            core::slice::from_raw_parts(
                (&raw const (*table).Table).cast::<iphlpapi::MIB_UNICASTIPADDRESS_ROW>(),
                (*table).NumEntries as usize,
            )
        };
        let addresses = rows
            .iter()
            .filter(|row| (row.InterfaceLuid >> 48) as u16 == iphlpapi::IF_TYPE_SOFTWARE_LOOPBACK)
            // SAFETY: a `SOCKADDR_INET` is a valid address of the family it declares.
            .filter_map(|row| {
                unsafe { Address::init_posix((&raw const row.Address).cast()) }.to_socket_addr()
            })
            .map(|address| address.ip())
            .collect();
        Some(addresses)
    }
}

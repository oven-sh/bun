//! The system's resolver configuration: resolv.conf(5) and nsswitch.conf(5) or what the system has instead, then the environment.

use core::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use bun_core::ip_address::parse_ares;
use bun_core::strings;

use crate::channel::ServerConfig;
use crate::io::{EnvVar, FileError, Io, MacResolver, Settings, WindowsSettings};
use crate::lookup::is_site_local;
use crate::text::{
    ADDRESS_SIZE, all_print, fields, is_print, key_and_value, parse_uint, printable_within,
    take_while, trim, trim_start, word,
};
use crate::{Error, Result};

// c-ares's buffers, with their NUL.
const KEYWORD_SIZE: usize = 32;
const VALUE_SIZE: usize = 512;
const PORT_SIZE: usize = 6;
/// `IF_NAMESIZE` wherever servers are read from text.
const INTERFACE_NAME_SIZE: usize = 16;

/// Where a host's addresses, or an address's host, are looked up.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Source {
    /// hosts(5).
    Files,
    Dns,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct SystemConfig {
    pub(crate) servers: Vec<ServerConfig>,
    pub(crate) search_domains: Vec<Vec<u8>>,
    pub(crate) sources: Vec<Source>,
    pub(crate) ndots: usize,
    pub(crate) tries: Option<u32>,
    pub(crate) timeout_ms: Option<u32>,
    pub(crate) rotate: bool,
    pub(crate) use_tcp: bool,
}

impl Default for SystemConfig {
    fn default() -> SystemConfig {
        SystemConfig {
            servers: Vec::new(),
            search_domains: Vec::new(),
            sources: vec![Source::Files, Source::Dns],
            ndots: 1,
            tries: None,
            timeout_ms: None,
            rotate: false,
            use_tcp: false,
        }
    }
}

pub(crate) fn load_file(io: &mut dyn Io, path: &[u8]) -> Result<Vec<u8>> {
    io.read_file(path).map_err(|error| match error {
        FileError::NotFound => Error::ENOTFOUND,
        FileError::Other => Error::EFILE,
    })
}

pub(crate) fn load_etc_file(io: &mut dyn Io, name: &str) -> Result<Vec<u8>> {
    let path = io.etc_path(name).ok_or(Error::ENOTFOUND)?;
    load_file(io, &path)
}

/// `None`: the system has a configuration and it cannot be read.
pub(crate) fn read(io: &mut dyn Io) -> Option<SystemConfig> {
    let mut config = SystemConfig::default();
    match io.settings() {
        Settings::Files => config.read_files(io)?,
        Settings::Windows(settings) => config.read_windows(io, settings),
        Settings::Mac(resolvers) => {
            for resolver in resolvers? {
                config.read_mac_resolver(io, &resolver);
            }
        }
        Settings::Android(properties) => {
            if properties.is_empty() {
                return None;
            }
            for servers in properties {
                config.add_servers(io, &servers);
            }
        }
    }
    if let Some(domain) = io.env(EnvVar::LocalDomain) {
        config.set_search_domains(&domain, Some(1));
    }
    if let Some(options) = io.env(EnvVar::ResOptions) {
        config.set_options(&options);
    }
    Some(config)
}

/// The search list of a system that configures none.
pub(crate) fn domain_of_hostname(io: &mut dyn Io) -> Option<Vec<u8>> {
    let hostname = io.hostname()?;
    let (_, domain) = strings::split_once_char(&hostname, b'.')?;
    Some(domain.to_vec())
}

impl SystemConfig {
    /// A resolv.conf that is there and cannot be read is an error. Without nsswitch.conf only the order of sources is unknown.
    fn read_files(&mut self, io: &mut dyn Io) -> Option<()> {
        match load_etc_file(io, "resolv.conf") {
            Ok(text) => {
                for line in fields(&text, b"\n") {
                    self.parse_resolv_conf_line(io, line);
                }
            }
            Err(Error::ENOTFOUND) => {}
            Err(_) => return None,
        }
        if let Ok(text) = load_etc_file(io, "nsswitch.conf") {
            for line in fields(&text, b"\n") {
                self.parse_nsswitch_line(line);
            }
        }
        Some(())
    }

    fn read_windows(&mut self, io: &mut dyn Io, settings: WindowsSettings) {
        // Windows routes packets by these metrics and does not order the servers by them.
        let mut servers: Vec<(u32, SocketAddr, u32)> = Vec::new();
        for server in settings.servers {
            let interface = match server.address.ip() {
                IpAddr::V4(Ipv4Addr::UNSPECIFIED | Ipv4Addr::BROADCAST) => continue,
                IpAddr::V6(Ipv6Addr::UNSPECIFIED) => continue,
                IpAddr::V6(v6) if v6.is_unicast_link_local() => server.ipv6_interface,
                _ => 0,
            };
            let metric = server
                .route_metric
                .filter(|&metric| metric != u32::MAX)
                .and_then(|metric| metric.checked_add(server.interface_metric))
                .unwrap_or(u32::MAX);
            servers.push((metric, server.address, interface));
        }
        servers.sort_by_key(|(metric, ..)| *metric);
        let mut seen: Vec<(IpAddr, u16, u32)> = Vec::new();
        for (_, address, interface) in servers {
            let server = (address.ip(), address.port(), interface);
            if !seen.contains(&server) {
                seen.push(server);
                self.add_server(io, address.ip(), address.port(), Some(interface));
            }
        }

        let suffixes: Vec<&[u8]> = settings
            .suffixes
            .iter()
            .map(Vec::as_slice)
            .filter(|suffix| !suffix.is_empty() && all_print(suffix))
            .collect();
        if !suffixes.is_empty() {
            self.set_search_domains(&suffixes.join(&b','), None);
        }
    }

    fn read_mac_resolver(&mut self, io: &mut dyn Io, resolver: &MacResolver) {
        /// `kSCNetworkFlagsReachable | kSCNetworkReachabilityFlagsConnectionOnTraffic`
        const CAN_BE_REACHED: u32 = 1 << 1 | 1 << 3;
        if resolver.for_one_domain
            || resolver.reach_flags & CAN_BE_REACHED == 0
            || resolver.nameservers.is_empty()
        {
            return;
        }
        for domain in &resolver.search {
            self.add_search_domain(domain);
        }
        if let Some(options) = &resolver.options {
            self.set_options(options);
        }
        for address in &resolver.nameservers {
            let port = match address.port() {
                0 => resolver.port,
                port => port,
            };
            self.add_server(io, address.ip(), port, Some(resolver.interface));
        }
    }

    fn add_search_domain(&mut self, domain: &[u8]) {
        let mut known = self.search_domains.iter();
        if !known.any(|it| it.eq_ignore_ascii_case(domain)) {
            self.search_domains.push(domain.to_vec());
        }
    }

    fn set_search_domains(&mut self, list: &[u8], max: Option<usize>) {
        self.search_domains.clear();
        for domain in strings::tokenize_any(list, b", \t") {
            if all_print(domain) {
                self.add_search_domain(domain);
            }
        }
        self.search_domains.truncate(max.unwrap_or(usize::MAX));
    }

    fn set_sources(&mut self, list: &[u8]) {
        let mut sources = Vec::new();
        for word in fields(list, b" \t") {
            if !all_print(word) {
                return;
            }
            let is = |names: &[&[u8]]| names.iter().any(|name| name.eq_ignore_ascii_case(word));
            let source = if is(&[b"dns", b"bind", b"bind4", b"bind6", b"resolv", b"resolve"]) {
                Source::Dns
            } else if is(&[b"files", b"file", b"local", b"local4", b"local6"]) {
                Source::Files
            } else {
                continue;
            };
            if !sources.contains(&source) {
                sources.push(source);
            }
        }
        if !sources.is_empty() {
            self.sources = sources;
        }
    }

    fn set_option(&mut self, option: &[u8]) {
        let Some((key, value)) = key_and_value(option, b':') else {
            return;
        };
        let Some(value) = value.map_or(Some(0), parse_uint) else {
            return;
        };
        match key {
            b"ndots" => self.ndots = value as usize,
            // c-ares multiplies in an `unsigned int` and takes 0 for "not set".
            b"retrans" | b"timeout" if value != 0 => {
                self.timeout_ms = Some(value.wrapping_mul(1000)).filter(|&ms| ms != 0);
            }
            b"retry" | b"attempts" if matches!(value, 1..=255) => self.tries = Some(value),
            b"rotate" => self.rotate = true,
            b"use-vc" | b"usevc" => self.use_tcp = true,
            _ => {}
        }
    }

    fn set_options(&mut self, options: &[u8]) {
        for option in fields(options, b" \t") {
            self.set_option(option);
        }
    }

    fn add_servers(&mut self, io: &mut dyn Io, list: &[u8]) {
        for text in strings::tokenize_any(list, b" ,\t") {
            if let Some((address, port, interface)) = parse_server(text) {
                let interface = interface.and_then(|name| interface_index(io, name));
                self.add_server(io, address, port, interface);
            }
        }
    }

    /// `interface` matters to a link-local address only, which is of no use without one.
    fn add_server(&mut self, io: &mut dyn Io, address: IpAddr, port: u16, interface: Option<u32>) {
        let scope_id = match address {
            // Deprecated by RFC 3879. Windows and Android are known to list such servers; none exists.
            IpAddr::V6(v6) if is_site_local(&v6) => return,
            IpAddr::V6(v6) if v6.is_unicast_link_local() => {
                match interface.filter(|&index| io.has_interface(index)) {
                    Some(index) => index,
                    None => return,
                }
            }
            _ => 0,
        };
        self.servers.push(ServerConfig {
            address,
            udp_port: port,
            tcp_port: port,
            scope_id,
        });
    }

    fn parse_resolv_conf_line(&mut self, io: &mut dyn Io, line: &[u8]) {
        if let [b'#' | b';', ..] = line {
            return;
        }
        let (keyword, rest) = word(line);
        let rest = trim_start(rest);
        let value = match strings::index_of_any(rest, b"#;") {
            Some(comment) => rest.get(..comment).unwrap_or_default(),
            None => rest,
        };
        let is_text = |&byte: &u8| is_print(byte) || byte == b'\t';
        let Some(keyword) = printable_within(keyword, KEYWORD_SIZE) else {
            return;
        };
        if value.len() >= VALUE_SIZE || !value.iter().all(is_text) {
            return;
        }
        let value = trim(value);
        if value.is_empty() {
            return;
        }
        match keyword {
            b"domain" => self.set_search_domains(value, Some(1)),
            b"lookup" | b"hostresorder" => self.set_sources(value),
            b"search" => self.set_search_domains(value, None),
            b"nameserver" => self.add_servers(io, value),
            b"options" => self.set_options(value),
            _ => {}
        }
    }

    fn parse_nsswitch_line(&mut self, line: &[u8]) {
        let line = strings::split_once_char(line, b'#').map_or(line, |(before, _)| before);
        if let Some((b"hosts", Some(sources))) = key_and_value(line, b':') {
            self.set_sources(sources);
        }
    }
}

fn interface_index(io: &mut dyn Io, interface: &[u8]) -> Option<u32> {
    if interface.iter().all(u8::is_ascii_digit) {
        return parse_uint(interface);
    }
    io.interface_index(interface)
}

/// `address`, `v4:port`, `[address]` or `[address]:port`, then `%interface` if any. No port is 0.
fn parse_server(text: &[u8]) -> Option<(IpAddr, u16, Option<&[u8]>)> {
    let text = trim_start(text);
    let (address, mut rest) = match text {
        [b'[', inside @ ..] => strings::split_once_char(inside, b']')?,
        // A dot within the first four bytes makes it IPv4.
        _ => match strings::index_of_char_usize(text, b'.') {
            Some(1..=3) => take_while(text, |byte| byte.is_ascii_digit() || byte == b'.'),
            _ => take_while(text, |byte| {
                byte.is_ascii_hexdigit() || matches!(byte, b'.' | b':')
            }),
        },
    };
    let address = parse_ares(printable_within(address, ADDRESS_SIZE).filter(|it| !it.is_empty())?)?;

    let mut port = 0;
    if let [b':', after @ ..] = rest {
        let (digits, after) = take_while(after, |byte| byte.is_ascii_digit());
        port = u16::try_from(parse_uint(printable_within(digits, PORT_SIZE)?)?).ok()?;
        rest = after;
    }
    let mut interface = None;
    if let [b'%', after @ ..] = rest {
        let (name, after) = take_while(after, |byte| {
            byte.is_ascii_alphanumeric()
                || matches!(byte, b'.' | b'-' | b'_' | b'\\' | b':' | b'{' | b'}')
        });
        interface = Some(printable_within(name, INTERFACE_NAME_SIZE).filter(|it| !it.is_empty())?);
        rest = after;
    }
    trim_start(rest)
        .is_empty()
        .then_some((address, port, interface))
}

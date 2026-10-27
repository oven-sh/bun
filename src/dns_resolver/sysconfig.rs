//! The system's resolver configuration: resolv.conf(5) and nsswitch.conf(5) or what the system has instead, then the environment.

use core::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use bun_core::ip_address::parse_ares;
use bun_core::strings;

use crate::buf::all_print;
use crate::channel::ServerConfig;
use crate::io::{FileError, Io, MacResolver, Settings, Variable, WindowsSettings};
use crate::text::{fits, parse_uint, split, take_while, trim, trim_start, word};
use crate::{Error, Result};

/// Where a host's addresses, or an address's host, are looked up.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Source {
    /// hosts(5).
    Files,
    Dns,
}

#[derive(Default, Debug, PartialEq, Eq)]
pub struct SysConfig {
    pub servers: Vec<ServerConfig>,
    /// The search list.
    pub domains: Vec<Vec<u8>>,
    pub sources: Option<Vec<Source>>,
    pub ndots: usize,
    pub tries: Option<u32>,
    pub timeout_ms: Option<u32>,
    pub rotate: bool,
    pub use_tcp: bool,
}

pub(crate) fn load_file<I: Io>(io: &mut I, path: &[u8]) -> Result<Vec<u8>> {
    io.read_file(path).map_err(|error| match error {
        FileError::NotFound => Error::ENOTFOUND,
        FileError::Other => Error::EFILE,
    })
}

pub(crate) fn load_etc_file<I: Io>(io: &mut I, name: &str) -> Result<Vec<u8>> {
    let path = io.etc_path(name).ok_or(Error::ENOTFOUND)?;
    load_file(io, &path)
}

pub(crate) fn read<I: Io>(io: &mut I) -> Result<SysConfig> {
    let mut config = SysConfig {
        ndots: 1,
        ..SysConfig::default()
    };
    match io.settings() {
        Settings::Files => config.read_files(io)?,
        Settings::Windows(settings) => config.read_windows(io, settings),
        Settings::Mac(resolvers) => {
            for resolver in resolvers.ok_or(Error::ESERVFAIL)? {
                config.read_mac_resolver(io, &resolver);
            }
        }
        Settings::Android(properties) => {
            if properties.is_empty() {
                return Err(Error::EFILE);
            }
            for servers in properties {
                config.add_servers(io, &servers);
            }
        }
    }
    if let Some(domain) = io.env(Variable::LocalDomain) {
        config.set_search(&domain, Some(1));
    }
    if let Some(options) = io.env(Variable::ResOptions) {
        config.set_options(&options);
    }
    Ok(config)
}

/// The search list of a system that configures none.
pub(crate) fn domain_of_hostname<I: Io>(io: &mut I) -> Option<Vec<u8>> {
    let hostname = io.hostname()?;
    let (_, domain) = strings::split_once_char(&hostname, b'.')?;
    Some(domain.to_vec())
}

impl SysConfig {
    /// A file that is there and cannot be read is an error. One that is not there says nothing.
    fn read_files<I: Io>(&mut self, io: &mut I) -> Result<()> {
        type ParseLine<I> = fn(&mut SysConfig, &mut I, &[u8]);
        let files: [(&str, ParseLine<I>); 2] = [
            ("resolv.conf", SysConfig::parse_resolv_conf_line),
            ("nsswitch.conf", SysConfig::parse_nsswitch_line),
        ];
        for (name, parse_line) in files {
            match load_etc_file(io, name) {
                Ok(text) => {
                    for line in split(&text, b"\n", true, None) {
                        parse_line(self, io, line);
                    }
                }
                Err(Error::ENOTFOUND) => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    fn read_windows<I: Io>(&mut self, io: &mut I, settings: WindowsSettings) {
        // Windows routes packets by these metrics and does not order the servers by them.
        let mut servers: Vec<(u32, SocketAddr, u32)> = Vec::new();
        for server in settings.servers {
            let scope = match server.address.ip() {
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
            servers.push((metric, server.address, scope));
        }
        servers.sort_by_key(|(metric, ..)| *metric);
        let mut seen: Vec<(IpAddr, u16, u32)> = Vec::new();
        for (_, address, scope) in servers {
            let server = (address.ip(), address.port(), scope);
            if !seen.contains(&server) {
                seen.push(server);
                self.add_server(io, address.ip(), address.port(), Some(scope));
            }
        }

        let suffixes: Vec<&[u8]> = settings
            .suffixes
            .iter()
            .map(Vec::as_slice)
            .filter(|suffix| !suffix.is_empty() && all_print(suffix))
            .collect();
        if !suffixes.is_empty() {
            self.set_search(&suffixes.join(&b','), None);
        }
    }

    fn read_mac_resolver<I: Io>(&mut self, io: &mut I, resolver: &MacResolver) {
        /// `kSCNetworkFlagsReachable | kSCNetworkReachabilityFlagsConnectionOnTraffic`
        const CAN_BE_REACHED: u32 = 1 << 1 | 1 << 3;
        if resolver.for_one_domain
            || resolver.reach_flags & CAN_BE_REACHED == 0
            || resolver.nameservers.is_empty()
        {
            return;
        }
        for domain in &resolver.search {
            if !self
                .domains
                .iter()
                .any(|it| it.eq_ignore_ascii_case(domain))
            {
                self.domains.push(domain.clone());
            }
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

    fn set_search(&mut self, list: &[u8], max: Option<usize>) {
        self.domains.clear();
        for domain in split(list, b", ", false, None) {
            let is_new = !self
                .domains
                .iter()
                .any(|it| it.eq_ignore_ascii_case(domain));
            if is_new && all_print(domain) {
                self.domains.push(domain.to_vec());
            }
        }
        self.domains.truncate(max.unwrap_or(usize::MAX));
    }

    fn set_sources(&mut self, list: &[u8], delimiters: &[u8]) {
        let mut sources = Vec::new();
        for word in split(list, delimiters, true, None) {
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
            self.sources = Some(sources);
        }
    }

    fn set_option(&mut self, option: &[u8]) {
        let (key, value) = match split(option, b":", true, Some(2)).as_slice() {
            [key] => (*key, 0),
            [key, value] => match parse_uint(value, u32::MAX) {
                Some(value) => (*key, value),
                None => return,
            },
            _ => return,
        };
        match key {
            b"ndots" => self.ndots = value as usize,
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
        for option in split(options, b" \t", true, None) {
            self.set_option(option);
        }
    }

    fn add_servers<I: Io>(&mut self, io: &mut I, list: &[u8]) {
        for text in split(list, b" ,", false, None) {
            if let Some((address, port, interface)) = parse_server(text) {
                let interface = interface_index(io, interface);
                self.add_server(io, address, port, interface);
            }
        }
    }

    /// `interface` matters to a link-local address only, which is of no use without one.
    fn add_server<I: Io>(
        &mut self,
        io: &mut I,
        address: IpAddr,
        port: u16,
        interface: Option<u32>,
    ) {
        let mut scope_id = 0;
        if let IpAddr::V6(v6) = address {
            match v6.segments() {
                // Site-local, deprecated by RFC 3879. Windows and Android are known to list such servers; none exists.
                [0xfec0..=0xfeff, ..] => return,
                [0xfe80..=0xfebf, ..] => match interface.filter(|&index| io.has_interface(index)) {
                    Some(index) => scope_id = index,
                    None => return,
                },
                _ => {}
            }
        }
        self.servers.push(ServerConfig {
            address,
            udp_port: port,
            tcp_port: port,
            scope_id,
        });
    }

    fn parse_resolv_conf_line<I: Io>(&mut self, io: &mut I, line: &[u8]) {
        if let [b'#' | b';', ..] = line {
            return;
        }
        let (keyword, rest) = word(line);
        let rest = trim_start(rest);
        let value = match strings::index_of_any(rest, b"#;") {
            Some(comment) => rest.get(..comment).unwrap_or_default(),
            None => rest,
        };
        let (Some(keyword), Some(value)) = (fits(keyword, 32), fits(value, 512)) else {
            return;
        };
        let value = trim(value);
        if value.is_empty() {
            return;
        }
        match keyword {
            // Obsolete, so it yields to `search`.
            b"domain" if self.domains.is_empty() => self.set_search(value, Some(1)),
            b"lookup" | b"hostresorder" => self.set_sources(value, b" \t"),
            b"search" => self.set_search(value, None),
            b"nameserver" => self.add_servers(io, value),
            b"options" => self.set_options(value),
            _ => {}
        }
    }

    fn parse_nsswitch_line<I: Io>(&mut self, _: &mut I, line: &[u8]) {
        if let [b"hosts", sources] = split(line, b":", true, Some(2)).as_slice() {
            self.set_sources(sources, b" \t");
        }
    }
}

fn interface_index<I: Io>(io: &mut I, interface: &[u8]) -> Option<u32> {
    if interface.is_empty() {
        return None;
    }
    if interface.iter().all(u8::is_ascii_digit) {
        return parse_uint(interface, u32::MAX);
    }
    io.interface_index(interface)
}

/// `address`, `v4:port`, `[address]` or `[address]:port`, then `%interface` if any. No port is 0.
fn parse_server(text: &[u8]) -> Option<(IpAddr, u16, &[u8])> {
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
    let address = parse_ares(fits(address, 46).filter(|it| !it.is_empty())?)?;

    let mut port = 0;
    if let [b':', after @ ..] = rest {
        let (digits, after) = take_while(after, |byte| byte.is_ascii_digit());
        port = u16::try_from(parse_uint(fits(digits, 6)?, 65535)?).ok()?;
        rest = after;
    }
    let mut interface: &[u8] = &[];
    if let [b'%', after @ ..] = rest {
        let (name, after) = take_while(after, |byte| {
            byte.is_ascii_alphanumeric()
                || matches!(byte, b'.' | b'-' | b'_' | b'\\' | b':' | b'{' | b'}')
        });
        interface = fits(name, 64).filter(|it| !it.is_empty())?;
        rest = after;
    }
    trim_start(rest)
        .is_empty()
        .then_some((address, port, interface))
}

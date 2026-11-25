//! How the machine is set up to resolve names: resolv.conf(5) and what stands in for it.

use core::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV6};
use core::time::Duration;

use bun_core::ip_address::parse_strict;
use bun_core::{ZBox, strings};

use crate::system::{System, Transport, Variable};
use crate::{DEFAULT_PORT, name};

pub(crate) const WHITESPACE: &[u8] = b" \t\n\r\x0b\x0c";
const LIST_SEPARATORS: &[u8] = b", \t\n\r\x0b\x0c";
/// `RES_MAXRETRANS`
const MAX_TIMEOUT_SECONDS: u32 = 30;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Source {
    Dns,
    Hosts,
}

pub struct Config {
    pub(crate) servers: Vec<SocketAddr>,
    /// Or else the one in `servers` is a guess.
    pub(crate) names_a_server: bool,
    /// The root is empty.
    pub(crate) domains: Vec<Box<[u8]>>,
    /// Where to look for a host, in order.
    pub(crate) sources: &'static [Source],
    pub(crate) ndots: usize,
    /// `None`: it follows from how long the server takes.
    pub(crate) timeout: Option<Duration>,
    pub(crate) rotate: bool,
    /// For the first try.
    pub(crate) transport: Transport,
    pub hosts_path: ZBox,
}

fn parse_number<T: core::str::FromStr>(text: &[u8]) -> Option<T> {
    text.first().filter(|first| first.is_ascii_digit())?;
    bun_core::fmt::parse_ascii(text)
}

/// `address`, `ipv4:port`, `[address]` or `[address]:port`
fn parse_server(text: &[u8]) -> Option<(IpAddr, u16)> {
    if let Some(bracketed) = text.strip_prefix(b"[") {
        let (address, rest) = strings::split_once_char(bracketed, b']')?;
        let port = match rest {
            [] => 0,
            [b':', port @ ..] => parse_number(port)?,
            _ => return None,
        };
        return Some((parse_strict(address)?, port));
    }
    if let Some(ip) = parse_strict(text) {
        return Some((ip, 0));
    }
    let (address, port) = strings::split_once_char(text, b':')?;
    Some((parse_strict(address)?, parse_number(port)?))
}

pub(crate) fn before_any<'a>(text: &'a [u8], ends: &'static [u8]) -> &'a [u8] {
    strings::split_any(text, ends).next().unwrap_or_default()
}

pub(crate) fn lines(text: &[u8]) -> impl Iterator<Item = &[u8]> {
    strings::split_any(text, b"\n")
}

pub(crate) fn port_or_default(port: u16) -> u16 {
    if port == 0 { DEFAULT_PORT } else { port }
}

impl Config {
    pub(crate) fn load(system: &mut impl System) -> Self {
        let mut config = Self {
            servers: Vec::new(),
            names_a_server: true,
            domains: Vec::new(),
            sources: &[Source::Hosts, Source::Dns],
            ndots: 1,
            timeout: None,
            rotate: false,
            transport: Transport::Udp,
            hosts_path: ZBox::from_bytes(b"/etc/hosts"),
        };
        system.configure(&mut config);

        if let Some(domains) = system.variable(Variable::LocalDomain) {
            config.set_domains(domains, usize::MAX);
        }
        if let Some(options) = system.variable(Variable::ResOptions) {
            config.set_options(options);
        }
        if config.servers.is_empty() {
            config.names_a_server = false;
            config.add_server(Ipv4Addr::LOCALHOST.into(), DEFAULT_PORT, 0);
        }
        if config.domains.is_empty()
            && let Some(hostname) = system.hostname()
            && let Some((_, domain)) = strings::split_once_char(&hostname, b'.')
        {
            config.add_domains(domain);
        }
        config
    }

    pub fn read_files(&mut self, system: &impl System) {
        let read = |path: &[u8]| system.read_file(path).unwrap_or_default();
        for line in lines(&read(b"/etc/resolv.conf")) {
            self.read_resolv_conf_line(line, system);
        }
        for line in lines(&read(b"/etc/nsswitch.conf")) {
            if let Some((database, sources)) = strings::split_once_char(line, b':')
                && database.trim_ascii() == b"hosts"
            {
                self.set_sources(sources);
            }
        }
    }

    fn read_resolv_conf_line(&mut self, line: &[u8], system: &impl System) {
        let line = before_any(line, b"#;").trim_ascii_start();
        let keyword = before_any(line, WHITESPACE);
        let value = line.get(keyword.len()..).unwrap_or_default();
        match keyword {
            b"nameserver" => self.add_servers(value, system),
            b"search" => self.set_domains(value, usize::MAX),
            b"domain" if self.domains.is_empty() => self.set_domains(value, 1),
            b"options" => self.set_options(value),
            _ => {}
        }
    }

    /// `interface` is the index of the one that a link-local address is on, or 0. Port 0 is the default one.
    pub fn add_server(&mut self, ip: IpAddr, port: u16, interface: u32) {
        let port = port_or_default(port);
        let address = match (ip, interface) {
            // RFC 3879 deprecated fec0::/10, which Windows and Android still list.
            (IpAddr::V6(ip), _) if ip.segments()[0] & 0xffc0 == 0xfec0 => return,
            (IpAddr::V6(ip), 0) if ip.is_unicast_link_local() => return,
            (IpAddr::V6(ip), _) if ip.is_unicast_link_local() => {
                SocketAddrV6::new(ip, port, 0, interface).into()
            }
            _ => SocketAddr::new(ip, port),
        };
        self.servers.push(address);
    }

    /// As many as `list` has, each with an optional `%interface`.
    pub fn add_servers(&mut self, list: &[u8], system: &impl System) {
        for server in strings::tokenize_any(list, LIST_SEPARATORS) {
            let (server, interface) = match strings::split_once_char(server, b'%') {
                Some((server, interface)) => (server, Some(interface)),
                None => (server, None),
            };
            let Some((ip, port)) = parse_server(server) else {
                continue;
            };
            let interface =
                interface.and_then(|it| system.interface_index(it).or_else(|| parse_number(it)));
            self.add_server(ip, port, interface.unwrap_or(0));
        }
    }

    /// To the search list.
    pub fn add_domains(&mut self, list: &[u8]) {
        for domain in strings::tokenize_any(list, LIST_SEPARATORS) {
            let domain = domain.strip_prefix(b".").unwrap_or(domain);
            let is_listed = |listed: &[u8]| listed.eq_ignore_ascii_case(domain);
            if name::can_encode(domain) && !self.domains.iter().any(|listed| is_listed(listed)) {
                self.domains.push(domain.into());
            }
        }
    }

    fn set_domains(&mut self, list: &[u8], max: usize) {
        let old = core::mem::take(&mut self.domains);
        self.add_domains(list);
        self.domains.truncate(max);
        if self.domains.is_empty() {
            self.domains = old;
        }
    }

    fn set_sources(&mut self, list: &[u8]) {
        use Source::{Dns, Hosts};
        let mut sources = strings::tokenize_any(list, WHITESPACE).flat_map(|source| {
            match &*source.to_ascii_lowercase() {
                b"dns" => &[Dns][..],
                b"files" => &[Hosts],
                // nss-resolve(8)
                b"resolve" => &[Hosts, Dns],
                _ => &[],
            }
        });
        let Some(first) = sources.next() else {
            return;
        };
        self.sources = match (first, sources.any(|source| source != first)) {
            (Dns, false) => &[Dns],
            (Dns, true) => &[Dns, Hosts],
            (Hosts, false) => &[Hosts],
            (Hosts, true) => &[Hosts, Dns],
        };
    }

    /// What follows `options` in resolv.conf.
    pub fn set_options(&mut self, list: &[u8]) {
        for option in strings::tokenize_any(list, WHITESPACE) {
            let (key, value) = match strings::split_once_char(option, b':') {
                Some((key, value)) => (key, parse_number::<u32>(value)),
                None => (option, None),
            };
            match (key, value) {
                (b"ndots", Some(ndots)) => self.ndots = ndots as usize,
                (b"timeout" | b"retrans", Some(seconds @ 1..)) => {
                    let seconds = seconds.min(MAX_TIMEOUT_SECONDS);
                    self.timeout = Some(Duration::from_secs(seconds.into()));
                }
                (b"rotate", _) => self.rotate = true,
                (b"use-vc" | b"usevc", _) => self.transport = Transport::Tcp,
                _ => {}
            }
        }
    }
}

//! The system's resolver configuration: resolv.conf(5), nsswitch.conf(5) and the environment.

use core::net::IpAddr;

use bun_core::ip_address::parse_ares;
use bun_core::strings;

use crate::buf::all_print;
use crate::channel::ServerConfig;
use crate::io::{FileError, Io};
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

/// A file that is there and cannot be read is an error. One that is not there says nothing.
pub(crate) fn read<I: Io>(io: &mut I) -> Result<SysConfig> {
    let mut config = SysConfig {
        ndots: 1,
        ..SysConfig::default()
    };
    type ParseLine<I> = fn(&mut SysConfig, &mut I, &[u8]);
    let files: [(&[u8], ParseLine<I>); 2] = [
        (b"/etc/resolv.conf", SysConfig::parse_resolv_conf_line),
        (b"/etc/nsswitch.conf", SysConfig::parse_nsswitch_line),
    ];
    for (path, parse_line) in files {
        match load_file(io, path) {
            Ok(text) => {
                for line in split(&text, b"\n", true, None) {
                    parse_line(&mut config, io, line);
                }
            }
            Err(Error::ENOTFOUND) => {}
            Err(error) => return Err(error),
        }
    }
    if let Some(domain) = io.env("LOCALDOMAIN") {
        config.set_search(&domain, Some(1));
    }
    if let Some(options) = io.env("RES_OPTIONS") {
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
            let Some((address, port, interface)) = parse_server(text) else {
                continue;
            };
            let mut scope_id = 0;
            if let IpAddr::V6(v6) = address {
                match v6.segments() {
                    // Site-local, deprecated by RFC 3879. Windows and Android are known to list such servers; none exists.
                    [0xfec0..=0xfeff, ..] => continue,
                    [0xfe80..=0xfebf, ..] => match interface_index(io, interface) {
                        Some(index) => scope_id = index,
                        None => continue,
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
        return parse_uint(interface, u32::MAX).filter(|&index| io.has_interface(index));
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

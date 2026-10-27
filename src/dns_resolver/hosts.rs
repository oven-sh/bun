//! hosts(5), read whole and kept until the file changes.

use core::net::IpAddr;
use std::collections::{BTreeMap, btree_map};

use bun_core::ip_address::{format, parse_ares};

use crate::addrinfo::{AddrInfo, Family};
use crate::buf::is_hostname_byte;
use crate::channel::Channel;
use crate::io::Io;
use crate::lookup::Host;
use crate::sysconfig::load_file;
use crate::text::{fits, is_space, take_while, word};
use crate::{Error, Result};

/// Some block lists give one address hundreds of thousands of names.
const MAX_ALIASES: usize = 100;

/// Lines that share an address or a name are one entry.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Entry {
    addresses: Vec<IpAddr>,
    /// The first is the canonical name.
    hosts: Vec<Vec<u8>>,
}

#[derive(Debug, Default)]
pub(crate) struct HostsFile {
    /// Seconds since the epoch.
    read_at: i64,
    entries: Vec<Entry>,
    by_address: BTreeMap<IpAddr, usize>,
    /// In lower case.
    by_host: BTreeMap<Vec<u8>, usize>,
}

fn is_blank(byte: u8) -> bool {
    is_space(byte) && byte != b'\n'
}

fn parse_line(line: &[u8]) -> Option<Entry> {
    let (address, mut rest) = word(line);
    let address = parse_ares(fits(address, 46)?)?;
    let mut hosts: Vec<Vec<u8>> = Vec::new();
    loop {
        (_, rest) = take_while(rest, is_blank);
        let host;
        (host, rest) = word(rest);
        if matches!(host, [] | [b'#', ..]) {
            break;
        }
        let Some(host) = fits(host, 256) else {
            // Only the canonical name has to be a good one.
            if hosts.is_empty() {
                return None;
            }
            continue;
        };
        if host.iter().all(|&byte| is_hostname_byte(byte))
            && !host.eq_ignore_ascii_case(&format(address))
        {
            hosts.push(host.to_vec());
        }
    }
    (!hosts.is_empty()).then(|| Entry {
        addresses: vec![address],
        hosts,
    })
}

impl HostsFile {
    pub(crate) fn parse(text: &[u8], read_at: i64) -> HostsFile {
        let mut file = HostsFile {
            read_at,
            ..HostsFile::default()
        };
        for line in bun_core::strings::split(text, b"\n") {
            let (_, line) = take_while(line, is_blank);
            if !matches!(line, [] | [b'#', ..])
                && let Some(entry) = parse_line(line)
            {
                file.add(entry);
            }
        }
        file
    }

    fn add(&mut self, line: Entry) {
        let same_address = line
            .addresses
            .iter()
            .find_map(|address| self.by_address.get(address));
        let same_host = || {
            line.hosts
                .iter()
                .find_map(|host| self.by_host.get(&host.to_ascii_lowercase()))
        };
        let index = match same_address.or_else(same_host) {
            Some(index) => *index,
            None => {
                self.entries.push(Entry {
                    addresses: Vec::new(),
                    hosts: Vec::new(),
                });
                self.entries.len() - 1
            }
        };
        let Some(entry) = self.entries.get_mut(index) else {
            return;
        };
        for address in line.addresses {
            if let btree_map::Entry::Vacant(vacant) = self.by_address.entry(address) {
                vacant.insert(index);
                entry.addresses.push(address);
            }
        }
        // A name belongs to the entry that had it first.
        for host in line.hosts {
            let key = host.to_ascii_lowercase();
            if !self.by_host.contains_key(&key) {
                entry.hosts.push(host);
            }
        }
        for host in &entry.hosts {
            self.by_host
                .entry(host.to_ascii_lowercase())
                .or_insert(index);
        }
    }

    pub(crate) fn by_host(&self, host: &[u8]) -> Option<&Entry> {
        self.entries
            .get(*self.by_host.get(&host.to_ascii_lowercase())?)
    }

    pub(crate) fn by_address(&self, address: IpAddr) -> Option<&Entry> {
        self.entries.get(*self.by_address.get(&address)?)
    }
}

impl Entry {
    pub(crate) fn add_to(
        &self,
        info: &mut AddrInfo,
        name: &[u8],
        family: Family,
        port: u16,
    ) -> Result<()> {
        let of_family = |address: &&IpAddr| family.includes(Family::of(address));
        if !self.addresses.iter().any(|address| of_family(&address)) {
            info.name = None;
            return Err(Error::ENOTFOUND);
        }
        info.name = Some(name.to_vec());
        for address in self.addresses.iter().filter(of_family) {
            info.push(*address, port, 0);
        }
        Ok(())
    }

    pub(crate) fn to_host(&self) -> Option<Host> {
        let (name, aliases) = self.hosts.split_first()?;
        Some(Host {
            name: name.clone(),
            aliases: aliases.iter().take(MAX_ALIASES).cloned().collect(),
        })
    }
}

impl<I: Io, T> Channel<I, T> {
    pub(crate) fn hosts_file(&mut self) -> Result<&HostsFile> {
        let path = self.io.etc_path("hosts").ok_or(Error::ENOTFOUND)?;
        // Without a time to go by, a minute.
        let modified_at = match self.io.modified_time(&path) {
            Some(time) if time != 0 => time,
            _ => self.io.unix_time() - 60,
        };
        if self
            .hosts
            .as_ref()
            .is_none_or(|file| file.read_at <= modified_at)
        {
            self.hosts = None;
            let text = load_file(&mut self.io, &path)?;
            self.hosts = Some(HostsFile::parse(&text, self.io.unix_time()));
        }
        self.hosts.as_ref().ok_or(Error::ENOTFOUND)
    }
}

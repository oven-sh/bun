//! hosts(5), read whole and kept until the file changes.

use core::net::IpAddr;
use std::collections::BTreeMap;

use bun_core::ip_address::parse_ares;
use bun_core::strings;

use crate::channel::Channel;
use crate::io::FileIdentity;
use crate::lookup::Host;
use crate::system_config::load_file;
use crate::text::{ADDRESS_SIZE, HOST_NAME_SIZE, is_hostname, printable_within, trim_start, word};
use crate::{Error, Result};

/// Some block lists give one address hundreds of thousands of names.
const MAX_ALIASES: usize = 100;

#[derive(Default)]
pub(crate) struct HostsFile {
    /// Seconds since the epoch.
    read_at: i64,
    /// What the file was just before it was read.
    identity: Option<FileIdentity>,
    /// By name in lower case. The addresses are in the order of the file.
    addresses: BTreeMap<Vec<u8>, Vec<IpAddr>>,
    /// The names are in the order of the file, so the first is the canonical one.
    names: BTreeMap<IpAddr, Vec<Vec<u8>>>,
}

fn parse_line(line: &[u8]) -> Option<(IpAddr, Vec<&[u8]>)> {
    let (address, mut rest) = word(line);
    let address = parse_ares(printable_within(address, ADDRESS_SIZE)?)?;
    let mut names = Vec::new();
    loop {
        let name;
        (name, rest) = word(trim_start(rest));
        if matches!(name, [] | [b'#', ..]) {
            break;
        }
        let Some(name) = printable_within(name, HOST_NAME_SIZE) else {
            // Only the canonical name has to be a good one.
            if names.is_empty() {
                return None;
            }
            continue;
        };
        if is_hostname(name) {
            names.push(name);
        }
    }
    Some((address, names))
}

impl HostsFile {
    fn parse(text: &[u8]) -> HostsFile {
        let mut file = HostsFile::default();
        for line in strings::split(text, b"\n") {
            let line = trim_start(line);
            if matches!(line, [] | [b'#', ..]) {
                continue;
            }
            let Some((address, names)) = parse_line(line) else {
                continue;
            };
            for name in names {
                let addresses = file.addresses.entry(name.to_ascii_lowercase()).or_default();
                if !addresses.contains(&address) {
                    addresses.push(address);
                    file.names.entry(address).or_default().push(name.to_vec());
                }
            }
        }
        file
    }

    /// The addresses the file gives `name` itself, not those of other names that share one of them.
    pub(crate) fn addresses_of(&self, name: &[u8]) -> &[IpAddr] {
        self.addresses
            .get(&name.to_ascii_lowercase())
            .map_or(&[], Vec::as_slice)
    }

    pub(crate) fn host_at(&self, address: IpAddr) -> Option<Host> {
        let (name, aliases) = self.names.get(&address)?.split_first()?;
        Some(Host {
            name: name.clone(),
            aliases: aliases.iter().take(MAX_ALIASES).cloned().collect(),
        })
    }
}

impl Channel {
    pub(crate) fn hosts_file(&mut self) -> Result<&HostsFile> {
        let path = self.io.etc_path("hosts").ok_or(Error::ENOTFOUND)?;
        let identity = self.io.file_identity(&path);
        // A file that cannot be stat'ed is read again after a minute.
        let modified_at = identity.map_or_else(|| self.io.unix_time() - 60, |it| it.modified_at);
        if self.hosts.as_ref().is_none_or(|file| {
            (identity.is_some() && file.identity != identity) || file.read_at <= modified_at
        }) {
            self.hosts = None;
            let text = load_file(&mut *self.io, &path)?;
            self.hosts = Some(HostsFile {
                read_at: self.io.unix_time(),
                identity,
                ..HostsFile::parse(&text)
            });
        }
        self.hosts.as_ref().ok_or(Error::ENOTFOUND)
    }
}

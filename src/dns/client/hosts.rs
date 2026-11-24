//! hosts(5)

use core::net::IpAddr;

use bun_core::{ZStr, ip_address, strings};
use smallvec::SmallVec;

use crate::config::{WHITESPACE, before_any, lines};
use crate::system::{FileStamp, System};
use crate::{HashMap, name};

/// Block lists give one address thousands of names.
const MAX_ALIASES: usize = 100;
const USUAL_LINE_LEN: usize = 32;

#[derive(Default)]
pub(crate) struct Table {
    /// By name in lower case.
    addresses: HashMap<Box<[u8]>, SmallVec<[IpAddr; 1]>>,
    names: HashMap<IpAddr, Vec<Box<[u8]>>>,
}

impl Table {
    fn parse(text: &[u8]) -> Self {
        let mut table = Self::default();
        table.addresses.reserve(text.len() / USUAL_LINE_LEN);
        for line in lines(text) {
            let mut fields = strings::tokenize_any(before_any(line, b"#"), WHITESPACE);
            let Some(ip) = fields.next().and_then(ip_address::parse_strict) else {
                continue;
            };
            for host in fields.filter(|it| it.len() <= name::MAX_LEN && name::is_hostname(it)) {
                table.add(ip, host);
            }
        }
        table
    }

    fn add(&mut self, ip: IpAddr, host: &[u8]) {
        let key = host.to_ascii_lowercase().into_boxed_slice();
        let addresses = self.addresses.entry(key).or_default();
        let names = self.names.entry(ip).or_default();
        if names.len() > MAX_ALIASES {
            if !addresses.contains(&ip) {
                addresses.push(ip);
            }
        } else if !names.iter().any(|name| name.eq_ignore_ascii_case(host)) {
            addresses.push(ip);
            names.push(host.into());
        }
    }

    pub(crate) fn addresses(&self, host: &[u8]) -> &[IpAddr] {
        let mut key = [0; name::MAX_LEN];
        let Some(key) = key.get_mut(..host.len()) else {
            return &[];
        };
        key.copy_from_slice(host);
        key.make_ascii_lowercase();
        self.addresses.get(&*key).map_or(&[], SmallVec::as_slice)
    }

    /// The canonical name, then the aliases.
    pub(crate) fn names(&self, ip: IpAddr) -> &[Box<[u8]>] {
        self.names.get(&ip).map_or(&[], Vec::as_slice)
    }
}

#[derive(Default)]
pub(crate) struct Hosts {
    table: Table,
    /// Of the file that is in `table`, if a change to it is sure to show.
    stamp: Option<FileStamp>,
}

impl Hosts {
    pub(crate) fn current(&mut self, path: &ZStr, system: &impl System) -> &Table {
        // It may be there all the same. It counts as changed once a minute then.
        let stamp = system.stamp(path).unwrap_or_else(|| FileStamp {
            modified: system.wall_clock() / 60,
            ..FileStamp::default()
        });
        if Some(stamp) != self.stamp {
            let now = system.wall_clock();
            let text = system.read_file(path);
            // It can change again within the second.
            self.stamp = (stamp.modified != now && text.is_some()).then_some(stamp);
            self.table = Table::parse(&text.unwrap_or_default());
        }
        &self.table
    }
}

//! `getaddrinfo()`: the addresses of a host, from the hosts file and from the servers by way of the search list.

use core::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use bun_core::ip_address::{parse_ares_v4, parse_ares_v6};
use bun_core::strings;

use super::sort::sort_addresses;
use super::{is_localhost, is_onion_domain};
use crate::addr_info::{AddrInfo, Family};
use crate::channel::{Answer, Channel, LookupId, Owner, Serial, Token};
use crate::io::Time;
use crate::message::{Message, rr_type};
use crate::system_config::Source;
use crate::{Error, Result};

pub(crate) struct AddrInfoLookup {
    token: Token,
    name: Vec<u8>,
    port: u16,
    family: Family,
    next_source: usize,
    names: Vec<Vec<u8>>,
    next_name: usize,
    found: AddrInfo,
    aaaa_query: Option<Serial>,
    /// Queries not answered yet.
    remaining: usize,
    /// Some name exists, without addresses of the family. That is worth more to the caller than the last name not existing.
    saw_no_data: bool,
}

/// The address `name` spells, if it does.
fn literal_address(name: &[u8], family: Family) -> Option<IpAddr> {
    // `parse_ares_v4` would take fewer than four numbers.
    let looks_like_v4 = name
        .iter()
        .all(|&byte| byte.is_ascii_digit() || byte == b'.')
        && strings::count_char(name, b'.') == 3;
    if looks_like_v4 && let Some(address) = parse_ares_v4(name) {
        return Some(address.into());
    }
    if family == Family::V4 {
        return None;
    }
    parse_ares_v6(name).map(Into::into)
}

impl Channel {
    /// `dns.lookup()`.
    pub fn lookup(&mut self, now: Time, name: &[u8], port: u16, family: Family, token: Token) {
        if is_onion_domain(name) {
            return self.complete(token, Err(Error::ENOTFOUND));
        }
        let mut found = AddrInfo::default();
        if let Some(address) = literal_address(name, family) {
            found.push(address, port, 0);
            return self.complete(token, Ok(Answer::AddrInfo(found)));
        }
        let names = match self.search_names(name) {
            Ok(names) => names,
            Err(error) => return self.complete(token, Err(error)),
        };
        let id = self.new_lookup_id();
        self.addr_info_lookups.insert(
            id,
            AddrInfoLookup {
                token,
                name: name.to_vec(),
                port,
                family,
                next_source: 0,
                names,
                next_name: 0,
                found,
                aaaa_query: None,
                remaining: 0,
                saw_no_data: false,
            },
        );
        // What c-ares reports if there is no source to try.
        self.addr_info_lookup_next(now, id, Error::ECONNREFUSED);
    }

    fn end_addr_info_lookup(&mut self, id: LookupId, status: Result<()>) {
        let Some(mut lookup) = self.addr_info_lookups.remove(&id) else {
            return;
        };
        let result = status.map(|()| {
            sort_addresses(&mut *self.io, &mut lookup.found.nodes);
            Answer::AddrInfo(lookup.found)
        });
        self.complete(lookup.token, result);
    }

    /// Goes on to the next name or source. `error` is the outcome if there is none.
    fn addr_info_lookup_next(&mut self, now: Time, id: LookupId, error: Error) {
        loop {
            let Some(lookup) = self.addr_info_lookups.get(&id) else {
                return;
            };
            match self.sources.get(lookup.next_source) {
                // RFC 6761 section 6.3: the servers are not to be asked about localhost.
                Some(Source::Dns) => {
                    if !is_localhost(&lookup.name) && self.addr_info_ask_servers(now, id) {
                        return;
                    }
                }
                Some(Source::Files) => {
                    if self.addr_info_from_files(id) {
                        return self.end_addr_info_lookup(id, Ok(()));
                    }
                }
                None => return self.end_addr_info_lookup(id, Err(error)),
            }
            if let Some(lookup) = self.addr_info_lookups.get_mut(&id) {
                lookup.next_source += 1;
            }
        }
    }

    /// Whether the hosts file has addresses of the family for the name.
    fn addr_info_from_files(&mut self, id: LookupId) -> bool {
        let Some(mut lookup) = self.addr_info_lookups.remove(&id) else {
            return false;
        };
        if let Ok(file) = self.hosts_file() {
            for address in file.addresses_of(&lookup.name) {
                if lookup.family.includes(Family::of(address)) {
                    lookup.found.push(*address, lookup.port, 0);
                }
            }
        }
        // RFC 6761 section 6.3: localhost is the loopback address, whatever the file says or leaves out.
        if is_localhost(&lookup.name) {
            let listed = self.io.loopback_addresses();
            if listed.is_some() {
                lookup.found.nodes.clear();
            }
            let defaults = [Ipv6Addr::LOCALHOST.into(), Ipv4Addr::LOCALHOST.into()];
            for address in listed.into_iter().flatten().chain(defaults) {
                let family = Family::of(&address);
                if lookup.family.includes(family) && !lookup.found.has_family(family) {
                    lookup.found.push(address, lookup.port, 0);
                }
            }
        }
        let found = !lookup.found.nodes.is_empty();
        if found {
            lookup.found.name = Some(lookup.name.clone());
        }
        self.addr_info_lookups.insert(id, lookup);
        found
    }

    /// False if the search list is used up.
    fn addr_info_ask_servers(&mut self, now: Time, id: LookupId) -> bool {
        let Some(lookup) = self.addr_info_lookups.get_mut(&id) else {
            return false;
        };
        let Some(name) = lookup.names.get(lookup.next_name).cloned() else {
            return false;
        };
        lookup.next_name += 1;
        lookup.aaaa_query = None;
        let qtypes: &[u16] = match lookup.family {
            Family::V4 => &[rr_type::A],
            Family::V6 => &[rr_type::AAAA],
            Family::Unspecified => &[rr_type::A, rr_type::AAAA],
        };
        lookup.remaining += qtypes.len();
        for &qtype in qtypes {
            let sent = self.ask(now, &name, qtype, Owner::AddrInfo { lookup: id });
            // `None`: an answer from the cache has moved the lookup on to its next name by now, with queries of its own.
            if qtype == rr_type::AAAA
                && sent.is_some()
                && let Some(lookup) = self.addr_info_lookups.get_mut(&id)
            {
                lookup.aaaa_query = sent;
            }
        }
        true
    }

    pub(crate) fn addr_info_lookup_answered(
        &mut self,
        now: Time,
        id: LookupId,
        result: Result<&Message>,
    ) {
        let Some(lookup) = self.addr_info_lookups.get_mut(&id) else {
            return;
        };
        lookup.remaining = lookup.remaining.saturating_sub(1);
        let status = result.map(|_| ());
        let added = match result {
            Ok(response) => lookup.found.add_response(response, true, lookup.port),
            Err(_) => Ok(()),
        };
        if lookup.remaining > 0 {
            // With an IPv4 address in hand, the AAAA query gets no more tries. Not the other way
            // around: hosts that cannot use IPv6 get AAAA answers too.
            if result.is_ok()
                && added.is_ok()
                && lookup.found.has_family(Family::V4)
                && let Some(serial) = lookup.aaaa_query
            {
                self.stop_retrying(serial);
            }
            return;
        }

        let has_addresses = !lookup.found.nodes.is_empty();
        let last_name_has_one_label = lookup
            .next_name
            .checked_sub(1)
            .and_then(|last| lookup.names.get(last))
            .is_some_and(|name| !strings::contains_char(name, b'.'));
        match (status, added) {
            (Err(error @ (Error::EDESTRUCTION | Error::ECANCELLED)), _) => {
                self.end_addr_info_lookup(id, Err(error));
            }
            (_, Err(Error::EBADRESP)) if has_addresses => self.end_addr_info_lookup(id, Ok(())),
            (_, Err(error)) if error != Error::ENODATA => self.end_addr_info_lookup(id, Err(error)),
            _ if has_addresses => self.end_addr_info_lookup(id, Ok(())),
            (Err(Error::ENOTFOUND | Error::ENODATA), _) | (_, Err(Error::ENODATA)) => {
                lookup.saw_no_data |= status != Err(Error::ENOTFOUND);
                let error = if lookup.saw_no_data {
                    Error::ENODATA
                } else {
                    Error::ENOTFOUND
                };
                self.addr_info_lookup_next(now, id, error);
            }
            // systemd-resolved answers so for a name of one label.
            (Err(error @ (Error::ESERVFAIL | Error::EREFUSED)), _) if last_name_has_one_label => {
                let error = if lookup.saw_no_data {
                    Error::ENODATA
                } else {
                    error
                };
                self.addr_info_lookup_next(now, id, error);
            }
            _ => self.end_addr_info_lookup(id, status),
        }
    }
}

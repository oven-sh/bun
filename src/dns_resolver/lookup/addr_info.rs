//! `getaddrinfo()`: the addresses of a host, from the hosts file and from the servers by way of the search list.

use core::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use bun_core::ip_address::{parse_ares_v4, parse_ares_v6};
use bun_core::strings;

use super::sort::sort_addresses;
use super::{is_localhost, is_onion_domain};
use crate::addrinfo::{AddrInfo, Family};
use crate::channel::{Answer, Channel, LookupId, Owner, Serial, Status};
use crate::io::{Io, Time};
use crate::record::{Record, rr_type};
use crate::sysconfig::Source;
use crate::{Error, Result};

pub(crate) struct AddrInfoLookup<T> {
    token: T,
    name: Vec<u8>,
    port: u16,
    family: Family,
    sources: Vec<Source>,
    next_source: usize,
    names: Vec<Vec<u8>>,
    next_name: usize,
    found: AddrInfo,
    a_query: Option<Serial>,
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

impl<I: Io, T> Channel<I, T> {
    pub fn addr_info(&mut self, now: Time, name: &[u8], port: u16, family: Family, token: T) {
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
        self.next_lookup_id += 1;
        let id = self.next_lookup_id;
        self.addr_info_lookups.insert(
            id,
            AddrInfoLookup {
                token,
                name: name.to_vec(),
                port,
                family,
                sources: self.sources.clone(),
                next_source: 0,
                names,
                next_name: 0,
                found,
                a_query: None,
                aaaa_query: None,
                remaining: 0,
                saw_no_data: false,
            },
        );
        self.addr_info_next(now, id, Error::ECONNREFUSED);
    }

    fn end_addr_info(&mut self, id: LookupId, status: Status) {
        let Some(mut lookup) = self.addr_info_lookups.remove(&id) else {
            return;
        };
        let result = status.map(|()| {
            sort_addresses(&mut self.io, &mut lookup.found.nodes);
            Answer::AddrInfo(lookup.found)
        });
        self.complete(lookup.token, result);
    }

    /// Goes on to the next name or source. `error` is the outcome if there is none.
    fn addr_info_next(&mut self, now: Time, id: LookupId, error: Error) {
        loop {
            let Some(lookup) = self.addr_info_lookups.get(&id) else {
                return;
            };
            match lookup.sources.get(lookup.next_source) {
                // RFC 6761 section 6.3: the servers are not to be asked about localhost.
                Some(Source::Dns) => {
                    if !is_localhost(&lookup.name) && self.addr_info_ask_servers(now, id) {
                        return;
                    }
                }
                Some(Source::Files) => {
                    if self.addr_info_from_files(id).is_ok() {
                        return self.end_addr_info(id, Ok(()));
                    }
                }
                None => return self.end_addr_info(id, Err(error)),
            }
            if let Some(lookup) = self.addr_info_lookups.get_mut(&id) {
                lookup.next_source += 1;
            }
        }
    }

    fn addr_info_from_files(&mut self, id: LookupId) -> Result<()> {
        let mut lookup = self.addr_info_lookups.remove(&id).ok_or(Error::ENOTFOUND)?;
        let mut status = self.hosts_file().and_then(|file| {
            file.by_host(&lookup.name).ok_or(Error::ENOTFOUND)?.add_to(
                &mut lookup.found,
                &lookup.name,
                lookup.family,
                lookup.port,
            )
        });
        // RFC 6761 section 6.3: localhost is the loopback address, whatever the file says or leaves out.
        if is_localhost(&lookup.name) {
            lookup.found.name = Some(lookup.name.clone());
            if let Some(addresses) = self.io.loopback_addresses() {
                lookup.found.nodes.clear();
                for address in addresses {
                    let family = Family::of(&address);
                    if lookup.family.includes(family) && !lookup.found.has_family(family) {
                        lookup.found.push(address, lookup.port, 0);
                    }
                }
            }
            for address in [Ipv6Addr::LOCALHOST.into(), Ipv4Addr::LOCALHOST.into()] {
                let family = Family::of(&address);
                if lookup.family.includes(family) && !lookup.found.has_family(family) {
                    lookup.found.push(address, lookup.port, 0);
                }
            }
            status = Ok(());
        }
        self.addr_info_lookups.insert(id, lookup);
        status
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
        lookup.a_query = None;
        lookup.aaaa_query = None;
        let families: &[Family] = match lookup.family {
            Family::V4 => &[Family::V4],
            Family::V6 => &[Family::V6],
            Family::Unspecified => &[Family::V4, Family::V6],
        };
        lookup.remaining += families.len();
        for &family in families {
            let qtype = match family {
                Family::V6 => rr_type::AAAA,
                _ => rr_type::A,
            };
            let owner = Owner::AddrInfo { lookup: id, family };
            let serial = self.send_question(now, &name, qtype, owner);
            if let Some(lookup) = self.addr_info_lookups.get_mut(&id) {
                match family {
                    Family::V6 => lookup.aaaa_query = serial,
                    _ => lookup.a_query = serial,
                }
            }
        }
        true
    }

    pub(crate) fn addr_info_answered(
        &mut self,
        now: Time,
        id: LookupId,
        family: Family,
        status: Status,
        answer: Option<&Record>,
    ) {
        let Some(lookup) = self.addr_info_lookups.get_mut(&id) else {
            return;
        };
        lookup.remaining = lookup.remaining.saturating_sub(1);
        let mut added = Ok(());
        if status.is_ok() {
            added = match answer {
                Some(answer) => lookup.found.add_answer(answer, true, lookup.port),
                None => Err(Error::EBADRESP),
            };
            // With an IPv4 address in hand, the AAAA query gets no more tries. Not the other way around: hosts that cannot use IPv6 get AAAA answers too.
            if added.is_ok() && lookup.found.has_family(Family::V4) {
                let other = match family {
                    Family::V6 => lookup.a_query,
                    _ => lookup.aaaa_query,
                };
                if let Some(query) = other.and_then(|serial| self.queries.get_mut(&serial)) {
                    query.no_retries = true;
                }
            }
        }
        if lookup.remaining > 0 {
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
                self.end_addr_info(id, Err(error));
            }
            (_, Err(Error::EBADRESP)) if has_addresses => self.end_addr_info(id, Ok(())),
            (_, Err(error)) if error != Error::ENODATA => self.end_addr_info(id, Err(error)),
            _ if has_addresses => self.end_addr_info(id, Ok(())),
            (Err(Error::ENOTFOUND | Error::ENODATA), _) | (_, Err(Error::ENODATA)) => {
                lookup.saw_no_data |= status != Err(Error::ENOTFOUND);
                let error = match lookup.saw_no_data {
                    true => Error::ENODATA,
                    false => Error::ENOTFOUND,
                };
                self.addr_info_next(now, id, error);
            }
            // systemd-resolved answers so for a name of one label.
            (Err(error @ (Error::ESERVFAIL | Error::EREFUSED)), _) if last_name_has_one_label => {
                let error = match lookup.saw_no_data {
                    true => Error::ENODATA,
                    false => error,
                };
                self.addr_info_next(now, id, error);
            }
            _ => self.end_addr_info(id, status),
        }
    }
}

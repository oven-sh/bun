//! Addresses and aliases collected from answers and the hosts file.

use core::net::IpAddr;

use crate::record::{Name, RData, Record, class};
use crate::{Error, Result};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Family {
    Unspecified,
    V4,
    V6,
}

impl Family {
    pub(crate) fn of(address: &IpAddr) -> Family {
        match address {
            IpAddr::V4(_) => Family::V4,
            IpAddr::V6(_) => Family::V6,
        }
    }

    pub(crate) fn includes(self, other: Family) -> bool {
        self == Family::Unspecified || self == other
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Alias {
    pub ttl: i32,
    pub alias: Name,
    pub name: Name,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Node {
    pub ttl: i32,
    pub address: IpAddr,
    pub port: u16,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AddrInfo {
    pub name: Option<Name>,
    pub aliases: Vec<Alias>,
    pub nodes: Vec<Node>,
}

pub(crate) fn ttl_as_int(ttl: u32) -> i32 {
    i32::try_from(ttl).unwrap_or(i32::MAX)
}

impl AddrInfo {
    pub(crate) fn has_family(&self, family: Family) -> bool {
        self.nodes
            .iter()
            .any(|node| Family::of(&node.address) == family)
    }

    pub(crate) fn push(&mut self, address: IpAddr, port: u16, ttl: u32) {
        self.nodes.push(Node {
            ttl: ttl_as_int(ttl),
            address,
            port,
        });
    }

    /// Adds the A, AAAA and CNAME records of `record`'s answer.
    pub(crate) fn add_answer(
        &mut self,
        record: &Record,
        cname_alone_is_no_data: bool,
        port: u16,
    ) -> Result<()> {
        let mut hostname = record.question.first().map(|question| &question.name);
        let mut found = AddrInfo::default();

        for rr in &record.answer {
            if rr.class != class::IN {
                continue;
            }
            match &rr.data {
                RData::Cname(target) => {
                    hostname = Some(target);
                    found.aliases.push(Alias {
                        ttl: ttl_as_int(rr.ttl),
                        alias: rr.name.clone(),
                        name: target.clone(),
                    });
                }
                RData::A(address) => found.push(IpAddr::from(*address), port, rr.ttl),
                RData::Aaaa(address) => found.push(IpAddr::from(*address), port, rr.ttl),
                _ => {}
            }
        }
        if found.nodes.is_empty() && (found.aliases.is_empty() || cname_alone_is_no_data) {
            return Err(Error::ENODATA);
        }

        let hostname = hostname.ok_or(Error::EBADRESP)?;
        let is_same_name = self
            .name
            .as_ref()
            .is_some_and(|name| name.eq_ignore_ascii_case(hostname));
        if !is_same_name {
            self.name = Some(hostname.clone());
        }
        self.nodes.append(&mut found.nodes);
        self.aliases.append(&mut found.aliases);
        Ok(())
    }
}

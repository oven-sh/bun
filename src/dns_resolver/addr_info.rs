//! Addresses and aliases collected from answers and the hosts file.

use core::net::IpAddr;

use crate::message::{Message, Name, RData, class, rr_type};
use crate::{Error, Result};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
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

/// A CNAME record.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Alias {
    pub(crate) ttl: i32,
    pub(crate) owner: Name,
    pub(crate) target: Name,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Node {
    pub ttl: i32,
    pub address: IpAddr,
    pub port: u16,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AddrInfo {
    pub(crate) name: Option<Name>,
    pub(crate) aliases: Vec<Alias>,
    pub nodes: Vec<Node>,
}

fn ttl_as_int(ttl: u32) -> i32 {
    i32::try_from(ttl).unwrap_or(i32::MAX)
}

/// What to make of a response with CNAME records and no address.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum AliasesAlone {
    AreAnAnswer,
    AreNoData,
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

    /// Adds the CNAME records of `response`'s answer section, and the addresses of the type that
    /// its question asks for.
    pub(crate) fn add_response(
        &mut self,
        response: &Message,
        aliases_alone: AliasesAlone,
        port: u16,
    ) -> Result<()> {
        let qtype = response.question.qtype;
        let is_asked_for = |rr_type| qtype == rr_type || qtype == rr_type::ANY;
        let mut hostname = &response.question.name;
        let mut found = AddrInfo::default();

        for rr in &response.answer {
            if rr.class != class::IN {
                continue;
            }
            match &rr.data {
                RData::Cname(target) => {
                    hostname = target;
                    found.aliases.push(Alias {
                        ttl: ttl_as_int(rr.ttl),
                        owner: rr.name.clone(),
                        target: target.clone(),
                    });
                }
                RData::A(address) if is_asked_for(rr_type::A) => {
                    found.push(IpAddr::from(*address), port, rr.ttl);
                }
                RData::Aaaa(address) if is_asked_for(rr_type::AAAA) => {
                    found.push(IpAddr::from(*address), port, rr.ttl);
                }
                _ => {}
            }
        }
        if found.nodes.is_empty()
            && (found.aliases.is_empty() || aliases_alone == AliasesAlone::AreNoData)
        {
            return Err(Error::ENODATA);
        }

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

//! Answers kept until their TTL runs out.

use std::collections::{BTreeMap, BTreeSet};

use crate::Result;
use crate::io::Time;
use crate::message::{Message, RData, flag, rcode};

/// c-ares's default for `ARES_OPT_QUERY_CACHE`.
const MAX_TTL: u32 = 3600;

struct Entry {
    response: Message,
    inserted_at: i64,
    expires_at: i64,
}

#[derive(Default)]
pub(super) struct QueryCache {
    entries: BTreeMap<Vec<u8>, Entry>,
    expiry: BTreeSet<(i64, Vec<u8>)>,
}

/// What two queries have to share for one's answer to be the other's. Names that differ only in
/// case are one.
pub(super) fn key_of(query: &Message) -> Vec<u8> {
    let question = &query.question;
    let mut key = Vec::new();
    key.extend_from_slice(&question.qtype.to_be_bytes());
    key.extend_from_slice(&question.qclass.to_be_bytes());
    // A dot at the end says not to search. It is not part of the name.
    let name = question.name.strip_suffix(b".").unwrap_or(&question.name);
    key.extend(name.iter().map(u8::to_ascii_lowercase));
    key
}

fn lowest_ttl(response: &Message) -> u32 {
    response
        .sections()
        .into_iter()
        .flatten()
        // The TTL of these means something else.
        .filter(|rr| !matches!(rr.data, RData::Opt { .. } | RData::Soa(_) | RData::Sig(_)))
        .map(|rr| rr.ttl)
        .min()
        .unwrap_or(u32::MAX)
}

/// RFC 2308 section 5.
fn negative_ttl(response: &Message) -> u32 {
    response
        .authority
        .iter()
        .find_map(|rr| match &rr.data {
            RData::Soa(soa) => Some(rr.ttl.min(soa.minimum)),
            _ => None,
        })
        .unwrap_or(0)
}

impl QueryCache {
    pub(super) fn flush(&mut self) {
        self.entries.clear();
        self.expiry.clear();
    }

    fn expire(&mut self, now: Time) {
        while let Some(first) = self.expiry.first() {
            if first.0 > now.sec {
                break;
            }
            if let Some((_, key)) = self.expiry.pop_first() {
                self.entries.remove(&key);
            }
        }
    }

    pub(super) fn fetch(&mut self, now: Time, key: &[u8]) -> Option<Message> {
        self.expire(now);
        let entry = self.entries.get(key)?;
        let age = u32::try_from(now.sec - entry.inserted_at).unwrap_or(u32::MAX);
        entry.response.rewritten(age).ok()
    }

    /// Keeps `response` if it is one to keep. `Err`: it cannot be written, so it could not be
    /// handed out again.
    pub(super) fn insert(&mut self, now: Time, key: &[u8], response: &Message) -> Result<()> {
        let response = response.rewritten(0)?;
        let ttl = match response.rcode {
            _ if response.flags & flag::TC != 0 => return Ok(()),
            rcode::NOERROR if !response.answer.is_empty() => lowest_ttl(&response),
            // RFC 2308 section 5 treats NODATA as NXDOMAIN. c-ares does not, and keeps it for
            // `MAX_TTL`.
            rcode::NOERROR | rcode::NXDOMAIN => negative_ttl(&response),
            _ => return Ok(()),
        }
        .min(MAX_TTL);
        if ttl == 0 {
            return Ok(());
        }
        let expires_at = now.sec + i64::from(ttl);
        let entry = Entry {
            response,
            inserted_at: now.sec,
            expires_at,
        };
        if let Some(replaced) = self.entries.insert(key.to_vec(), entry) {
            self.expiry.remove(&(replaced.expires_at, key.to_vec()));
        }
        self.expiry.insert((expires_at, key.to_vec()));
        Ok(())
    }
}

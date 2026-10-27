//! Answers kept until their TTL runs out.

use std::collections::{BTreeMap, BTreeSet};

use crate::io::Time;
use crate::record::{RData, Record, flag, rcode};

/// c-ares's default for `ARES_OPT_QUERY_CACHE`, which Bun left alone.
const MAX_TTL: u32 = 3600;

struct Entry {
    record: Record,
    inserted_at: i64,
}

#[derive(Default)]
pub(crate) struct QueryCache {
    entries: BTreeMap<Vec<u8>, Entry>,
    expiry: BTreeSet<(i64, Vec<u8>)>,
}

/// What two queries have to share for one's answer to be the other's. Names differ in case only are one.
pub(crate) fn key_of(query: &Record) -> Vec<u8> {
    let mut key = Vec::new();
    for question in &query.question {
        key.extend_from_slice(&question.qtype.to_be_bytes());
        key.extend_from_slice(&question.qclass.to_be_bytes());
        // A dot at the end says not to search. It is not part of the name.
        let name = question.name.strip_suffix(b".").unwrap_or(&question.name);
        key.extend(name.iter().map(u8::to_ascii_lowercase));
    }
    key
}

fn lowest_ttl(record: &Record) -> u32 {
    record
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
fn negative_ttl(record: &Record) -> u32 {
    record
        .authority
        .iter()
        .find_map(|rr| match &rr.data {
            RData::Soa(soa) => Some(rr.ttl.min(soa.minimum)),
            _ => None,
        })
        .unwrap_or(0)
}

impl QueryCache {
    pub(crate) fn flush(&mut self) {
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

    pub(crate) fn fetch(&mut self, now: Time, key: &[u8]) -> Option<Record> {
        self.expire(now);
        let entry = self.entries.get(key)?;
        let age = u32::try_from(now.sec - entry.inserted_at).unwrap_or(u32::MAX);
        entry.record.rewritten(age).ok()
    }

    pub(crate) fn insert(&mut self, now: Time, key: &[u8], answer: &Record) {
        let Ok(record) = answer.rewritten(0) else {
            return;
        };
        let ttl = match record.rcode {
            _ if record.flags & flag::TC != 0 => return,
            rcode::NOERROR => lowest_ttl(&record),
            rcode::NXDOMAIN => negative_ttl(&record),
            _ => return,
        }
        .min(MAX_TTL);
        if ttl == 0 {
            return;
        }
        let entry = Entry {
            record,
            inserted_at: now.sec,
        };
        // An entry that has not run out is still in `expiry` under its own time, and takes this one with it then.
        self.entries.insert(key.to_vec(), entry);
        self.expiry.insert((now.sec + i64::from(ttl), key.to_vec()));
    }
}

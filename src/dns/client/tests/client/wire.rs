//! Messages as a server writes them.

use core::net::IpAddr;

use bun_core::strings;

pub(crate) const A: u16 = 1;
pub(crate) const NS: u16 = 2;
pub(crate) const CNAME: u16 = 5;
pub(crate) const SOA: u16 = 6;
pub(crate) const PTR: u16 = 12;
pub(crate) const HINFO: u16 = 13;
pub(crate) const MX: u16 = 15;
pub(crate) const TXT: u16 = 16;
pub(crate) const AAAA: u16 = 28;
pub(crate) const SRV: u16 = 33;
pub(crate) const NAPTR: u16 = 35;
pub(crate) const OPT: u16 = 41;
pub(crate) const TLSA: u16 = 52;
pub(crate) const CAA: u16 = 257;

pub(crate) const IN: u16 = 1;
pub(crate) const CHAOS: u16 = 3;

pub(crate) const FORMERR: u16 = 1;
pub(crate) const SERVFAIL: u16 = 2;
pub(crate) const NXDOMAIN: u16 = 3;
pub(crate) const NOTIMP: u16 = 4;
pub(crate) const REFUSED: u16 = 5;
pub(crate) const TRUNCATED: u16 = 0x0200;
const RESPONSE: u16 = 0x8180;

/// A pointer to the name in the question.
pub(crate) const ASKED: &[u8] = &[0xc0, 12];

pub(crate) fn string(text: &[u8]) -> Vec<u8> {
    [&[text.len() as u8], text].concat()
}

pub(crate) fn labels(labels: &[&[u8]]) -> Vec<u8> {
    labels.iter().flat_map(|it| string(it)).chain([0]).collect()
}

pub(crate) fn name(text: &str) -> Vec<u8> {
    labels(&strings::tokenize(text.as_bytes(), b".").collect::<Vec<_>>())
}

pub(crate) fn numbers(numbers: &[u16]) -> Vec<u8> {
    numbers.iter().flat_map(|it| it.to_be_bytes()).collect()
}

pub(crate) fn frame(message: &[u8]) -> Vec<u8> {
    [&numbers(&[message.len() as u16]), message].concat()
}

pub(crate) fn resource(owner: &[u8], kind: u16, class: u16, ttl: u32, data: &[u8]) -> Vec<u8> {
    let (fixed, len) = (numbers(&[kind, class]), numbers(&[data.len() as u16]));
    [owner, &fixed, &ttl.to_be_bytes(), &len, data].concat()
}

pub(crate) fn record(kind: u16, ttl: u32, data: &[u8]) -> Vec<u8> {
    resource(ASKED, kind, IN, ttl, data)
}

pub(crate) fn address(ip: &str, ttl: u32) -> Vec<u8> {
    match ip.parse().unwrap() {
        IpAddr::V4(ip) => record(A, ttl, &ip.octets()),
        IpAddr::V6(ip) => record(AAAA, ttl, &ip.octets()),
    }
}

pub(crate) fn soa(ttl: u32, minimum: u32) -> Vec<u8> {
    let times = [1, 2, 3, 4, minimum].map(u32::to_be_bytes).concat();
    record(
        SOA,
        ttl,
        &[name("ns.test"), name("root.test"), times].concat(),
    )
}

/// `sections` are the answers, the authorities and the rest.
pub(crate) fn reply(query: &[u8], flags: u16, sections: [&[Vec<u8>]; 3]) -> Vec<u8> {
    let [answers, authorities, rest] = sections.map(|section| section.len() as u16);
    let header = numbers(&[RESPONSE | flags, 1, answers, authorities, rest]);
    let records = sections.concat().concat();
    [&query[..2], &header, &query[12..], &records].concat()
}

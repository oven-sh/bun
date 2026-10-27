//! RFC 6724 section 6: which of a host's addresses to try first.

use core::cmp::Ordering;
use core::net::{IpAddr, Ipv6Addr, SocketAddr};

use crate::addrinfo::Node;
use crate::io::Io;

const SCOPE_NODE_LOCAL: u8 = 0x01;
const SCOPE_LINK_LOCAL: u8 = 0x02;
const SCOPE_SITE_LOCAL: u8 = 0x05;
const SCOPE_GLOBAL: u8 = 0x0e;

fn is_site_local(address: &Ipv6Addr) -> bool {
    matches!(address.segments(), [0xfec0..=0xfeff, ..])
}

/// `::a.b.c.d`, other than `::` and `::1`.
fn is_v4_compatible(address: &Ipv6Addr) -> bool {
    matches!(address.segments(), [0, 0, 0, 0, 0, 0, high, low] if (high, low) > (0, 1))
}

fn scope(address: &IpAddr) -> u8 {
    match address {
        IpAddr::V6(v6) if v6.is_multicast() => v6.octets()[1] & 0x0f,
        // RFC 4291 section 2.5.3: the loopback address has link-local scope.
        IpAddr::V6(v6) if v6.is_loopback() || v6.is_unicast_link_local() => SCOPE_LINK_LOCAL,
        IpAddr::V6(v6) if is_site_local(v6) => SCOPE_SITE_LOCAL,
        IpAddr::V4(v4) if v4.is_loopback() || v4.is_link_local() => SCOPE_LINK_LOCAL,
        _ => SCOPE_GLOBAL,
    }
}

/// (label, precedence) in the policy table of RFC 6724 section 2.1.
fn policy(address: &IpAddr) -> (u8, u8) {
    let IpAddr::V6(v6) = address else {
        return (4, 35);
    };
    match v6.segments() {
        _ if v6.is_loopback() => (0, 50),
        [0, 0, 0, 0, 0, 0xffff, ..] => (4, 35),
        [0x2002, ..] => (2, 30),
        [0x2001, 0, ..] => (5, 5),
        [0xfc00..=0xfdff, ..] => (13, 3),
        _ if is_v4_compatible(v6) => (3, 1),
        _ if is_site_local(v6) => (11, 1),
        [0x3ffe, ..] => (12, 1),
        _ => (1, 40),
    }
}

struct Candidate {
    node: Node,
    /// What a packet to it would leave from. `None`: there is no route.
    source: Option<IpAddr>,
}

fn common_prefix_len(a: &Ipv6Addr, b: &Ipv6Addr) -> u32 {
    (a.to_bits() ^ b.to_bits()).leading_zeros()
}

fn compare(a: &Candidate, b: &Candidate) -> Ordering {
    let scope_matches = |it: &Candidate| {
        it.source.as_ref().map_or(SCOPE_NODE_LOCAL, scope) == scope(&it.node.address)
    };
    let label_matches = |it: &Candidate| {
        it.source.as_ref().map_or(1, |it| policy(it).0) == policy(&it.node.address).0
    };
    let prefix_len = |it: &Candidate| match (it.source, it.node.address) {
        (Some(IpAddr::V6(source)), IpAddr::V6(destination)) => {
            Some(common_prefix_len(&source, &destination))
        }
        _ => None,
    };
    // Rules 3, 4 and 7 need what the system does not tell.
    Ordering::Equal
        .then_with(|| b.source.is_some().cmp(&a.source.is_some()))
        .then_with(|| scope_matches(b).cmp(&scope_matches(a)))
        .then_with(|| label_matches(b).cmp(&label_matches(a)))
        .then_with(|| policy(&b.node.address).1.cmp(&policy(&a.node.address).1))
        .then_with(|| scope(&a.node.address).cmp(&scope(&b.node.address)))
        .then_with(|| match (prefix_len(a), prefix_len(b)) {
            (Some(a), Some(b)) => b.cmp(&a),
            _ => Ordering::Equal,
        })
}

/// A stable merge sort. Rule 9 compares only some pairs, so an answer can make `compare` no total order, which `sort_by` may panic on.
fn merge_sort(list: Vec<Candidate>) -> Vec<Candidate> {
    if list.len() < 2 {
        return list;
    }
    let mut left = list;
    let right = merge_sort(left.split_off(left.len() / 2));
    let mut left = merge_sort(left).into_iter().peekable();
    let mut right = right.into_iter().peekable();
    let mut merged = Vec::with_capacity(left.len() + right.len());
    while let (Some(a), Some(b)) = (left.peek(), right.peek()) {
        let next = match compare(a, b) {
            Ordering::Greater => right.next(),
            _ => left.next(),
        };
        merged.extend(next);
    }
    merged.extend(left);
    merged.extend(right);
    merged
}

/// Leaves the order alone if the system fails to say where packets would leave from.
pub(super) fn sort_addresses(io: &mut dyn Io, nodes: &mut Vec<Node>) {
    let mut candidates = Vec::with_capacity(nodes.len());
    for node in nodes.iter() {
        let Ok(source) = io.source_address(SocketAddr::new(node.address, node.port)) else {
            return;
        };
        candidates.push(Candidate {
            node: *node,
            source,
        });
    }
    *nodes = merge_sort(candidates)
        .into_iter()
        .map(|it| it.node)
        .collect();
}

// Portions of this file are derived from c-ares's ares_sortaddrinfo.c, under the BSD 3-Clause
// License:
//
// Copyright (C) 1995, 1996, 1997, and 1998 WIDE Project.
// Copyright (C) 2018 The Android Open Source Project
// Copyright (C) 2019 Andrew Selivanov
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions
// are met:
// 1. Redistributions of source code must retain the above copyright
//    notice, this list of conditions and the following disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright
//    notice, this list of conditions and the following disclaimer in the
//    documentation and/or other materials provided with the distribution.
// 3. Neither the name of the project nor the names of its contributors
//    may be used to endorse or promote products derived from this software
//    without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE PROJECT AND CONTRIBUTORS ``AS IS'' AND
// ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED.  IN NO EVENT SHALL THE PROJECT OR CONTRIBUTORS BE LIABLE
// FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
// DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
// OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
// HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
// LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
// OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
// SUCH DAMAGE.

//! RFC 6724 section 6: which of a host's addresses to try first.

use core::cmp::Ordering;
use core::net::{IpAddr, Ipv6Addr, SocketAddr};

use crate::addr_info::Node;
use crate::io::Io;

const SCOPE_NODE_LOCAL: u8 = 0x01;
const SCOPE_LINK_LOCAL: u8 = 0x02;
const SCOPE_SITE_LOCAL: u8 = 0x05;
const SCOPE_GLOBAL: u8 = 0x0e;

pub(crate) fn is_site_local(address: &Ipv6Addr) -> bool {
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

/// The label of `::/0`.
const DEFAULT_LABEL: u8 = 1;

/// A row of the policy table of RFC 6724 section 2.1.
struct Policy {
    label: u8,
    precedence: u8,
}

fn policy(address: &IpAddr) -> Policy {
    let (label, precedence) = match address {
        IpAddr::V4(_) => (4, 35),
        IpAddr::V6(v6) => match v6.segments() {
            _ if v6.is_loopback() => (0, 50),
            [0, 0, 0, 0, 0, 0xffff, ..] => (4, 35),
            [0x2002, ..] => (2, 30),
            [0x2001, 0, ..] => (5, 5),
            [0xfc00..=0xfdff, ..] => (13, 3),
            _ if is_v4_compatible(v6) => (3, 1),
            _ if is_site_local(v6) => (11, 1),
            [0x3ffe, ..] => (12, 1),
            _ => (DEFAULT_LABEL, 40),
        },
    };
    Policy { label, precedence }
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
        let source_label = (it.source.as_ref()).map_or(DEFAULT_LABEL, |it| policy(it).label);
        source_label == policy(&it.node.address).label
    };
    let precedence = |it: &Candidate| policy(&it.node.address).precedence;
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
        .then_with(|| precedence(b).cmp(&precedence(a)))
        .then_with(|| scope(&a.node.address).cmp(&scope(&b.node.address)))
        .then_with(|| match (prefix_len(a), prefix_len(b)) {
            (Some(a), Some(b)) => b.cmp(&a),
            _ => Ordering::Equal,
        })
}

/// Rule 9 compares only some pairs, so an answer can make `compare` no total order, which `sort_by`
/// may panic on. Halves and merges as glibc's `qsort()` does, so the order of such an answer is the
/// one c-ares gave too.
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

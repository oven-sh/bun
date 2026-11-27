//! Destination address selection (RFC 6724 §6).

use core::cmp::Reverse;
use core::net::IpAddr;

use bun_collections::index_sort;

use crate::message::Address;
use crate::system::{Route, System};

const SCOPE_INTERFACE_LOCAL: u8 = 0x1;
const SCOPE_LINK_LOCAL: u8 = 0x2;
const SCOPE_SITE_LOCAL: u8 = 0x5;
const SCOPE_GLOBAL: u8 = 0xe;

fn scope(ip: IpAddr) -> u8 {
    match ip {
        IpAddr::V4(ip) if ip.is_loopback() || ip.is_link_local() => SCOPE_LINK_LOCAL,
        IpAddr::V6(ip) if ip.is_multicast() => ip.octets()[1] & 0x0f,
        IpAddr::V6(ip) if ip.is_loopback() || ip.is_unicast_link_local() => SCOPE_LINK_LOCAL,
        IpAddr::V6(ip) if ip.segments()[0] & 0xffc0 == 0xfec0 => SCOPE_SITE_LOCAL,
        _ => SCOPE_GLOBAL,
    }
}

/// For each family. The addresses after these go by the route of the last.
const MAX_ROUTES: usize = 32;

struct Policy {
    precedence: u8,
    label: u8,
}

const DEFAULT_LABEL: u8 = 1;

/// §2.1
fn policy(ip: IpAddr) -> Policy {
    let segments = match ip {
        IpAddr::V4(ip) => ip.to_ipv6_mapped().segments(),
        IpAddr::V6(ip) => ip.segments(),
    };
    let (precedence, label) = match segments {
        [0, 0, 0, 0, 0, 0, 0, 1] => (50, 0),
        [0, 0, 0, 0, 0, 0, 0, 0] => (40, DEFAULT_LABEL),
        [0, 0, 0, 0, 0, 0xffff, ..] => (35, 4),
        [0x2002, ..] => (30, 2),
        [0x2001, 0, ..] => (5, 5),
        [0xfc00..=0xfdff, ..] => (3, 13),
        [0, 0, 0, 0, 0, 0, ..] => (1, 3),
        [0xfec0..=0xfeff, ..] => (1, 11),
        [0x3ffe, ..] => (1, 12),
        _ => (40, DEFAULT_LABEL),
    };
    Policy { precedence, label }
}

/// Lower is better.
fn rank(destination: IpAddr, source: Option<IpAddr>) -> impl Ord {
    let source_scope = source.map_or(SCOPE_INTERFACE_LOCAL, scope);
    let source_label = source.map_or(DEFAULT_LABEL, |source| policy(source).label);
    let common_prefix = match (destination, source) {
        (IpAddr::V6(destination), Some(IpAddr::V6(source))) => {
            (destination.to_bits() ^ source.to_bits()).leading_zeros()
        }
        _ => u32::MAX,
    };
    let Policy { precedence, label } = policy(destination);
    (
        source.is_none(),
        source_scope != scope(destination),
        source_label != label,
        Reverse(precedence),
        scope(destination),
        Reverse(common_prefix),
    )
}

/// Leaves the order as it is if the system cannot tell the route to an address.
pub(crate) fn sort(addresses: &mut Vec<Address>, system: &mut impl System) {
    if addresses.len() < 2 {
        return;
    }
    let (mut v4, mut v6) = ((0, Route::Unknown), (0, Route::Unknown));
    let ranked = addresses.iter().map(|&address| {
        let (count, route) = match address.ip {
            IpAddr::V4(_) => &mut v4,
            IpAddr::V6(_) => &mut v6,
        };
        if *count < MAX_ROUTES {
            (*count, *route) = (*count + 1, system.route(address.ip));
        }
        let source = match *route {
            Route::From(source) => Some(source),
            Route::Unreachable => None,
            Route::Unknown => return None,
        };
        Some((rank(address.ip, source), address))
    });
    if let Some(mut ranked) = ranked.collect::<Option<Vec<_>>>() {
        index_sort::sort_slice_by(&mut ranked, |(a, _), (b, _)| a.cmp(b));
        addresses.clear();
        addresses.extend(ranked.into_iter().map(|(_, address)| address));
    }
}

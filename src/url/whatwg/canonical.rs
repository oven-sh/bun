//! One pass over the URLs that are met most: `http:`, `https:` and `file:`, written as they serialize.

use crate::authority::leading_port;
use crate::class::{
    self, BACKSLASH, DIGIT_OR_X, FRAGMENT, HOST_SCAN, PATH, SPECIAL_QUERY, TAB_OR_NEWLINE,
    TAIL_SCAN,
};
use crate::components::{Components, State};
use crate::parser::Step;
use crate::path::PathSyntax;
use crate::{Punycode, Scheme, domain, ipv4};

pub(crate) enum Outcome {
    Canonical(Components),
    /// Canonical with a `/` behind it.
    LacksPath(Components),
    /// Canonical up to where the parser has to step in.
    Unfinished(Components, Step),
}

/// And where the host starts. Input of up to 16 bytes is left to the parser: the scans make a detour for it.
#[inline(always)]
fn scheme(input: &[u8]) -> Option<(Scheme, usize)> {
    let start = u64::from_le_bytes(*input.first_chunk::<17>()?.first_chunk()?);
    if start as u32 != u32::from_le_bytes(*b"http") {
        return (start == u64::from_le_bytes(*b"file:///")).then_some((Scheme::File, 7));
    }
    let is_secure = (start >> 32) as u8 == b's';
    let host_start = 7 + usize::from(is_secure);
    let up_to_host = start << (64 - 8 * host_start);
    let scheme = if is_secure {
        Scheme::Https
    } else {
        Scheme::Http
    };
    (up_to_host >> 40 == u64::from_le_bytes(*b"://\0\0\0\0\0")).then_some((scheme, host_start))
}

/// For a domain of which a label starts with a digit or an `x`.
#[inline(never)]
fn stays_as_it_is(domain: &[u8], punycode: Punycode) -> bool {
    !ipv4::ends_in_number(domain)
        && (punycode == Punycode::Unchecked || domain::has_valid_ace_labels(domain))
}

/// The length of the IPv4 address that the authority starts with, if that is all of the host.
#[inline(never)]
fn address_length(authority: &[u8]) -> Option<usize> {
    ipv4::serialized_length(authority)
        .filter(|&length| matches!(authority.get(length), None | Some(b'/' | b':')))
}

/// Where the host ends, the port, and where the path starts.
#[inline(always)]
fn host_and_port(
    input: &[u8],
    (scheme, host_start): (Scheme, usize),
    host_stops: u64,
    punycode: Punycode,
) -> Option<(usize, u16, usize)> {
    let mut is_plain = true;
    let mut stops = HOST_SCAN.resume_scan(input, host_start + 32, host_stops << 32);
    let (host_end, mut next) = loop {
        let Some(at) = stops.next() else {
            break (input.len(), b'/');
        };
        if class::host_traits(input[at]) & DIGIT_OR_X == 0 {
            break (at, input[at]);
        }
        if at == host_start
            && let Some(length) = address_length(&input[at..])
        {
            break (at + length, input.get(at + length).copied().unwrap_or(b'/'));
        }
        is_plain = false;
    };
    let (mut path_start, mut port) = (host_end, 0);
    if next == b':' {
        let digits = &input[host_end + 1..];
        let (count, value) = leading_port(digits);
        port = value?;
        if digits[0] == b'0' || value == scheme.default_port() {
            return None;
        }
        path_start += 1 + count;
        next = input.get(path_start).copied().unwrap_or(b'/');
    }
    if next != b'/'
        || (host_end == host_start) != (scheme == Scheme::File)
        || (scheme == Scheme::File && input.get(9) == Some(&b'|'))
        || !(is_plain || stays_as_it_is(&input[host_start..host_end], punycode))
    {
        return None;
    }
    Some((host_end, port, path_start))
}

/// Whether `input` is a valid URL whatever comes after its authority.
#[inline(always)]
pub(crate) fn has_canonical_authority(input: &[u8], punycode: Punycode) -> bool {
    scheme(input).is_some_and(|start| {
        host_and_port(
            input,
            start,
            HOST_SCAN.stops_in_32(input, start.1),
            punycode,
        )
        .is_some()
    })
}

#[inline(always)]
pub(crate) fn recognize(input: &[u8], punycode: Punycode) -> Outcome {
    const SYNTAX: PathSyntax = PathSyntax {
        set: PATH,
        backslash_is_slash: true,
    };
    let Some((scheme, host_start)) = scheme(input) else {
        return Outcome::Unfinished(Components::INVALID, Step::Start);
    };
    let host_stops = HOST_SCAN.stops_in_32(input, host_start);
    let tail_stops = TAIL_SCAN.stops_in_64(input, host_start);
    let mut parts = Components {
        scheme_end: host_start as u32 - 3,
        scheme,
        state: State::Hierarchical,
        ..Components::INVALID
    };
    let Some((host_end, port, path_start)) =
        host_and_port(input, (scheme, host_start), host_stops, punycode)
    else {
        let step = match input[host_start] {
            b'/' | b'\\' => Step::Start,
            _ => Step::Authority(host_start as u32),
        };
        return Outcome::Unfinished(parts, step);
    };
    parts.set_empty_authority(host_start as u32);
    parts.host_end = host_end as u32;
    parts.port = port;
    parts.path_start = path_start as u32;
    let length = input.len();
    if path_start == length {
        parts.path_end = parts.path_start + 1;
        parts.query_end = parts.path_end;
        return Outcome::LacksPath(parts);
    }

    let (mut path_end, mut query_end) = (length, length);
    let mut changes = PATH | BACKSLASH | TAB_OR_NEWLINE;
    for at in TAIL_SCAN.resume_scan(input, host_start + 64, tail_stops) {
        let byte = input[at];
        if byte == b'?' && path_end == length {
            path_end = at;
            changes = SPECIAL_QUERY | TAB_OR_NEWLINE;
        } else if byte == b'#' && query_end == length {
            path_end = path_end.min(at);
            query_end = at;
            changes = FRAGMENT | TAB_OR_NEWLINE;
        } else if at > path_start
            && (class::is_in(changes, byte)
                || (path_end == length
                    && input[at - 1] == b'/'
                    && SYNTAX.dot_segment(&input[at..]).is_some()))
        {
            parts.path_end = path_end as u32;
            parts.query_end = query_end as u32;
            let step = if path_end == length {
                Step::RestOfPath(at as u32)
            } else if query_end == length {
                Step::RestOfQuery(at as u32)
            } else {
                Step::RestOfFragment(at as u32)
            };
            return Outcome::Unfinished(parts, step);
        }
    }
    parts.path_end = path_end as u32;
    parts.query_end = query_end as u32;
    Outcome::Canonical(parts)
}

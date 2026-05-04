//! Alt-Svc (RFC 7838) header handling for the HTTP/3 client.
//!
//! When `--experimental-http3-fetch` / `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT`
//! is on, `handleResponseMetadata` calls `record()` for every `Alt-Svc` header
//! and `start_()` calls `lookup()` before opening a TCP socket: if the origin
//! previously advertised `h3`, the request is routed onto the QUIC engine
//! instead. The cache is keyed on the *origin* authority (the host:port the
//! request was sent to) and lives only on the HTTP thread, so it needs no
//! locking.
//!
//! Only same-host alternatives (`h3=":port"` with an empty uri-host) are
//! honored; cross-host alternatives need extra certificate-authority checks
//! (RFC 7838 §2.1) that are out of scope here.

use bun_collections::StringHashMap;
use bun_str::strings;

bun_output::declare_scope!(h3_client, hidden);

/// One advertised `h3` alternative from an `Alt-Svc` field-value. `port` is
/// the alt-authority port (where QUIC should connect); `ma` is the freshness
/// lifetime in seconds (default 24 h per §3.1).
#[derive(Copy, Clone)]
pub struct Entry {
    pub port: u16,
    pub ma: u32,
}

impl Default for Entry {
    fn default() -> Self {
        Self { port: 0, ma: 86400 }
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum ParseError {
    #[error("Clear")]
    Clear,
}
impl From<ParseError> for bun_core::Error {
    fn from(e: ParseError) -> Self {
        bun_core::err!("Clear")
    }
}

/// Parse the first usable `h3` alternative out of an `Alt-Svc` field-value, or
/// `None` if none / `clear`. Tolerant of extra whitespace and unknown params.
///
/// ```text
///   Alt-Svc       = clear / 1#alt-value
///   alt-value     = protocol-id "=" alt-authority *( OWS ";" OWS parameter )
///   alt-authority = quoted-string containing [uri-host] ":" port
/// ```
///
/// Returns `Err(ParseError::Clear)` for the literal `clear` so the caller can
/// drop the cache entry.
pub fn parse(field_value: &[u8]) -> Result<Option<Entry>, ParseError> {
    let value = strings::trim(field_value, b" \t");
    if value.is_empty() {
        return Ok(None);
    }
    if strings::eql_case_insensitive_ascii(value, b"clear", true) {
        return Err(ParseError::Clear);
    }

    for raw_entry in value.split(|b| *b == b',') {
        let entry = strings::trim(raw_entry, b" \t");
        if entry.is_empty() {
            continue;
        }

        let mut params = entry.split(|b| *b == b';');
        // `splitScalar.first()` == first split segment; always present.
        let alternative = strings::trim(params.next().unwrap(), b" \t");

        let Some(eq) = strings::index_of_char(alternative, b'=') else {
            continue;
        };
        let eq = eq as usize;
        let proto = &alternative[..eq];
        // Only the final IETF "h3" ALPN token; draft `h3-NN` versions are
        // ignored since lsquic is built for the final spec.
        if !strings::eql_case_insensitive_ascii(proto, b"h3", true) {
            continue;
        }

        // alt-authority is a quoted-string: `":443"` or `"host:443"`.
        let mut auth = strings::trim(&alternative[eq + 1..], b" \t");
        if auth.len() >= 2 && auth[0] == b'"' && auth[auth.len() - 1] == b'"' {
            auth = &auth[1..auth.len() - 1];
        }
        let Some(colon) = auth.iter().rposition(|&b| b == b':') else {
            continue;
        };
        // Same-host alternatives only (empty uri-host).
        if colon != 0 {
            continue;
        }
        let Some(port) = parse_int::<u16>(&auth[colon + 1..]) else {
            continue;
        };
        if port == 0 {
            continue;
        }

        let mut result = Entry { port, ..Entry::default() };
        for raw_param in params {
            let param = strings::trim(raw_param, b" \t");
            let Some(peq) = strings::index_of_char(param, b'=') else {
                continue;
            };
            let peq = peq as usize;
            if strings::eql_case_insensitive_ascii(&param[..peq], b"ma", true) {
                result.ma = parse_int::<u32>(&param[peq + 1..]).unwrap_or(result.ma);
            }
            // `persist` and unknown parameters are ignored (§3.1).
        }
        return Ok(Some(result));
    }
    Ok(None)
}

/// HTTP-thread-only Alt-Svc cache. Key is `"hostname:port"` of the origin the
/// header was received from; value is the advertised h3 port + expiry.
#[derive(Copy, Clone)]
struct Record {
    h3_port: u16,
    expires_at: i64,
}

// TODO(port): module-level mutable state. Zig used a plain `var`; safe because
// every access is on the single HTTP thread (see module doc). Phase B may want
// a `SyncUnsafeCell` / thread-local instead of `static mut`.
#[allow(static_mut_refs)]
static mut CACHE: Option<StringHashMap<Record>> = None;

#[allow(static_mut_refs)]
fn cache() -> &'static mut StringHashMap<Record> {
    // SAFETY: only ever accessed from the single HTTP thread (see module doc),
    // so no aliased `&mut` can exist concurrently.
    unsafe { CACHE.get_or_insert_with(StringHashMap::default) }
}

/// Hard cap on cached origins. When reached, `record()` first sweeps expired
/// entries and then refuses the new insert if still full — bounded memory for
/// long-lived processes that hit many distinct origins.
const MAX_ENTRIES: usize = 256;

fn key<'a>(buf: &'a mut [u8], hostname: &[u8], port: u16) -> &'a [u8] {
    // Callers guard `hostname.len > 256` against a `256+8` buffer, and a u16
    // port is at most 5 digits + ':' — bufPrint cannot overflow.
    use std::io::Write;
    let mut cursor: &mut [u8] = buf;
    write!(cursor, "{}:{}", bstr::BStr::new(hostname), port).expect("unreachable");
    // PORT NOTE: reshaped for borrowck — capture remaining len before reborrowing buf.
    let remaining = cursor.len();
    let written = buf.len() - remaining;
    &buf[..written]
}

fn sweep_expired(now: i64) {
    let cache = cache();
    // Unmanaged hash-map iteration is not removal-safe; restart after each removal.
    // TODO(port): `StringHashMap` API — assumes `iter()` yielding `(&Box<[u8]>, &Record)`
    // and `remove(&[u8])` that drops the owned key. Adjust to actual bun_collections API.
    'outer: loop {
        let mut to_remove: Option<Box<[u8]>> = None;
        for (k, v) in cache.iter() {
            if now >= v.expires_at {
                to_remove = Some(Box::<[u8]>::from(&**k));
                break;
            }
        }
        match to_remove {
            Some(k) => {
                cache.remove(&k[..]);
            }
            None => break 'outer,
        }
    }
}

/// Remember (or refresh / clear) the h3 alternative for `origin_host:origin_port`
/// from a received `Alt-Svc` field-value. Runs on the HTTP thread inside
/// `handleResponseMetadata`.
pub fn record(origin_host: &[u8], origin_port: u16, field_value: &[u8]) {
    let mut buf = [0u8; 256 + 8];
    if origin_host.len() > 256 {
        return;
    }
    let k = key(&mut buf, origin_host, origin_port);

    let entry = match parse(field_value) {
        Err(ParseError::Clear) => {
            // `clear`
            cache().remove(k);
            bun_output::scoped_log!(h3_client, "alt-svc clear {}", bstr::BStr::new(k));
            return;
        }
        Ok(None) => return,
        Ok(Some(e)) => e,
    };

    let now = timestamp();
    if cache().len() >= MAX_ENTRIES && !cache().contains_key(k) {
        sweep_expired(now);
        if cache().len() >= MAX_ENTRIES {
            return;
        }
    }
    // TODO(port): `StringHashMap` getOrPut equivalent. Assumes an
    // `entry(&[u8])`-style API that dupes the key on insert; adjust in Phase B.
    cache().insert_or_update(k, Record {
        h3_port: entry.port,
        expires_at: now + i64::from(entry.ma),
    });
    bun_output::scoped_log!(
        h3_client,
        "alt-svc h3 {} -> :{} ma={}",
        bstr::BStr::new(k),
        entry.port,
        entry.ma
    );
}

/// Look up a previously-advertised h3 alternative for `origin_host:origin_port`.
/// Expired entries are dropped on access. Runs on the HTTP thread inside
/// `start_()`.
pub fn lookup(origin_host: &[u8], origin_port: u16) -> Option<u16> {
    let mut buf = [0u8; 256 + 8];
    if origin_host.len() > 256 {
        return None;
    }
    let k = key(&mut buf, origin_host, origin_port);
    let rec = *cache().get(k)?;
    if timestamp() >= rec.expires_at {
        cache().remove(k);
        return None;
    }
    Some(rec.h3_port)
}

// ─── helpers ──────────────────────────────────────────────────────────────

#[inline]
fn parse_int<T: core::str::FromStr>(bytes: &[u8]) -> Option<T> {
    // Integer literals in Alt-Svc are ASCII-only; non-ASCII → not a valid int
    // → `from_utf8` failing is equivalent to Zig's `parseInt` failing.
    core::str::from_utf8(bytes).ok()?.parse::<T>().ok()
}

#[inline]
fn timestamp() -> i64 {
    // TODO(port): Zig used `std.time.timestamp()`. Swap for a bun_core time
    // source if one exists; SystemTime is not in the banned std modules.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/h3_client/AltSvc.zig (160 lines)
//   confidence: medium
//   todos:      4
//   notes:      static-mut cache + StringHashMap insert/iter API need Phase B fixup; logic is 1:1
// ──────────────────────────────────────────────────────────────────────────

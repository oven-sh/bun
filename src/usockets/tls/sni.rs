//! Server-name (SNI) map with wildcard matching — replaces sni_tree.cpp with
//! verbatim matching semantics incl. case behavior (docs/tls.md A.5). Also
//! the dynamic on_server_name callback and the sni_resolve suspend/resume
//! path (docs/cabi.md §4.3).

use core::ffi::{CStr, c_char, c_int, c_void};
use std::collections::BTreeMap;

use crate::handle::ListenSocket;
use crate::socket::us_socket_t;
use crate::tls::context::{SslCtx, ssl_ctx_unref, ssl_ctx_up_ref};

/// sni_tree.cpp MAX_LABELS: find/remove reject hostnames with >10 labels;
/// add has no limit (A.5, ported verbatim).
const MAX_LABELS: usize = 10;

/// One registered server name: `ctx` holds an up_ref'd reference released on
/// Drop (== sni_node_destructor); `user` is opaque (uWS: HttpRouter*).
struct Entry {
    ctx: *mut SslCtx,
    user: *mut c_void,
}

impl Drop for Entry {
    fn drop(&mut self) {
        if !self.ctx.is_null() {
            ssl_ctx_unref(self.ctx);
        }
    }
}

/// Label-trie node (sni_node). `entry` presence == C's non-null `user`.
#[derive(Default)]
struct Node {
    entry: Option<Entry>,
    children: BTreeMap<Box<[u8]>, Node>,
}

/// Per-listen-socket server-name tree. Each node holds an up_ref'd `SslCtx`
/// (released on remove/close) + an opaque `user` pointer (uWS: HttpRouter*).
pub(crate) struct SniMap {
    root: Node,
}

/// Dynamic missing-SNI resolver: returns the ctx to use for THIS handshake
/// only (not cached/owned), or null → default. `*abort_handshake`: 1 = abort,
/// 2 = suspend (async; resumed via `sni_resolve`).
pub(crate) type OnServerName = unsafe extern "C" fn(
    *mut ListenSocket,
    *const c_char,
    *mut c_int,
    *mut us_socket_t,
) -> *mut SslCtx;

/// Split labels exactly like sni_tree.cpp's string_view loop: tokens up to
/// each `.`; a trailing dot yields NO empty final label; `..` yields one.
struct Labels<'a> {
    rest: &'a [u8],
}

impl<'a> Iterator for Labels<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<&'a [u8]> {
        if self.rest.is_empty() {
            return None;
        }
        let label = match self.rest.iter().position(|&b| b == b'.') {
            Some(i) => &self.rest[..i],
            None => self.rest,
        };
        self.rest = &self.rest[(label.len() + 1).min(self.rest.len())..];
        Some(label)
    }
}

fn split_labels(hostname: &[u8]) -> Labels<'_> {
    Labels { rest: hostname }
}

/// `None` when the hostname exceeds MAX_LABELS (find/remove reject it).
/// Stack buffer, no allocation: runs in the per-handshake SNI callback
/// (parity with sni_tree.cpp's `string_view labels[10]`).
fn collect_labels<'a>(hostname: &'a [u8], buf: &mut [&'a [u8]; MAX_LABELS]) -> Option<usize> {
    let mut n = 0;
    for label in split_labels(hostname) {
        if n == MAX_LABELS {
            return None;
        }
        buf[n] = label;
        n += 1;
    }
    Some(n)
}

/// getUser: exact label first; if that subtree yields nothing, fall back to
/// the `*` child. Full-depth match required; byte-wise case-sensitive.
fn get<'a>(node: &'a Node, labels: &[&[u8]]) -> Option<&'a Entry> {
    let Some((first, rest)) = labels.split_first() else {
        return node.entry.as_ref();
    };
    if let Some(child) = node.children.get(*first) {
        if let Some(entry) = get(child, rest) {
            return Some(entry);
        }
    }
    get(node.children.get(&b"*"[..])?, rest)
}

/// removeUser: exact match only (`*` is the literal char); culls empty
/// entry-less nodes on the way back up, whether or not anything was removed.
fn remove_rec(node: &mut Node, labels: &[&[u8]]) -> Option<Entry> {
    let Some((first, rest)) = labels.split_first() else {
        return node.entry.take();
    };
    let child = node.children.get_mut(*first)?;
    let removed = remove_rec(child, rest);
    if child.children.is_empty() && child.entry.is_none() {
        node.children.remove(*first);
    }
    removed
}

impl SniMap {
    pub(crate) fn new() -> SniMap {
        SniMap {
            root: Node::default(),
        }
    }

    /// `ssl_ctx` is up_ref'd into the node; wildcard patterns supported.
    /// `false` = duplicate pattern (never overwrites; no ref taken — App.h
    /// rolls back). Interior nodes created before the check stay, like C.
    pub(crate) fn add(&mut self, pattern: &CStr, ssl_ctx: *mut SslCtx, user: *mut c_void) -> bool {
        let mut node = &mut self.root;
        for label in split_labels(pattern.to_bytes()) {
            node = node.children.entry(Box::from(label)).or_default();
        }
        if node.entry.is_some() {
            return false;
        }
        if !ssl_ctx.is_null() {
            ssl_ctx_up_ref(ssl_ctx);
        }
        node.entry = Some(Entry { ctx: ssl_ctx, user });
        true
    }

    /// Releases the entry's ctx ref.
    pub(crate) fn remove(&mut self, pattern: &CStr) {
        let mut buf: [&[u8]; MAX_LABELS] = [b""; MAX_LABELS];
        let Some(n) = collect_labels(pattern.to_bytes(), &mut buf) else {
            return;
        };
        drop(remove_rec(&mut self.root, &buf[..n]));
    }

    fn lookup(&self, hostname: &CStr) -> Option<&Entry> {
        let mut buf: [&[u8]; MAX_LABELS] = [b""; MAX_LABELS];
        let n = collect_labels(hostname.to_bytes(), &mut buf)?;
        get(&self.root, &buf[..n])
    }

    /// Exact-pattern lookup; returns an OWNED reference (caller unrefs) —
    /// docs/cabi.md §1.6.
    pub(crate) fn find_ctx(&self, pattern: &CStr) -> *mut SslCtx {
        match self.lookup(pattern) {
            Some(entry) if !entry.ctx.is_null() => {
                ssl_ctx_up_ref(entry.ctx);
                entry.ctx
            }
            _ => core::ptr::null_mut(),
        }
    }

    /// Wildcard-aware resolution for a negotiated servername (mid-handshake).
    /// The returned ctx is BORROWED from the tree (dispatch does
    /// SSL_set_SSL_CTX, which takes its own ref) — do not unref.
    pub(crate) fn resolve(&self, hostname: &CStr) -> Option<(*mut SslCtx, *mut c_void)> {
        self.lookup(hostname).map(|entry| (entry.ctx, entry.user))
    }
}

/// Raw ClientHello server_name extension parse (`us_client_hello_servername`,
/// openssl.c:2284-2310, ported verbatim). `ext` is the extension payload;
/// writes the NUL-terminated host_name into `out` and returns its length, or
/// 0 if absent/malformed/too long (cap = out.len(), 256 incl. NUL in C).
pub(crate) fn client_hello_servername(ext: &[u8], out: &mut [u8]) -> usize {
    if ext.len() < 5 {
        return 0;
    }
    let list_len = ((ext[0] as usize) << 8) | ext[1] as usize;
    if list_len + 2 != ext.len() {
        return 0;
    }
    let mut p = &ext[2..];
    while p.len() >= 3 {
        let entry_type = p[0];
        let name_len = ((p[1] as usize) << 8) | p[2] as usize;
        if name_len + 3 > p.len() {
            return 0;
        }
        // TLSEXT_NAMETYPE_host_name
        if entry_type == 0 {
            if name_len == 0 || name_len >= out.len() {
                return 0;
            }
            out[..name_len].copy_from_slice(&p[3..3 + name_len]);
            out[name_len] = 0;
            return name_len;
        }
        p = &p[3 + name_len..];
    }
    0
}

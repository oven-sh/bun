//! Server Name Indication hostname tree (port of `crypto/sni_tree.cpp`).
//! Opaque to C — only the five `sni_*` extern "C" symbols are ABI surface.
//! No allocations on the `sni_find` fast path; lookup is O(log n) per label.

use core::cell::Cell;
use core::ffi::{CStr, c_char, c_int, c_void};
use core::ptr;
use std::collections::BTreeMap;

/// We only handle a maximum of 10 labels per hostname.
const MAX_LABELS: usize = 10;

/// Literal one-byte wildcard label.
const WILDCARD: &[u8] = b"*";

type FreeCb = unsafe extern "C" fn(*mut c_void);

std::thread_local! {
    /// Set by `sni_free` so `SniNode::drop` can release each payload. Not set
    /// by `sni_remove`, which only ever drops empty (`user == null`) nodes.
    static SNI_FREE_CB: Cell<Option<FreeCb>> = const { Cell::new(None) };
}

struct SniNode {
    /// Empty nodes must always hold null.
    user: *mut c_void,
    children: BTreeMap<Box<[u8]>, Box<SniNode>>,
}

impl Default for SniNode {
    #[inline]
    fn default() -> Self {
        Self {
            user: ptr::null_mut(),
            children: BTreeMap::new(),
        }
    }
}

impl Drop for SniNode {
    fn drop(&mut self) {
        let cb = SNI_FREE_CB.get();
        for child in self.children.values() {
            // Call the destructor passed to `sni_free` only when the child
            // holds data — the `sni_remove` cull path reaches Drop with no cb
            // set, but only on nodes whose `user` is already null.
            if !child.user.is_null() {
                // SAFETY: non-null `user` is only dropped under `sni_free`,
                // which stores a valid cb in the thread-local first.
                unsafe { cb.unwrap_unchecked()(child.user) };
            }
        }
        // `self.children` then drops: keys (Box<[u8]>) free their bytes and
        // each Box<SniNode> recurses into this Drop — matching C++ ~sni_node.
    }
}

/// Iterator over the dot-separated labels of a hostname byte slice. Matches
/// the `view.remove_prefix(min(len, label.len() + 1))` loop in the C++.
struct Labels<'a>(&'a [u8]);

impl<'a> Iterator for Labels<'a> {
    type Item = &'a [u8];

    #[inline]
    fn next(&mut self) -> Option<&'a [u8]> {
        if self.0.is_empty() {
            return None;
        }
        let dot = self
            .0
            .iter()
            .position(|&b| b == b'.')
            .unwrap_or(self.0.len());
        let label = &self.0[..dot];
        let skip = core::cmp::min(self.0.len(), label.len() + 1);
        self.0 = &self.0[skip..];
        Some(label)
    }
}

#[inline]
unsafe fn hostname_bytes<'a>(hostname: *const c_char) -> &'a [u8] {
    // SAFETY: caller (openssl.c) guarantees a valid NUL-terminated C string.
    unsafe { CStr::from_ptr(hostname) }.to_bytes()
}

/// Removes at most one payload; culls empty nodes on the way back up.
fn remove_user(root: &mut SniNode, idx: usize, labels: &[&[u8]]) -> *mut c_void {
    // Past the last label: take this node's payload and mark it for culling.
    if idx == labels.len() {
        return core::mem::replace(&mut root.user, ptr::null_mut());
    }

    let key = labels[idx];
    let (removed, cull) = match root.children.get_mut(key) {
        None => return ptr::null_mut(),
        Some(child) => {
            let removed = remove_user(child, idx + 1, labels);
            // On the way back up, cull empty nodes with no children.
            (removed, child.children.is_empty() && child.user.is_null())
        }
    };

    if cull {
        // Dropping the entry frees both the key bytes and the (empty) child.
        root.children.remove(key);
    }
    removed
}

fn get_user(root: &SniNode, idx: usize, labels: &[&[u8]]) -> *mut c_void {
    // No more labels to match: return where we stand.
    if idx == labels.len() {
        return root.user;
    }

    // Try and match by our label.
    if let Some(child) = root.children.get(labels[idx]) {
        let user = get_user(child, idx + 1, labels);
        if !user.is_null() {
            return user;
        }
    }

    // Try and match by wildcard.
    match root.children.get(WILDCARD) {
        None => ptr::null_mut(),
        Some(child) => get_user(child, idx + 1, labels),
    }
}

// ─── extern "C" ABI ────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sni_new() -> *mut c_void {
    Box::into_raw(Box::new(SniNode::default())).cast()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sni_free(sni: *mut c_void, cb: Option<FreeCb>) {
    // We want to run this callback for every remaining name.
    SNI_FREE_CB.set(cb);
    if sni.is_null() {
        return;
    }
    // SAFETY: `sni` was produced by `sni_new` via Box::into_raw and is non-null.
    drop(unsafe { Box::from_raw(sni.cast::<SniNode>()) });
}

/// Returns non-zero if this name already exists.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sni_add(
    sni: *mut c_void,
    hostname: *const c_char,
    user: *mut c_void,
) -> c_int {
    let mut root = sni.cast::<SniNode>();

    // SAFETY: caller passes a valid NUL-terminated hostname.
    for label in Labels(unsafe { hostname_bytes(hostname) }) {
        // SAFETY: `root` is the caller-owned tree root or a child reached on
        // the previous iteration; raw ptr lets us rebind across the loop.
        let children = unsafe { &mut (*root).children };
        if !children.contains_key(label) {
            // Duplicate this label as our owned key.
            children.insert(label.into(), Box::new(SniNode::default()));
        }
        // Just ensured present; lookup cannot fail.
        root = ptr::from_mut(&mut **children.get_mut(label).unwrap());
    }

    // SAFETY: `root` is valid — tree root on empty hostname, else a leaf.
    let root = unsafe { &mut *root };
    // Never overwrite an existing context for the same name (would leak).
    if !root.user.is_null() {
        return 1;
    }
    root.user = user;
    0
}

/// Removes the exact match. Wildcards are treated as the verbatim asterisk
/// char, not as an actual wildcard.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sni_remove(sni: *mut c_void, hostname: *const c_char) -> *mut c_void {
    // SAFETY: `sni` is a live tree root from `sni_new`.
    let root = unsafe { &mut *sni.cast::<SniNode>() };

    let mut labels: [&[u8]; MAX_LABELS] = Default::default();
    let mut num = 0usize;
    // SAFETY: caller passes a valid NUL-terminated hostname.
    for label in Labels(unsafe { hostname_bytes(hostname) }) {
        if num == MAX_LABELS {
            return ptr::null_mut();
        }
        labels[num] = label;
        num += 1;
    }

    remove_user(root, 0, &labels[..num])
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sni_find(sni: *mut c_void, hostname: *const c_char) -> *mut c_void {
    // SAFETY: `sni` is a live tree root from `sni_new`.
    let root = unsafe { &*sni.cast::<SniNode>() };

    let mut labels: [&[u8]; MAX_LABELS] = Default::default();
    let mut num = 0usize;
    // SAFETY: caller passes a valid NUL-terminated hostname.
    for label in Labels(unsafe { hostname_bytes(hostname) }) {
        if num == MAX_LABELS {
            return ptr::null_mut();
        }
        labels[num] = label;
        num += 1;
    }

    get_user(root, 0, &labels[..num])
}

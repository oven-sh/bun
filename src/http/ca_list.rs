//! The `ca` option of a TLS configuration as one shared object.

use core::ffi::c_char;
use std::collections::BTreeMap;
use std::sync::{Arc, Weak};

use bun_core::SensitiveCString;
use bun_threading::Guarded;
use bun_uws::socket_context::CaTrust;
use bun_wyhash::Wyhash;

/// The PEM strings of a `ca` option, in the order given. The process has one `CaList` per content
/// ([`CaList::intern`]), so a configuration holds its list by reference, and two configurations with the same
/// certificates hold the same allocation.
pub struct CaList {
    /// The `char **` of `us_bun_socket_context_options_t::ca`.
    pems: Box<[SensitiveCString]>,
    /// `strlen` of each.
    lens: Box<[usize]>,
    /// Of every string and the boundaries between them.
    hash: u64,
    /// What BoringSSL builds from `pems`.
    trust: CaTrust,
}

/// Every live list, by its hash and then its address. The entries are weak: a list lives as long as its holders.
static LISTS: Guarded<BTreeMap<(u64, usize), Weak<CaList>>> = Guarded::new(BTreeMap::new());

impl CaList {
    /// The list of `strings`, each of which ends at its first NUL as a C string does. Copies them only if no live
    /// list holds them already.
    pub fn intern<S: AsRef<[u8]>>(strings: &[S]) -> Arc<CaList> {
        let mut hasher = Wyhash::init(0);
        for string in strings {
            hasher.update(bun_core::slice_to_nul(string.as_ref()));
            hasher.update(&[0]);
        }
        let hash = hasher.final_();

        // Lists with this hash that are not the one asked for. A last reference runs `Drop`, which takes the lock.
        let mut not_this: Vec<Arc<CaList>> = Vec::new();
        let mut lists = LISTS.lock();
        let found = (lists.range((hash, 0)..=(hash, usize::MAX))).find_map(|(_, entry)| {
            // No list to upgrade to: its `Drop` waits for the lock to remove the entry.
            let list = entry.upgrade()?;
            if list.holds(strings) {
                return Some(list);
            }
            not_this.push(list);
            None
        });
        if let Some(list) = found {
            drop(lists);
            return list;
        }
        let pems: Box<[SensitiveCString]> = strings
            .iter()
            .map(|string| SensitiveCString::new(string.as_ref()))
            .collect();
        let lens = pems.iter().map(|pem| pem.as_bytes().len()).collect();
        // SAFETY: the list owns the strings, behind a `Box`, and never changes them.
        let trust = unsafe { CaTrust::new(pems.as_ptr().cast(), pems.len() as u32) };
        let list = Arc::new(CaList {
            pems,
            lens,
            hash,
            trust,
        });
        lists.insert((hash, Arc::as_ptr(&list) as usize), Arc::downgrade(&list));
        drop(lists);
        list
    }

    /// Whether this is the list of `strings`, as [`CaList::intern`] reads them.
    pub fn holds<S: AsRef<[u8]>>(&self, strings: &[S]) -> bool {
        if self.pems.len() != strings.len() {
            return false;
        }
        let pairs = || {
            let pems = self.pems.iter().zip(&*self.lens);
            pems.zip(strings).map(|((pem, &len), string)| {
                // SAFETY: `pem` points to `len` bytes and a NUL.
                (
                    unsafe { bun_core::ffi::slice(pem.as_ptr().cast::<u8>(), len) },
                    string.as_ref(),
                )
            })
        };
        // The lengths, then the ends of each string, then all of it: two lists of many certificates mostly differ in
        // one of them, and two certificates differ in their first bytes. `pem` has no NUL, so a string that starts
        // with it and ends there is equal to it.
        pairs().all(|(pem, string)| {
            string.len() >= pem.len() && string.get(pem.len()).is_none_or(|&next| next == 0)
        }) && pairs().all(|(pem, string)| {
            let string = &string[..pem.len()];
            let (head, tail) = (pem.len().min(64), pem.len().saturating_sub(16));
            pem[..head] == string[..head] && pem[tail..] == string[tail..]
        }) && pairs().all(|(pem, string)| pem == &string[..pem.len()])
    }

    #[inline]
    pub fn count(&self) -> usize {
        self.pems.len()
    }

    /// `count()` NUL-terminated strings.
    #[inline]
    pub fn as_ptr(&self) -> *const *const c_char {
        self.pems.as_ptr().cast()
    }

    #[inline]
    pub(crate) fn hash(&self) -> u64 {
        self.hash
    }

    #[inline]
    pub(crate) fn trust(&self) -> &CaTrust {
        &self.trust
    }
}

impl Drop for CaList {
    fn drop(&mut self) {
        let this = core::ptr::from_ref(self) as usize;
        let entry = LISTS.lock().remove(&(self.hash, this));
        drop(entry);
    }
}

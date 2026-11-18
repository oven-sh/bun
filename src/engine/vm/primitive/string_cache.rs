//! Strings that are likely to be asked for again. They are forgotten at each collection, so nothing keeps them alive.

use core::cell::{Cell, RefCell};

use bun_engine_text::{AllocError, Atom, PropertyName, StringImpl, StringRef, Text};

use crate::vm::StartsZeroed;
use crate::{FastHashSet, Gc, JsString, Vm};

const BY_ADDRESS_SIZE: usize = 512;
const BY_HASH_SIZE: usize = 512;
const PAIRS_SIZE: usize = 1024;
const PAIR_SHIFT: u32 = 48;

pub(crate) struct StringCaches {
    /// By the address of the `StringImpl`.
    by_address: [Cell<usize>; BY_ADDRESS_SIZE],
    /// Atoms.
    by_hash: [Cell<usize>; BY_HASH_SIZE],
    /// Atoms of two Latin-1 characters, which are above the address.
    pairs: [Cell<usize>; PAIRS_SIZE],
    /// Characters that a string has swapped for an atom, which a view of it may still be reading.
    retired: RefCell<Vec<(usize, StringRef)>>,
}

// SAFETY: the others are integers.
unsafe impl StartsZeroed for StringCaches {
    unsafe fn complete(this: *mut StringCaches) {
        // SAFETY: the caller's.
        unsafe { (&raw mut (*this).retired).write(RefCell::default()) }
    }
}

impl StringCaches {
    pub(super) fn retire(&self, owner: usize, string: StringRef) {
        self.retired.borrow_mut().push((owner, string));
    }

    pub(crate) fn clear(&self) {
        for cache in [&self.by_address[..], &self.by_hash, &self.pairs] {
            cache.iter().for_each(|entry| entry.set(0));
        }
    }

    pub(crate) fn release_retired(&self, cells_on_stack: &[usize]) {
        let retired = self.retired.take();
        if !retired.is_empty() {
            let on_stack: FastHashSet<usize> = cells_on_stack.iter().copied().collect();
            let kept = retired.into_iter().filter(|it| on_stack.contains(&it.0));
            self.retired.replace(kept.collect());
        }
    }
}

#[inline(always)]
fn cached(address: usize) -> Option<Gc<JsString>> {
    // SAFETY: put there since the last collection.
    (address != 0).then(|| unsafe { Gc::from_address(address) })
}

impl JsString {
    /// For a string that is likely to be asked for again. Of a symbol, the description.
    #[inline]
    pub fn from_impl_cached(vm: &Vm, string: &StringImpl) -> Gc<JsString> {
        let entry = &vm.string_caches.by_address[string.address() / 16 % BY_ADDRESS_SIZE];
        match cached(entry.get()) {
            Some(cached) if cached.fiber() == string.address() => cached,
            _ => Self::cache_impl(vm, string, entry),
        }
    }

    #[inline(never)]
    fn cache_impl(vm: &Vm, string: &StringImpl, entry: &Cell<usize>) -> Gc<JsString> {
        let result = Self::new(vm, StringRef::substring(string, 0..string.len()));
        entry.set(result.address());
        result
    }

    /// The name is no static atom.
    #[inline(always)]
    pub(super) fn from_name_cached(vm: &Vm, name: PropertyName<'_>) -> Gc<JsString> {
        let entry = &vm.string_caches.by_address[name.address() / 16 % BY_ADDRESS_SIZE];
        match cached(entry.get()) {
            Some(cached) if cached.fiber() == name.address() => cached,
            _ if name.is_symbol() || name == PropertyName::EMPTY => {
                Self::cache_impl(vm, name.string(), entry)
            }
            _ => {
                let result = Self::allocate(vm, StringRef::retain(name.string()));
                entry.set(result.address());
                result
            }
        }
    }

    /// For short text that is likely to be a property key.
    #[inline]
    pub fn try_from_text_as_atom(vm: &Vm, text: Text<'_>) -> Result<Gc<JsString>, AllocError> {
        if let Some(small) = Self::small(vm, text) {
            return Ok(small);
        }
        let hash = text.hash();
        let entry = &vm.string_caches.by_hash[hash as usize % BY_HASH_SIZE];
        if let Some(cached) = cached(entry.get())
            && let Some(atom) = cached.try_impl()
            && atom.existing_hash() == hash
            && atom.text() == text
        {
            return Ok(cached);
        }
        let result = Self::new(vm, Atom::try_with_hash(text, hash)?.into_string());
        entry.set(result.address());
        Ok(result)
    }

    /// For up to two Latin-1 characters.
    #[inline(always)]
    pub(super) fn cached_short(vm: &Vm, text: Text<'_>) -> Option<Gc<JsString>> {
        if text.len() != 2 {
            return Self::small(vm, text);
        }
        let pair = [text.at(0).try_into().ok()?, text.at(1).try_into().ok()?];
        let key = usize::from(u16::from_le_bytes(pair));
        // No two pairs of lower-case letters, or of hexadecimal digits, have the same index.
        let index = (usize::from(pair[0]) << 5 ^ usize::from(pair[1])) % PAIRS_SIZE;
        let entry = &vm.string_caches.pairs[index];
        let address = entry.get() ^ key << PAIR_SHIFT;
        if address >> PAIR_SHIFT == 0
            && let Some(cached) = cached(address)
        {
            return Some(cached);
        }
        Some(Self::cache_pair(vm, pair, entry))
    }

    #[inline(never)]
    fn cache_pair(vm: &Vm, pair: [u8; 2], entry: &Cell<usize>) -> Gc<JsString> {
        let result = Self::allocate(vm, Atom::new(Text::Latin1(&pair)).into_string());
        entry.set(result.address() | usize::from(u16::from_le_bytes(pair)) << PAIR_SHIFT);
        result
    }
}

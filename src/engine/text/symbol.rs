use core::cell::{Cell, RefCell};
use core::mem::offset_of;
use core::ptr::NonNull;

use hashbrown::HashTable;

use crate::string_impl::Buffer;
use crate::{PropertyName, StaticString, StringImpl, StringRef, Text, hash_latin1, with_text};

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
pub struct SymbolFlags(u32);

impl SymbolFlags {
    pub const NO_DESCRIPTION: u32 = 1 << 0;
    pub const REGISTERED: u32 = 1 << 1;
    pub const PRIVATE: u32 = 1 << 2;
    pub const PASSES_THROUGH_PROXIES: u32 = 1 << 3;

    pub fn has_description(self) -> bool {
        self.0 & Self::NO_DESCRIPTION == 0
    }

    pub fn is_registered(self) -> bool {
        self.0 & Self::REGISTERED != 0
    }

    pub fn is_private(self) -> bool {
        self.0 & Self::PRIVATE != 0
    }

    pub fn passes_through_proxies(self) -> bool {
        self.0 & Self::PASSES_THROUGH_PROXIES != 0
    }
}

/// The identity of a symbol. Its characters are the description, which `owner` holds.
#[repr(C)]
struct SymbolImpl {
    string: StringImpl,
    owner: NonNull<StringImpl>,
    hash: u32,
    flags: SymbolFlags,
}

pub const OFFSET_OF_SYMBOL_HASH: usize = offset_of!(SymbolImpl, hash);
pub const OFFSET_OF_SYMBOL_FLAGS: usize = offset_of!(SymbolImpl, flags);

#[inline(always)]
fn as_symbol(string: &StringImpl) -> Option<&SymbolImpl> {
    // SAFETY: the flag says that the string is the first field of a `SymbolImpl` or a `StaticSymbol`.
    string
        .is_symbol()
        .then(|| unsafe { &*core::ptr::with_exposed_provenance(string.address()) })
}

#[inline(always)]
pub(crate) fn flags(string: &StringImpl) -> Option<SymbolFlags> {
    as_symbol(string).map(|symbol| symbol.flags)
}

#[inline(always)]
pub(crate) fn identity_hash(string: &StringImpl) -> u32 {
    match as_symbol(string) {
        Some(symbol) => symbol.hash,
        None => string.existing_hash(),
    }
}

#[repr(C)]
pub struct StaticSymbol {
    string: StaticString,
    owner: usize,
    hash: u32,
    flags: SymbolFlags,
}

impl StaticSymbol {
    const fn new(description: &'static [u8], flags: u32) -> StaticSymbol {
        let hash = hash_latin1(description);
        StaticSymbol {
            string: StaticString::with_kind(description, hash, StringImpl::IS_SYMBOL),
            owner: 0,
            hash,
            flags: SymbolFlags(flags),
        }
    }

    pub(crate) const fn well_known(description: &'static [u8]) -> StaticSymbol {
        Self::new(description, 0)
    }

    pub(crate) const fn private(description: &'static [u8]) -> StaticSymbol {
        Self::new(description, SymbolFlags::PRIVATE)
    }

    pub(crate) const fn as_ptr(&'static self) -> NonNull<StringImpl> {
        NonNull::from_ref(self).cast()
    }
}

const _: () = {
    assert!(size_of::<StaticSymbol>() == size_of::<SymbolImpl>());
    assert!(offset_of!(StaticSymbol, hash) == OFFSET_OF_SYMBOL_HASH);
    assert!(offset_of!(SymbolImpl, owner) == offset_of!(crate::string_impl::SubstringImpl, owner));
};

#[derive(Clone)]
#[repr(transparent)]
pub struct SymbolRef(StringRef);

thread_local! {
    static NEXT_HASH: Cell<u32> = const { Cell::new(0) };
    /// The symbols of `Symbol.for`, by address. A symbol leaves when its last reference goes.
    static REGISTRY: RefCell<HashTable<NonNull<StringImpl>>> = const { RefCell::new(HashTable::new()) };
}

impl SymbolRef {
    fn with_flags(description: &StringImpl, flags: u32) -> SymbolRef {
        let serial = NEXT_HASH.get().wrapping_add(1);
        NEXT_HASH.set(serial);
        let kind = StringImpl::IS_SYMBOL | Buffer::Substring as u32;
        let symbol = StringImpl::boxed(SymbolImpl {
            string: with_text!(description.text(), |units| StringImpl::header(
                units.as_ptr(),
                units.len(),
                kind
            )),
            owner: StringRef::retain(description.owner()).into_raw(),
            hash: serial.wrapping_mul(0x9e37_79b1) >> StringImpl::FLAG_COUNT,
            flags: SymbolFlags(flags),
        });
        // SAFETY: the reference that the string was made with.
        SymbolRef(unsafe { StringRef::from_raw(symbol.cast()) })
    }

    pub fn new(description: &StringImpl) -> SymbolRef {
        Self::with_flags(description, 0)
    }

    pub fn without_description() -> SymbolRef {
        Self::with_flags(&StringRef::empty(), SymbolFlags::NO_DESCRIPTION)
    }

    pub fn private(description: &StringImpl) -> SymbolRef {
        Self::with_flags(description, SymbolFlags::PRIVATE)
    }

    /// `Symbol.for(key)`
    pub fn registered(key: &StringImpl) -> SymbolRef {
        let hash = spread(key.hash());
        REGISTRY.with_borrow_mut(|registry| {
            let text = key.text();
            if let Some(symbol) = registry.find(hash, |symbol| registered(symbol).text() == text) {
                return SymbolRef(StringRef::retain(registered(symbol)));
            }
            let symbol = Self::with_flags(key, SymbolFlags::REGISTERED);
            registry.insert_unique(hash, symbol.0.as_ptr(), |symbol| {
                spread(registered(symbol).hash())
            });
            symbol
        })
    }

    #[inline]
    pub fn from_string(string: &StringImpl) -> Option<SymbolRef> {
        string
            .is_symbol()
            .then(|| SymbolRef(StringRef::retain(string)))
    }

    #[inline(always)]
    pub fn name(&self) -> PropertyName<'_> {
        // SAFETY: a symbol, which `self` keeps alive.
        unsafe { PropertyName::from_raw(self.0.as_ptr()) }
    }

    pub fn flags(&self) -> SymbolFlags {
        flags(&self.0).expect("a symbol")
    }

    pub fn description(&self) -> Option<Text<'_>> {
        self.flags().has_description().then(|| self.0.text())
    }

    /// The description as a string that is no symbol.
    pub fn description_string(&self) -> Option<StringRef> {
        self.flags()
            .has_description()
            .then(|| StringRef::substring(&self.0, 0..self.0.len()))
    }

    #[inline(always)]
    pub fn into_string(self) -> StringRef {
        self.0
    }
}

fn registered(symbol: &NonNull<StringImpl>) -> &StringImpl {
    // SAFETY: a symbol is taken out of the registry before it is freed.
    unsafe { symbol.as_ref() }
}

fn spread(hash: u32) -> u64 {
    u64::from(hash).wrapping_mul(0x9e37_79b9_7f4a_7c15)
}

pub(crate) fn unregister(symbol: &StringImpl) {
    if !flags(symbol).is_some_and(SymbolFlags::is_registered) {
        return;
    }
    // The registry is gone once its thread has ended.
    let _ = REGISTRY.try_with(|registry| {
        let is_same = |entry: &NonNull<StringImpl>| entry.addr().get() == symbol.address();
        if let Ok(entry) = registry
            .borrow_mut()
            .find_entry(spread(symbol.hash()), is_same)
        {
            entry.remove();
        }
    });
}

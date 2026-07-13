#![allow(unexpected_cfgs)] // `bun_codegen_embed` is set via RUSTFLAGS (scripts/build/rust.ts) for release/CI builds.

// REFACTOR_BUN_AST: this module holds only the data-shaped runtime pieces
// that the AST crate (and `bun_js_printer::Options`) need:
// `Runtime::source_code`, `Imports`, `ReplaceableExport*`, `ServerComponentsMode`.
// The `Features` struct (carries `&mut RuntimeTranspilerCache`) and
// `Fallback` HTML rendering (needs `bun_options_types::schema`, `bun_io`,
// `bun_base64`) live in `bun_js_parser::parser::Runtime` to avoid the
// `bun_options_types → bun_ast → bun_options_types` cycle.

use bun_collections::StringArrayHashMap;
use bun_wyhash::Wyhash11;

use crate::{Expr, Ref};

// ───────────────────────────── Runtime ─────────────────────────────

pub struct Runtime;

impl Runtime {
    pub fn source_code() -> &'static [u8] {
        bun_core::runtime_embed_file!(Codegen, "runtime.out.js").as_bytes()
    }

    pub fn version_hash() -> u32 {
        let hash = Wyhash11::hash(0, Self::source_code());
        hash as u32 // @truncate
    }
}

#[derive(Clone)]
pub enum ReplaceableExport {
    Delete,
    Replace(Expr),
    /// Owns the name bytes (constructed from an owned slice in
    /// `JSTranspiler`; the parser copies into its bump arena when consuming).
    Inject {
        name: Box<[u8]>,
        value: Expr,
    },
}

impl ReplaceableExport {
    #[inline]
    pub fn is_replace(&self) -> bool {
        matches!(self, Self::Replace(_))
    }
}

/// Newtype (not a bare alias) so we can hang `get_ptr` (which borrows
/// immutably) and expose a `.entries` accessor that satisfies the
/// `replace_exports.entries.len` shape used by `visitStmt`.
#[derive(Default)]
pub struct ReplaceableExportMap {
    /// Backing map. Named `entries` so `replace_exports.entries.len()`
    /// resolves (`StringArrayHashMap` derefs to `ArrayHashMap`, which has
    /// `.len()`).
    pub entries: StringArrayHashMap<ReplaceableExport>,
}

impl core::ops::Deref for ReplaceableExportMap {
    type Target = StringArrayHashMap<ReplaceableExport>;
    #[inline]
    fn deref(&self) -> &Self::Target {
        &self.entries
    }
}
impl core::ops::DerefMut for ReplaceableExportMap {
    #[inline]
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.entries
    }
}

impl ReplaceableExportMap {
    #[inline]
    pub fn count(&self) -> usize {
        self.entries.count()
    }
    /// Immutable lookup (`&V`); `get_ptr_mut` is the `&mut V` form. Call
    /// sites in the visitor only read through it.
    #[inline]
    pub fn get_ptr(&self, key: &[u8]) -> Option<&ReplaceableExport> {
        self.entries.get(key)
    }
    #[inline]
    pub fn get_ptr_mut(&mut self, key: &[u8]) -> Option<&mut ReplaceableExport> {
        self.entries.get_ptr_mut(key)
    }
    #[inline]
    pub fn contains(&self, key: &[u8]) -> bool {
        self.entries.contains(key)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ReactCompilerMode {
    #[default]
    Disabled,
    Client,
    Ssr,
}

impl ReactCompilerMode {
    #[inline]
    pub fn is_enabled(self) -> bool {
        !matches!(self, Self::Disabled)
    }
    #[inline]
    pub fn is_ssr(self) -> bool {
        matches!(self, Self::Ssr)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum ServerComponentsMode {
    /// Server components is disabled, strings "use client" and "use server" mean nothing.
    #[default]
    None,
    /// This is a server-side file outside of the SSR graph, but not a "use server" file.
    /// - Handle functions with "use server", creating secret exports for them.
    WrapAnonServerFunctions,
    /// This is a "use client" file on the server, and separate_ssr_graph is off.
    /// - Wrap all exports in a call to `registerClientReference`
    /// - Ban "use server" functions???
    WrapExportsForClientReference,
    /// This is a "use server" file on the server
    /// - Wrap all exports in a call to `registerServerReference`
    /// - Ban "use server" functions, since this directive is already applied.
    WrapExportsForServerReference,
    /// This is a client side file.
    /// - Ban "use server" functions since it is on the client-side
    ClientSide,
}

impl ServerComponentsMode {
    pub fn is_server_side(self) -> bool {
        matches!(
            self,
            Self::WrapExportsForServerReference | Self::WrapAnonServerFunctions
        )
    }

    pub fn wraps_exports(self) -> bool {
        matches!(
            self,
            Self::WrapExportsForClientReference | Self::WrapExportsForServerReference
        )
    }

    #[inline]
    pub fn is_enabled(self) -> bool {
        !matches!(self, Self::None)
    }
}

// ─────────────────────────── Runtime.Imports ───────────────────────────

// If you change this, remember to update "runtime.js"
#[allow(non_snake_case)]
#[derive(Default, Clone)]
pub struct Imports {
    pub __name: Ref,
    pub __require: Ref,
    pub __export: Ref,
    pub __reExport: Ref,
    pub __exportValue: Ref,
    pub __exportDefault: Ref,
    // __refreshRuntime: ?GeneratedSymbol = null,
    // __refreshSig: ?GeneratedSymbol = null, // $RefreshSig$
    pub __merge: Ref,
    pub __legacyDecorateClassTS: Ref,
    pub __legacyDecorateParamTS: Ref,
    pub __legacyMetadataTS: Ref,
    pub __publicField: Ref,
    pub __privateIn: Ref,
    pub __privateGet: Ref,
    pub __privateAdd: Ref,
    pub __privateSet: Ref,
    pub __privateMethod: Ref,
    pub __decoratorStart: Ref,
    pub __decoratorMetadata: Ref,
    pub __runInitializers: Ref,
    pub __decorateElement: Ref,
    /// The `$$typeof` runtime import (`$$typeof` is not a valid Rust identifier).
    pub dollar_dollar_typeof: Ref,
    pub __using: Ref,
    pub __callDispose: Ref,
    pub __jsonParse: Ref,
    pub __promiseAll: Ref,
    pub __MEMO_CACHE_SENTINEL: Ref,
    pub __EARLY_RETURN_SENTINEL: Ref,
}

impl Imports {
    pub const ALL: [&'static [u8]; 27] = [
        b"__name",
        b"__require",
        b"__export",
        b"__reExport",
        b"__exportValue",
        b"__exportDefault",
        b"__merge",
        b"__legacyDecorateClassTS",
        b"__legacyDecorateParamTS",
        b"__legacyMetadataTS",
        b"__publicField",
        b"__privateIn",
        b"__privateGet",
        b"__privateAdd",
        b"__privateSet",
        b"__privateMethod",
        b"__decoratorStart",
        b"__decoratorMetadata",
        b"__runInitializers",
        b"__decorateElement",
        b"$$typeof",
        b"__using",
        b"__callDispose",
        b"__jsonParse",
        b"__promiseAll",
        b"__MEMO_CACHE_SENTINEL",
        b"__EARLY_RETURN_SENTINEL",
    ];

    /// Rust stable cannot sort in `const`; precomputed here and verified by
    /// the test in `tests` below.
    #[cfg_attr(not(test), allow(dead_code))]
    const ALL_SORTED: [&'static [u8]; 27] = [
        b"$$typeof",
        b"__EARLY_RETURN_SENTINEL",
        b"__MEMO_CACHE_SENTINEL",
        b"__callDispose",
        b"__decorateElement",
        b"__decoratorMetadata",
        b"__decoratorStart",
        b"__export",
        b"__exportDefault",
        b"__exportValue",
        b"__jsonParse",
        b"__legacyDecorateClassTS",
        b"__legacyDecorateParamTS",
        b"__legacyMetadataTS",
        b"__merge",
        b"__name",
        b"__privateAdd",
        b"__privateGet",
        b"__privateIn",
        b"__privateMethod",
        b"__privateSet",
        b"__promiseAll",
        b"__publicField",
        b"__reExport",
        b"__require",
        b"__runInitializers",
        b"__using",
    ];

    /// When generating the list of runtime imports, we sort it for determinism.
    /// This is a lookup table so we don't need to resort the strings each time
    pub const ALL_SORTED_INDEX: [usize; 27] = [
        15, // __name
        24, // __require
        7,  // __export
        23, // __reExport
        9,  // __exportValue
        8,  // __exportDefault
        14, // __merge
        11, // __legacyDecorateClassTS
        12, // __legacyDecorateParamTS
        13, // __legacyMetadataTS
        22, // __publicField
        18, // __privateIn
        17, // __privateGet
        16, // __privateAdd
        20, // __privateSet
        19, // __privateMethod
        6,  // __decoratorStart
        5,  // __decoratorMetadata
        25, // __runInitializers
        4,  // __decorateElement
        0,  // $$typeof
        26, // __using
        3,  // __callDispose
        10, // __jsonParse
        21, // __promiseAll
        2,  // __MEMO_CACHE_SENTINEL
        1,  // __EARLY_RETURN_SENTINEL
    ];

    pub const NAME: &'static [u8] = b"bun:wrap";

    /// Index → field.
    #[inline]
    fn field(&self, i: usize) -> Option<Ref> {
        let r = match i {
            0 => self.__name,
            1 => self.__require,
            2 => self.__export,
            3 => self.__reExport,
            4 => self.__exportValue,
            5 => self.__exportDefault,
            6 => self.__merge,
            7 => self.__legacyDecorateClassTS,
            8 => self.__legacyDecorateParamTS,
            9 => self.__legacyMetadataTS,
            10 => self.__publicField,
            11 => self.__privateIn,
            12 => self.__privateGet,
            13 => self.__privateAdd,
            14 => self.__privateSet,
            15 => self.__privateMethod,
            16 => self.__decoratorStart,
            17 => self.__decoratorMetadata,
            18 => self.__runInitializers,
            19 => self.__decorateElement,
            20 => self.dollar_dollar_typeof,
            21 => self.__using,
            22 => self.__callDispose,
            23 => self.__jsonParse,
            24 => self.__promiseAll,
            25 => self.__MEMO_CACHE_SENTINEL,
            26 => self.__EARLY_RETURN_SENTINEL,
            _ => return None,
        };
        r.to_nullable()
    }

    #[inline]
    fn field_mut(&mut self, i: usize) -> Option<&mut Ref> {
        match i {
            0 => Some(&mut self.__name),
            1 => Some(&mut self.__require),
            2 => Some(&mut self.__export),
            3 => Some(&mut self.__reExport),
            4 => Some(&mut self.__exportValue),
            5 => Some(&mut self.__exportDefault),
            6 => Some(&mut self.__merge),
            7 => Some(&mut self.__legacyDecorateClassTS),
            8 => Some(&mut self.__legacyDecorateParamTS),
            9 => Some(&mut self.__legacyMetadataTS),
            10 => Some(&mut self.__publicField),
            11 => Some(&mut self.__privateIn),
            12 => Some(&mut self.__privateGet),
            13 => Some(&mut self.__privateAdd),
            14 => Some(&mut self.__privateSet),
            15 => Some(&mut self.__privateMethod),
            16 => Some(&mut self.__decoratorStart),
            17 => Some(&mut self.__decoratorMetadata),
            18 => Some(&mut self.__runInitializers),
            19 => Some(&mut self.__decorateElement),
            20 => Some(&mut self.dollar_dollar_typeof),
            21 => Some(&mut self.__using),
            22 => Some(&mut self.__callDispose),
            23 => Some(&mut self.__jsonParse),
            24 => Some(&mut self.__promiseAll),
            25 => Some(&mut self.__MEMO_CACHE_SENTINEL),
            26 => Some(&mut self.__EARLY_RETURN_SENTINEL),
            _ => None,
        }
    }

    pub fn iter(&self) -> ImportsIterator<'_> {
        ImportsIterator {
            i: 0,
            runtime_imports: self,
        }
    }

    /// Callers that know the key statically can read the field directly
    /// (`!imports.__foo.is_empty()`); this is the runtime-keyed equivalent.
    pub fn contains(&self, key: &[u8]) -> bool {
        Self::ALL
            .iter()
            .position(|&k| k == key)
            .and_then(|i| self.field(i))
            .is_some()
    }

    pub fn has_any(&self) -> bool {
        for i in 0..Self::ALL.len() {
            if self.field(i).is_some() {
                return true;
            }
        }
        false
    }

    /// Callers that know the key statically can assign the field directly;
    /// this is the runtime-keyed equivalent.
    pub fn put(&mut self, key: &[u8], ref_: Ref) {
        if let Some(i) = Self::ALL.iter().position(|&k| k == key) {
            if let Some(slot) = self.field_mut(i) {
                *slot = ref_;
            }
        }
    }

    /// Callers that know the key statically can read the field directly;
    /// this is the runtime-keyed equivalent.
    pub fn at(&self, key: &[u8]) -> Option<Ref> {
        Self::ALL
            .iter()
            .position(|&k| k == key)
            .and_then(|i| self.field(i))
    }

    /// Lookup by runtime index.
    pub fn get(&self, key: usize) -> Option<Ref> {
        if key < Self::ALL.len() {
            self.field(key)
        } else {
            None
        }
    }

    pub fn count(&self) -> usize {
        let mut n: usize = 0;
        for i in 0..Self::ALL.len() {
            if self.field(i).is_some() {
                n += 1;
            }
        }
        n
    }
}

pub struct ImportsIterator<'a> {
    pub i: usize,
    pub runtime_imports: &'a Imports,
}

#[derive(Clone, Copy)]
pub struct ImportsIteratorEntry {
    pub key: u16,
    pub value: Ref,
}

impl ImportsIterator<'_> {
    pub fn next(&mut self) -> Option<ImportsIteratorEntry> {
        while self.i < Imports::ALL.len() {
            let t = self.i;
            self.i += 1;
            if let Some(val) = self.runtime_imports.field(t) {
                return Some(ImportsIteratorEntry {
                    key: u16::try_from(t).expect("int cast"),
                    value: val,
                });
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::Imports;

    /// The tables above are hand-precomputed (Rust stable cannot sort in
    /// `const`); this test re-derives them at runtime and asserts they match.
    #[test]
    fn all_sorted_matches_zig_comptime() {
        let mut list = Imports::ALL;
        list.sort_unstable();
        assert_eq!(
            list,
            Imports::ALL_SORTED,
            "ALL_SORTED drifted from sorted(ALL)"
        );

        let mut out = [0usize; Imports::ALL.len()];
        for (i, name) in Imports::ALL.iter().enumerate() {
            for (j, cmp) in list.iter().enumerate() {
                if name == cmp {
                    out[i] = j;
                    break;
                }
            }
        }
        assert_eq!(
            out,
            Imports::ALL_SORTED_INDEX,
            "ALL_SORTED_INDEX drifted from derivation"
        );
    }
}

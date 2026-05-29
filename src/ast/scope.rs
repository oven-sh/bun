use bun_alloc::{AstAlloc, AstVec};
use bun_collections::{StringHashMap, VecExt};

use crate::StrictModeKind;
use crate::base::Ref;
use crate::nodes::StoreRef;
use crate::symbol::{self, Symbol};
use crate::ts::TSNamespaceScope;

pub(crate) type MemberHashMap = StringHashMap<Member, AstAlloc>;

pub struct Scope {
    pub id: usize,
    pub kind: Kind,
    // BACKREF: parent owns this scope via `children`. `StoreRef` (arena
    // back-pointer with safe `Deref`/`DerefMut`) so callers don't open-code
    // `unsafe { &*parent.as_ptr() }` at every walk site.
    pub parent: Option<StoreRef<Scope>>,
    /// `AstVec` for the same reason as `members` above — Zig's
    /// `ArrayListUnmanaged(*Scope)` was arena-backed. Elements are `StoreRef`
    /// so iteration yields safe `Deref` instead of `unsafe { child.as_ref() }`.
    pub children: AstVec<StoreRef<Scope>>,
    pub members: MemberHashMap,
    /// `AstVec`: Zig `ArrayListUnmanaged(Ref)`, arena-backed.
    pub generated: AstVec<Ref>,

    // This is used to store the ref of the label symbol for ScopeLabel scopes.
    pub label_ref: Option<Ref>,
    pub label_stmt_is_loop: bool,

    // If a scope contains a direct eval() expression, then none of the symbols
    // inside that scope can be renamed. We conservatively assume that the
    // evaluated code might reference anything that it has access to.
    pub contains_direct_eval: bool,

    // This is to help forbid "arguments" inside class body scopes
    pub forbid_arguments: bool,

    pub strict_mode: StrictModeKind,

    pub is_after_const_local_prefix: bool,

    // This will be non-null if this is a TypeScript "namespace" or "enum"
    // ARENA: allocated from p.arena, never freed per-field. `StoreRef` so
    // callers read `scope.ts_namespace?.exported_members` safely.
    pub ts_namespace: Option<StoreRef<TSNamespaceScope>>,
}

impl Scope {
    pub const EMPTY: Self = Self {
        id: 0,
        kind: Kind::Block,
        parent: None,
        children: AstAlloc::vec(),
        members: MemberHashMap::new_in(AstAlloc),
        generated: AstAlloc::vec(),
        label_ref: None,
        label_stmt_is_loop: false,
        contains_direct_eval: false,
        forbid_arguments: false,
        strict_mode: StrictModeKind::SloppyMode,
        is_after_const_local_prefix: false,
        ts_namespace: None,
    };
}

impl Default for Scope {
    #[inline]
    fn default() -> Self {
        Self::EMPTY
    }
}

impl Scope {
    pub fn get_member_hash(name: &[u8]) -> u64 {
        bun_wyhash::auto_hash::<[u8]>(name)
    }
    pub fn get_member_with_hash(&self, name: &[u8], hash_value: u64) -> Option<Member> {
        debug_assert_eq!(
            self.members.hash_key(name),
            hash_value,
            "Scope::get_member_hash diverged from StringHashMap's BuildHasher"
        );
        self.members.get_hashed(hash_value, name).copied()
    }
    pub fn get_or_put_member_with_hash(
        &mut self,
        name: &[u8],
        hash_value: u64,
    ) -> bun_collections::array_hash_map::StringHashMapGetOrPut<'_, Member> {
        // PERF(port): `get_or_put_borrowed` doesn't accept a precomputed hash;
        // this path is once-per-declared-symbol (not per-scope-per-identifier),
        // so the redundant rehash is left as-is.
        let _ = hash_value;
        // SAFETY: `name` is always a slice into either the source-file contents
        // or the lexer string-table (the only producers of identifier text in
        // the parser). Both outlive the `AstAlloc` arena that owns this
        // `Scope`, so storing the slice by reference (Zig's
        // `StringHashMapUnmanaged` semantics) is sound — the map is freed by
        // the same arena reset that would invalidate the source/string-table.
        // This avoids one `mi_heap_malloc` per declared identifier per scope,
        // which profiling showed as the parser's hottest slow-path allocation.
        unsafe { self.members.get_or_put_borrowed(name) }
    }

    pub fn reset(&mut self) {
        self.children.clear_retaining_capacity();
        self.generated.clear_retaining_capacity();
        self.members.clear();
        self.parent = None;
        self.id = 0;
        self.label_ref = None;
        self.label_stmt_is_loop = false;
        self.contains_direct_eval = false;
        self.strict_mode = StrictModeKind::SloppyMode;
        self.kind = Kind::Block;
    }

    #[inline]
    pub fn can_merge_symbols<const IS_TYPESCRIPT_ENABLED: bool>(
        &self,
        existing: symbol::Kind,
        new: symbol::Kind,
    ) -> SymbolMergeResult {
        Self::can_merge_symbol_kinds::<IS_TYPESCRIPT_ENABLED>(self.kind, existing, new)
    }

    pub fn can_merge_symbol_kinds<const IS_TYPESCRIPT_ENABLED: bool>(
        scope_kind: Kind,
        existing: symbol::Kind,
        new: symbol::Kind,
    ) -> SymbolMergeResult {
        use symbol::Kind as Sk;

        if existing == Sk::Unbound {
            return SymbolMergeResult::ReplaceWithNew;
        }

        if IS_TYPESCRIPT_ENABLED {
            if existing == Sk::Import {
                return SymbolMergeResult::ReplaceWithNew;
            }

            // "enum Foo {} enum Foo {}"
            // "namespace Foo { ... } enum Foo {}"
            if new == Sk::TsEnum && (existing == Sk::TsEnum || existing == Sk::TsNamespace) {
                return SymbolMergeResult::ReplaceWithNew;
            }

            // "namespace Foo { ... } namespace Foo { ... }"
            // "function Foo() {} namespace Foo { ... }"
            // "enum Foo {} namespace Foo { ... }"
            if new == Sk::TsNamespace {
                match existing {
                    Sk::TsNamespace
                    | Sk::TsEnum
                    | Sk::HoistedFunction
                    | Sk::GeneratorOrAsyncFunction
                    | Sk::Class => return SymbolMergeResult::KeepExisting,
                    _ => {}
                }
            }
        }

        if Symbol::is_kind_hoisted_or_function(new)
            && Symbol::is_kind_hoisted_or_function(existing)
            && (scope_kind == Kind::Entry
                || scope_kind == Kind::FunctionBody
                || scope_kind == Kind::FunctionArgs
                || (new == existing && Symbol::is_kind_hoisted(existing)))
        {
            return SymbolMergeResult::ReplaceWithNew;
        }

        // "get #foo() {} set #foo() {}"
        // "set #foo() {} get #foo() {}"
        if (existing == Sk::PrivateGet && new == Sk::PrivateSet)
            || (existing == Sk::PrivateSet && new == Sk::PrivateGet)
        {
            return SymbolMergeResult::BecomePrivateGetSetPair;
        }
        if (existing == Sk::PrivateStaticGet && new == Sk::PrivateStaticSet)
            || (existing == Sk::PrivateStaticSet && new == Sk::PrivateStaticGet)
        {
            return SymbolMergeResult::BecomePrivateStaticGetSetPair;
        }

        // "try {} catch (e) { var e }"
        if existing == Sk::CatchIdentifier && new == Sk::Hoisted {
            return SymbolMergeResult::ReplaceWithNew;
        }

        // "function() { var arguments }"
        if existing == Sk::Arguments && new == Sk::Hoisted {
            return SymbolMergeResult::KeepExisting;
        }

        // "function() { let arguments }"
        if existing == Sk::Arguments && new != Sk::Hoisted {
            return SymbolMergeResult::OverwriteWithNew;
        }

        SymbolMergeResult::Forbidden
    }

    pub fn recursive_set_strict_mode(&mut self, kind: StrictModeKind) {
        if self.strict_mode == StrictModeKind::SloppyMode {
            self.strict_mode = kind;
            for child in self.children.slice_mut() {
                child.recursive_set_strict_mode(kind);
            }
        }
    }

    #[inline]
    pub fn kind_stops_hoisting(&self) -> bool {
        self.kind as u8 >= Kind::Entry as u8
    }
}

// Do not make this a packed struct
// Two hours of debugging time lost to that.
// It causes a crash due to undefined memory
#[derive(Clone, Copy, Default)]
pub struct Member {
    pub ref_: Ref,
    pub loc: crate::Loc,
}

impl Member {
    #[inline]
    pub fn eql(a: Member, b: Member) -> bool {
        // PERF(port): Zig used @call(bun.callmod_inline, Ref.eql, ...) — forced inline.
        a.ref_.eql(b.ref_) && a.loc.start == b.loc.start
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SymbolMergeResult {
    Forbidden,
    ReplaceWithNew,
    OverwriteWithNew,
    KeepExisting,
    BecomePrivateGetSetPair,
    BecomePrivateStaticGetSetPair,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum Kind {
    Block,
    With,
    Label,
    ClassName,
    ClassBody,
    CatchBinding,

    // The scopes below stop hoisted variables from extending into parent scopes
    Entry, // This is a module, TypeScript enum, or TypeScript namespace
    FunctionArgs,
    FunctionBody,
    ClassStaticInit,
}

// ported from: src/js_parser/ast/Scope.zig

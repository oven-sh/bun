use bun_alloc::{AstAlloc, AstVec};
use bun_collections::{ArrayHashMap, StringHashMap, VecExt};

use crate::StrictModeKind;
use crate::base::Ref;
use crate::nodes::StoreRef;
use crate::symbol::{self, Symbol};
use crate::ts::TSNamespaceScope;

/// Backed by `AstAlloc` so the table allocation *and* the per-key boxes land
/// in the thread-local AST `mi_heap` and are reclaimed by the same
/// `mi_heap_destroy` that frees the arena-allocated `Scope` holding the map.
/// In Zig this was `bun.StringHashMapUnmanaged(Member)` whose backing array
/// lived in the parser arena; the original Rust port placed both on the
/// global heap, and since `Scope` itself sits in an arena slot whose `Drop`
/// never runs, every member map leaked.
pub type MemberHashMap = StringHashMap<Member, AstAlloc>;

// PORT NOTE: Zig `Scope` is a value type — `Ast.module_scope` / `BundledAst.module_scope`
// hold it by value and `toAST` / `init` bitwise-copy it (`this.module_scope`). Vec no
// longer derives `Clone` (private `origin` field); callers that need a shallow copy must
// `core::mem::take` or `core::ptr::read` instead.
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
    /// All-empty `Scope` as a `const`. Used with struct-update syntax in the
    /// parser's per-scope allocation hot path (`push_scope_for_parse_pass`
    /// runs once per `{}` / function / class body) so the unspecified fields
    /// are filled by a compile-time bit pattern instead of the runtime
    /// `Default::default()` chain — i.e. no temporary `Scope` is constructed
    /// and partially dropped, and `members`/`children`/`generated` come from a
    /// const-folded zero header rather than three out-of-line `default()`
    /// calls. `AstAlloc::vec` and `StringHashMap::new_in` are both `const fn`.
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

pub type NestedScopeMap = ArrayHashMap<u32, Vec<StoreRef<Scope>>>;

impl Scope {
    // PERF(port): the parser's hot path computes the wyhash once and reuses it
    // for lookup+insert; `StringHashMap`'s current `std::HashMap` backing
    // ignores the precomputed hash (see `get_adapted` doc), so the rehash
    // avoidance is lost until that map moves onto a wyhash-backed table.
    pub fn get_member_hash(name: &[u8]) -> u64 {
        bun_collections::string_hash_map::hash(name)
    }
    pub fn get_member_with_hash(&self, name: &[u8], hash_value: u64) -> Option<Member> {
        let hashed = bun_collections::string_hash_map::Prehashed {
            value: hash_value,
            input: name,
        };
        self.members.get_adapted(name, &hashed).copied()
    }
    pub fn get_or_put_member_with_hash(
        &mut self,
        name: &[u8],
        hash_value: u64,
    ) -> bun_collections::array_hash_map::StringHashMapGetOrPut<'_, Member> {
        let _ = hash_value; // PERF(port): see `StringHashMap::get_adapted` note.
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

    /// Associated-fn form of [`can_merge_symbols`] taking the scope's [`Kind`]
    /// by value instead of `&self`. Lets the parser hold a single-probe
    /// `members.entry()` borrow across the merge decision without re-borrowing
    /// the whole `Scope` (which would alias the live entry under Stacked
    /// Borrows). The method body only ever read `self.kind`.
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
            // In TypeScript, imports are allowed to silently collide with symbols within
            // the module. Presumably this is because the imports may be type-only:
            //
            //   import {Foo} from 'bar'
            //   class Foo {}
            //
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

        // "var foo; var foo;"
        // "var foo; function foo() {}"
        // "function foo() {} var foo;"
        // "function *foo() {} function *foo() {}" but not "{ function *foo() {} function *foo() {} }"
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

impl Kind {
    // TODO(port): std.json.Stringify protocol — confirm Rust-side json writer trait.
    pub fn json_stringify(self, writer: &mut impl core::fmt::Write) -> core::fmt::Result {
        // Zig: writer.write(@tagName(self)) — std.json writer wraps strings in quotes.
        write!(writer, "\"{}\"", <&'static str>::from(self))
    }
}

// ported from: src/js_parser/ast/Scope.zig

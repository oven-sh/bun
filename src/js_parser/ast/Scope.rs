use core::ptr::NonNull;

use bun_collections::{ArrayHashMap, BabyList, StringHashMap};
use bun_logger as logger;

use crate::ast::{Ref, StrictModeKind, Symbol, TSNamespaceScope};
use crate::ast::symbol;

pub type MemberHashMap = StringHashMap<Member>;

pub struct Scope {
    pub id: usize,
    pub kind: Kind,
    // BACKREF: parent owns this scope via `children`; raw back-pointer.
    pub parent: Option<NonNull<Scope>>,
    pub children: BabyList<NonNull<Scope>>,
    pub members: MemberHashMap,
    pub generated: BabyList<Ref>,

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
    // ARENA: allocated from p.allocator, never freed per-field.
    pub ts_namespace: Option<NonNull<TSNamespaceScope>>,
}

impl Default for Scope {
    fn default() -> Self {
        Self {
            id: 0,
            kind: Kind::Block,
            parent: None,
            children: BabyList::default(),
            members: MemberHashMap::default(),
            generated: BabyList::default(),
            label_ref: None,
            label_stmt_is_loop: false,
            contains_direct_eval: false,
            forbid_arguments: false,
            strict_mode: StrictModeKind::SloppyMode,
            is_after_const_local_prefix: false,
            ts_namespace: None,
        }
    }
}

pub type NestedScopeMap = ArrayHashMap<u32, BabyList<NonNull<Scope>>>;

impl Scope {
    pub fn get_member_hash(name: &[u8]) -> u64 {
        // TODO(port): bun.StringHashMapContext.hash — confirm bun_collections exposes this.
        bun_collections::string_hash_map::hash(name)
    }

    pub fn get_member_with_hash(&self, name: &[u8], hash_value: u64) -> Option<Member> {
        // TODO(port): StringHashMap prehashed-adapter lookup API name.
        let hashed = bun_collections::string_hash_map::Prehashed {
            value: hash_value,
            input: name,
        };
        self.members.get_adapted(name, hashed).copied()
    }

    pub fn get_or_put_member_with_hash<'bump>(
        &mut self,
        bump: &'bump bun_alloc::Arena,
        name: &[u8],
        hash_value: u64,
    ) -> Result<bun_collections::string_hash_map::GetOrPutResult<'_, Member>, bun_alloc::AllocError>
    {
        // TODO(port): StringHashMap prehashed get-or-put API; allocator threading
        // (Zig passed `allocator` per-call for the unmanaged map; AST-crate arena here).
        let hashed = bun_collections::string_hash_map::Prehashed {
            value: hash_value,
            input: name,
        };
        self.members.get_or_put_context_adapted(bump, name, hashed)
    }

    pub fn reset(&mut self) {
        self.children.clear();
        self.generated.clear();
        self.members.clear();
        self.parent = None;
        self.id = 0;
        self.label_ref = None;
        self.label_stmt_is_loop = false;
        self.contains_direct_eval = false;
        self.strict_mode = StrictModeKind::SloppyMode;
        self.kind = Kind::Block;
    }

    pub fn can_merge_symbols<const IS_TYPESCRIPT_ENABLED: bool>(
        &self,
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
            && (self.kind == Kind::Entry
                || self.kind == Kind::FunctionBody
                || self.kind == Kind::FunctionArgs
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
            for child in self.children.slice() {
                // SAFETY: children are arena-allocated scopes owned by the parser;
                // valid for the lifetime of the scope tree (BACKREF graph).
                unsafe { child.as_ptr().as_mut().unwrap() }.recursive_set_strict_mode(kind);
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
#[derive(Clone, Copy)]
pub struct Member {
    pub ref_: Ref,
    pub loc: logger::Loc,
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/Scope.zig (220 lines)
//   confidence: medium
//   todos:      4
//   notes:      StringHashMap prehashed-adapter API (hash/get_adapted/get_or_put) assumed; children/parent are arena raw ptrs per LIFETIMES.tsv
// ──────────────────────────────────────────────────────────────────────────

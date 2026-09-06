use bun_alloc::{AstAlloc, AstVec};
use bun_collections::VecExt;

use crate::StrictModeKind;
use crate::base::Ref;
use crate::nodes::StoreRef;
use crate::symbol::{self, Symbol};
use crate::ts::TSNamespaceScope;

/// One binding of a scope in a `Members::Table`: its name (a slice of the
/// source text or the lexer's string table, which outlive the arena holding
/// the scope), the name's `Members::hash`, and the symbol.
#[derive(Clone, Copy)]
pub struct MemberEntry {
    pub name: crate::StoreStr,
    hash: u32,
    pub member: Member,
}

/// Up to `N` bindings, hashes first so that a lookup that misses (the common
/// case while resolving an identifier up the scope chain) reads one cache
/// line. Scopes start with `N = 4` (most have no more) and move to `N = 8`
/// before becoming a table.
pub struct InlineMembers<const N: usize> {
    hashes: [u32; N],
    len: u32,
    members: [Member; N],
    names: [crate::StoreStr; N],
}

impl<const N: usize> InlineMembers<N> {
    fn new() -> Self {
        InlineMembers {
            hashes: [0; N],
            len: 0,
            members: [Member::EMPTY; N],
            names: [crate::StoreStr::EMPTY; N],
        }
    }

    /// Bit `i` set: entry `i` has this hash.
    #[inline]
    fn matches(&self, hash: u32) -> u32 {
        let mut mask = 0u32;
        for (i, h) in self.hashes.iter().enumerate() {
            mask |= u32::from(*h == hash) << i;
        }
        mask & ((1u32 << self.len) - 1)
    }

    #[inline]
    fn find(&self, hash: u32, name: &[u8]) -> Option<usize> {
        let mut mask = self.matches(hash);
        while mask != 0 {
            let i = mask.trailing_zeros() as usize;
            if self.names[i].slice() == name {
                return Some(i);
            }
            mask &= mask - 1;
        }
        None
    }

    /// Caller checks `len < N`.
    #[inline]
    fn push(&mut self, hash: u32, name: &[u8]) -> usize {
        let i = self.len as usize;
        self.hashes[i] = hash;
        self.names[i] = crate::StoreStr::new(name);
        self.members[i] = Member::default();
        self.len += 1;
        i
    }

    fn grow<const M: usize>(&self) -> InlineMembers<M> {
        let mut out = InlineMembers::<M>::new();
        let n = self.len as usize;
        out.hashes[..n].copy_from_slice(&self.hashes[..n]);
        out.members[..n].copy_from_slice(&self.members[..n]);
        out.names[..n].copy_from_slice(&self.names[..n]);
        out.len = self.len;
        out
    }
}

/// A scope's bindings by name. Most scopes bind a handful of names, so they
/// start as a short inline array and only become a hash table past
/// `INLINE_MAX`. Both live in `AstAlloc` (freed with the arena holding the
/// `Scope`; a `Scope`'s `Drop` never runs).
#[derive(Default)]
pub enum Members {
    #[default]
    Empty,
    /// In declaration order.
    Small(bun_alloc::AstBox<InlineMembers<4>>),
    Inline(bun_alloc::AstBox<InlineMembers<8>>),
    Table(bun_collections::hashbrown::HashTable<MemberEntry, AstAlloc>),
}

pub struct MembersGetOrPut<'a> {
    pub found_existing: bool,
    pub value_ptr: &'a mut Member,
}

pub enum MembersIter<'a> {
    Inline(&'a [crate::StoreStr], &'a [Member], usize),
    Table(bun_collections::hashbrown::hash_table::Iter<'a, MemberEntry>),
}

impl<'a> Iterator for MembersIter<'a> {
    type Item = (&'a [u8], &'a Member);

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        match self {
            MembersIter::Inline(names, members, i) => {
                let item = (names.get(*i)?.slice(), &members[*i]);
                *i += 1;
                Some(item)
            }
            MembersIter::Table(it) => it.next().map(|e| (e.name.slice(), &e.member)),
        }
    }
}

impl Members {
    pub const EMPTY: Members = Members::Empty;
    pub const INLINE_MAX: usize = 8;

    /// The low 32 bits of wyhash. A match is always confirmed by comparing
    /// the names. `Table` feeds `hashbrown` the value widened, since it takes
    /// its tag from the top bits.
    #[inline]
    pub fn hash(name: &[u8]) -> u32 {
        bun_wyhash::hash(name) as u32
    }

    #[inline]
    fn table_hash(hash: u32) -> u64 {
        (u64::from(hash) << 32) | u64::from(hash)
    }

    #[inline]
    pub fn len(&self) -> usize {
        match self {
            Members::Empty => 0,
            Members::Small(inline) => inline.len as usize,
            Members::Inline(inline) => inline.len as usize,
            Members::Table(table) => table.len(),
        }
    }

    #[inline]
    pub fn count(&self) -> usize {
        self.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn iter(&self) -> MembersIter<'_> {
        match self {
            Members::Empty => MembersIter::Inline(&[], &[], 0),
            Members::Small(m) => {
                MembersIter::Inline(&m.names[..m.len as usize], &m.members[..m.len as usize], 0)
            }
            Members::Inline(m) => {
                MembersIter::Inline(&m.names[..m.len as usize], &m.members[..m.len as usize], 0)
            }
            Members::Table(table) => MembersIter::Table(table.iter()),
        }
    }

    pub fn values(&self) -> impl Iterator<Item = &Member> + '_ {
        self.iter().map(|(_, member)| member)
    }

    #[inline]
    pub fn get(&self, name: &[u8]) -> Option<&Member> {
        self.get_hashed(Self::hash(name), name)
    }

    #[inline]
    pub fn contains_key(&self, name: &[u8]) -> bool {
        self.get(name).is_some()
    }

    #[inline]
    pub fn get_hashed(&self, hash: u32, name: &[u8]) -> Option<&Member> {
        match self {
            Members::Empty => None,
            Members::Small(inline) => inline.find(hash, name).map(|i| &inline.members[i]),
            Members::Inline(inline) => inline.find(hash, name).map(|i| &inline.members[i]),
            Members::Table(table) => table
                .find(Self::table_hash(hash), |e| {
                    e.hash == hash && e.name.slice() == name
                })
                .map(|e| &e.member),
        }
    }

    /// Room for about `n` members (the module scope, sized from the source).
    pub fn reserve(&mut self, n: usize) {
        if n > Self::INLINE_MAX {
            self.to_table(n);
        }
    }

    fn to_table(&mut self, capacity: usize) {
        fn fill<const N: usize>(
            inline: &InlineMembers<N>,
            capacity: usize,
        ) -> bun_collections::hashbrown::HashTable<MemberEntry, AstAlloc> {
            let mut table = bun_collections::hashbrown::HashTable::with_capacity_in(
                capacity.max(Members::INLINE_MAX * 2),
                AstAlloc,
            );
            for i in 0..inline.len as usize {
                let entry = MemberEntry {
                    name: inline.names[i],
                    hash: inline.hashes[i],
                    member: inline.members[i],
                };
                table.insert_unique(Members::table_hash(entry.hash), entry, |e| {
                    Members::table_hash(e.hash)
                });
            }
            table
        }
        let table = match core::mem::take(self) {
            Members::Table(mut table) => {
                table.reserve(capacity, |e| Self::table_hash(e.hash));
                table
            }
            Members::Empty => {
                bun_collections::hashbrown::HashTable::with_capacity_in(capacity, AstAlloc)
            }
            Members::Small(inline) => fill(&inline, capacity),
            Members::Inline(inline) => fill(&inline, capacity),
        };
        *self = Members::Table(table);
    }

    /// The entry for `name`, inserted with `Member::default()` if absent.
    ///
    /// # Safety
    /// `name` is stored by reference: it must outlive this scope (source
    /// text, the lexer's string table, or the AST arena all do).
    pub unsafe fn get_or_put_hashed(&mut self, hash: u32, name: &[u8]) -> MembersGetOrPut<'_> {
        loop {
            match self {
                Members::Empty => {
                    *self = Members::Small(bun_alloc::ast_box(InlineMembers::new()));
                }
                Members::Small(inline) => {
                    let found = inline.find(hash, name);
                    if found.is_some() || (inline.len as usize) < 4 {
                        let Members::Small(inline) = self else {
                            unreachable!()
                        };
                        let i = match found {
                            Some(i) => i,
                            None => inline.push(hash, name),
                        };
                        return MembersGetOrPut {
                            found_existing: found.is_some(),
                            value_ptr: &mut inline.members[i],
                        };
                    }
                    let grown = inline.grow::<8>();
                    *self = Members::Inline(bun_alloc::ast_box(grown));
                }
                Members::Inline(inline) => {
                    let found = inline.find(hash, name);
                    if found.is_some() || (inline.len as usize) < Self::INLINE_MAX {
                        let Members::Inline(inline) = self else {
                            unreachable!()
                        };
                        let i = match found {
                            Some(i) => i,
                            None => inline.push(hash, name),
                        };
                        return MembersGetOrPut {
                            found_existing: found.is_some(),
                            value_ptr: &mut inline.members[i],
                        };
                    }
                    self.to_table(Self::INLINE_MAX * 2);
                }
                Members::Table(table) => {
                    return match table.entry(
                        Self::table_hash(hash),
                        |e| e.hash == hash && e.name.slice() == name,
                        |e| Self::table_hash(e.hash),
                    ) {
                        bun_collections::hashbrown::hash_table::Entry::Occupied(o) => {
                            MembersGetOrPut {
                                found_existing: true,
                                value_ptr: &mut o.into_mut().member,
                            }
                        }
                        bun_collections::hashbrown::hash_table::Entry::Vacant(v) => {
                            MembersGetOrPut {
                                found_existing: false,
                                value_ptr: &mut v
                                    .insert(MemberEntry {
                                        name: crate::StoreStr::new(name),
                                        hash,
                                        member: Member::default(),
                                    })
                                    .into_mut()
                                    .member,
                            }
                        }
                    };
                }
            }
        }
    }

    /// Insert or overwrite.
    ///
    /// # Safety
    /// As for `get_or_put_hashed`.
    pub unsafe fn put(&mut self, name: &[u8], member: Member) {
        // SAFETY: forwarded contract.
        *unsafe { self.get_or_put_hashed(Self::hash(name), name) }.value_ptr = member;
    }
}

// `Scope` is a value type — `Ast.module_scope` / `BundledAst.module_scope`
// hold it by value and `toAST` / `init` bitwise-copy it (`this.module_scope`). Vec no
// longer derives `Clone` (private `origin` field); callers that need a shallow copy must
// `core::mem::take` or `core::ptr::read` instead.
pub struct Scope {
    pub kind: Kind,
    // BACKREF: parent owns this scope via `children`. `StoreRef` (arena
    // back-pointer with safe `Deref`/`DerefMut`) so callers don't open-code
    // `unsafe { &*parent.as_ptr() }` at every walk site.
    pub parent: Option<StoreRef<Scope>>,
    /// `AstVec` for the same reason as `members` above. Elements are `StoreRef`
    /// so iteration yields safe `Deref` instead of `unsafe { child.as_ref() }`.
    pub children: AstVec<StoreRef<Scope>>,
    pub members: Members,
    /// `AstVec`: arena-backed.
    pub generated: AstVec<Ref>,
    /// This scope's index in the visit pass's pre-order walk and the index of
    /// the last scope inside it, which `Ast::scope_uses` refers to.
    /// `u32::MAX` for a scope the visit pass never entered.
    pub visit_span: [u32; 2],

    // This is used to store the ref of the label symbol for ScopeLabel scopes.
    pub label_ref: Ref,
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
        kind: Kind::Block,
        parent: None,
        children: AstAlloc::vec(),
        members: Members::EMPTY,
        generated: AstAlloc::vec(),
        visit_span: [u32::MAX, u32::MAX],
        label_ref: Ref::NONE,
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
    /// `(first, last)`: this scope and everything inside it, as visit-pass
    /// pre-order indices. `None` if the visit pass did not enter and leave it.
    pub fn visit_span(&self) -> Option<(u32, u32)> {
        let [first, last] = self.visit_span;
        (first != u32::MAX && first <= last).then_some((first, last))
    }

    #[inline]
    pub fn get_member_hash(name: &[u8]) -> u32 {
        Members::hash(name)
    }

    #[inline]
    pub fn get_member_with_hash(&self, name: &[u8], hash_value: u32) -> Option<Member> {
        self.members.get_hashed(hash_value, name).copied()
    }

    /// # Safety
    /// `name` must outlive the scope: see `Members::get_or_put_hashed`. The
    /// parser's names are slices of the source or of the lexer's string
    /// table, which outlive the AST arena.
    #[inline]
    pub unsafe fn get_or_put_member_with_hash(
        &mut self,
        name: &[u8],
        hash_value: u32,
    ) -> MembersGetOrPut<'_> {
        // SAFETY: forwarded contract.
        unsafe { self.members.get_or_put_hashed(hash_value, name) }
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
    pub const EMPTY: Member = Member {
        ref_: Ref::NONE,
        loc: crate::Loc::EMPTY,
    };
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

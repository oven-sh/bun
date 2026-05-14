#[cfg(debug_assertions)]
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::expr::{self, Expr};
use crate::s as S;
use crate::{DebugOnlyDisabler, NewBatcher, StoreRef};

#[derive(Clone, Copy)]
pub struct Stmt {
    pub loc: crate::Loc,
    pub data: Data,
}

pub type Batcher = NewBatcher<Stmt>;

impl Stmt {
    /// Zig: `Stmt.Data.Store.reset()`. Associated wrapper so downstream crates
    /// can call `crate::Stmt::data_store_reset()` without naming the
    /// thread-local Store module path.
    #[inline]
    pub fn data_store_reset() {
        data::Store::reset();
    }

    /// Zig: `Stmt.Data.Store.create()`.
    #[inline]
    pub fn data_store_create() {
        data::Store::create();
    }

    /// Zig: `Stmt.Data.Store.assert()` — debug-only re-entrancy guard.
    #[inline]
    pub fn data_store_assert() {
        crate::DebugOnlyDisabler::<Stmt>::assert();
    }

    pub fn assign(a: Expr, b: Expr) -> Stmt {
        Stmt::alloc(
            S::SExpr {
                value: Expr::assign(a, b),
                ..Default::default()
            },
            a.loc,
        )
    }
}

// See `binding.rs::Serializable` — JSON-payload carrier passed to the
// shape-agnostic `JsonWriter::write<V>`; fields are the serialization
// contract, not dead, but no reflective writer exists yet to read them.
#[expect(dead_code)]
struct Serializable {
    r#type: Tag,
    object: &'static [u8],
    value: Data,
    loc: crate::Loc,
}

impl Stmt {
    pub fn json_stringify<W>(&self, writer: &mut W) -> Result<(), bun_core::Error>
    where
        W: crate::JsonWriter,
    {
        writer.write(&Serializable {
            r#type: self.data.tag(),
            object: b"stmt",
            value: self.data,
            loc: self.loc,
        })
    }

    pub fn is_type_script(&self) -> bool {
        matches!(self.data, Data::STypeScript(_))
    }

    pub fn is_super_call(self) -> bool {
        if let Data::SExpr(s_expr) = self.data {
            if let expr::Data::ECall(e_call) = s_expr.value.data {
                return matches!(e_call.target.data, expr::Data::ESuper(_));
            }
        }
        false
    }

    pub fn is_missing_expr(self) -> bool {
        if let Data::SExpr(s_expr) = self.data {
            return matches!(s_expr.value.data, expr::Data::EMissing(_));
        }
        false
    }

    pub fn empty() -> Stmt {
        Stmt {
            data: Data::SEmpty(NONE),
            loc: crate::Loc::default(),
        }
    }

    pub fn to_empty(self) -> Stmt {
        Stmt {
            data: Data::SEmpty(NONE),
            loc: self.loc,
        }
    }
}

impl Default for Stmt {
    /// Zig: `nullStmtData = Stmt.Data{ .s_empty = s_missing }` (P.zig) — used to
    /// zero-init `loop_body` and bulk-fill stmt slices before population.
    #[inline]
    fn default() -> Self {
        Stmt {
            data: Data::SEmpty(NONE),
            loc: crate::Loc::default(),
        }
    }
}

const NONE: S::Empty = S::Empty {};

// PORT NOTE: Zig `pub var icount: usize = 0;` is a plain mutable global (not
// threadlocal), never read. Debug-only here so release doesn't pay a contended
// `lock xadd` per Stmt across the bundler worker pool.
#[cfg(debug_assertions)]
pub static ICOUNT: AtomicUsize = AtomicUsize::new(0);

/// Trait absorbing the Zig `switch (comptime StatementType)` tables in
/// `init` / `alloc` / `allocate`. Each `S::*` payload type implements this to
/// map itself onto the corresponding `Data` variant.
///
/// The Zig used three near-identical 32-arm comptime switches; in Rust the
/// dispatch is the trait impl and the arm list is the `impl_statement_data!`
/// invocation below — diff that list against the Zig switch.
pub trait StatementData: Sized {
    /// Wrap an already-allocated payload (Zig `Stmt.init` / `comptime_init`).
    fn wrap_ref(ptr: StoreRef<Self>) -> Data;
    /// Store-append `self` and wrap (Zig `Stmt.alloc` / `comptime_alloc`).
    fn store_alloc(self) -> Data;
    /// Arena-allocate `self` and wrap (Zig `Stmt.allocate` / `allocateData`).
    fn arena_alloc(self, bump: &bun_alloc::Arena) -> Data;
}

impl Stmt {
    #[inline]
    pub fn init<T: StatementData>(orig_data: StoreRef<T>, loc: crate::Loc) -> Stmt {
        #[cfg(debug_assertions)]
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Stmt {
            loc,
            data: T::wrap_ref(orig_data),
        }
    }

    // Zig `comptime_alloc` — folded into `StatementData::store_alloc`; kept as a
    // private helper for diff parity.
    #[inline]
    fn comptime_alloc<T: StatementData>(orig_data: T, loc: crate::Loc) -> Stmt {
        Stmt {
            loc,
            data: orig_data.store_alloc(),
        }
    }

    // Zig `allocateData` — folded into `StatementData::arena_alloc`.
    fn allocate_data<T: StatementData>(
        bump: &bun_alloc::Arena,
        orig_data: T,
        loc: crate::Loc,
    ) -> Stmt {
        // `arena.create(@TypeOf(origData)) catch unreachable; value.* = origData;`
        // → bump.alloc(orig_data), performed inside arena_alloc.
        Stmt {
            loc,
            data: orig_data.arena_alloc(bump),
        }
    }

    // Zig `comptime_init` — `@unionInit(Data, tag_name, origData)`. In Rust the
    // variant constructor IS the union-init; this helper collapses to identity
    // and is absorbed by `StatementData::wrap_ref`.
    // TODO(port): no direct equivalent; callers use the trait.

    #[inline]
    pub fn alloc<T: StatementData>(orig_data: T, loc: crate::Loc) -> Stmt {
        data::Store::assert();
        #[cfg(debug_assertions)]
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Stmt::comptime_alloc(orig_data, loc)
    }
}

pub type Disabler = DebugOnlyDisabler<Stmt>;

impl Stmt {
    /// When the lifetime of an Stmt.Data's pointer must exist longer than reset() is called, use this function.
    /// Be careful to free the memory (or use an arena that does it for you)
    /// Also, prefer Stmt.init or Stmt.alloc when possible. This will be slower.
    pub fn allocate<T: StatementData>(
        bump: &bun_alloc::Arena,
        orig_data: T,
        loc: crate::Loc,
    ) -> Stmt {
        data::Store::assert();
        #[cfg(debug_assertions)]
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Stmt::allocate_data(bump, orig_data, loc)
    }

    pub fn allocate_expr(bump: &bun_alloc::Arena, expr: Expr) -> Stmt {
        Stmt::allocate(
            bump,
            S::SExpr {
                value: expr,
                ..Default::default()
            },
            expr.loc,
        )
    }
}

// ─── StatementData impls (mirrors the 32-arm comptime switches) ────────────

macro_rules! impl_statement_data {
    // Pointer-payload variants: stored via Store / arena.
    ( ptr: $( ($ty:ty, $variant:ident) ),* $(,)?
      ; inline: $( ($ity:ty, $ivariant:ident) ),* $(,)? ) => {
        $(
            impl StatementData for $ty {
                #[inline]
                fn wrap_ref(ptr: StoreRef<Self>) -> Data { Data::$variant(ptr) }
                #[inline]
                fn store_alloc(self) -> Data {
                    Data::$variant(data::Store::append(self))
                }
                #[inline]
                fn arena_alloc(self, bump: &bun_alloc::Arena) -> Data {
                    // TODO(port): StoreRef vs &'bump — Phase B unify arena ref type
                    Data::$variant(StoreRef::from_bump(bump.alloc(self)))
                }
            }
        )*
        $(
            impl StatementData for $ity {
                #[inline]
                fn wrap_ref(_ptr: StoreRef<Self>) -> Data { Data::$ivariant(<$ity>::default()) }
                #[inline]
                fn store_alloc(self) -> Data { Data::$ivariant(self) }
                #[inline]
                fn arena_alloc(self, _bump: &bun_alloc::Arena) -> Data { Data::$ivariant(self) }
            }
        )*
    };
}

impl_statement_data! {
    ptr:
        (S::Block,         SBlock),
        (S::Break,         SBreak),
        (S::Class,         SClass),
        (S::Comment,       SComment),
        (S::Continue,      SContinue),
        (S::Directive,     SDirective),
        (S::DoWhile,       SDoWhile),
        (S::Enum,          SEnum),
        (S::ExportClause,  SExportClause),
        (S::ExportDefault, SExportDefault),
        (S::ExportEquals,  SExportEquals),
        (S::ExportFrom,    SExportFrom),
        (S::ExportStar,    SExportStar),
        (S::SExpr,         SExpr),
        (S::ForIn,         SForIn),
        (S::ForOf,         SForOf),
        (S::For,           SFor),
        (S::Function,      SFunction),
        (S::If,            SIf),
        (S::Import,        SImport),
        (S::Label,         SLabel),
        (S::Local,         SLocal),
        (S::Namespace,     SNamespace),
        (S::Return,        SReturn),
        (S::Switch,        SSwitch),
        (S::Throw,         SThrow),
        (S::Try,           STry),
        (S::While,         SWhile),
        (S::With,          SWith),
    ; inline:
        (S::Empty,      SEmpty),
        (S::Debugger,   SDebugger),
        (S::TypeScript, STypeScript),
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum Tag {
    SBlock,
    SBreak,
    SClass,
    SComment,
    SContinue,
    SDirective,
    SDoWhile,
    SEnum,
    SExportClause,
    SExportDefault,
    SExportEquals,
    SExportFrom,
    SExportStar,
    SExpr,
    SForIn,
    SForOf,
    SFor,
    SFunction,
    SIf,
    SImport,
    SLabel,
    SLocal,
    SNamespace,
    SReturn,
    SSwitch,
    SThrow,
    STry,
    SWhile,
    SWith,
    STypeScript,
    SEmpty,
    SDebugger,
    SLazyExport,
}

impl Tag {
    pub fn json_stringify<W>(self, writer: &mut W) -> Result<(), bun_core::Error>
    where
        // TODO(port): narrow error set
        W: crate::JsonWriter,
    {
        writer.write(<&'static str>::from(self))
    }

    pub fn is_export_like(self) -> bool {
        matches!(
            self,
            Tag::SExportClause
                | Tag::SExportDefault
                | Tag::SExportEquals
                | Tag::SExportFrom
                | Tag::SExportStar
                | Tag::SEmpty
        )
    }
}

#[derive(Clone, Copy, bun_core::EnumTag)]
#[enum_tag(existing = Tag)]
pub enum Data {
    SBlock(StoreRef<S::Block>),
    SBreak(StoreRef<S::Break>),
    SClass(StoreRef<S::Class>),
    SComment(StoreRef<S::Comment>),
    SContinue(StoreRef<S::Continue>),
    SDirective(StoreRef<S::Directive>),
    SDoWhile(StoreRef<S::DoWhile>),
    SEnum(StoreRef<S::Enum>),
    SExportClause(StoreRef<S::ExportClause>),
    SExportDefault(StoreRef<S::ExportDefault>),
    SExportEquals(StoreRef<S::ExportEquals>),
    SExportFrom(StoreRef<S::ExportFrom>),
    SExportStar(StoreRef<S::ExportStar>),
    SExpr(StoreRef<S::SExpr>),
    SForIn(StoreRef<S::ForIn>),
    SForOf(StoreRef<S::ForOf>),
    SFor(StoreRef<S::For>),
    SFunction(StoreRef<S::Function>),
    SIf(StoreRef<S::If>),
    SImport(StoreRef<S::Import>),
    SLabel(StoreRef<S::Label>),
    SLocal(StoreRef<S::Local>),
    SNamespace(StoreRef<S::Namespace>),
    SReturn(StoreRef<S::Return>),
    SSwitch(StoreRef<S::Switch>),
    SThrow(StoreRef<S::Throw>),
    STry(StoreRef<S::Try>),
    SWhile(StoreRef<S::While>),
    SWith(StoreRef<S::With>),

    STypeScript(S::TypeScript),
    SEmpty(S::Empty), // special case, its a zero value type
    SDebugger(S::Debugger),

    SLazyExport(StoreRef<expr::Data>),
}

// ── Layout guards ─────────────────────────────────────────────────────────
// Zig: `if (@sizeOf(Stmt) > 24) @compileLog(...)` (Stmt.zig:295). Every payload
// variant is either a `StoreRef<T>` (`#[repr(transparent)] NonNull<T>`, 8 bytes,
// niche-carrying) or a ZST, so the union is one pointer word and the repr(Rust)
// discriminant packs alongside it for `Data` = 16. `Stmt` = `Data` (16, align 8)
// + `Loc` (i32) → 20 → 24 after tail padding. The `Option<Data>` assert proves
// the niche fires (33 variants < 256 + every pointer variant contributes a
// NonNull niche), so `Option<Stmt>` / `Option<Data>` add no discriminant word.
// Adding `#[repr(C)]`/`#[repr(u8)]` to `Data` or a nullable `*mut T` payload
// would break this — the asserts catch it.
const _: () = assert!(core::mem::size_of::<Data>() == 16);
const _: () = assert!(
    core::mem::size_of::<Stmt>() <= 24,
    "Expected Stmt to be <= 24 bytes"
);
const _: () = assert!(
    core::mem::size_of::<Option<Data>>() == core::mem::size_of::<Data>(),
    "stmt::Data lost its niche — check for #[repr] or nullable-ptr payload"
);
const _: () = assert!(
    core::mem::size_of::<Option<Stmt>>() == core::mem::size_of::<Stmt>(),
    "Stmt lost its niche"
);
const _: () = assert!(core::mem::size_of::<StoreRef<S::SExpr>>() == core::mem::size_of::<usize>());

/// Zig: `std.meta.eql(p.loop_body, stmt.data)` (visitStmt.zig) — tag compare,
/// then payload compare. Payloads here are arena pointers (`StoreRef<T>`) or
/// ZSTs, so this is tag + pointer-identity, never a deep structural compare.
impl PartialEq for Data {
    fn eq(&self, other: &Self) -> bool {
        use Data::*;
        match (*self, *other) {
            (SBlock(a), SBlock(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SBreak(a), SBreak(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SClass(a), SClass(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SComment(a), SComment(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SContinue(a), SContinue(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SDirective(a), SDirective(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SDoWhile(a), SDoWhile(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SEnum(a), SEnum(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SExportClause(a), SExportClause(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SExportDefault(a), SExportDefault(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SExportEquals(a), SExportEquals(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SExportFrom(a), SExportFrom(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SExportStar(a), SExportStar(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SExpr(a), SExpr(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SForIn(a), SForIn(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SForOf(a), SForOf(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SFor(a), SFor(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SFunction(a), SFunction(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SIf(a), SIf(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SImport(a), SImport(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SLabel(a), SLabel(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SLocal(a), SLocal(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SNamespace(a), SNamespace(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SReturn(a), SReturn(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SSwitch(a), SSwitch(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SThrow(a), SThrow(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (STry(a), STry(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SWhile(a), SWhile(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SWith(a), SWith(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (SLazyExport(a), SLazyExport(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
            (STypeScript(_), STypeScript(_)) => true,
            (SEmpty(_), SEmpty(_)) => true,
            (SDebugger(_), SDebugger(_)) => true,
            _ => false,
        }
    }
}
impl Eq for Data {}

// Zig field-style union accessors (`data.s_function`, `data.s_local`, …).
// visitStmt and the printer port from Zig's `data.s_local.*` etc., which are
// unchecked union field reads. Rust callers `.unwrap()` (or pattern-match) —
// the `Option` is the cheapest sound encoding of Zig's UB-on-mismatch.
// Mirrors `expr::Data::e_*()`. Returns `Option<StoreRef<T>>` (Copy) for
// pointer-payload variants and `Option<T>` by value for inline ZST variants.
impl Data {
    // ── StoreRef<S::*> field-style accessors ────────────────────────────
    #[inline]
    pub fn s_block(&self) -> Option<StoreRef<S::Block>> {
        if let Data::SBlock(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_block_mut(&mut self) -> Option<&mut S::Block> {
        if let Data::SBlock(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_break(&self) -> Option<StoreRef<S::Break>> {
        if let Data::SBreak(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_break_mut(&mut self) -> Option<&mut S::Break> {
        if let Data::SBreak(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_class(&self) -> Option<StoreRef<S::Class>> {
        if let Data::SClass(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_class_mut(&mut self) -> Option<&mut S::Class> {
        if let Data::SClass(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_comment(&self) -> Option<StoreRef<S::Comment>> {
        if let Data::SComment(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_comment_mut(&mut self) -> Option<&mut S::Comment> {
        if let Data::SComment(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_continue(&self) -> Option<StoreRef<S::Continue>> {
        if let Data::SContinue(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_continue_mut(&mut self) -> Option<&mut S::Continue> {
        if let Data::SContinue(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_directive(&self) -> Option<StoreRef<S::Directive>> {
        if let Data::SDirective(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_directive_mut(&mut self) -> Option<&mut S::Directive> {
        if let Data::SDirective(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_do_while(&self) -> Option<StoreRef<S::DoWhile>> {
        if let Data::SDoWhile(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_do_while_mut(&mut self) -> Option<&mut S::DoWhile> {
        if let Data::SDoWhile(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_enum(&self) -> Option<StoreRef<S::Enum>> {
        if let Data::SEnum(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_enum_mut(&mut self) -> Option<&mut S::Enum> {
        if let Data::SEnum(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_clause(&self) -> Option<StoreRef<S::ExportClause>> {
        if let Data::SExportClause(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_clause_mut(&mut self) -> Option<&mut S::ExportClause> {
        if let Data::SExportClause(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_default(&self) -> Option<StoreRef<S::ExportDefault>> {
        if let Data::SExportDefault(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_default_mut(&mut self) -> Option<&mut S::ExportDefault> {
        if let Data::SExportDefault(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_equals(&self) -> Option<StoreRef<S::ExportEquals>> {
        if let Data::SExportEquals(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_equals_mut(&mut self) -> Option<&mut S::ExportEquals> {
        if let Data::SExportEquals(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_from(&self) -> Option<StoreRef<S::ExportFrom>> {
        if let Data::SExportFrom(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_from_mut(&mut self) -> Option<&mut S::ExportFrom> {
        if let Data::SExportFrom(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_star(&self) -> Option<StoreRef<S::ExportStar>> {
        if let Data::SExportStar(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_star_mut(&mut self) -> Option<&mut S::ExportStar> {
        if let Data::SExportStar(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_expr(&self) -> Option<StoreRef<S::SExpr>> {
        if let Data::SExpr(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_expr_mut(&mut self) -> Option<&mut S::SExpr> {
        if let Data::SExpr(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_for_in(&self) -> Option<StoreRef<S::ForIn>> {
        if let Data::SForIn(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_for_in_mut(&mut self) -> Option<&mut S::ForIn> {
        if let Data::SForIn(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_for_of(&self) -> Option<StoreRef<S::ForOf>> {
        if let Data::SForOf(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_for_of_mut(&mut self) -> Option<&mut S::ForOf> {
        if let Data::SForOf(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_for(&self) -> Option<StoreRef<S::For>> {
        if let Data::SFor(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_for_mut(&mut self) -> Option<&mut S::For> {
        if let Data::SFor(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_function(&self) -> Option<StoreRef<S::Function>> {
        if let Data::SFunction(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_function_mut(&mut self) -> Option<&mut S::Function> {
        if let Data::SFunction(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_if(&self) -> Option<StoreRef<S::If>> {
        if let Data::SIf(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_if_mut(&mut self) -> Option<&mut S::If> {
        if let Data::SIf(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_import(&self) -> Option<StoreRef<S::Import>> {
        if let Data::SImport(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_import_mut(&mut self) -> Option<&mut S::Import> {
        if let Data::SImport(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_label(&self) -> Option<StoreRef<S::Label>> {
        if let Data::SLabel(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_label_mut(&mut self) -> Option<&mut S::Label> {
        if let Data::SLabel(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_local(&self) -> Option<StoreRef<S::Local>> {
        if let Data::SLocal(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_local_mut(&mut self) -> Option<&mut S::Local> {
        if let Data::SLocal(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_namespace(&self) -> Option<StoreRef<S::Namespace>> {
        if let Data::SNamespace(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_namespace_mut(&mut self) -> Option<&mut S::Namespace> {
        if let Data::SNamespace(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_return(&self) -> Option<StoreRef<S::Return>> {
        if let Data::SReturn(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_return_mut(&mut self) -> Option<&mut S::Return> {
        if let Data::SReturn(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_switch(&self) -> Option<StoreRef<S::Switch>> {
        if let Data::SSwitch(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_switch_mut(&mut self) -> Option<&mut S::Switch> {
        if let Data::SSwitch(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_throw(&self) -> Option<StoreRef<S::Throw>> {
        if let Data::SThrow(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_throw_mut(&mut self) -> Option<&mut S::Throw> {
        if let Data::SThrow(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_try(&self) -> Option<StoreRef<S::Try>> {
        if let Data::STry(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_try_mut(&mut self) -> Option<&mut S::Try> {
        if let Data::STry(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_while(&self) -> Option<StoreRef<S::While>> {
        if let Data::SWhile(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_while_mut(&mut self) -> Option<&mut S::While> {
        if let Data::SWhile(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_with(&self) -> Option<StoreRef<S::With>> {
        if let Data::SWith(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_with_mut(&mut self) -> Option<&mut S::With> {
        if let Data::SWith(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_lazy_export(&self) -> Option<StoreRef<expr::Data>> {
        if let Data::SLazyExport(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_lazy_export_mut(&mut self) -> Option<&mut expr::Data> {
        if let Data::SLazyExport(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }

    // ── Inline (by-value) payload accessors ─────────────────────────────
    // These variants store the payload directly (no `StoreRef`); all are
    // zero-sized `Copy` types. Returned by value for symmetry with
    // `expr::Data::e_boolean()` etc.
    #[inline]
    pub fn s_type_script(&self) -> Option<S::TypeScript> {
        if let Data::STypeScript(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_empty(&self) -> Option<S::Empty> {
        if let Data::SEmpty(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_debugger(&self) -> Option<S::Debugger> {
        if let Data::SDebugger(v) = *self {
            Some(v)
        } else {
            None
        }
    }
}

// `new_store!` emits `pub mod stmt_store { pub struct Store; ... }` with
// `init/append/reset/destroy`. Type list mirrors Zig's `Data.Store = NewStore(&.{...}, 128)`.
crate::new_store!(
    stmt_store,
    [
        S::Block,
        S::Break,
        S::Class,
        S::Comment,
        S::Continue,
        S::Directive,
        S::DoWhile,
        S::Enum,
        S::ExportClause,
        S::ExportDefault,
        S::ExportEquals,
        S::ExportFrom,
        S::ExportStar,
        S::SExpr,
        S::ForIn,
        S::ForOf,
        S::For,
        S::Function,
        S::If,
        S::Import,
        S::Label,
        S::Local,
        S::Namespace,
        S::Return,
        S::Switch,
        S::Throw,
        S::Try,
        S::While,
        S::With,
    ],
    128
);

pub mod data {
    use super::*;
    crate::thread_local_ast_store!(stmt_store::Store, "Stmt");
}

// Zig `pub fn StoredData(tag: Tag) type` — returns the payload type for a tag,
// dereferencing pointer variants. Rust has no type-returning fns.
// TODO(port): callers should use the `StatementData` trait or a per-variant
// associated type; revisit once call sites are known.

impl Stmt {
    pub fn cares_about_scope(&self) -> bool {
        match &self.data {
            Data::SBlock(_)
            | Data::SEmpty(_)
            | Data::SDebugger(_)
            | Data::SExpr(_)
            | Data::SIf(_)
            | Data::SFor(_)
            | Data::SForIn(_)
            | Data::SForOf(_)
            | Data::SDoWhile(_)
            | Data::SWhile(_)
            | Data::SWith(_)
            | Data::STry(_)
            | Data::SSwitch(_)
            | Data::SReturn(_)
            | Data::SThrow(_)
            | Data::SBreak(_)
            | Data::SContinue(_)
            | Data::SDirective(_) => false,

            Data::SLocal(local) => local.kind != S::Kind::KVar,

            _ => true,
        }
    }
}

// ported from: src/js_parser/ast/Stmt.zig

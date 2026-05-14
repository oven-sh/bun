#[cfg(debug_assertions)]
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::expr::{self, Expr};
use crate::s as S;
use crate::{DebugOnlyDisabler, NewBatcher, StoreRef};

#[derive(Clone, Copy)]
pub struct Stmt<'arena> {
    pub loc: crate::Loc,
    pub data: Data<'arena>,
}

pub type Batcher<'arena> = NewBatcher<'arena, Stmt<'arena>>;

impl<'arena> Stmt<'arena> {
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

    pub fn assign(a: Expr<'arena>, b: Expr<'arena>) -> Stmt<'arena> {
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
struct Serializable<'arena> {
    r#type: Tag,
    object: &'static [u8],
    value: Data<'arena>,
    loc: crate::Loc,
}

impl<'arena> Stmt<'arena> {
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

    pub fn empty() -> Stmt<'arena> {
        Stmt {
            data: Data::SEmpty(NONE),
            loc: crate::Loc::default(),
        }
    }

    pub fn to_empty(self) -> Stmt<'arena> {
        Stmt {
            data: Data::SEmpty(NONE),
            loc: self.loc,
        }
    }
}

impl<'arena> Default for Stmt<'arena> {
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
pub trait StatementData<'arena>: Sized {
    /// Wrap an already-allocated payload (Zig `Stmt.init` / `comptime_init`).
    fn wrap_ref(ptr: StoreRef<'arena, Self>) -> Data<'arena>;
    /// Store-append `self` and wrap (Zig `Stmt.alloc` / `comptime_alloc`).
    fn store_alloc(self) -> Data<'arena>;
    /// Arena-allocate `self` and wrap (Zig `Stmt.allocate` / `allocateData`).
    fn arena_alloc(self, bump: &bun_alloc::Arena) -> Data<'arena>;
}

impl<'arena> Stmt<'arena> {
    #[inline]
    pub fn init<T: StatementData<'arena>>(orig_data: StoreRef<'arena, T>, loc: crate::Loc) -> Stmt<'arena> {
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
    fn comptime_alloc<T: StatementData<'arena>>(orig_data: T, loc: crate::Loc) -> Stmt<'arena> {
        Stmt {
            loc,
            data: orig_data.store_alloc(),
        }
    }

    // Zig `allocateData` — folded into `StatementData::arena_alloc`.
    fn allocate_data<T: StatementData<'arena>>(
        bump: &bun_alloc::Arena,
        orig_data: T,
        loc: crate::Loc,
    ) -> Stmt<'arena> {
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
    pub fn alloc<T: StatementData<'arena>>(orig_data: T, loc: crate::Loc) -> Stmt<'arena> {
        data::Store::assert();
        #[cfg(debug_assertions)]
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Stmt::comptime_alloc(orig_data, loc)
    }
}

pub type Disabler = DebugOnlyDisabler<Stmt<'static>>;

impl<'arena> Stmt<'arena> {
    /// When the lifetime of an Stmt.Data's pointer must exist longer than reset() is called, use this function.
    /// Be careful to free the memory (or use an arena that does it for you)
    /// Also, prefer Stmt.init or Stmt.alloc when possible. This will be slower.
    pub fn allocate<T: StatementData<'arena>>(
        bump: &bun_alloc::Arena,
        orig_data: T,
        loc: crate::Loc,
    ) -> Stmt<'arena> {
        data::Store::assert();
        #[cfg(debug_assertions)]
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Stmt::allocate_data(bump, orig_data, loc)
    }

    pub fn allocate_expr(bump: &bun_alloc::Arena, expr: Expr<'arena>) -> Stmt<'arena> {
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
    ( ptr: $( ($ty:ident, $variant:ident) ),* $(,)?
      ; ptr_nolife: $( ($pty:ident, $pvariant:ident) ),* $(,)?
      ; inline: $( ($ity:ty, $ivariant:ident) ),* $(,)? ) => {
        $(
            impl<'arena> StatementData<'arena> for S::$ty<'arena> {
                #[inline]
                fn wrap_ref(ptr: StoreRef<'arena, Self>) -> Data<'arena> { Data::$variant(ptr) }
                #[inline]
                fn store_alloc(self) -> Data<'arena> {
                    Data::$variant(data::Store::append(self))
                }
                #[inline]
                fn arena_alloc(self, bump: &bun_alloc::Arena) -> Data<'arena> {
                    // TODO(port): StoreRef vs &'bump — Phase B unify arena ref type
                    Data::$variant(StoreRef::from_bump(bump.alloc(self)))
                }
            }
        )*
        $(
            impl<'arena> StatementData<'arena> for S::$pty {
                #[inline]
                fn wrap_ref(ptr: StoreRef<'arena, Self>) -> Data<'arena> { Data::$pvariant(ptr) }
                #[inline]
                fn store_alloc(self) -> Data<'arena> {
                    Data::$pvariant(data::Store::append(self))
                }
                #[inline]
                fn arena_alloc(self, bump: &bun_alloc::Arena) -> Data<'arena> {
                    Data::$pvariant(StoreRef::from_bump(bump.alloc(self)))
                }
            }
        )*
        $(
            impl<'arena> StatementData<'arena> for $ity {
                #[inline]
                fn wrap_ref(_ptr: StoreRef<'arena, Self>) -> Data<'arena> { Data::$ivariant(<$ity>::default()) }
                #[inline]
                fn store_alloc(self) -> Data<'arena> { Data::$ivariant(self) }
                #[inline]
                fn arena_alloc(self, _bump: &bun_alloc::Arena) -> Data<'arena> { Data::$ivariant(self) }
            }
        )*
    };
}

impl_statement_data! {
    ptr:
        (Block,         SBlock),
        (Class,         SClass),
        (Comment,       SComment),
        (Directive,     SDirective),
        (DoWhile,       SDoWhile),
        (Enum,          SEnum),
        (ExportClause,  SExportClause),
        (ExportDefault, SExportDefault),
        (ExportEquals,  SExportEquals),
        (ExportFrom,    SExportFrom),
        (ExportStar,    SExportStar),
        (SExpr,         SExpr),
        (ForIn,         SForIn),
        (ForOf,         SForOf),
        (For,           SFor),
        (Function,      SFunction),
        (If,            SIf),
        (Import,        SImport),
        (Label,         SLabel),
        (Local,         SLocal),
        (Namespace,     SNamespace),
        (Return,        SReturn),
        (Switch,        SSwitch),
        (Throw,         SThrow),
        (Try,           STry),
        (While,         SWhile),
        (With,          SWith),
    ; ptr_nolife:
        (Break,         SBreak),
        (Continue,      SContinue),
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
pub enum Data<'arena> {
    SBlock(StoreRef<'arena, S::Block<'arena>>),
    SBreak(StoreRef<'arena, S::Break>),
    SClass(StoreRef<'arena, S::Class<'arena>>),
    SComment(StoreRef<'arena, S::Comment<'arena>>),
    SContinue(StoreRef<'arena, S::Continue>),
    SDirective(StoreRef<'arena, S::Directive<'arena>>),
    SDoWhile(StoreRef<'arena, S::DoWhile<'arena>>),
    SEnum(StoreRef<'arena, S::Enum<'arena>>),
    SExportClause(StoreRef<'arena, S::ExportClause<'arena>>),
    SExportDefault(StoreRef<'arena, S::ExportDefault<'arena>>),
    SExportEquals(StoreRef<'arena, S::ExportEquals<'arena>>),
    SExportFrom(StoreRef<'arena, S::ExportFrom<'arena>>),
    SExportStar(StoreRef<'arena, S::ExportStar<'arena>>),
    SExpr(StoreRef<'arena, S::SExpr<'arena>>),
    SForIn(StoreRef<'arena, S::ForIn<'arena>>),
    SForOf(StoreRef<'arena, S::ForOf<'arena>>),
    SFor(StoreRef<'arena, S::For<'arena>>),
    SFunction(StoreRef<'arena, S::Function<'arena>>),
    SIf(StoreRef<'arena, S::If<'arena>>),
    SImport(StoreRef<'arena, S::Import<'arena>>),
    SLabel(StoreRef<'arena, S::Label<'arena>>),
    SLocal(StoreRef<'arena, S::Local<'arena>>),
    SNamespace(StoreRef<'arena, S::Namespace<'arena>>),
    SReturn(StoreRef<'arena, S::Return<'arena>>),
    SSwitch(StoreRef<'arena, S::Switch<'arena>>),
    SThrow(StoreRef<'arena, S::Throw<'arena>>),
    STry(StoreRef<'arena, S::Try<'arena>>),
    SWhile(StoreRef<'arena, S::While<'arena>>),
    SWith(StoreRef<'arena, S::With<'arena>>),

    STypeScript(S::TypeScript),
    SEmpty(S::Empty), // special case, its a zero value type
    SDebugger(S::Debugger),

    SLazyExport(StoreRef<'arena, expr::Data<'arena>>),
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
const _: () = assert!(core::mem::size_of::<Data<'static>>() == 16);
const _: () = assert!(
    core::mem::size_of::<Stmt<'static>>() <= 24,
    "Expected Stmt to be <= 24 bytes"
);
const _: () = assert!(
    core::mem::size_of::<Option<Data<'static>>>() == core::mem::size_of::<Data<'static>>(),
    "stmt::Data lost its niche — check for #[repr] or nullable-ptr payload"
);
const _: () = assert!(
    core::mem::size_of::<Option<Stmt<'static>>>() == core::mem::size_of::<Stmt<'static>>(),
    "Stmt lost its niche"
);
const _: () = assert!(core::mem::size_of::<StoreRef<'static, S::SExpr<'static>>>() == core::mem::size_of::<usize>());

/// Zig: `std.meta.eql(p.loop_body, stmt.data)` (visitStmt.zig) — tag compare,
/// then payload compare. Payloads here are arena pointers (`StoreRef<T>`) or
/// ZSTs, so this is tag + pointer-identity, never a deep structural compare.
impl<'arena> PartialEq for Data<'arena> {
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
impl<'arena> Eq for Data<'arena> {}

// Zig field-style union accessors (`data.s_function`, `data.s_local`, …).
// visitStmt and the printer port from Zig's `data.s_local.*` etc., which are
// unchecked union field reads. Rust callers `.unwrap()` (or pattern-match) —
// the `Option` is the cheapest sound encoding of Zig's UB-on-mismatch.
// Mirrors `expr::Data::e_*()`. Returns `Option<StoreRef<T>>` (Copy) for
// pointer-payload variants and `Option<T>` by value for inline ZST variants.
impl<'arena> Data<'arena> {
    // ── StoreRef<'arena, S::*> field-style accessors ────────────────────────────
    #[inline]
    pub fn s_block(&self) -> Option<StoreRef<'arena, S::Block<'arena>>> {
        if let Data::SBlock(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_block_mut(&mut self) -> Option<&mut S::Block<'arena>> {
        if let Data::SBlock(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_break(&self) -> Option<StoreRef<'arena, S::Break>> {
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
    pub fn s_class(&self) -> Option<StoreRef<'arena, S::Class<'arena>>> {
        if let Data::SClass(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_class_mut(&mut self) -> Option<&mut S::Class<'arena>> {
        if let Data::SClass(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_comment(&self) -> Option<StoreRef<'arena, S::Comment<'arena>>> {
        if let Data::SComment(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_comment_mut(&mut self) -> Option<&mut S::Comment<'arena>> {
        if let Data::SComment(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_continue(&self) -> Option<StoreRef<'arena, S::Continue>> {
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
    pub fn s_directive(&self) -> Option<StoreRef<'arena, S::Directive<'arena>>> {
        if let Data::SDirective(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_directive_mut(&mut self) -> Option<&mut S::Directive<'arena>> {
        if let Data::SDirective(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_do_while(&self) -> Option<StoreRef<'arena, S::DoWhile<'arena>>> {
        if let Data::SDoWhile(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_do_while_mut(&mut self) -> Option<&mut S::DoWhile<'arena>> {
        if let Data::SDoWhile(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_enum(&self) -> Option<StoreRef<'arena, S::Enum<'arena>>> {
        if let Data::SEnum(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_enum_mut(&mut self) -> Option<&mut S::Enum<'arena>> {
        if let Data::SEnum(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_clause(&self) -> Option<StoreRef<'arena, S::ExportClause<'arena>>> {
        if let Data::SExportClause(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_clause_mut(&mut self) -> Option<&mut S::ExportClause<'arena>> {
        if let Data::SExportClause(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_default(&self) -> Option<StoreRef<'arena, S::ExportDefault<'arena>>> {
        if let Data::SExportDefault(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_default_mut(&mut self) -> Option<&mut S::ExportDefault<'arena>> {
        if let Data::SExportDefault(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_equals(&self) -> Option<StoreRef<'arena, S::ExportEquals<'arena>>> {
        if let Data::SExportEquals(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_equals_mut(&mut self) -> Option<&mut S::ExportEquals<'arena>> {
        if let Data::SExportEquals(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_from(&self) -> Option<StoreRef<'arena, S::ExportFrom<'arena>>> {
        if let Data::SExportFrom(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_from_mut(&mut self) -> Option<&mut S::ExportFrom<'arena>> {
        if let Data::SExportFrom(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_star(&self) -> Option<StoreRef<'arena, S::ExportStar<'arena>>> {
        if let Data::SExportStar(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_export_star_mut(&mut self) -> Option<&mut S::ExportStar<'arena>> {
        if let Data::SExportStar(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_expr(&self) -> Option<StoreRef<'arena, S::SExpr<'arena>>> {
        if let Data::SExpr(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_expr_mut(&mut self) -> Option<&mut S::SExpr<'arena>> {
        if let Data::SExpr(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_for_in(&self) -> Option<StoreRef<'arena, S::ForIn<'arena>>> {
        if let Data::SForIn(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_for_in_mut(&mut self) -> Option<&mut S::ForIn<'arena>> {
        if let Data::SForIn(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_for_of(&self) -> Option<StoreRef<'arena, S::ForOf<'arena>>> {
        if let Data::SForOf(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_for_of_mut(&mut self) -> Option<&mut S::ForOf<'arena>> {
        if let Data::SForOf(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_for(&self) -> Option<StoreRef<'arena, S::For<'arena>>> {
        if let Data::SFor(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_for_mut(&mut self) -> Option<&mut S::For<'arena>> {
        if let Data::SFor(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_function(&self) -> Option<StoreRef<'arena, S::Function<'arena>>> {
        if let Data::SFunction(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_function_mut(&mut self) -> Option<&mut S::Function<'arena>> {
        if let Data::SFunction(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_if(&self) -> Option<StoreRef<'arena, S::If<'arena>>> {
        if let Data::SIf(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_if_mut(&mut self) -> Option<&mut S::If<'arena>> {
        if let Data::SIf(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_import(&self) -> Option<StoreRef<'arena, S::Import<'arena>>> {
        if let Data::SImport(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_import_mut(&mut self) -> Option<&mut S::Import<'arena>> {
        if let Data::SImport(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_label(&self) -> Option<StoreRef<'arena, S::Label<'arena>>> {
        if let Data::SLabel(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_label_mut(&mut self) -> Option<&mut S::Label<'arena>> {
        if let Data::SLabel(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_local(&self) -> Option<StoreRef<'arena, S::Local<'arena>>> {
        if let Data::SLocal(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_local_mut(&mut self) -> Option<&mut S::Local<'arena>> {
        if let Data::SLocal(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_namespace(&self) -> Option<StoreRef<'arena, S::Namespace<'arena>>> {
        if let Data::SNamespace(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_namespace_mut(&mut self) -> Option<&mut S::Namespace<'arena>> {
        if let Data::SNamespace(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_return(&self) -> Option<StoreRef<'arena, S::Return<'arena>>> {
        if let Data::SReturn(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_return_mut(&mut self) -> Option<&mut S::Return<'arena>> {
        if let Data::SReturn(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_switch(&self) -> Option<StoreRef<'arena, S::Switch<'arena>>> {
        if let Data::SSwitch(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_switch_mut(&mut self) -> Option<&mut S::Switch<'arena>> {
        if let Data::SSwitch(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_throw(&self) -> Option<StoreRef<'arena, S::Throw<'arena>>> {
        if let Data::SThrow(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_throw_mut(&mut self) -> Option<&mut S::Throw<'arena>> {
        if let Data::SThrow(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_try(&self) -> Option<StoreRef<'arena, S::Try<'arena>>> {
        if let Data::STry(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_try_mut(&mut self) -> Option<&mut S::Try<'arena>> {
        if let Data::STry(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_while(&self) -> Option<StoreRef<'arena, S::While<'arena>>> {
        if let Data::SWhile(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_while_mut(&mut self) -> Option<&mut S::While<'arena>> {
        if let Data::SWhile(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_with(&self) -> Option<StoreRef<'arena, S::With<'arena>>> {
        if let Data::SWith(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_with_mut(&mut self) -> Option<&mut S::With<'arena>> {
        if let Data::SWith(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_lazy_export(&self) -> Option<StoreRef<'arena, expr::Data<'arena>>> {
        if let Data::SLazyExport(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_lazy_export_mut(&mut self) -> Option<&mut expr::Data<'arena>> {
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
// Types use `'static` here because the macro only uses them for size/align
// computation; the actual `append<T>` is generic over the caller's `'arena`.
crate::new_store!(
    stmt_store,
    [
        S::Block<'static>,
        S::Break,
        S::Class<'static>,
        S::Comment<'static>,
        S::Continue,
        S::Directive<'static>,
        S::DoWhile<'static>,
        S::Enum<'static>,
        S::ExportClause<'static>,
        S::ExportDefault<'static>,
        S::ExportEquals<'static>,
        S::ExportFrom<'static>,
        S::ExportStar<'static>,
        S::SExpr<'static>,
        S::ForIn<'static>,
        S::ForOf<'static>,
        S::For<'static>,
        S::Function<'static>,
        S::If<'static>,
        S::Import<'static>,
        S::Label<'static>,
        S::Local<'static>,
        S::Namespace<'static>,
        S::Return<'static>,
        S::Switch<'static>,
        S::Throw<'static>,
        S::Try<'static>,
        S::While<'static>,
        S::With<'static>,
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

impl<'arena> Stmt<'arena> {
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

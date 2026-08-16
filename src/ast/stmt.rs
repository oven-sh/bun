use crate::expr::{self, Expr};
use crate::s as S;
use crate::{DebugOnlyDisabler, StoreRef};

#[derive(Clone, Copy)]
pub struct Stmt {
    pub loc: crate::Loc,
    pub data: Data,
}

impl Stmt {
    /// Associated wrapper so downstream crates can call
    /// `crate::Stmt::data_store_reset()` without naming the thread-local
    /// Store module path.
    #[inline]
    pub fn data_store_reset() {
        data::Store::reset();
    }

    /// Initializes the thread-local statement-data `Store` for the current
    /// thread; counterpart of `data_store_reset()`.
    #[inline]
    pub fn data_store_create() {
        data::Store::create();
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

impl Stmt {
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
    /// Used to zero-init `loop_body` and bulk-fill stmt slices before
    /// population.
    #[inline]
    fn default() -> Self {
        Stmt {
            data: Data::SEmpty(NONE),
            loc: crate::Loc::default(),
        }
    }
}

const NONE: S::Empty = S::Empty {};

/// Each `S::*` payload type implements this to map itself onto the
/// corresponding `Data` variant; the arm list is the `impl_statement_data!`
/// invocation below.
pub trait StatementData: Sized {
    /// Wrap an already-allocated payload.
    fn wrap_ref(ptr: StoreRef<Self>) -> Data;
    /// Store-append `self` and wrap.
    fn store_alloc(self) -> Data;
    /// Arena-allocate `self` and wrap.
    fn arena_alloc(self, bump: &bun_alloc::Arena) -> Data;
}

impl Stmt {
    #[inline]
    pub fn init<T: StatementData>(orig_data: StoreRef<T>, loc: crate::Loc) -> Stmt {
        Stmt {
            loc,
            data: T::wrap_ref(orig_data),
        }
    }

    #[inline]
    fn comptime_alloc<T: StatementData>(orig_data: T, loc: crate::Loc) -> Stmt {
        Stmt {
            loc,
            data: orig_data.store_alloc(),
        }
    }

    fn allocate_data<T: StatementData>(
        bump: &bun_alloc::Arena,
        orig_data: T,
        loc: crate::Loc,
    ) -> Stmt {
        Stmt {
            loc,
            data: orig_data.arena_alloc(bump),
        }
    }

    #[inline]
    pub fn alloc<T: StatementData>(orig_data: T, loc: crate::Loc) -> Stmt {
        data::Store::assert();
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

// ─── StatementData impls ───────────────────────────────────────────────────

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
                    // `StoreRef::from_bump` is the settled crate-wide arena-ref
                    // convention (see its docs in nodes.rs); expr.rs
                    // `arena_alloc` does the same. No separate `&'bump` ref
                    // type is planned.
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
// Every payload variant is either a `StoreRef<T>` (8 bytes, align 4) or a ZST,
// so `Data` = 1-byte discriminant + 8-byte payload → 12 at align 4. `Stmt` =
// `Data` (12, align 4) + `Loc` (i32) → 16. `Option<Data>`/`Option<Stmt>`
// niche-pack via spare discriminant values (33 variants < 256); a
// `#[repr(C)]`/`#[repr(u32)]` on `Data` would break it.
const _: () = assert!(core::mem::size_of::<Data>() == 12);
const _: () = assert!(core::mem::align_of::<Data>() == 4);
const _: () = assert!(
    core::mem::size_of::<Stmt>() == 16,
    "Expected Stmt to be 16 bytes"
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

/// Tag compare, then payload compare. Payloads here are arena pointers
/// (`StoreRef<T>`) or ZSTs, so this is tag + pointer-identity, never a deep
/// structural compare.
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

// Field-style union accessors (`data.s_function()`, `data.s_local()`, …).
// Callers `.unwrap()` (or pattern-match) — the `Option` is the cheapest
// sound encoding of a tag mismatch.
// Mirrors `expr::Data::e_*()`. Returns `Option<StoreRef<T>>` (Copy) for
// pointer-payload variants and `Option<T>` by value for inline ZST variants.
impl Data {
    // ── StoreRef<S::*> field-style accessors ────────────────────────────
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
    pub fn s_import(&self) -> Option<StoreRef<S::Import>> {
        if let Data::SImport(v) = *self {
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
    pub fn s_lazy_export(&self) -> Option<StoreRef<expr::Data>> {
        if let Data::SLazyExport(v) = *self {
            Some(v)
        } else {
            None
        }
    }

    // ── Inline (by-value) payload accessors ─────────────────────────────
    // These variants store the payload directly (no `StoreRef`); all are
    // zero-sized `Copy` types. Returned by value for symmetry with
    // `expr::Data::e_boolean()` etc.
}

// `new_store!` emits `pub mod stmt_store { pub struct Store; ... }` with
// `init/append/reset/destroy`.
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

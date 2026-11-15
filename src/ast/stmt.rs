use crate::expr::{self, Expr};
use crate::s as S;
use crate::{AstArena, StoreRef};

#[derive(Clone, Copy)]
pub struct Stmt<'a> {
    pub loc: crate::Loc,
    pub data: Data<'a>,
}

impl<'a> Stmt<'a> {
    pub fn assign(bump: &'a AstArena, a: Expr<'a>, b: Expr<'a>) -> Self {
        Stmt::allocate(
            bump,
            S::SExpr {
                value: Expr::assign(bump, a, b),
                ..Default::default()
            },
            a.loc,
        )
    }
}

impl Stmt<'_> {
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

    pub fn empty() -> Self {
        Stmt {
            data: Data::SEmpty(NONE),
            loc: crate::Loc::default(),
        }
    }

    pub fn to_empty(self) -> Self {
        Stmt {
            data: Data::SEmpty(NONE),
            loc: self.loc,
        }
    }
}

impl Default for Stmt<'_> {
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
pub trait StatementData<'a>: Sized {
    /// Arena-allocate `self` and wrap.
    fn arena_alloc(self, bump: &'a AstArena) -> Data<'a>;
}

impl<'a> Stmt<'a> {
    #[inline]
    pub fn allocate<T: StatementData<'a>>(
        bump: &'a AstArena,
        orig_data: T,
        loc: crate::Loc,
    ) -> Self {
        Stmt {
            loc,
            data: orig_data.arena_alloc(bump),
        }
    }

    pub fn allocate_expr(bump: &'a AstArena, expr: Expr<'a>) -> Self {
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
    // Pointer-payload variants: stored in the arena.
    ( ptr: $( ($ty:ty, $variant:ident) ),* $(,)?
      ; inline: $( ($ity:ty, $ivariant:ident) ),* $(,)? ) => {
        $(
            impl<'a> StatementData<'a> for $ty {
                #[inline]
                fn arena_alloc(self, bump: &'a AstArena) -> Data<'a> {
                    Data::$variant(bump.alloc_node(self))
                }
            }
        )*
        $(
            impl<'a> StatementData<'a> for $ity {
                #[inline]
                fn arena_alloc(self, _bump: &'a AstArena) -> Data<'a> { Data::$ivariant(self) }
            }
        )*
    };
}

impl_statement_data! {
    ptr:
        (S::Block<'a>,         SBlock),
        (S::Break,             SBreak),
        (S::Class<'a>,         SClass),
        (S::Comment<'a>,       SComment),
        (S::Continue,          SContinue),
        (S::Directive<'a>,     SDirective),
        (S::DoWhile<'a>,       SDoWhile),
        (S::Enum<'a>,          SEnum),
        (S::ExportClause<'a>,  SExportClause),
        (S::ExportDefault<'a>, SExportDefault),
        (S::ExportEquals<'a>,  SExportEquals),
        (S::ExportFrom<'a>,    SExportFrom),
        (S::ExportStar<'a>,    SExportStar),
        (S::SExpr<'a>,         SExpr),
        (S::ForIn<'a>,         SForIn),
        (S::ForOf<'a>,         SForOf),
        (S::For<'a>,           SFor),
        (S::Function<'a>,      SFunction),
        (S::If<'a>,            SIf),
        (S::Import<'a>,        SImport),
        (S::Label<'a>,         SLabel),
        (S::Local<'a>,         SLocal),
        (S::Namespace<'a>,     SNamespace),
        (S::Return<'a>,        SReturn),
        (S::Switch<'a>,        SSwitch),
        (S::Throw<'a>,         SThrow),
        (S::Try<'a>,           STry),
        (S::While<'a>,         SWhile),
        (S::With<'a>,          SWith),
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
pub enum Data<'a> {
    SBlock(StoreRef<'a, S::Block<'a>>),
    SBreak(StoreRef<'a, S::Break>),
    SClass(StoreRef<'a, S::Class<'a>>),
    SComment(StoreRef<'a, S::Comment<'a>>),
    SContinue(StoreRef<'a, S::Continue>),
    SDirective(StoreRef<'a, S::Directive<'a>>),
    SDoWhile(StoreRef<'a, S::DoWhile<'a>>),
    SEnum(StoreRef<'a, S::Enum<'a>>),
    SExportClause(StoreRef<'a, S::ExportClause<'a>>),
    SExportDefault(StoreRef<'a, S::ExportDefault<'a>>),
    SExportEquals(StoreRef<'a, S::ExportEquals<'a>>),
    SExportFrom(StoreRef<'a, S::ExportFrom<'a>>),
    SExportStar(StoreRef<'a, S::ExportStar<'a>>),
    SExpr(StoreRef<'a, S::SExpr<'a>>),
    SForIn(StoreRef<'a, S::ForIn<'a>>),
    SForOf(StoreRef<'a, S::ForOf<'a>>),
    SFor(StoreRef<'a, S::For<'a>>),
    SFunction(StoreRef<'a, S::Function<'a>>),
    SIf(StoreRef<'a, S::If<'a>>),
    SImport(StoreRef<'a, S::Import<'a>>),
    SLabel(StoreRef<'a, S::Label<'a>>),
    SLocal(StoreRef<'a, S::Local<'a>>),
    SNamespace(StoreRef<'a, S::Namespace<'a>>),
    SReturn(StoreRef<'a, S::Return<'a>>),
    SSwitch(StoreRef<'a, S::Switch<'a>>),
    SThrow(StoreRef<'a, S::Throw<'a>>),
    STry(StoreRef<'a, S::Try<'a>>),
    SWhile(StoreRef<'a, S::While<'a>>),
    SWith(StoreRef<'a, S::With<'a>>),

    STypeScript(S::TypeScript),
    SEmpty(S::Empty), // special case, its a zero value type
    SDebugger(S::Debugger),

    SLazyExport(StoreRef<'a, expr::Data<'a>>),
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

// Field-style union accessors (`data.s_function()`, `data.s_local()`, …).
// Callers `.unwrap()` (or pattern-match) — the `Option` is the cheapest
// sound encoding of a tag mismatch.
// Mirrors `expr::Data::e_*()`. Returns `Option<StoreRef<T>>` (Copy) for
// pointer-payload variants and `Option<T>` by value for inline ZST variants.
impl<'a> Data<'a> {
    // ── StoreRef<S::*> field-style accessors ────────────────────────────
    #[inline]
    pub fn s_class(&self) -> Option<StoreRef<'a, S::Class<'a>>> {
        if let Data::SClass(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_class_mut(&mut self) -> Option<&mut S::Class<'a>> {
        if let Data::SClass(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_expr(&self) -> Option<StoreRef<'a, S::SExpr<'a>>> {
        if let Data::SExpr(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_expr_mut(&mut self) -> Option<&mut S::SExpr<'a>> {
        if let Data::SExpr(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_function(&self) -> Option<StoreRef<'a, S::Function<'a>>> {
        if let Data::SFunction(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_function_mut(&mut self) -> Option<&mut S::Function<'a>> {
        if let Data::SFunction(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_import(&self) -> Option<StoreRef<'a, S::Import<'a>>> {
        if let Data::SImport(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_local_mut(&mut self) -> Option<&mut S::Local<'a>> {
        if let Data::SLocal(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn s_lazy_export(&self) -> Option<StoreRef<'a, expr::Data<'a>>> {
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

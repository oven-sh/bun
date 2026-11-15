use crate::expr::{self, Expr};
use crate::s as S;
use crate::{AstArena, StoreRef};

#[derive(Clone, Copy)]
pub struct Stmt {
    pub loc: crate::Loc,
    pub data: Data,
}

impl Stmt {
    pub fn assign(bump: &AstArena, a: Expr, b: Expr) -> Stmt {
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
    /// Arena-allocate `self` and wrap.
    fn arena_alloc(self, bump: &AstArena) -> Data;
}

impl Stmt {
    #[inline]
    pub fn allocate<T: StatementData>(bump: &AstArena, orig_data: T, loc: crate::Loc) -> Stmt {
        Stmt {
            loc,
            data: orig_data.arena_alloc(bump),
        }
    }

    pub fn allocate_expr(bump: &AstArena, expr: Expr) -> Stmt {
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
            impl StatementData for $ty {
                #[inline]
                fn arena_alloc(self, bump: &AstArena) -> Data {
                    Data::$variant(bump.alloc_node(self))
                }
            }
        )*
        $(
            impl StatementData for $ity {
                #[inline]
                fn arena_alloc(self, _bump: &AstArena) -> Data { Data::$ivariant(self) }
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

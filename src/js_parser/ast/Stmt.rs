use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_logger as logger;

use crate::ast::expr::{self, Expr};
use crate::ast::s as S;
use crate::ast::{ASTMemoryAllocator, NewBatcher, NewStore, StoreRef};

#[derive(Clone, Copy)]
pub struct Stmt {
    pub loc: logger::Loc,
    pub data: Data,
}

pub type Batcher = NewBatcher<Stmt>;

impl Stmt {
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

struct Serializable {
    r#type: Tag,
    object: &'static [u8],
    value: Data,
    loc: logger::Loc,
}

impl Stmt {
    pub fn json_stringify<W>(&self, writer: &mut W) -> Result<(), bun_core::Error>
    where
        // TODO(port): narrow error set
        W: crate::ast::JsonWriter,
    {
        // TODO(port): std.meta.activeTag — Data is a Rust enum so a discriminant accessor is needed
        writer.write(Serializable {
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
            loc: logger::Loc::default(),
        }
    }

    pub fn to_empty(self) -> Stmt {
        Stmt {
            data: Data::SEmpty(NONE),
            loc: self.loc,
        }
    }
}

const NONE: S::Empty = S::Empty {};

// PORT NOTE: Zig `pub var icount: usize = 0;` is a plain mutable global (not
// threadlocal). Use a relaxed atomic to keep safe Rust; this is a debug counter.
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
    pub fn init<T: StatementData>(orig_data: StoreRef<T>, loc: logger::Loc) -> Stmt {
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Stmt {
            loc,
            data: T::wrap_ref(orig_data),
        }
    }

    // Zig `comptime_alloc` — folded into `StatementData::store_alloc`; kept as a
    // private helper for diff parity.
    #[inline]
    fn comptime_alloc<T: StatementData>(orig_data: T, loc: logger::Loc) -> Stmt {
        Stmt {
            loc,
            data: orig_data.store_alloc(),
        }
    }

    // Zig `allocateData` — folded into `StatementData::arena_alloc`.
    fn allocate_data<T: StatementData>(
        bump: &bun_alloc::Arena,
        orig_data: T,
        loc: logger::Loc,
    ) -> Stmt {
        // `allocator.create(@TypeOf(origData)) catch unreachable; value.* = origData;`
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

    pub fn alloc<T: StatementData>(orig_data: T, loc: logger::Loc) -> Stmt {
        data::Store::assert();
        ICOUNT.fetch_add(1, Ordering::Relaxed);
        Stmt::comptime_alloc(orig_data, loc)
    }
}

pub type Disabler = bun_core::DebugOnlyDisabler<Stmt>;

impl Stmt {
    /// When the lifetime of an Stmt.Data's pointer must exist longer than reset() is called, use this function.
    /// Be careful to free the memory (or use an allocator that does it for you)
    /// Also, prefer Stmt.init or Stmt.alloc when possible. This will be slower.
    pub fn allocate<T: StatementData>(
        bump: &bun_alloc::Arena,
        orig_data: T,
        loc: logger::Loc,
    ) -> Stmt {
        data::Store::assert();
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
                fn wrap_ref(ptr: StoreRef<Self>) -> Data { Data::$variant(ptr) }
                fn store_alloc(self) -> Data {
                    Data::$variant(data::Store::append(self))
                }
                fn arena_alloc(self, bump: &bun_alloc::Arena) -> Data {
                    // TODO(port): StoreRef vs &'bump — Phase B unify arena ref type
                    Data::$variant(StoreRef::from_bump(bump.alloc(self)))
                }
            }
        )*
        $(
            impl StatementData for $ity {
                fn wrap_ref(_ptr: StoreRef<Self>) -> Data { Data::$ivariant(<$ity>::default()) }
                fn store_alloc(self) -> Data { Data::$ivariant(self) }
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
        W: crate::ast::JsonWriter,
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

#[derive(Clone, Copy)]
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

const _: () = assert!(
    core::mem::size_of::<Stmt>() <= 24,
    "Expected Stmt to be <= 24 bytes"
);

impl Data {
    // TODO(port): derive or hand-map Data → Tag (Zig got this free from `union(Tag)`).
    pub fn tag(&self) -> Tag {
        todo!("port: 33-arm Data→Tag match")
    }
}

pub mod data {
    use super::*;

    pub mod Store {
        #![allow(non_snake_case)]
        use super::*;

        // TODO(port): NewStore takes a comptime type list + block size. Rust has
        // no variadic type params; Phase B defines `StmtStoreTypes` as a tuple
        // or generates per-type slabs via macro. The list below mirrors Zig.
        pub type StoreType = NewStore<
            (
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
            ),
            128,
        >;

        thread_local! {
            pub static INSTANCE: Cell<Option<NonNull<StoreType>>> =
                const { Cell::new(None) };
            pub static MEMORY_ALLOCATOR: Cell<Option<NonNull<ASTMemoryAllocator>>> =
                const { Cell::new(None) };
            pub static DISABLE_RESET: Cell<bool> = const { Cell::new(false) };
        }

        pub fn create() {
            if INSTANCE.with(|c| c.get()).is_some()
                || MEMORY_ALLOCATOR.with(|c| c.get()).is_some()
            {
                return;
            }
            INSTANCE.with(|c| c.set(Some(StoreType::init())));
        }

        /// create || reset
        pub fn begin() {
            if MEMORY_ALLOCATOR.with(|c| c.get()).is_some() {
                return;
            }
            if INSTANCE.with(|c| c.get()).is_none() {
                create();
                return;
            }
            if !DISABLE_RESET.with(|c| c.get()) {
                // SAFETY: checked is_some() above; thread-local, no concurrent mutation.
                unsafe { INSTANCE.with(|c| c.get()).unwrap().as_mut() }.reset();
            }
        }

        pub fn reset() {
            if DISABLE_RESET.with(|c| c.get()) || MEMORY_ALLOCATOR.with(|c| c.get()).is_some() {
                return;
            }
            // SAFETY: caller contract — instance is set when reset() is called.
            unsafe { INSTANCE.with(|c| c.get()).unwrap().as_mut() }.reset();
        }

        pub fn deinit() {
            if INSTANCE.with(|c| c.get()).is_none()
                || MEMORY_ALLOCATOR.with(|c| c.get()).is_some()
            {
                return;
            }
            // SAFETY: checked is_some() above.
            unsafe { INSTANCE.with(|c| c.get()).unwrap().as_mut() }.deinit();
            INSTANCE.with(|c| c.set(None));
        }

        #[inline]
        pub fn assert() {
            if cfg!(debug_assertions) {
                if INSTANCE.with(|c| c.get()).is_none()
                    && MEMORY_ALLOCATOR.with(|c| c.get()).is_none()
                {
                    unreachable!("Store must be init'd");
                }
            }
        }

        pub fn append<T>(value: T) -> StoreRef<T> {
            if let Some(allocator) = MEMORY_ALLOCATOR.with(|c| c.get()) {
                // SAFETY: MEMORY_ALLOCATOR is set by the owning scope and outlives this call.
                return unsafe { allocator.as_ref() }.append(value);
            }
            Disabler::assert();
            // SAFETY: assert() guarantees instance is set on this thread.
            unsafe { INSTANCE.with(|c| c.get()).unwrap().as_mut() }.append(value)
        }
    }
}

// Zig `pub fn StoredData(tag: Tag) type` — returns the payload type for a tag,
// dereferencing pointer variants. Rust has no type-returning fns.
// TODO(port): callers should use the `StatementData` trait or a per-variant
// associated type; revisit in Phase B once call sites are known.

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

            Data::SLocal(local) => local.kind != S::local::Kind::KVar,

            _ => true,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/Stmt.zig (423 lines)
//   confidence: medium
//   todos:      8
//   notes:      comptime type-switch tables folded into StatementData trait + macro; Data.tag() and StoredData need real impls; Store thread-locals use NonNull (ownership TBD)
// ──────────────────────────────────────────────────────────────────────────

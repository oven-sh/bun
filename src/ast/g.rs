use bun_collections::VecExt;

use crate::base::Ref;
use crate::binding::Binding as BindingNodeIndex;
use crate::expr::Expr as ExprNodeIndex;
use crate::stmt::Stmt;
use crate::ts as TypeScript;
use crate::{ExprData, ExprNodeList, LocRef, StmtNodeList, StoreSlice, StoreStr, flags};

/// Zig: `G.Fn.flags: Flags.Function.Set`. Downstream crates address the flag
/// enum via `G::FnFlags::IsExport` etc.; re-export the enum + set type here.
pub use crate::flags::Function as FnFlags;
pub use crate::flags::FunctionSet as FnFlagsSet;

// PORT NOTE: all `&'ast mut [T]` arena slices are `StoreSlice<T>` (lifetime-
// erased arena-slice newtype). 'ast/'bump can be threaded crate-wide later by
// adding a `PhantomData<&'arena ()>` to `StoreSlice` in one pass.

#[derive(Clone, Copy)]
pub struct Decl {
    pub binding: BindingNodeIndex,
    pub value: Option<ExprNodeIndex>,
}

// Zig: `pub const List = Vec(Decl);` (nested decl) — inherent assoc types
// are nightly; free alias.
pub type DeclList = Vec<Decl, bun_alloc::AstAlloc>;

impl Default for Decl {
    fn default() -> Self {
        Self {
            binding: BindingNodeIndex::default(),
            value: None,
        }
    }
}

pub struct NamespaceAlias {
    pub namespace_ref: Ref,
    pub alias: StoreStr,

    pub was_originally_property_access: bool,

    pub import_record_index: u32,
}

impl Default for NamespaceAlias {
    fn default() -> Self {
        Self {
            namespace_ref: Ref::default(),
            alias: StoreStr::EMPTY,
            was_originally_property_access: false,
            import_record_index: u32::MAX,
        }
    }
}

pub struct ExportStarAlias {
    pub loc: crate::Loc,

    // Although this alias name starts off as being the same as the statement's
    // namespace symbol, it may diverge if the namespace symbol name is minified.
    // The original alias name is preserved here to avoid this scenario.
    pub original_name: StoreStr,
}

pub struct Class {
    pub class_keyword: crate::Range,
    pub ts_decorators: ExprNodeList,
    pub class_name: Option<LocRef>,
    pub extends: Option<ExprNodeIndex>,
    pub body_loc: crate::Loc,
    pub close_brace_loc: crate::Loc,
    pub properties: StoreSlice<Property>,
    pub has_decorators: bool,
    pub should_lower_standard_decorators: bool,
}

impl Default for Class {
    fn default() -> Self {
        Self {
            class_keyword: crate::Range::NONE,
            ts_decorators: bun_alloc::AstAlloc::vec(),
            class_name: None,
            extends: None,
            body_loc: crate::Loc::EMPTY,
            close_brace_loc: crate::Loc::EMPTY,
            properties: StoreSlice::EMPTY,
            has_decorators: false,
            should_lower_standard_decorators: false,
        }
    }
}

impl Class {
    pub fn can_be_moved(&self) -> bool {
        if self.extends.is_some() {
            return false;
        }

        if self.has_decorators {
            return false;
        }

        for property in self.properties.iter() {
            if property.kind == PropertyKind::ClassStaticBlock {
                return false;
            }

            let f = property.flags;
            if f.contains(flags::Property::IsComputed) || f.contains(flags::Property::IsSpread) {
                return false;
            }

            if property.kind == PropertyKind::Normal && f.contains(flags::Property::IsStatic) {
                for val_ in [property.value, property.initializer] {
                    if let Some(val) = val_ {
                        match val.data {
                            ExprData::EArrow(..) | ExprData::EFunction(..) => {}
                            _ => {
                                if !val.data.can_be_moved() {
                                    return false;
                                }
                            }
                        }
                    }
                }
            }
        }

        true
    }
}

// invalid shadowing if left as Comment
pub struct Comment {
    pub loc: crate::Loc,
    pub text: StoreStr,
}

pub struct ClassStaticBlock {
    pub stmts: Vec<Stmt, bun_alloc::AstAlloc>,
    pub loc: crate::Loc,
}

impl Default for ClassStaticBlock {
    fn default() -> Self {
        Self {
            stmts: bun_alloc::AstAlloc::vec(),
            loc: crate::Loc::default(),
        }
    }
}

pub struct Property {
    /// This is used when parsing a pattern that uses default values:
    ///
    ///   [a = 1] = [];
    ///   ({a = 1} = {});
    ///
    /// It's also used for class fields:
    ///
    ///   class Foo { a = 1 }
    ///
    pub initializer: Option<ExprNodeIndex>,
    pub kind: PropertyKind,
    pub flags: flags::PropertySet,

    // Arena-owned `?*ClassStaticBlock` (Zig). `StoreRef` centralises the
    // raw-pointer deref so the accessors below stay safe.
    pub class_static_block: Option<crate::StoreRef<ClassStaticBlock>>,
    pub ts_decorators: ExprNodeList,
    // Key is optional for spread
    pub key: Option<ExprNodeIndex>,

    // This is omitted for class fields
    pub value: Option<ExprNodeIndex>,

    pub ts_metadata: TypeScript::Metadata,
}

// Zig: nested `pub const List = Vec(Property);` — free alias.
pub type PropertyList = Vec<Property, bun_alloc::AstAlloc>;

impl Default for Property {
    fn default() -> Self {
        Self {
            initializer: None,
            kind: PropertyKind::Normal,
            flags: flags::PROPERTY_NONE,
            class_static_block: None,
            ts_decorators: bun_alloc::AstAlloc::vec(),
            key: None,
            value: None,
            ts_metadata: TypeScript::Metadata::MNone,
        }
    }
}

impl Property {
    /// Re-borrow `class_static_block` as `Option<&ClassStaticBlock>`. Routes
    /// through `StoreRef::Deref` so callers (printer/visitor/can-be-removed
    /// analysis) need no `unsafe`.
    #[inline]
    pub fn class_static_block_ref(&self) -> Option<&ClassStaticBlock> {
        self.class_static_block.as_deref()
    }

    /// Mutable sibling of [`class_static_block_ref`]. Routes through
    /// `StoreRef::DerefMut` (same arena contract: callers must not hold an
    /// overlapping `&`/`&mut` to the same `ClassStaticBlock` — upheld by the
    /// single-threaded visitor pass).
    #[inline]
    pub fn class_static_block_mut(&mut self) -> Option<&mut ClassStaticBlock> {
        self.class_static_block.as_deref_mut()
    }

    pub fn deep_clone(
        &self,
        bump: &bun_alloc::Arena,
    ) -> core::result::Result<Property, bun_alloc::AllocError> {
        let mut class_static_block: Option<crate::StoreRef<ClassStaticBlock>> = None;
        if let Some(csb_ref) = self.class_static_block_ref() {
            let new_block: &mut ClassStaticBlock = bump.alloc(ClassStaticBlock {
                loc: csb_ref.loc,
                stmts: bun_alloc::AstAlloc::vec_from_slice(csb_ref.stmts.slice()),
            });
            class_static_block = Some(crate::StoreRef::from_bump(new_block));
        }
        Ok(Property {
            initializer: match self.initializer {
                Some(init) => Some(init.deep_clone(bump)?),
                None => None,
            },
            kind: self.kind,
            flags: self.flags,
            class_static_block,
            // Zig: `try this.ts_decorators.deepClone(arena)` — Vec<Expr> per-element deep clone.
            ts_decorators: self
                .ts_decorators
                .try_deep_clone_with(|e| e.deep_clone(bump))?,
            key: match self.key {
                Some(key) => Some(key.deep_clone(bump)?),
                None => None,
            },
            value: match self.value {
                Some(value) => Some(value.deep_clone(bump)?),
                None => None,
            },
            ts_metadata: self.ts_metadata.clone(),
        })
    }
}

// Zig: `enum(u3)` — Rust has no u3, use u8
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum PropertyKind {
    Normal,
    Get,
    Set,
    Spread,
    Declare,
    Abstract,
    ClassStaticBlock,
    AutoAccessor,
}

impl PropertyKind {
    // TODO(port): Zig `jsonStringify(self, writer: anytype) !void` — maps to a serde-like
    // protocol writing @tagName(self). Phase B: decide on the json writer trait.
    pub fn json_stringify(self, writer: &mut impl core::fmt::Write) -> core::fmt::Result {
        // Zig: `writer.write(@tagName(self))` on a std.json WriteStream — emits a
        // *quoted* JSON string. Tag names are [a-z_] so no escaping needed.
        write!(writer, "\"{}\"", <&'static str>::from(self))
    }
}

pub struct FnBody {
    pub loc: crate::Loc,
    pub stmts: StmtNodeList,
}

impl FnBody {
    pub fn init_return_expr(
        bump: &bun_alloc::Arena,
        expr: ExprNodeIndex,
    ) -> core::result::Result<FnBody, bun_alloc::AllocError> {
        // PERF(port): Zig used arena.dupe over a 1-elem array literal; bumpalo equivalent
        let stmts: &mut [Stmt] = bump.alloc_slice_fill_with(1, |_| {
            Stmt::alloc(crate::s::Return { value: Some(expr) }, expr.loc)
        });
        Ok(FnBody {
            stmts: StoreSlice::new_mut(stmts),
            loc: expr.loc,
        })
    }
}

pub struct Fn {
    pub name: Option<LocRef>,
    pub open_parens_loc: crate::Loc,
    pub args: StoreSlice<Arg>,
    // This was originally nullable, but doing so I believe caused a miscompilation
    // Specifically, the body was always null.
    pub body: FnBody,
    pub arguments_ref: Option<Ref>,

    pub flags: flags::FunctionSet,

    pub return_ts_metadata: TypeScript::Metadata,
}

impl Default for Fn {
    fn default() -> Self {
        Self {
            name: None,
            open_parens_loc: crate::Loc::EMPTY,
            args: StoreSlice::EMPTY,
            body: FnBody {
                loc: crate::Loc::EMPTY,
                stmts: StmtNodeList::EMPTY,
            },
            arguments_ref: None,
            flags: flags::FUNCTION_NONE,
            return_ts_metadata: TypeScript::Metadata::MNone,
        }
    }
}

impl Fn {
    pub fn deep_clone(
        &self,
        bump: &bun_alloc::Arena,
    ) -> core::result::Result<Fn, bun_alloc::AllocError> {
        // PERF(port): Zig arena.alloc + per-index assign; bumpalo equivalent.
        let src_args: &[Arg] = self.args.slice();
        let args: &mut [Arg] = bump.alloc_slice_fill_default::<Arg>(src_args.len());
        for i in 0..args.len() {
            args[i] = src_args[i].deep_clone(bump)?;
        }
        Ok(Fn {
            name: self.name,
            open_parens_loc: self.open_parens_loc,
            args: StoreSlice::new_mut(args),
            body: FnBody {
                loc: self.body.loc,
                stmts: self.body.stmts,
            },
            arguments_ref: self.arguments_ref,
            flags: self.flags,
            return_ts_metadata: self.return_ts_metadata.clone(),
        })
    }
}

pub struct Arg {
    pub ts_decorators: ExprNodeList,
    pub binding: BindingNodeIndex,
    pub default: Option<ExprNodeIndex>,

    // "constructor(public x: boolean) {}"
    pub is_typescript_ctor_field: bool,

    pub ts_metadata: TypeScript::Metadata,
}

impl Default for Arg {
    fn default() -> Self {
        Self {
            ts_decorators: bun_alloc::AstAlloc::vec(),
            binding: BindingNodeIndex::default(),
            default: None,
            is_typescript_ctor_field: false,
            ts_metadata: TypeScript::Metadata::MNone,
        }
    }
}

impl Arg {
    pub fn deep_clone(
        &self,
        bump: &bun_alloc::Arena,
    ) -> core::result::Result<Arg, bun_alloc::AllocError> {
        Ok(Arg {
            // Zig: `try this.ts_decorators.deepClone(arena)` — Vec<Expr> per-element deep clone.
            ts_decorators: self
                .ts_decorators
                .try_deep_clone_with(|e| e.deep_clone(bump))?,
            binding: self.binding,
            default: match self.default {
                Some(d) => Some(d.deep_clone(bump)?),
                None => None,
            },
            is_typescript_ctor_field: self.is_typescript_ctor_field,
            ts_metadata: self.ts_metadata.clone(),
        })
    }
}

// ported from: src/js_parser/ast/G.zig

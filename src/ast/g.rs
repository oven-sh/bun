use crate::base::Ref;
use crate::binding::Binding as BindingNodeIndex;
use crate::expr::Expr as ExprNodeIndex;
use crate::stmt::Stmt;
use crate::ts as TypeScript;
use crate::{AstVec, ExprData, LocRef, StmtNodeList, StoreSlice, StoreStr, flags};

/// Downstream crates address the flag enum via `G::FnFlags::IsExport` etc.;
/// re-export the enum + set type here.
pub use crate::flags::Function as FnFlags;

#[derive(Clone, Copy, Default)]
pub struct Decl<'a> {
    pub binding: BindingNodeIndex<'a>,
    pub value: Option<ExprNodeIndex<'a>>,
}

// Inherent assoc types are nightly; free alias.
pub type DeclList<'a> = AstVec<'a, Decl<'a>>;

pub struct NamespaceAlias<'a> {
    pub namespace_ref: Ref,
    pub alias: StoreStr<'a>,

    pub was_originally_property_access: bool,

    pub import_record_index: u32,
}

impl Default for NamespaceAlias<'_> {
    fn default() -> Self {
        Self {
            namespace_ref: Ref::default(),
            alias: StoreStr::EMPTY,
            was_originally_property_access: false,
            import_record_index: u32::MAX,
        }
    }
}

pub struct ExportStarAlias<'a> {
    pub loc: crate::Loc,

    // Although this alias name starts off as being the same as the statement's
    // namespace symbol, it may diverge if the namespace symbol name is minified.
    // The original alias name is preserved here to avoid this scenario.
    pub original_name: StoreStr<'a>,
}

#[derive(Clone, Copy)]
pub struct Class<'a> {
    pub class_keyword: crate::Range,
    pub ts_decorators: StoreSlice<'a, ExprNodeIndex<'a>>,
    pub class_name: Option<LocRef>,
    pub extends: Option<ExprNodeIndex<'a>>,
    pub body_loc: crate::Loc,
    pub close_brace_loc: crate::Loc,
    pub properties: StoreSlice<'a, Property<'a>>,
    pub has_decorators: bool,
    pub should_lower_standard_decorators: bool,
    /// `useDefineForClassFields: false` turned the instance fields into
    /// assignments in the constructor.
    pub assigns_fields_in_constructor: bool,
    /// What the body reads the class name as when standard (TC39) class
    /// decorators are lowered: the lowering assigns the decorated class to it.
    /// `Ref::NONE` otherwise, including for TypeScript experimental decorators.
    pub inner_class_ref: Ref,
}

impl Default for Class<'_> {
    fn default() -> Self {
        Self {
            class_keyword: crate::Range::NONE,
            ts_decorators: StoreSlice::EMPTY,
            class_name: None,
            extends: None,
            body_loc: crate::Loc::EMPTY,
            close_brace_loc: crate::Loc::EMPTY,
            properties: StoreSlice::EMPTY,
            has_decorators: false,
            should_lower_standard_decorators: false,
            assigns_fields_in_constructor: false,
            inner_class_ref: Ref::NONE,
        }
    }
}

impl Class<'_> {
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

            if (property.kind == PropertyKind::Normal
                || property.kind == PropertyKind::AutoAccessor)
                && f.contains(flags::Property::IsStatic)
            {
                for val in [property.value, property.initializer].into_iter().flatten() {
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

        true
    }
}

// invalid shadowing if left as Comment
pub struct Comment<'a> {
    pub loc: crate::Loc,
    pub text: StoreStr<'a>,
}

pub struct ClassStaticBlock<'a> {
    pub stmts: AstVec<'a, Stmt<'a>>,
    pub loc: crate::Loc,
}

#[derive(Clone, Copy)]
pub struct Property<'a> {
    /// This is used when parsing a pattern that uses default values:
    ///
    ///   [a = 1] = [];
    ///   ({a = 1} = {});
    ///
    /// It's also used for class fields:
    ///
    ///   class Foo { a = 1 }
    ///
    pub initializer: Option<ExprNodeIndex<'a>>,
    pub kind: PropertyKind,
    pub flags: flags::PropertySet,

    // Arena-owned. `StoreRef` centralises the raw-pointer deref so the
    // accessors below stay safe.
    pub class_static_block: Option<crate::StoreRef<'a, ClassStaticBlock<'a>>>,
    pub ts_decorators: StoreSlice<'a, ExprNodeIndex<'a>>,
    // Key is optional for spread
    pub key: Option<ExprNodeIndex<'a>>,

    // This is omitted for class fields
    pub value: Option<ExprNodeIndex<'a>>,

    pub ts_metadata: TypeScript::Metadata<'a>,
}

pub type PropertyList<'a> = AstVec<'a, Property<'a>>;

impl Default for Property<'_> {
    fn default() -> Self {
        Self {
            initializer: None,
            kind: PropertyKind::Normal,
            flags: flags::PROPERTY_NONE,
            class_static_block: None,
            ts_decorators: StoreSlice::EMPTY,
            key: None,
            value: None,
            ts_metadata: TypeScript::Metadata::MNone,
        }
    }
}

impl<'a> Property<'a> {
    /// Re-borrow `class_static_block` as `Option<&ClassStaticBlock>`. Routes
    /// through `StoreRef::Deref` so callers (printer/visitor/can-be-removed
    /// analysis) need no `unsafe`.
    #[inline]
    pub fn class_static_block_ref(&self) -> Option<&ClassStaticBlock<'a>> {
        self.class_static_block.as_deref()
    }

    /// Mutable sibling of [`class_static_block_ref`]. Routes through
    /// `StoreRef::DerefMut` (same arena contract: callers must not hold an
    /// overlapping `&`/`&mut` to the same `ClassStaticBlock` — upheld by the
    /// single-threaded visitor pass).
    #[inline]
    pub fn class_static_block_mut(&mut self) -> Option<&mut ClassStaticBlock<'a>> {
        self.class_static_block.as_deref_mut()
    }

    pub(crate) fn deep_clone_json<'b>(
        &self,
        bump: &'b crate::AstArena,
        stack_check: bun_core::StackCheck,
    ) -> crate::Result<Property<'b>>
    where
        'a: 'b,
    {
        Ok(Property {
            kind: self.kind,
            flags: self.flags,
            key: match self.key {
                Some(key) => Some(key.deep_clone_json_with_check(bump, stack_check)?),
                None => None,
            },
            value: match self.value {
                Some(value) => Some(value.deep_clone_json_with_check(bump, stack_check)?),
                None => None,
            },
            ..Property::default()
        })
    }
}

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

#[derive(Clone, Copy)]
pub struct FnBody<'a> {
    pub loc: crate::Loc,
    pub stmts: StmtNodeList<'a>,
}

impl<'a> FnBody<'a> {
    pub fn init_return_expr(
        bump: &'a crate::AstArena,
        expr: ExprNodeIndex<'a>,
    ) -> core::result::Result<Self, bun_alloc::AllocError> {
        let stmts: &mut [Stmt] = bump.alloc_slice_fill_with(1, |_| {
            Stmt::allocate(bump, crate::s::Return { value: Some(expr) }, expr.loc)
        });
        Ok(FnBody {
            stmts: StoreSlice::new_mut(stmts),
            loc: expr.loc,
        })
    }
}

#[derive(Clone, Copy)]
pub struct Fn<'a> {
    pub name: Option<LocRef>,
    pub open_parens_loc: crate::Loc,
    pub args: StoreSlice<'a, Arg<'a>>,
    // This was originally nullable, but doing so I believe caused a miscompilation
    // Specifically, the body was always null.
    pub body: FnBody<'a>,
    pub arguments_ref: Ref,

    pub flags: flags::FunctionSet,

    pub return_ts_metadata: TypeScript::Metadata<'a>,
}

impl Default for Fn<'_> {
    fn default() -> Self {
        Self {
            name: None,
            open_parens_loc: crate::Loc::EMPTY,
            args: StoreSlice::EMPTY,
            body: FnBody {
                loc: crate::Loc::EMPTY,
                stmts: StmtNodeList::EMPTY,
            },
            arguments_ref: Ref::NONE,
            flags: flags::FUNCTION_NONE,
            return_ts_metadata: TypeScript::Metadata::MNone,
        }
    }
}

#[derive(Clone, Copy)]
pub struct Arg<'a> {
    pub ts_decorators: StoreSlice<'a, ExprNodeIndex<'a>>,
    pub binding: BindingNodeIndex<'a>,
    pub default: Option<ExprNodeIndex<'a>>,

    // "constructor(public x: boolean) {}"
    pub is_typescript_ctor_field: bool,

    pub ts_metadata: TypeScript::Metadata<'a>,
}

impl Default for Arg<'_> {
    fn default() -> Self {
        Self {
            ts_decorators: StoreSlice::EMPTY,
            binding: BindingNodeIndex::default(),
            default: None,
            is_typescript_ctor_field: false,
            ts_metadata: TypeScript::Metadata::MNone,
        }
    }
}

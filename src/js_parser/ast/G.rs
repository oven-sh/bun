use bun_alloc::Arena as Bump;
use bun_collections::BabyList;
use bun_logger as logger;

use bun_js_parser::ast::{
    BindingNodeIndex, Expr, ExprNodeIndex, ExprNodeList, Flags, LocRef, Ref, Stmt, StmtNodeList, S,
};
use bun_js_parser::TypeScript;

// TODO(port): narrow error set — Zig `!T` here is effectively OOM-only from arena allocs
type Result<T> = core::result::Result<T, bun_alloc::AllocError>;

pub struct Decl {
    pub binding: BindingNodeIndex,
    pub value: Option<ExprNodeIndex>,
}

impl Decl {
    pub type List = BabyList<Decl>;
}

impl Default for Decl {
    fn default() -> Self {
        Self { binding: BindingNodeIndex::default(), value: None }
    }
}

pub struct NamespaceAlias {
    pub namespace_ref: Ref,
    // TODO(port): arena-owned string slice; revisit as `&'ast [u8]` / StoreRef in Phase B
    pub alias: *const [u8],

    pub was_originally_property_access: bool,

    pub import_record_index: u32,
}

impl Default for NamespaceAlias {
    fn default() -> Self {
        Self {
            namespace_ref: Ref::default(),
            alias: &[] as *const [u8],
            was_originally_property_access: false,
            import_record_index: u32::MAX,
        }
    }
}

pub struct ExportStarAlias {
    pub loc: logger::Loc,

    // Although this alias name starts off as being the same as the statement's
    // namespace symbol, it may diverge if the namespace symbol name is minified.
    // The original alias name is preserved here to avoid this scenario.
    // TODO(port): arena-owned string slice; revisit as `&'ast [u8]` / StoreRef in Phase B
    pub original_name: *const [u8],
}

pub struct Class<'ast> {
    pub class_keyword: logger::Range,
    pub ts_decorators: ExprNodeList,
    pub class_name: Option<LocRef>,
    pub extends: Option<ExprNodeIndex>,
    pub body_loc: logger::Loc,
    pub close_brace_loc: logger::Loc,
    // TODO(port): arena-owned mutable slice; default is empty static slice in Zig
    pub properties: &'ast mut [Property<'ast>],
    pub has_decorators: bool,
    pub should_lower_standard_decorators: bool,
}

impl<'ast> Default for Class<'ast> {
    fn default() -> Self {
        Self {
            class_keyword: logger::Range::NONE,
            ts_decorators: ExprNodeList::default(),
            class_name: None,
            extends: None,
            body_loc: logger::Loc::EMPTY,
            close_brace_loc: logger::Loc::EMPTY,
            properties: &mut [],
            has_decorators: false,
            should_lower_standard_decorators: false,
        }
    }
}

impl<'ast> Class<'ast> {
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

            let flags = property.flags;
            if flags.contains(Flags::Property::IS_COMPUTED) || flags.contains(Flags::Property::IS_SPREAD) {
                return false;
            }

            if property.kind == PropertyKind::Normal {
                if flags.contains(Flags::Property::IS_STATIC) {
                    for val_ in [property.value, property.initializer] {
                        if let Some(val) = val_ {
                            match val.data {
                                // TODO(port): exact Expr.Data variant names (e_arrow / e_function)
                                ExprData::EArrow(..) | ExprData::EFunction(..) => {}
                                _ => {
                                    if !val.can_be_moved() {
                                        return false;
                                    }
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

// TODO(port): Expr.Data tag type — placeholder import path for match arms above
use bun_js_parser::ast::expr::Data as ExprData;

// invalid shadowing if left as Comment
pub struct Comment {
    pub loc: logger::Loc,
    // TODO(port): arena-owned string slice
    pub text: *const [u8],
}

pub struct ClassStaticBlock {
    pub stmts: BabyList<Stmt>,
    pub loc: logger::Loc,
}

impl Default for ClassStaticBlock {
    fn default() -> Self {
        Self { stmts: BabyList::default(), loc: logger::Loc::default() }
    }
}

pub struct Property<'ast> {
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
    pub flags: Flags::Property::Set,

    pub class_static_block: Option<&'ast mut ClassStaticBlock>,
    pub ts_decorators: ExprNodeList,
    // Key is optional for spread
    pub key: Option<ExprNodeIndex>,

    // This is omitted for class fields
    pub value: Option<ExprNodeIndex>,

    pub ts_metadata: TypeScript::Metadata,
}

impl<'ast> Property<'ast> {
    pub type List = BabyList<Property<'ast>>;
}

impl<'ast> Default for Property<'ast> {
    fn default() -> Self {
        Self {
            initializer: None,
            kind: PropertyKind::Normal,
            flags: Flags::Property::NONE,
            class_static_block: None,
            ts_decorators: ExprNodeList::default(),
            key: None,
            value: None,
            ts_metadata: TypeScript::Metadata::MNone,
        }
    }
}

impl<'ast> Property<'ast> {
    pub fn deep_clone(&self, bump: &'ast Bump) -> Result<Property<'ast>> {
        let mut class_static_block: Option<&'ast mut ClassStaticBlock> = None;
        if let Some(csb) = &self.class_static_block {
            class_static_block = Some(bump.alloc(ClassStaticBlock {
                loc: csb.loc,
                stmts: csb.stmts.clone(bump)?,
            }));
        }
        Ok(Property {
            initializer: match self.initializer {
                Some(init) => Some(init.deep_clone(bump)?),
                None => None,
            },
            kind: self.kind,
            flags: self.flags,
            class_static_block,
            ts_decorators: self.ts_decorators.deep_clone(bump)?,
            key: match self.key {
                Some(key) => Some(key.deep_clone(bump)?),
                None => None,
            },
            value: match self.value {
                Some(value) => Some(value.deep_clone(bump)?),
                None => None,
            },
            ts_metadata: self.ts_metadata,
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
        writer.write_str(<&'static str>::from(self))
    }
}

pub struct FnBody {
    pub loc: logger::Loc,
    pub stmts: StmtNodeList,
}

impl FnBody {
    pub fn init_return_expr<'ast>(bump: &'ast Bump, expr: Expr) -> Result<FnBody> {
        // PERF(port): Zig used allocator.dupe over a 1-elem array literal; bumpalo equivalent
        let stmts = bump.alloc_slice_copy(&[Stmt::alloc::<S::Return>(
            S::Return { value: Some(expr) },
            expr.loc,
        )]);
        Ok(FnBody {
            // TODO(port): StmtNodeList exact type — assuming `&'ast mut [Stmt]` / slice-compatible
            stmts: stmts.into(),
            loc: expr.loc,
        })
    }
}

pub struct Fn<'ast> {
    pub name: Option<LocRef>,
    pub open_parens_loc: logger::Loc,
    // TODO(port): arena-owned mutable slice
    pub args: &'ast mut [Arg],
    // This was originally nullable, but doing so I believe caused a miscompilation
    // Specifically, the body was always null.
    pub body: FnBody,
    pub arguments_ref: Option<Ref>,

    pub flags: Flags::Function::Set,

    pub return_ts_metadata: TypeScript::Metadata,
}

impl<'ast> Default for Fn<'ast> {
    fn default() -> Self {
        Self {
            name: None,
            open_parens_loc: logger::Loc::EMPTY,
            args: &mut [],
            body: FnBody { loc: logger::Loc::EMPTY, stmts: StmtNodeList::default() },
            arguments_ref: None,
            flags: Flags::Function::NONE,
            return_ts_metadata: TypeScript::Metadata::MNone,
        }
    }
}

impl<'ast> Fn<'ast> {
    pub fn deep_clone(&self, bump: &'ast Bump) -> Result<Fn<'ast>> {
        // PERF(port): Zig allocator.alloc + per-index assign; bumpalo equivalent
        let args = bump.alloc_slice_fill_default::<Arg>(self.args.len());
        for i in 0..args.len() {
            args[i] = self.args[i].deep_clone(bump)?;
        }
        Ok(Fn {
            name: self.name,
            open_parens_loc: self.open_parens_loc,
            args,
            body: FnBody {
                loc: self.body.loc,
                stmts: self.body.stmts,
            },
            arguments_ref: self.arguments_ref,
            flags: self.flags,
            return_ts_metadata: self.return_ts_metadata,
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
            ts_decorators: ExprNodeList::default(),
            binding: BindingNodeIndex::default(),
            default: None,
            is_typescript_ctor_field: false,
            ts_metadata: TypeScript::Metadata::MNone,
        }
    }
}

impl Arg {
    pub fn deep_clone<'ast>(&self, bump: &'ast Bump) -> Result<Arg> {
        Ok(Arg {
            ts_decorators: self.ts_decorators.deep_clone(bump)?,
            binding: self.binding,
            default: match self.default {
                Some(d) => Some(d.deep_clone(bump)?),
                None => None,
            },
            is_typescript_ctor_field: self.is_typescript_ctor_field,
            ts_metadata: self.ts_metadata,
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/G.zig (232 lines)
//   confidence: medium
//   todos:      8
//   notes:      AST arena crate — '<ast> lifetimes cascade from LIFETIMES.tsv (Property.class_static_block); Flags::Property/Function path & ExprData variant names need Phase B fixup; `string` fields kept as raw *const [u8] per arena-slice rule.
// ──────────────────────────────────────────────────────────────────────────

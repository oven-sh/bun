//! What can be said of a file without looking at any other: which declaration each name means, who contains what, and
//! how control flows. Runs right after the parser, on the same thread.

mod binder;

use crate::atom::{Atom, Interner, known};
use crate::hir::*;
use crate::util::{FxHashMap, FxHashSet};

macro_rules! define_id {
    ($($name:ident),*) => {$(
        #[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
        pub struct $name(pub u32);
        impl $name {
            pub const NONE: $name = $name(u32::MAX);
            #[inline] pub fn is_none(self) -> bool { self.0 == u32::MAX }
            #[inline] pub fn is_some(self) -> bool { self.0 != u32::MAX }
            #[inline] pub fn idx(self) -> usize { self.0 as usize }
        }
        impl Default for $name { fn default() -> Self { Self::NONE } }
    )*};
}
define_id!(SymbolId, ScopeId, TableId, FlowId);

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub struct SymFlags: u32 {
        const FUNCTION_SCOPED_VARIABLE = 1 << 0;
        const BLOCK_SCOPED_VARIABLE = 1 << 1;
        const FUNCTION = 1 << 2;
        const CLASS = 1 << 3;
        const INTERFACE = 1 << 4;
        const ENUM = 1 << 5;
        const VALUE_MODULE = 1 << 6;
        const NAMESPACE_MODULE = 1 << 7;
        const TYPE_PARAMETER = 1 << 8;
        const TYPE_ALIAS = 1 << 9;
        const ALIAS = 1 << 10;
        const ENUM_MEMBER = 1 << 11;
        /// `export default <expression>`, `export = <expression>`
        const EXPORT_VALUE = 1 << 12;
        /// Something assigns to the variable after its declaration.
        const ASSIGNED = 1 << 13;
        const CONST = 1 << 14;
        const PARAMETER = 1 << 15;
        /// Part of a symbol made of declarations in several places: see `Program`.
        const MERGED = 1 << 16;
        const TYPE_ONLY = 1 << 17;
        /// A name others import by, which nothing in the file can refer to: `export { a as b }`, `export default e`.
        const EXPORT_ONLY = 1 << 18;
        /// Together with `ENUM`: a `const enum`, which is one symbol with other `const enum`s alone.
        const CONST_ENUM = 1 << 19;
        /// `module` and `exports` in a CommonJS module.
        const MODULE_EXPORTS = 1 << 20;

        const VARIABLE = Self::FUNCTION_SCOPED_VARIABLE.bits() | Self::BLOCK_SCOPED_VARIABLE.bits();
        const VALUE = Self::VARIABLE.bits() | Self::FUNCTION.bits() | Self::CLASS.bits() | Self::ENUM.bits()
            | Self::VALUE_MODULE.bits() | Self::ENUM_MEMBER.bits() | Self::EXPORT_VALUE.bits();
        const TYPE = Self::CLASS.bits() | Self::INTERFACE.bits() | Self::ENUM.bits() | Self::TYPE_PARAMETER.bits()
            | Self::TYPE_ALIAS.bits() | Self::ENUM_MEMBER.bits();
        const NAMESPACE = Self::VALUE_MODULE.bits() | Self::NAMESPACE_MODULE.bits() | Self::ENUM.bits();
        const MODULE = Self::VALUE_MODULE.bits() | Self::NAMESPACE_MODULE.bits();
        /// `SymbolFlagsModuleMember`: what is in scope in a module or a namespace for being exported from it.
        const MODULE_MEMBER = Self::VARIABLE.bits() | Self::FUNCTION.bits() | Self::CLASS.bits() | Self::INTERFACE.bits()
            | Self::ENUM.bits() | Self::MODULE.bits() | Self::TYPE_ALIAS.bits() | Self::ALIAS.bits();
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Decl {
    /// An identifier bound by `var`, `let`, `const`, `using`, `catch`, or a loop.
    Var(PatId),
    /// An identifier bound by a parameter.
    Param(PatId),
    Fn(FnId),
    Class(ClassId),
    Interface(InterfaceId),
    Alias(AliasId),
    Enum(EnumId),
    EnumMember(EnumMemberId),
    Module(ModuleId),
    TypeParam(TypeParamId),
    ImportDefault(ImportId),
    ImportNamespace(ImportId),
    ImportSpec(ImportSpecId),
    ImportEquals(ImportEqualsId),
    ExportSpec(ExportSpecId),
    /// `export * as ns from`
    ExportStarAs(StmtId),
    /// `export default e`, `export = e`
    ExportExpr(StmtId),
    /// `export as namespace N`: the module itself, under a global name.
    UmdGlobal(StmtId),
    /// The file itself, as a module.
    File,
    /// `const a = require("m")`, `const { a } = require("m")` in JavaScript: the name.
    Require(PatId),
    /// `module.exports = e` in JavaScript: the assignment.
    ModuleExports(ExprId),
    /// `exports.a = e`, `module.exports.a = e` in JavaScript: the assignment. `Object.defineProperty(exports, "a", descriptor)`: the call.
    ExportsProperty(ExprId),
    /// `module` and `exports` in a CommonJS module.
    CommonJsVariable,
}

/// `JSDeclarationKind`, without `JSDeclarationKindProperty`: what an assignment or a call declares in a JavaScript file.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum JsDeclarationKind {
    None,
    /// `module.exports = e`, but for `module.exports = exports`
    ModuleExports,
    /// `exports.name = e`, `module.exports.name = e`. The name is `NONE` for a numeric key, which takes an interner to spell.
    ExportsProperty(Atom),
    /// `this.name = e`
    ThisProperty,
    /// `Object.defineProperty(a, "name", descriptor)`
    ObjectDefinePropertyValue,
    /// `Object.defineProperty(exports, "name", descriptor)`, `Object.defineProperty(module.exports, "name", descriptor)`
    ObjectDefinePropertyExports,
}

/// Whether `e` is written in parentheses. The HIR has no node for them.
fn is_in_parens(hir: &File, e: ExprId) -> bool {
    hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok()
}

/// Whether the name at `pos` is a `#name`.
fn is_private_name_at(hir: &File, pos: u32) -> bool {
    hir.text.get(pos as usize) == Some(&b'#')
}

/// `IsStringOrNumericLiteralLike`. `("a")` is not one.
fn is_string_or_numeric_literal_like(hir: &File, e: ExprId) -> bool {
    !is_in_parens(hir, e)
        && match hir[e].kind {
            ExprKind::String(_) | ExprKind::Number(_) => true,
            ExprKind::Template { exprs, .. } => exprs.is_empty(),
            _ => false,
        }
}

/// The text of a string literal or of a template without substitutions, in parentheses or not. `NONE` for anything else,
/// including a numeric literal, which takes an interner to spell.
fn string_literal_text(hir: &File, e: ExprId) -> Atom {
    match hir[e].kind {
        ExprKind::String(text) => text,
        ExprKind::Template { exprs, texts } if exprs.is_empty() => {
            hir.ids(texts).next().unwrap_or(Atom::NONE)
        }
        _ => Atom::NONE,
    }
}

/// `IsExportsIdentifier`
fn is_exports_identifier(hir: &File, e: ExprId) -> bool {
    matches!(hir[e].kind, ExprKind::Ident(known::exports)) && !is_in_parens(hir, e)
}

/// `IsModuleExportsAccessExpression`
pub fn is_module_exports(hir: &File, e: ExprId) -> bool {
    let (obj, name) = match hir[e].kind {
        ExprKind::Dot { obj, name, .. } => (obj, name),
        ExprKind::Index { obj, index, .. } => (obj, string_literal_text(hir, index)),
        _ => return false,
    };
    name == known::exports
        && matches!(hir[obj].kind, ExprKind::Ident(known::module))
        && !is_in_parens(hir, obj)
        && !is_in_parens(hir, e)
}

/// `GetAssignmentDeclarationKind`, for the kinds that only JavaScript has.
pub fn assignment_declaration_kind(hir: &File, e: ExprId) -> JsDeclarationKind {
    if !hir.is_js {
        return JsDeclarationKind::None;
    }
    let (target, value) = match hir[e].kind {
        ExprKind::Assign {
            op: None,
            target,
            value,
        } if !is_in_parens(hir, target) => (target, value),
        ExprKind::Call(_) => {
            return match define_property_call(hir, e) {
                Some((object, _))
                    if is_exports_identifier(hir, object) || is_module_exports(hir, object) =>
                {
                    JsDeclarationKind::ObjectDefinePropertyExports
                }
                Some(_) => JsDeclarationKind::ObjectDefinePropertyValue,
                None => JsDeclarationKind::None,
            };
        }
        _ => return JsDeclarationKind::None,
    };
    if is_module_exports(hir, target) && !is_exports_identifier(hir, value) {
        return JsDeclarationKind::ModuleExports;
    }
    // `GetElementOrPropertyAccessName`
    let (obj, name) = match hir[target].kind {
        ExprKind::Dot {
            obj,
            name,
            name_pos,
            ..
        } => (obj, (!is_private_name_at(hir, name_pos)).then_some(name)),
        ExprKind::Index { obj, index, .. } => match hir[index].kind {
            ExprKind::Number(_) => (obj, Some(Atom::NONE)),
            _ => (
                obj,
                Some(string_literal_text(hir, index)).filter(|text| text.is_some()),
            ),
        },
        _ => return JsDeclarationKind::None,
    };
    if let Some(name) = name
        && (is_module_exports(hir, obj) || is_exports_identifier(hir, obj))
    {
        return JsDeclarationKind::ExportsProperty(name);
    }
    if matches!(hir[obj].kind, ExprKind::This) && !is_in_parens(hir, obj) {
        JsDeclarationKind::ThisProperty
    } else {
        JsDeclarationKind::None
    }
}

/// `IsBindableStaticNameExpression` with `excludeThisKeyword`: `a`, `a.b`, `a["b"]`, `a[0]`.
fn is_bindable_static_name(hir: &File, e: ExprId) -> bool {
    !is_in_parens(hir, e)
        && match hir[e].kind {
            ExprKind::Ident(_) => true,
            ExprKind::Dot { obj, name_pos, .. } => {
                !is_private_name_at(hir, name_pos) && is_bindable_static_name(hir, obj)
            }
            ExprKind::Index { obj, index, .. } => {
                is_string_or_numeric_literal_like(hir, index) && is_bindable_static_name(hir, obj)
            }
            _ => false,
        }
}

/// `IsBindableObjectDefinePropertyCall`: the object and the key of `Object.defineProperty(object, key, descriptor)`. The key is a
/// string, a template without substitutions or a number. An optional chain makes no difference.
pub fn define_property_call(hir: &File, e: ExprId) -> Option<(ExprId, ExprId)> {
    let ExprKind::Call(c) = hir[e].kind else {
        return None;
    };
    let call = &hir[c];
    if call.args.len() != 3 || is_in_parens(hir, call.callee) {
        return None;
    }
    let ExprKind::Dot {
        obj,
        name: known::defineProperty,
        ..
    } = hir[call.callee].kind
    else {
        return None;
    };
    let (object, key) = (hir.id_at(call.args, 0), hir.id_at(call.args, 1));
    (matches!(hir[obj].kind, ExprKind::Ident(known::Object))
        && !is_in_parens(hir, obj)
        && is_string_or_numeric_literal_like(hir, key)
        && is_bindable_static_name(hir, object))
    .then_some((object, key))
}

/// `IsRequireCall`: what is required, if `e` is `require(x)`.
pub fn require_argument(hir: &File, e: ExprId) -> Option<ExprId> {
    let ExprKind::Call(c) = hir[e].kind else {
        return None;
    };
    let call = &hir[c];
    (matches!(hir[call.callee].kind, ExprKind::Ident(known::require)) && call.args.len() == 1)
        .then(|| hir.id_at(call.args, 0))
}

/// The same, of a name that is written out.
pub fn required_specifier(hir: &File, e: ExprId) -> Option<Atom> {
    match hir[require_argument(hir, e)?].kind {
        ExprKind::String(spec) => Some(spec),
        _ => None,
    }
}

pub struct Symbol {
    pub name: Atom,
    pub flags: SymFlags,
    /// In the order they are bound. Those that what has the name refuses (`declareSymbolEx`) are listed too, for what is said of
    /// duplicates: they add nothing to `flags`, and each is the one declaration of a symbol of its own that is in no table.
    pub decls: Vec<Decl>,
    /// The module, namespace or enum it is a member of.
    pub parent: SymbolId,
    /// What a module, namespace or enum exports.
    pub exports: TableId,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ScopeKind {
    File,
    Module(ModuleId),
    Fn(FnId),
    Block,
    Class(ClassId),
    Interface(InterfaceId),
    /// Type parameters of an alias, a mapped type, or the `infer`s of a conditional type.
    TypeParams,
    Enum(EnumId),
    /// Where the constraints and defaults of the type parameters of a function are written. It declares nothing: it lies in the
    /// scope of the function and says which part of the function a name is written in. `Bound::is_seen_from`
    TypeParamList(FnId),
    /// The same for the parameters: their types, patterns and defaults. Only a function with a block for a body has one.
    Param(FnId),
    /// The same for the return type.
    ReturnType(FnId),
    /// Where the `extends` type of a conditional type is written. It declares nothing: the `infer`s are declared in the scope right
    /// above, which the true branch is in too, and cannot be named from here. `Bound::is_seen_from`
    Extends,
    /// Where what an `infer T extends ..` extends is written. It holds `T` once more, which can be named from here.
    InferConstraint,
}

pub struct Scope {
    pub parent: ScopeId,
    pub kind: ScopeKind,
    pub locals: TableId,
    /// For a module, namespace or enum: its symbol, whose exports are in scope wherever they were declared.
    pub symbol: SymbolId,
}

/// What an expression or a statement is directly part of.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Parent {
    None,
    Expr(ExprId),
    Stmt(StmtId),
    VarInit(VarDeclId),
    ParamDefault(ParamId),
    PatPropDefault(PatPropId),
    PatElemDefault(PatElemId),
    /// The value of a property of an object literal or of a JSX attribute.
    Prop(PropId),
    /// A computed name: of a property of the object literal, or in a pattern if there is none.
    Key(ExprId),
    /// The computed name of a method, an accessor or a member of a class: as far as the flow of control goes, it is inside.
    MemberKey,
    /// The initializer of a member. Also the operand of a `typeof` in the type or the initializer of a property of a class, if
    /// there is no function in between.
    MemberInit(MemberId),
    /// The expression body of an arrow function, or a statement of a body.
    FnBody(FnId),
    EnumInit(EnumMemberId),
    Case(CaseId),
    ClassExtends(ClassId),
    /// A decorator, of the class or of a member of it or a parameter of one: worked out where the class is.
    Decorator(ClassId, DecoratorOwner),
    Module(ModuleId),
    File,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FnOwner {
    None,
    Expr(ExprId),
    Stmt(StmtId),
    Member(MemberId),
    Type(TypeNodeId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MemberOwner {
    None,
    Class(ClassId),
    Interface(InterfaceId),
    TypeLiteral(TypeNodeId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PatParent {
    None,
    Var(VarDeclId),
    Param(ParamId),
    Prop(PatId, PatPropId),
    Elem(PatId, PatElemId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ClassOwner {
    Expr(ExprId),
    Stmt(StmtId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FlowTarget {
    /// The declaration initializes what its pattern binds.
    Var(VarDeclId),
    /// A binding element gets its value.
    Pat(PatId),
    /// The target of an assignment, `++`, `--`, or a `for`-`in`/`of` without a declaration.
    Expr(ExprId),
}

#[derive(Copy, Clone, Debug)]
pub enum Flow {
    Unreachable,
    /// The top of a function, of a property with an initializer, of the body of a namespace or of the file. That of a method, an
    /// accessor or a property is before its name, if that is computed. `outer` is where the function expression, the arrow
    /// function, or the method or accessor of an object literal or a class expression is evaluated.
    /// `arrow`: it is an arrow function, which has no `this` of its own.
    Start {
        outer: FlowId,
        arrow: bool,
    },
    /// Where an `async` function or a generator that is called where it is written starts: what is known of names outside holds,
    /// as `getControlFlowContainer` has it. `plain` is never set: a function called where it is written that is neither, like a
    /// static block, starts nothing. The flow of control around goes on through it (`bindContainer`).
    StartInvoked {
        outer: FlowId,
        plain: bool,
        arrow: bool,
    },
    /// Where several paths meet. A run of `Bound::flow_edges`.
    Label {
        start: u32,
        len: u32,
    },
    Loop {
        start: u32,
        len: u32,
    },
    Assign {
        before: FlowId,
        target: FlowTarget,
    },
    Cond {
        before: FlowId,
        expr: ExprId,
        sense: bool,
    },
    /// The clauses `from..to` of the `switch` were entered.
    Switch {
        before: FlowId,
        stmt: StmtId,
        from: u16,
        to: u16,
    },
    /// A call that may assert something or never return.
    Call {
        before: FlowId,
        call: ExprId,
    },
    /// Past a `finally` block. Going back through the block from here, only some of the ways into it count: those that
    /// lead to `instead`, not all that lead to `label`, which is where the block starts.
    Reduce {
        before: FlowId,
        label: FlowId,
        instead: FlowId,
    },
    /// `a.push(x)`, `a[i] = x` on an array that is still finding out what it holds.
    ArrayMutation {
        before: FlowId,
        expr: ExprId,
    },
}

#[derive(Copy, Clone, Debug)]
pub struct FnInfo {
    pub owner: FnOwner,
    pub scope: ScopeId,
    /// The function-like this one is written in.
    pub enclosing: FnId,
    /// The `return` statements, `Bound::ids`.
    pub returns: IdList<StmtId>,
    /// What `forEachYieldExpression` finds: those in the static blocks of classes in it too, of which a static block has none itself.
    pub yields: IdList<ExprId>,
    /// `Unreachable` if control cannot fall off the end.
    pub end: FlowId,
    /// Of a constructor, a static block or a function the flow of control around goes on through: where it is left, whether by a
    /// `return` or by getting to the end. `ReturnFlowNode`
    pub exit: FlowId,
    /// `NodeFlagsContainsThis`: a `this`, expression or type, is written in it, be it inside arrow functions, function types or signatures.
    pub contains_this: bool,
}

/// Where an `infer T` is written, as far as `getInferredTypeParameterConstraint` makes something of it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum InferPosition {
    /// `Ref<.., infer T, ..>`: in which reference, and as which argument.
    TypeArgument(TypeNodeId, u32),
    /// `[...infer T]`, `(...args: infer T) => void`
    Rest,
    /// `` `${infer T}` ``
    Template,
    /// `{ [K in infer T]: .. }`
    MappedKey,
    /// `{ [K in X]: E } extends { [_ in Y]: infer T } ? ..`: the mapped type that is checked.
    MappedTemplate(MappedId),
}

/// Side tables of a [`File`], index for index.
#[derive(Default)]
pub struct Bound {
    pub symbols: Vec<Symbol>,
    pub scopes: Vec<Scope>,
    /// Each table is a run of `entries`, sorted by name.
    pub tables: Vec<(u32, u32)>,
    pub entries: Vec<(Atom, SymbolId)>,
    pub ids: Vec<u32>,

    /// The file as a module. Its exports are what other files can import.
    pub file_symbol: SymbolId,
    /// `export * from spec`, by the module or namespace symbol that says so.
    pub export_stars: Vec<(SymbolId, Atom)>,
    /// Which of `export_stars` are `export type *`, index for index.
    pub export_star_type_only: Vec<bool>,
    /// `declare module "name"` at the top of a file, or right in an ambient module at the top of a script.
    pub ambient_modules: Vec<(Atom, SymbolId)>,
    /// `declare global { }` at the top of a module, or right in an ambient module at the top of a script: symbols whose exports are
    /// global.
    pub global_augmentations: Vec<SymbolId>,
    /// `local.ExportSymbol` of `declareModuleMember`: the exported values that what is exported under their names refuses. In the block
    /// it is written in each is what its name means as a value all the same: it is among the locals there, without being local.
    pub refused_exports: Vec<SymbolId>,
    /// `export as namespace N`
    pub umd_globals: Vec<(Atom, SymbolId)>,
    /// The module specifiers in the file that are looked for, in the order they are first mentioned. `collectModuleReferences`
    pub specifiers: Vec<Atom>,
    /// Those of the import and export statements directly in the ambient modules a script declares, and the names of the modules
    /// added to there: looked for unless relative.
    pub ambient_specifiers: Vec<Atom>,
    /// `this.name = value` and `this["name"] = value` in the members of a class, in JavaScript, where it declares the property: the
    /// class, whether it is the static side, the name, the assignment. Sorted.
    pub this_properties: Vec<(ClassId, bool, Atom, ExprId)>,
    /// `CommonJSModuleIndicator`: what shows that the file is a CommonJS module.
    pub commonjs_indicator: Option<ExprId>,

    /// What an identifier means as a value. `NONE`: nothing in this file declares it.
    pub expr_symbol: Vec<SymbolId>,
    pub expr_parent: Vec<Parent>,
    /// Where control is at a name, a `this`, a `super`, and an `a.b` or `a[b]` that can be narrowed (`isNarrowableReference`).
    /// `UNREACHABLE` for everything else.
    pub expr_flow: Vec<FlowId>,
    pub stmt_parent: Vec<Parent>,
    /// The scope a type is written in.
    pub type_scope: Vec<ScopeId>,
    /// `isResolvedByTypeAlias`: between the type node and a type alias there is only what resolves its parts at once.
    pub type_by_alias: Vec<bool>,
    /// The `this` types written inside a type literal, where there is no such thing. `getThisType`
    pub this_in_type_literal: FxHashSet<TypeNodeId>,
    pub pat_parent: Vec<PatParent>,
    pub pat_symbol: Vec<SymbolId>,
    pub prop_owner: Vec<ExprId>,
    pub member_owner: Vec<MemberOwner>,
    pub param_fn: Vec<FnId>,
    pub type_param_symbol: Vec<SymbolId>,
    /// The scope a type parameter is declared in: that of its class, interface, function, alias..
    pub type_param_scope: Vec<ScopeId>,
    pub fns: Vec<FnInfo>,
    /// `requiresScopeChange` of some parameter, by function: its parameters see the variables of its body.
    pub requires_scope_change: Vec<bool>,
    pub fn_symbol: Vec<SymbolId>,
    pub class_symbol: Vec<SymbolId>,
    pub class_owner: Vec<ClassOwner>,
    pub class_scope: Vec<ScopeId>,
    pub interface_symbol: Vec<SymbolId>,
    pub alias_symbol: Vec<SymbolId>,
    pub alias_scope: Vec<ScopeId>,
    pub enum_symbol: Vec<SymbolId>,
    pub enum_member_symbol: Vec<SymbolId>,
    pub enum_member_owner: Vec<EnumId>,
    pub module_symbol: Vec<SymbolId>,
    /// `getModuleInstanceState(..) != NonInstantiated`, by `ModuleId`.
    pub module_instantiated: Vec<bool>,
    pub var_stmt: Vec<StmtId>,
    /// The identifiers that are assigned to, by the variable they name.
    pub assignments: Vec<(SymbolId, ExprId)>,
    /// The expressions that are (part of) the operand of a `typeof` in a type. Sorted.
    pub type_query_operands: Vec<ExprId>,
    /// Where each `infer T` that is written somewhere that says something about `T` is written. In order of the parameters.
    pub infer_positions: Vec<(TypeParamId, InferPosition)>,
    /// `f.name = value` and `f["name"] = value` next to `function f() {}`: properties of `f`, which may be written `a.f`. By the
    /// symbol of the function, then by name. The last field is the declaration: the assignment or, in JavaScript, the call
    /// `Object.defineProperty(f, "name", descriptor)`.
    pub declared_fn_expandos: Vec<(SymbolId, Atom, ExprId)>,
    /// The same next to `const f = function () {}` or `const f = () => {}`, by the function.
    pub fn_expr_expandos: Vec<(FnId, Atom, ExprId)>,
    /// `f[0] = value`, `f[key] = value`: the same under a numeric or late-bound key, which the checker names.
    /// (function, key, declaration), by function, then by declaration.
    pub declared_fn_keyed_expandos: Vec<(SymbolId, ExprId, ExprId)>,
    pub fn_expr_keyed_expandos: Vec<(FnId, ExprId, ExprId)>,
    /// `o.name = value`, `o["name"] = value`: properties of the empty object literal that initializes `o`, in JavaScript. By the
    /// literal, then by name.
    pub object_expandos: Vec<(ExprId, Atom, ExprId)>,
    /// `o[0] = value`: a property of such a literal under a numeric key, which the checker names. A late-bound key declares
    /// nothing there. (literal, key, declaration), by literal, then by declaration.
    pub object_keyed_expandos: Vec<(ExprId, ExprId, ExprId)>,
    /// The assignments and calls that `bindDeferredExpandoAssignment` gives a symbol. Sorted.
    pub expando_declarations: Vec<ExprId>,
    pub case_stmt: Vec<StmtId>,
    /// Where control is when each statement is reached.
    pub stmt_flow: Vec<FlowId>,
    /// Where control is at the end of a `case` that another follows, if it gets there. `NONE` otherwise.
    pub case_fallthrough: Vec<FlowId>,
    /// Each `var` written in a block, which is not where it ends up, and the scope it is written in.
    pub hoisted_vars: Vec<(PatId, ScopeId)>,
    /// The decorators of what cannot be decorated: nothing more is said of what is in them.
    pub refused_decorators: Vec<ExprId>,
    /// The labeled statements no `break` or `continue` names.
    pub unused_labels: Vec<StmtId>,
    pub import_equals_scope: Vec<ScopeId>,
    pub export_scope: Vec<ScopeId>,
    /// The scope an expression that opens none is in, for the few that need it.
    pub expr_scope: FxHashMap<ExprId, ScopeId>,
    /// `a.#x`, and the `#x` of `#x in a` (its left operand): the innermost class around that declares an `#x`.
    /// `lookupSymbolForPrivateIdentifierDeclaration`. No entry: no class around does.
    pub private_class: FxHashMap<ExprId, ClassId>,
    /// The identifiers that mean nothing declared in the file, and the scope each is written in: globals, what another file adds to
    /// a namespace or an enum around, or mistakes. Sorted by expression.
    pub free_idents: Vec<(ExprId, ScopeId)>,
    /// The identifiers that mean an import or another alias and nothing else, and the scope each is written in: whether that is
    /// a value only the program can tell. Sorted by expression.
    pub alias_idents: Vec<(ExprId, ScopeId)>,
    /// The identifiers `arguments` that mean the arguments of a function around them. Sorted.
    pub arguments_objects: Vec<ExprId>,
    /// `checkUnmatchedJSDocParameters`: the `@param` tags that match no parameter, as start and code.
    pub jsdoc_param_errors: Vec<(u32, u32)>,

    pub flow: Vec<Flow>,
    pub flow_edges: Vec<FlowId>,
}

pub const UNREACHABLE: FlowId = FlowId(0);

impl Bound {
    /// `IsInTypeQuery`: it is asked what `e` is, but `e` is not read.
    pub fn is_in_type_query(&self, e: ExprId) -> bool {
        self.type_query_operands.binary_search(&e).is_ok()
    }

    /// Whether `e` is `arguments`, meaning the arguments object.
    pub fn is_arguments_object(&self, e: ExprId) -> bool {
        self.arguments_objects.binary_search(&e).is_ok()
    }

    /// `IsVariableDeclarationInitializedToRequire`, of the name `pat`: the module, and which of its exports if it is not all of it.
    pub fn required_by(&self, hir: &File, pat: PatId) -> Option<(Atom, Option<Atom>)> {
        let (d, part) = match self.pat_parent[pat.idx()] {
            PatParent::Var(d) => (d, None),
            PatParent::Prop(outer, p) => match (self.pat_parent[outer.idx()], hir[p].key) {
                (PatParent::Var(d), PropKey::Name(name)) => (d, Some(name)),
                _ => return None,
            },
            _ => return None,
        };
        let init = hir[d].init;
        if !hir.is_js || init.is_none() {
            return None;
        }
        Some((required_specifier(hir, init)?, part))
    }

    /// Whether the binder took `e` for the declaration of a property of a function, a class or an object literal
    /// (`node.Symbol != nil`). That includes a key that names no property, as in `f[a + b] = value`.
    pub fn is_expando_declaration(&self, e: ExprId) -> bool {
        self.expando_declarations.binary_search(&e).is_ok()
    }

    /// Those of one side of `class`.
    pub fn this_properties_of(
        &self,
        class: ClassId,
        is_static: bool,
    ) -> &[(ClassId, bool, Atom, ExprId)] {
        let start = self
            .this_properties
            .partition_point(|x| (x.0, x.1) < (class, is_static));
        let end = self
            .this_properties
            .partition_point(|x| (x.0, x.1) <= (class, is_static));
        &self.this_properties[start..end]
    }

    /// The entries of `list`, which is sorted by owner, that belong to the owner `key`.
    pub fn expandos_of<K: Copy + Ord, N>(list: &[(K, N, ExprId)], key: K) -> &[(K, N, ExprId)] {
        let start = list.partition_point(|e| e.0 < key);
        let end = list.partition_point(|e| e.0 <= key);
        &list[start..end]
    }

    pub fn lookup(&self, table: TableId, name: Atom) -> Option<SymbolId> {
        if table.is_none() {
            return None;
        }
        let (start, len) = self.tables[table.idx()];
        let entries = &self.entries[start as usize..(start + len) as usize];
        if entries.len() <= 8 {
            return entries.iter().find(|e| e.0 == name).map(|e| e.1);
        }
        entries
            .binary_search_by_key(&name, |e| e.0)
            .ok()
            .map(|i| entries[i].1)
    }

    pub fn table(&self, table: TableId) -> &[(Atom, SymbolId)] {
        if table.is_none() {
            return &[];
        }
        let (start, len) = self.tables[table.idx()];
        &self.entries[start as usize..(start + len) as usize]
    }

    #[inline]
    pub fn ids<T: From<u32>>(
        &self,
        list: IdList<T>,
    ) -> impl ExactSizeIterator<Item = T> + Clone + '_ {
        self.ids[list.range()].iter().map(|&i| T::from(i))
    }

    pub fn edges(&self, start: u32, len: u32) -> &[FlowId] {
        &self.flow_edges[start as usize..(start + len) as usize]
    }

    /// `NameResolver.Resolve`, the restrictions on the locals of a function and of a conditional type: whether one with `flags` is
    /// seen by a search for `meaning` that has just left a scope of kind `from`.
    pub fn is_seen_from(&self, from: ScopeKind, flags: SymFlags, meaning: SymFlags) -> bool {
        let f = match from {
            ScopeKind::TypeParamList(f) | ScopeKind::Param(f) | ScopeKind::ReturnType(f) => f,
            // The `infer`s of a conditional type are seen from its true branch alone.
            ScopeKind::Extends => return false,
            _ => return true,
        };
        let mut seen = true;
        // Of the types only the type parameters are seen outside of the body.
        if (meaning & flags).intersects(SymFlags::TYPE) {
            seen = flags.contains(SymFlags::TYPE_PARAMETER);
        }
        if (meaning & flags).intersects(SymFlags::VARIABLE) {
            // A parameter that a `var` declares again is a parameter first.
            let in_body = !flags.contains(SymFlags::PARAMETER);
            // `useOuterVariableScopeInParameter`
            if matches!(from, ScopeKind::Param(_))
                && in_body
                && !self.requires_scope_change[f.idx()]
            {
                seen = false;
            } else if flags.contains(SymFlags::FUNCTION_SCOPED_VARIABLE) {
                seen = match from {
                    ScopeKind::Param(_) => true,
                    ScopeKind::ReturnType(_) => !in_body,
                    _ => false,
                };
            }
        }
        seen
    }

    /// What `name` means in `scope`, going outwards, as far as this file knows.
    pub fn resolve(&self, mut scope: ScopeId, name: Atom, meaning: SymFlags) -> Option<SymbolId> {
        // `lastLocation`: the kind of the scope the search has just left.
        let mut from = ScopeKind::Block;
        while scope.is_some() {
            let s = &self.scopes[scope.idx()];
            if let Some(symbol) = self.lookup(s.locals, name)
                && self.symbols[symbol.idx()]
                    .flags
                    .intersects(meaning | SymFlags::ALIAS)
                && self.is_seen_from(from, self.symbols[symbol.idx()].flags, meaning)
            {
                return Some(symbol);
            }
            // `Resolve`: nothing goes by the name `default` where it is exported. Of an enum and a namespace that are one symbol, the
            // enum sees the members only and the namespace all but the members.
            if s.symbol.is_some()
                && name != crate::atom::known::default
                && let Some(symbol) = self.lookup(self.symbols[s.symbol.idx()].exports, name)
                && !self.symbols[symbol.idx()]
                    .flags
                    .contains(SymFlags::EXPORT_ONLY)
                && self.symbols[symbol.idx()].flags.intersects(match s.kind {
                    ScopeKind::Enum(_) => meaning & SymFlags::ENUM_MEMBER,
                    _ => (meaning | SymFlags::ALIAS) & SymFlags::MODULE_MEMBER,
                })
            {
                return Some(symbol);
            }
            from = s.kind;
            scope = s.parent;
        }
        None
    }

    pub fn heap_size(&self) -> usize {
        self.symbols.capacity() * std::mem::size_of::<Symbol>()
            + self.entries.capacity() * 8
            + self.expr_symbol.capacity() * 4
            + self.expr_parent.capacity() * 8
            + self.expr_flow.capacity() * 4
            + self.stmt_parent.capacity() * 8
            + self.type_scope.capacity() * 4
            + self.flow.capacity() * std::mem::size_of::<Flow>()
            + self.flow_edges.capacity() * 4
            + self.pat_parent.capacity() * 12
    }
}

/// What `requiresScopeChangeWorker` asks of the compiler options.
#[derive(Copy, Clone, Default)]
pub struct BindOptions {
    /// `GetEmitStandardClassFields`
    pub emit_standard_class_fields: bool,
    /// `GetEmitScriptTarget` is older than that.
    pub before_es2020: bool,
    pub before_es2017: bool,
}

pub fn bind(file: &File, options: BindOptions) -> Bound {
    binder::Binder::run(file, options, None)
}

/// The same, with the interner that spells the numeric names of CommonJS exports: `exports[0] = e`.
pub fn bind_with_atoms(file: &File, options: BindOptions, atoms: &Interner) -> Bound {
    binder::Binder::run(file, options, Some(atoms))
}

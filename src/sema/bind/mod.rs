//! Everything that can be computed for a file in isolation: the declaration each name resolves to,
//! which node contains which, and the control flow. Runs right after the parser, on the same
//! thread.

mod binder;

use crate::atom::{Atom, Interner, known};
use crate::hir::*;
use crate::session::{Arena, ArenaHashMap, ArenaHashSet, ArenaVec};
use crate::util::{FxBuild, FxHashMap, FxHashSet};
use smallvec::SmallVec;

define_id!(SymbolId, ScopeId, TableId, FlowId);

bitflags::bitflags! {
    /// `ast.SymbolFlags`
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub struct SymFlags: u32 {
        const FUNCTION_SCOPED_VARIABLE = 1 << 0;
        const BLOCK_SCOPED_VARIABLE = 1 << 1;
        const FUNCTION = 1 << 2;
        const CLASS = 1 << 3;
        const INTERFACE = 1 << 4;
        const REGULAR_ENUM = 1 << 5;
        const VALUE_MODULE = 1 << 6;
        const NAMESPACE_MODULE = 1 << 7;
        const TYPE_PARAMETER = 1 << 8;
        const TYPE_ALIAS = 1 << 9;
        const ALIAS = 1 << 10;
        const ENUM_MEMBER = 1 << 11;
        /// `SymbolFlagsProperty`, of `bindExportAssignment`: `export default <expression>`, `export = <expression>`.
        const PROPERTY = 1 << 12;
        /// Something assigns to the variable after its declaration.
        const ASSIGNED = 1 << 13;
        const CONST = 1 << 14;
        const PARAMETER = 1 << 15;
        /// `mergedSymbols` has it, or it is transient: see `Files::canonical`.
        const MERGED = 1 << 16;
        /// A name that other files import, which nothing in the file can refer to: `export { a as b
        /// }`, `export default e`.
        const EXPORT_ONLY = 1 << 18;
        const CONST_ENUM = 1 << 19;
        /// `module` and `exports` in a CommonJS module.
        const MODULE_EXPORTS = 1 << 20;
        /// `SymbolFlagsTransient`: created by `cloneSymbol`, not by the binder.
        const TRANSIENT = 1 << 21;
        /// `SymbolFlagsExportValue`: the local symbol of an exported value (`declareModuleMember`).
        /// It is not a value itself.
        const EXPORT_VALUE = 1 << 22;
        /// `SymbolFlagsAssignment`: what `bindDeferredExpandoAssignment` declares.
        const ASSIGNMENT = 1 << 23;
        const OBJECT_LITERAL = 1 << 24;
        const TYPE_LITERAL = 1 << 17;
        const METHOD = 1 << 25;
        const CONSTRUCTOR = 1 << 26;
        const GET_ACCESSOR = 1 << 27;
        const SET_ACCESSOR = 1 << 28;
        const SIGNATURE = 1 << 29;
        const REPLACEABLE_BY_METHOD = 1 << 30;

        const ENUM = Self::REGULAR_ENUM.bits() | Self::CONST_ENUM.bits();
        const VARIABLE = Self::FUNCTION_SCOPED_VARIABLE.bits() | Self::BLOCK_SCOPED_VARIABLE.bits();
        const ACCESSOR = Self::GET_ACCESSOR.bits() | Self::SET_ACCESSOR.bits();
        const CLASS_MEMBER = Self::METHOD.bits() | Self::ACCESSOR.bits() | Self::PROPERTY.bits();
        const VALUE = Self::VARIABLE.bits() | Self::FUNCTION.bits() | Self::CLASS.bits() | Self::ENUM.bits()
            | Self::VALUE_MODULE.bits() | Self::ENUM_MEMBER.bits() | Self::PROPERTY.bits() | Self::OBJECT_LITERAL.bits()
            | Self::METHOD.bits() | Self::ACCESSOR.bits();
        const TYPE = Self::CLASS.bits() | Self::INTERFACE.bits() | Self::ENUM.bits() | Self::TYPE_PARAMETER.bits()
            | Self::TYPE_ALIAS.bits() | Self::ENUM_MEMBER.bits() | Self::TYPE_LITERAL.bits();
        const NAMESPACE = Self::VALUE_MODULE.bits() | Self::NAMESPACE_MODULE.bits() | Self::ENUM.bits();
        const MODULE = Self::VALUE_MODULE.bits() | Self::NAMESPACE_MODULE.bits();
        /// `SymbolFlagsModuleMember`: the symbols that are in scope in a module or a namespace
        /// because they are exported from it.
        const MODULE_MEMBER = Self::VARIABLE.bits() | Self::FUNCTION.bits() | Self::CLASS.bits() | Self::INTERFACE.bits()
            | Self::ENUM.bits() | Self::MODULE.bits() | Self::TYPE_ALIAS.bits() | Self::ALIAS.bits();

        const FUNCTION_SCOPED_VARIABLE_EXCLUDES = Self::VALUE.bits() & !Self::FUNCTION_SCOPED_VARIABLE.bits();
        const BLOCK_SCOPED_VARIABLE_EXCLUDES = Self::VALUE.bits();
        const PARAMETER_EXCLUDES = Self::VALUE.bits();
        const PROPERTY_EXCLUDES = Self::VALUE.bits() & !(Self::PROPERTY.bits() | Self::ACCESSOR.bits());
        const METHOD_EXCLUDES = Self::VALUE.bits() & !Self::METHOD.bits();
        const GET_ACCESSOR_EXCLUDES = Self::VALUE.bits() & !(Self::SET_ACCESSOR.bits() | Self::PROPERTY.bits());
        const SET_ACCESSOR_EXCLUDES = Self::VALUE.bits() & !(Self::GET_ACCESSOR.bits() | Self::PROPERTY.bits());
        const ACCESSOR_EXCLUDES = Self::VALUE.bits() & !Self::PROPERTY.bits();
        const ENUM_MEMBER_EXCLUDES = Self::VALUE.bits() | Self::TYPE.bits();
        const FUNCTION_EXCLUDES = Self::VALUE.bits() & !(Self::FUNCTION.bits() | Self::VALUE_MODULE.bits() | Self::CLASS.bits());
        const CLASS_EXCLUDES = (Self::VALUE.bits() | Self::TYPE.bits())
            & !(Self::VALUE_MODULE.bits() | Self::INTERFACE.bits() | Self::FUNCTION.bits());
        const INTERFACE_EXCLUDES = Self::TYPE.bits() & !(Self::INTERFACE.bits() | Self::CLASS.bits());
        const REGULAR_ENUM_EXCLUDES = (Self::VALUE.bits() | Self::TYPE.bits()) & !(Self::REGULAR_ENUM.bits() | Self::VALUE_MODULE.bits());
        const CONST_ENUM_EXCLUDES = (Self::VALUE.bits() | Self::TYPE.bits()) & !Self::CONST_ENUM.bits();
        const VALUE_MODULE_EXCLUDES = Self::VALUE.bits()
            & !(Self::FUNCTION.bits() | Self::CLASS.bits() | Self::REGULAR_ENUM.bits() | Self::VALUE_MODULE.bits());
        const TYPE_PARAMETER_EXCLUDES = Self::TYPE.bits() & !Self::TYPE_PARAMETER.bits();
        const TYPE_ALIAS_EXCLUDES = Self::TYPE.bits();
        const ALIAS_EXCLUDES = Self::ALIAS.bits();
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
    /// `f.a = e`, `f["a"] = e`, `f[key] = e`, where `getInitializerSymbol` finds a symbol for `f`,
    /// which may be of the form `a.f`: the assignment. In JavaScript `Object.defineProperty(f, "a",
    /// descriptor)` too: the call.
    Expando(ExprId),
    /// `{}`, for the symbol that such assignments add to in JavaScript.
    ObjectLiteral(ExprId),
    /// `module` and `exports` in a CommonJS module.
    CommonJsVariable,
    /// A member of a class, an interface or a type literal.
    Member(MemberId),
    /// `IsParameterPropertyDeclaration`: the property.
    ParameterProperty(ParamId),
    /// `this.name = value` in a member of a class, in JavaScript: the assignment.
    ThisProperty(ExprId),
    /// A member of an object literal or an attribute of a JSX element.
    Property(PropId),
    TypeLiteral(TypeNodeId),
}

impl Decl {
    /// `node.Members()` of a class or an interface. `None`: it is neither.
    #[inline]
    pub fn members_of_class_or_interface(self, hir: &File) -> Option<Span<MemberId>> {
        match self {
            Decl::Class(c) => Some(hir[c].members),
            Decl::Interface(i) => Some(hir[i].members),
            _ => None,
        }
    }

    /// `node.TypeParameters()` of a class or an interface. `None`: it is neither.
    #[inline]
    pub fn type_params_of_class_or_interface(self, hir: &File) -> Option<Span<TypeParamId>> {
        match self {
            Decl::Class(c) => Some(hir[c].type_params),
            Decl::Interface(i) => Some(hir[i].type_params),
            _ => None,
        }
    }

    /// The position of the name of a class or an interface. `None`: it is neither.
    #[inline]
    pub fn name_pos_of_class_or_interface(self, hir: &File) -> Option<u32> {
        match self {
            Decl::Class(c) => Some(hir[c].name_pos),
            Decl::Interface(i) => Some(hir[i].name_pos),
            _ => None,
        }
    }
}

/// `JSDeclarationKind`, without `JSDeclarationKindProperty`: what an assignment or a call declares in a JavaScript file.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum JsDeclarationKind {
    None,
    /// `module.exports = e`, but for `module.exports = exports`
    ModuleExports,
    /// `exports.name = e`, `module.exports.name = e`. The name is `NONE` for a numeric key, whose
    /// text requires an interner.
    ExportsProperty(Atom),
    /// `this.name = e`
    ThisProperty,
    /// `Object.defineProperty(a, "name", descriptor)`
    ObjectDefinePropertyValue,
    /// `Object.defineProperty(exports, "name", descriptor)`, `Object.defineProperty(module.exports, "name", descriptor)`
    ObjectDefinePropertyExports,
}

/// The text of a string literal or of a template without substitutions, parenthesized or not.
/// `NONE` for anything else, including a numeric literal, whose text requires an interner.
fn string_literal_text(hir: &File, e: ExprId) -> Atom {
    match hir[e].kind {
        ExprKind::String(text) => text,
        ExprKind::Template { exprs } if exprs.is_empty() => hir.id_at(hir.template_texts(exprs), 0),
        _ => Atom::NONE,
    }
}

/// `IsExportsIdentifier`
fn is_exports_identifier(hir: &File, e: ExprId) -> bool {
    matches!(hir[e].kind, ExprKind::Ident(known::exports)) && !is_parenthesized(hir, e)
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
        && !is_parenthesized(hir, obj)
        && !is_parenthesized(hir, e)
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
        } if !is_parenthesized(hir, target) => (target, value),
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
    if matches!(hir[obj].kind, ExprKind::This) && !is_parenthesized(hir, obj) {
        JsDeclarationKind::ThisProperty
    } else {
        JsDeclarationKind::None
    }
}

/// `IsBindableStaticNameExpression` with `excludeThisKeyword`: `a`, `a.b`, `a["b"]`, `a[0]`.
fn is_bindable_static_name(hir: &File, e: ExprId) -> bool {
    !is_parenthesized(hir, e)
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
    if call.args.len() != 3 || is_parenthesized(hir, call.callee) {
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
        && !is_parenthesized(hir, obj)
        && is_string_or_numeric_literal_like(hir, key)
        && is_bindable_static_name(hir, object))
    .then_some((object, key))
}

/// `IsRequireCall`: the argument, if `e` is `require(x)`.
pub fn require_argument(hir: &File, e: ExprId) -> Option<ExprId> {
    let ExprKind::Call(c) = hir[e].kind else {
        return None;
    };
    let call = &hir[c];
    (matches!(hir[call.callee].kind, ExprKind::Ident(known::require))
        && !is_parenthesized(hir, call.callee)
        && call.args.len() == 1)
        .then(|| hir.id_at(call.args, 0))
}

/// The same with `requireStringLiteralLikeArgument`: the argument of `require("m")`, and its text.
pub fn require_call_argument(hir: &File, e: ExprId) -> Option<(ExprId, Atom)> {
    let argument = require_argument(hir, e)?;
    is_string_literal_like(hir, argument).then(|| (argument, string_literal_text(hir, argument)))
}

/// The text alone.
pub fn required_specifier(hir: &File, e: ExprId) -> Option<Atom> {
    Some(require_call_argument(hir, e)?.1)
}

pub struct SymbolIn<S: Storage> {
    pub name: Atom,
    pub flags: SymFlags,
    /// `Declarations`, in the order they are bound.
    pub decls: DeclsIn<S>,
    /// `ValueDeclaration`: an index into `Declarations`, which for a symbol merged by `mergeSymbol`
    /// are the declarations of all its parts. `u32::MAX`: none.
    pub value_declaration: u32,
    /// `Parent`, as `declareSymbolEx` sets it: the module, namespace or enum among whose exports it
    /// is declared, even if the declaration conflicts there.
    /// `NONE` for a local.
    pub parent: SymbolId,
    /// The exports of a module, namespace or enum, and the static side of a class.
    pub exports: TableId,
    pub members: TableId,
    /// `ExportSymbol`, for the local symbol of an export of a module or a namespace.
    pub export_symbol: SymbolId,
}

/// A symbol of a file that has been loaded.
pub type Symbol<'s> = SymbolIn<InArena<'s>>;

const _: () = assert!(size_of::<Symbol<'static>>() <= 48);

impl SymbolIn<Growable> {
    fn into_arena(self, arena: &Arena) -> Symbol<'_> {
        SymbolIn {
            name: self.name,
            flags: self.flags,
            decls: self.decls.into_arena(arena),
            value_declaration: self.value_declaration,
            parent: self.parent,
            exports: self.exports,
            members: self.members,
            export_symbol: self.export_symbol,
        }
    }
}

/// The declarations of a symbol. Nearly every symbol has one, which needs no separate allocation.
#[derive(Default)]
pub enum DeclsIn<S: Storage> {
    #[default]
    None,
    One(Decl),
    Many(S::Few<Decl>),
}

/// Those of a symbol of a file that has been loaded.
pub type Decls<'s> = DeclsIn<InArena<'s>>;

impl<S: Storage> DeclsIn<S> {
    #[inline]
    pub fn as_slice(&self) -> &[Decl] {
        match self {
            DeclsIn::None => &[],
            DeclsIn::One(decl) => std::slice::from_ref(decl),
            DeclsIn::Many(decls) => &decls[..],
        }
    }
}

impl DeclsIn<Growable> {
    fn push(&mut self, decl: Decl) {
        match self {
            DeclsIn::None => *self = DeclsIn::One(decl),
            DeclsIn::One(first) => *self = DeclsIn::Many(vec![*first, decl]),
            DeclsIn::Many(all) => all.push(decl),
        }
    }

    fn into_arena(self, arena: &Arena) -> Decls<'_> {
        match self {
            DeclsIn::None => DeclsIn::None,
            DeclsIn::One(decl) => DeclsIn::One(decl),
            DeclsIn::Many(all) => DeclsIn::Many(few_to_arena(all, arena)),
        }
    }
}

impl<'s> Decls<'s> {
    pub fn clone_in(&self, arena: &'s Arena) -> Decls<'s> {
        match self {
            DeclsIn::None => DeclsIn::None,
            DeclsIn::One(decl) => DeclsIn::One(*decl),
            DeclsIn::Many(all) => DeclsIn::Many(ArenaFew::from_iter_in(all.iter().copied(), arena)),
        }
    }
}

/// `SetValueDeclaration`: whether `node` replaces `value_declaration`. "Non-assignment declarations
/// take precedence over assignment declarations and non-namespace declarations take precedence over
/// namespace declarations."
pub fn takes_over_as_value_declaration(value_declaration: Option<Decl>, node: Decl) -> bool {
    // `isAssignmentDeclaration`
    let is_assignment = |decl: Decl| {
        matches!(
            decl,
            Decl::ModuleExports(_)
                | Decl::ExportsProperty(_)
                | Decl::Expando(_)
                | Decl::ThisProperty(_)
        )
    };
    value_declaration.is_none_or(|it| {
        is_assignment(it) && !is_assignment(node)
            || matches!(it, Decl::Module(_)) && !matches!(node, Decl::Module(_))
    })
}

impl<S: Storage> std::ops::Deref for DeclsIn<S> {
    type Target = [Decl];
    #[inline]
    fn deref(&self) -> &[Decl] {
        self.as_slice()
    }
}

impl<'a, S: Storage> IntoIterator for &'a DeclsIn<S> {
    type Item = &'a Decl;
    type IntoIter = std::slice::Iter<'a, Decl>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.as_slice().iter()
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ScopeKind {
    File,
    Module(ModuleId),
    Fn(FnId),
    Block,
    Class(ClassId),
    Interface(InterfaceId),
    /// The type parameters of a type alias.
    TypeAlias(AliasId),
    /// The key of a mapped type, or the `infer` type parameters of a conditional type.
    TypeParams,
    Enum(EnumId),
    /// Encloses the constraints and defaults of the type parameters of a function. It declares
    /// nothing: it is nested in the scope of the function and identifies the part of the function
    /// that contains a name. `Bound::is_seen_from`
    TypeParamList(FnId),
    /// The same for the parameters: their types, patterns and defaults. Only a function with a block for a body has one.
    Param(FnId),
    /// The same for the return type.
    ReturnType(FnId),
    /// Encloses the `extends` type of a conditional type. It declares nothing: the `infer` type
    /// parameters are declared in the parent scope, which also encloses the true branch, and cannot
    /// be referenced from here. `Bound::is_seen_from`
    Extends,
    /// Encloses the constraint of an `infer T extends ..`. It declares `T` again, which can be
    /// referenced from here.
    InferConstraint,
    /// Encloses a static member of a class, including its decorators but not a computed name. It
    /// declares nothing: it is nested in the scope of the class, whose type parameters cannot be
    /// referenced from here. `Bound::type_parameter_out_of_reach`
    StaticMember,
    /// The same for the computed name of a member of a class or an interface.
    ComputedName,
    /// The same for the `extends` expression of a class, without its type arguments.
    BaseExpression,
    /// Encloses the computed name and the initializer of a non-static class property, if the class
    /// has a constructor with a body, which is stored here, and class fields are not emitted
    /// unchanged. It declares nothing: the constructor's declarations cannot be referenced from
    /// here, nor the names they shadow. `Bound::property_with_invalid_initializer`
    PropertyDeclaration(MemberId, FnId),
    /// The same for the type of the property.
    PropertyType(MemberId, FnId),
}

pub struct Scope {
    pub parent: ScopeId,
    pub kind: ScopeKind,
    pub locals: TableId,
    /// For a module, namespace or enum: its symbol, whose exports are in scope wherever they were declared.
    pub symbol: SymbolId,
    /// `NodeFlagsExportContext`
    pub is_export_context: bool,
}

/// What `GetAssignmentTarget` finds.
#[derive(Copy, Clone)]
pub enum AssignmentTarget {
    /// The left side of `=`, or of a compound assignment operator.
    Assign(Option<BinOp>),
    /// The operand of `++` or `--`.
    Unary,
    /// The target that the head of a `for`-`in` or a `for`-`of` assigns to.
    ForInOrOf,
}

/// `ModuleInstanceState`, in the same order: comparisons use the numeric value.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum ModuleInstanceState {
    NonInstantiated,
    Instantiated,
    ConstEnumOnly,
}

/// `AccessKind`
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AccessKind {
    Read,
    Write,
    ReadWrite,
}

/// `AssignmentKind`
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AssignmentKind {
    None,
    Definite,
    Compound,
}

/// The direct parent of an expression or a statement.
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
    /// The computed name of a property of the object literal that is neither a method nor an
    /// accessor.
    PropKey(ExprId, PropId),
    /// The computed name of a binding element.
    PatKey(PatPropId),
    /// The computed name of a member of a class, an interface or a type literal: for control flow,
    /// it is inside the member.
    MemberKey(MemberId),
    /// The computed name of a method or an accessor of an object literal: the same.
    MethodKey(PropId),
    /// The initializer of a member. Also the operand of a `typeof` in the type or the initializer of a property of a class, if
    /// there is no function in between.
    MemberInit(MemberId),
    /// The expression body of an arrow function, or a statement of a body.
    FnBody(FnId),
    EnumInit(EnumMemberId),
    Case(CaseId),
    ClassExtends(ClassId),
    /// A decorator of the class, of one of its members or of a parameter of a member: evaluated at
    /// the position of the class.
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

/// `bind`: `includes` and `excludes` of a member of an object literal or an attribute of a JSX element.
pub fn flags_of_property(kind: PropKind) -> Option<(SymFlags, SymFlags)> {
    Some(match kind {
        PropKind::Init | PropKind::Shorthand => (SymFlags::PROPERTY, SymFlags::PROPERTY_EXCLUDES),
        // `IsObjectLiteralMethod`
        PropKind::Method => (SymFlags::METHOD, SymFlags::VALUE),
        PropKind::Getter => (SymFlags::GET_ACCESSOR, SymFlags::GET_ACCESSOR_EXCLUDES),
        PropKind::Setter => (SymFlags::SET_ACCESSOR, SymFlags::SET_ACCESSOR_EXCLUDES),
        PropKind::Spread => return None,
    })
}

/// `bind`, `bindPropertyWorker`: `includes` and `excludes` of a member of a class, an interface or a type literal.
pub fn flags_of_member(member: &Member) -> Option<(SymFlags, SymFlags)> {
    Some(match member.kind {
        MemberKind::Property if member.flags.contains(Flags::ACCESSOR) => {
            (SymFlags::ACCESSOR, SymFlags::ACCESSOR_EXCLUDES)
        }
        MemberKind::Property => (SymFlags::PROPERTY, SymFlags::PROPERTY_EXCLUDES),
        MemberKind::Method => (SymFlags::METHOD, SymFlags::METHOD_EXCLUDES),
        MemberKind::Getter => (SymFlags::GET_ACCESSOR, SymFlags::GET_ACCESSOR_EXCLUDES),
        MemberKind::Setter => (SymFlags::SET_ACCESSOR, SymFlags::SET_ACCESSOR_EXCLUDES),
        MemberKind::Constructor => (SymFlags::CONSTRUCTOR, SymFlags::empty()),
        MemberKind::CallSignature | MemberKind::ConstructSignature | MemberKind::IndexSignature => {
            (SymFlags::SIGNATURE, SymFlags::empty())
        }
        MemberKind::StaticBlock => return None,
    })
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PatParent {
    None,
    Var(VarDeclId),
    Param(ParamId),
    Prop(PatId, PatPropId),
    Elem(PatId, PatElemId),
}

impl PatParent {
    /// `node.Initializer()` of the variable declaration, the parameter or the binding element.
    #[inline]
    pub fn initializer(self, hir: &File) -> ExprId {
        match self {
            PatParent::Var(d) => hir[d].init,
            PatParent::Param(p) => hir[p].default,
            PatParent::Prop(_, prop) => hir[prop].default,
            PatParent::Elem(_, elem) => hir[elem].default,
            PatParent::None => ExprId::NONE,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ClassOwner {
    Expr(ExprId),
    Stmt(StmtId),
}

impl ClassOwner {
    /// The class expression or declaration, as the parent of what is directly inside the class.
    #[inline]
    pub fn to_parent(self) -> Parent {
        match self {
            ClassOwner::Expr(e) => Parent::Expr(e),
            ClassOwner::Stmt(s) => Parent::Stmt(s),
        }
    }
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
    /// The start of a function, of a property with an initializer, of the body of a namespace or of
    /// the file. That of a method, an accessor or a property is before its name, if that is
    /// computed. `outer` is the flow node at which the function expression, the arrow function, or
    /// the method or accessor of an object literal or a class expression is evaluated.
    /// `arrow`: it is an arrow function, which has no `this` of its own.
    Start {
        outer: FlowId,
        arrow: bool,
    },
    /// The start of an immediately invoked `async` function or generator: outer narrowings hold, as
    /// in `getControlFlowContainer`. An immediately invoked function that is neither, like a static
    /// block, starts no new flow. The enclosing control flow continues through it
    /// (`bindContainer`).
    StartInvoked {
        outer: FlowId,
        arrow: bool,
    },
    /// A join of several paths. A contiguous range of `Bound::flow_edges`.
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
    /// After a `finally` block. Walking back through the block from here, only some of its
    /// antecedents apply: those of `instead`, not all those of `label`, which is the start of the
    /// block.
    Reduce {
        before: FlowId,
        label: FlowId,
        instead: FlowId,
    },
    /// `a.push(x)`, `a[i] = x` on an evolving array.
    ArrayMutation {
        before: FlowId,
        expr: ExprId,
    },
}

#[derive(Copy, Clone, Debug)]
pub struct FnInfo {
    pub owner: FnOwner,
    pub scope: ScopeId,
    /// The enclosing function-like.
    pub enclosing: FnId,
    /// The `return` statements, `Bound::ids`.
    pub returns: IdList<StmtId>,
    /// The yield expressions `forEachYieldExpression` finds, including those in the static blocks
    /// of classes nested in it. A static block itself has none.
    pub yields: IdList<ExprId>,
    /// `Unreachable` if control cannot fall off the end.
    pub end: FlowId,
    /// For a constructor, a static block or a function that the enclosing control flow continues
    /// through: its exit, reached by a `return` or by reaching the end. `ReturnFlowNode`
    pub exit: FlowId,
    /// `NodeFlagsContainsThis`: it contains a `this`, expression or type, possibly inside arrow
    /// functions, function types or signatures.
    pub contains_this: bool,
}

/// The syntactic position of an `infer T`, for the positions `getInferredTypeParameterConstraint`
/// handles.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum InferPosition {
    /// `Ref<.., infer T, ..>`: the type reference and the argument index.
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

/// `declareSymbolEx`, where `symbol.Flags&excludes != 0`: `symbol` refused `decl`.
pub struct Redeclaration {
    pub symbol: SymbolId,
    /// `len(symbol.Declarations)` by then.
    pub count: u32,
    pub decl: Decl,
    /// The error code reported at each of those declarations and at `decl`.
    pub code: u32,
}

/// Side tables parallel to the vectors of a [`File`].
#[derive(Default)]
pub struct BoundIn<S: Storage> {
    /// The HIR was too deep to bind. No other field is filled in.
    pub ran_out_of_stack: bool,
    pub symbols: S::List<SymbolIn<S>>,
    pub scopes: S::List<Scope>,
    /// Each table is a contiguous range of `entries`, in symbol creation order.
    pub tables: S::List<(u32, u32)>,
    pub entries: S::List<(Atom, SymbolId)>,
    /// The index in `entries` of each name of a table with more than `SCANNED` names.
    pub large_tables: S::Map<(TableId, Atom), u32>,
    /// A Bloom filter with one hash function over the names in the `locals` of the scopes that have
    /// no `symbol` and are not the file scope. Its length is a power of two of words, or zero if
    /// those scopes declare nothing. `scope_to_resolve_from`
    pub nested_names: S::List<u64>,
    pub ids: S::List<u32>,

    /// The file as a module. Its exports are what other files can import.
    pub file_symbol: SymbolId,
    /// `exportStars.Declarations`: every `export * from spec`, with the module or namespace symbol
    /// that contains it.
    pub export_stars: S::Few<(SymbolId, StmtId)>,
    /// `declare module "name"` at the top level of a file, or directly inside an ambient module at
    /// the top level of a script. The flag is `IsModuleAugmentationExternal`: it augments a module
    /// that is declared elsewhere.
    pub ambient_modules: S::Few<(Atom, SymbolId, bool)>,
    /// `declare global { }` at the top level of a module, or directly inside an ambient module at
    /// the top level of a script: symbols whose exports are global.
    pub global_augmentations: S::Few<SymbolId>,
    pub redeclarations: S::Few<Redeclaration>,
    /// `export as namespace N`
    pub umd_globals: S::Few<(Atom, SymbolId)>,
    /// `file.Imports()`: the module specifiers in the file that are resolved, in order of first
    /// occurrence.
    /// `collectModuleReferences`
    pub specifiers: S::List<Atom>,
    /// `file.ModuleAugmentations`: the names of the modules that a module augments, except those it
    /// imports. Resolved after `specifiers`.
    pub module_augmentations: S::Few<Atom>,
    /// The specifiers of the import and export statements directly inside the ambient modules a
    /// script declares, and the names of the modules augmented there: resolved unless relative.
    pub ambient_specifiers: S::Few<Atom>,
    /// `CommonJSModuleIndicator`: the expression that marks the file as a CommonJS module.
    pub commonjs_indicator: Option<ExprId>,
    /// `declareCommonJSVariable`: `module.Members["exports"]`. `NONE`: there is no such `module`.
    pub module_exports_property: SymbolId,

    /// `getResolvedSymbol` of an identifier. `NONE`: nothing in this file declares it.
    /// `node.Symbol` of a `Decl::Expando` and of an object literal, where `NONE` means that it has
    /// not been created: see `symbol_of_expando_initializer`.
    pub expr_symbol: S::List<SymbolId>,
    pub expr_parent: S::List<Parent>,
    /// The flow node at a name, a `this`, a `super`, and a narrowable `a.b` or `a[b]`
    /// (`isNarrowableReference`).
    /// `UNREACHABLE` for everything else.
    pub expr_flow: S::List<FlowId>,
    pub stmt_parent: S::List<Parent>,
    /// The enclosing scope of a statement.
    pub stmt_scope: S::List<ScopeId>,
    /// The enclosing scope of a type.
    pub type_scope: S::List<ScopeId>,
    /// `isResolvedByTypeAlias`: between the type node and a type alias there are only nodes that
    /// resolve their parts eagerly.
    pub type_by_alias: S::List<bool>,
    /// The `this` types inside a type literal, where they are invalid. `getThisType`
    pub this_in_type_literal: S::Set<TypeNodeId>,
    /// `None`: the binder did not reach the node. The parser can leave unreferenced nodes (a
    /// construct dropped during error recovery, an annotation in a parenthesized list that is not
    /// an arrow function, `<T>(x)` parsed as a cast). They have no symbol, scope or owner, so a
    /// pass over a whole vector has to skip them. The same holds for `member_owner`,
    /// `fns[..].owner` and `type_param_scope`.
    pub pat_parent: S::List<PatParent>,
    pub pat_symbol: S::List<SymbolId>,
    pub prop_owner: S::List<ExprId>,
    pub member_symbol: S::List<SymbolId>,
    /// `node.Symbol` for a parameter property and for a member of an object literal that has
    /// symbols.
    pub property_symbol: S::Map<Decl, SymbolId>,
    pub member_owner: S::List<MemberOwner>,
    /// The enclosing scope of the type, the function and the initializer of a member.
    pub member_scope: S::List<ScopeId>,
    pub param_fn: S::List<FnId>,
    pub type_param_symbol: S::List<SymbolId>,
    /// The scope a type parameter is declared in: that of its class, interface, function, alias..
    pub type_param_scope: S::List<ScopeId>,
    pub fns: S::List<FnInfo>,
    /// `requiresScopeChange` is true for some parameter, indexed by function: names in its parameters then
    /// resolve to variables of its body.
    pub requires_scope_change: S::List<bool>,
    /// `node.Symbol`. For an unnamed function expression and for an arrow function `NONE` means
    /// that it has not been created: see `symbol_of_expando_initializer`.
    pub fn_symbol: S::List<SymbolId>,
    pub class_symbol: S::List<SymbolId>,
    pub class_owner: S::List<ClassOwner>,
    pub class_scope: S::List<ScopeId>,
    pub interface_symbol: S::List<SymbolId>,
    /// The scope that an interface, an enum, a module or a namespace creates. Its enclosing scope
    /// is the parent of that scope.
    pub interface_scope: S::List<ScopeId>,
    pub enum_scope: S::Few<ScopeId>,
    pub module_scope: S::Few<ScopeId>,
    pub alias_symbol: S::List<SymbolId>,
    pub alias_scope: S::List<ScopeId>,
    pub enum_symbol: S::Few<SymbolId>,
    pub enum_member_symbol: S::Few<SymbolId>,
    pub enum_member_owner: S::Few<EnumId>,
    pub module_symbol: S::Few<SymbolId>,
    /// `GetModuleInstanceState`, by `ModuleId`.
    pub module_instance_state: S::Few<ModuleInstanceState>,
    pub var_stmt: S::List<StmtId>,
    /// The identifiers that are assigned to, keyed by the variable they resolve to.
    pub assignments: S::List<(SymbolId, ExprId)>,
    /// The expressions that are (part of) the operand of a `typeof` in a type. Sorted.
    pub type_query_operands: S::Few<ExprId>,
    /// The expressions at or under a node that is in tsgo's AST but that `checkSourceFile` never
    /// reaches: an element of an `extends` clause of a class after the first, the `e` of `[e]` in
    /// an enum, the `X` of `for (var of X)`. Sorted.
    pub unchecked_exprs: S::Few<ExprId>,
    /// The type nodes under one of those, and the type arguments of a `super` call. Sorted.
    pub unchecked_types: S::Few<TypeNodeId>,
    /// The position of each `infer T` whose position implies a constraint on `T`. Ordered by type
    /// parameter.
    pub infer_positions: S::Few<(TypeParamId, InferPosition)>,
    /// The assignments and calls that `bindDeferredExpandoAssignment` gives a symbol. Sorted.
    pub expando_declarations: S::Few<ExprId>,
    pub case_stmt: S::List<StmtId>,
    /// The flow node at the start of each statement.
    pub stmt_flow: S::List<FlowId>,
    /// The flow node at the end of a `case` that is followed by another, if that end is reachable.
    /// `NONE` otherwise.
    pub case_fallthrough: S::List<FlowId>,
    /// Each `var` declared in a block, from which it is hoisted, and its enclosing scope.
    pub hoisted_vars: S::Few<(PatId, ScopeId)>,
    /// The decorators of nodes that cannot be decorated: no further errors are reported inside
    /// them.
    pub refused_decorators: S::Few<ExprId>,
    /// The labeled statements that no `break` or `continue` refers to.
    pub unused_labels: S::Few<StmtId>,
    pub import_scope: S::List<ScopeId>,
    pub import_equals_scope: S::Few<ScopeId>,
    pub export_scope: S::List<ScopeId>,
    /// The enclosing scope of an expression that creates no scope, for the few that need it.
    pub expr_scope: S::Map<ExprId, ScopeId>,
    /// `a.#x`, and the `#x` of `#x in a` (its left operand): the innermost enclosing class that
    /// declares an `#x`.
    /// `lookupSymbolForPrivateIdentifierDeclaration`. No entry: no enclosing class does.
    pub private_class: S::Map<ExprId, ClassId>,
    /// The identifiers that resolve to nothing declared in the file, each with its enclosing scope:
    /// globals, members that another file merges into an enclosing namespace or enum, or errors.
    /// Sorted by expression.
    pub free_idents: S::List<(ExprId, ScopeId)>,
    /// The identifiers that resolve only to an import or another alias, each with its enclosing
    /// scope: whether the alias is a value can only be determined with the whole program. Sorted by
    /// expression.
    pub alias_idents: S::List<(ExprId, ScopeId)>,
    /// The `arguments` identifiers that refer to the arguments of an enclosing function. Sorted.
    pub arguments_objects: S::Few<ExprId>,
    /// The identifiers that have an `associatedDeclarationForContainingInitializerOrBindingName` and are not `withinDeferredContext`:
    /// with its name, and the function whose parameter it is or is part of.
    pub identifiers_in_parameters: S::Few<(ExprId, PatId, FnId)>,
    /// `checkUnmatchedJSDocParameters`: the `@param` tags that match no parameter, as start and code.
    pub jsdoc_param_errors: S::Few<u32>,

    pub flow: S::List<Flow>,
    pub flow_edges: S::List<FlowId>,
    /// `FlowFlagsShared`, a bit for each node of `flow`: it is the antecedent of more than one
    /// node.
    pub flow_shared: S::List<u64>,
    /// Number of flow nodes the binder encountered. `flow` omits the labels that nothing follows,
    /// and has a single start node for all the functions without a body.
    pub flow_places: u32,
}

/// The side tables of a file that has been loaded.
pub type Bound<'s> = BoundIn<InArena<'s>>;
/// The side tables of a file that is being bound.
pub type BoundBuilder = BoundIn<Growable>;

pub const UNREACHABLE: FlowId = FlowId(0);

/// What the binder also calls while it binds.
impl<S: Storage> BoundIn<S> {
    /// A table with at most this many names is searched linearly.
    pub const SCANNED: usize = 8;

    /// `GetCombinedModifierFlags`
    pub fn modifier_flags(&self, f: &File, decl: Decl) -> Flags {
        match decl {
            Decl::Var(mut pat) => loop {
                match self.pat_parent[pat.idx()] {
                    PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                    PatParent::Var(d) => break f[d].flags,
                    _ => break Flags::empty(),
                }
            },
            Decl::Fn(it) => f[it].flags,
            Decl::Class(it) => f[it].flags,
            Decl::Interface(it) => f[it].flags,
            Decl::Alias(it) => f[it].flags,
            Decl::Enum(it) => f[it].flags,
            Decl::Module(it) => f[it].flags,
            Decl::ImportEquals(it) => f[it].flags,
            _ => Flags::empty(),
        }
    }

    /// The nearest scope that is more than a block: `container`, where `scope` is `blockScopeContainer`.
    pub fn container_scope(&self, mut scope: ScopeId) -> ScopeId {
        loop {
            let s = &self.scopes[scope.idx()];
            let is_container = matches!(
                s.kind,
                ScopeKind::File
                    | ScopeKind::Module(_)
                    | ScopeKind::Fn(_)
                    | ScopeKind::Class(_)
                    | ScopeKind::Interface(_)
                    | ScopeKind::Enum(_)
            );
            if is_container || s.parent.is_none() {
                return scope;
            }
            scope = s.parent;
        }
    }

    /// `GetAssignmentTarget`: the node that assigns to `e`, if `e` is its target or part of a
    /// pattern that is its target.
    #[inline]
    pub fn get_assignment_target(&self, hir: &File, e: ExprId) -> Option<AssignmentTarget> {
        self.assignment_target(hir, e, true)
    }

    /// `GetAssignmentTarget` and `accessKind` walk up the parents the same way, except that the
    /// latter looks through neither `!` nor `...`.
    fn assignment_target(
        &self,
        hir: &File,
        mut e: ExprId,
        sees_through_spread: bool,
    ) -> Option<AssignmentTarget> {
        loop {
            match self.expr_parent[e.idx()] {
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Assign { op, target, .. } => {
                        return (target == e).then_some(AssignmentTarget::Assign(op));
                    }
                    ExprKind::Unary {
                        op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                        ..
                    } => return Some(AssignmentTarget::Unary),
                    ExprKind::Array(_) => e = parent,
                    ExprKind::Spread(_) | ExprKind::NonNull(_) if sees_through_spread => e = parent,
                    _ => return None,
                },
                // The value of `name: value` and of `...value`, and the assignment that `{ name =
                // value }` is stored as.
                Parent::Prop(p) => {
                    let owner = self.prop_owner[p.idx()];
                    if owner.is_none()
                        || !matches!(hir[owner].kind, ExprKind::Object(_))
                        || hir[p].kind == PropKind::Spread && !sees_through_spread
                        || !matches!(
                            hir[p].kind,
                            PropKind::Init | PropKind::Shorthand | PropKind::Spread
                        )
                    {
                        return None;
                    }
                    e = owner;
                }
                Parent::Stmt(s) if s.is_some() => {
                    return target_of_for_in_or_of(hir, &self.stmt_parent, s);
                }
                _ => return None,
            }
        }
    }

    /// `IsVariableDeclarationInitializedToRequire` for the name `pat`: the module, and the export
    /// name if `pat` does not bind the whole module.
    pub fn required_by(&self, hir: &File, pat: PatId) -> Option<(Atom, Option<Atom>)> {
        let (d, part) = match self.pat_parent[pat.idx()] {
            PatParent::Var(d) => (d, None),
            PatParent::Prop(outer, p) => match (self.pat_parent[outer.idx()], hir[p].key) {
                (PatParent::Var(d), PropKey::Name(name)) => (d, Some(name)),
                _ => return None,
            },
            _ => return None,
        };
        Some((module_required_by(hir, d)?, part))
    }

    /// `getExportSymbolOfValueSymbolIfExported`, before `getMergedSymbol`.
    pub fn export_symbol_of_value_symbol_if_exported(&self, symbol: SymbolId) -> SymbolId {
        let local = &self.symbols[symbol.idx()];
        if local.flags.contains(SymFlags::EXPORT_VALUE) && local.export_symbol.is_some() {
            local.export_symbol
        } else {
            symbol
        }
    }

    /// In symbol creation order.
    pub fn table(&self, table: TableId) -> &[(Atom, SymbolId)] {
        if table.is_none() {
            return &[];
        }
        let (start, len) = self.tables[table.idx()];
        &self.entries[start as usize..(start + len) as usize]
    }

    /// `NameResolver.Resolve`, the restrictions on the locals of a function and of a conditional
    /// type: whether a local with `flags` is visible to a lookup for `meaning` that has just left a
    /// scope of kind `from`.
    pub fn is_seen_from(&self, from: ScopeKind, flags: SymFlags, meaning: SymFlags) -> bool {
        // Among the members of a class or an interface only the type parameters are in scope, as
        // types: `class C<T> { T = 1 }`.
        if flags.contains(SymFlags::TYPE_PARAMETER) && !meaning.intersects(SymFlags::TYPE) {
            return false;
        }
        let f = match from {
            ScopeKind::TypeParamList(f) | ScopeKind::Param(f) | ScopeKind::ReturnType(f) => f,
            // The `infer` type parameters of a conditional type are visible only from its true
            // branch.
            ScopeKind::Extends => return false,
            _ => return true,
        };
        let mut seen = true;
        // Among the types only the type parameters are visible outside the body.
        if (meaning & flags).intersects(SymFlags::TYPE) {
            seen = flags.contains(SymFlags::TYPE_PARAMETER);
        }
        if (meaning & flags).intersects(SymFlags::VARIABLE) {
            // A parameter redeclared by a `var` still counts as a parameter.
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
}

/// The end of `GetAssignmentTarget`: `s`, an expression statement, is what the head of a `for`-`in`
/// or a `for`-`of` assigns to.
fn target_of_for_in_or_of(
    hir: &File,
    stmt_parent: &[Parent],
    s: StmtId,
) -> Option<AssignmentTarget> {
    matches!(stmt_parent[s.idx()], Parent::Stmt(l) if l.is_some()
        && matches!(hir[l].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == s))
    .then_some(AssignmentTarget::ForInOrOf)
}

/// `IsVariableDeclarationInitializedToRequire`: the module that `d` is initialized to.
fn module_required_by(hir: &File, d: VarDeclId) -> Option<Atom> {
    let init = hir[d].init;
    if !hir.is_js || init.is_none() || hir[d].ty.is_some() || hir[d].flags.contains(Flags::EXPORT) {
        return None;
    }
    required_specifier(hir, init)
}

/// The word index and the bit for `name` in a `nested_names` of `words` words.
fn bit_of_nested_name(words: usize, name: Atom) -> (usize, u64) {
    // Atoms are numbered sequentially: Fibonacci hashing spreads them.
    let hash = u64::from(name.0).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32;
    ((hash >> 6) as usize & (words - 1), 1 << (hash & 63))
}

impl Bound<'_> {
    /// `symbol.Declarations` of the symbol of `p`, a member of an object literal or a JSX attribute.
    pub fn declarations_of_literal_member(&self, p: PropId) -> SmallVec<[PropId; 2]> {
        let Some(symbol) = self.property_symbol.get(&Decl::Property(p)) else {
            return smallvec::smallvec![p];
        };
        let declarations = self.symbols[symbol.idx()].decls.iter();
        declarations
            .filter_map(|declaration| match *declaration {
                Decl::Property(p) => Some(p),
                _ => None,
            })
            .collect()
    }

    /// Whether `m`, which has a name, has a symbol that is not the one its container has under that name.
    pub fn is_member_in_no_table(&self, m: MemberId) -> bool {
        let Some(symbol) = self.symbols.get(self.member_symbol[m.idx()].idx()) else {
            return false;
        };
        let container = &self.symbols[symbol.parent.idx()];
        symbol.name != known::computed
            && [container.members, container.exports]
                .iter()
                .all(|&table| self.lookup(table, symbol.name) != Some(self.member_symbol[m.idx()]))
    }

    /// `getAssignmentTargetKind`
    pub fn get_assignment_target_kind(&self, hir: &File, e: ExprId) -> AssignmentKind {
        match self.get_assignment_target(hir, e) {
            None => AssignmentKind::None,
            Some(
                AssignmentTarget::Assign(None | Some(BinOp::And | BinOp::Or | BinOp::Nullish))
                | AssignmentTarget::ForInOrOf,
            ) => AssignmentKind::Definite,
            Some(_) => AssignmentKind::Compound,
        }
    }

    /// `accessKind`
    pub fn access_kind(&self, hir: &File, e: ExprId) -> AccessKind {
        match self.assignment_target(hir, e, false) {
            None => AccessKind::Read,
            Some(AssignmentTarget::Assign(None) | AssignmentTarget::ForInOrOf) => AccessKind::Write,
            Some(_) => AccessKind::ReadWrite,
        }
    }

    /// `IsWriteAccess`
    pub fn is_write_access(&self, hir: &File, e: ExprId) -> bool {
        self.access_kind(hir, e) != AccessKind::Read
    }

    /// `IsWriteOnlyAccess`
    pub fn is_write_only_access(&self, hir: &File, e: ExprId) -> bool {
        self.access_kind(hir, e) == AccessKind::Write
    }

    /// `isSymbolAssignedDefinitely`: `+=` and `++` modify a value, they do not initialize one.
    pub fn is_symbol_assigned_definitely(&self, hir: &File, symbol: SymbolId) -> bool {
        let from = self.assignments.partition_point(|a| a.0.0 < symbol.0);
        self.assignments[from..]
            .iter()
            .take_while(|a| a.0 == symbol)
            .any(|a| self.get_assignment_target_kind(hir, a.1) == AssignmentKind::Definite)
    }

    /// `GetImmediatelyInvokedFunctionExpression`: the call, if the function expression or arrow
    /// function `f` is immediately invoked.
    pub fn get_immediately_invoked_function_expression(
        &self,
        hir: &File,
        f: FnId,
    ) -> Option<CallId> {
        if let FnOwner::Expr(e) = self.fns[f.idx()].owner
            && matches!(hir[f].kind, FnKind::Expr | FnKind::Arrow)
            && let Parent::Expr(parent) = self.expr_parent[e.idx()]
            && parent.is_some()
            && let ExprKind::Call(call) = hir[parent].kind
            && hir[call].callee == e
        {
            return Some(call);
        }
        None
    }

    /// `GetAssignedName`: the position of the name of the target that `e` is directly assigned to.
    pub fn get_assigned_name(&self, hir: &File, e: ExprId) -> Option<u32> {
        if is_parenthesized(hir, e) {
            return None;
        }
        match self.expr_parent[e.idx()] {
            // Not the attribute of a JSX element.
            Parent::Prop(p) if hir[p].kind == PropKind::Init => {
                let owner = self.prop_owner[p.idx()];
                (owner.is_some() && matches!(hir[owner].kind, ExprKind::Object(_)))
                    .then_some(hir[p].pos)
            }
            Parent::PatPropDefault(p) => Some(hir[hir[p].value].pos),
            Parent::PatElemDefault(p) => Some(hir[hir[p].pat].pos),
            Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => {
                Some(hir[hir[d].pat].pos)
            }
            // On the right of any operator.
            Parent::Expr(parent) if parent.is_some() => {
                let left = match hir[parent].kind {
                    ExprKind::Binary { left, right, .. } if right == e => left,
                    ExprKind::Assign { target, value, .. } if value == e => target,
                    _ => return None,
                };
                // `{ a = e }` is a `ShorthandPropertyAssignment`.
                if is_parenthesized(hir, left)
                    || matches!(self.expr_parent[parent.idx()], Parent::Prop(p) if hir[p].kind == PropKind::Shorthand)
                {
                    return None;
                }
                match hir[left].kind {
                    ExprKind::Ident(_) => Some(hir[left].pos),
                    ExprKind::Dot { name_pos, .. } => Some(name_pos),
                    // `IsStringOrNumericLiteralLike(SkipParentheses(argument))`
                    ExprKind::Index { index, .. } => match hir[index].kind {
                        ExprKind::String(_) | ExprKind::Number(_) => Some(hir[index].pos),
                        ExprKind::Template { exprs, .. } if exprs.is_empty() => {
                            Some(hir[index].pos)
                        }
                        _ => None,
                    },
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// Whether `checkSourceFile` never reaches the expression: it is unreferenced, or it is one of
    /// `unchecked_exprs`. A pass over all expressions of a file must skip it.
    pub fn is_unchecked(&self, e: usize) -> bool {
        matches!(self.expr_parent[e], Parent::None)
            || self
                .unchecked_exprs
                .binary_search(&ExprId(e as u32))
                .is_ok()
    }

    /// The same for a type node.
    pub fn is_unchecked_type(&self, node: usize) -> bool {
        self.type_scope[node].is_none()
            || self
                .unchecked_types
                .binary_search(&TypeNodeId(node as u32))
                .is_ok()
    }

    /// `IsInstantiatedModule`
    pub fn is_instantiated_module(&self, m: ModuleId, preserve_const_enums: bool) -> bool {
        match self.module_instance_state[m.idx()] {
            ModuleInstanceState::NonInstantiated => false,
            ModuleInstanceState::Instantiated => true,
            ModuleInstanceState::ConstEnumOnly => preserve_const_enums,
        }
    }

    /// `IsInTypeQuery`: the type of `e` is queried, but `e` is not read.
    pub fn is_in_type_query(&self, e: ExprId) -> bool {
        self.type_query_operands.binary_search(&e).is_ok()
    }

    /// Whether `e` is `arguments`, meaning the arguments object.
    pub fn is_arguments_object(&self, e: ExprId) -> bool {
        self.arguments_objects.binary_search(&e).is_ok()
    }

    /// Whether the binder treated `e` as the declaration of a property of a function, a class or an
    /// object literal (`node.Symbol != nil`). That includes a key that names no property, as in
    /// `f[a + b] = value`.
    pub fn is_expando_declaration(&self, e: ExprId) -> bool {
        self.expando_declarations.binary_search(&e).is_ok()
    }

    /// `node.Symbol`. `NONE`: it is not stored for a declaration of that kind, none of which has a
    /// local symbol.
    pub fn symbol_of_declaration(&self, decl: Decl) -> SymbolId {
        match decl {
            Decl::Var(it) | Decl::Param(it) | Decl::Require(it) => self.pat_symbol[it.idx()],
            Decl::Fn(it) => self.fn_symbol[it.idx()],
            Decl::Class(it) => self.class_symbol[it.idx()],
            Decl::Interface(it) => self.interface_symbol[it.idx()],
            Decl::Alias(it) => self.alias_symbol[it.idx()],
            Decl::Enum(it) => self.enum_symbol[it.idx()],
            Decl::EnumMember(it) => self.enum_member_symbol[it.idx()],
            Decl::Module(it) => self.module_symbol[it.idx()],
            Decl::TypeParam(it) => self.type_param_symbol[it.idx()],
            Decl::Expando(it) | Decl::ObjectLiteral(it) | Decl::ThisProperty(it) => {
                self.expr_symbol[it.idx()]
            }
            Decl::Member(it) => self.member_symbol[it.idx()],
            Decl::ParameterProperty(_) | Decl::Property(_) => {
                let symbol = self.property_symbol.get(&decl);
                symbol.map_or(SymbolId::NONE, |&symbol| symbol)
            }
            _ => SymbolId::NONE,
        }
    }

    /// The scope at which `FindAncestor` from `decl` starts: the scope that a file, a module or a
    /// namespace creates, and the enclosing scope of any other declaration. `NONE`: the binder did
    /// not reach it, or it is an assignment.
    pub fn scope_of_declaration(&self, hir: &File, decl: Decl) -> ScopeId {
        let around = |created: ScopeId| {
            let created = self.scopes.get(created.idx());
            created.map_or(ScopeId::NONE, |scope| scope.parent)
        };
        let of_statement = |it: StmtId| {
            self.stmt_scope
                .get(it.idx())
                .map_or(ScopeId::NONE, |&it| it)
        };
        match decl {
            Decl::File | Decl::CommonJsVariable => ScopeId(0),
            Decl::Module(it) => self.module_scope[it.idx()],
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => {
                let mut root = pat;
                loop {
                    match self.pat_parent[root.idx()] {
                        PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => root = outer,
                        PatParent::Var(it) => return of_statement(self.var_stmt[it.idx()]),
                        PatParent::Param(it) => {
                            let function = self.fns.get(self.param_fn[it.idx()].idx());
                            return function.map_or(ScopeId::NONE, |function| function.scope);
                        }
                        PatParent::None => return ScopeId::NONE,
                    }
                }
            }
            Decl::Fn(it) => around(self.fns[it.idx()].scope),
            Decl::Class(it) => around(self.class_scope[it.idx()]),
            Decl::Interface(it) => around(self.interface_scope[it.idx()]),
            Decl::Alias(it) => around(self.alias_scope[it.idx()]),
            Decl::Enum(it) => around(self.enum_scope[it.idx()]),
            Decl::EnumMember(it) => {
                let owner = self.enum_scope.get(self.enum_member_owner[it.idx()].idx());
                owner.map_or(ScopeId::NONE, |&it| it)
            }
            Decl::TypeParam(it) => self.type_param_scope[it.idx()],
            Decl::ImportDefault(it) | Decl::ImportNamespace(it) => self.import_scope[it.idx()],
            Decl::ImportSpec(it) => self.import_scope[hir[it].import.idx()],
            Decl::ImportEquals(it) => self.import_equals_scope[it.idx()],
            Decl::ExportSpec(it) => self.export_scope[hir[it].export.idx()],
            Decl::ExportStarAs(it) | Decl::ExportExpr(it) | Decl::UmdGlobal(it) => of_statement(it),
            Decl::ModuleExports(_)
            | Decl::ExportsProperty(_)
            | Decl::Expando(_)
            | Decl::ObjectLiteral(_)
            | Decl::ThisProperty(_)
            | Decl::Property(_) => ScopeId::NONE,
            Decl::Member(it) => self.member_scope[it.idx()],
            Decl::ParameterProperty(it) => self.fns[self.param_fn[it.idx()].idx()].scope,
            Decl::TypeLiteral(it) => self.type_scope[it.idx()],
        }
    }

    /// `ExportSymbol` of the local symbol named `name` in `scope`.
    /// `GetLocalSymbolForExportDefault(result).Name == name` is evaluated in this direction:
    /// `result` is that symbol.
    pub fn export_symbol_of_local(&self, scope: ScopeId, name: Atom) -> SymbolId {
        match self.lookup(self.scopes[scope.idx()].locals, name) {
            Some(local) => self.symbols[local.idx()].export_symbol,
            None => SymbolId::NONE,
        }
    }

    pub fn lookup(&self, table: TableId, name: Atom) -> Option<SymbolId> {
        let entries = self.table(table);
        if entries.len() <= Self::SCANNED {
            return entries.iter().find(|e| e.0 == name).map(|e| e.1);
        }
        let place = *self.large_tables.get(&(table, name))?;
        Some(self.entries[place as usize].1)
    }

    #[inline]
    pub fn ids<T: From<u32>>(
        &self,
        list: IdList<T>,
    ) -> impl ExactSizeIterator<Item = T> + Clone + '_ {
        self.ids[list.range()].iter().map(|&i| T::from(i))
    }

    pub fn is_shared(&self, flow: FlowId) -> bool {
        let word = self.flow_shared.get(flow.idx() / 64);
        word.is_some_and(|word| word >> (flow.idx() % 64) & 1 != 0)
    }

    pub fn edges(&self, start: u32, len: u32) -> &[FlowId] {
        &self.flow_edges[start as usize..(start + len) as usize]
    }

    /// The scope at which `NameResolver.Resolve` can start its lookup of `name` from `scope`. If no
    /// scope in between declares the name, that is the nearest enclosing scope whose symbol has
    /// exports, which may come from elsewhere, or the file scope. Valid for a `lookup` that is
    /// `getSymbol`.
    #[inline]
    pub fn scope_to_resolve_from(&self, mut scope: ScopeId, name: Atom) -> ScopeId {
        if !self.nested_names.is_empty() {
            let (word, bit) = bit_of_nested_name(self.nested_names.len(), name);
            if self.nested_names[word] & bit != 0 {
                return scope;
            }
        }
        while scope.is_some() {
            let s = &self.scopes[scope.idx()];
            if s.symbol.is_some() || s.parent.is_none() {
                break;
            }
            scope = s.parent;
        }
        scope
    }

    /// `NameResolver.Resolve`, at a class or an interface reached from a static member
    /// (`IsStatic(lastLocation)`), at `KindComputedPropertyName` and at
    /// `KindExpressionWithTypeArguments`: the error with which a lookup for `meaning` that has
    /// reached `scope` fails because a type parameter of the enclosing class or interface is named
    /// `name`.
    pub fn type_parameter_out_of_reach(
        &self,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
    ) -> Option<u32> {
        let s = &self.scopes[scope.idx()];
        let code = match s.kind {
            ScopeKind::StaticMember => 2302,
            ScopeKind::ComputedName => 2467,
            ScopeKind::BaseExpression => 2562,
            _ => return None,
        };
        let symbol = self.lookup(self.scopes[s.parent.idx()].locals, name)?;
        (meaning & self.symbols[symbol.idx()].flags)
            .contains(SymFlags::TYPE_PARAMETER)
            .then_some(code)
    }

    /// `NameResolver.Resolve`, `case KindPropertyDeclaration`: `propertyWithInvalidInitializer`, if
    /// a lookup for `meaning` that has reached `scope` must record one there, with the error
    /// `checkAndReportErrorForInvalidInitializer` reports for it. The lookup continues, and returns
    /// nil at the end if it has a `nameNotFoundMessage`.
    pub fn property_with_invalid_initializer(
        &self,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
    ) -> Option<(u32, MemberId)> {
        let (code, property, constructor) = match self.scopes[scope.idx()].kind {
            ScopeKind::PropertyDeclaration(property, constructor) => (2301, property, constructor),
            ScopeKind::PropertyType(property, constructor) => (2844, property, constructor),
            _ => return None,
        };
        let locals = self.scopes[self.fns[constructor.idx()].scope.idx()].locals;
        let local = self.lookup(locals, name)?;
        (meaning & self.symbols[local.idx()].flags)
            .intersects(SymFlags::VALUE)
            .then_some((code, property))
    }
}

fn map_to_arena<'s, K: Eq + std::hash::Hash, V>(
    map: FxHashMap<K, V>,
    arena: &'s Arena,
) -> ArenaHashMap<'s, K, V> {
    let mut exact = ArenaHashMap::with_capacity_and_hasher_in(map.len(), FxBuild::default(), arena);
    exact.extend(map);
    exact
}

fn set_to_arena<'s, K: Eq + std::hash::Hash>(
    set: FxHashSet<K>,
    arena: &'s Arena,
) -> ArenaHashSet<'s, K> {
    let mut exact = ArenaHashSet::with_capacity_and_hasher_in(set.len(), FxBuild::default(), arena);
    exact.extend(set);
    exact
}

impl BoundBuilder {
    /// The side tables with every list at its final size in `arena`.
    pub fn into_arena<'s>(mut self, arena: &'s Arena) -> Bound<'s> {
        Bound {
            ran_out_of_stack: self.ran_out_of_stack,
            symbols: {
                let mut exact = ArenaVec::new_in(arena);
                exact.reserve_exact(self.symbols.len());
                exact.extend(
                    self.symbols
                        .drain(..)
                        .map(|symbol| symbol.into_arena(arena)),
                );
                exact
            },
            scopes: move_to_arena(&mut self.scopes, arena),
            tables: copy_to_arena(&mut self.tables, arena),
            entries: copy_to_arena(&mut self.entries, arena),
            large_tables: map_to_arena(self.large_tables, arena),
            nested_names: copy_to_arena(&mut self.nested_names, arena),
            ids: copy_to_arena(&mut self.ids, arena),
            file_symbol: self.file_symbol,
            export_stars: few_to_arena(self.export_stars, arena),
            ambient_modules: few_to_arena(self.ambient_modules, arena),
            global_augmentations: few_to_arena(self.global_augmentations, arena),
            redeclarations: few_to_arena(self.redeclarations, arena),
            umd_globals: few_to_arena(self.umd_globals, arena),
            specifiers: copy_to_arena(&mut self.specifiers, arena),
            module_augmentations: few_to_arena(self.module_augmentations, arena),
            ambient_specifiers: few_to_arena(self.ambient_specifiers, arena),
            commonjs_indicator: self.commonjs_indicator,
            module_exports_property: self.module_exports_property,
            expr_symbol: copy_to_arena(&mut self.expr_symbol, arena),
            expr_parent: copy_to_arena(&mut self.expr_parent, arena),
            expr_flow: copy_to_arena(&mut self.expr_flow, arena),
            stmt_parent: copy_to_arena(&mut self.stmt_parent, arena),
            stmt_scope: copy_to_arena(&mut self.stmt_scope, arena),
            type_scope: copy_to_arena(&mut self.type_scope, arena),
            type_by_alias: copy_to_arena(&mut self.type_by_alias, arena),
            this_in_type_literal: set_to_arena(self.this_in_type_literal, arena),
            pat_parent: copy_to_arena(&mut self.pat_parent, arena),
            pat_symbol: copy_to_arena(&mut self.pat_symbol, arena),
            prop_owner: copy_to_arena(&mut self.prop_owner, arena),
            member_symbol: copy_to_arena(&mut self.member_symbol, arena),
            property_symbol: map_to_arena(self.property_symbol, arena),
            member_owner: copy_to_arena(&mut self.member_owner, arena),
            member_scope: copy_to_arena(&mut self.member_scope, arena),
            param_fn: copy_to_arena(&mut self.param_fn, arena),
            type_param_symbol: copy_to_arena(&mut self.type_param_symbol, arena),
            type_param_scope: copy_to_arena(&mut self.type_param_scope, arena),
            fns: copy_to_arena(&mut self.fns, arena),
            requires_scope_change: copy_to_arena(&mut self.requires_scope_change, arena),
            fn_symbol: copy_to_arena(&mut self.fn_symbol, arena),
            class_symbol: copy_to_arena(&mut self.class_symbol, arena),
            class_owner: copy_to_arena(&mut self.class_owner, arena),
            class_scope: copy_to_arena(&mut self.class_scope, arena),
            interface_symbol: copy_to_arena(&mut self.interface_symbol, arena),
            interface_scope: copy_to_arena(&mut self.interface_scope, arena),
            enum_scope: few_to_arena(self.enum_scope, arena),
            module_scope: few_to_arena(self.module_scope, arena),
            alias_symbol: copy_to_arena(&mut self.alias_symbol, arena),
            alias_scope: copy_to_arena(&mut self.alias_scope, arena),
            enum_symbol: few_to_arena(self.enum_symbol, arena),
            enum_member_symbol: few_to_arena(self.enum_member_symbol, arena),
            enum_member_owner: few_to_arena(self.enum_member_owner, arena),
            module_symbol: few_to_arena(self.module_symbol, arena),
            module_instance_state: few_to_arena(self.module_instance_state, arena),
            var_stmt: copy_to_arena(&mut self.var_stmt, arena),
            assignments: copy_to_arena(&mut self.assignments, arena),
            type_query_operands: few_to_arena(self.type_query_operands, arena),
            unchecked_exprs: few_to_arena(self.unchecked_exprs, arena),
            unchecked_types: few_to_arena(self.unchecked_types, arena),
            infer_positions: few_to_arena(self.infer_positions, arena),
            expando_declarations: few_to_arena(self.expando_declarations, arena),
            case_stmt: copy_to_arena(&mut self.case_stmt, arena),
            stmt_flow: copy_to_arena(&mut self.stmt_flow, arena),
            case_fallthrough: copy_to_arena(&mut self.case_fallthrough, arena),
            hoisted_vars: few_to_arena(self.hoisted_vars, arena),
            refused_decorators: few_to_arena(self.refused_decorators, arena),
            unused_labels: few_to_arena(self.unused_labels, arena),
            import_scope: copy_to_arena(&mut self.import_scope, arena),
            import_equals_scope: few_to_arena(self.import_equals_scope, arena),
            export_scope: copy_to_arena(&mut self.export_scope, arena),
            expr_scope: map_to_arena(self.expr_scope, arena),
            private_class: map_to_arena(self.private_class, arena),
            free_idents: copy_to_arena(&mut self.free_idents, arena),
            alias_idents: copy_to_arena(&mut self.alias_idents, arena),
            arguments_objects: few_to_arena(self.arguments_objects, arena),
            identifiers_in_parameters: few_to_arena(self.identifiers_in_parameters, arena),
            jsdoc_param_errors: few_to_arena(self.jsdoc_param_errors, arena),
            flow: copy_to_arena(&mut self.flow, arena),
            flow_edges: copy_to_arena(&mut self.flow_edges, arena),
            flow_shared: copy_to_arena(&mut self.flow_shared, arena),
            flow_places: self.flow_places,
        }
    }
}

impl<'s> Bound<'s> {
    /// The side tables of a file without nodes.
    pub fn empty_in(arena: &'s Arena) -> Bound<'s> {
        BoundBuilder::default().into_arena(arena)
    }
}

/// The compiler options `requiresScopeChangeWorker` reads.
#[derive(Copy, Clone, Default)]
pub struct BindOptions {
    /// `GetEmitStandardClassFields`
    pub emit_standard_class_fields: bool,
    /// `GetEmitScriptTarget` is older than that.
    pub before_es2020: bool,
    pub before_es2017: bool,
}

/// `bindSourceFile`
pub fn bind<'s>(
    file: &File,
    options: BindOptions,
    atoms: &Interner,
    arena: &'s Arena,
) -> Bound<'s> {
    binder::Binder::run(file, options, atoms).into_arena(arena)
}

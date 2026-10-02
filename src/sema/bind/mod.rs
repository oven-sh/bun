//! What can be said of a file without looking at any other: which declaration each name means, who contains what, and
//! how control flows. Runs right after the parser, on the same thread.

mod binder;

use crate::atom::{Atom, Interner, known};
use crate::hir::*;
use crate::util::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

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
        /// A name others import by, which nothing in the file can refer to: `export { a as b }`, `export default e`.
        const EXPORT_ONLY = 1 << 18;
        const CONST_ENUM = 1 << 19;
        /// `module` and `exports` in a CommonJS module.
        const MODULE_EXPORTS = 1 << 20;
        /// `SymbolFlagsTransient`: made by `cloneSymbol`, not by the binder.
        const TRANSIENT = 1 << 21;
        /// `SymbolFlagsExportValue`: the local symbol of an exported value (`declareModuleMember`). It is no value itself.
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
        /// `SymbolFlagsModuleMember`: what is in scope in a module or a namespace for being exported from it.
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
    /// `f.a = e`, `f["a"] = e`, `f[key] = e`, where `getInitializerSymbol` finds something for `f`, which may be written `a.f`: the
    /// assignment. In JavaScript `Object.defineProperty(f, "a", descriptor)` too: the call.
    Expando(ExprId),
    /// `{}`, of the symbol such assignments add to in JavaScript.
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

/// The text of a string literal or of a template without substitutions, in parentheses or not. `NONE` for anything else,
/// including a numeric literal, which takes an interner to spell.
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

/// `IsRequireCall`: what is required, if `e` is `require(x)`.
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

pub struct Symbol {
    pub name: Atom,
    pub flags: SymFlags,
    /// `Declarations`, in the order they are bound.
    pub decls: Decls,
    /// `ValueDeclaration`: which of `Declarations`, those of all its parts for a symbol `mergeSymbol` has put together. `u32::MAX`: none.
    pub value_declaration: u32,
    /// `Parent`, as `declareSymbolEx` sets it: the module, namespace or enum among whose exports it is declared, be it refused there.
    /// `NONE` for a local.
    pub parent: SymbolId,
    /// What a module, namespace or enum exports, and the static side of a class.
    pub exports: TableId,
    pub members: TableId,
    /// `ExportSymbol`, of the local symbol of what a module or a namespace exports.
    pub export_symbol: SymbolId,
}

const _: () = assert!(size_of::<Symbol>() <= 48);

/// The declarations of a symbol. Nearly every symbol has one, which needs no block of its own.
#[derive(Clone, Default)]
pub enum Decls {
    #[default]
    None,
    One(Decl),
    #[expect(
        clippy::box_collection,
        reason = "one word, not three: with a `Vec` a `Symbol` is 56 bytes, and it is asserted to be 48 at most"
    )]
    Many(Box<Vec<Decl>>),
}

impl Decls {
    #[inline]
    pub fn as_slice(&self) -> &[Decl] {
        match self {
            Decls::None => &[],
            Decls::One(decl) => std::slice::from_ref(decl),
            Decls::Many(decls) => &decls[..],
        }
    }

    fn push(&mut self, decl: Decl) {
        match self {
            Decls::None => *self = Decls::One(decl),
            Decls::One(first) => *self = Decls::Many(Box::new(vec![*first, decl])),
            Decls::Many(all) => all.push(decl),
        }
    }
}

/// `SetValueDeclaration`: whether `node` takes the place of `value_declaration`. "Non-assignment declarations take precedence over
/// assignment declarations and non-namespace declarations take precedence over namespace declarations."
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

impl std::ops::Deref for Decls {
    type Target = [Decl];
    #[inline]
    fn deref(&self) -> &[Decl] {
        self.as_slice()
    }
}

impl<'a> IntoIterator for &'a Decls {
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
    /// The key of a mapped type, or the `infer`s of a conditional type.
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
    /// Where a static member of a class is written, decorators included, a computed name not. It declares nothing: it lies in the
    /// scope of the class, whose type parameters cannot be named from here. `Bound::type_parameter_out_of_reach`
    StaticMember,
    /// The same for the computed name of a member of a class or an interface.
    ComputedName,
    /// The same for the expression a class extends, without its type arguments.
    BaseExpression,
    /// Where the computed name and the initializer of a non-static property of a class are written, if the class has a constructor
    /// with a body, which is given, and class fields are not emitted as they are. It declares nothing: what the constructor declares
    /// cannot be named from here, nor what it hides. `Bound::property_with_invalid_initializer`
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
    /// The left of `=`, or of the operator and `=`.
    Assign(Option<BinOp>),
    /// The operand of `++` or `--`.
    Unary,
    /// What the head of a `for`-`in` or a `for`-`of` gives a value to.
    ForInOrOf,
}

/// `ModuleInstanceState`, in its order: where two are compared, it is by number.
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
    /// The computed name of a property of the object literal that is no method and no accessor.
    PropKey(ExprId, PropId),
    /// The computed name of a binding element.
    PatKey(PatPropId),
    /// The computed name of a member of a class, an interface or a type literal: as far as the flow of control goes, it is inside.
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
    /// as `getControlFlowContainer` has it. A function called where it is written that is neither, like a static block, starts
    /// nothing. The flow of control around goes on through it (`bindContainer`).
    StartInvoked {
        outer: FlowId,
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

/// `declareSymbolEx`, where `symbol.Flags&excludes != 0`: `symbol` refused `decl`.
pub struct Redeclaration {
    pub symbol: SymbolId,
    /// `len(symbol.Declarations)` by then.
    pub count: u32,
    pub decl: Decl,
    /// What is reported at each of those declarations and at `decl`.
    pub code: u32,
}

/// Side tables of a [`File`], index for index.
#[derive(Default)]
pub struct Bound {
    pub symbols: Vec<Symbol>,
    pub scopes: Vec<Scope>,
    /// Each table is a run of `entries`, in the order the symbols were made in.
    pub tables: Vec<(u32, u32)>,
    pub entries: Vec<(Atom, SymbolId)>,
    /// Where in `entries` each name of a table with more than `SCANNED` names is.
    pub large_tables: FxHashMap<(TableId, Atom), u32>,
    /// A Bloom filter, of one hash, of the names in the `locals` of the scopes that have no `symbol` and are not the file's. A power of
    /// two of words, or none where they declare nothing. `scope_to_resolve_from`
    pub nested_names: Box<[u64]>,
    pub ids: Vec<u32>,

    /// The file as a module. Its exports are what other files can import.
    pub file_symbol: SymbolId,
    /// `exportStars.Declarations`: every `export * from spec`, with the module or namespace symbol that says so.
    pub export_stars: Few<(SymbolId, StmtId)>,
    /// `declare module "name"` at the top of a file, or right in an ambient module at the top of a script. And
    /// `IsModuleAugmentationExternal`: it adds to a module that is declared elsewhere.
    pub ambient_modules: Few<(Atom, SymbolId, bool)>,
    /// `declare global { }` at the top of a module, or right in an ambient module at the top of a script: symbols whose exports are
    /// global.
    pub global_augmentations: Few<SymbolId>,
    pub redeclarations: Few<Redeclaration>,
    /// `export as namespace N`
    pub umd_globals: Few<(Atom, SymbolId)>,
    /// `file.Imports()`: the module specifiers in the file that are looked for, in the order they are first mentioned.
    /// `collectModuleReferences`
    pub specifiers: Vec<Atom>,
    /// `file.ModuleAugmentations`: the names of the modules a module adds to, but for those it imports. Looked for after `specifiers`.
    pub module_augmentations: Few<Atom>,
    /// Those of the import and export statements directly in the ambient modules a script declares, and the names of the modules
    /// added to there: looked for unless relative.
    pub ambient_specifiers: Few<Atom>,
    /// `CommonJSModuleIndicator`: what shows that the file is a CommonJS module.
    pub commonjs_indicator: Option<ExprId>,
    /// `declareCommonJSVariable`: `module.Members["exports"]`. `NONE`: there is no such `module`.
    pub module_exports_property: SymbolId,

    /// `getResolvedSymbol` of an identifier. `NONE`: nothing in this file declares it. `node.Symbol` of a `Decl::Expando` and of an
    /// object literal, where `NONE` says that it is not made: see `symbol_of_expando_initializer`.
    pub expr_symbol: Vec<SymbolId>,
    pub expr_parent: Vec<Parent>,
    /// Where control is at a name, a `this`, a `super`, and an `a.b` or `a[b]` that can be narrowed (`isNarrowableReference`).
    /// `UNREACHABLE` for everything else.
    pub expr_flow: Vec<FlowId>,
    pub stmt_parent: Vec<Parent>,
    /// The scope a statement is written in.
    pub stmt_scope: Vec<ScopeId>,
    /// The scope a type is written in.
    pub type_scope: Vec<ScopeId>,
    /// `isResolvedByTypeAlias`: between the type node and a type alias there is only what resolves its parts at once.
    pub type_by_alias: Vec<bool>,
    /// The `this` types written inside a type literal, where there is no such thing. `getThisType`
    pub this_in_type_literal: FxHashSet<TypeNodeId>,
    pub pat_parent: Vec<PatParent>,
    pub pat_symbol: Vec<SymbolId>,
    pub prop_owner: Vec<ExprId>,
    pub member_symbol: Vec<SymbolId>,
    /// `node.Symbol`, of a parameter property and of a member of an object literal that has symbols.
    pub property_symbol: FxHashMap<Decl, SymbolId>,
    pub member_owner: Vec<MemberOwner>,
    /// The scope the type, the function and the initializer of a member are written in.
    pub member_scope: Vec<ScopeId>,
    pub param_fn: Vec<FnId>,
    pub type_param_symbol: Vec<SymbolId>,
    /// The scope a type parameter is declared in: that of its class, interface, function, alias..
    pub type_param_scope: Vec<ScopeId>,
    pub fns: Vec<FnInfo>,
    /// `requiresScopeChange` of some parameter, by function: its parameters see the variables of its body.
    pub requires_scope_change: Vec<bool>,
    /// `node.Symbol`. Of a function expression without a name and of an arrow function `NONE` says that it is not made: see
    /// `symbol_of_expando_initializer`.
    pub fn_symbol: Vec<SymbolId>,
    pub class_symbol: Vec<SymbolId>,
    pub class_owner: Vec<ClassOwner>,
    pub class_scope: Vec<ScopeId>,
    pub interface_symbol: Vec<SymbolId>,
    /// The scope an interface, an enum, a module or a namespace makes. What it is written in is the parent of that.
    pub interface_scope: Vec<ScopeId>,
    pub enum_scope: Few<ScopeId>,
    pub module_scope: Few<ScopeId>,
    pub alias_symbol: Vec<SymbolId>,
    pub alias_scope: Vec<ScopeId>,
    pub enum_symbol: Few<SymbolId>,
    pub enum_member_symbol: Few<SymbolId>,
    pub enum_member_owner: Few<EnumId>,
    pub module_symbol: Few<SymbolId>,
    /// `GetModuleInstanceState`, by `ModuleId`.
    pub module_instance_state: Few<ModuleInstanceState>,
    pub var_stmt: Vec<StmtId>,
    /// The identifiers that are assigned to, by the variable they name.
    pub assignments: Vec<(SymbolId, ExprId)>,
    /// The expressions that are (part of) the operand of a `typeof` in a type. Sorted.
    pub type_query_operands: Few<ExprId>,
    /// The expressions at or under a node that tsgo has in its tree and `checkSourceFile` never comes to: an element of an `extends`
    /// clause of a class after the first, the `e` of `[e]` in an enum, the `X` of `for (var of X)`. Sorted.
    pub unchecked_exprs: Few<ExprId>,
    /// The type nodes under one of those, and the type arguments of a `super` call. Sorted.
    pub unchecked_types: Few<TypeNodeId>,
    /// Where each `infer T` that is written somewhere that says something about `T` is written. In order of the parameters.
    pub infer_positions: Few<(TypeParamId, InferPosition)>,
    /// The assignments and calls that `bindDeferredExpandoAssignment` gives a symbol. Sorted.
    pub expando_declarations: Few<ExprId>,
    pub case_stmt: Vec<StmtId>,
    /// Where control is when each statement is reached.
    pub stmt_flow: Vec<FlowId>,
    /// Where control is at the end of a `case` that another follows, if it gets there. `NONE` otherwise.
    pub case_fallthrough: Vec<FlowId>,
    /// Each `var` written in a block, which is not where it ends up, and the scope it is written in.
    pub hoisted_vars: Few<(PatId, ScopeId)>,
    /// The decorators of what cannot be decorated: nothing more is said of what is in them.
    pub refused_decorators: Few<ExprId>,
    /// The labeled statements no `break` or `continue` names.
    pub unused_labels: Few<StmtId>,
    pub import_scope: Vec<ScopeId>,
    pub import_equals_scope: Few<ScopeId>,
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
    pub arguments_objects: Few<ExprId>,
    /// The identifiers that have an `associatedDeclarationForContainingInitializerOrBindingName` and are not `withinDeferredContext`:
    /// with its name, and the function whose parameter it is or is part of.
    pub identifiers_in_parameters: Few<(ExprId, PatId, FnId)>,
    /// `checkUnmatchedJSDocParameters`: the `@param` tags that match no parameter, as start and code.
    pub jsdoc_param_errors: Few<(u32, u32)>,

    pub flow: Vec<Flow>,
    pub flow_edges: Vec<FlowId>,
    /// `FlowFlagsShared`, a bit for each of `flow`: it is the antecedent of more than one.
    pub flow_shared: Vec<u64>,
    /// How many places in the flow of control the binder came to. `flow` leaves out the labels nothing comes after, and has one start for
    /// all the functions without a body.
    pub flow_places: u32,
}

pub const UNREACHABLE: FlowId = FlowId(0);

impl Bound {
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

    /// `GetAssignmentTarget`: what gives `e` a value, if `e` is what it is given to or part of a pattern that is.
    #[inline]
    pub fn get_assignment_target(&self, hir: &File, e: ExprId) -> Option<AssignmentTarget> {
        self.assignment_target(hir, e, true)
    }

    /// `GetAssignmentTarget` and `accessKind` go up the same way, but that the second sees through neither `!` nor `...`.
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
                // The value of `name: value` and of `...value`, and the assignment `{ name = value }` is kept as.
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
                    return matches!(self.stmt_parent[s.idx()], Parent::Stmt(l) if l.is_some()
                        && matches!(hir[l].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == s))
                    .then_some(AssignmentTarget::ForInOrOf);
                }
                _ => return None,
            }
        }
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

    /// `isSymbolAssignedDefinitely`: `+=` and `++` change a value, they do not give one.
    pub fn is_symbol_assigned_definitely(&self, hir: &File, symbol: SymbolId) -> bool {
        let from = self.assignments.partition_point(|a| a.0.0 < symbol.0);
        self.assignments[from..]
            .iter()
            .take_while(|a| a.0 == symbol)
            .any(|a| self.get_assignment_target_kind(hir, a.1) == AssignmentKind::Definite)
    }

    /// `GetImmediatelyInvokedFunctionExpression`: the call, if the function expression or arrow function `f` is called where it is
    /// written.
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

    /// `GetAssignedName`: where the name is of what `e` is directly given to.
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

    /// Whether `checkSourceFile` never comes to the expression: nothing leads to it, or it is one of `unchecked_exprs`. Who goes through
    /// all expressions of a file passes over it.
    pub fn is_unchecked(&self, e: usize) -> bool {
        matches!(self.expr_parent[e], Parent::None)
            || self
                .unchecked_exprs
                .binary_search(&ExprId(e as u32))
                .is_ok()
    }

    /// The same of a type node.
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
        if !hir.is_js
            || init.is_none()
            || hir[d].ty.is_some()
            || hir[d].flags.contains(Flags::EXPORT)
        {
            return None;
        }
        Some((required_specifier(hir, init)?, part))
    }

    /// Whether the binder took `e` for the declaration of a property of a function, a class or an object literal
    /// (`node.Symbol != nil`). That includes a key that names no property, as in `f[a + b] = value`.
    pub fn is_expando_declaration(&self, e: ExprId) -> bool {
        self.expando_declarations.binary_search(&e).is_ok()
    }

    /// `node.Symbol`. `NONE`: it is not kept for a declaration of that kind, none of which has a local symbol.
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

    /// Where `FindAncestor` from `decl` starts, as far as scopes go: the scope a file, a module or a namespace makes, and the one any
    /// other declaration is written in. `NONE`: the binder did not come to it, or it is an assignment.
    pub fn scope_of_declaration(&self, hir: &File, decl: Decl) -> ScopeId {
        let around = |made: ScopeId| {
            let made = self.scopes.get(made.idx());
            made.map_or(ScopeId::NONE, |scope| scope.parent)
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

    /// `ExportSymbol` of the local symbol `scope` holds under `name`. `GetLocalSymbolForExportDefault(result).Name == name` is asked
    /// this way round: `result` is that.
    pub fn export_symbol_of_local(&self, scope: ScopeId, name: Atom) -> SymbolId {
        match self.lookup(self.scopes[scope.idx()].locals, name) {
            Some(local) => self.symbols[local.idx()].export_symbol,
            None => SymbolId::NONE,
        }
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

    /// A table with no more names than this is gone through to find one.
    pub const SCANNED: usize = 8;

    pub fn lookup(&self, table: TableId, name: Atom) -> Option<SymbolId> {
        let entries = self.table(table);
        if entries.len() <= Self::SCANNED {
            return entries.iter().find(|e| e.0 == name).map(|e| e.1);
        }
        let place = *self.large_tables.get(&(table, name))?;
        Some(self.entries[place as usize].1)
    }

    /// In the order the symbols were made in.
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

    pub fn is_shared(&self, flow: FlowId) -> bool {
        let word = self.flow_shared.get(flow.idx() / 64);
        word.is_some_and(|word| word >> (flow.idx() % 64) & 1 != 0)
    }

    pub fn edges(&self, start: u32, len: u32) -> &[FlowId] {
        &self.flow_edges[start as usize..(start + len) as usize]
    }

    /// `NameResolver.Resolve`, the restrictions on the locals of a function and of a conditional type: whether one with `flags` is
    /// seen by a search for `meaning` that has just left a scope of kind `from`.
    pub fn is_seen_from(&self, from: ScopeKind, flags: SymFlags, meaning: SymFlags) -> bool {
        // Of the members of a class or an interface the type parameters alone are in scope, as types: `class C<T> { T = 1 }`.
        if flags.contains(SymFlags::TYPE_PARAMETER) && !meaning.intersects(SymFlags::TYPE) {
            return false;
        }
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

    /// The word and the bit of a `nested_names` of `words` words that stand for `name`.
    #[inline]
    pub(super) fn bit_of_nested_name(words: usize, name: Atom) -> (usize, u64) {
        // Atoms are numbered as they come: Fibonacci hashing spreads them.
        let hash = u64::from(name.0).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32;
        ((hash >> 6) as usize & (words - 1), 1 << (hash & 63))
    }

    /// Where `NameResolver.Resolve` may as well start to look for `name` from `scope`. If no scope in between declares the name, that
    /// is the nearest around whose symbol has exports, which may come from elsewhere, or the file's. For a `lookup` that is `getSymbol`.
    #[inline]
    pub fn scope_to_resolve_from(&self, mut scope: ScopeId, name: Atom) -> ScopeId {
        if !self.nested_names.is_empty() {
            let (word, bit) = Self::bit_of_nested_name(self.nested_names.len(), name);
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

    /// `NameResolver.Resolve`, at a class or an interface come to from a static member (`IsStatic(lastLocation)`), at
    /// `KindComputedPropertyName` and at `KindExpressionWithTypeArguments`: the error with which a search for `meaning` that has got
    /// to `scope` ends, finding nothing, because a type parameter of the class or interface around goes by `name`.
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

    /// `NameResolver.Resolve`, `case KindPropertyDeclaration`: `propertyWithInvalidInitializer`, if a search for `meaning` that has got
    /// to `scope` is to remember one there, with the error `checkAndReportErrorForInvalidInitializer` has for it. The search goes on,
    /// and returns nil when it is over if it has a `nameNotFoundMessage`.
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

impl Bound {
    /// `hir::fit`, for a file that is kept. The other lists are made the size they need.
    pub fn fit(&mut self) {
        macro_rules! each {
            ($($f:ident),*) => { $(crate::hir::fit(&mut self.$f);)* };
        }
        each!(
            symbols,
            scopes,
            tables,
            entries,
            ids,
            specifiers,
            assignments,
            free_idents,
            alias_idents,
            flow,
            flow_edges
        );
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

/// `bindSourceFile`
pub fn bind(file: &File, options: BindOptions, atoms: &Interner) -> Bound {
    binder::Binder::run(file, options, atoms)
}

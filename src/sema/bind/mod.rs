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
        /// `SymbolFlagsProperty`, of `bindExportAssignment`: `export default <expression>`, `export = <expression>`.
        const PROPERTY = 1 << 12;
        /// Something assigns to the variable after its declaration.
        const ASSIGNED = 1 << 13;
        const CONST = 1 << 14;
        const PARAMETER = 1 << 15;
        /// `mergedSymbols` has it, or it is transient: see `Files::canonical`.
        const MERGED = 1 << 16;
        const TYPE_ONLY = 1 << 17;
        /// A name others import by, which nothing in the file can refer to: `export { a as b }`, `export default e`.
        const EXPORT_ONLY = 1 << 18;
        /// Together with `ENUM`: a `const enum`, which is one symbol with other `const enum`s alone.
        const CONST_ENUM = 1 << 19;
        /// `module` and `exports` in a CommonJS module.
        const MODULE_EXPORTS = 1 << 20;
        /// `SymbolFlagsTransient`: made by `cloneSymbol`, not by the binder.
        const TRANSIENT = 1 << 21;
        /// `SymbolFlagsExportValue`: the local symbol of an exported value (`declareModuleMember`). It is no value itself.
        const EXPORT_VALUE = 1 << 22;
        /// `SymbolFlagsAssignment`: what `bindDeferredExpandoAssignment` declares.
        const ASSIGNMENT = 1 << 23;

        const VARIABLE = Self::FUNCTION_SCOPED_VARIABLE.bits() | Self::BLOCK_SCOPED_VARIABLE.bits();
        const VALUE = Self::VARIABLE.bits() | Self::FUNCTION.bits() | Self::CLASS.bits() | Self::ENUM.bits()
            | Self::VALUE_MODULE.bits() | Self::ENUM_MEMBER.bits() | Self::PROPERTY.bits();
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
    /// `f.a = e`, `f["a"] = e` next to `function f() {}`, which may be written `a.f`: the assignment. In JavaScript next to a class
    /// too, and `Object.defineProperty(f, "a", descriptor)`: the call.
    Expando(ExprId),
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
    /// In the order they are bound. Those that what has the name refuses (`declareSymbolEx`) are listed too, for what is said of
    /// duplicates: they add nothing to `flags`, and each is the one declaration of a symbol of its own that is in no table.
    pub decls: Decls,
    /// The module, namespace or enum it is a member of.
    pub parent: SymbolId,
    /// What a module, namespace or enum exports.
    pub exports: TableId,
    /// `ExportSymbol`, of the local symbol of what a module or a namespace exports.
    pub export_symbol: SymbolId,
}

/// The declarations of a symbol. Nearly every symbol has one, which needs no block of its own.
pub enum Decls {
    One(Decl),
    Many(Box<[Decl]>),
}

impl Decls {
    #[inline]
    pub fn as_slice(&self) -> &[Decl] {
        match self {
            Decls::One(decl) => std::slice::from_ref(decl),
            Decls::Many(decls) => &decls[..],
        }
    }

    fn push(&mut self, decl: Decl) {
        let mut all = Vec::with_capacity(self.len() + 1);
        all.extend_from_slice(self.as_slice());
        all.push(decl);
        *self = Decls::Many(all.into_boxed_slice());
    }

    fn retain(&mut self, keep: impl FnMut(&Decl) -> bool) {
        let mut all = self.to_vec();
        all.retain(keep);
        let only = if let [decl] = all[..] {
            Some(decl)
        } else {
            None
        };
        *self = match only {
            Some(decl) => Decls::One(decl),
            None => Decls::Many(all.into_boxed_slice()),
        };
    }
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

/// What `declareSymbolEx` enters in `symbol.Members` or `symbol.Exports` of a class or an interface, or in `symbol.Members` of a type
/// literal, an object literal or the attributes of a JSX element.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum MemberDeclaration {
    /// Of a class or an interface: it is in `symbol.Members`, next to the properties.
    TypeParameter(TypeParamId),
    /// A property, a method or an accessor.
    Member(MemberId),
    /// `IsParameterPropertyDeclaration`
    Parameter(ParamId),
    /// `this.name = value` in a member of a class, in JavaScript: the assignment.
    Assignment(ExprId),
    /// A member of an object literal or an attribute of a JSX element.
    Property(PropId),
}

/// `SymbolFlags`, as far as the symbols of members have them.
pub mod member_flags {
    pub const PROPERTY: u8 = 1;
    pub const METHOD: u8 = 2;
    pub const GET_ACCESSOR: u8 = 4;
    pub const SET_ACCESSOR: u8 = 8;
    pub const ACCESSOR: u8 = GET_ACCESSOR | SET_ACCESSOR;
    pub const VALUE: u8 = PROPERTY | METHOD | ACCESSOR;
    pub const TYPE_PARAMETER: u8 = 16;
    pub const REPLACEABLE_BY_METHOD: u8 = 32;
    pub const PROPERTY_EXCLUDES: u8 = VALUE & !(PROPERTY | ACCESSOR);
    pub const METHOD_EXCLUDES: u8 = VALUE & !METHOD;
    pub const GET_ACCESSOR_EXCLUDES: u8 = VALUE & !(SET_ACCESSOR | PROPERTY);
    pub const SET_ACCESSOR_EXCLUDES: u8 = VALUE & !(GET_ACCESSOR | PROPERTY);
    pub const ACCESSOR_EXCLUDES: u8 = VALUE & !PROPERTY;

    /// `getExcludedSymbolFlags`
    pub fn excluded(flags: u8) -> u8 {
        [
            (PROPERTY, PROPERTY_EXCLUDES),
            (METHOD, METHOD_EXCLUDES),
            (GET_ACCESSOR, GET_ACCESSOR_EXCLUDES),
            (SET_ACCESSOR, SET_ACCESSOR_EXCLUDES),
        ]
        .iter()
        .filter(|kind| flags & kind.0 != 0)
        .fold(0, |excluded, kind| excluded | kind.1)
    }
}

/// The name a member is declared under, and in which table of its container.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct MemberKey {
    pub name: Atom,
    /// `GetSymbolNameForPrivateIdentifier`: `#a` is not `"#a"`.
    pub is_private: bool,
    /// `symbol.Exports`, not `symbol.Members`.
    pub is_static: bool,
}

/// A call of `declareSymbolEx`: the name, the node, `includes` and `excludes`. No node: `prototype`, which
/// `bindClassLikeDeclaration` makes without a declaration.
pub type DeclaredMember = (MemberKey, Option<MemberDeclaration>, u8, u8);

/// `includes` and `excludes` of a member of an object literal or an attribute of a JSX element.
pub fn flags_of_property(kind: PropKind) -> Option<(u8, u8)> {
    use member_flags::*;
    Some(match kind {
        PropKind::Init | PropKind::Shorthand => (PROPERTY, PROPERTY_EXCLUDES),
        // `IsObjectLiteralMethod`
        PropKind::Method => (METHOD, VALUE),
        PropKind::Getter => (GET_ACCESSOR, GET_ACCESSOR_EXCLUDES),
        PropKind::Setter => (SET_ACCESSOR, SET_ACCESSOR_EXCLUDES),
        PropKind::Spread => return None,
    })
}

/// `bindPropertyWorker`, `bindPropertyOrMethodOrAccessor`: `includes` and `excludes` of a property, a method or an accessor of a
/// class, an interface or a type literal.
pub fn flags_of_member(member: &Member) -> Option<(u8, u8)> {
    use member_flags::*;
    Some(match member.kind {
        MemberKind::Property if member.flags.contains(Flags::ACCESSOR) => {
            (ACCESSOR, ACCESSOR_EXCLUDES)
        }
        MemberKind::Property => (PROPERTY, PROPERTY_EXCLUDES),
        MemberKind::Method => (METHOD, METHOD_EXCLUDES),
        MemberKind::Getter => (GET_ACCESSOR, GET_ACCESSOR_EXCLUDES),
        MemberKind::Setter => (SET_ACCESSOR, SET_ACCESSOR_EXCLUDES),
        _ => return None,
    })
}

/// `bindPropertyOrMethodOrAccessor`: what the members `props` of an object literal, or the attributes of a JSX element, declare.
/// `HasDynamicName`: a computed name is in no table (`bindAnonymousDeclaration`).
pub fn for_each_declared_property(
    f: &File,
    props: Span<PropId>,
    mut declare: impl FnMut(DeclaredMember),
) {
    for p in props.iter() {
        let PropKey::Name(name) = f[p].key else {
            continue;
        };
        let Some((includes, excludes)) = flags_of_property(f[p].kind) else {
            continue;
        };
        let key = MemberKey {
            name,
            is_private: false,
            is_static: false,
        };
        declare((
            key,
            Some(MemberDeclaration::Property(p)),
            includes,
            excludes,
        ));
    }
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
    /// Each table is a run of `entries`, sorted by name.
    pub tables: Vec<(u32, u32)>,
    pub entries: Vec<(Atom, SymbolId)>,
    pub ids: Vec<u32>,

    /// The file as a module. Its exports are what other files can import.
    pub file_symbol: SymbolId,
    /// `exportStars.Declarations`: every `export * from spec`, with the module or namespace symbol that says so.
    pub export_stars: Few<(SymbolId, StmtId)>,
    /// `declare module "name"` at the top of a file, or right in an ambient module at the top of a script.
    pub ambient_modules: Few<(Atom, SymbolId)>,
    /// `declare global { }` at the top of a module, or right in an ambient module at the top of a script: symbols whose exports are
    /// global.
    pub global_augmentations: Few<SymbolId>,
    pub redeclarations: Few<Redeclaration>,
    /// `declareSymbolEx`: the declarations that the symbol they are listed with refused. Each has a symbol of its own.
    pub refused_declarations: Few<(SymbolId, Decl)>,
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
    /// `this.name = value` and `this["name"] = value` in the members of a class, in JavaScript, where it declares the property: the
    /// class, whether it is the static side, the name, the assignment. Sorted.
    pub this_properties: Few<(ClassId, bool, Atom, ExprId)>,
    /// `CommonJSModuleIndicator`: what shows that the file is a CommonJS module.
    pub commonjs_indicator: Option<ExprId>,

    /// What an identifier means as a value. `NONE`: nothing in this file declares it. Of a `Decl::Expando`: `node.Symbol`.
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
    /// `symbol.Declarations` of the symbols of members that have more than one declaration, one symbol after the other. See
    /// `declarations_of_member`.
    pub member_declarations: Few<MemberDeclaration>,
    /// By each of those declarations: the run of `member_declarations` that is its symbol. An empty run: it has no symbol.
    pub member_symbol: FxHashMap<MemberDeclaration, (u32, u32)>,
    /// The declarations whose symbol is in no table though they have a name: what the symbol of that name excludes, and the
    /// assignments of JavaScript that a method replaces. Sorted.
    pub members_in_no_table: Few<MemberDeclaration>,
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
    /// `getModuleInstanceState(..) != NonInstantiated`, by `ModuleId`.
    pub module_instantiated: Few<bool>,
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
    /// `f.name = value` and `f["name"] = value` next to `const f = function () {}` or `const f = () => {}`: properties of `f`. By
    /// the function, then by name. The last field is the declaration: the assignment or, in JavaScript, the call
    /// `Object.defineProperty(f, "name", descriptor)`. Next to `function f() {}` it is a `Decl::Expando`.
    pub fn_expr_expandos: Few<(FnId, Atom, ExprId)>,
    /// `f[0] = value`, `f[key] = value`: the same under a numeric or late-bound key, which the checker names.
    /// (function, key, declaration), by function, then by declaration.
    pub declared_fn_keyed_expandos: Few<(SymbolId, ExprId, ExprId)>,
    pub fn_expr_keyed_expandos: Few<(FnId, ExprId, ExprId)>,
    /// `o.name = value`, `o["name"] = value`: properties of the empty object literal that initializes `o`, in JavaScript. By the
    /// literal, then by name.
    pub object_expandos: Few<(ExprId, Atom, ExprId)>,
    /// `o[0] = value`: a property of such a literal under a numeric key, which the checker names. A late-bound key declares
    /// nothing there. (literal, key, declaration), by literal, then by declaration.
    pub object_keyed_expandos: Few<(ExprId, ExprId, ExprId)>,
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
    /// `checkUnmatchedJSDocParameters`: the `@param` tags that match no parameter, as start and code.
    pub jsdoc_param_errors: Few<(u32, u32)>,

    pub flow: Vec<Flow>,
    pub flow_edges: Vec<FlowId>,
    /// How many places in the flow of control the binder came to. `flow` leaves out the labels nothing comes after, and has one start for
    /// all the functions without a body.
    pub flow_places: u32,
}

pub const UNREACHABLE: FlowId = FlowId(0);

impl Bound {
    /// `symbol.Declarations` of the symbol of `p`, a member of an object literal or a JSX attribute.
    pub fn declarations_of_literal_member(&self, p: PropId) -> SmallVec<[PropId; 2]> {
        self.declarations_of_member(&MemberDeclaration::Property(p))
            .iter()
            .filter_map(|declaration| match *declaration {
                MemberDeclaration::Property(p) => Some(p),
                _ => None,
            })
            .collect()
    }

    /// `symbol.Declarations` of `declaration.Symbol`, in this file. None: a `this.name = value` that declares nothing, because a
    /// member of the class declares `name`.
    pub fn declarations_of_member<'a>(
        &'a self,
        declaration: &'a MemberDeclaration,
    ) -> &'a [MemberDeclaration] {
        match self.member_symbol.get(declaration) {
            Some(&(start, len)) => &self.member_declarations[start as usize..][..len as usize],
            None => std::slice::from_ref(declaration),
        }
    }

    /// Whether `declaration`, which has a name, has a symbol that is not the one its container has under that name.
    pub fn is_member_in_no_table(&self, declaration: MemberDeclaration) -> bool {
        self.members_in_no_table.binary_search(&declaration).is_ok()
    }

    /// What is declared in the tables of a class, an interface or a type literal while its declaration `owner` is bound, in that
    /// order. `HasDynamicName`: a computed name is in no table (`bindAnonymousDeclaration`). Call, construct and index signatures
    /// and constructors exclude nothing and nothing excludes them.
    pub fn for_each_declared_member(
        &self,
        f: &File,
        owner: MemberOwner,
        mut declare: impl FnMut(DeclaredMember),
    ) {
        use member_flags::*;
        let (type_params, members, class) = match owner {
            MemberOwner::Class(class) => (f[class].type_params, f[class].members, Some(class)),
            MemberOwner::Interface(interface) => {
                (f[interface].type_params, f[interface].members, None)
            }
            MemberOwner::TypeLiteral(node) => match f[node].kind {
                TypeNodeKind::Object(members) => (Span::EMPTY, members, None),
                _ => return,
            },
            MemberOwner::None => return,
        };
        let key = |name: Atom, is_static: bool| MemberKey {
            name,
            is_private: false,
            is_static,
        };
        // `bindClassLikeDeclaration`
        if class.is_some() {
            declare((key(known::prototype, true), None, PROPERTY, 0));
        }
        // `bindTypeParameter`. `SymbolFlagsTypeParameterExcludes` has nothing a member is.
        for parameter in type_params.iter() {
            let declaration = MemberDeclaration::TypeParameter(parameter);
            declare((
                key(f[parameter].name, false),
                Some(declaration),
                TYPE_PARAMETER,
                0,
            ));
        }
        // `bindThisPropertyAssignment`: where each is written.
        let mut assignments: SmallVec<[(u32, bool, Atom, ExprId); 8]> = SmallVec::new();
        if let Some(class) = class
            && !self.this_properties.is_empty()
        {
            for is_static in [false, true] {
                for &(_, _, name, e) in self.this_properties_of(class, is_static) {
                    assignments.push((f[e].pos, is_static, name, e));
                }
            }
            assignments.sort_unstable();
        }
        let mut assignments = assignments.into_iter().peekable();
        let mut declare_assignments_before = |pos: u32, declare: &mut dyn FnMut(DeclaredMember)| {
            while let Some((_, is_static, name, e)) = assignments.next_if(|next| next.0 < pos) {
                let declaration = MemberDeclaration::Assignment(e);
                let includes = PROPERTY | REPLACEABLE_BY_METHOD;
                declare((key(name, is_static), Some(declaration), includes, 0));
            }
        };
        for m in members.iter() {
            let member = &f[m];
            declare_assignments_before(member.pos, &mut declare);
            // `bindParameter`
            if member.kind == MemberKind::Constructor && class.is_some() && member.func.is_some() {
                for parameter in f[member.func].params.iter() {
                    if f[parameter].flags.contains(Flags::PARAMETER_PROPERTY)
                        && let PatKind::Ident(name) = f[f[parameter].pat].kind
                    {
                        let declaration = MemberDeclaration::Parameter(parameter);
                        declare((
                            key(name, false),
                            Some(declaration),
                            PROPERTY,
                            PROPERTY_EXCLUDES,
                        ));
                    }
                }
                continue;
            }
            let (name, is_private) = match member.key {
                PropKey::Name(name) => (name, false),
                PropKey::Private(name) => (name, true),
                PropKey::Computed(_) | PropKey::None => continue,
            };
            let Some((includes, excludes)) = flags_of_member(member) else {
                continue;
            };
            let key = MemberKey {
                name,
                is_private,
                // `declareClassMember`: only a class has a static side.
                is_static: class.is_some() && member.flags.contains(Flags::STATIC),
            };
            declare((key, Some(MemberDeclaration::Member(m)), includes, excludes));
        }
        declare_assignments_before(u32::MAX, &mut declare);
    }

    /// `GetAssignmentTarget`: what gives `e` a value, if `e` is what it is given to or part of a pattern that is.
    pub fn get_assignment_target(&self, hir: &File, mut e: ExprId) -> Option<AssignmentTarget> {
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
                    ExprKind::Array(_) | ExprKind::Spread(_) | ExprKind::NonNull(_) => e = parent,
                    _ => return None,
                },
                // The value of `name: value` and of `...value`, and the assignment `{ name = value }` is kept as.
                Parent::Prop(p) => {
                    let owner = self.prop_owner[p.idx()];
                    if owner.is_none()
                        || !matches!(hir[owner].kind, ExprKind::Object(_))
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

    /// `bindThisPropertyAssignment`: the class, whether it is the static side, and the name of the property that `e` declares, if `e`
    /// is `this.name = value` or `this["name"] = value` in a member of a class, in JavaScript. `this_properties` has all of them.
    pub fn this_property(&self, f: &File, e: ExprId) -> Option<(ClassId, bool, Atom)> {
        if !f.is_js || assignment_declaration_kind(f, e) != JsDeclarationKind::ThisProperty {
            return None;
        }
        let ExprKind::Assign { target, .. } = f[e].kind else {
            return None;
        };
        // `getDeclarationName`
        let name = match f[target].kind {
            ExprKind::Dot { name, name_pos, .. } if !is_private_name_at(f, name_pos) => name,
            ExprKind::Index { index, .. } => string_literal_text(f, index),
            _ => return None,
        };
        if name.is_none() {
            return None;
        }
        // `GetThisContainer`
        let mut parent = self.expr_parent[e.idx()];
        let member = loop {
            parent = match parent {
                Parent::Expr(x) if x.is_some() => self.expr_parent[x.idx()],
                Parent::Stmt(s) if s.is_some() => self.stmt_parent[s.idx()],
                Parent::VarInit(d) => Parent::Stmt(self.var_stmt[d.idx()]),
                Parent::Prop(p) => Parent::Expr(self.prop_owner[p.idx()]),
                Parent::Case(c) => Parent::Stmt(self.case_stmt[c.idx()]),
                Parent::FnBody(_) | Parent::ParamDefault(_) => {
                    let function = match parent {
                        Parent::FnBody(function) => function,
                        Parent::ParamDefault(p) => self.param_fn[p.idx()],
                        _ => unreachable!(),
                    };
                    match self.fns[function.idx()].owner {
                        FnOwner::Expr(owner) if f[function].kind == FnKind::Arrow => {
                            self.expr_parent[owner.idx()]
                        }
                        FnOwner::Member(m) => break m,
                        _ => return None,
                    }
                }
                Parent::MemberInit(m) => break m,
                _ => return None,
            };
        };
        let MemberOwner::Class(class) = self.member_owner[member.idx()] else {
            return None;
        };
        let is_static =
            f[member].flags.contains(Flags::STATIC) || f[member].kind == MemberKind::StaticBlock;
        Some((class, is_static, name))
    }

    /// `symbol.Declarations`
    pub fn declarations_of_symbol(&self, symbol: SymbolId) -> SmallVec<[Decl; 4]> {
        let listed = self.symbols[symbol.idx()].decls.iter().copied();
        listed
            .filter(|&decl| !self.refused_declarations.contains(&(symbol, decl)))
            .collect()
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

    /// Every `Decl::Expando` among the exports of `owner`: (owner, name, declaration), by name.
    pub fn expandos_among_exports(&self, owner: SymbolId) -> Vec<(SymbolId, Atom, ExprId)> {
        let mut all = Vec::new();
        for &(name, symbol) in self.table(self.symbols[owner.idx()].exports) {
            for &decl in &self.symbols[symbol.idx()].decls {
                if let Decl::Expando(e) = decl {
                    all.push((owner, name, e));
                }
            }
        }
        all
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
            Decl::Expando(it) => self.expr_symbol[it.idx()],
            _ => SymbolId::NONE,
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

pub fn bind(file: &File, options: BindOptions) -> Bound {
    binder::Binder::run(file, options, None)
}

/// The same, with the interner that spells the numeric names of CommonJS exports: `exports[0] = e`.
pub fn bind_with_atoms(file: &File, options: BindOptions, atoms: &Interner) -> Bound {
    binder::Binder::run(file, options, Some(atoms))
}

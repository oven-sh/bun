//! Everything that can be computed for a file in isolation: the declaration each name resolves to,
//! which node contains which, and the control flow. Runs right after the parser, on the same
//! thread.

mod binder;
mod lint;
mod parents;

pub use parents::{bind_for_format_in, try_bind_for_format_in};

use crate::atom::{Atom, known};
use crate::hir::*;
use crate::session::{Arena, ArenaHashMap, ArenaVec, transfer_arena, vec_from_iter_in};
use crate::util::{FxBuild, FxHashMap, SharedSort};
use smallvec::SmallVec;
use std::hint::cold_path;

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
        /// It's in `mergedSymbols` or it's transient. See `Files::canonical`.
        const MERGED = 1 << 16;
        /// A name that other files can import but nothing in this file can refer to:
        /// `export { a as b }`, `export default e`.
        const EXPORT_ONLY = 1 << 18;
        const CONST_ENUM = 1 << 19;
        /// `module` and `exports` in a CommonJS module.
        const MODULE_EXPORTS = 1 << 20;
        /// `SymbolFlagsTransient`: created by `cloneSymbol`, not by the binder.
        const TRANSIENT = 1 << 21;
        /// `SymbolFlagsExportValue`: the local symbol of an exported value (`declareModuleMember`).
        /// It isn't a value itself.
        const EXPORT_VALUE = 1 << 22;
        /// `SymbolFlagsAssignment`: declared by `bindDeferredExpandoAssignment`.
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

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
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
    /// The name in `const a = require("m")`, `const { a } = require("m")` or
    /// `const [a] = require("m")` in JavaScript.
    Require(PatId),
    /// The assignment `module.exports = e` in JavaScript.
    ModuleExports(ExprId),
    /// The assignment `exports.a = e` or `module.exports.a = e` in JavaScript, or the call
    /// `Object.defineProperty(exports, "a", descriptor)`.
    ExportsProperty(ExprId),
    /// The assignment `f.a = e`, `f["a"] = e` or `f[key] = e`, where `getInitializerSymbol` finds a
    /// symbol for `f`. `f` may have the form `a.f`. In JavaScript, also the call
    /// `Object.defineProperty(f, "a", descriptor)`.
    Expando(ExprId),
    /// `{}`, for the symbol that such assignments add to in JavaScript.
    ObjectLiteral(ExprId),
    /// `module` and `exports` in a CommonJS module.
    CommonJsVariable,
    /// A class, interface or type literal member.
    Member(MemberId),
    /// `IsParameterPropertyDeclaration`: the property.
    ParameterProperty(ParamId),
    /// The assignment `this.name = value` in a class member, or in an object literal's method or
    /// accessor, in JavaScript.
    ThisProperty(ExprId),
    /// An object literal member or a JSX attribute.
    Property(PropId),
    TypeLiteral(TypeNodeId),
}

impl Decl {
    /// `node.Members()` of a class or an interface, or `None` if it's neither.
    #[inline]
    pub fn members_of_class_or_interface(self, hir: &File) -> Option<Span<MemberId>> {
        match self {
            Decl::Class(c) => Some(hir[c].members),
            Decl::Interface(i) => Some(hir[i].members),
            _ => None,
        }
    }

    /// `node.TypeParameters()` of a class or an interface, or `None` if it's neither.
    #[inline]
    pub fn type_params_of_class_or_interface(self, hir: &File) -> Option<Span<TypeParamId>> {
        match self {
            Decl::Class(c) => Some(hir[c].type_params),
            Decl::Interface(i) => Some(hir[i].type_params),
            _ => None,
        }
    }

    /// The position of a class's or an interface's name, or `None` if it's neither.
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
    /// `module.exports = e`, except `module.exports = exports`
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
pub(crate) fn string_literal_text(hir: &File, e: ExprId) -> Atom {
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
    !is_parenthesized(hir, e) && is_module_exports_inside_parentheses(hir, e)
}

/// Same, but ignores the parentheses around `e`.
pub fn is_module_exports_inside_parentheses(hir: &File, e: ExprId) -> bool {
    let (obj, name) = match hir[e].kind {
        ExprKind::Dot { obj, name, .. } => (obj, name),
        ExprKind::Index { obj, index, .. } => (obj, string_literal_text(hir, index)),
        _ => return false,
    };
    name == known::exports
        && matches!(hir[obj].kind, ExprKind::Ident(known::module))
        && !is_parenthesized(hir, obj)
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
        ExprKind::Dot { obj, name, .. } => (
            obj,
            (!is_private_name_at(hir, hir.name_pos(target))).then_some(name),
        ),
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
            ExprKind::Dot { obj, .. } => {
                !is_private_name_at(hir, hir.name_pos(e)) && is_bindable_static_name(hir, obj)
            }
            ExprKind::Index { obj, index, .. } => {
                is_string_or_numeric_literal_like(hir, index) && is_bindable_static_name(hir, obj)
            }
            _ => false,
        }
}

/// `IsBindableObjectDefinePropertyCall`: returns the object and the key of
/// `Object.defineProperty(object, key, descriptor)`. The key is a string, a template without
/// substitutions or a number. Optional chaining doesn't matter.
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

/// `IsRequireCall`: returns the argument if `e` is `require(x)`.
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

/// Same with `requireStringLiteralLikeArgument`: returns the argument of `require("m")` and its
/// text.
pub fn require_call_argument(hir: &File, e: ExprId) -> Option<(ExprId, Atom)> {
    let argument = require_argument(hir, e)?;
    is_string_literal_like(hir, argument).then(|| (argument, string_literal_text(hir, argument)))
}

/// Returns only the text.
pub fn required_specifier(hir: &File, e: ExprId) -> Option<Atom> {
    Some(require_call_argument(hir, e)?.1)
}

/// Read-only view of one symbol of a file.
#[derive(Copy, Clone)]
pub struct Symbol<'a> {
    pub name: Atom,
    pub flags: SymFlags,
    /// `Declarations`, in the order they are bound.
    pub decls: &'a [Decl],
    /// `ValueDeclaration`, as an index into `Declarations`. For a symbol merged by `mergeSymbol`,
    /// those are the declarations of all its parts. `u32::MAX` means none.
    pub value_declaration: u32,
    /// `Parent`, as `declareSymbolEx` sets it: the module, namespace or enum whose exports declare
    /// it, even if the declaration conflicts there. `NONE` for a local.
    pub parent: SymbolId,
    /// The exports of a module, namespace or enum, and the static side of a class.
    pub exports: TableId,
    pub members: TableId,
    /// `ExportSymbol`, for the local symbol of an export of a module or a namespace.
    pub export_symbol: SymbolId,
}

/// A symbol while the binder is still adding to it.
pub struct GrowingSymbol {
    pub name: Atom,
    pub flags: SymFlags,
    pub decls: GrowingDecls,
    pub value_declaration: u32,
    pub parent: SymbolId,
    pub exports: TableId,
    pub members: TableId,
    pub export_symbol: SymbolId,
}

/// A symbol's declarations. Almost every symbol has exactly one, so that case is stored inline.
#[derive(Default)]
pub enum GrowingDecls {
    #[default]
    None,
    One(Decl),
    Many(Vec<Decl>),
}

impl GrowingDecls {
    fn push(&mut self, decl: Decl) {
        match self {
            GrowingDecls::None => *self = GrowingDecls::One(decl),
            GrowingDecls::One(first) => *self = GrowingDecls::Many(vec![*first, decl]),
            GrowingDecls::Many(all) => all.push(decl),
        }
    }
}

impl std::ops::Deref for GrowingDecls {
    type Target = [Decl];
    #[inline]
    fn deref(&self) -> &[Decl] {
        match self {
            GrowingDecls::None => &[],
            GrowingDecls::One(decl) => std::slice::from_ref(decl),
            GrowingDecls::Many(decls) => &decls[..],
        }
    }
}

/// Read access to a file's symbols in either storage. See [`Storage::Symbols`].
pub trait SymbolList {
    fn get(&self, index: usize) -> Option<Symbol<'_>>;
}

impl SymbolList for Vec<GrowingSymbol> {
    #[inline]
    fn get(&self, index: usize) -> Option<Symbol<'_>> {
        self[..].get(index).map(GrowingSymbol::get)
    }
}

impl GrowingSymbol {
    #[inline]
    fn get(&self) -> Symbol<'_> {
        Symbol {
            name: self.name,
            flags: self.flags,
            decls: &self.decls,
            value_declaration: self.value_declaration,
            parent: self.parent,
            exports: self.exports,
            members: self.members,
            export_symbol: self.export_symbol,
        }
    }
}

/// The fields every symbol needs. The rarely set ones are in [`RestOfSymbol`].
#[derive(Copy, Clone)]
struct StoredSymbol {
    name: Atom,
    flags: SymFlags,
    decls: StoredDecls,
    parent: SymbolId,
    /// Index into `Symbols::rest`, or `FIRST_IS_VALUE` / `NO_VALUE` if the symbol has no entry there.
    rest: u32,
}

/// `StoredSymbol::rest` for a symbol with no tables and no `export_symbol` whose `value_declaration` is 0.
const FIRST_IS_VALUE: u32 = u32::MAX;
/// Like `FIRST_IS_VALUE`, but the symbol has no `value_declaration`.
const NO_VALUE: u32 = u32::MAX - 1;

#[derive(Copy, Clone)]
enum StoredDecls {
    None,
    One(Decl),
    /// Index into `Symbols::many`.
    Many(u32),
}

const _: () = assert!(size_of::<StoredSymbol>() == 24);

/// Fields that most symbols leave at their defaults.
#[derive(Copy, Clone)]
struct RestOfSymbol {
    value_declaration: u32,
    exports: TableId,
    members: TableId,
    export_symbol: SymbolId,
}

/// A loaded file's symbols, stored compactly. Merging and linking append transient symbols.
pub struct Symbols<'s> {
    list: ArenaVec<'s, StoredSymbol>,
    rest: ArenaVec<'s, RestOfSymbol>,
    many: ArenaVec<'s, &'s [Decl]>,
}

impl SymbolList for Symbols<'_> {
    #[inline]
    fn get(&self, index: usize) -> Option<Symbol<'_>> {
        self.get(index)
    }
}

impl<'s> Symbols<'s> {
    #[inline]
    pub fn len(&self) -> usize {
        self.list.len()
    }

    /// Returns the symbol at `index`. Only the first lookup can fail and nothing here can panic, so once this is inlined
    /// the compiler drops the work for fields the caller never reads.
    #[inline]
    pub fn get(&self, index: usize) -> Option<Symbol<'_>> {
        Some(self.decode(self.list.get(index)?))
    }

    #[inline]
    fn decode<'a>(&'a self, symbol: &'a StoredSymbol) -> Symbol<'a> {
        // `FIRST_IS_VALUE` and `NO_VALUE` are always out of range, so they fall back to the defaults.
        let rest = match self.rest.get(symbol.rest as usize) {
            // Only a symbol with a table, an export symbol or a later value declaration has one.
            Some(&rest) => {
                cold_path();
                rest
            }
            None => RestOfSymbol {
                value_declaration: if symbol.rest == NO_VALUE { u32::MAX } else { 0 },
                exports: TableId::NONE,
                members: TableId::NONE,
                export_symbol: SymbolId::NONE,
            },
        };
        Symbol {
            name: symbol.name,
            flags: symbol.flags,
            decls: match &symbol.decls {
                StoredDecls::None => &[],
                StoredDecls::One(decl) => std::slice::from_ref(decl),
                StoredDecls::Many(at) => self.many.get(*at as usize).copied().unwrap_or_default(),
            },
            value_declaration: rest.value_declaration,
            parent: symbol.parent,
            exports: rest.exports,
            members: rest.members,
            export_symbol: rest.export_symbol,
        }
    }

    /// Converts the binder's symbols. Each list is allocated at its exact final size, with space for the symbol that
    /// the merge adds for each `import * as ns`. Without that space the merge, which is single-threaded, would have to
    /// copy the lists.
    fn of(symbols: &[GrowingSymbol], arena: &'s Arena) -> Symbols<'s> {
        let is_plain = |it: &&GrowingSymbol| {
            it.exports.is_none()
                && it.members.is_none()
                && it.export_symbol.is_none()
                && matches!(it.value_declaration, 0 | u32::MAX)
        };
        let plain = symbols.iter().filter(is_plain).count();
        let many = symbols.iter().filter(|it| it.decls.len() > 1).count();
        let is_namespace = |decl: &Decl| matches!(decl, Decl::ImportNamespace(_));
        let namespaces = symbols
            .iter()
            .filter(|it| it.decls.iter().any(is_namespace));
        let namespaces = namespaces.count();
        let mut all = Symbols {
            list: ArenaVec::new_in(arena),
            rest: ArenaVec::new_in(arena),
            many: ArenaVec::new_in(arena),
        };
        all.list.reserve_exact(symbols.len() + namespaces);
        all.rest.reserve_exact(symbols.len() - plain + namespaces);
        all.many.reserve_exact(many);
        for symbol in symbols {
            all.push(symbol.get(), arena);
        }
        all
    }

    pub fn iter(&self) -> impl ExactSizeIterator<Item = Symbol<'_>> {
        (0..self.list.len()).map(|at| self.at(at))
    }

    /// Returns the symbols that have all of `flags`. It tests the stored flags before decoding, so skipping a symbol
    /// costs three instructions. `iter().filter(..)` decodes every symbol first, which costs about seventeen.
    pub fn with_flags(&self, flags: SymFlags) -> impl Iterator<Item = Symbol<'_>> {
        let matching = self.list.iter().filter(move |it| it.flags.contains(flags));
        matching.map(|it| self.decode(it))
    }

    #[inline]
    fn at(&self, index: usize) -> Symbol<'_> {
        self.get(index).expect("the symbol belongs to this file")
    }

    pub fn reserve_exact(&mut self, additional: usize) {
        self.list.reserve_exact(additional);
    }

    /// Appends `symbol`. Two or more declarations are copied into `arena`.
    pub fn push(&mut self, symbol: Symbol<'_>, arena: &'s Arena) {
        let decls = match *symbol.decls {
            [] => StoredDecls::None,
            [decl] => StoredDecls::One(decl),
            ref all => {
                self.many.push(arena.alloc_slice_copy(all));
                StoredDecls::Many(self.many.len() as u32 - 1)
            }
        };
        self.list.push(StoredSymbol {
            name: symbol.name,
            flags: symbol.flags,
            decls,
            parent: symbol.parent,
            rest: NO_VALUE,
        });
        self.set_rest(
            self.list.len() - 1,
            RestOfSymbol {
                value_declaration: symbol.value_declaration,
                exports: symbol.exports,
                members: symbol.members,
                export_symbol: symbol.export_symbol,
            },
        );
    }

    fn set_rest(&mut self, index: usize, rest: RestOfSymbol) {
        let slot = &mut self.list[index].rest;
        let is_plain =
            rest.exports.is_none() && rest.members.is_none() && rest.export_symbol.is_none();
        match (*slot, rest.value_declaration) {
            (FIRST_IS_VALUE | NO_VALUE, 0) if is_plain => *slot = FIRST_IS_VALUE,
            (FIRST_IS_VALUE | NO_VALUE, u32::MAX) if is_plain => *slot = NO_VALUE,
            (FIRST_IS_VALUE | NO_VALUE, _) => {
                *slot = self.rest.len() as u32;
                self.rest.push(rest);
            }
            (at, _) => self.rest[at as usize] = rest,
        }
    }

    #[inline]
    pub fn flags_mut(&mut self, id: SymbolId) -> &mut SymFlags {
        &mut self.list[id.idx()].flags
    }

    pub fn set_parent(&mut self, id: SymbolId, parent: SymbolId) {
        self.list[id.idx()].parent = parent;
    }

    pub fn set_value_declaration(&mut self, id: SymbolId, value_declaration: u32) {
        let symbol = self.at(id.idx());
        let rest = RestOfSymbol {
            value_declaration,
            exports: symbol.exports,
            members: symbol.members,
            export_symbol: symbol.export_symbol,
        };
        self.set_rest(id.idx(), rest);
    }

    /// Moves the lists to `arena` so that the thread that owns it can append to them.
    pub fn transfer_to(&mut self, arena: &'s Arena) {
        transfer_arena(&mut self.list, arena);
        transfer_arena(&mut self.rest, arena);
        transfer_arena(&mut self.many, arena);
    }

    /// Copies the lists into `arena`, for a program that shares the file with other programs.
    fn copy_in<'a>(&'a self, arena: &'a Arena) -> Symbols<'a> {
        Symbols {
            list: vec_from_iter_in(self.list.iter().copied(), arena),
            rest: vec_from_iter_in(self.rest.iter().copied(), arena),
            many: vec_from_iter_in(self.many.iter().copied(), arena),
        }
    }
}

/// `SetValueDeclaration`: returns true if `node` replaces `value_declaration`. "Non-assignment
/// declarations take precedence over assignment declarations and non-namespace declarations take
/// precedence over namespace declarations."
pub fn replaces_value_declaration(value_declaration: Option<Decl>, node: Decl) -> bool {
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
    /// Encloses the constraints and defaults of a function's type parameters. It declares nothing.
    /// It's nested in the function's scope and only identifies which part of the function contains
    /// a name. See `Bound::is_visible_from`.
    TypeParamList(FnId),
    /// Same for the parameters: their types, patterns and defaults. Only a function with a block
    /// body has one.
    Param(FnId),
    /// Same for the return type.
    ReturnType(FnId),
    /// Encloses a conditional type's `extends` type. It declares nothing. The `infer` type
    /// parameters are declared in the parent scope, which also encloses the true branch, and can't
    /// be referenced from here. See `Bound::is_visible_from`.
    Extends,
    /// Encloses the constraint of an `infer T extends ..`. It declares `T` again, which can be
    /// referenced from here.
    InferConstraint,
    /// Encloses a static class member, including its decorators but not a computed name. It
    /// declares nothing. It's nested in the class's scope, whose type parameters can't be
    /// referenced from here. See `Bound::type_parameter_out_of_reach`.
    StaticMember,
    /// Same for the computed name of a class or interface member.
    ComputedName,
    /// Same for a class's `extends` expression, without its type arguments.
    BaseExpression,
    /// Encloses the computed name of a method or an accessor, which is a child of that function. It
    /// declares nothing. From here, `arguments` is that function's.
    FunctionName(FnId),
    /// Encloses the computed name and the initializer of a non-static class property, if class
    /// fields aren't emitted unchanged and the class has a constructor with a body. That
    /// constructor is stored here. It declares nothing. Neither the constructor's declarations nor
    /// the names they shadow can be referenced from here. See
    /// `Bound::property_with_invalid_initializer`.
    PropertyDeclaration(MemberId, FnId),
    /// Same for the property's type.
    PropertyType(MemberId, FnId),
}

#[derive(Copy, Clone, Debug)]
pub struct Scope {
    pub parent: ScopeId,
    pub kind: ScopeKind,
    pub locals: TableId,
    /// A module's, namespace's or enum's symbol, whose exports are in scope wherever they were
    /// declared.
    pub symbol: SymbolId,
    /// `NodeFlagsExportContext`
    pub is_export_context: bool,
}

/// The result of `GetAssignmentTarget`.
#[derive(Copy, Clone)]
pub enum AssignmentTarget {
    /// The left side of `=`, or of a compound assignment operator.
    Assign(Option<BinOp>),
    /// The operand of `++` or `--`.
    Unary,
    /// The target that the head of a `for`-`in` or `for`-`of` assigns to.
    ForInOrOf,
}

/// `ModuleInstanceState`, in the same order, because comparisons use the numeric value.
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

/// Declares an enum whose variants carry one id or nothing, plus a 32-bit packed form of it. The first variant packs to 0.
///
/// The tag uses 5 bits and the id 27. That's enough because a file has fewer than 2^26 nodes (`File::node_bases`).
/// `NONE` survives the round trip.
macro_rules! packed {
    (
        $(#[$doc:meta])* $name:ident, $(#[$packed_doc:meta])* $packed:ident {
            $none:ident,
            $($(#[$unit_doc:meta])* $unit:ident,)*
            ;
            $($(#[$variant_doc:meta])* $variant:ident($id:ident),)*
        }
    ) => {
        $(#[$doc])*
        #[derive(Copy, Clone, PartialEq, Eq, Debug)]
        pub enum $name {
            $none,
            $($(#[$unit_doc])* $unit,)*
            $($(#[$variant_doc])* $variant($id),)*
        }

        $(#[$packed_doc])*
        #[derive(Copy, Clone, PartialEq, Eq, Default)]
        pub struct $packed(u32);

        const _: () = {
            #[repr(u32)]
            enum Tag { $none, $($unit,)* $($variant,)* }
            const TAG_BITS: u32 = 5;
            const _: () = assert!([Tag::$none, $(Tag::$unit,)* $(Tag::$variant,)*].len() <= 1 << TAG_BITS);

            impl From<$name> for $packed {
                #[inline]
                fn from(it: $name) -> $packed {
                    match it {
                        $name::$none => $packed(Tag::$none as u32),
                        $($name::$unit => $packed(Tag::$unit as u32),)*
                        $($name::$variant(id) => $packed(id.0 << TAG_BITS | Tag::$variant as u32),)*
                    }
                }
            }

            impl $packed {
                #[inline]
                pub fn get(self) -> $name {
                    let tag = self.0 & ((1 << TAG_BITS) - 1);
                    // The arithmetic shift sign-extends, so a packed `NONE` unpacks to `u32::MAX`.
                    let id = (self.0.cast_signed() >> TAG_BITS).cast_unsigned();
                    $(if tag == Tag::$variant as u32 {
                        return $name::$variant($id(id));
                    })*
                    $(if tag == Tag::$unit as u32 {
                        return $name::$unit;
                    })*
                    $name::$none
                }
            }
        };
    };
}

packed! {
    /// The direct parent of an expression or a statement.
    Parent,
    /// A `Parent` packed into 32 bits, which is how the lists store it.
    PackedParent {
        None,
        File,
        ;
        Expr(ExprId),
        Stmt(StmtId),
        VarInit(VarDeclId),
        ParamDefault(ParamId),
        PatPropDefault(PatPropId),
        PatElemDefault(PatElemId),
        /// The value of an object literal property or a JSX attribute.
        Prop(PropId),
        /// The computed name of an object literal property that isn't a method or an accessor.
        PropKey(PropId),
        /// The computed name of a binding element.
        PatKey(PatPropId),
        /// The computed name of a class, interface or type literal member. Control flow treats it as
        /// part of the member.
        MemberKey(MemberId),
        /// The computed name of an object literal method or accessor. Control flow treats it as part of
        /// the method.
        MethodKey(PropId),
        /// A member's initializer. Also the operand of a `typeof` in a class property's type or initializer, unless a
        /// function is in between.
        MemberInit(MemberId),
        /// An arrow function's expression body, or a statement in a function body.
        FnBody(FnId),
        EnumInit(EnumMemberId),
        Case(CaseId),
        ClassExtends(ClassId),
        /// A class decorator. This and the next two are evaluated at the class's position.
        ClassDecorator(ClassId),
        /// A class member's decorator.
        MemberDecorator(MemberId),
        /// A decorator on a parameter of a class member.
        ParamDecorator(ParamId),
        Module(ModuleId),
    }
}

impl From<DecoratorOwner> for Parent {
    #[inline]
    fn from(decorated: DecoratorOwner) -> Parent {
        match decorated {
            DecoratorOwner::Class(c) => Parent::ClassDecorator(c),
            DecoratorOwner::Member(m) => Parent::MemberDecorator(m),
            DecoratorOwner::Param(p) => Parent::ParamDecorator(p),
        }
    }
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

/// `bind`: returns `includes` and `excludes` for an object literal member or a JSX attribute.
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

/// `bind`, `bindPropertyWorker`: returns `includes` and `excludes` for a class, interface or type
/// literal member.
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

    /// True if the variable declaration or the parameter has a type annotation.
    #[inline]
    pub fn has_type_annotation(self, hir: &File) -> bool {
        match self {
            PatParent::Var(d) => hir[d].ty.is_some(),
            PatParent::Param(p) => hir[p].ty.is_some(),
            _ => false,
        }
    }

    /// `hasDotDotDotToken` of the binding element.
    #[inline]
    pub fn has_dot_dot_dot_token(self, hir: &File) -> bool {
        match self {
            PatParent::Prop(_, prop) => hir[prop].is_rest,
            PatParent::Elem(_, elem) => hir[elem].is_rest,
            PatParent::Var(_) | PatParent::Param(_) | PatParent::None => false,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ClassOwner {
    Expr(ExprId),
    Stmt(StmtId),
}

impl ClassOwner {
    /// The class expression or declaration, as the `Parent` of the nodes directly inside the class.
    #[inline]
    pub fn to_parent(self) -> Parent {
        match self {
            ClassOwner::Expr(e) => Parent::Expr(e),
            ClassOwner::Stmt(s) => Parent::Stmt(s),
        }
    }

    /// `node.End()` of the class, or 0 if the binder didn't reach it.
    #[inline]
    pub fn end(self, hir: &File) -> u32 {
        match self {
            ClassOwner::Expr(e) => hir[e].end,
            ClassOwner::Stmt(s) => hir.stmts.get(s.idx()).map_or(0, |class| class.loc.end),
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
    /// The start of a function, a property with an initializer, a namespace body or the file. For a
    /// method, an accessor or a property, it comes before the decorators and the computed name.
    /// `outer` is the flow node where the function expression, the arrow function, or the method or
    /// accessor of an object literal or class expression is evaluated. `arrow` is set for an arrow
    /// function, which doesn't have its own `this`.
    Start {
        outer: FlowId,
        arrow: bool,
    },
    /// The start of an immediately invoked `async` function or generator. Outer narrowings still
    /// apply, as in `getControlFlowContainer`. An immediately invoked function that's neither, like
    /// a static block, doesn't start a new flow. The enclosing control flow continues through it
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
    /// The `switch` was entered at clause `from` (see `entered_clauses`), or at none if that's `NO_CLAUSE`.
    Switch {
        before: FlowId,
        stmt: StmtId,
        from: u32,
    },
    /// A call that may assert something or never return.
    Call {
        before: FlowId,
        call: ExprId,
    },
    /// After a `finally` block. A walk back through the block from here only follows `instead`'s
    /// antecedents, not all the antecedents of `label`, which is the start of the block.
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

impl Flow {
    /// `Switch::from` on the path that enters no clause.
    pub const NO_CLAUSE: u32 = u32::MAX;

    #[inline]
    pub fn enters_no_clause(self) -> bool {
        matches!(self, Flow::Switch { from, .. } if from == Flow::NO_CLAUSE)
    }

    /// Returns a range of `edges` (`BoundIn::flow_edges`) or a single node.
    pub fn antecedents<'a>(&'a self, edges: &'a [FlowId]) -> &'a [FlowId] {
        match self {
            Flow::Unreachable => &[],
            &Flow::Label { start, len } | &Flow::Loop { start, len } => {
                &edges[start as usize..(start + len) as usize]
            }
            Flow::Start { outer: before, .. }
            | Flow::StartInvoked { outer: before, .. }
            | Flow::Reduce { before, .. }
            | Flow::ArrayMutation { before, .. }
            | Flow::Cond { before, .. }
            | Flow::Switch { before, .. }
            | Flow::Assign { before, .. }
            | Flow::Call { before, .. } => std::slice::from_ref(before),
        }
    }
}

/// Returns `ClauseStart` and `ClauseEnd` of a `Flow::Switch` with `from`. As in `bindCaseBlock`, clauses without
/// statements share a node with the first clause after them that has statements.
pub fn entered_clauses(hir: &File, cases: Span<CaseId>, from: u32) -> (usize, usize) {
    if from == Flow::NO_CLAUSE {
        return (0, 0);
    }
    let mut last = from as usize;
    while last + 1 < cases.len() && hir[cases.at(last)].body.is_empty() {
        last += 1;
    }
    (from as usize, last + 1)
}

/// TypeScript's limit on nested `getTypeAtFlowNode` calls. At this depth it gives up and reports TS2563.
pub const MAX_FLOW_DEPTH: u32 = 2000;

/// One `Flow::Loop` node, as `measure_flow` sees it.
struct Loop {
    label: u32,
    /// The last node of the loop body.
    end: u32,
    /// Length of the longest path through the loop body.
    body: u32,
    /// The most depth that a loop nested in this one can add.
    nested: u32,
}

/// Computes `BoundIn::flow_depth` and `BoundIn::has_loop_types_that_depend_on_order`.
///
/// A flow walk goes backward through the graph. At a loop label it also follows the back edge, which walks the loop body
/// again while the first pass over that body is still on the stack. Nested loops stack up the same way, so a node inside
/// three loops can be on the stack four times. The bound is the longest path without back edges, plus one body length
/// for each level of loop nesting.
fn measure_flow(flow: &[Flow], edges: &[FlowId], shared: &[u64]) -> (u32, bool) {
    // Longest backward path from each node, ignoring back edges. A back edge points to a higher index, and so does `NONE`.
    let mut below = vec![0u32; flow.len()];
    let (mut loops, mut reduced): (Vec<Loop>, Vec<(u32, u32)>) = (Vec::new(), Vec::new());
    let mut longest = 0;
    for (i, node) in flow.iter().enumerate() {
        let before = node.antecedents(edges).iter();
        let before = before.filter(|it| it.idx() < i);
        below[i] = 1 + before.map(|it| below[it.idx()]).max().unwrap_or(0);
        longest = longest.max(below[i]);
        match *node {
            Flow::Loop { .. } => loops.push(Loop {
                label: i as u32,
                end: i as u32,
                body: 0,
                nested: 0,
            }),
            Flow::Reduce { label, .. } => reduced.push((label.0, i as u32)),
            _ => {}
        }
    }
    if loops.is_empty() {
        return (longest, false);
    }
    for it in &mut loops {
        let back = flow[it.label as usize].antecedents(edges).iter();
        for back in back.filter(|back| back.is_some() && back.0 > it.label) {
            it.end = it.end.max(back.0);
            it.body = (it.body).max(below[back.idx()].saturating_sub(below[it.label as usize]));
        }
    }
    let depends_on_order =
        has_loop_types_that_depend_on_order(flow, edges, shared, &loops, reduced);
    // For each loop label, the most depth that following its back edge can add.
    let mut deeper_from: Vec<(u32, u32)> = Vec::new();
    let mut open: Vec<Loop> = Vec::new();
    let mut close = |open: &mut Vec<Loop>| {
        let Some(it) = open.pop() else { return };
        // The walk visits the label once more before it notices that the loop is already in progress.
        let deeper = it.body.saturating_add(it.nested.max(1));
        deeper_from.push((it.label, deeper));
        if let Some(outer) = open.last_mut() {
            outer.nested = outer.nested.max(deeper);
        }
    };
    for it in loops {
        while open.last().is_some_and(|outer| outer.end < it.label) {
            close(&mut open);
        }
        open.push(it);
    }
    while !open.is_empty() {
        close(&mut open);
    }
    let deepest = deeper_from.iter().map(|it| it.1).max().unwrap_or(0);
    if longest.saturating_add(deepest) < MAX_FLOW_DEPTH {
        return (longest + deepest, depends_on_order);
    }
    // The longest path and the deepest loop may be in different functions, which makes that sum too high. It only matters
    // near the limit, so only then pair each loop with the longest path that really leads to its label.
    // `above[i]`: the longest path from any node back to `i`, not counting `i`.
    let mut above = vec![0u32; flow.len()];
    for (i, node) in flow.iter().enumerate().rev() {
        for before in node.antecedents(edges).iter().filter(|it| it.idx() < i) {
            above[before.idx()] = above[before.idx()].max(above[i] + 1);
        }
    }
    let through_loops = deeper_from
        .iter()
        .map(|it| it.1.saturating_add(above[it.0 as usize] + 1));
    let deepest = longest.max(through_loops.max().unwrap_or(0));
    (deepest, depends_on_order)
}

/// One `finally` block that control can fall out of, as `has_loop_types_that_depend_on_order` sees it.
struct FinallyBlock {
    /// The label at the start of the block. It counts as part of the block.
    label: u32,
    /// The first node after the block.
    first_after: u32,
    /// Index + 1 of the `finally` block around this one, or 0.
    parent: u32,
    /// How many `Flow::Reduce` nodes the block has: one for each of leaving it normally, by `return` and by an exception.
    reduces: u32,
    /// The lowest and highest node outside the block that follows a node inside it without going through a `Reduce`.
    left_for: Option<(u32, u32)>,
    is_in_loop: bool,
    /// Some node in the block has several successors, so a walk caches its type.
    has_shared_node: bool,
}

/// Computes `BoundIn::has_loop_types_that_depend_on_order`. `loops` is sorted by label. `reduced` holds the label and the
/// index of each `Flow::Reduce`.
///
/// What a walk sees inside a `finally` block depends on how it got there. Each `Reduce` node limits the block's
/// antecedents in its own way, and a jump out of the block doesn't limit them at all. That view can end up in the type
/// cached for a loop in three ways:
/// 1. The loop is inside the block.
/// 2. The block is inside the loop and something leaves it without a `Reduce`. A walk that came through a `Reduce` follows
///    the back edge into the block again, and the limit is still on.
/// 3. The block has two ways out and a node whose type the walk caches. The walk enters the block one way, caches the
///    type, and reuses it when it enters the other way, on behalf of a loop that comes after the block or is around it.
fn has_loop_types_that_depend_on_order(
    flow: &[Flow],
    edges: &[FlowId],
    shared: &[u64],
    loops: &[Loop],
    mut reduced: Vec<(u32, u32)>,
) -> bool {
    if reduced.is_empty() {
        return false;
    }
    reduced.shared_sort_unstable();
    let mut blocks: Vec<FinallyBlock> = Vec::new();
    for (label, reduce) in reduced {
        match blocks.last_mut() {
            Some(last) if last.label == label => last.reduces += 1,
            _ => blocks.push(FinallyBlock {
                label,
                first_after: reduce,
                parent: 0,
                reduces: 1,
                left_for: None,
                is_in_loop: false,
                has_shared_node: false,
            }),
        }
    }
    let mut next = blocks.iter_mut().peekable();
    let (mut end_of_loops, mut end_of_blocks) = (0, 0);
    for it in loops {
        while let Some(block) = next.next_if(|block| block.label < it.label) {
            block.is_in_loop = block.label <= end_of_loops;
            end_of_blocks = end_of_blocks.max(block.first_after);
        }
        if it.label < end_of_blocks {
            return true;
        }
        end_of_loops = end_of_loops.max(it.end);
    }
    for block in next {
        block.is_in_loop = block.label <= end_of_loops;
    }
    // `block_of[i]`: index + 1 of the innermost block that contains node `i`, or 0.
    let mut block_of = vec![0u32; flow.len()];
    let (mut open, mut next): (Vec<u32>, u32) = (Vec::new(), 0);
    for (i, block) in (0..).zip(&mut block_of) {
        while (open.last()).is_some_and(|&it| blocks[it as usize].first_after <= i) {
            open.pop();
        }
        if let Some(it) = blocks.get_mut(next as usize)
            && it.label == i
        {
            it.parent = open.last().map_or(0, |it| it + 1);
            open.push(next);
            next += 1;
        }
        if let Some(&it) = open.last() {
            *block = it + 1;
            let word = shared.get(i as usize / 64).copied().unwrap_or(0);
            blocks[it as usize].has_shared_node |= word >> (i % 64) & 1 != 0;
        }
    }
    // Look at every kind of node, not only labels. The binder drops a label that has a single antecedent, so after
    // `for (;;) { try {} finally { if (a) break; } }` the next statement follows a node inside the block directly.
    for (node, i) in flow.iter().zip(0..) {
        for from in node.antecedents(edges) {
            let Some(block) = block_of.get(from.idx()).filter(|&&block| block != 0) else {
                continue;
            };
            let block = &mut blocks[*block as usize - 1];
            if (block.label..block.first_after).contains(&i)
                || matches!(node, Flow::Reduce { label, .. } if label.0 == block.label)
            {
                continue;
            }
            let (lowest, highest) = block.left_for.unwrap_or((i, i));
            block.left_for = Some((lowest.min(i), highest.max(i)));
        }
    }
    // Inner blocks come after the blocks around them. What leaves an inner block may leave the outer one too.
    for i in (0..blocks.len()).rev() {
        let (parent, left_for, has_shared_node) = (
            blocks[i].parent,
            blocks[i].left_for,
            blocks[i].has_shared_node,
        );
        if left_for.is_some() && blocks[i].is_in_loop {
            return true;
        }
        let Some(parent) = blocks.get_mut((parent as usize).wrapping_sub(1)) else {
            continue;
        };
        parent.has_shared_node |= has_shared_node;
        for to in left_for.into_iter().flat_map(|it| [it.0, it.1]) {
            if to <= parent.label || parent.first_after <= to {
                let (lowest, highest) = parent.left_for.unwrap_or((to, to));
                parent.left_for = Some((lowest.min(to), highest.max(to)));
            }
        }
    }
    // `is_mixed[i]`: a walk can enter block `i`, or a block around it, in two ways and reuse a cached type there.
    let mut is_mixed = vec![false; blocks.len()];
    for i in 0..blocks.len() {
        let it = &blocks[i];
        let ways_out = it.reduces + u32::from(it.left_for.is_some());
        is_mixed[i] = ways_out > 1 && it.has_shared_node;
        if is_mixed[i] && it.is_in_loop {
            return true;
        }
        is_mixed[i] |= it.parent != 0 && is_mixed[it.parent as usize - 1];
    }
    let Some(first) = is_mixed.iter().position(|&it| it) else {
        return false;
    };
    // Is there a loop from which a walk gets back to such a block?
    let first = blocks[first].label as usize;
    let mut leads_to_block = vec![false; flow.len() - first];
    for (i, node) in flow.iter().enumerate().skip(first) {
        let mut before = node.antecedents(edges).iter();
        leads_to_block[i - first] = (block_of[i] != 0 && is_mixed[block_of[i] as usize - 1])
            || before.any(|it| (first..i).contains(&it.idx()) && leads_to_block[it.idx() - first]);
        if leads_to_block[i - first] && matches!(node, Flow::Loop { .. }) {
            return true;
        }
    }
    false
}

#[derive(Copy, Clone, Debug)]
pub struct FnInfo {
    pub owner: FnOwner,
    pub scope: ScopeId,
    /// The enclosing function-like.
    pub enclosing: FnId,
    /// The `return` statements, as a range of `Bound::ids`.
    pub returns: IdList<StmtId>,
    /// The yield expressions `forEachYieldExpression` finds, including those in the static blocks
    /// of classes nested in it. A static block itself has none.
    pub yields: IdList<ExprId>,
    /// `Unreachable` if control can't fall off the end.
    pub end: FlowId,
    /// `ReturnFlowNode`: the exit of a constructor, a static block or a function that the enclosing
    /// control flow continues through. A `return` or falling off the end leads here.
    pub exit: FlowId,
    /// `NodeFlagsContainsThis`: it contains a `this` expression or type, possibly inside arrow
    /// functions, function types or signatures.
    pub contains_this: bool,
}

/// The syntactic position of an `infer T`, for the positions `getInferredTypeParameterConstraint`
/// handles.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum InferPosition {
    /// `Ref<.., infer T, ..>`, with the type reference and the argument index.
    TypeArgument(TypeNodeId, u32),
    /// `[...infer T]`, `(...args: infer T) => void`
    Rest,
    /// `` `${infer T}` ``
    Template,
    /// `{ [K in infer T]: .. }`
    MappedKey,
    /// `{ [K in X]: E } extends { [_ in Y]: infer T } ? ..`, with the mapped type that's checked.
    MappedTemplate(MappedId),
}

/// `declareSymbolEx`, where `symbol.Flags&excludes != 0`: `decl` conflicts with `symbol`.
#[derive(Copy, Clone, Debug)]
pub struct Redeclaration {
    pub symbol: SymbolId,
    /// `len(symbol.Declarations)` at that point.
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
    pub symbols: S::Symbols,
    pub scopes: S::List<Scope>,
    /// Each table is a contiguous range of `entries`, in symbol creation order.
    pub tables: S::List<(u32, u32)>,
    pub entries: S::List<(Atom, SymbolId)>,
    /// The index in `entries` of each name of a table with more than `SCANNED` names.
    pub large_tables: S::Map<(TableId, Atom), u32>,
    /// A Bloom filter with one hash function over the names in the `locals` of the scopes that have
    /// no `symbol` and aren't the file scope. Its length in words is a power of two, or zero if
    /// those scopes declare nothing. See `scope_to_resolve_from`.
    pub nested_names: S::List<u64>,
    pub ids: S::List<u32>,

    /// The file as a module. Its exports are what other files can import.
    pub file_symbol: SymbolId,
    /// `exportStars.Declarations`: every `export * from spec`, with the module or namespace symbol
    /// that contains it.
    pub export_stars: S::Few<(SymbolId, StmtId)>,
    /// `declare module "name"` whose container is the file, or an ambient module at the top level
    /// of a script. One entry per symbol, which all declarations of a name in one container share.
    /// The flag is set for a local of a file without module syntax, where it declares the module.
    /// Any other is merged by `mergeModuleAugmentation` or not at all.
    pub ambient_modules: S::Few<(Atom, SymbolId, bool)>,
    /// `file.PatternAmbientModules`: a module whose name has exactly one `*` and that augments
    /// nothing, wherever it is declared. One entry for each declaration.
    pub pattern_ambient_modules: S::Few<(Atom, SymbolId)>,
    /// `declare global { }` at the top level of a module, or directly inside an ambient module at
    /// the top level of a script. The exports of these symbols are global.
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
    /// script declares, and the names of the modules augmented there. They're resolved unless
    /// relative.
    pub ambient_specifiers: S::Few<Atom>,
    /// `CommonJSModuleIndicator`: the expression that marks the file as a CommonJS module.
    pub commonjs_indicator: Option<ExprId>,
    /// `declareCommonJSVariable`: `module.Members["exports"]`, or `NONE` if there's no such
    /// `module`.
    pub module_exports_property: SymbolId,

    /// `getResolvedSymbol` of an identifier, or `NONE` if nothing in this file declares it. Also
    /// `node.Symbol` of a `Decl::Expando` and of an object literal, where `NONE` means it hasn't
    /// been created yet. See `symbol_of_expando_initializer`.
    pub expr_symbol: S::Ids<SymbolId>,
    pub expr_parent: S::List<PackedParent>,
    /// The flow node at a name, a `this`, a `super`, and a narrowable `a.b` or `a[b]`
    /// (`isNarrowableReference`).
    /// `UNREACHABLE` for everything else.
    pub expr_flow: S::Ids<FlowId>,
    pub stmt_parent: S::List<PackedParent>,
    /// The enclosing scope of a statement.
    pub stmt_scope: S::Ids<ScopeId>,
    /// The enclosing scope of a type.
    pub type_scope: S::List<ScopeId>,
    /// `isResolvedByTypeAlias`: between the type node and a type alias there are only nodes that
    /// resolve their parts eagerly.
    pub type_by_alias: S::List<bool>,
    /// The `this` types inside a type literal, where they are invalid. `getThisType`
    pub this_in_type_literal: S::FewSet<TypeNodeId>,
    /// `None` if the binder didn't reach the node. The parser can leave unreferenced nodes (a
    /// construct dropped during error recovery, an annotation in a parenthesized list that isn't an
    /// arrow function, `<T>(x)` parsed as a cast). They have no symbol, scope or owner, so a pass
    /// over a whole vector has to skip them. The same goes for `member_owner`, `fns[..].owner` and
    /// `type_param_scope`.
    pub pat_parent: S::List<PatParent>,
    pub pat_symbol: S::List<SymbolId>,
    pub prop_owner: S::List<ExprId>,
    pub member_symbol: S::List<SymbolId>,
    /// `node.Symbol` for a parameter property and for a member of an object literal that has
    /// symbols.
    pub property_symbol: S::FewMap<Decl, SymbolId>,
    pub member_owner: S::List<MemberOwner>,
    /// The scope that encloses a member's type, function and initializer.
    pub member_scope: S::List<ScopeId>,
    pub param_fn: S::List<FnId>,
    pub type_param_symbol: S::List<SymbolId>,
    /// The scope that declares a type parameter (its class, interface, function, alias, ...).
    pub type_param_scope: S::List<ScopeId>,
    pub fns: S::List<FnInfo>,
    /// Indexed by function. True if `requiresScopeChange` is true for some parameter, in which case
    /// names in its parameters resolve to variables of its body.
    pub requires_scope_change: S::List<bool>,
    /// `node.Symbol`. For an unnamed function expression and for an arrow function, `NONE` means it
    /// hasn't been created yet. See `symbol_of_expando_initializer`.
    pub fn_symbol: S::List<SymbolId>,
    pub class_symbol: S::List<SymbolId>,
    pub class_owner: S::List<ClassOwner>,
    pub class_scope: S::List<ScopeId>,
    pub interface_symbol: S::List<SymbolId>,
    /// The scope that an interface, an enum, a module or a namespace creates. Its enclosing scope
    /// is the parent of that scope.
    pub interface_scope: S::List<ScopeId>,
    /// `NodeFlagsContainsThis` of an interface declaration.
    pub interface_contains_this: S::List<bool>,
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
    /// The symbol of each `this[k] = v` with a dynamic name, and the table that declares it, in
    /// binding order. See `computed_symbol_in_table`.
    pub computed_symbols: S::Few<(TableId, SymbolId)>,
    pub case_stmt: S::List<StmtId>,
    /// The flow node at the start of each statement.
    pub stmt_flow: S::Ids<FlowId>,
    /// The flow node at the end of a `case` that is followed by another, if that end is reachable.
    /// `NONE` otherwise.
    pub case_fallthrough: S::List<FlowId>,
    /// Each `var` declared in a block, which it's hoisted out of, or directly in a static block,
    /// with its enclosing scope.
    pub hoisted_vars: S::Few<(PatId, ScopeId)>,
    /// Decorators on nodes that can't be decorated. No further errors are reported inside them.
    pub rejected_decorators: S::Few<ExprId>,
    /// The labeled statements that no `break` or `continue` refers to.
    pub unused_labels: S::Few<StmtId>,
    pub import_scope: S::List<ScopeId>,
    pub import_equals_scope: S::Few<ScopeId>,
    pub export_scope: S::List<ScopeId>,
    /// The enclosing scope of an expression that doesn't create a scope, for the few that need it.
    pub expr_scope: S::FewMap<ExprId, ScopeId>,
    /// `lookupSymbolForPrivateIdentifierDeclaration`: maps `a.#x`, and the `#x` of `#x in a` (its
    /// left operand), to the innermost enclosing class that declares an `#x`. There's no entry if
    /// no enclosing class does.
    pub private_class: S::FewMap<ExprId, ClassId>,
    /// The members of interfaces, type literals and object literals that are named `#x`, each with
    /// its `GetContainingClass`. `getDeclarationName` names them like an `#x` of that class.
    pub private_names_outside_class_bodies: S::Few<(Decl, ClassId)>,
    /// The classes whose symbols `GetSymbolNameForPrivateIdentifier` passes to `GetSymbolId`,
    /// ordered by the first call for each.
    pub classes_of_private_names: S::Few<ClassId>,
    /// The identifiers that resolve to nothing declared in the file, each with its enclosing scope:
    /// globals, members that another file merges into an enclosing namespace or enum, or errors.
    /// Sorted by expression.
    pub free_idents: S::List<(ExprId, ScopeId)>,
    /// The identifiers that resolve only to an import or another alias, each with its enclosing
    /// scope. It takes the whole program to tell whether the alias is a value. Sorted by
    /// expression.
    pub alias_idents: S::List<(ExprId, ScopeId)>,
    /// The `arguments` identifiers that refer to the arguments of an enclosing function. Sorted.
    pub arguments_objects: S::Few<ExprId>,
    /// The identifiers that have an `associatedDeclarationForContainingInitializerOrBindingName`
    /// and aren't `withinDeferredContext`. Each comes with that declaration's name.
    pub identifiers_in_parameters: S::Few<(ExprId, PatId)>,
    /// `checkUnmatchedJSDocParameters`: the `@param` tags that match no parameter, as start and code.
    pub jsdoc_param_errors: S::Few<u32>,
    /// The identifiers named `arguments` that aren't expressions and that
    /// `containsArgumentsReference` passes to `getResolvedSymbol`, unless the result is
    /// `argumentsSymbol`. Each comes with its enclosing scope and the result, which is `NONE` if
    /// nothing in this file declares it.
    pub names_resolved_for_arguments: S::Few<(Node, ScopeId, SymbolId)>,

    pub flow: S::List<Flow>,
    pub flow_edges: S::List<FlowId>,
    /// `FlowFlagsShared`, one bit per node of `flow`. Set if the node is the antecedent of more
    /// than one node.
    pub flow_shared: S::List<u64>,
    /// Upper bound on how deep `getTypeAtFlowNode` calls can nest in a walk of `flow`. See
    /// [`can_reach_flow_depth_limit`](Self::can_reach_flow_depth_limit).
    pub flow_depth: u32,
    /// TypeScript caches the type of a reference at a loop label, from whichever walk gets there first. A walk that starts
    /// after a `finally` block sees fewer antecedents for that block than other walks do. If such a walk can fill the cache,
    /// the cached type depends on which reference was checked first. `has_loop_types_that_depend_on_order`, the function,
    /// lists the ways that can happen.
    pub has_loop_types_that_depend_on_order: bool,
    /// Only [`bind_for_lint_in`] fills in this field and the ones after it. Otherwise they're
    /// empty.
    ///
    /// For each expression: `2 * ExprTag + 1` if it's a `Dot`, an `Index` or a `Call` whose `Chain`
    /// isn't `No`, and `2 * ExprTag` otherwise. [`NOT_REACHED`] if the binder doesn't reach it
    /// (`expr_parent` is `Parent::None`) or if it's `ExprKind::Missing`.
    pub expr_kinds: S::List<u8>,
    /// How many of `expr_kinds` are 0, 1, 2 and so on, up to `2 * ExprTag::COUNT`.
    pub expr_kind_counts: S::List<u32>,
    /// How many statements, types and patterns there are of each kind, reached or not, and a few
    /// other counts. See [`kind_counts`]. If it isn't empty, every statement has a `stmt_parent`
    /// and every type has a `type_scope`.
    pub kind_counts: S::List<u32>,
}

/// The layout of [`BoundIn::kind_counts`].
pub mod kind_counts {
    use crate::hir::{PatTag, StmtTag, TypeTag};

    /// Start of the counts indexed by `StmtTag`.
    pub const STMTS: usize = 0;
    /// Start of the counts indexed by `TypeTag`.
    pub const TYPES: usize = STMTS + StmtTag::COUNT;
    /// Start of the counts indexed by `PatTag`.
    pub const PATS: usize = TYPES + TypeTag::COUNT;
    /// Counts each `init` of a `For` and each `left` of a `ForIn` or `ForOf` that's a
    /// `StmtKind::Expr`.
    pub const EXPRESSION_LOOP_HEADS: usize = PATS + PatTag::COUNT;
    /// Counts the patterns whose `pat_parent` is `PatParent::None`.
    pub const PATS_WITHOUT_PARENT: usize = EXPRESSION_LOOP_HEADS + 1;
    pub const LEN: usize = PATS_WITHOUT_PARENT + 1;
}

/// See [`BoundIn::expr_kinds`].
pub const NOT_REACHED: u8 = u8::MAX;

/// A loaded file's side tables.
pub type Bound<'s> = BoundIn<InArena<'s>>;
/// The side tables of a file that's being bound.
pub type BoundBuilder = BoundIn<Growable>;

pub const UNREACHABLE: FlowId = FlowId(0);

/// The text of `PropertyNameOrName()` of the binding element whose name is `pat`, or `NONE` if
/// that's neither an identifier nor a string literal.
fn property_name_or_name(hir: &File, pat: PatId, property_name: Option<&PatProp>) -> Atom {
    match property_name.map(|p| (p.key, p.name_kind, p.key_pos)) {
        None | Some((PropKey::None, ..)) => match hir[pat].kind {
            PatKind::Ident(name) => name,
            _ => Atom::NONE,
        },
        Some((PropKey::Name(name), NameKind::StringLiteral, _)) => name,
        // A bigint literal has this kind too.
        Some((PropKey::Name(name), NameKind::Identifier, pos))
            if !is_bigint_literal_at(hir, pos) =>
        {
            name
        }
        Some(_) => Atom::NONE,
    }
}

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

    #[inline]
    pub fn symbol(&self, id: SymbolId) -> Symbol<'_> {
        let symbol = self.symbols.get(id.idx());
        symbol.expect("the symbol belongs to this file")
    }

    /// Returns the parent of `e`, or `Parent::None` if `e` isn't an expression of this file.
    #[inline]
    pub fn parent_of_expr(&self, e: ExprId) -> Parent {
        let parent = self.expr_parent.get(e.idx()).copied();
        parent.unwrap_or_default().get()
    }

    /// Returns the parent of `s`, or `Parent::None` if `s` isn't a statement of this file.
    #[inline]
    pub fn parent_of_stmt(&self, s: StmtId) -> Parent {
        let parent = self.stmt_parent.get(s.idx()).copied();
        parent.unwrap_or_default().get()
    }

    /// Returns `expr_symbol` for `e`, or `NONE` if `e` isn't an expression of this file.
    #[inline]
    pub fn symbol_of_expr(&self, e: ExprId) -> SymbolId {
        self.expr_symbol.id_at(e.idx()).unwrap_or_default()
    }

    /// Returns `expr_flow` for `e`, or `UNREACHABLE` if `e` isn't an expression of this file.
    #[inline]
    pub fn flow_of_expr(&self, e: ExprId) -> FlowId {
        self.expr_flow.id_at(e.idx()).unwrap_or(UNREACHABLE)
    }

    /// Returns `stmt_flow` for `s`, or `UNREACHABLE` if `s` isn't a statement of this file.
    #[inline]
    pub fn flow_of_stmt(&self, s: StmtId) -> FlowId {
        self.stmt_flow.id_at(s.idx()).unwrap_or(UNREACHABLE)
    }

    /// Returns the scope that encloses `s`, or `NONE` if `s` isn't a statement of this file.
    #[inline]
    pub fn scope_of_stmt(&self, s: StmtId) -> ScopeId {
        self.stmt_scope.id_at(s.idx()).unwrap_or_default()
    }

    /// Returns the class at whose position a decorator with this `parent` is evaluated.
    pub fn class_of_decorator(&self, parent: Parent) -> ClassId {
        let member = match parent {
            Parent::ClassDecorator(class) => return class,
            Parent::MemberDecorator(member) => member,
            Parent::ParamDecorator(p) => match self.fns[self.param_fn[p.idx()].idx()].owner {
                FnOwner::Member(member) => member,
                _ => return ClassId::NONE,
            },
            _ => return ClassId::NONE,
        };
        match self.member_owner[member.idx()] {
            MemberOwner::Class(class) => class,
            _ => ClassId::NONE,
        }
    }

    /// The nearest scope that isn't just a block. It's the binder's `container` when `scope` is its
    /// `blockScopeContainer`.
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

    /// `GetAssignmentTarget`: returns the node that assigns to `e`, if `e` is its target or part of
    /// a pattern that's its target.
    #[inline]
    pub fn get_assignment_target(&self, hir: &File, e: ExprId) -> Option<AssignmentTarget> {
        self.assignment_target(hir, e, true)
    }

    /// True if the assignment `e` is how `{ name = value }` is stored: a
    /// `ShorthandPropertyAssignment` with an `ObjectAssignmentInitializer`.
    pub fn is_shorthand_property_assignment(&self, hir: &File, e: ExprId) -> bool {
        matches!(self.parent_of_expr(e), Parent::Prop(p) if hir[p].kind == PropKind::Shorthand)
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
            match self.parent_of_expr(e) {
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Assign { target, .. } if target != e => return None,
                    // `{ name = value }` is a `ShorthandPropertyAssignment`.
                    ExprKind::Assign { .. }
                        if self.is_shorthand_property_assignment(hir, parent) =>
                    {
                        e = parent;
                    }
                    ExprKind::Assign { op, .. } => return Some(AssignmentTarget::Assign(op)),
                    ExprKind::Unary {
                        op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                        ..
                    } => return Some(AssignmentTarget::Unary),
                    ExprKind::Array(_) => e = parent,
                    ExprKind::Spread(_) | ExprKind::NonNull(_) if sees_through_spread => e = parent,
                    _ => return None,
                },
                // The value of `name: value` and of `...value`, and the assignment that
                // `{ name = value }` is stored as.
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
                    return target_of_for_in_or_of(hir, self.parent_of_stmt(s), s);
                }
                _ => return None,
            }
        }
    }

    /// `IsVariableDeclarationInitializedToRequire` for the variable declaration or the binding
    /// element whose name is `pat`. Returns the module. For a binding element (in an object or
    /// array pattern, with or without `...`), also returns the export that
    /// `getExternalModuleMember` looks up. That's the text of `PropertyNameOrName()`, or `NONE` if
    /// it's neither an identifier nor a string literal.
    pub fn required_by(&self, hir: &File, pat: PatId) -> Option<(Atom, Option<Atom>)> {
        if !hir.is_js {
            return None;
        }
        let (pattern, property_name) = match self.pat_parent[pat.idx()] {
            PatParent::Var(d) => return Some((module_required_by(hir, d)?, None)),
            PatParent::Prop(pattern, p) => (pattern, Some(&hir[p])),
            PatParent::Elem(pattern, _) => (pattern, None),
            PatParent::Param(_) | PatParent::None => return None,
        };
        let PatParent::Var(d) = self.pat_parent[pattern.idx()] else {
            return None;
        };
        let name = property_name_or_name(hir, pat, property_name);
        Some((module_required_by(hir, d)?, Some(name)))
    }

    /// `getExportSymbolOfValueSymbolIfExported`, before `getMergedSymbol`.
    pub fn export_symbol_of_value_symbol_if_exported(&self, symbol: SymbolId) -> SymbolId {
        let local = self.symbol(symbol);
        if local.flags.contains(SymFlags::EXPORT_VALUE) && local.export_symbol.is_some() {
            local.export_symbol
        } else {
            symbol
        }
    }

    /// The table's entries, in symbol creation order.
    pub fn table(&self, table: TableId) -> &[(Atom, SymbolId)] {
        if table.is_none() {
            return &[];
        }
        let (start, len) = self.tables[table.idx()];
        &self.entries[start as usize..(start + len) as usize]
    }

    /// `NameResolver.Resolve`: `IsSourceFile(location) || IsModuleDeclaration(location) &&
    /// location.Flags&NodeFlagsAmbient != 0 && !IsGlobalScopeAugmentation(location)`, where `scope`
    /// is that of `location`.
    pub fn is_external_module(&self, hir: &File, scope: ScopeId) -> bool {
        match self.scopes[scope.idx()].kind {
            ScopeKind::File => true,
            ScopeKind::Module(m) => {
                let mut enclosing_scopes = std::iter::successors(Some(scope), |&at| {
                    Some(self.scopes[at.idx()].parent).filter(|parent| parent.is_some())
                });
                !matches!(hir[m].name, ModuleName::Global)
                    && (hir.kind == FileKind::Declaration
                        || enclosing_scopes.any(|at| {
                            matches!(self.scopes[at.idx()].kind, ScopeKind::Module(it)
                                if hir[it].flags.contains(Flags::AMBIENT))
                        }))
            }
            _ => false,
        }
    }

    /// `NameResolver.Resolve`: true if `func` has its own `arguments`.
    pub fn has_arguments(&self, hir: &File, func: FnId) -> bool {
        match hir[func].kind {
            FnKind::Decl | FnKind::Expr | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
                true
            }
            // A method of a class or an object literal, not a method signature.
            FnKind::Method => !matches!(self.fns[func.idx()].owner, FnOwner::Member(m)
                if matches!(self.member_owner[m.idx()], MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_))),
            _ => false,
        }
    }

    /// `NameResolver.Resolve`'s restrictions on the locals of a function and of a conditional type.
    /// Returns true if a local with `flags` is visible to a lookup for `meaning` that has just left
    /// a scope of kind `from`.
    pub fn is_visible_from(&self, from: ScopeKind, flags: SymFlags, meaning: SymFlags) -> bool {
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
        // Type parameters are the only types visible outside the body.
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

/// The last step of `GetAssignmentTarget`. Returns `ForInOrOf` if `s`, an expression statement whose parent is
/// `parent`, is the assignment target in the head of a `for`-`in` or `for`-`of`.
fn target_of_for_in_or_of(hir: &File, parent: Parent, s: StmtId) -> Option<AssignmentTarget> {
    matches!(parent, Parent::Stmt(l) if l.is_some()
        && matches!(hir[l].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == s))
    .then_some(AssignmentTarget::ForInOrOf)
}

/// `isVariableDeclarationInitializedWithRequireHelper` in a JavaScript file, without
/// `allowAccessedRequire`: returns the module that `d` is initialized to.
fn module_required_by(hir: &File, d: VarDeclId) -> Option<Atom> {
    let init = hir[d].init;
    if init.is_none()
        || is_parenthesized(hir, init)
        || hir[d].ty.is_some()
        || hir[d].flags.contains(Flags::EXPORT)
    {
        return None;
    }
    required_specifier(hir, init)
}

/// Builds `BoundIn::large_tables`.
pub(crate) fn large_table_entries(
    tables: &[(u32, u32)],
    entries: &[(Atom, SymbolId)],
) -> impl Iterator<Item = ((TableId, Atom), u32)> {
    let large = (0..)
        .zip(tables)
        .filter(|it| it.1.1 as usize > BoundBuilder::SCANNED);
    large.flat_map(|(id, &(start, len))| {
        let names = &entries[start as usize..(start + len) as usize];
        (start..)
            .zip(names)
            .map(move |(entry_index, entry)| ((TableId(id), entry.0), entry_index))
    })
}

/// Builds `BoundIn::nested_names`, at 8 bits per name.
pub(crate) fn nested_names_of(
    scopes: &[Scope],
    tables: &[(u32, u32)],
    entries: &[(Atom, SymbolId)],
) -> Vec<u64> {
    let is_nested = |s: &&Scope| s.symbol.is_none() && s.parent.is_some() && s.locals.is_some();
    let nested = || {
        scopes
            .iter()
            .filter(is_nested)
            .map(|s| tables[s.locals.idx()])
    };
    let count: usize = nested().map(|(_, len)| len as usize).sum();
    if count == 0 {
        return Vec::new();
    }
    let mut filter = vec![0u64; (count / 8 + 1).next_power_of_two()];
    let names = nested().flat_map(|(start, len)| &entries[start as usize..(start + len) as usize]);
    for &(name, _) in names {
        let (word, bit) = bit_of_nested_name(filter.len(), name);
        filter[word] |= bit;
    }
    filter
}

/// The word index and the bit for `name` in a `nested_names` of `words` words.
fn bit_of_nested_name(words: usize, name: Atom) -> (usize, u64) {
    // Atoms are numbered sequentially, so Fibonacci hashing spreads them out.
    let hash = u64::from(name.0).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32;
    ((hash >> 6) as usize & (words - 1), 1 << (hash & 63))
}

impl Bound<'_> {
    /// `symbol.Declarations` of `p`'s symbol. `p` is an object literal member or a JSX attribute.
    pub fn declarations_of_literal_member(&self, p: PropId) -> SmallVec<[PropId; 2]> {
        let Some(symbol) = self.property_symbol.get(&Decl::Property(p)) else {
            return smallvec::smallvec![p];
        };
        let declarations = self.symbol(*symbol).decls.iter();
        declarations
            .filter_map(|declaration| match *declaration {
                Decl::Property(p) => Some(p),
                _ => None,
            })
            .collect()
    }

    /// True if `m`, which has a name, has a symbol other than the one its container has under that
    /// name.
    pub fn is_member_not_in_table(&self, m: MemberId) -> bool {
        let Some(symbol) = self.symbols.get(self.member_symbol[m.idx()].idx()) else {
            return false;
        };
        let container = self.symbol(symbol.parent);
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

    /// `markNodeAssignmentsWorker`: the identifiers that resolve to `symbol` and are assignment
    /// targets, in source order.
    pub fn assignments_to(&self, symbol: SymbolId) -> &[(SymbolId, ExprId)] {
        let from = self.assignments.partition_point(|a| a.0.0 < symbol.0);
        let len = self.assignments[from..].partition_point(|a| a.0 == symbol);
        &self.assignments[from..from + len]
    }

    /// `GetImmediatelyInvokedFunctionExpression`: returns the call if the function expression or
    /// arrow function `f` is immediately invoked.
    pub fn get_immediately_invoked_function_expression(
        &self,
        hir: &File,
        f: FnId,
    ) -> Option<CallId> {
        if let FnOwner::Expr(e) = self.fns[f.idx()].owner
            && matches!(hir[f].kind, FnKind::Expr | FnKind::Arrow)
            && let Parent::Expr(parent) = self.parent_of_expr(e)
            && parent.is_some()
            && let ExprKind::Call(call) = hir[parent].kind
            && hir[call].callee == e
        {
            return Some(call);
        }
        None
    }

    /// `GetAssignedName`: returns the name position of the target that `e` is directly assigned to.
    pub fn get_assigned_name(&self, hir: &File, e: ExprId) -> Option<u32> {
        if is_parenthesized(hir, e) {
            return None;
        }
        match self.parent_of_expr(e) {
            // Not a JSX attribute.
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
                if is_parenthesized(hir, left) || self.is_shorthand_property_assignment(hir, parent)
                {
                    return None;
                }
                match hir[left].kind {
                    ExprKind::Ident(_) => Some(hir[left].pos),
                    ExprKind::Dot { .. } => Some(hir.name_pos(left)),
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

    /// True if `checkSourceFile` never reaches the expression, because it's unreferenced or it's
    /// one of `unchecked_exprs`. A pass over all of a file's expressions must skip it.
    pub fn is_unchecked(&self, e: usize) -> bool {
        matches!(self.parent_of_expr(ExprId(e as u32)), Parent::None)
            || self
                .unchecked_exprs
                .binary_search(&ExprId(e as u32))
                .is_ok()
    }

    /// Same for a type node.
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

    /// True if the file has a `typeof x` type.
    pub(crate) fn has_type_queries(&self) -> bool {
        !self.type_query_operands.is_empty()
    }

    /// `IsInTypeQuery`: the type of `e` is queried, but `e` isn't read.
    pub fn is_in_type_query(&self, e: ExprId) -> bool {
        self.type_query_operands.binary_search(&e).is_ok()
    }

    /// True if `e` is `arguments` and refers to the arguments object.
    pub fn is_arguments_object(&self, e: ExprId) -> bool {
        self.arguments_objects.binary_search(&e).is_ok()
    }

    /// True if the binder treated `e` as declaring a property of a function, a class or an object
    /// literal (`node.Symbol != nil`). That includes a key that isn't a property name, as in
    /// `f[a + b] = value`.
    pub fn is_expando_declaration(&self, e: ExprId) -> bool {
        self.expando_declarations.binary_search(&e).is_ok()
    }

    /// `symbolTable["__computed"]`, which every `this[k] = v` of one table declares, so its
    /// `ValueDeclaration` is the first of them. Here each one has its own symbol, so this maps
    /// `symbol` to the first one's.
    pub fn computed_symbol_in_table(&self, symbol: SymbolId) -> SymbolId {
        let Some(&(table, _)) = self.computed_symbols.iter().find(|it| it.1 == symbol) else {
            return symbol;
        };
        let first = self.computed_symbols.iter().find(|it| it.0 == table);
        first.map_or(symbol, |it| it.1)
    }

    /// `node.Symbol`, or `NONE` for the declaration kinds it isn't stored for. None of those has a
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
                self.symbol_of_expr(it)
            }
            Decl::Member(it) => self.member_symbol[it.idx()],
            Decl::ParameterProperty(_) | Decl::Property(_) => {
                let symbol = self.property_symbol.get(&decl);
                symbol.map_or(SymbolId::NONE, |&symbol| symbol)
            }
            _ => SymbolId::NONE,
        }
    }

    /// `node.Symbol` of the function-like `f`.
    pub fn symbol_of_function(&self, hir: &File, f: FnId) -> SymbolId {
        self.symbol_of_declaration(match hir.data(hir.node(f)) {
            NodeData::Member(m) => Decl::Member(m),
            NodeData::Prop(p) => Decl::Property(p),
            _ => Decl::Fn(f),
        })
    }

    /// The scope where `FindAncestor` from `decl` starts: the scope that a file, a module or a
    /// namespace creates, or the enclosing scope of any other declaration. `NONE` if the binder
    /// didn't reach it or it's an assignment.
    pub fn scope_of_declaration(&self, hir: &File, decl: Decl) -> ScopeId {
        let parent_of = |created: ScopeId| {
            let created = self.scopes.get(created.idx());
            created.map_or(ScopeId::NONE, |scope| scope.parent)
        };
        let scope_of_statement = |it: StmtId| self.scope_of_stmt(it);
        match decl {
            Decl::File | Decl::CommonJsVariable => ScopeId(0),
            Decl::Module(it) => self.module_scope[it.idx()],
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => {
                let mut root = pat;
                loop {
                    match self.pat_parent[root.idx()] {
                        PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => root = outer,
                        PatParent::Var(it) => return scope_of_statement(self.var_stmt[it.idx()]),
                        PatParent::Param(it) => {
                            let function = self.fns.get(self.param_fn[it.idx()].idx());
                            return function.map_or(ScopeId::NONE, |function| function.scope);
                        }
                        PatParent::None => return ScopeId::NONE,
                    }
                }
            }
            Decl::Fn(it) => parent_of(self.fns[it.idx()].scope),
            Decl::Class(it) => parent_of(self.class_scope[it.idx()]),
            Decl::Interface(it) => parent_of(self.interface_scope[it.idx()]),
            Decl::Alias(it) => parent_of(self.alias_scope[it.idx()]),
            Decl::Enum(it) => parent_of(self.enum_scope[it.idx()]),
            Decl::EnumMember(it) => {
                let owner = self.enum_scope.get(self.enum_member_owner[it.idx()].idx());
                owner.map_or(ScopeId::NONE, |&it| it)
            }
            Decl::TypeParam(it) => self.type_param_scope[it.idx()],
            Decl::ImportDefault(it) | Decl::ImportNamespace(it) => self.import_scope[it.idx()],
            Decl::ImportSpec(it) => self.import_scope[hir[it].import.idx()],
            Decl::ImportEquals(it) => self.import_equals_scope[it.idx()],
            Decl::ExportSpec(it) => self.export_scope[hir[it].export.idx()],
            Decl::ExportStarAs(it) | Decl::ExportExpr(it) | Decl::UmdGlobal(it) => {
                scope_of_statement(it)
            }
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
    pub fn export_symbol_of_local(&self, scope: ScopeId, name: Atom) -> SymbolId {
        match self.lookup(self.scopes[scope.idx()].locals, name) {
            Some(local) => self.symbol(local).export_symbol,
            None => SymbolId::NONE,
        }
    }

    pub fn lookup(&self, table: TableId, name: Atom) -> Option<SymbolId> {
        let entries = self.table(table);
        if entries.len() <= Self::SCANNED {
            return entries.iter().find(|e| e.0 == name).map(|e| e.1);
        }
        let entry_index = *self.large_tables.get(&(table, name))?;
        Some(self.entries[entry_index as usize].1)
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

    /// True if a walk of `flow` can hit `MAX_FLOW_DEPTH`. `>=` allows for the one extra condition node that
    /// `checkIfExpressionRefinesParameter` makes up.
    pub fn can_reach_flow_depth_limit(&self) -> bool {
        self.flow_depth >= MAX_FLOW_DEPTH
    }

    /// True if a reference's type can depend on which references were checked before it.
    pub fn has_types_that_depend_on_order(&self) -> bool {
        self.can_reach_flow_depth_limit() || self.has_loop_types_that_depend_on_order
    }

    /// The scope where `NameResolver.Resolve` can start its lookup of `name` from `scope`. If no
    /// scope in between declares the name, that's the nearest enclosing scope whose symbol has
    /// exports (which may come from other files), or the file scope. Only valid when `lookup` is
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

    /// `NameResolver.Resolve` at a class or an interface reached from a static member
    /// (`IsStatic(lastLocation)`), at `KindComputedPropertyName` and at
    /// `KindExpressionWithTypeArguments`. Returns an error code and the scope of the enclosing
    /// class or interface. A search that has reached `scope` ends with that error if `r.lookup`
    /// finds a type parameter among the returned scope's locals.
    pub fn type_parameter_out_of_reach(&self, scope: ScopeId) -> Option<(u32, ScopeId)> {
        let s = &self.scopes[scope.idx()];
        let code = match s.kind {
            ScopeKind::StaticMember => 2302,
            ScopeKind::ComputedName => 2467,
            ScopeKind::BaseExpression => 2562,
            _ => return None,
        };
        Some((code, s.parent))
    }

    /// `NameResolver.Resolve`, `case KindPropertyDeclaration`: returns
    /// `propertyWithInvalidInitializer` if a lookup for `meaning` that has reached `scope` must
    /// record one there, along with the error that `checkAndReportErrorForInvalidInitializer`
    /// reports for it. The lookup continues, and returns nil at the end if it has a
    /// `nameNotFoundMessage`.
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
        (meaning & self.symbol(local).flags)
            .intersects(SymFlags::VALUE)
            .then_some((code, property))
    }

    /// `NameResolver.Resolve`: true if a lookup of the variable `arguments` from `scope` that finds
    /// no declaration ends at `argumentsSymbol`, which isn't in any table.
    pub fn is_in_function_with_arguments(&self, hir: &File, mut scope: ScopeId) -> bool {
        while scope.is_some() {
            let s = &self.scopes[scope.idx()];
            if let ScopeKind::Fn(f) | ScopeKind::FunctionName(f) = s.kind
                && self.has_arguments(hir, f)
            {
                return true;
            }
            scope = s.parent;
        }
        false
    }
}

fn map_to_arena<'s, K: Eq + std::hash::Hash, V>(
    map: FxHashMap<K, V>,
    arena: &'s Arena,
) -> ArenaHashMap<'s, K, V> {
    let mut exact = ArenaHashMap::with_capacity_and_hasher_in(map.len(), FxBuild, arena);
    exact.extend(map);
    exact
}

fn few_map_to_arena<K: Ord, V>(map: FxHashMap<K, V>, arena: &Arena) -> ArenaFewMap<'_, K, V> {
    ArenaFewMap::from_iter_in(map.into_iter(), arena)
}

impl BoundBuilder {
    /// Resets it to `BoundBuilder::default()`, except that the lists keep their capacity.
    fn clear(&mut self) {
        // Destructures every field so that a newly added one can't be forgotten.
        let BoundIn {
            ran_out_of_stack,
            symbols,
            scopes,
            tables,
            entries,
            large_tables,
            nested_names,
            ids,
            file_symbol,
            export_stars,
            ambient_modules,
            pattern_ambient_modules,
            global_augmentations,
            redeclarations,
            umd_globals,
            specifiers,
            module_augmentations,
            ambient_specifiers,
            commonjs_indicator,
            module_exports_property,
            expr_symbol,
            expr_parent,
            expr_flow,
            stmt_parent,
            stmt_scope,
            type_scope,
            type_by_alias,
            this_in_type_literal,
            pat_parent,
            pat_symbol,
            prop_owner,
            member_symbol,
            property_symbol,
            member_owner,
            member_scope,
            param_fn,
            type_param_symbol,
            type_param_scope,
            fns,
            requires_scope_change,
            fn_symbol,
            class_symbol,
            class_owner,
            class_scope,
            interface_symbol,
            interface_scope,
            interface_contains_this,
            enum_scope,
            module_scope,
            alias_symbol,
            alias_scope,
            enum_symbol,
            enum_member_symbol,
            enum_member_owner,
            module_symbol,
            module_instance_state,
            var_stmt,
            assignments,
            type_query_operands,
            unchecked_exprs,
            unchecked_types,
            infer_positions,
            expando_declarations,
            computed_symbols,
            case_stmt,
            stmt_flow,
            case_fallthrough,
            hoisted_vars,
            rejected_decorators,
            unused_labels,
            import_scope,
            import_equals_scope,
            export_scope,
            expr_scope,
            private_class,
            private_names_outside_class_bodies,
            classes_of_private_names,
            free_idents,
            alias_idents,
            arguments_objects,
            identifiers_in_parameters,
            jsdoc_param_errors,
            names_resolved_for_arguments,
            flow,
            flow_edges,
            flow_shared,
            flow_depth,
            has_loop_types_that_depend_on_order,
            expr_kinds,
            expr_kind_counts,
            kind_counts,
        } = self;
        *ran_out_of_stack = Default::default();
        symbols.clear();
        scopes.clear();
        tables.clear();
        entries.clear();
        large_tables.clear();
        nested_names.clear();
        ids.clear();
        *file_symbol = Default::default();
        export_stars.clear();
        ambient_modules.clear();
        pattern_ambient_modules.clear();
        global_augmentations.clear();
        redeclarations.clear();
        umd_globals.clear();
        specifiers.clear();
        module_augmentations.clear();
        ambient_specifiers.clear();
        *commonjs_indicator = Default::default();
        *module_exports_property = Default::default();
        expr_symbol.clear();
        expr_parent.clear();
        expr_flow.clear();
        stmt_parent.clear();
        stmt_scope.clear();
        type_scope.clear();
        type_by_alias.clear();
        this_in_type_literal.clear();
        pat_parent.clear();
        pat_symbol.clear();
        prop_owner.clear();
        member_symbol.clear();
        property_symbol.clear();
        member_owner.clear();
        member_scope.clear();
        param_fn.clear();
        type_param_symbol.clear();
        type_param_scope.clear();
        fns.clear();
        requires_scope_change.clear();
        fn_symbol.clear();
        class_symbol.clear();
        class_owner.clear();
        class_scope.clear();
        interface_symbol.clear();
        interface_scope.clear();
        interface_contains_this.clear();
        enum_scope.clear();
        module_scope.clear();
        alias_symbol.clear();
        alias_scope.clear();
        enum_symbol.clear();
        enum_member_symbol.clear();
        enum_member_owner.clear();
        module_symbol.clear();
        module_instance_state.clear();
        var_stmt.clear();
        assignments.clear();
        type_query_operands.clear();
        unchecked_exprs.clear();
        unchecked_types.clear();
        infer_positions.clear();
        expando_declarations.clear();
        computed_symbols.clear();
        case_stmt.clear();
        stmt_flow.clear();
        case_fallthrough.clear();
        hoisted_vars.clear();
        rejected_decorators.clear();
        unused_labels.clear();
        import_scope.clear();
        import_equals_scope.clear();
        export_scope.clear();
        expr_scope.clear();
        private_class.clear();
        private_names_outside_class_bodies.clear();
        classes_of_private_names.clear();
        free_idents.clear();
        alias_idents.clear();
        arguments_objects.clear();
        identifiers_in_parameters.clear();
        jsdoc_param_errors.clear();
        names_resolved_for_arguments.clear();
        flow.clear();
        flow_edges.clear();
        flow_shared.clear();
        *flow_depth = Default::default();
        *has_loop_types_that_depend_on_order = Default::default();
        expr_kinds.clear();
        expr_kind_counts.clear();
        kind_counts.clear();
    }

    /// Moves the side tables into `arena`, with every list at its final size. Leaves `self` empty,
    /// and the lists that are long in most files keep their capacity.
    fn move_to_arena<'s>(&mut self, arena: &'s Arena) -> Bound<'s> {
        Bound {
            ran_out_of_stack: self.ran_out_of_stack,
            symbols: {
                let exact = Symbols::of(&self.symbols, arena);
                self.symbols.clear();
                exact
            },
            scopes: copy_to_arena(&mut self.scopes, arena),
            tables: copy_to_arena(&mut self.tables, arena),
            entries: copy_to_arena(&mut self.entries, arena),
            large_tables: map_to_arena(std::mem::take(&mut self.large_tables), arena),
            nested_names: copy_to_arena(&mut self.nested_names, arena),
            ids: copy_to_arena(&mut self.ids, arena),
            file_symbol: self.file_symbol,
            export_stars: few_to_arena(std::mem::take(&mut self.export_stars), arena),
            ambient_modules: few_to_arena(std::mem::take(&mut self.ambient_modules), arena),
            pattern_ambient_modules: few_to_arena(
                std::mem::take(&mut self.pattern_ambient_modules),
                arena,
            ),
            global_augmentations: few_to_arena(
                std::mem::take(&mut self.global_augmentations),
                arena,
            ),
            redeclarations: few_to_arena(std::mem::take(&mut self.redeclarations), arena),
            umd_globals: few_to_arena(std::mem::take(&mut self.umd_globals), arena),
            specifiers: copy_to_arena(&mut self.specifiers, arena),
            module_augmentations: few_to_arena(
                std::mem::take(&mut self.module_augmentations),
                arena,
            ),
            ambient_specifiers: few_to_arena(std::mem::take(&mut self.ambient_specifiers), arena),
            commonjs_indicator: self.commonjs_indicator,
            module_exports_property: self.module_exports_property,
            expr_symbol: Narrow::moved_in(arena, &mut self.expr_symbol),
            expr_parent: copy_to_arena(&mut self.expr_parent, arena),
            expr_flow: Narrow::moved_in(arena, &mut self.expr_flow),
            stmt_parent: copy_to_arena(&mut self.stmt_parent, arena),
            stmt_scope: Narrow::moved_in(arena, &mut self.stmt_scope),
            type_scope: copy_to_arena(&mut self.type_scope, arena),
            type_by_alias: copy_to_arena(&mut self.type_by_alias, arena),
            this_in_type_literal: ArenaFewMap::from_iter_in(
                self.this_in_type_literal.drain().map(|node| (node, ())),
                arena,
            ),
            pat_parent: copy_to_arena(&mut self.pat_parent, arena),
            pat_symbol: copy_to_arena(&mut self.pat_symbol, arena),
            prop_owner: copy_to_arena(&mut self.prop_owner, arena),
            member_symbol: copy_to_arena(&mut self.member_symbol, arena),
            property_symbol: few_map_to_arena(std::mem::take(&mut self.property_symbol), arena),
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
            interface_contains_this: copy_to_arena(&mut self.interface_contains_this, arena),
            enum_scope: few_to_arena(std::mem::take(&mut self.enum_scope), arena),
            module_scope: few_to_arena(std::mem::take(&mut self.module_scope), arena),
            alias_symbol: copy_to_arena(&mut self.alias_symbol, arena),
            alias_scope: copy_to_arena(&mut self.alias_scope, arena),
            enum_symbol: few_to_arena(std::mem::take(&mut self.enum_symbol), arena),
            enum_member_symbol: few_to_arena(std::mem::take(&mut self.enum_member_symbol), arena),
            enum_member_owner: few_to_arena(std::mem::take(&mut self.enum_member_owner), arena),
            module_symbol: few_to_arena(std::mem::take(&mut self.module_symbol), arena),
            module_instance_state: few_to_arena(
                std::mem::take(&mut self.module_instance_state),
                arena,
            ),
            var_stmt: copy_to_arena(&mut self.var_stmt, arena),
            assignments: copy_to_arena(&mut self.assignments, arena),
            type_query_operands: few_to_arena(std::mem::take(&mut self.type_query_operands), arena),
            unchecked_exprs: few_to_arena(std::mem::take(&mut self.unchecked_exprs), arena),
            unchecked_types: few_to_arena(std::mem::take(&mut self.unchecked_types), arena),
            infer_positions: few_to_arena(std::mem::take(&mut self.infer_positions), arena),
            expando_declarations: few_to_arena(
                std::mem::take(&mut self.expando_declarations),
                arena,
            ),
            computed_symbols: few_to_arena(std::mem::take(&mut self.computed_symbols), arena),
            case_stmt: copy_to_arena(&mut self.case_stmt, arena),
            stmt_flow: Narrow::moved_in(arena, &mut self.stmt_flow),
            case_fallthrough: copy_to_arena(&mut self.case_fallthrough, arena),
            hoisted_vars: few_to_arena(std::mem::take(&mut self.hoisted_vars), arena),
            rejected_decorators: few_to_arena(std::mem::take(&mut self.rejected_decorators), arena),
            unused_labels: few_to_arena(std::mem::take(&mut self.unused_labels), arena),
            import_scope: copy_to_arena(&mut self.import_scope, arena),
            import_equals_scope: few_to_arena(std::mem::take(&mut self.import_equals_scope), arena),
            export_scope: copy_to_arena(&mut self.export_scope, arena),
            expr_scope: few_map_to_arena(std::mem::take(&mut self.expr_scope), arena),
            private_class: few_map_to_arena(std::mem::take(&mut self.private_class), arena),
            private_names_outside_class_bodies: few_to_arena(
                std::mem::take(&mut self.private_names_outside_class_bodies),
                arena,
            ),
            classes_of_private_names: few_to_arena(
                std::mem::take(&mut self.classes_of_private_names),
                arena,
            ),
            free_idents: copy_to_arena(&mut self.free_idents, arena),
            alias_idents: copy_to_arena(&mut self.alias_idents, arena),
            arguments_objects: few_to_arena(std::mem::take(&mut self.arguments_objects), arena),
            identifiers_in_parameters: few_to_arena(
                std::mem::take(&mut self.identifiers_in_parameters),
                arena,
            ),
            jsdoc_param_errors: few_to_arena(std::mem::take(&mut self.jsdoc_param_errors), arena),
            names_resolved_for_arguments: few_to_arena(
                std::mem::take(&mut self.names_resolved_for_arguments),
                arena,
            ),
            flow: copy_to_arena(&mut self.flow, arena),
            flow_edges: copy_to_arena(&mut self.flow_edges, arena),
            flow_shared: copy_to_arena(&mut self.flow_shared, arena),
            flow_depth: self.flow_depth,
            has_loop_types_that_depend_on_order: self.has_loop_types_that_depend_on_order,
            expr_kinds: copy_to_arena(&mut self.expr_kinds, arena),
            expr_kind_counts: copy_to_arena(&mut self.expr_kind_counts, arena),
            kind_counts: copy_to_arena(&mut self.kind_counts, arena),
        }
    }
}

impl Bound<'_> {
    /// Returns the same side tables for a program that shares the file with other programs. The long lists are shared,
    /// not copied. The program writes to the symbols, so they're copied to `arena`, like everything else.
    pub fn share<'s>(&'s self, arena: &'s Arena) -> Bound<'s> {
        Bound {
            ran_out_of_stack: self.ran_out_of_stack,
            symbols: self.symbols.copy_in(arena),
            scopes: Fixed::shared(&self.scopes),
            tables: Fixed::shared(&self.tables),
            entries: Fixed::shared(&self.entries),
            large_tables: copy_of_map(&self.large_tables, arena),
            nested_names: Fixed::shared(&self.nested_names),
            ids: Fixed::shared(&self.ids),
            file_symbol: self.file_symbol,
            export_stars: ArenaFew::from_iter_in(self.export_stars.iter().cloned(), arena),
            ambient_modules: ArenaFew::from_iter_in(self.ambient_modules.iter().cloned(), arena),
            pattern_ambient_modules: ArenaFew::from_iter_in(
                self.pattern_ambient_modules.iter().cloned(),
                arena,
            ),
            global_augmentations: ArenaFew::from_iter_in(
                self.global_augmentations.iter().cloned(),
                arena,
            ),
            redeclarations: ArenaFew::from_iter_in(self.redeclarations.iter().cloned(), arena),
            umd_globals: ArenaFew::from_iter_in(self.umd_globals.iter().cloned(), arena),
            specifiers: Fixed::shared(&self.specifiers),
            module_augmentations: ArenaFew::from_iter_in(
                self.module_augmentations.iter().cloned(),
                arena,
            ),
            ambient_specifiers: ArenaFew::from_iter_in(
                self.ambient_specifiers.iter().cloned(),
                arena,
            ),
            commonjs_indicator: self.commonjs_indicator,
            module_exports_property: self.module_exports_property,
            expr_symbol: self.expr_symbol.shared(),
            expr_parent: Fixed::shared(&self.expr_parent),
            expr_flow: self.expr_flow.shared(),
            stmt_parent: Fixed::shared(&self.stmt_parent),
            stmt_scope: self.stmt_scope.shared(),
            type_scope: Fixed::shared(&self.type_scope),
            type_by_alias: Fixed::shared(&self.type_by_alias),
            this_in_type_literal: copy_of_few_map(&self.this_in_type_literal, arena),
            pat_parent: Fixed::shared(&self.pat_parent),
            pat_symbol: Fixed::shared(&self.pat_symbol),
            prop_owner: Fixed::shared(&self.prop_owner),
            member_symbol: Fixed::shared(&self.member_symbol),
            property_symbol: copy_of_few_map(&self.property_symbol, arena),
            member_owner: Fixed::shared(&self.member_owner),
            member_scope: Fixed::shared(&self.member_scope),
            param_fn: Fixed::shared(&self.param_fn),
            type_param_symbol: Fixed::shared(&self.type_param_symbol),
            type_param_scope: Fixed::shared(&self.type_param_scope),
            fns: Fixed::shared(&self.fns),
            requires_scope_change: Fixed::shared(&self.requires_scope_change),
            fn_symbol: Fixed::shared(&self.fn_symbol),
            class_symbol: Fixed::shared(&self.class_symbol),
            class_owner: Fixed::shared(&self.class_owner),
            class_scope: Fixed::shared(&self.class_scope),
            interface_symbol: Fixed::shared(&self.interface_symbol),
            interface_scope: Fixed::shared(&self.interface_scope),
            interface_contains_this: Fixed::shared(&self.interface_contains_this),
            enum_scope: ArenaFew::from_iter_in(self.enum_scope.iter().cloned(), arena),
            module_scope: ArenaFew::from_iter_in(self.module_scope.iter().cloned(), arena),
            alias_symbol: Fixed::shared(&self.alias_symbol),
            alias_scope: Fixed::shared(&self.alias_scope),
            enum_symbol: ArenaFew::from_iter_in(self.enum_symbol.iter().cloned(), arena),
            enum_member_symbol: ArenaFew::from_iter_in(
                self.enum_member_symbol.iter().cloned(),
                arena,
            ),
            enum_member_owner: ArenaFew::from_iter_in(
                self.enum_member_owner.iter().cloned(),
                arena,
            ),
            module_symbol: ArenaFew::from_iter_in(self.module_symbol.iter().cloned(), arena),
            module_instance_state: ArenaFew::from_iter_in(
                self.module_instance_state.iter().cloned(),
                arena,
            ),
            var_stmt: Fixed::shared(&self.var_stmt),
            assignments: Fixed::shared(&self.assignments),
            type_query_operands: ArenaFew::from_iter_in(
                self.type_query_operands.iter().cloned(),
                arena,
            ),
            unchecked_exprs: ArenaFew::from_iter_in(self.unchecked_exprs.iter().cloned(), arena),
            unchecked_types: ArenaFew::from_iter_in(self.unchecked_types.iter().cloned(), arena),
            infer_positions: ArenaFew::from_iter_in(self.infer_positions.iter().cloned(), arena),
            expando_declarations: ArenaFew::from_iter_in(
                self.expando_declarations.iter().cloned(),
                arena,
            ),
            computed_symbols: ArenaFew::from_iter_in(self.computed_symbols.iter().cloned(), arena),
            case_stmt: Fixed::shared(&self.case_stmt),
            stmt_flow: self.stmt_flow.shared(),
            case_fallthrough: Fixed::shared(&self.case_fallthrough),
            hoisted_vars: ArenaFew::from_iter_in(self.hoisted_vars.iter().cloned(), arena),
            rejected_decorators: ArenaFew::from_iter_in(
                self.rejected_decorators.iter().cloned(),
                arena,
            ),
            unused_labels: ArenaFew::from_iter_in(self.unused_labels.iter().cloned(), arena),
            import_scope: Fixed::shared(&self.import_scope),
            import_equals_scope: ArenaFew::from_iter_in(
                self.import_equals_scope.iter().cloned(),
                arena,
            ),
            export_scope: Fixed::shared(&self.export_scope),
            expr_scope: copy_of_few_map(&self.expr_scope, arena),
            private_class: copy_of_few_map(&self.private_class, arena),
            private_names_outside_class_bodies: ArenaFew::from_iter_in(
                self.private_names_outside_class_bodies.iter().cloned(),
                arena,
            ),
            classes_of_private_names: ArenaFew::from_iter_in(
                self.classes_of_private_names.iter().cloned(),
                arena,
            ),
            free_idents: Fixed::shared(&self.free_idents),
            alias_idents: Fixed::shared(&self.alias_idents),
            arguments_objects: ArenaFew::from_iter_in(
                self.arguments_objects.iter().cloned(),
                arena,
            ),
            identifiers_in_parameters: ArenaFew::from_iter_in(
                self.identifiers_in_parameters.iter().cloned(),
                arena,
            ),
            jsdoc_param_errors: ArenaFew::from_iter_in(
                self.jsdoc_param_errors.iter().cloned(),
                arena,
            ),
            names_resolved_for_arguments: ArenaFew::from_iter_in(
                self.names_resolved_for_arguments.iter().cloned(),
                arena,
            ),
            flow: Fixed::shared(&self.flow),
            flow_edges: Fixed::shared(&self.flow_edges),
            flow_shared: Fixed::shared(&self.flow_shared),
            flow_depth: self.flow_depth,
            has_loop_types_that_depend_on_order: self.has_loop_types_that_depend_on_order,
            expr_kinds: Fixed::shared(&self.expr_kinds),
            expr_kind_counts: Fixed::shared(&self.expr_kind_counts),
            kind_counts: Fixed::shared(&self.kind_counts),
        }
    }
}

fn copy_of_map<'s, K: Copy + Eq + std::hash::Hash, V: Copy>(
    map: &ArenaHashMap<'_, K, V>,
    arena: &'s Arena,
) -> ArenaHashMap<'s, K, V> {
    let mut exact = ArenaHashMap::with_capacity_and_hasher_in(map.len(), FxBuild, arena);
    exact.extend(map.iter().map(|(&key, &value)| (key, value)));
    exact
}

fn copy_of_few_map<'s, K: Copy + Ord, V: Copy>(
    map: &ArenaFewMap<'_, K, V>,
    arena: &'s Arena,
) -> ArenaFewMap<'s, K, V> {
    ArenaFewMap::from_iter_in(map.iter().map(|(&key, &value)| (key, value)), arena)
}

impl<'s> Bound<'s> {
    /// The side tables of a file without nodes.
    pub fn empty_in(arena: &'s Arena) -> Bound<'s> {
        BoundBuilder::default().move_to_arena(arena)
    }
}

/// The compiler options `requiresScopeChangeWorker` reads.
#[derive(Copy, Clone, Default, PartialEq, Eq, Hash, Debug)]
pub struct BindOptions {
    /// `GetEmitStandardClassFields`
    pub emit_standard_class_fields: bool,
    /// `GetEmitScriptTarget` is older than ES2020.
    pub before_es2020: bool,
    pub before_es2017: bool,
}

/// `bindSourceFile`
pub fn bind<'s>(
    file: &File,
    options: BindOptions,
    atoms: &dyn crate::atom::Intern,
    arena: &'s Arena,
) -> Bound<'s> {
    let mut buffers = binder::take_buffers();
    let mut built = binder::Binder::run_in(file, options, atoms, &mut buffers);
    let bound = built.move_to_arena(arena);
    buffers.b = built;
    binder::return_buffers(buffers);
    bound
}

/// The lists that one `bind` call leaves for the next one on the thread. A pool thread outlives a check, so the check
/// owns them, and a thread holds them only while it works for that check.
#[derive(Default)]
pub struct ThreadCaches(Option<Box<binder::Buffers>>);

impl ThreadCaches {
    /// Takes the caches from the calling thread.
    pub fn take() -> ThreadCaches {
        ThreadCaches::default().install()
    }

    /// Installs the caches on the calling thread. Returns the previous ones.
    pub fn install(self) -> ThreadCaches {
        ThreadCaches(binder::replace_buffers(self.0))
    }
}

/// The lists of the last file bound on this thread, so that the next file can reuse their capacity.
/// They're returned to the thread when this is dropped.
pub struct Recycled(Option<Box<binder::Buffers>>);

impl Recycled {
    pub fn for_current_thread() -> Recycled {
        Recycled(Some(binder::take_buffers()))
    }

    fn buffers(&mut self) -> &mut binder::Buffers {
        self.0.get_or_insert_default()
    }
}

impl Drop for Recycled {
    fn drop(&mut self) {
        if let Some(buffers) = self.0.take() {
            binder::return_buffers(buffers);
        }
    }
}

/// [`bind`] for a linter that has no checker. It computes each node's parent and where each
/// function returns and yields. Nothing is declared or resolved. The result lives in `recycled`
/// until the next file is bound there, so little is allocated after the first few files.
///
/// Fills in everything [`bind_for_format_in`] does, plus `enclosing`, `returns` and `yields` in
/// `fns` (`yields` in a different order than `bind`'s), and `expr_kinds`, `expr_kind_counts` and
/// `kind_counts`, which only this function fills in. The few files that need the binder get the
/// full result of `bind`.
pub fn bind_for_lint_in<'r>(
    file: &File,
    options: BindOptions,
    atoms: &dyn crate::atom::Intern,
    recycled: &'r mut Recycled,
) -> &'r BoundBuilder {
    match lint::fill_in(file, &mut recycled.buffers().b) {
        true => &recycled.buffers().b,
        false => fall_back_to_binder(file, options, atoms, recycled),
    }
}

/// Runs [`bind`] and stores the result in `recycled`.
fn fall_back_to_binder<'r>(
    file: &File,
    options: BindOptions,
    atoms: &dyn crate::atom::Intern,
    recycled: &'r mut Recycled,
) -> &'r BoundBuilder {
    let buffers = recycled.buffers();
    buffers.b = binder::Binder::run(file, options, atoms);
    &buffers.b
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::Session;

    #[test]
    fn with_flags_returns_the_same_symbols_as_filtering_iter() {
        let symbol =
            |name: u32, flags: SymFlags, decls: GrowingDecls, exports: TableId| GrowingSymbol {
                name: Atom(name),
                flags,
                decls,
                value_declaration: 0,
                parent: SymbolId::NONE,
                exports,
                members: TableId::NONE,
                export_symbol: SymbolId::NONE,
            };
        let (alias, exported) = (SymFlags::ALIAS, SymFlags::ALIAS | SymFlags::EXPORT_VALUE);
        let two = vec![
            Decl::ImportNamespace(ImportId(1)),
            Decl::ImportNamespace(ImportId(2)),
        ];
        let growing = [
            symbol(
                1,
                SymFlags::FUNCTION,
                GrowingDecls::One(Decl::File),
                TableId::NONE,
            ),
            symbol(
                2,
                alias,
                GrowingDecls::One(Decl::ImportNamespace(ImportId(0))),
                TableId::NONE,
            ),
            symbol(3, SymFlags::CLASS, GrowingDecls::None, TableId(4)),
            symbol(4, exported, GrowingDecls::Many(two), TableId(7)),
            symbol(5, alias, GrowingDecls::None, TableId::NONE),
        ];
        let session = Session::new();
        let symbols = Symbols::of(&growing, session.arena());
        let fields = |it: Symbol<'_>| (it.name.0, it.flags, it.decls.to_vec(), it.exports);
        for flags in [alias, exported, SymFlags::CLASS, SymFlags::ENUM_MEMBER] {
            let expected = symbols.iter().filter(|it| it.flags.contains(flags));
            let expected: Vec<_> = expected.map(fields).collect();
            let found: Vec<_> = symbols.with_flags(flags).map(fields).collect();
            assert_eq!(found, expected);
        }
        assert_eq!(symbols.with_flags(alias).count(), 3);
    }
}

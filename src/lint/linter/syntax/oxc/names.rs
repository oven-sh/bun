//! Redeclarations, found the way oxc's `SemanticBuilder` finds them.
//!
//! oxc gives each declaration flags, and a set of flags that it can't share a scope with (`SymbolFlags`, as in tsc's binder). It
//! declares in source order and reports a clash on the spot. For JavaScript it has further checks, which run when the
//! declaration ends. All of it is replayed here, on the few files in which the parser has seen that a name may be declared twice.

use super::{Stage, SyntaxError};
use crate::ast::{
    Class, ExprKind, File, Flags, FnKind, Func, Handle, KeyKind, Member, MemberKind, Module,
    ModuleName, Name, Node, PatKind, Stmt, StmtKind, StmtTag, VarKind,
};
use crate::language::SourceType;
use crate::semantic::{
    Declaration, DeclarationKinds, Scope, ScopeKind, Symbol, order_in_table_of_oxc,
};
use crate::span::Span;
use crate::tokens::skip_trivia;
use crate::utils::oxlint::{is_strict_mode, source_type};
use bun_sema::hir::{self, rare};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::borrow::Cow;

/// oxc's `SymbolFlags`
mod flag {
    pub(super) const FUNCTION_SCOPED: u32 = 1 << 0;
    pub(super) const BLOCK_SCOPED: u32 = 1 << 1;
    pub(super) const CLASS: u32 = 1 << 2;
    pub(super) const FUNCTION: u32 = 1 << 3;
    pub(super) const IMPORT: u32 = 1 << 4;
    pub(super) const TYPE_IMPORT: u32 = 1 << 5;
    pub(super) const TYPE_ALIAS: u32 = 1 << 6;
    pub(super) const INTERFACE: u32 = 1 << 7;
    pub(super) const REGULAR_ENUM: u32 = 1 << 8;
    pub(super) const CONST_ENUM: u32 = 1 << 9;
    pub(super) const ENUM_MEMBER: u32 = 1 << 10;
    pub(super) const TYPE_PARAMETER: u32 = 1 << 11;
    pub(super) const NAMESPACE_MODULE: u32 = 1 << 12;
    pub(super) const VALUE_MODULE: u32 = 1 << 13;
    pub(super) const ASYNC_OR_GENERATOR: u32 = 1 << 14;

    pub(super) const ENUM: u32 = REGULAR_ENUM | CONST_ENUM;
    pub(super) const VARIABLE: u32 = FUNCTION_SCOPED | BLOCK_SCOPED;
    pub(super) const VALUE: u32 = VARIABLE | CLASS | FUNCTION | ENUM | ENUM_MEMBER | VALUE_MODULE;
    pub(super) const TYPE: u32 =
        CLASS | INTERFACE | ENUM | ENUM_MEMBER | TYPE_PARAMETER | TYPE_ALIAS;
}

/// oxc's `SymbolFlags::..Excludes`
mod excludes {
    use super::flag;
    pub(super) const FUNCTION_SCOPED: u32 = flag::VALUE & !(flag::FUNCTION_SCOPED | flag::FUNCTION);
    pub(super) const BLOCK_SCOPED: u32 = flag::VALUE;
    pub(super) const FUNCTION: u32 =
        flag::VALUE & !(flag::FUNCTION | flag::VALUE_MODULE | flag::CLASS);
    pub(super) const CLASS: u32 =
        (flag::VALUE | flag::TYPE) & !(flag::VALUE_MODULE | flag::FUNCTION | flag::INTERFACE);
    pub(super) const IMPORT: u32 = flag::IMPORT | flag::TYPE_IMPORT;
    pub(super) const TYPE_ALIAS: u32 = flag::TYPE;
    pub(super) const INTERFACE: u32 = flag::TYPE & !(flag::INTERFACE | flag::CLASS);
    pub(super) const TYPE_PARAMETER: u32 = flag::TYPE & !flag::TYPE_PARAMETER;
    pub(super) const CONST_ENUM: u32 = (flag::TYPE | flag::VALUE) & !flag::CONST_ENUM;
    pub(super) const REGULAR_ENUM: u32 =
        (flag::VALUE | flag::TYPE) & !(flag::REGULAR_ENUM | flag::VALUE_MODULE);
    pub(super) const ENUM_MEMBER: u32 = flag::ENUM_MEMBER;
    pub(super) const VALUE_MODULE: u32 =
        flag::VALUE & !(flag::FUNCTION | flag::CLASS | flag::REGULAR_ENUM | flag::VALUE_MODULE);
}

/// One declaration of a symbol: its own flags, and where its name is.
#[derive(Copy, Clone)]
struct Declared {
    flags: u32,
    span: Span,
}

struct Bound {
    /// The flags of all its declarations, and the name of the first.
    all: Declared,
    /// `Scoping::symbol_redeclarations`: empty, or every declaration.
    declarations: SmallVec<[Declared; 2]>,
}

type Key<'a> = (u32, Name<'a>);

struct Binder<'a> {
    file: &'a File<'a>,
    is_typescript: bool,
    is_module: bool,
    /// The scope of the file.
    top: u32,
    symbols: Vec<Bound>,
    bindings: FxHashMap<Key<'a>, usize>,
    /// `SemanticBuilder::hoisting_variables`: what a `var` has passed through on its way to the function.
    hoisting: FxHashMap<Key<'a>, usize>,
    errors: Vec<SyntaxError>,
}

/// oxc has one scope where there are two here: for the file, and for a `catch` clause and its block.
fn id_of(scope: Scope, top: u32) -> u32 {
    match scope.kind() {
        ScopeKind::Global | ScopeKind::Module => top,
        ScopeKind::Catch => scope.children().next().unwrap_or(scope).id().0,
        _ => scope.id().0,
    }
}

/// `ScopeFlags::is_var`
fn holds_vars(scope: Scope) -> bool {
    matches!(
        scope.kind(),
        ScopeKind::Global
            | ScopeKind::Module
            | ScopeKind::Function
            | ScopeKind::ClassStaticBlock
            | ScopeKind::TsModule
    )
}

/// `get_module_instance_state(..).is_instantiated()`: the namespace has more than types in it.
fn is_instantiated<'a>(module: Module<'a>) -> bool {
    if !module.has_body() || !bun_core::StackCheck::init().is_safe_to_recurse() {
        return true;
    }
    let body = module.body();
    let of_statement = |it: Stmt<'a>| match it.kind() {
        StmtKind::Interface(_) | StmtKind::TypeAlias(_) => false,
        StmtKind::ImportEquals(_) => it.is_exported(),
        StmtKind::Module(inner) => is_instantiated(inner),
        _ => true,
    };
    let declares = |it: Stmt<'a>, name: Name<'a>| {
        let symbols = Node::Stmt(it).declared_symbols();
        symbols.iter().any(|symbol| symbol.name() == name)
    };
    body.iter().any(|it| match it.kind() {
        // What it exports is looked up among its own statements.
        StmtKind::ExportNamed(export) if !export.has_from() => export.items().iter().any(|item| {
            let target = body.iter().find(|&it| declares(it, item.local().name()));
            target.is_none_or(of_statement)
        }),
        _ => of_statement(it),
    })
}

impl<'a> Binder<'a> {
    /// `noticed`: where oxc is when it reports the error, if not at `second`.
    fn report(&mut self, name: Name<'a>, first: Span, second: Span, noticed: Option<u32>) {
        let error = SyntaxError::redeclared("Identifier", name.bytes(), first, second);
        self.errors.push(match noticed {
            Some(at) => error.noticed_at(at),
            None => error,
        });
    }

    fn id(&self, scope: Scope<'a>) -> u32 {
        id_of(scope, self.top)
    }

    /// `SemanticBuilder::check_redeclaration`
    fn check(&mut self, key: Key<'a>, span: Span, excludes: u32) -> Option<usize> {
        let symbol = (self.bindings.get(&key)).or_else(|| self.hoisting.get(&key));
        let symbol = *symbol?;
        let all = self.symbols[symbol].all;
        if all.flags & excludes != 0 {
            self.report(key.1, all.span, span, None);
        }
        Some(symbol)
    }

    /// `Scoping::add_symbol_redeclaration`
    fn add_declaration(&mut self, symbol: usize, declared: Declared) {
        let symbol = &mut self.symbols[symbol];
        if symbol.declarations.is_empty() {
            symbol.declarations.push(symbol.all);
        }
        symbol.declarations.push(declared);
    }

    fn create(&mut self, key: Key<'a>, declared: Declared) -> usize {
        self.symbols.push(Bound {
            all: declared,
            declarations: SmallVec::new(),
        });
        self.bindings.insert(key, self.symbols.len() - 1);
        self.symbols.len() - 1
    }

    /// `SemanticBuilder::declare_symbol_on_scope`
    fn declare(&mut self, key: Key<'a>, declared: Declared, excludes: u32) -> usize {
        let Some(symbol) = self.check(key, declared.span, excludes) else {
            return self.create(key, declared);
        };
        self.add_declaration(symbol, declared);
        self.symbols[symbol].all.flags |= declared.flags;
        symbol
    }

    /// The scopes from `scope` up to the one that holds its `var`s, which is the last.
    fn up_to_function(&self, scope: Scope<'a>) -> SmallVec<[u32; 8]> {
        let mut ids: SmallVec<[u32; 8]> = SmallVec::new();
        for it in scope.chain() {
            let id = self.id(it);
            if ids.last() != Some(&id) {
                ids.push(id);
            }
            if holds_vars(it) {
                break;
            }
        }
        ids
    }

    /// `VariableDeclarator::bind` for a name that `var` declares in `scope`.
    fn declare_var(&mut self, scope: Scope<'a>, name: Name<'a>, span: Span) -> usize {
        let declared = Declared {
            flags: flag::FUNCTION_SCOPED,
            span,
        };
        let ids = self.up_to_function(scope);
        let (&target, passed) = ids.split_last().unwrap_or((&self.top, &[]));
        let mut found = None;
        for &id in passed {
            if let Some(symbol) = self.check((id, name), span, excludes::FUNCTION_SCOPED) {
                self.add_declaration(symbol, declared);
                if !self.bindings.contains_key(&(target, name)) {
                    self.bindings.remove(&(id, name));
                    self.bindings.insert((target, name), symbol);
                }
                found = Some(symbol);
                break;
            }
        }
        let symbol = found
            .unwrap_or_else(|| self.declare((target, name), declared, excludes::FUNCTION_SCOPED));
        for &id in passed {
            self.hoisting.insert((id, name), symbol);
        }
        symbol
    }

    /// The declaration before the last one.
    fn previous(&self, symbol: usize) -> Option<Declared> {
        self.symbols[symbol]
            .declarations
            .iter()
            .nth_back(1)
            .copied()
    }

    /// `check_variable_declarator_redeclaration`, for one name. `declarator`: the span of the `a = 1` of `var a = 1`.
    fn check_var(&mut self, scope: Scope<'a>, name: Name<'a>, symbol: usize, declarator: Span) {
        let is_top = self.id(scope) == self.top;
        if (is_top || scope.kind() == ScopeKind::Function) && !(self.is_module && is_top) {
            return;
        }
        if let Some(previous) = self
            .previous(symbol)
            .filter(|it| it.flags & flag::FUNCTION != 0)
        {
            self.report(name, previous.span, declarator, Some(declarator.end));
        }
    }

    /// `Function::bind` and `check_function_redeclaration`, for a declaration in `scope`.
    fn declare_function(&mut self, scope: Scope<'a>, name: Name<'a>, span: Span, func: Func<'a>) {
        let is_plain = !func.is_async() && !func.is_generator();
        let is_strict = is_strict_mode(scope, self.file);
        let is_body_of_if = !is_strict
            && matches!(Node::Func(func).parent().parent(), Node::Stmt(it) if matches!(it.kind(), StmtKind::If { .. }));
        let declared = Declared {
            flags: match is_plain {
                true => flag::FUNCTION,
                false => flag::FUNCTION | flag::ASYNC_OR_GENERATOR,
            },
            span,
        };
        let here = self.id(scope);
        let symbol = self.declare(
            (here, name),
            declared,
            match (self.is_typescript, is_body_of_if) {
                (true, _) => excludes::FUNCTION,
                (false, true) => 0,
                (false, false) => excludes::FUNCTION & !flag::FUNCTION_SCOPED,
            },
        );
        if self.is_typescript {
            return;
        }
        // Annex B.3.2.1: outside strict code a plain function in a block is a variable of the function around, too.
        if is_plain && !holds_vars(scope) && !is_strict {
            let target = self
                .up_to_function(scope)
                .last()
                .copied()
                .unwrap_or(self.top);
            if !self.bindings.contains_key(&(target, name)) {
                if let Some(moved) = self.bindings.remove(&(here, name)) {
                    self.bindings.insert((target, name), moved);
                }
                self.hoisting.insert((here, name), symbol);
            }
        }
        let Some(previous) = self.previous(symbol).filter(|_| !is_body_of_if) else {
            return;
        };
        if previous.flags & flag::BLOCK_SCOPED != 0 {
            return;
        }
        let is_lenient_scope = matches!(
            scope.kind(),
            ScopeKind::Function | ScopeKind::ClassStaticBlock
        ) || !self.is_module && here == self.top;
        if previous.flags & (flag::FUNCTION_SCOPED | flag::FUNCTION) != 0 && is_lenient_scope {
            return;
        }
        let mut culprit = previous;
        if !is_strict && is_plain && previous.flags & flag::FUNCTION != 0 {
            // Annex B.3.3 allows plain functions to share a name in a block.
            let before = &self.symbols[symbol].declarations;
            let before = before.get(..before.len() - 1).unwrap_or_default();
            match before
                .iter()
                .find(|it| it.flags & flag::ASYNC_OR_GENERATOR != 0)
            {
                Some(&it) => culprit = it,
                None => return,
            }
        }
        self.report(name, culprit.span, span, Some(func.span().end));
    }

    fn bind(
        &mut self,
        declaration: Declaration<'a>,
        declared_in: Scope<'a>,
        name: Name<'a>,
        span: Span,
    ) {
        let here = (self.id(declared_in), name);
        let (flags, excludes) = match declaration {
            Declaration::Var(pat) if declaration.is_catch_parameter() => {
                // `declare_shadow_symbol`
                if matches!(pat.parent(), Node::VarDecl(_)) {
                    let flags = flag::FUNCTION_SCOPED;
                    self.create(here, Declared { flags, span });
                    return;
                }
                (flag::BLOCK_SCOPED, excludes::BLOCK_SCOPED)
            }
            Declaration::Var(pat) => {
                let Some(Node::VarDecl(declarator)) = declaration.node() else {
                    return;
                };
                if declarator.var_kind() != VarKind::Var {
                    (flag::BLOCK_SCOPED, excludes::BLOCK_SCOPED)
                } else {
                    let scope = self.file.scope_at(pat.span().start);
                    let symbol = self.declare_var(scope, name, span);
                    if !self.is_typescript {
                        self.check_var(scope, name, symbol, declarator.span());
                    }
                    return;
                }
            }
            // Two parameters with one name are `duplicate_parameter`.
            Declaration::Param(_) if name.is("this") => return,
            Declaration::Param(_) => (flag::FUNCTION_SCOPED, excludes::FUNCTION_SCOPED),
            // A declaration that meets the name of a function expression takes its place.
            Declaration::Fn(func) if func.kind() != FnKind::Decl => return,
            Declaration::Fn(func) => {
                let scope = self.file.scope_at(span.start);
                return self.declare_function(scope, name, span, func);
            }
            Declaration::Class(class) => {
                let declared = Declared {
                    flags: flag::CLASS,
                    span,
                };
                let symbol = self.declare(here, declared, excludes::CLASS);
                // `check_class_redeclaration`
                if !self.is_typescript
                    && let Some(previous) = self.previous(symbol)
                    && previous.flags & flag::FUNCTION != 0
                {
                    self.report(name, previous.span, span, Some(class.span().end));
                }
                return;
            }
            Declaration::Interface(_) => (flag::INTERFACE, excludes::INTERFACE),
            Declaration::TypeAlias(_) => (flag::TYPE_ALIAS, excludes::TYPE_ALIAS),
            Declaration::Enum(it) if it.flags().contains(Flags::CONST) => {
                (flag::CONST_ENUM, excludes::CONST_ENUM)
            }
            Declaration::Enum(_) => (flag::REGULAR_ENUM, excludes::REGULAR_ENUM),
            Declaration::EnumMember(_) => (flag::ENUM_MEMBER, excludes::ENUM_MEMBER),
            Declaration::Module(it) if !matches!(it.name(), ModuleName::Ident(_)) => return,
            Declaration::Module(it) if is_instantiated(it) => {
                (flag::VALUE_MODULE, excludes::VALUE_MODULE)
            }
            Declaration::Module(_) => (flag::NAMESPACE_MODULE, 0),
            Declaration::TypeParam(_) => (flag::TYPE_PARAMETER, excludes::TYPE_PARAMETER),
            Declaration::ImportDefault(it) | Declaration::ImportNamespace(it) => {
                (import_flag(it.is_type_only()), excludes::IMPORT)
            }
            Declaration::ImportSpec(it) => (
                import_flag(it.is_type_only() || it.import().is_type_only()),
                excludes::IMPORT,
            ),
            Declaration::ImportEquals(_) => (flag::IMPORT, excludes::IMPORT),
            Declaration::Other => return,
        };
        self.declare(here, Declared { flags, span }, excludes);
    }

    /// `check_import_value_redeclarations`, when oxc is through with the file.
    fn check_imports(&mut self) {
        if self.is_typescript || !self.is_module {
            return;
        }
        let top = self.top;
        let mut clashing: Vec<(Name<'a>, Span, Span)> = (self.bindings.iter())
            .filter(|(key, _)| key.0 == top)
            .filter_map(|(key, &symbol)| {
                let symbol = &self.symbols[symbol];
                let values = flag::VARIABLE | flag::CLASS | flag::FUNCTION;
                let is_both =
                    symbol.all.flags & flag::IMPORT != 0 && symbol.all.flags & values != 0;
                let (first, last) = (symbol.declarations.first()?, symbol.declarations.last()?);
                is_both.then_some((key.1, first.span, last.span))
            })
            .collect();
        if clashing.len() > 1 {
            let order = names_of_file_in_order_of_oxc(self.file);
            crate::utils::sort::sort_unstable_by_key(&mut clashing, |it| {
                order.iter().position(|&name| name == it.0)
            });
        }
        for (name, first, last) in clashing {
            self.report(name, first, last, Some(u32::MAX));
        }
    }
}

/// What a module declares at the top, in the order in which oxc goes through it.
fn names_of_file_in_order_of_oxc<'a>(file: &'a File<'a>) -> Vec<Name<'a>> {
    let declared = file.top_level_scope().symbols().map(|it| it.name());
    let declared: Vec<Name<'a>> = declared.collect();
    let order = order_in_table_of_oxc(declared.iter().map(|it| it.bytes()));
    let in_order = order.into_iter().filter_map(|it| declared.get(it as usize));
    in_order.copied().collect()
}

fn import_flag(is_type_only: bool) -> u32 {
    match is_type_only {
        true => flag::TYPE_IMPORT,
        false => flag::IMPORT,
    }
}

/// Whether the declarations of `symbol`, which has several, can clash. Not those that many files have: overloads, namespaces
/// that merge, a type and a value of one name, a `var` that is declared again or has the name of a parameter.
fn may_clash(symbol: Symbol, is_typescript: bool) -> bool {
    type Kinds = DeclarationKinds;
    let kinds = symbol.declaration_kinds();
    if is_typescript {
        let not_types = Kinds::VARIABLE
            .union(Kinds::PARAMETER)
            .union(Kinds::FUNCTION_NAME)
            .union(Kinds::IMPORT_BINDING);
        if kinds == Kinds::FUNCTION_NAME
            || kinds == Kinds::TS_MODULE_NAME
            || symbol.declaration_count() == 2
                && kinds.contains(Kinds::TYPE)
                && kinds != Kinds::TYPE
                && not_types.contains(kinds.difference(Kinds::TYPE))
        {
            return false;
        }
    }
    if !Kinds::VARIABLE.union(Kinds::PARAMETER).contains(kinds) {
        return true;
    }
    symbol.declarations().any(|it| match (it, it.node()) {
        (Declaration::Var(_), Some(Node::VarDecl(it))) => it.var_kind() != VarKind::Var,
        (Declaration::Param(_), _) => false,
        _ => true,
    })
}

/// The names that more than one declaration may declare in one of oxc's scopes. Each name is bound on its own, so no other name
/// has to be replayed.
fn candidates<'a>(file: &'a File<'a>) -> FxHashSet<Name<'a>> {
    let mut names = FxHashSet::default();
    let is_typescript = !file.is_javascript();
    let twice = file.symbols_declared_twice();
    names.extend(
        twice
            .filter(|&it| may_clash(it, is_typescript))
            .map(|it| it.name()),
    );
    // What a block declares meets what goes through the block on its way up to the function: a `var`, and outside strict code a
    // function of JavaScript.
    let functions_go_up = file.is_javascript() && source_type(file) != SourceType::Module;
    let goes_through = file.has_names_that_leave_blocks();
    if !goes_through && !functions_go_up && !file.has_stmts([StmtTag::Try]) {
        return names;
    }
    for (scope, symbol) in file.symbols_of_blocks(!goes_through && !functions_go_up) {
        let name = symbol.name();
        let is_function = || {
            let kinds = symbol.declaration_kinds();
            kinds.contains(DeclarationKinds::FUNCTION_NAME)
        };
        let is_in_block_of_catch = || {
            scope.kind() == ScopeKind::Catch
                && (scope.children().next()).is_some_and(|it| it.get_name(name).is_some())
        };
        if (goes_through || functions_go_up && is_function())
            && scope.variable_scope().get_name(name).is_some()
            || is_in_block_of_catch()
        {
            names.insert(name);
        }
    }
    names
}

/// A declaration: where its name is, the name, and the scope that it is declared in.
type Found<'a> = (Span, Name<'a>, Declaration<'a>, Scope<'a>);

/// "Identifier `a` has already been declared"
pub(super) fn redeclarations<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    // Where no rule makes the variables of every file, the parser has looked out for a name that may be declared twice.
    if file.language().parser_tracks_names && !file.has_rare_syntax(rare::MAY_REDECLARE) {
        return Vec::new();
    }
    let mut all: Vec<Found<'a>> = Vec::new();
    #[expect(
        clippy::iter_over_hash_type,
        reason = "what is found is put in the order of the text below"
    )]
    for name in candidates(file) {
        for symbol in file.symbols_named(name) {
            let scope = symbol.scope();
            let named = symbol.declarations();
            all.extend(named.filter_map(|it| Some((it.name_span()?, name, it, scope))));
        }
    }
    if all.is_empty() {
        return Vec::new();
    }
    crate::utils::sort::sort_unstable_by_key(&mut all, |it| it.0.start);
    let mut binder = Binder {
        file,
        is_typescript: !file.is_javascript(),
        is_module: source_type(file) == SourceType::Module,
        top: file.top_level_scope().id().0,
        symbols: Vec::new(),
        bindings: FxHashMap::default(),
        hoisting: FxHashMap::default(),
        errors: Vec::new(),
    };
    for (span, name, declaration, scope) in all {
        binder.bind(declaration, scope, name, span);
    }
    binder.check_imports();
    binder.errors
}

/// The members of `class` that have the name of the member before them of that name: `check_duplicate_class_elements`, for
/// names that are not private.
fn repeated_members<'a>(class: Class<'a>, errors: &mut Vec<(u32, SyntaxError)>) {
    let file = class.file();
    let mut last: FxHashMap<&'a [u8], (Member<'a>, Span)> = FxHashMap::default();
    let is_accessor = |it: Member<'a>| matches!(it.kind(), MemberKind::Getter | MemberKind::Setter);
    let is_static = |it: Member<'a>| it.flags().contains(Flags::STATIC);
    // `PropertyKey::name`, and where the key is, without brackets.
    let name_of = |it: Member<'a>| {
        let Some(key) = it.key() else {
            let keyword = it.constructor_keyword()?;
            return Some((keyword.bytes(), keyword.span()));
        };
        let name = match key.kind() {
            KeyKind::Ident(name)
            | KeyKind::String(name)
            | KeyKind::Number(name)
            | KeyKind::ComputedString(name)
            | KeyKind::ComputedNumber(name) => name.bytes(),
            KeyKind::Computed(e) if !e.is_parenthesized() => match e.kind() {
                ExprKind::Null => &b"null"[..],
                ExprKind::BigInt(it) => {
                    (it.bytes().strip_suffix(b"n")).unwrap_or_else(|| it.bytes())
                }
                ExprKind::Regex(_) => e.text(),
                _ => return None,
            },
            _ => return None,
        };
        Some((name, key.inner_span(file)))
    };
    for member in class.members() {
        let is_element = match member.kind() {
            MemberKind::Property => true,
            // What has no body is only a type to oxc.
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                member.func().is_some_and(|it| it.has_body())
            }
            // `static constructor() {}` is a method.
            MemberKind::Constructor => {
                is_static(member) && member.func().is_some_and(|it| it.has_body())
            }
            _ => false,
        };
        let Some((name, second)) = name_of(member).filter(|_| is_element) else {
            continue;
        };
        let Some((before, first)) = last.insert(name, (member, second)) else {
            continue;
        };
        let is_pair = is_accessor(before) && is_accessor(member) && before.kind() != member.kind();
        if !is_pair && is_static(before) == is_static(member) {
            let error = SyntaxError::redeclared("Identifier", file.slice(first), first, second);
            errors.push((class.span().start, error.noticed_at(u32::MAX)));
        }
    }
}

/// Two members of a class with one name, in TypeScript. oxc looks for them when it is through with the file, class by class.
pub(super) fn class_members<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let hir = &file.hir;
    let mut errors: Vec<(u32, SyntaxError)> = Vec::new();
    if file.is_javascript() {
        return Vec::new();
    }
    for (i, raw) in hir.classes.iter().enumerate() {
        // The names by the low bits of their numbers. Two that share a bit can be one name, or a getter and its setter.
        let (mut seen, mut may_repeat) = ([0u64; 4], false);
        for it in hir.members.get(raw.members.range()).unwrap_or_default() {
            match it.key {
                hir::PropKey::Name(name) => {
                    let (word, bit) = (name.0 as usize >> 6 & 3, 1u64 << (name.0 & 63));
                    may_repeat |= seen[word] & bit != 0;
                    seen[word] |= bit;
                }
                // `1n`, which has the name of `1`.
                hir::PropKey::None => may_repeat |= it.flags.contains(Flags::LITERAL_NAME),
                // `[null]`, `[1n]` and `[/a/]` are names to oxc.
                hir::PropKey::Computed(e) => {
                    may_repeat |= matches!(
                        hir.exprs.get(e.idx()).map(|it| it.kind),
                        Some(hir::ExprKind::Null | hir::ExprKind::BigInt(_) | hir::ExprKind::Regex)
                    );
                }
                hir::PropKey::Private(_) => {}
            }
        }
        let class = Class::from_raw(file, i as u32);
        if may_repeat && class.is_in_tree() {
            repeated_members(class, &mut errors);
        }
    }
    crate::utils::sort::sort_by_key(&mut errors, |it| it.0);
    errors.into_iter().map(|it| it.1).collect()
}

/// `oxc_span::best_match`, two edits away at most. Of two that are as close it is the first.
pub(super) fn closest<'a>(
    needle: &[u8],
    candidates: impl Iterator<Item = &'a [u8]>,
) -> Option<&'a [u8]> {
    const THRESHOLD: usize = 2;
    let characters = |text: &[u8]| bstr::ByteSlice::chars(text).collect::<Vec<char>>();
    let needle_characters = characters(needle);
    let mut best: Option<(&'a [u8], usize)> = None;
    for candidate in candidates {
        if candidate.len().abs_diff(needle.len()) > THRESHOLD {
            continue;
        }
        let distance =
            bun_core::strings::edit_distance(characters(candidate).into_iter(), &needle_characters);
        if distance <= THRESHOLD && best.is_none_or(|it| distance < it.1) {
            best = Some((candidate, distance));
        }
    }
    best.map(|it| it.0)
}

/// What oxc says about the exports of a JavaScript module.
pub(super) fn exports<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if !file.has_rare_syntax(rare::ODD_EXPORT) {
        return Vec::new();
    }
    let mut errors = undeclared_exports(file);
    errors.extend(duplicate_exports(file));
    errors
}

/// `export { a }` where nothing declares `a`, which the pass that builds the scopes reports.
fn undeclared_exports<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let mut errors = Vec::new();
    if !file.is_javascript() || source_type(file) != SourceType::Module {
        return errors;
    }
    let top = file.top_level_scope();
    let mut names_in_order: Option<Vec<Name<'a>>> = None;
    for it in file.body() {
        let StmtKind::ExportNamed(list) = it.kind() else {
            continue;
        };
        for local in list.items().iter().map(|it| it.local()) {
            if list.has_from() || local.is_string() || top.get_name(local.name()).is_some() {
                continue;
            }
            let name = bstr::BStr::new(local.bytes());
            let message = format!("Export '{name}' is not defined").into_bytes();
            let names = names_in_order.get_or_insert_with(|| names_of_file_in_order_of_oxc(file));
            let names = names.iter().map(|it| it.bytes());
            let help = closest(local.bytes(), names).map_or(Cow::Borrowed(""), |it| {
                Cow::Owned(format!("Did you mean '{}'?", bstr::BStr::new(it)))
            });
            let error = SyntaxError::of_oxc(local.span(), message).help(help);
            errors.push(error.noticed_at(u32::MAX));
        }
    }
    errors
}

/// A name that a JavaScript module exports twice, and a second `default`. oxc's parser reports them when it is through with the
/// file, also with one that it has given up. Nothing is asked of the scopes, and the tree can have holes.
#[optimize(size)]
pub(super) fn duplicate_exports<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let mut errors = Vec::new();
    if !file.is_javascript() || source_type(file) != SourceType::Module {
        return errors;
    }
    let hir = &file.hir;
    // By a default import or a named one.
    let is_imported = |name: Name<'a>| {
        hir.imports.iter().any(|it| {
            let named = hir.import_specs.get(it.named.range()).unwrap_or_default();
            it.default == name.atom() || named.iter().any(|it| it.local == name.atom())
        })
    };
    // `ModuleRecord::exported_bindings`, and each name with the place that another has taken from it.
    let mut last: FxHashMap<&'a [u8], Span> = FxHashMap::default();
    let mut replaced: Vec<(&'a [u8], Span)> = Vec::new();
    // The `default`s of what the module exports itself, and of what it hands on from another.
    let (mut own_defaults, mut other_defaults): (Vec<Span>, Vec<Span>) = (Vec::new(), Vec::new());
    let mut export = |name: &'a [u8], span: Span| {
        if let Some(before) = last.insert(name, span) {
            replaced.push((name, before));
        }
    };
    let keyword_after = |export: u32| {
        let start = skip_trivia(file.text(), export + "export".len() as u32);
        Span::new(start, start + "default".len() as u32)
    };
    for it in file.body() {
        match it.kind() {
            StmtKind::ExportDefault(_) => own_defaults.push(keyword_after(it.span().start)),
            StmtKind::ExportStar {
                alias: Some(alias), ..
            } => {
                export(alias.bytes(), alias.span());
                if alias.bytes() == b"default" {
                    other_defaults.push(alias.span());
                }
            }
            StmtKind::ExportNamed(list) => {
                for item in list.items() {
                    let (local, exported) = (item.local(), item.exported());
                    export(exported.bytes(), exported.span());
                    if exported.bytes() == b"default" {
                        match list.has_from() || is_imported(local.name()) {
                            true => other_defaults.push(exported.span()),
                            false => own_defaults.push(exported.span()),
                        }
                    }
                }
            }
            _ if !it.is_exported() => {}
            _ if it.is_default_export() => {
                own_defaults.extend(it.export_span().map(|it| keyword_after(it.start)));
            }
            StmtKind::Var(list) => {
                for declaration in list {
                    declaration.pat().for_each_binding(&mut |it| {
                        if let PatKind::Ident(name) = it.kind() {
                            export(name.bytes(), it.span());
                        }
                    });
                }
            }
            StmtKind::Fn(func) => {
                if let Some(name) = func.name() {
                    export(name.bytes(), name.span());
                }
            }
            StmtKind::Class(class) => {
                if let Some(name) = class.name() {
                    export(name.bytes(), name.span());
                }
            }
            _ => {}
        }
    }
    for (name, before) in replaced {
        let Some(&after) = last.get(name) else {
            continue;
        };
        let message = format!("Duplicated export '{}'", bstr::BStr::new(name)).into_bytes();
        let error = SyntaxError::of_oxc(before, message)
            .says(Cow::Borrowed("Export has already been declared here"))
            .and(after, Cow::Borrowed("It cannot be redeclared here"));
        errors.push(error.stage(Stage::Parser).noticed_at(u32::MAX));
    }
    own_defaults.append(&mut other_defaults);
    if let [first, others @ ..] = &own_defaults[..]
        && !others.is_empty()
    {
        let message = b"A module cannot have multiple default exports.".to_vec();
        let mut error = SyntaxError::of_oxc(*first, message).code(2528);
        for &other in others {
            error = error.and(other, Cow::Borrowed(""));
        }
        errors.push(error.stage(Stage::Parser).noticed_at(u32::MAX));
    }
    errors
}

//! Redeclarations, found the way oxc's `SemanticBuilder` finds them.
//!
//! oxc gives each declaration flags, and a set of flags that it can't share a scope with (`SymbolFlags`, as in tsc's binder). It
//! declares in source order and reports a clash on the spot. For JavaScript it has further checks, which run when the
//! declaration ends. All of it is replayed here, on the few files in which the parser has seen that a name may be declared twice.

use super::{Stage, SyntaxError};
use crate::ast::{
    File, Flags, FnKind, Func, Module, ModuleName, Name, Node, PatKind, Stmt, StmtKind, VarKind,
};
use crate::language::SourceType;
use crate::semantic::{Declaration, Scope, ScopeKind};
use crate::span::Span;
use crate::tokens::skip_trivia;
use crate::utils::oxlint::{is_strict_mode, source_type};
use bun_sema::hir::rare;
use rustc_hash::FxHashMap;
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
    use super::flag::*;
    pub(super) const FUNCTION_SCOPED: u32 = VALUE & !(super::flag::FUNCTION_SCOPED | FUNCTION);
    pub(super) const BLOCK_SCOPED: u32 = VALUE;
    pub(super) const FUNCTION: u32 = VALUE & !(super::flag::FUNCTION | VALUE_MODULE | CLASS);
    pub(super) const CLASS: u32 =
        (VALUE | TYPE) & !(VALUE_MODULE | super::flag::FUNCTION | INTERFACE);
    pub(super) const IMPORT: u32 = super::flag::IMPORT | TYPE_IMPORT;
    pub(super) const TYPE_ALIAS: u32 = TYPE;
    pub(super) const INTERFACE: u32 = TYPE & !(super::flag::INTERFACE | super::flag::CLASS);
    pub(super) const TYPE_PARAMETER: u32 = TYPE & !super::flag::TYPE_PARAMETER;
    pub(super) const CONST_ENUM: u32 = (TYPE | VALUE) & !super::flag::CONST_ENUM;
    pub(super) const REGULAR_ENUM: u32 =
        (VALUE | TYPE) & !(super::flag::REGULAR_ENUM | VALUE_MODULE);
    pub(super) const ENUM_MEMBER: u32 = super::flag::ENUM_MEMBER;
    pub(super) const VALUE_MODULE: u32 = VALUE
        & !(super::flag::FUNCTION
            | super::flag::CLASS
            | super::flag::REGULAR_ENUM
            | super::flag::VALUE_MODULE);
}

/// One declaration of a symbol: its own flags, and where its name is.
#[derive(Copy, Clone)]
struct Declared {
    flags: u32,
    span: Span,
}

struct Symbol {
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
    symbols: Vec<Symbol>,
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
        let name = bstr::BStr::new(name.bytes());
        let message = format!("Identifier `{name}` has already been declared").into_bytes();
        let error = SyntaxError::of_oxc(first, message)
            .says(Cow::Owned(format!(
                "`{name}` has already been declared here"
            )))
            .and(second, Cow::Borrowed("It can not be redeclared here"));
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
        self.symbols.push(Symbol {
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
        crate::utils::sort::sort_unstable_by_key(&mut clashing, |it| it.1.start);
        for (name, first, last) in clashing {
            self.report(name, first, last, Some(u32::MAX));
        }
    }
}

fn import_flag(is_type_only: bool) -> u32 {
    match is_type_only {
        true => flag::TYPE_IMPORT,
        false => flag::IMPORT,
    }
}

/// "Identifier `a` has already been declared"
pub(super) fn redeclarations<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if !file.has_rare_syntax(rare::MAY_REDECLARE) {
        return Vec::new();
    }
    let mut all: Vec<(Span, Name<'a>, Declaration<'a>, Scope<'a>)> = Vec::new();
    for symbol in file.symbols() {
        let (name, scope) = (symbol.name(), symbol.scope());
        let named = symbol
            .declarations()
            .filter_map(|it| Some((it.name_span()?, name, it, scope)));
        all.extend(named);
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

/// `oxc_span::best_match`, two edits away at most. Of two that are as close, oxc takes the one that its hash table has first.
fn closest<'a>(needle: &[u8], candidates: impl Iterator<Item = &'a [u8]>) -> Option<&'a [u8]> {
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

/// What oxc says about the exports of a JavaScript module. Its parser reports a name that is exported twice when it is through
/// with the file. The pass that builds the scopes reports `export { a }` where nothing declares `a`.
pub(super) fn exports<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if !file.has_rare_syntax(rare::ODD_EXPORT)
        || !file.is_javascript()
        || source_type(file) != SourceType::Module
    {
        return Vec::new();
    }
    let mut errors = Vec::new();
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
    let top = file.top_level_scope();
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
                    let symbol = top.get_name(local.name()).filter(|_| !list.has_from());
                    let is_imported_name = symbol.is_some_and(|it| {
                        it.declarations().any(|it| {
                            matches!(
                                it,
                                Declaration::ImportDefault(_) | Declaration::ImportSpec(_)
                            )
                        })
                    });
                    if exported.bytes() == b"default" {
                        match list.has_from() || is_imported_name {
                            true => other_defaults.push(exported.span()),
                            false => own_defaults.push(exported.span()),
                        }
                    }
                    if !list.has_from() && symbol.is_none() && !local.is_string() {
                        let name = bstr::BStr::new(local.bytes());
                        let message = format!("Export '{name}' is not defined").into_bytes();
                        let names = top.symbols().map(|it| it.name().bytes());
                        let help = closest(local.bytes(), names).map_or(Cow::Borrowed(""), |it| {
                            Cow::Owned(format!("Did you mean '{}'?", bstr::BStr::new(it)))
                        });
                        let error = SyntaxError::of_oxc(local.span(), message).help(help);
                        errors.push(error.noticed_at(u32::MAX));
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

//! The check that the finished AST names no macro import outside of a call, and the walk that finds each such name.

use std::io::Write as _;

use bun_ast::expr::Data;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{self as ast, Expr, G, Loc, Ref, Stmt, StmtOrExpr, b::B};
use bun_collections::VecExt as _;

use crate::lexer as js_lexer;
use crate::parser::{MacroRefs, RuntimeFeatures};

/// Bun removes a macro import and replaces only its calls, so a name of it that the AST of the file still holds is an error. `_parse` halts on it.
#[cold]
#[inline(never)]
pub(crate) fn reject_macro_value_uses(
    refs: &MacroRefs<'_>,
    features: &RuntimeFeatures,
    ast: &ast::Ast<'_>,
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
) {
    // The visit pass counts each use outside of code that it knows is dead, and un-counts the target of each macro call. Only a call whose macro returned an Error can leave a name that runs with no count.
    let has_use = |r#ref: Ref| ast.symbols[r#ref.inner_index() as usize].use_count_estimate != 0;
    if !refs.keys().iter().any(|r#ref| has_use(*r#ref)) {
        return;
    }
    if features.is_macro_runtime {
        // No call is replaced inside a macro, so the transpiler cache must not keep this output for a load outside of one.
        #[cfg(not(target_arch = "wasm32"))]
        if bun_core::feature_flags::RUNTIME_TRANSPILER_CACHE {
            if let Some(cache) = features.runtime_transpiler_cache_mut() {
                cache.input_hash = None;
            }
        }
        return;
    }
    // With dead-code elimination off (`bun repl`, `bun -p`, `bun test --coverage`) the count has the code that never runs too.
    if !features.dead_code_elimination {
        return;
    }
    // The caller reads the imports and exports, or compares a re-print. The command that runs the file has the error.
    if features.output_never_runs {
        return;
    }
    let (located, is_cut) = locate_macro_refs(ast.parts.as_slice(), refs);
    let place = |at: u32| {
        let found = &located[at as usize];
        (found.loc.start, found.binding)
    };
    // In source order, which the log needs to find each line once. A decorated member's computed key is in the AST twice.
    let mut order = bun_collections::index_sort::identity(located.len());
    bun_collections::index_sort::sort_indices_unstable(&mut order, &mut |a, b| {
        place(a).cmp(&place(b))
    });
    order.dedup_by(|a, b| place(*a) == place(*b));
    // Dead code that the output keeps can name a macro import. Without a counted use that is not an error.
    order.retain(|at| has_use(refs.keys()[located[*at as usize].binding as usize]));

    let mut reporter = Reporter {
        refs,
        ast,
        source,
        log,
        // Elsewhere a call of a macro is an error of its own, so the advice does not name one.
        macros_run: !features.no_macros && !source.path.is_node_module(),
        bindings: (0..refs.count()).map(|_| Binding::default()).collect(),
    };
    for at in &order {
        reporter.bindings[located[*at as usize].binding as usize].is_named = true;
    }
    reporter.locate_imports();
    for at in order {
        reporter.report(located[at as usize]);
    }
    // The walk did not see every name. The printer stops on the same nesting.
    if is_cut {
        log.add_error(
            Some(source),
            Loc::EMPTY,
            b"Maximum call stack size exceeded",
        );
    }
}

#[derive(Default)]
struct Binding {
    /// An identifier in the AST names it, and the visit pass counted a use of it.
    is_named: bool,
    /// The note at the import. The first error of the binding takes it.
    import_note: Option<bun_ast::Data>,
}

/// What the messages say about the import of a binding.
struct Import<'r> {
    name: &'r [u8],
    /// The name of the export, which a macro remap can give a local name.
    export: &'r [u8],
    /// A macro remap replaced a plain import of a package.
    is_remapped: bool,
}

struct Reporter<'r, 'a> {
    refs: &'r MacroRefs<'a>,
    ast: &'r ast::Ast<'a>,
    source: &'r bun_ast::Source<'r>,
    log: &'r mut bun_ast::Log,
    macros_run: bool,
    bindings: Vec<Binding>,
}

impl<'r> Reporter<'r, '_> {
    fn import(&self, index: usize) -> Import<'r> {
        let (r#ref, data) = (self.refs.keys()[index], self.refs.values()[index]);
        let symbol = &self.ast.symbols[r#ref.inner_index() as usize];
        let name: &'r [u8] = symbol.original_name.slice();
        Import {
            name,
            export: data.name.unwrap_or(name),
            // Only a binding that a macro remap replaces is declared as an import.
            is_remapped: symbol.kind == ast::symbol::Kind::Import,
        }
    }

    /// The note at the import of each binding that is named. `refs` is in the order of the imports, so the log finds each line once.
    fn locate_imports(&mut self) {
        for index in 0..self.bindings.len() {
            if !self.bindings[index].is_named {
                continue;
            }
            let import = self.import(index);
            let (r#ref, data) = (self.refs.keys()[index], self.refs.values()[index]);
            let record = &self.ast.import_records.as_slice()[data.import_record_id as usize];
            let (name, path) = (
                bstr::BStr::new(import.name),
                bun_core::fmt::quote(record.path.text),
            );
            let mut removed = Vec::<u8>::new();
            let _ = if import.is_remapped {
                write!(
                    &mut removed,
                    "Bun removes this import of \"{name}\" because a macro remap replaces it with {path}"
                )
            } else {
                write!(
                    &mut removed,
                    "Bun removes this macro import of \"{name}\" from {path}"
                )
            };
            let range = match self.ast.module_scope.members.get(import.name) {
                Some(member) if member.ref_.eql(r#ref) => {
                    js_lexer::range_of_identifier(self.source, member.loc)
                }
                _ => bun_ast::Range::NONE,
            };
            let note = self
                .log
                .tracked_range_data(Some(self.source), range, removed);
            self.bindings[index].import_note = Some(note);
        }
    }

    /// An error at the identifier. The first error of a binding has the notes.
    fn report(&mut self, found: MacroRefUse) {
        let index = found.binding as usize;
        let import = self.import(index);
        let name = bstr::BStr::new(import.name);
        let mut notes = Vec::<bun_ast::Data>::new();
        if let Some(note) = self.bindings[index].import_note.take() {
            notes.push(note);
            let (replaced, inline, call): (&str, &str, &str) = match self.macros_run {
                true => (
                    "Bun replaces each direct call of a macro with its result. ",
                    "To inline a value, call a macro that returns it. ",
                    "To inline a value, call the macro directly. ",
                ),
                false => ("", "", ""),
            };
            let mut advice = Vec::<u8>::new();
            if found.is_jsx_name {
                let _ = write!(
                    &mut advice,
                    "\"{name}\" is the JSX factory or fragment of this file, so this element names it at runtime. "
                );
            }
            let _ = if import.is_remapped {
                let export = bun_core::fmt::quote(import.export);
                write!(
                    &mut advice,
                    "{replaced}To use {export} of the package at runtime, read it from a namespace import of the package, or remove the macro remap."
                )
            } else if found.is_jsx_name {
                write!(
                    &mut advice,
                    "{call}To use \"{name}\" at runtime, import the macro under another name, and add a regular import that declares \"{name}\"."
                )
            } else {
                write!(
                    &mut advice,
                    "{replaced}{inline}To use \"{name}\" at runtime, add a regular import of it under another name."
                )
            };
            notes.push(bun_ast::range_data(None, bun_ast::Range::NONE, advice));
        }

        self.log.add_range_error_fmt_with_notes(
            Some(self.source),
            js_lexer::range_of_identifier(self.source, found.loc),
            notes.into_boxed_slice(),
            format_args!("\"{name}\" is a macro import and is not defined at runtime"),
        );
    }
}

/// A type that is named before the import statement is an unbound symbol linked to the binding.
pub(crate) fn is_macro_ref(refs: &MacroRefs<'_>, symbols: &[ast::Symbol], r#ref: Ref) -> bool {
    refs.contains_key(&ast::symbol::follow_symbols(symbols, r#ref))
}

/// An identifier that still names a macro import.
#[derive(Clone, Copy)]
struct MacroRefUse {
    /// The index of the import in `refs`.
    binding: u32,
    loc: Loc,
    /// The parser wrote it: it is the factory or the fragment of a JSX element.
    is_jsx_name: bool,
}

struct Locator<'r, 'a> {
    refs: &'r MacroRefs<'a>,
    found: Vec<MacroRefUse>,
    /// Where the last JSX element starts. The parser puts the factory and the fragment of the element there.
    jsx_start: i32,
    /// The stack had no room for a part of the AST.
    is_cut: bool,
    stack_check: bun_core::StackCheck,
}

/// Each identifier that names a key of `refs`, in statement order, and whether the stack had no room for a part of the AST.
fn locate_macro_refs(parts: &[ast::Part], refs: &MacroRefs<'_>) -> (Vec<MacroRefUse>, bool) {
    let mut locator = Locator {
        refs,
        found: Vec::new(),
        jsx_start: i32::MIN,
        is_cut: false,
        stack_check: bun_core::StackCheck::init(),
    };
    for part in parts {
        locator.stmts(part.stmts.slice());
    }
    (locator.found, locator.is_cut)
}

impl Locator<'_, '_> {
    fn name(&mut self, r#ref: Ref, loc: Loc) {
        if let Some(binding) = self.refs.get_index(&r#ref) {
            self.found.push(MacroRefUse {
                binding: binding as u32,
                loc,
                is_jsx_name: loc.start == self.jsx_start,
            });
        }
    }

    fn has_stack(&mut self) -> bool {
        let has_stack = self.stack_check.is_safe_to_recurse();
        self.is_cut |= !has_stack;
        has_stack
    }

    fn optional_expr(&mut self, expr: Option<&Expr>) {
        if let Some(expr) = expr {
            self.expr(expr);
        }
    }

    fn exprs(&mut self, exprs: &[Expr]) {
        for expr in exprs {
            self.expr(expr);
        }
    }

    fn stmts(&mut self, stmts: &[Stmt]) {
        for stmt in stmts {
            self.stmt(stmt);
        }
    }

    fn binding(&mut self, binding: &ast::Binding) {
        if !self.has_stack() {
            return;
        }
        match &binding.data {
            B::BIdentifier(_) | B::BMissing(_) => {}
            B::BArray(array) => {
                for item in array.items() {
                    self.binding(&item.binding);
                    self.optional_expr(item.default_value.as_ref());
                }
            }
            B::BObject(object) => {
                for property in object.properties() {
                    self.expr(&property.key);
                    self.binding(&property.value);
                    self.optional_expr(property.default_value.as_ref());
                }
            }
        }
    }

    fn args(&mut self, args: &[G::Arg]) {
        for arg in args {
            self.binding(&arg.binding);
            self.optional_expr(arg.default.as_ref());
        }
    }

    fn func(&mut self, func: &G::Fn) {
        self.args(func.args.slice());
        self.stmts(func.body.stmts.slice());
    }

    fn properties(&mut self, properties: &[G::Property]) {
        for property in properties {
            if let Some(block) = property.class_static_block_ref() {
                self.stmts(block.stmts.as_slice());
            }
            self.optional_expr(property.key.as_ref());
            self.optional_expr(property.value.as_ref());
            self.optional_expr(property.initializer.as_ref());
        }
    }

    /// Not `ts_decorators`, here and in `args` and `properties`: the printer never prints them. The visit pass moves each list that runs to a place that this walk reads.
    fn class(&mut self, class: &G::Class) {
        self.optional_expr(class.extends.as_ref());
        self.properties(class.properties.slice());
    }

    fn stmt(&mut self, stmt: &Stmt) {
        if self.has_stack() {
            self.stmt_inner(stmt);
        }
    }

    fn stmt_inner(&mut self, stmt: &Stmt) {
        // `else if` after `else if` is as deep as it is long.
        let mut stmt = stmt;
        while let StmtData::SIf(s) = &stmt.data {
            self.expr(&s.test);
            self.stmt(&s.yes);
            match &s.no {
                Some(no) => stmt = no,
                None => return,
            }
        }
        match &stmt.data {
            StmtData::SIf(_) => unreachable!("the loop above ends at what is not one"),
            StmtData::SBlock(s) => self.stmts(s.stmts.slice()),
            StmtData::SExpr(s) => self.expr(&s.value),
            StmtData::SLocal(s) => {
                for decl in s.decls.iter() {
                    self.binding(&decl.binding);
                    self.optional_expr(decl.value.as_ref());
                }
            }
            StmtData::SReturn(s) => self.optional_expr(s.value.as_ref()),
            StmtData::SThrow(s) => self.expr(&s.value),
            StmtData::SFor(s) => {
                if let Some(init) = &s.init {
                    self.stmt(init);
                }
                self.optional_expr(s.test.as_ref());
                self.optional_expr(s.update.as_ref());
                self.stmt(&s.body);
            }
            StmtData::SForIn(s) => {
                self.stmt(&s.init);
                self.expr(&s.value);
                self.stmt(&s.body);
            }
            StmtData::SForOf(s) => {
                self.stmt(&s.init);
                self.expr(&s.value);
                self.stmt(&s.body);
            }
            StmtData::SWhile(s) => {
                self.expr(&s.test);
                self.stmt(&s.body);
            }
            StmtData::SDoWhile(s) => {
                self.stmt(&s.body);
                self.expr(&s.test);
            }
            StmtData::SSwitch(s) => {
                self.expr(&s.test);
                for case in s.cases.slice() {
                    self.optional_expr(case.value.as_ref());
                    self.stmts(case.body.slice());
                }
            }
            StmtData::STry(s) => {
                self.stmts(s.body.slice());
                if let Some(catch) = &s.catch {
                    if let Some(binding) = &catch.binding {
                        self.binding(binding);
                    }
                    self.stmts(catch.body.slice());
                }
                if let Some(finally) = &s.finally {
                    self.stmts(finally.stmts.slice());
                }
            }
            StmtData::SLabel(s) => self.stmt(&s.stmt),
            StmtData::SWith(s) => {
                self.expr(&s.value);
                self.stmt(&s.body);
            }
            StmtData::SFunction(s) => self.func(&s.func),
            StmtData::SClass(s) => self.class(&s.class),
            StmtData::SExportDefault(s) => match &s.value {
                StmtOrExpr::Stmt(stmt) => self.stmt(stmt),
                StmtOrExpr::Expr(expr) => self.expr(expr),
            },
            StmtData::SExportClause(s) => {
                for item in s.items.slice() {
                    self.name(item.name.ref_, item.name.loc);
                }
            }
            // The visit pass lowers the first three of these.
            StmtData::SEnum(_)
            | StmtData::SExportEquals(_)
            | StmtData::SNamespace(_)
            | StmtData::SBreak(_)
            | StmtData::SComment(_)
            | StmtData::SContinue(_)
            | StmtData::SDebugger(_)
            | StmtData::SDirective(_)
            | StmtData::SEmpty(_)
            | StmtData::SExportFrom(_)
            | StmtData::SExportStar(_)
            | StmtData::SImport(_)
            | StmtData::SLazyExport(_)
            | StmtData::STypeScript(_) => {}
        }
    }

    fn expr(&mut self, expr: &Expr) {
        if self.has_stack() {
            self.expr_inner(expr);
        }
    }

    fn expr_inner(&mut self, expr: &Expr) {
        // `a + b + c + ...` and `a.b().c()...` are as deep as they are long: their links wait here, not on the stack.
        let mut chain: Vec<&Expr> = Vec::new();
        let mut expr = expr;
        loop {
            expr = match &expr.data {
                Data::EBinary(e) => {
                    chain.push(expr);
                    &e.left
                }
                Data::EDot(e) => &e.target,
                Data::EIndex(e) => {
                    chain.push(expr);
                    &e.target
                }
                Data::ECall(e) => {
                    if e.was_jsx_element {
                        self.jsx_start = expr.loc.start;
                    }
                    chain.push(expr);
                    &e.target
                }
                _ => break,
            };
        }
        self.expr_outside_chain(expr);
        while let Some(link) = chain.pop() {
            match &link.data {
                Data::EBinary(e) => self.expr(&e.right),
                Data::EIndex(e) => self.expr(&e.index),
                Data::ECall(e) => self.exprs(e.args.slice()),
                _ => unreachable!("only these are pushed"),
            }
        }
    }

    fn expr_outside_chain(&mut self, expr: &Expr) {
        match &expr.data {
            Data::EBinary(_) | Data::EDot(_) | Data::EIndex(_) | Data::ECall(_) => {
                unreachable!("the loop in `expr_inner` ends at what is none of these")
            }
            Data::EIdentifier(e) => self.name(e.ref_, expr.loc),
            Data::EImportIdentifier(e) => self.name(e.ref_, expr.loc),
            Data::EUnary(e) => self.expr(&e.value),
            Data::ENew(e) => {
                self.expr(&e.target);
                self.exprs(e.args.slice());
            }
            Data::EArrow(e) => {
                self.args(e.args.slice());
                self.stmts(e.body.stmts.slice());
            }
            Data::EFunction(e) => self.func(&e.func),
            Data::EClass(e) => self.class(e),
            Data::EArray(e) => self.exprs(e.items.slice()),
            Data::EObject(e) => self.properties(e.properties.slice()),
            Data::ESpread(e) => self.expr(&e.value),
            Data::EIf(e) => {
                // `a ? b : c ? d : ...` is as deep to the right as it is long.
                let mut e = e;
                loop {
                    self.expr(&e.test);
                    self.expr(&e.yes);
                    match &e.no.data {
                        Data::EIf(no) => e = no,
                        _ => break self.expr(&e.no),
                    }
                }
            }
            Data::EImport(e) => {
                self.expr(&e.expr);
                self.expr(&e.options);
            }
            Data::EAwait(e) => self.expr(&e.value),
            Data::EYield(e) => self.optional_expr(e.value.as_ref()),
            Data::ETemplate(e) => {
                self.optional_expr(e.tag.as_ref());
                for part in e.parts() {
                    self.expr(&part.value);
                }
            }
            // The visit pass lowers `EJsxElement`, and an `EInlinedEnum` holds a literal.
            Data::EArrayJSON(_)
            | Data::EBigInt(_)
            | Data::EBoolean(_)
            | Data::EBranchBoolean(_)
            | Data::ECommonjsExportIdentifier(_)
            | Data::EImportMeta(_)
            | Data::EImportMetaMain(_)
            | Data::EInlinedEnum(_)
            | Data::EJsxElement(_)
            | Data::EMissing(_)
            | Data::ENameOfSymbol(_)
            | Data::ENewTarget(_)
            | Data::ENull(_)
            | Data::ENumber(_)
            | Data::EObjectJSON(_)
            | Data::EPrivateIdentifier(_)
            | Data::ERegExp(_)
            | Data::ERequireCallTarget
            | Data::ERequireMain
            | Data::ERequireResolveCallTarget
            | Data::ERequireResolveString(_)
            | Data::ERequireString(_)
            | Data::ESpecial(_)
            | Data::EString(_)
            | Data::ESuper(_)
            | Data::EThis(_)
            | Data::EUndefined(_) => {}
        }
    }
}

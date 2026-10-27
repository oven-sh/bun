//! The check that no use of a macro import is left outside of a call, and the walk that finds where such a use is.

use std::io::Write as _;

use bun_ast::expr::Data;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{self as ast, Expr, G, Loc, Ref, Stmt, StmtOrExpr, b::B};
use bun_collections::VecExt as _;

use crate::lexer as js_lexer;
use crate::parser::{MacroRefs, RuntimeFeatures};

/// A replaced macro call un-counts its target, so a use that `ast` still counts is an error. `_parse` halts on it.
#[cold]
#[inline(never)]
pub(crate) fn reject_macro_value_uses(
    refs: &MacroRefs<'_>,
    features: &RuntimeFeatures,
    ast: &ast::Ast<'_>,
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
) {
    let has_use = |r#ref: Ref| ast.symbols[r#ref.inner_index() as usize].use_count_estimate != 0;
    if !refs.keys().iter().any(|r#ref| has_use(*r#ref)) {
        return;
    }
    if features.is_macro_runtime {
        // No call is replaced inside a macro, so this output must not answer a load outside of one.
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
    let located = locate_macro_refs(ast.parts.as_slice(), refs);
    let place = |at: u32| {
        let found = &located[at as usize];
        (found.loc.start, found.r#ref.inner_index())
    };
    // In source order. The visit pass copies the computed key of a decorated member, so the walk finds that identifier twice.
    let mut order = bun_collections::index_sort::identity(located.len());
    bun_collections::index_sort::sort_indices_unstable(&mut order, &mut |a, b| {
        place(a).cmp(&place(b))
    });
    order.dedup_by(|a, b| place(*a) == place(*b));
    let mut reporter = Reporter {
        refs,
        ast,
        source,
        log,
        // Elsewhere a call of a macro is an error of its own, so the advice does not name one.
        macros_run: !features.no_macros && !source.path.is_node_module(),
        bindings: (0..refs.count()).map(|_| Binding::default()).collect(),
    };
    for at in order {
        let found = located[at as usize];
        if has_use(found.r#ref) {
            reporter.report(found.r#ref, Some(found.loc));
        }
    }
    // The visit pass can count a use and then fold its node away.
    for r#ref in refs.keys() {
        if has_use(*r#ref) {
            reporter.report(*r#ref, None);
        }
    }
}

#[derive(Default)]
struct Binding {
    /// The note at the import. Its place in the source is found once for all of the errors of the binding.
    import_note: Option<bun_ast::Data>,
    has_error: bool,
}

struct Reporter<'r, 'a> {
    refs: &'r MacroRefs<'a>,
    ast: &'r ast::Ast<'a>,
    source: &'r bun_ast::Source<'r>,
    log: &'r mut bun_ast::Log,
    macros_run: bool,
    bindings: Vec<Binding>,
}

impl Reporter<'_, '_> {
    /// An error at `at`, or at the import when no identifier is left and the binding has no error yet.
    fn report(&mut self, r#ref: Ref, at: Option<Loc>) {
        let index = self.refs.get_index(&r#ref).expect("a key of the map");
        let is_first = !self.bindings[index].has_error;
        if at.is_none() && !is_first {
            return;
        }
        self.bindings[index].has_error = true;

        let data = self.refs.values()[index];
        let symbol = &self.ast.symbols[r#ref.inner_index() as usize];
        let name: &[u8] = symbol.original_name.slice();
        // Only a binding that a macro remap replaces is declared as an import.
        let is_remapped = symbol.kind == ast::symbol::Kind::Import;
        let import_range = match self.ast.module_scope.members.get(name) {
            Some(member) if member.ref_.eql(r#ref) => {
                js_lexer::range_of_identifier(self.source, member.loc)
            }
            _ => bun_ast::Range::NONE,
        };
        // The JSX factory and fragment are names that the source does not write at the element.
        let is_written = at.is_none_or(|loc| {
            self.source
                .contents
                .get(loc.start as usize..)
                .is_some_and(|rest| rest.starts_with(name))
        });
        let path = self.ast.import_records.as_slice()[data.import_record_id as usize]
            .path
            .text;
        let export = bstr::BStr::new(data.name.unwrap_or(name));
        let (name, path) = (bstr::BStr::new(name), bstr::BStr::new(path));

        let mut notes = Vec::<bun_ast::Data>::with_capacity(2);
        if at.is_some() {
            let source = self.source;
            let note = self.bindings[index].import_note.get_or_insert_with(|| {
                let mut removed = Vec::<u8>::new();
                let _ = if is_remapped {
                    write!(
                        &mut removed,
                        "Bun removes this import of \"{name}\" because a macro remap replaces it with \"{path}\""
                    )
                } else {
                    write!(
                        &mut removed,
                        "Bun removes this macro import of \"{name}\" from \"{path}\""
                    )
                };
                bun_ast::range_data(Some(source), import_range, removed)
            });
            notes.push(note.clone());
        }
        if is_first {
            let mut advice = Vec::<u8>::new();
            if self.macros_run {
                advice.extend_from_slice(
                    b"Bun replaces each direct call of a macro with its result. ",
                );
            }
            let _ = if !is_written {
                write!(
                    &mut advice,
                    "\"{name}\" is the JSX factory or fragment of this file, so each JSX element names it. Import the macro under another name."
                )
            } else if is_remapped {
                write!(
                    &mut advice,
                    "To use \"{export}\" of the package at runtime, read it from a namespace import of the package, or remove the macro remap."
                )
            } else if self.macros_run {
                write!(
                    &mut advice,
                    "To inline a value, call a macro that returns it. To use \"{name}\" at runtime, add a regular import of it under another name."
                )
            } else {
                write!(
                    &mut advice,
                    "To use \"{name}\" at runtime, add a regular import of it under another name."
                )
            };
            notes.push(bun_ast::range_data(None, bun_ast::Range::NONE, advice));
        }

        match at {
            Some(loc) => self.log.add_range_error_fmt_with_notes(
                Some(self.source),
                js_lexer::range_of_identifier(self.source, loc),
                notes.into_boxed_slice(),
                format_args!("\"{name}\" is a macro import and is not defined at runtime"),
            ),
            None => self.log.add_range_error_fmt_with_notes(
                Some(self.source),
                import_range,
                notes.into_boxed_slice(),
                format_args!(
                    "\"{name}\" is a macro import and is not defined at runtime, but this file uses it outside of a call"
                ),
            ),
        }
    }
}

/// A type that is named before the import statement is an unbound symbol linked to the binding.
pub(crate) fn is_macro_ref(refs: &MacroRefs<'_>, symbols: &[ast::Symbol], r#ref: Ref) -> bool {
    refs.contains_key(&ast::symbol::follow_symbols(symbols, r#ref))
}

/// Fits the smallest stack this runs on, as `function_identities::MAX_DEPTH` does.
const MAX_DEPTH: u32 = 512;

/// An identifier that still names a macro import.
#[derive(Clone, Copy)]
struct MacroRefUse {
    r#ref: Ref,
    loc: Loc,
}

struct Locator<'r, 'a> {
    refs: &'r MacroRefs<'a>,
    found: Vec<MacroRefUse>,
    depth: u32,
    stack_check: bun_core::StackCheck,
}

/// Each identifier that names a key of `refs`, in statement order. One nested deeper than `MAX_DEPTH` is not in it.
fn locate_macro_refs(parts: &[ast::Part], refs: &MacroRefs<'_>) -> Vec<MacroRefUse> {
    let mut locator = Locator {
        refs,
        found: Vec::new(),
        depth: 0,
        stack_check: bun_core::StackCheck::init(),
    };
    for part in parts {
        locator.stmts(part.stmts.slice());
    }
    locator.found
}

impl Locator<'_, '_> {
    fn name(&mut self, r#ref: Ref, loc: Loc) {
        if self.refs.contains_key(&r#ref) {
            self.found.push(MacroRefUse { r#ref, loc });
        }
    }

    /// Every `enter` that says yes is followed by a `leave`.
    fn enter(&mut self) -> bool {
        if self.depth >= MAX_DEPTH || !self.stack_check.is_safe_to_recurse() {
            return false;
        }
        self.depth += 1;
        true
    }

    #[inline]
    fn leave(&mut self) {
        self.depth -= 1;
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
        if !self.enter() {
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
        self.leave();
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

    /// Not `ts_decorators`, here and in `args` and `properties`: the visit pass copies them into the calls it makes.
    fn class(&mut self, class: &G::Class) {
        self.optional_expr(class.extends.as_ref());
        self.properties(class.properties.slice());
    }

    fn stmt(&mut self, stmt: &Stmt) {
        if self.enter() {
            self.stmt_at_depth(stmt);
            self.leave();
        }
    }

    fn stmt_at_depth(&mut self, stmt: &Stmt) {
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
        if self.enter() {
            self.expr_at_depth(expr);
            self.leave();
        }
    }

    fn expr_at_depth(&mut self, expr: &Expr) {
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
                unreachable!("the loop in `expr_at_depth` ends at what is none of these")
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

//! Helpers that are imported instead of emitted: 2343 2354 2807, and 2306 for a `tslib` that is no module.
//!
//! With `importHelpers`, what the target does not have is emitted as calls of functions imported from `tslib`, and they have to be
//! there. Follows `checkExternalEmitHelpers`, `resolveHelpersModule`, `getHelperNames` and whatever calls the first, of TypeScript
//! 7.0.2's checker.go.
//!
//! A file asks for each helper once, where `checkSourceFile` first comes upon syntax that needs it. So the places that ask are
//! collected and put in the order it gets to them: as they are written, but for what `checkNodeDeferred` puts off until all else
//! is checked. An expression that is checked ahead of its turn, because its type is asked for, is taken in its turn here.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent};
use crate::resolve::{ModuleKind, ScriptTarget};

// `ExternalEmitHelpers`, but for the two nothing asks for.
const REST: u32 = 1 << 0;
const DECORATE: u32 = 1 << 1;
const METADATA: u32 = 1 << 2;
const PARAM: u32 = 1 << 3;
const AWAITER: u32 = 1 << 4;
const AWAIT: u32 = 1 << 5;
const ASYNC_GENERATOR: u32 = 1 << 6;
const ASYNC_DELEGATOR: u32 = 1 << 7;
const ASYNC_VALUES: u32 = 1 << 8;
const EXPORT_STAR: u32 = 1 << 9;
const IMPORT_STAR: u32 = 1 << 10;
const IMPORT_DEFAULT: u32 = 1 << 11;
const CLASS_PRIVATE_FIELD_GET: u32 = 1 << 13;
const CLASS_PRIVATE_FIELD_SET: u32 = 1 << 14;
const CLASS_PRIVATE_FIELD_IN: u32 = 1 << 15;
const SET_FUNCTION_NAME: u32 = 1 << 16;
const PROP_KEY: u32 = 1 << 17;
const ADD_DISPOSABLE_RESOURCE_AND_DISPOSE_RESOURCES: u32 = 1 << 18;

/// `externalHelpersModuleNameText`
const TSLIB: &str = "tslib";

/// `getHelperNames`
fn helper_names(helper: u32, legacy_decorators: bool) -> &'static [&'static str] {
    match helper {
        REST => &["__rest"],
        DECORATE if legacy_decorators => &["__decorate"],
        DECORATE => &["__esDecorate", "__runInitializers"],
        METADATA => &["__metadata"],
        PARAM => &["__param"],
        AWAITER => &["__awaiter"],
        AWAIT => &["__await"],
        ASYNC_GENERATOR => &["__asyncGenerator"],
        ASYNC_DELEGATOR => &["__asyncDelegator"],
        ASYNC_VALUES => &["__asyncValues"],
        EXPORT_STAR => &["__exportStar"],
        IMPORT_STAR => &["__importStar"],
        IMPORT_DEFAULT => &["__importDefault"],
        CLASS_PRIVATE_FIELD_GET => &["__classPrivateFieldGet"],
        CLASS_PRIVATE_FIELD_SET => &["__classPrivateFieldSet"],
        CLASS_PRIVATE_FIELD_IN => &["__classPrivateFieldIn"],
        SET_FUNCTION_NAME => &["__setFunctionName"],
        PROP_KEY => &["__propKey"],
        ADD_DISPOSABLE_RESOURCE_AND_DISPOSE_RESOURCES => {
            &["__addDisposableResource", "__disposeResources"]
        }
        _ => &[],
    }
}

/// A call of `checkExternalEmitHelpers`.
#[derive(Copy, Clone)]
struct Request {
    /// How many times checking is put off on the way there, and where in the file it is got to.
    order: (u32, u32),
    /// `GetErrorRangeForNode` of the location.
    start: u32,
    end: u32,
    helpers: u32,
}

impl Checker<'_> {
    pub(super) fn check_external_emit_helpers(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let (options, module) = (&files.options, files.module(file));
        // `IsEffectiveExternalModule`. All of a declaration file is ambient.
        let is_commonjs_module = module.is_commonjs()
            && (options.module == ModuleKind::CommonJs || options.module.is_node());
        if !options.import_helpers
            || module.hir.kind == FileKind::Declaration
            || !(module.hir.has_module_syntax || is_commonjs_module)
        {
            return;
        }
        let mut requests = self.eh_requests(file);
        requests.sort_by_key(|request| request.order);
        // `externalHelpersModule`, `requestedExternalEmitHelpers`
        let (mut resolved, mut requested) = (None, 0);
        for request in requests {
            // `checkWithStatement` does not look at the body.
            if module.hir.is_in_with(request.start) {
                continue;
            }
            let found =
                *resolved.get_or_insert_with(|| self.eh_resolve_helpers_module(file, request, out));
            let Some(helpers_module) = found else {
                return;
            };
            let unchecked = request.helpers & !requested;
            requested |= request.helpers;
            let helpers = (0..u32::BITS).map(|bit| 1u32 << bit);
            for helper in helpers.filter(|&helper| unchecked & helper != 0) {
                for &name in helper_names(helper, options.experimental_decorators) {
                    let symbol = files
                        .atoms
                        .lookup(name.as_bytes())
                        .and_then(|name| files.module_export(helpers_module, name))
                        .filter(|&symbol| files.means(symbol, SymFlags::VALUE));
                    let mut args = vec![TSLIB.to_owned(), name.to_owned()];
                    let code = match symbol {
                        None => 2343,
                        Some(symbol) => {
                            let arity = match helper {
                                CLASS_PRIVATE_FIELD_GET => 3,
                                CLASS_PRIVATE_FIELD_SET => 4,
                                _ => continue,
                            };
                            if self.eh_has_signature_with_arity_greater_than(symbol, arity) {
                                continue;
                            }
                            args.push((arity + 1).to_string());
                            2807
                        }
                    };
                    out.push(Diagnostic {
                        start: request.start,
                        code,
                    });
                    // One place may miss several helpers.
                    self.explain_another(request.start, request.end, code, |_| args);
                }
            }
        }
    }

    /// `resolveHelpersModule`, and `resolveExternalModule` for the import of `tslib` the loader made up. Nothing is said of a `tslib`
    /// that is JavaScript nothing declares the types of (`errorOnImplicitAnyModule`).
    fn eh_resolve_helpers_module(
        &self,
        file: FileId,
        request: Request,
        out: &mut Vec<Diagnostic>,
    ) -> Option<Sym> {
        let files = self.files();
        let (tslib, module) = (files.atoms.intern_str(TSLIB), files.module(file));
        let mode = module.default_mode;
        if let Some(found) = files.module_of_specifier_as(file, tslib, mode) {
            return Some(found);
        }
        let (code, args) = match module.imports.get(&(tslib, mode)) {
            Some(&target) => (2306, vec![files.module(target).path.clone()]),
            None if module.untyped_imports.contains(&(tslib, mode)) => return None,
            None => (2354, vec![TSLIB.to_owned()]),
        };
        out.push(Diagnostic {
            start: request.start,
            code,
        });
        self.note(request.start, request.end, code, args);
        None
    }

    /// `hasSignatureWithArityGreaterThan`, of what `symbol` stands for (`resolveSymbol`).
    fn eh_has_signature_with_arity_greater_than(&mut self, symbol: Sym, arity: usize) -> bool {
        let files = self.files();
        let flags = files.flags(symbol);
        // `IsNonLocalAlias`
        let is_alias = flags.contains(SymFlags::ALIAS)
            && !flags.intersects(SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE);
        let target = if is_alias {
            files.resolve_alias(symbol)
        } else {
            Some(symbol)
        };
        let Some(target) = target else {
            return false;
        };
        // `getSignaturesOfSymbol`
        let decls = files.decls(target);
        for (i, &(file, decl)) in decls.iter().enumerate() {
            let Decl::Fn(f) = decl else {
                continue;
            };
            if i > 0 && self.eh_implements_what_is_before(file, f, decls[i - 1]) {
                continue;
            }
            let sig = self.sig_of_declaration(file, f);
            let params = self.sig_params(sig);
            if self.parameter_count(&params) > arity {
                return true;
            }
        }
        false
    }

    /// `getSignaturesOfSymbol`: whether the function `f` has a body and starts where `previous`, another declaration of it, ends.
    fn eh_implements_what_is_before(
        &self,
        file: FileId,
        f: FnId,
        previous: (FileId, Decl),
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if previous.0 != file || matches!(hir[f].body, FnBody::None) {
            return false;
        }
        let Decl::Fn(before) = previous.1 else {
            return false;
        };
        let (FnOwner::Stmt(before), FnOwner::Stmt(s)) =
            (bound.fns[before.idx()].owner, bound.fns[f.idx()].owner)
        else {
            return false;
        };
        before.is_some()
            && s.is_some()
            && bound.stmt_parent[before.idx()] == bound.stmt_parent[s.idx()]
            && self.end_of_stmt(file, before) == self.end_of_token_before(file, hir[s].pos)
    }

    // ───────────────────────────── who asks ─────────────────────────────

    fn eh_requests(&mut self, file: FileId) -> Vec<Request> {
        // `GetEmitScriptTarget`
        let target = match self.files().options.target {
            ScriptTarget::None => ScriptTarget::ES2025,
            target => target,
        };
        let index = self.exprs_by_kind(file);
        let mut requests = Vec::new();
        self.eh_of_async_functions(file, target, &index, &mut requests);
        self.eh_of_statements(file, target, &mut requests);
        self.eh_of_rest_elements(file, target, &index, &mut requests);
        self.eh_of_decorators(file, target, &mut requests);
        self.eh_of_class_expressions(file, target, &mut requests);
        self.eh_of_private_names(file, target, &index, &mut requests);
        requests
    }

    /// How many times `checkNodeDeferred` puts off what is directly in `at`. Checked later are the body of a function expression, of
    /// an arrow function and of a method of an object literal, all of an accessor of an object literal, the members of a class
    /// expression, the operand of `void`, and what is in a JSX element. `None`: it is ambient (`NodeFlagsAmbient`), or it is not
    /// kept track of what it is in.
    fn eh_place(&self, file: FileId, mut at: Parent) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut put_off = 0;
        loop {
            at = match at {
                Parent::File => return Some(put_off),
                Parent::Module(m) => {
                    return (!hir[m].flags.contains(Flags::AMBIENT)).then_some(put_off);
                }
                Parent::VarInit(d) if hir[d].flags.contains(Flags::AMBIENT) => return None,
                Parent::PropKey(owner, _) if owner.is_some() => Parent::Expr(owner),
                Parent::FnBody(f) => self.eh_out_of_fn(file, f, false, &mut put_off)?,
                Parent::ParamDefault(p) | Parent::Decorator(_, DecoratorOwner::Param(p)) => {
                    self.eh_out_of_fn(file, bound.param_fn[p.idx()], true, &mut put_off)?
                }
                Parent::MemberInit(m) | Parent::Decorator(_, DecoratorOwner::Member(m)) => {
                    let MemberOwner::Class(class) = bound.member_owner[m.idx()] else {
                        return None;
                    };
                    if hir[m].flags.contains(Flags::AMBIENT) {
                        return None;
                    }
                    if let ClassOwner::Expr(_) = bound.class_owner[class.idx()] {
                        put_off += 1;
                    }
                    Parent::ClassExtends(class)
                }
                Parent::ClassExtends(class)
                | Parent::Decorator(class, DecoratorOwner::Class(_)) => {
                    if hir[class].flags.contains(Flags::AMBIENT) {
                        return None;
                    }
                    self.outward(file, Parent::ClassExtends(class))
                }
                Parent::None
                | Parent::PropKey(..)
                | Parent::PatKey(_)
                | Parent::MemberKey(_)
                | Parent::MethodKey(_)
                | Parent::EnumInit(_) => {
                    return None;
                }
                Parent::Expr(e) if e.is_none() => return None,
                Parent::Expr(e) => {
                    put_off += match hir[e].kind {
                        ExprKind::Unary { op: UnOp::Void, .. } => 1,
                        ExprKind::Jsx(element) if hir[element].tag.is_some() => 1,
                        _ => 0,
                    };
                    bound.expr_parent[e.idx()]
                }
                Parent::Stmt(s) if s.is_none() => return None,
                other => self.outward(file, other),
            };
        }
    }

    /// `eh_place`, one step: out of the function `f`, from its parameters (`is_head`) or from its body.
    fn eh_out_of_fn(
        &self,
        file: FileId,
        f: FnId,
        is_head: bool,
        put_off: &mut u32,
    ) -> Option<Parent> {
        if f.is_none() {
            return None;
        }
        let func = &self.hir(file)[f];
        if func.flags.contains(Flags::AMBIENT) {
            return None;
        }
        match self.bound(file).fns[f.idx()].owner {
            FnOwner::Expr(e) => {
                if !is_head || matches!(func.kind, FnKind::Getter | FnKind::Setter) {
                    *put_off += 1;
                }
                Some(Parent::Expr(e))
            }
            FnOwner::Stmt(s) => Some(Parent::Stmt(s)),
            FnOwner::Member(m) => Some(Parent::MemberInit(m)),
            _ => None,
        }
    }

    /// `checkSignatureDeclaration`, `checkYieldExpression`
    fn eh_of_async_functions(
        &self,
        file: FileId,
        target: ScriptTarget,
        index: &ExprsByKind,
        requests: &mut Vec<Request>,
    ) {
        if target >= ScriptTarget::ES2018 {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (i, func) in hir.fns.iter().enumerate() {
            // `GetFunctionFlags`
            if !func.flags.contains(Flags::ASYNC)
                || !matches!(
                    func.kind,
                    FnKind::Decl | FnKind::Expr | FnKind::Method | FnKind::Arrow
                )
                || matches!(func.body, FnBody::None) && !func.flags.contains(Flags::MISSING_BODY)
            {
                continue;
            }
            let helpers = if func.flags.contains(Flags::GENERATOR) && func.kind != FnKind::Arrow {
                AWAIT | ASYNC_GENERATOR
            } else if target < ScriptTarget::ES2017 {
                AWAITER
            } else {
                continue;
            };
            let f = FnId(i as u32);
            let mut put_off = 0;
            let Some(place) = self
                .eh_out_of_fn(file, f, true, &mut put_off)
                .and_then(|around| self.eh_place(file, around))
            else {
                continue;
            };
            let (start, end) = self.error_range_of_fn(file, f);
            requests.push(Request {
                order: (place + put_off, start),
                start,
                end,
                helpers,
            });
        }
        for &e in index.of(ExprTag::Yield) {
            if matches!(hir[e].kind, ExprKind::Yield { star: true, .. })
                && self
                    .containing_generator(file, e)
                    .is_some_and(|f| hir[f].flags.contains(Flags::ASYNC))
                && let Some(put_off) = self.eh_place(file, bound.expr_parent[e.idx()])
            {
                let start = self.error_start_inside_parentheses(file, e);
                requests.push(Request {
                    order: (put_off, start),
                    start,
                    end: self.error_end_inside_parentheses(file, e),
                    helpers: AWAIT | ASYNC_DELEGATOR | ASYNC_VALUES,
                });
            }
        }
    }

    /// `checkImportDeclaration`, `checkImportBinding`, `checkExportDeclaration`, `checkExportSpecifier`, `checkForOfStatement`,
    /// `checkVariableDeclarationList`
    fn eh_of_statements(&self, file: FileId, target: ScriptTarget, requests: &mut Vec<Request>) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        // `GetEmitModuleFormatOfFile(file) == ModuleKindCommonJS`
        let is_commonjs = match files.module(file).implied_format {
            ResolutionMode::Require => true,
            ResolutionMode::Import => false,
            ResolutionMode::None => files.options.module == ModuleKind::CommonJs,
        };
        for (i, stmt) in hir.stmts.iter().enumerate() {
            let (s, around) = (StmtId(i as u32), bound.stmt_parent[i]);
            // `checkGrammarModuleElementContext`, `checkExternalImportOrExportDeclaration`: elsewhere a module can only be named in what
            // is ambient.
            let is_module_element = is_commonjs && around == Parent::File;
            let mut ask = |put_off: u32, (start, end): (u32, u32), helpers: u32| {
                requests.push(Request {
                    order: (put_off, stmt.pos),
                    start,
                    end,
                    helpers,
                });
            };
            match stmt.kind {
                StmtKind::Import(x) if is_module_element => {
                    let import = hir[x];
                    if !self.eh_import_clause_is_checked(file, s, &import) {
                        continue;
                    }
                    let whole = (stmt.pos, self.end_of_stmt(file, s));
                    if import.namespace.is_some() {
                        ask(0, whole, IMPORT_STAR);
                        continue;
                    }
                    let mode = files.mode_of_import(file, import.mode);
                    if files
                        .module_of_specifier_as(file, import.spec, mode)
                        .is_some()
                    {
                        for spec in import.named.iter() {
                            let named = hir[spec];
                            if named.imported == known::default {
                                let name = named.pos.min(named.imported_pos);
                                let start = self.eh_start_of_specifier(file, name, named.type_only);
                                ask(
                                    0,
                                    (start, self.end_of_import_spec(file, spec)),
                                    IMPORT_DEFAULT,
                                );
                            }
                        }
                    }
                    if import.default.is_some() {
                        ask(0, whole, IMPORT_DEFAULT);
                    }
                }
                StmtKind::ExportNamed(x) if is_module_element && hir[x].spec.is_some() => {
                    if !self.eh_has_only_string_attributes(file, s) {
                        continue;
                    }
                    for spec in hir[x].items.iter() {
                        let named = hir[spec];
                        if named.local == known::default {
                            let name = named.pos.min(named.local_pos);
                            let start = self.eh_start_of_specifier(file, name, named.type_only);
                            ask(
                                0,
                                (start, self.end_of_export_spec(file, spec)),
                                IMPORT_DEFAULT,
                            );
                        }
                    }
                }
                StmtKind::ExportStar { spec, alias, .. } if is_module_element && spec.is_some() => {
                    if self.eh_has_only_string_attributes(file, s) {
                        let whole = (stmt.pos, self.end_of_stmt(file, s));
                        ask(
                            0,
                            whole,
                            if alias.is_some() {
                                IMPORT_STAR
                            } else {
                                EXPORT_STAR
                            },
                        );
                    }
                }
                StmtKind::ForOf { is_await: true, .. } if target < ScriptTarget::ES2018 => {
                    // `getContainingFunctionOrClassStaticBlock`, `GetFunctionFlags`
                    if self
                        .enclosing_fn(file, around)
                        .is_some_and(|f| hir[f].flags.contains(Flags::ASYNC))
                        && let Some(put_off) = self.eh_place(file, around)
                    {
                        ask(put_off, (stmt.pos, self.end_of_stmt(file, s)), ASYNC_VALUES);
                    }
                }
                StmtKind::Var(decls) if target < ScriptTarget::ESNext => {
                    let Some(first) = decls.iter().next() else {
                        continue;
                    };
                    if !matches!(hir[first].kind, VarKind::Using | VarKind::AwaitUsing) {
                        continue;
                    }
                    let Some(put_off) = self.eh_place(file, Parent::VarInit(first)) else {
                        continue;
                    };
                    // The list comes after the modifiers of the statement.
                    let mut start = stmt.pos;
                    while matches!(
                        hir.text
                            .get(start as usize..self.end_of_token_at(file, start) as usize),
                        Some(b"export" | b"declare")
                    ) {
                        start = self.skip_trivia_from(file, self.end_of_token_at(file, start));
                    }
                    ask(
                        put_off,
                        (start, self.end_of_var_decl_list(file, decls)),
                        ADD_DISPOSABLE_RESOURCE_AND_DISPOSE_RESOURCES,
                    );
                }
                _ => {}
            }
        }
    }

    /// Whether `checkImportDeclaration` gets to what the clause of `import`, the statement `s` at the top of the file, binds:
    /// `checkExternalImportOrExportDeclaration` and `checkGrammarImportClause` have nothing against it.
    fn eh_import_clause_is_checked(&self, file: FileId, s: StmtId, import: &Import) -> bool {
        let hir = self.hir(file);
        if import.spec.is_none() || !self.eh_has_only_string_attributes(file, s) {
            return false;
        }
        // `grammarErrorOnNode` says nothing of a file that does not parse, and then nothing is given up on.
        if has_parse_diagnostics(hir) {
            return true;
        }
        if import.type_only {
            let has_bindings = import.namespace.is_some() || !import.named.is_empty();
            return !(import.default.is_some() && has_bindings)
                && !import.named.iter().any(|spec| hir[spec].type_only);
        }
        // `import defer * as ns`. `import defer from "m"` imports something called `defer`.
        let word = self.skip_trivia_from(file, self.end_of_token_at(file, hir[s].pos));
        let says_defer = hir
            .text
            .get(word as usize..self.end_of_token_at(file, word) as usize)
            == Some(&b"defer"[..])
            && !(import.default.is_some() && import.default_pos == word);
        !says_defer
            || import.default.is_none()
                && import.namespace.is_some()
                && matches!(
                    self.files().options.module,
                    ModuleKind::EsNext | ModuleKind::Preserve
                )
    }

    /// `checkExternalImportOrExportDeclaration`: every import attribute of the statement `s` is given as a string literal.
    fn eh_has_only_string_attributes(&self, file: FileId, s: StmtId) -> bool {
        let hir = self.hir(file);
        if hir.import_attributes.is_empty() {
            return true;
        }
        let written = hir[s].pos..self.end_of_stmt(file, s);
        hir.import_attributes
            .iter()
            .filter(|attributes| written.contains(&attributes.0))
            .all(|&(_, attributes)| match hir[attributes].kind {
                ExprKind::Object(props) => props.iter().all(|p| {
                    let value = hir[p].value;
                    value.is_some() && matches!(hir[value].kind, ExprKind::String(_))
                }),
                _ => true,
            })
    }

    /// Where the import or export specifier starts whose first name is at `name`: at its `type`, if it has one.
    fn eh_start_of_specifier(&self, file: FileId, name: u32, type_only: bool) -> u32 {
        let end = self.end_of_token_before(file, name) as usize;
        let is_after_type =
            type_only && end >= 4 && self.hir(file).text.get(end - 4..end) == Some(&b"type"[..]);
        if is_after_type { end as u32 - 4 } else { name }
    }

    /// `checkVariableLikeDeclaration`, `checkObjectLiteralDestructuringPropertyAssignment`
    fn eh_of_rest_elements(
        &self,
        file: FileId,
        target: ScriptTarget,
        index: &ExprsByKind,
        requests: &mut Vec<Request>,
    ) {
        if target >= ScriptTarget::ES2018 {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (i, element) in hir.pat_props.iter().enumerate() {
            let p = PatPropId(i as u32);
            if element.is_rest
                && let Some(put_off) =
                    self.eh_place(file, self.outward(file, Parent::PatPropDefault(p)))
            {
                let (start, end) = self.error_range_of_pat_prop(file, p);
                requests.push(Request {
                    order: (put_off, start),
                    start,
                    end,
                    helpers: REST,
                });
            }
        }
        for &e in index.of(ExprTag::Object) {
            let ExprKind::Object(props) = hir[e].kind else {
                continue;
            };
            // One that is not the last is refused (2462).
            let Some(last) = props.iter().next_back().map(|p| hir[p]) else {
                continue;
            };
            if last.kind != PropKind::Spread
                || last.value.is_none()
                || !self.eh_is_taken_apart(file, e)
            {
                continue;
            }
            let Some(put_off) = self.eh_place(file, bound.expr_parent[e.idx()]) else {
                continue;
            };
            let dots_end = self.end_of_token_before(file, self.start_of(file, last.value));
            let start = dots_end.saturating_sub(3);
            requests.push(Request {
                order: (put_off, start),
                start,
                end: self.end_of_expr(file, last.value),
                helpers: REST,
            });
        }
    }

    /// Whether `checkDestructuringAssignment` takes the object literal `e` apart. In parentheses it is an expression like any other
    /// (`checkReferenceAssignment`).
    fn eh_is_taken_apart(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut node = e;
        loop {
            if is_parenthesized(self.hir(file), node) {
                return false;
            }
            match bound.expr_parent[node.idx()] {
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Assign {
                        op: None, target, ..
                    } => return target == node,
                    ExprKind::Array(_) | ExprKind::Spread(_) => node = parent,
                    _ => return false,
                },
                Parent::Prop(p) => {
                    let owner = bound.prop_owner[p.idx()];
                    if owner.is_none()
                        || !matches!(hir[owner].kind, ExprKind::Object(_))
                        || !matches!(hir[p].kind, PropKind::Init | PropKind::Spread)
                    {
                        return false;
                    }
                    node = owner;
                }
                // `for ({ ...rest } of list)`
                Parent::Stmt(s) if s.is_some() => {
                    return matches!(bound.stmt_parent[s.idx()], Parent::Stmt(l) if l.is_some()
                        && matches!(hir[l].kind, StmtKind::ForOf { left, .. } if left == s));
                }
                _ => return false,
            }
        }
    }

    /// From the `@` of the decorator whose expression is `e` to where it ends. The parentheses of `@(x)` are only in the text.
    fn eh_range_of_decorator(&self, file: FileId, e: ExprId) -> (u32, u32) {
        let start = self.start_of(file, e);
        let before = self
            .hir(file)
            .text
            .get(..start as usize)
            .unwrap_or_default()
            .trim_ascii_end();
        if let Some(rest) = before.strip_suffix(b"(").map(<[u8]>::trim_ascii_end)
            && rest.ends_with(b"@")
        {
            return (
                rest.len() as u32 - 1,
                self.end_of_bracket_at(file, before.len() as u32 - 1),
            );
        }
        (start.saturating_sub(1), self.end_of_expr(file, e))
    }

    /// `checkDecorators`, `markDecoratorAliasReferenced`
    fn eh_of_decorators(&self, file: FileId, target: ScriptTarget, requests: &mut Vec<Request>) {
        let (hir, bound, options) = (self.hir(file), self.bound(file), &self.files().options);
        let mut decorated: Vec<DecoratorOwner> = Vec::new();
        for &(owner, e) in hir.decorators.iter() {
            // `firstDecorator`
            if decorated.contains(&owner) {
                continue;
            }
            decorated.push(owner);
            // `NodeCanBeDecorated`
            if bound.refused_decorators.contains(&e) {
                continue;
            }
            let Some(put_off) = self.eh_place(file, bound.expr_parent[e.idx()]) else {
                continue;
            };
            let mut helpers = 0;
            if options.experimental_decorators {
                helpers |= DECORATE;
                if let DecoratorOwner::Param(_) = owner {
                    helpers |= PARAM;
                }
            } else if target < ScriptTarget::ESNext {
                helpers |= DECORATE;
                match owner {
                    DecoratorOwner::Class(class) => {
                        if let ClassOwner::Stmt(_) = bound.class_owner[class.idx()]
                            && (hir[class].name.is_none()
                                || self
                                    .eh_first_transformable_static_element(file, class, target)
                                    .is_some())
                        {
                            helpers |= SET_FUNCTION_NAME;
                        }
                    }
                    DecoratorOwner::Member(m) => {
                        let member = hir[m];
                        if matches!(member.key, PropKey::Private(_))
                            && (member.kind != MemberKind::Property
                                || member.flags.contains(Flags::ACCESSOR))
                        {
                            helpers |= SET_FUNCTION_NAME;
                        }
                        if hir.text.get(member.name_pos as usize) == Some(&b'[') {
                            helpers |= PROP_KEY;
                        }
                    }
                    DecoratorOwner::Param(_) => {}
                }
            }
            // `markLinkedReferences` does nothing under `verbatimModuleSyntax`.
            if options.emit_decorator_metadata && !options.verbatim_module_syntax {
                helpers |= METADATA;
            }
            if helpers == 0 {
                continue;
            }
            let (start, end) = self.eh_range_of_decorator(file, e);
            requests.push(Request {
                order: (put_off, start),
                start,
                end,
                helpers,
            });
        }
    }

    /// `getFirstTransformableStaticClassElement`: `GetErrorRangeForNode` of it.
    fn eh_first_transformable_static_element(
        &self,
        file: FileId,
        class: ClassId,
        target: ScriptTarget,
    ) -> Option<(u32, u32)> {
        // `willTransformPrivateElementsOrClassStaticBlocks`. Otherwise decorators are not transformed either.
        if target >= ScriptTarget::ESNext {
            return None;
        }
        let (hir, bound, options) = (self.hir(file), self.bound(file), &self.files().options);
        // `NodeIsDecorated`
        let decorator_of = |owner: DecoratorOwner| {
            hir.decorators
                .iter()
                .find(|d| d.0 == owner && !bound.refused_decorators.contains(&d.1))
                .map(|d| d.1)
        };
        // `willTransformStaticElementsOfDecoratedClass`
        let of_class = if options.experimental_decorators {
            None
        } else {
            decorator_of(DecoratorOwner::Class(class))
        };
        for m in hir[class].members.iter() {
            let member = hir[m];
            if let Some(first) = of_class
                && decorator_of(DecoratorOwner::Member(m)).is_some()
            {
                return Some(self.eh_range_of_decorator(file, first));
            }
            // `IsPrivateIdentifierClassElementDeclaration`, `IsInitializedProperty`
            let is_transformed = member.kind == MemberKind::StaticBlock
                || member.flags.contains(Flags::STATIC)
                    && (matches!(member.key, PropKey::Private(_))
                        || !options.emit_standard_class_fields
                            && member.kind == MemberKind::Property
                            && member.init.is_some());
            if is_transformed {
                return Some(self.error_range_of_member(file, m));
            }
        }
        None
    }

    /// `checkClassExpressionExternalHelpers`
    fn eh_of_class_expressions(
        &self,
        file: FileId,
        target: ScriptTarget,
        requests: &mut Vec<Request>,
    ) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let is_identifier = |pat: PatId| matches!(hir[pat].kind, PatKind::Ident(_));
        let is_computed_name_at = |pos: u32| hir.text.get(pos as usize) == Some(&b'[');
        for (i, class) in hir.classes.iter().enumerate() {
            let ClassOwner::Expr(e) = bound.class_owner[i] else {
                continue;
            };
            if class.name.is_some() || e.is_none() {
                continue;
            }
            // `walkUpOuterExpressions`
            let mut node = e;
            while let Parent::Expr(outer) = bound.expr_parent[node.idx()]
                && outer.is_some()
                && matches!(
                    hir[outer].kind,
                    ExprKind::As { .. }
                        | ExprKind::Satisfies { .. }
                        | ExprKind::AsConst(_)
                        | ExprKind::NonNull(_)
                        | ExprKind::Instantiation { .. }
                )
            {
                node = outer;
            }
            // `IsNamedEvaluationSource`, and whether what gives the name is a property with a computed name.
            let has_computed_name = match bound.expr_parent[node.idx()] {
                Parent::Prop(p) => {
                    let (prop, owner) = (hir[p], bound.prop_owner[p.idx()]);
                    let is_computed = is_computed_name_at(prop.pos);
                    // `IsProtoSetter`
                    let is_proto = !is_computed
                        && matches!(prop.key, PropKey::Name(name) if files.atoms.bytes(name) == b"__proto__");
                    if prop.kind != PropKind::Init
                        || is_proto
                        || owner.is_none()
                        || !matches!(hir[owner].kind, ExprKind::Object(_))
                    {
                        continue;
                    }
                    is_computed
                }
                Parent::MemberInit(m) => is_computed_name_at(hir[m].name_pos),
                Parent::VarInit(d) if is_identifier(hir[d].pat) => false,
                Parent::ParamDefault(p)
                    if is_identifier(hir[p].pat) && !hir[p].flags.contains(Flags::REST) =>
                {
                    false
                }
                Parent::PatPropDefault(p) if is_identifier(hir[p].value) && !hir[p].is_rest => {
                    false
                }
                Parent::PatElemDefault(p) if is_identifier(hir[p].pat) && !hir[p].is_rest => false,
                Parent::Expr(outer) if outer.is_some() => match hir[outer].kind {
                    ExprKind::Assign {
                        op: None | Some(BinOp::And | BinOp::Or | BinOp::Nullish),
                        target: name,
                        value,
                    } if value == node
                        && matches!(hir[name].kind, ExprKind::Ident(_))
                        && !is_parenthesized(self.hir(file), name) =>
                    {
                        false
                    }
                    _ => continue,
                },
                Parent::Stmt(s)
                    if s.is_some()
                        && matches!(
                            hir[s].kind,
                            StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
                        ) =>
                {
                    false
                }
                _ => continue,
            };
            let Some(put_off) = self.eh_place(file, bound.expr_parent[e.idx()]) else {
                continue;
            };
            let id = ClassId(i as u32);
            // `willTransformESDecorators`, `ClassOrConstructorParameterIsDecorated`
            let decorator =
                if files.options.experimental_decorators || target >= ScriptTarget::ESNext {
                    None
                } else {
                    hir.decorators
                        .iter()
                        .find(|d| d.0 == DecoratorOwner::Class(id))
                };
            let location = match decorator {
                Some(first) => Some(self.eh_range_of_decorator(file, first.1)),
                None => self.eh_first_transformable_static_element(file, id, target),
            };
            let Some((start, end)) = location else {
                continue;
            };
            requests.push(Request {
                order: (put_off, class.name_pos),
                start,
                end,
                helpers: if has_computed_name {
                    SET_FUNCTION_NAME | PROP_KEY
                } else {
                    SET_FUNCTION_NAME
                },
            });
        }
    }

    /// `checkPropertyAccessExpressionOrQualifiedName`, `checkInExpression`
    fn eh_of_private_names(
        &self,
        file: FileId,
        target: ScriptTarget,
        index: &ExprsByKind,
        requests: &mut Vec<Request>,
    ) {
        if target >= ScriptTarget::ESNext && self.files().options.use_define_for_class_fields {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &e in index.of(ExprTag::Dot) {
            let ExprKind::Dot { name_pos, .. } = hir[e].kind else {
                continue;
            };
            if !is_private_name_at(hir, name_pos) {
                continue;
            }
            let Some(put_off) = self.eh_place(file, bound.expr_parent[e.idx()]) else {
                continue;
            };
            let start = self.start_inside_parentheses(file, e);
            requests.push(Request {
                order: (put_off, start),
                start,
                end: self.end_inside_parentheses(file, e),
                helpers: match bound.get_assignment_target_kind(hir, e) {
                    AssignmentKind::None => CLASS_PRIVATE_FIELD_GET,
                    AssignmentKind::Definite => CLASS_PRIVATE_FIELD_SET,
                    AssignmentKind::Compound => CLASS_PRIVATE_FIELD_SET | CLASS_PRIVATE_FIELD_GET,
                },
            });
        }
        for &e in index.of(ExprTag::Binary) {
            let ExprKind::Binary {
                op: BinOp::In,
                left,
                ..
            } = hir[e].kind
            else {
                continue;
            };
            let start = hir[left].pos;
            if matches!(hir[left].kind, ExprKind::String(_))
                && is_private_name_at(hir, start)
                && !is_parenthesized(self.hir(file), left)
                && let Some(put_off) = self.eh_place(file, bound.expr_parent[e.idx()])
            {
                requests.push(Request {
                    order: (put_off, start),
                    start,
                    end: self.end_of_name_at(file, start),
                    helpers: CLASS_PRIVATE_FIELD_IN,
                });
            }
        }
    }
}

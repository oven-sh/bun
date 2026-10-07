//! Helpers that are imported instead of emitted: 2343 2354 2807, and 2306 for a `tslib` that is not
//! a module.
//!
//! With `importHelpers`, syntax the target does not support is emitted as calls of functions
//! imported from `tslib`, which must exist. Follows `checkExternalEmitHelpers`,
//! `resolveHelpersModule`, `getHelperNames` and the callers of the first, of TypeScript 7.0.2's
//! checker.go.
//!
//! A file requests each helper once, where `checkSourceFile` first reaches syntax that needs it. So
//! the requesting positions are collected and sorted in the order it visits them: source order,
//! except for nodes that `checkNodeDeferred` defers until everything else is checked. An expression
//! that is checked early, because a type is requested, is placed where that happened
//! (`note_external_emit_helpers_check`). If that was in the check of an earlier file, the task of
//! that file reports (`check_external_emit_helpers_of_later_files`).

use super::sink::held;
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent};
use crate::resolve::{ModuleKind, ScriptTarget};

// `ExternalEmitHelpers`, except the two that are never requested.
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
    /// The number of deferrals on the way to it, and its position in the file. For an expression
    /// that is checked early those of the node that was being checked, and its rank among such
    /// expressions, from 1.
    order: (u32, u32, u32),
    /// `GetErrorRangeForNode` of the location.
    start: u32,
    end: u32,
    helpers: u32,
    /// The expression whose check makes it (`note_external_emit_helpers_check`). `NONE`: the check
    /// of something else, which only `checkSourceFile` of the file comes to.
    expression: ExprId,
}

/// A diagnostic of `checkExternalEmitHelpers` in `file`, which the check of an earlier file, the one
/// with `rank`, has reported at `start`.
pub(super) struct EarlierEmitHelperError {
    pub(super) file: FileId,
    pub(super) code: u32,
    pub(super) args: super::sink::Args,
    pub(super) rank: u32,
    pub(super) start: u32,
}

/// `Request::order` of the request that the check of `expression` makes. `regular`: the number of
/// deferrals on the way to it, and its position. `checked`: `Checker::emit_helpers_checked_early`.
fn order_of_expression(
    expression: (FileId, ExprId),
    regular: (u32, u32),
    checked: &[(FileId, ExprId, (u32, u32))],
) -> (u32, u32, u32) {
    let regular = (regular.0, regular.1, 0);
    match checked.iter().position(|it| (it.0, it.1) == expression) {
        Some(rank) => {
            let (deferred, start) = checked[rank].2;
            regular.min((deferred, start, rank as u32 + 1))
        }
        None => regular,
    }
}

/// `AllAccessorDeclarations`, without `GetAccessor`, which nothing here reads.
struct AllAccessorDeclarations {
    first_accessor: MemberId,
    second_accessor: Option<MemberId>,
    set_accessor: Option<MemberId>,
}

impl Checker<'_, '_> {
    pub(super) fn check_external_emit_helpers(&mut self, file: FileId) {
        let checked = std::mem::take(&mut self.emit_helpers_checked_early);
        if !self.files().options.import_helpers {
            return;
        }
        self.check_external_emit_helpers_of_later_files(file);
        if self.emit_helpers_is_effective_external_module(file) {
            let mut requests = self.emit_helpers_requests(file, &checked);
            requests.sort_by_key(|request| request.order);
            self.emit_helpers_check_requests(file, requests);
        }
    }

    /// `IsEffectiveExternalModule`. All of a declaration file is ambient.
    fn emit_helpers_is_effective_external_module(&self, file: FileId) -> bool {
        let files = self.files();
        let (options, module) = (&files.options, files.module(file));
        let is_commonjs_module = module.is_commonjs()
            && (options.module == ModuleKind::CommonJs || options.module.is_node());
        module.hir.kind != FileKind::Declaration
            && (module.hir.has_module_syntax || is_commonjs_module)
    }

    /// `checkExternalEmitHelpers` where the check of `visited` has come to an expression of a file
    /// that is checked later: `requestedExternalEmitHelpers` belongs to the file of the location,
    /// so that file does not report the same again. Its task does not see this one:
    /// `finish_file` takes back what it has reported instead.
    fn check_external_emit_helpers_of_later_files(&mut self, visited: FileId) {
        let elsewhere = std::mem::take(&mut self.emit_helpers_checked_elsewhere);
        let mut later: Vec<FileId> = elsewhere.iter().map(|it| it.0).collect();
        later.sort_unstable();
        later.dedup();
        for file in later {
            if !self.emit_helpers_is_effective_external_module(file)
                || self.emit_helpers_lacks_none(file)
            {
                continue;
            }
            // In the order of the checks.
            let place = |request: &Request| {
                let mut checks = elsewhere.iter();
                checks.position(|&it| it == (file, request.expression))
            };
            let requests = self.emit_helpers_requests(file, &[]).into_iter();
            let mut requests: Vec<(usize, Request)> = requests
                .filter_map(|request| Some((place(&request)?, request)))
                .collect();
            requests.sort_by_key(|it| (it.0, it.1.order));
            let from = self.reported.len();
            self.emit_helpers_check_requests(file, requests.into_iter().map(|it| it.1).collect());
            let rank = self.files().rank_of_file(visited);
            let reported = self.reported[from..].iter().filter(|d| d.file == file);
            let reported = reported.map(|d| EarlierEmitHelperError {
                file,
                code: d.code,
                args: d.args.clone(),
                rank,
                start: d.start,
            });
            (self.p.emit_helper_errors_of_earlier_files.lock()).extend(reported);
        }
    }

    /// FOR SPEED. Whether `checkExternalEmitHelpers` reports nothing in `file`, whatever is asked
    /// for: its `tslib` has every helper.
    fn emit_helpers_lacks_none(&mut self, file: FileId) -> bool {
        let files = self.files();
        let mode = files.module(file).default_mode;
        match files.module_of_specifier_as(file, known::tslib, mode) {
            Some(helpers_module) => (0..u32::BITS).all(|bit| {
                self.emit_helpers_errors_of(helpers_module, 1 << bit)
                    .is_empty()
            }),
            None => false,
        }
    }

    /// `checkExternalEmitHelpers` for each of `requests` of `file`, in that order. Nothing has been
    /// requested before.
    fn emit_helpers_check_requests(&mut self, file: FileId, requests: Vec<Request>) {
        let hir = self.hir(file);
        // `externalHelpersModule`, `requestedExternalEmitHelpers`
        let (mut resolved, mut requested) = (None, 0);
        for request in requests {
            // `checkWithStatement` does not check the body.
            if hir.is_in_with(request.start) {
                continue;
            }
            let found = *resolved
                .get_or_insert_with(|| self.emit_helpers_resolve_helpers_module(file, request));
            let Some(helpers_module) = found else {
                return;
            };
            let unchecked = request.helpers & !requested;
            requested |= request.helpers;
            let helpers = (0..u32::BITS).map(|bit| 1u32 << bit);
            for helper in helpers.filter(|&helper| unchecked & helper != 0) {
                for (code, args) in self.emit_helpers_errors_of(helpers_module, helper) {
                    let at = (file, request.start, request.end);
                    self.add_diagnostic(Reported::new(at, code, held(args)));
                }
            }
        }
    }

    /// What `checkExternalEmitHelpers` reports where `helper` is first asked of `helpers_module`:
    /// the codes and the arguments.
    fn emit_helpers_errors_of(
        &mut self,
        helpers_module: Sym,
        helper: u32,
    ) -> Vec<(u32, Vec<Vec<u8>>)> {
        let files = self.files();
        let mut errors = Vec::new();
        for &name in helper_names(helper, files.options.experimental_decorators) {
            let symbol = files
                .atoms
                .lookup(name.as_bytes())
                .and_then(|name| files.module_export(helpers_module, name))
                .filter(|&symbol| files.means(symbol, SymFlags::VALUE));
            let arity = match (symbol, helper) {
                (None, _) => None,
                (Some(_), CLASS_PRIVATE_FIELD_GET) => Some(3),
                (Some(_), CLASS_PRIVATE_FIELD_SET) => Some(4),
                (Some(_), _) => continue,
            };
            let mut args = vec![TSLIB.as_bytes().to_vec(), name.as_bytes().to_vec()];
            if let (Some(symbol), Some(arity)) = (symbol, arity) {
                if self.emit_helpers_has_signature_with_arity_greater_than(symbol, arity) {
                    continue;
                }
                args.push(super::sink::number_text(arity + 1));
            }
            errors.push((if arity.is_some() { 2807 } else { 2343 }, args));
        }
        errors
    }

    /// `resolveHelpersModule`
    fn emit_helpers_resolve_helpers_module(
        &mut self,
        file: FileId,
        request: Request,
    ) -> Option<Sym> {
        let mode = self.files().module(file).default_mode;
        // `GetImportHelpersImportSpecifier`: the specifier of the synthetic import the loader
        // added, which has no import clause and is nowhere in the text.
        let location = SpecifierUse {
            spec: known::tslib,
            pos: u32::MAX,
            kind: SpecifierKind::Import,
            mode,
        };
        let error_node = (file, request.start, request.end);
        let site = SpecifierSite::default();
        if !self.resolve_external_module_at(file, location, site, error_node, Some(2354)) {
            return None;
        }
        self.files()
            .module_of_specifier_as(file, known::tslib, mode)
    }

    /// `hasSignatureWithArityGreaterThan` for the symbol `symbol` aliases (`resolveSymbol`).
    fn emit_helpers_has_signature_with_arity_greater_than(
        &mut self,
        symbol: Sym,
        arity: usize,
    ) -> bool {
        let files = self.files();
        let target = if files.is_non_local_alias(symbol) {
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
            if i > 0
                && let (of, Decl::Fn(previous)) = decls[i - 1]
                && of == file
                && !matches!(self.hir(file)[f].body, FnBody::None)
                && self.is_next_statement(file, previous, f)
            {
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

    // ───────────────────────────── who asks ─────────────────────────────

    /// `checked`, here and below: `Checker::emit_helpers_checked_early`
    fn emit_helpers_requests(
        &mut self,
        file: FileId,
        checked: &[(FileId, ExprId, (u32, u32))],
    ) -> Vec<Request> {
        // `GetEmitScriptTarget`
        let target = match self.files().options.target {
            ScriptTarget::None => ScriptTarget::ES2025,
            target => target,
        };
        let index = self.exprs_by_kind(file);
        let mut requests = Vec::new();
        self.emit_helpers_of_async_functions(file, target, &index, checked, &mut requests);
        self.emit_helpers_of_statements(file, target, &mut requests);
        self.emit_helpers_of_rest_elements(file, target, &index, checked, &mut requests);
        self.emit_helpers_of_decorators(file, target, &mut requests);
        self.emit_helpers_of_class_expressions(file, target, checked, &mut requests);
        self.emit_helpers_of_private_names(file, target, &index, checked, &mut requests);
        requests
    }

    /// The number of times `checkNodeDeferred` defers a direct child of `at`. Deferred are the body
    /// of a function expression, of an arrow function and of a method of an object literal, the
    /// whole of an accessor of an object literal, the members of a class expression, the operand of
    /// `void`, and the contents of a JSX element. `None`: it is ambient (`NodeFlagsAmbient`).
    fn emit_helpers_span(&self, file: FileId, mut at: Parent) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut deferred = 0;
        loop {
            at = match at {
                Parent::File => return Some(deferred),
                Parent::Module(m) => {
                    return (!hir[m].flags.contains(Flags::AMBIENT)).then_some(deferred);
                }
                Parent::VarInit(d) if hir[d].flags.contains(Flags::AMBIENT) => return None,
                // `checkObjectLiteral` checks every computed name at once.
                Parent::MethodKey(p) => Parent::Expr(bound.prop_owner[p.idx()]),
                Parent::FnBody(f) => self.emit_helpers_out_of_fn(file, f, false, &mut deferred)?,
                Parent::ParamDefault(p) | Parent::Decorator(_, DecoratorOwner::Param(p)) => {
                    self.emit_helpers_out_of_fn(file, bound.param_fn[p.idx()], true, &mut deferred)?
                }
                Parent::MemberInit(m)
                | Parent::MemberKey(m)
                | Parent::Decorator(_, DecoratorOwner::Member(m)) => {
                    if hir[m].flags.contains(Flags::AMBIENT) {
                        return None;
                    }
                    let class = match bound.member_owner[m.idx()] {
                        MemberOwner::Class(class) => class,
                        MemberOwner::TypeLiteral(t) => {
                            at = self.emit_helpers_out_of_type(file, t, &mut deferred)?;
                            continue;
                        }
                        _ => {
                            at = self.parent_of_node(file, Parent::MemberInit(m));
                            continue;
                        }
                    };
                    if let ClassOwner::Expr(_) = bound.class_owner[class.idx()] {
                        deferred += 1;
                    }
                    Parent::ClassExtends(class)
                }
                Parent::EnumInit(m)
                    if hir[bound.enum_member_owner[m.idx()]]
                        .flags
                        .contains(Flags::AMBIENT) =>
                {
                    return None;
                }
                Parent::ClassExtends(class)
                | Parent::Decorator(class, DecoratorOwner::Class(_)) => {
                    if hir[class].flags.contains(Flags::AMBIENT) {
                        return None;
                    }
                    self.parent_of_node(file, Parent::ClassExtends(class))
                }
                Parent::None => return None,
                Parent::Expr(e) if e.is_none() => return None,
                Parent::Expr(e) => {
                    deferred += match hir[e].kind {
                        ExprKind::Unary { op: UnOp::Void, .. } => 1,
                        ExprKind::Jsx(element) if hir[element].tag.is_some() => 1,
                        _ => 0,
                    };
                    bound.expr_parent[e.idx()]
                }
                Parent::Stmt(s) if s.is_none() => return None,
                other => self.parent_of_node(file, other),
            };
        }
    }

    /// `emit_helpers_span`, one step: out of the function `f`, from its parameters (`is_head`) or from its body.
    fn emit_helpers_out_of_fn(
        &self,
        file: FileId,
        f: FnId,
        is_head: bool,
        deferred: &mut u32,
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
                    *deferred += 1;
                }
                Some(Parent::Expr(e))
            }
            FnOwner::Stmt(s) => Some(Parent::Stmt(s)),
            FnOwner::Member(m) => Some(Parent::MemberInit(m)),
            FnOwner::Type(t) => self.emit_helpers_out_of_type(file, t, deferred),
            FnOwner::None => None,
        }
    }

    /// `emit_helpers_span`, one step: out of the type node `t`.
    fn emit_helpers_out_of_type(
        &self,
        file: FileId,
        t: TypeNodeId,
        deferred: &mut u32,
    ) -> Option<Parent> {
        let hir = self.hir(file);
        let (around, inside) = Self::emit_helpers_source_element(hir, hir.node(t));
        let Parent::FnBody(f) = inside else {
            return Some(inside);
        };
        // `checkSignatureDeclaration` checks the type parameters and the return type.
        let below = hir.find_ancestor(hir.node(t), |n| hir.parent(n) == around);
        let is_head = matches!(hir.data(below), NodeData::Type(_) | NodeData::TypeParam(_));
        self.emit_helpers_out_of_fn(file, f, is_head, deferred)
    }

    /// `checkSignatureDeclaration`, `checkYieldExpression`
    fn emit_helpers_of_async_functions(
        &self,
        file: FileId,
        target: ScriptTarget,
        index: &ExprsByKind,
        checked: &[(FileId, ExprId, (u32, u32))],
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
            let mut deferred = 0;
            let Some(place) = self
                .emit_helpers_out_of_fn(file, f, true, &mut deferred)
                .and_then(|around| self.emit_helpers_span(file, around))
            else {
                continue;
            };
            let (start, end) = self.error_range_of_fn(file, f);
            requests.push(Request {
                order: (place + deferred, start, 0),
                start,
                end,
                helpers,
                expression: ExprId::NONE,
            });
        }
        for &e in index.of(ExprTag::Yield) {
            if matches!(hir[e].kind, ExprKind::Yield { star: true, .. })
                && self
                    .containing_generator(file, e)
                    .is_some_and(|f| hir[f].flags.contains(Flags::ASYNC))
                && let Some(deferred) = self.emit_helpers_span(file, bound.expr_parent[e.idx()])
            {
                let start = self.error_start_inside_parentheses(file, e);
                requests.push(Request {
                    order: order_of_expression((file, e), (deferred, start), checked),
                    start,
                    end: self.error_end_inside_parentheses(file, e),
                    helpers: AWAIT | ASYNC_DELEGATOR | ASYNC_VALUES,
                    expression: e,
                });
            }
        }
    }

    /// `checkImportDeclaration`, `checkImportBinding`, `checkExportDeclaration`, `checkExportSpecifier`, `checkForOfStatement`,
    /// `checkVariableDeclarationList`
    fn emit_helpers_of_statements(
        &self,
        file: FileId,
        target: ScriptTarget,
        requests: &mut Vec<Request>,
    ) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        // `GetEmitModuleFormatOfFile(file) == ModuleKindCommonJS`
        let is_commonjs = match files.module(file).implied_format {
            ResolutionMode::Require => true,
            ResolutionMode::Import => false,
            ResolutionMode::None => files.options.module == ModuleKind::CommonJs,
        };
        for (i, stmt) in hir.stmts.iter().enumerate() {
            let (s, around) = (StmtId(i as u32), bound.stmt_parent[i]);
            // `checkGrammarModuleElementContext`, `checkExternalImportOrExportDeclaration`:
            // elsewhere a module can only be referenced in an ambient context.
            let is_module_element = is_commonjs && around == Parent::File;
            let mut ask = |deferred: u32, (start, end): (u32, u32), helpers: u32| {
                requests.push(Request {
                    order: (deferred, stmt.start, 0),
                    start,
                    end,
                    helpers,
                    expression: ExprId::NONE,
                });
            };
            match stmt.kind {
                StmtKind::Import(x) if is_module_element => {
                    let import = hir[x];
                    if !self.emit_helpers_import_clause_is_checked(file, s, x) {
                        continue;
                    }
                    let whole = (stmt.start, self.end_of_stmt(file, s));
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
                                let start = self.emit_helpers_start_of_specifier(
                                    file,
                                    name,
                                    named.type_only,
                                );
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
                    if !self.emit_helpers_has_only_string_attributes(file, s) {
                        continue;
                    }
                    for spec in hir[x].items.iter() {
                        let named = hir[spec];
                        if named.local == known::default {
                            let name = named.pos.min(named.local_pos);
                            let start =
                                self.emit_helpers_start_of_specifier(file, name, named.type_only);
                            ask(
                                0,
                                (start, self.end_of_export_spec(file, spec)),
                                IMPORT_DEFAULT,
                            );
                        }
                    }
                }
                StmtKind::ExportStar { spec, alias, .. } if is_module_element && spec.is_some() => {
                    if self.emit_helpers_has_only_string_attributes(file, s) {
                        let whole = (stmt.start, self.end_of_stmt(file, s));
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
                        && let Some(deferred) = self.emit_helpers_span(file, around)
                    {
                        ask(
                            deferred,
                            (stmt.start, self.end_of_stmt(file, s)),
                            ASYNC_VALUES,
                        );
                    }
                }
                StmtKind::Var(decls) if target < ScriptTarget::ESNext => {
                    let Some(first) = decls.iter().next() else {
                        continue;
                    };
                    if !matches!(hir[first].kind, VarKind::Using | VarKind::AwaitUsing) {
                        continue;
                    }
                    let Some(deferred) = self.emit_helpers_span(file, Parent::VarInit(first))
                    else {
                        continue;
                    };
                    ask(
                        deferred,
                        (
                            self.start_after_modifiers(file, s),
                            self.end_of_var_decl_list(file, decls),
                        ),
                        ADD_DISPOSABLE_RESOURCE_AND_DISPOSE_RESOURCES,
                    );
                }
                _ => {}
            }
        }
    }

    /// Whether `checkImportDeclaration` reaches the bindings of the clause of `import`, the
    /// top-level statement `s`: `checkExternalImportOrExportDeclaration` and
    /// `checkGrammarImportClause` report no error for it.
    fn emit_helpers_import_clause_is_checked(
        &self,
        file: FileId,
        s: StmtId,
        import: ImportId,
    ) -> bool {
        let hir = self.hir(file);
        if hir[import].spec.is_none() || !self.emit_helpers_has_only_string_attributes(file, s) {
            return false;
        }
        // `grammarErrorOnNode` reports nothing in a file with parse errors, and then no check bails
        // out.
        has_parse_diagnostics(hir) || self.grammar_error_of_import_clause(file, import).is_none()
    }

    /// `checkExternalImportOrExportDeclaration`: every import attribute of the statement `s` is given as a string literal.
    fn emit_helpers_has_only_string_attributes(&self, file: FileId, s: StmtId) -> bool {
        let hir = self.hir(file);
        if hir.import_attributes.is_empty() {
            return true;
        }
        let written = hir[s].start..self.end_of_stmt(file, s);
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

    /// Start of the import or export specifier whose first name is at `name`: its `type` modifier,
    /// if it has one.
    fn emit_helpers_start_of_specifier(&self, file: FileId, name: u32, type_only: bool) -> u32 {
        let end = self.end_of_token_before(file, name) as usize;
        let is_after_type =
            type_only && end >= 4 && self.hir(file).text.get(end - 4..end) == Some(&b"type"[..]);
        if is_after_type { end as u32 - 4 } else { name }
    }

    /// `checkVariableLikeDeclaration`, `checkObjectLiteralDestructuringPropertyAssignment`
    fn emit_helpers_of_rest_elements(
        &self,
        file: FileId,
        target: ScriptTarget,
        index: &ExprsByKind,
        checked: &[(FileId, ExprId, (u32, u32))],
        requests: &mut Vec<Request>,
    ) {
        if target >= ScriptTarget::ES2018 {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (i, element) in hir.pat_props.iter().enumerate() {
            let p = PatPropId(i as u32);
            // `renamedBindingElementsInTypes`: `checkVariableLikeDeclaration` returns before.
            if element.is_rest
                && !(self.is_renamed_binding_element(file, p)
                    && self.returns_before_type_of_symbol(file, element.value))
                && !hir.is_ambient(hir.node(p))
                && let Some(deferred) = self
                    .emit_helpers_span(file, self.parent_of_node(file, Parent::PatPropDefault(p)))
            {
                let (start, end) = self.error_range_of_pat_prop(file, p);
                requests.push(Request {
                    order: (deferred, start, 0),
                    start,
                    end,
                    helpers: REST,
                    expression: ExprId::NONE,
                });
            }
        }
        for &e in index.of(ExprTag::Object) {
            let ExprKind::Object(props) = hir[e].kind else {
                continue;
            };
            // One that is not the last is rejected (2462).
            let Some(last) = props.iter().next_back().map(|p| hir[p]) else {
                continue;
            };
            if last.kind != PropKind::Spread
                || last.value.is_none()
                || !self.emit_helpers_is_destructured(file, e)
            {
                continue;
            }
            let Some(deferred) = self.emit_helpers_span(file, bound.expr_parent[e.idx()]) else {
                continue;
            };
            let dots_end = self.end_of_token_before(file, self.start_of(file, last.value));
            let start = dots_end.saturating_sub(3);
            requests.push(Request {
                order: order_of_expression((file, e), (deferred, start), checked),
                start,
                end: self.end_of_expr(file, last.value),
                helpers: REST,
                expression: e,
            });
        }
    }

    /// Whether `checkDestructuringAssignment` destructures the object literal `e`. Parenthesized,
    /// it is an ordinary expression (`checkReferenceAssignment`).
    fn emit_helpers_is_destructured(&self, file: FileId, e: ExprId) -> bool {
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

    /// The span from the `@` of the decorator whose expression is `e` to its end.
    fn emit_helpers_range_of_decorator(&self, file: FileId, e: ExprId) -> (u32, u32) {
        let written = self.decorator_position(file, e);
        (written.at_sign, written.end)
    }

    /// `checkDecorators`, `markDecoratorAliasReferenced`
    fn emit_helpers_of_decorators(
        &self,
        file: FileId,
        target: ScriptTarget,
        requests: &mut Vec<Request>,
    ) {
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
            let Some(deferred) = self.emit_helpers_span(file, bound.expr_parent[e.idx()]) else {
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
                                    .emit_helpers_first_transformable_static_element(
                                        file, class, target,
                                    )
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
            let (start, end) = self.emit_helpers_range_of_decorator(file, e);
            // `checkDecorators(node)` comes before anything else that the check of `node` asks for,
            // and modifiers can precede the first decorator.
            let node = match owner {
                DecoratorOwner::Class(class) => hir.node(class),
                DecoratorOwner::Member(m) => hir.node(m),
                DecoratorOwner::Param(p) => hir.node(p),
            };
            requests.push(Request {
                order: (deferred, start.min(hir.start(node)), 0),
                start,
                end,
                helpers,
                expression: ExprId::NONE,
            });
        }
    }

    /// `GetAllAccessorDeclarations` for the accessor `accessor` of `class`.
    fn get_all_accessor_declarations(
        &self,
        file: FileId,
        class: ClassId,
        accessor: MemberId,
    ) -> AllAccessorDeclarations {
        let hir = self.hir(file);
        let node = hir[accessor];
        let is_setter = node.kind == MemberKind::Setter;
        let other_kind = if is_setter {
            MemberKind::Getter
        } else {
            MemberKind::Setter
        };
        let name_of = |member: &Member| {
            self.get_property_name_for_property_name_node(file, member.key, member.name_pos)
        };
        // "dynamic names can only be match up via checker symbol lookup"
        let has_dynamic_name = matches!(node.key, PropKey::Computed(e) if is_dynamic_name(hir, e));
        let other_accessor = if has_dynamic_name {
            None
        } else {
            let accessor_name = name_of(&node);
            let accessor_static = node.flags.contains(Flags::STATIC);
            hir[class].members.iter().find(|&m| {
                let member = &hir[m];
                member.kind == other_kind
                    && member.flags.contains(Flags::STATIC) == accessor_static
                    && name_of(member) == accessor_name
            })
        };
        // `GetAllAccessorDeclarationsForDeclaration`
        let (first_accessor, second_accessor) = match other_accessor {
            Some(other) if hir[other].start < node.start => (other, Some(accessor)),
            _ => (accessor, other_accessor),
        };
        AllAccessorDeclarations {
            first_accessor,
            second_accessor,
            set_accessor: if is_setter {
                Some(accessor)
            } else {
                other_accessor
            },
        }
    }

    /// `ClassElementOrClassElementParameterIsDecorated` for the member `node` of the class
    /// `parent`, with `useLegacyDecorators` as the options say: `refused_decorators` holds what
    /// `NodeCanBeDecorated` answers for that.
    fn class_element_or_class_element_parameter_is_decorated(
        &self,
        file: FileId,
        node: MemberId,
        parent: ClassId,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let has_decorators = |accessor: &MemberId| {
            let mut decorators = hir.decorators.iter();
            decorators.any(|d| d.0 == DecoratorOwner::Member(*accessor))
        };
        let node_is_decorated = |of: DecoratorOwner| {
            let mut decorators = hir.decorators.iter();
            decorators.any(|d| d.0 == of && !bound.refused_decorators.contains(&d.1))
        };
        let parameters = match hir[node].kind {
            MemberKind::Getter | MemberKind::Setter => {
                let decls = self.get_all_accessor_declarations(file, parent, node);
                let accessors = [Some(decls.first_accessor), decls.second_accessor];
                let mut accessors = accessors.into_iter().flatten();
                let first_accessor_with_decorators = accessors.find(has_decorators);
                if first_accessor_with_decorators != Some(node) {
                    return false;
                }
                decls
                    .set_accessor
                    .map_or(FnId::NONE, |setter| hir[setter].func)
            }
            MemberKind::Method => hir[node].func,
            _ => FnId::NONE,
        };
        node_is_decorated(DecoratorOwner::Member(node))
            || parameters.is_some()
                && (hir[parameters].params.iter())
                    .any(|parameter| node_is_decorated(DecoratorOwner::Param(parameter)))
    }

    /// `getFirstTransformableStaticClassElement`: `GetErrorRangeForNode` of it.
    fn emit_helpers_first_transformable_static_element(
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
                && self.class_element_or_class_element_parameter_is_decorated(file, m, class)
            {
                return Some(self.emit_helpers_range_of_decorator(file, first));
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

    /// `checkExternalEmitHelpers`, where the check of the expression `node` calls it: notes when
    /// that is, if it is before the regular order of `node`. `emit_helpers_requests` makes the
    /// request.
    pub(super) fn note_external_emit_helpers_check(&mut self, file: FileId, node: ExprId) {
        if self.files().options.import_helpers
            && !self.is_type_checked
            && let Some(visited) = self.task.file
            && visited != file
            && self.emit_helpers_checked_elsewhere.last() != Some(&(file, node))
            && self.is_checked_no_later_than(visited, file)
        {
            self.emit_helpers_checked_elsewhere.push((file, node));
        }
        if self.files().options.import_helpers
            && self.task.file == Some(file)
            && !self.is_type_checked
            && let current = self.current_source_element
            && let Some(order) = self.emit_helpers_order_of_early_check(file, node, current)
            && !(self.emit_helpers_checked_early.iter()).any(|it| (it.0, it.1) == (file, node))
        {
            self.emit_helpers_checked_early.push((file, node, order));
        }
    }

    /// `checkClassExpressionExternalHelpers`, where `checkClassExpression` calls it for `node`,
    /// which is `class`. `emit_helpers_of_class_expressions` has the conditions.
    pub(super) fn check_class_expression_external_helpers(
        &mut self,
        file: FileId,
        node: ExprId,
        class: ClassId,
    ) {
        if self.hir(file)[class].name.is_none() {
            self.note_external_emit_helpers_check(file, node);
        }
    }

    /// `Request::order` of what is checked while `c.currentNode` is `current`, as
    /// `checkSourceElement` or `checkDeferredNode` has set it, because something asks for its type.
    /// `None`: `current` is the innermost such node around `e`, so `e` is checked in its regular
    /// order.
    fn emit_helpers_order_of_early_check(
        &self,
        file: FileId,
        e: ExprId,
        current: Option<CurrentNode>,
    ) -> Option<(u32, u32)> {
        let hir = self.hir(file);
        let node = match current {
            // `checkSourceFile` has not begun.
            None => return Some((0, 0)),
            // `checkExpressionEx` has set it: an assignment is never deferred.
            Some(CurrentNode::Expr(of, x))
                if of == file && matches!(hir[x].kind, ExprKind::Assign { .. }) =>
            {
                Self::emit_helpers_source_element(hir, hir.node(x)).0
            }
            Some(CurrentNode::Expr(of, x)) if of == file => hir.node(x),
            Some(CurrentNode::TypeNode(of, t)) if of == file => hir.node(t),
            Some(CurrentNode::Node(of, node)) if of == file => node,
            Some(_) => return None,
        };
        if Self::emit_helpers_source_element(hir, hir.parent(hir.node(e))).0 == node {
            return None;
        }
        let (_, inside) = Self::emit_helpers_source_element(hir, node);
        // Nothing is deferred in an ambient context.
        let deferred = self.emit_helpers_span(file, inside).unwrap_or(0);
        Some((deferred, hir.start(node)))
    }

    /// The innermost node, `node` or around it, that `checkSourceElement` or `checkDeferredNode` is
    /// called with and that can contain an expression, and the `Parent` of what is directly in it.
    fn emit_helpers_source_element(hir: &hir::File, node: Node) -> (Node, Parent) {
        let is_source_element = |n: Node| match hir.data(n) {
            NodeData::Stmt(_)
            | NodeData::VarDecl(_)
            | NodeData::Param(_)
            | NodeData::PatProp(_)
            | NodeData::PatElem(_)
            | NodeData::Member(_) => true,
            NodeData::Prop(p) => matches!(
                hir[p].kind,
                PropKind::Method | PropKind::Getter | PropKind::Setter
            ),
            NodeData::Expr(x) => matches!(
                hir[x].kind,
                ExprKind::Fn(_)
                    | ExprKind::Class(_)
                    | ExprKind::Jsx(_)
                    | ExprKind::Unary { op: UnOp::Void, .. }
            ),
            _ => false,
        };
        let around = hir.find_ancestor(node, is_source_element);
        let inside = match hir.data(around) {
            NodeData::Stmt(s) => Parent::Stmt(s),
            NodeData::VarDecl(d) => Parent::VarInit(d),
            NodeData::Param(p) => Parent::ParamDefault(p),
            NodeData::PatProp(p) => Parent::PatPropDefault(p),
            NodeData::PatElem(p) => Parent::PatElemDefault(p),
            NodeData::Member(m) => Parent::MemberInit(m),
            NodeData::Prop(_) => Parent::FnBody(hir.function_of(around)),
            NodeData::Expr(x) => match hir[x].kind {
                ExprKind::Fn(f) => Parent::FnBody(f),
                ExprKind::Class(class) => match hir[class].members.iter().next() {
                    Some(m) => Parent::MemberInit(m),
                    None => Parent::ClassExtends(class),
                },
                _ => Parent::Expr(x),
            },
            _ => Parent::File,
        };
        (around, inside)
    }

    /// `checkClassExpressionExternalHelpers`
    fn emit_helpers_of_class_expressions(
        &self,
        file: FileId,
        target: ScriptTarget,
        checked: &[(FileId, ExprId, (u32, u32))],
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
            // `IsNamedEvaluationSource`, and whether the name source is a property with a computed
            // name.
            let has_computed_name = match bound.expr_parent[node.idx()] {
                Parent::Prop(p) => {
                    let (prop, owner) = (hir[p], bound.prop_owner[p.idx()]);
                    let is_computed = is_computed_name_at(prop.pos);
                    // `IsProtoSetter`
                    let is_proto = !is_computed
                        && matches!(prop.key, PropKey::Name(name) if self.atoms().bytes(name) == b"__proto__");
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
            let Some(deferred) = self.emit_helpers_span(file, bound.expr_parent[e.idx()]) else {
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
                Some(first) => Some(self.emit_helpers_range_of_decorator(file, first.1)),
                None => self.emit_helpers_first_transformable_static_element(file, id, target),
            };
            let Some((start, end)) = location else {
                continue;
            };
            let helpers = if has_computed_name {
                SET_FUNCTION_NAME | PROP_KEY
            } else {
                SET_FUNCTION_NAME
            };
            requests.push(Request {
                order: order_of_expression((file, e), (deferred, class.name_pos), checked),
                start,
                end,
                helpers,
                expression: e,
            });
        }
    }

    /// `checkPropertyAccessExpressionOrQualifiedName`, `checkInExpression`
    fn emit_helpers_of_private_names(
        &self,
        file: FileId,
        target: ScriptTarget,
        index: &ExprsByKind,
        checked: &[(FileId, ExprId, (u32, u32))],
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
            let Some(deferred) = self.emit_helpers_span(file, bound.expr_parent[e.idx()]) else {
                continue;
            };
            let start = self.start_inside_parentheses(file, e);
            requests.push(Request {
                order: order_of_expression((file, e), (deferred, start), checked),
                start,
                end: self.end_inside_parentheses(file, e),
                helpers: match bound.get_assignment_target_kind(hir, e) {
                    AssignmentKind::None => CLASS_PRIVATE_FIELD_GET,
                    AssignmentKind::Definite => CLASS_PRIVATE_FIELD_SET,
                    AssignmentKind::Compound => CLASS_PRIVATE_FIELD_SET | CLASS_PRIVATE_FIELD_GET,
                },
                expression: e,
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
            if matches!(hir[left].kind, ExprKind::PrivateIdentifier(_))
                && !is_parenthesized(self.hir(file), left)
                && let Some(deferred) = self.emit_helpers_span(file, bound.expr_parent[e.idx()])
            {
                requests.push(Request {
                    order: order_of_expression((file, left), (deferred, start), checked),
                    start,
                    end: self.end_of_name_at(file, start),
                    helpers: CLASS_PRIVATE_FIELD_IN,
                    expression: left,
                });
            }
        }
    }
}

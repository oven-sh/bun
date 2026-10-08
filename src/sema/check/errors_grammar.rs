//! Type-independent errors of a file: uses of syntax that the options or strict mode do not allow.
//!
//! From TypeScript 7.0.2's grammarchecks.go, the `checkStrictMode*` functions of its binder.go, and
//! the checks of this kind in checker.go. As there, none of this is reported for a file with parse
//! errors.

use super::sink::held;
use super::*;
use crate::bind::Parent;
use crate::resolve::ModuleKind;
use bun_core::strings;

impl Checker<'_, '_> {
    /// `GetIncludeProcessorDiagnostics`
    pub(super) fn include_processor_diagnostics(&mut self, file: FileId) {
        for &(start, code) in &self.files().module(file).missing_references {
            self.report_missing_reference(file, start, code);
        }
        for (_, start, end, problem) in self.files().include_problems_in(file) {
            let at = (file, *start, *end);
            let mut diagnostic = Reported::new(at, problem.code, held(problem.args.clone()));
            let lines = problem
                .chain
                .iter()
                .map(|(level, code, args)| super::explain::Line {
                    code: *code,
                    args: held(args.clone()),
                    level: *level,
                });
            super::explain::add_lines(&mut diagnostic.message_chain, lines.collect());
            for &(file, start, end, code) in &problem.related {
                diagnostic.add_related_info(Reported::bare((file, start, end), code));
            }
            self.add_diagnostic(diagnostic);
        }
    }

    pub(super) fn check_grammar(&mut self, file: FileId) {
        self.check_strict_mode(file, !has_parse_diagnostics(self.hir(file)));
        self.check_grammar_augments_tags(file);
    }

    /// `getSourceFileFromReference`, `processingDiagnostic.toDiagnostic`: the error for the `///
    /// <reference>` whose value is at `start`: 2727 replaces 2726 where a library has a similar
    /// name.
    fn report_missing_reference(&mut self, file: FileId, start: u32, mut code: u32) {
        let references = &self.hir(file).references;
        let Some(&(_, value, ..)) = references.iter().find(|r| r.2 == start) else {
            self.error_at((file, start, 0), code, &[]);
            return;
        };
        let name = self.atom_text(value);
        let end = start + self.atoms().bytes(value).len() as u32;
        // `supportedExtensions`
        let extensions = if self.p.files.options.allow_js {
            &b"'.ts', '.tsx', '.d.ts', '.js', '.jsx', '.cts', '.d.cts', '.cjs', '.mts', '.d.mts', '.mjs'"[..]
        } else {
            b"'.ts', '.tsx', '.d.ts', '.cts', '.d.cts', '.mts', '.d.mts'"
        };
        let args = match code {
            1006 => Vec::new(),
            2688 => vec![name],
            2726 => {
                let lib = name.to_ascii_lowercase();
                let unqualified = lib.strip_prefix(b"lib.").unwrap_or(&lib);
                let unqualified = unqualified.strip_suffix(b".d.ts").unwrap_or(unqualified);
                let suggestion = spelling_suggestion(unqualified, crate::resolve::LIBS.iter());
                match suggestion {
                    Some(suggestion) => {
                        code = 2727;
                        vec![lib, suggestion]
                    }
                    None => vec![lib],
                }
            }
            6054 | 6231 => vec![
                strings::replace_owned(&name, b"\\", b"/"),
                extensions.to_vec(),
            ],
            _ => vec![strings::replace_owned(&name, b"\\", b"/")],
        };
        self.add_diagnostic(Reported::new((file, start, end), code, held(args)));
    }

    /// From `checkExportAssignment`, for an `export =` in a valid position: 1203 1218.
    pub(super) fn check_grammar_export_equals(&mut self, file: FileId, s: StmtId) {
        let (hir, kind) = (self.hir(file), self.p.files.options.module);
        let is_ambient = hir.is_ambient(hir.node(s));
        let format = self.files().module(file).implied_format;
        if kind >= ModuleKind::Es2015
            && kind != ModuleKind::Preserve
            && (is_ambient && format == ResolutionMode::Import
                || !is_ambient && format != ResolutionMode::Require)
        {
            self.grammar_error_on_node(file, s, 1203, &[]);
        } else if kind == ModuleKind::System && !is_ambient {
            self.grammar_error_on_node(file, s, 1218, &[]);
        }
    }

    /// `checkGrammarImportCallExpression`
    pub(super) fn check_grammar_import_call_expression(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, kind) = (self.hir(file), self.p.files.options.module);
        let ExprKind::ImportCall { args, .. } = hir[e].kind else {
            return false;
        };
        if self.p.files.options.verbatim_module_syntax && kind == ModuleKind::CommonJs {
            let message = self.verbatim_module_syntax_error_message(file);
            return self.grammar_error_on_node(file, e, message, &[]);
        }
        let (specifier, options) = (hir.id_at(args, 0), hir.ids(args).nth(1));
        let mut deferred = hir.deferred_import_calls.iter();
        if deferred.any(|call| call.0 == specifier) {
            if !matches!(kind, ModuleKind::EsNext | ModuleKind::Preserve) {
                return self.grammar_error_on_node(file, e, 18060, &[]);
            }
        } else if kind == ModuleKind::Es2015 {
            return self.grammar_error_on_node(file, e, 1323, &[]);
        }
        let mut with_type_arguments = hir.import_call_type_args.iter();
        if with_type_arguments.any(|call| call.0 == specifier) {
            return self.grammar_error_on_node(file, e, 1326, &[]);
        }
        if !kind.is_node() && !matches!(kind, ModuleKind::EsNext | ModuleKind::Preserve) {
            // `checkGrammarForDisallowedTrailingComma`: the call ends with its `)`.
            let close = hir[e].end.saturating_sub(1);
            if let Some(comma) = start_of_token_before(&hir.text, close, b",") {
                self.grammar_error_at((file, comma, comma + 1), 1009, &[]);
            }
            if let Some(options) = options {
                let at = self.span_of_parenthesized_expr(file, options);
                return self.grammar_error_at(at, 1324, &[]);
            }
        }
        if args.len() > 2 || matches!(hir[specifier].kind, ExprKind::Missing) {
            return self.grammar_error_on_node(file, e, 1450, &[]);
        }
        let is_spread = |a: &ExprId| matches!(hir[*a].kind, ExprKind::Spread(_));
        match [Some(specifier), options]
            .into_iter()
            .flatten()
            .find(is_spread)
        {
            Some(spread) => {
                let at = (file, hir[spread].pos, self.end_of_expr(file, spread));
                self.grammar_error_at(at, 1325, &[])
            }
            None => false,
        }
    }

    /// `checkGrammarYieldExpression`
    pub(super) fn check_grammar_yield_expression(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        if !hir.yield_context(hir.node(e)) {
            // `grammarErrorOnFirstToken`
            self.grammar_error_at((file, hir[e].pos, 0), 1163, &[]);
        }
        if hir.is_in_parameter_initializer_before_containing_function(hir.node(e)) {
            self.error(file, e, 2523, &[]);
        }
    }

    /// From `checkBinaryLikeExpression`, for `id`, which is `left, right`: 2695
    pub(super) fn check_comma_operator(
        &mut self,
        file: FileId,
        id: ExprId,
        left: ExprId,
        right: ExprId,
    ) {
        if self.p.files.options.allow_unreachable_code == Some(true)
            || !self.is_side_effect_free(file, left)
            || self.is_indirect_call(file, id, left, right)
        {
            return;
        }
        let start = self.start_of(file, left);
        if !self.is_in_adjacent_jsx_elements(file, id, start) {
            // An omitted operand is a zero-length identifier (`createMissingNode`).
            let at = match self.hir(file)[left].kind {
                ExprKind::Missing | ExprKind::Ident(known::empty) => {
                    (file, start, super::explain::NO_LENGTH)
                }
                _ => self.span_of_parenthesized_expr(file, left),
            };
            self.error_at(at, 2695, &[]);
        }
    }

    /// `isIndirectCall`: `(0, x.f)(..)` and `(0, eval)(..)` call without passing a `this`.
    fn is_indirect_call(&self, file: FileId, node: ExprId, left: ExprId, right: ExprId) -> bool {
        let hir = self.hir(file);
        let parent = hir.parent(hir.node(node));
        let (call, right) = (hir.parent(parent), hir.child(right));
        hir.kind(parent) == Kind::ParenthesizedExpression
            && !is_parenthesized(hir, left)
            && matches!(hir[left].kind, ExprKind::Number(n) if hir.numbers[n as usize] == 0.0)
            && (hir.kind(call) == Kind::CallExpression && hir.expression(call) == parent
                || hir.kind(call) == Kind::TaggedTemplateExpression)
            && (hir.kind(right).is_access_expression()
                || hir.kind(right) == Kind::Identifier && hir.text(right) == known::eval)
    }

    /// `isInDiag2657` of `checkBinaryLikeExpression`: whether `start`, where the left operand of `comma` starts, is in the span of a
    /// 2657. The span covers the adjacent elements, which the parser joins into a comma expression that starts where the error does.
    fn is_in_adjacent_jsx_elements(&self, file: FileId, comma: ExprId, start: u32) -> bool {
        let hir = self.hir(file);
        if !hir.diagnostics.iter().any(|d| d.code == 2657) {
            return false;
        }
        let is_reported_at = |pos: u32| hir.has_diagnostic(pos, 2657);
        if is_reported_at(start) {
            return true;
        }
        let joined = hir.find_ancestor(hir.node(comma), |n| {
            matches!(hir.data(n), NodeData::Expr(x)
                if matches!(hir[x].kind, ExprKind::Binary { op: BinOp::Comma, left, .. }
                    if matches!(hir[left].kind, ExprKind::Jsx(_)) && is_reported_at(hir[left].pos)))
        });
        joined.is_some()
    }

    /// `isSideEffectFree`
    fn is_side_effect_free(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            // A missing expression is a missing identifier.
            ExprKind::Ident(_)
            | ExprKind::Missing
            | ExprKind::String(_)
            | ExprKind::Regex
            | ExprKind::TaggedTemplate(_)
            | ExprKind::Template { .. }
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::Array(_)
            | ExprKind::Object(_)
            | ExprKind::NonNull(_)
            | ExprKind::Unary {
                op: UnOp::Typeof | UnOp::Not | UnOp::Plus | UnOp::Minus | UnOp::BitNot,
                ..
            } => true,
            // An element, not a fragment.
            ExprKind::Jsx(j) => hir[j].tag.is_some(),
            ExprKind::Cond { yes, no, .. } => {
                self.is_side_effect_free(file, yes) && self.is_side_effect_free(file, no)
            }
            // Iterates over the left spine, so that a long chain does not recurse.
            ExprKind::Binary { .. } => {
                let mut leftmost = e;
                while let ExprKind::Binary { left, right, .. } = hir[leftmost].kind {
                    if !self.is_side_effect_free(file, right) {
                        return false;
                    }
                    leftmost = left;
                }
                self.is_side_effect_free(file, leftmost)
            }
            _ => false,
        }
    }

    // ───────────────────────────── strict mode ─────────────────────────────

    /// The errors binder.go reports for an `Identifier` based on its text, and for the operand of
    /// `delete`: all code is strict mode code.
    /// `checkContextualIdentifier` reports nothing for a file unless it `parses`.
    fn check_strict_mode(&mut self, file: FileId, parses: bool) {
        let hir = self.hir(file);
        for &node in hir.keyword_identifiers() {
            match hir.text(node) {
                known::eval | known::arguments => {
                    self.check_strict_mode_eval_or_arguments(file, node)
                }
                _ if parses => self.check_contextual_identifier(file, node),
                _ => {}
            }
        }
        self.check_strict_mode_delete_expression(file);
    }

    /// `getStrictModeIdentifierMessage`, `getStrictModeEvalOrArgumentsMessage`: the message depends
    /// on why the code is strict: `[in a class, in a module, otherwise]`.
    fn strict_mode_message(&self, file: FileId, node: Node, codes: [u32; 3]) -> u32 {
        let hir = self.hir(file);
        if hir.get_containing_class(node).is_some() {
            codes[0]
        } else if hir.has_module_syntax {
            codes[1]
        } else {
            codes[2]
        }
    }

    /// `checkContextualIdentifier`
    fn check_contextual_identifier(&mut self, file: FileId, node: Node) {
        let hir = self.hir(file);
        if hir.is_ambient(node) || hir.is_in_jsdoc(hir.start(node)) || hir.is_identifier_name(node)
        {
            return;
        }
        let code = if hir.text(node) != known::r#await {
            self.strict_mode_message(file, node, [1213, 1214, 1212])
        } else if hir.has_module_syntax && hir.is_in_top_level_context(node) {
            1262
        } else if hir.await_context(node) == Ok(true) {
            1359
        } else {
            return;
        };
        // `DeclarationNameToString`: the source text, including escapes.
        let start = hir.start(node);
        let written = &hir.text[start as usize..self.end_of_name_at(file, start) as usize];
        self.error(file, node, code, &[Arg::Bytes(written)]);
    }

    /// `checkStrictModeEvalOrArguments` for `name`, which is `eval` or `arguments`, where binder.go
    /// calls it.
    fn check_strict_mode_eval_or_arguments(&mut self, file: FileId, name: Node) {
        let hir = self.hir(file);
        let context = hir.parent(name);
        let expression = match hir.data(context) {
            NodeData::Expr(e) => Some(hir[e].kind),
            _ => None,
        };
        let is_visited = match hir.kind(context) {
            // `bindVariableDeclarationOrBindingElement`
            Kind::VariableDeclaration | Kind::BindingElement => hir.name(context) == name,
            // `bindParameter`, `checkStrictModeFunctionName`
            Kind::Parameter | Kind::FunctionDeclaration | Kind::FunctionExpression => {
                hir.name(context) == name && !hir.is_ambient(context)
            }
            // `checkStrictModeBinaryExpression`
            Kind::BinaryExpression => {
                matches!(expression, Some(ExprKind::Assign { target, .. }) if hir.node(target) == name)
            }
            // `checkStrictModePostfixUnaryExpression`
            Kind::PostfixUnaryExpression => true,
            // `checkStrictModePrefixUnaryExpression`
            Kind::PrefixUnaryExpression => matches!(
                expression,
                Some(ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec,
                    ..
                })
            ),
            _ => false,
        };
        if is_visited {
            let code = self.strict_mode_message(file, context, [1210, 1215, 1100]);
            self.error(file, name, code, &[Arg::Atom(hir.text(name))]);
        }
    }

    /// `checkStrictModeDeleteExpression`
    fn check_strict_mode_delete_expression(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &id in self.exprs_by_kind(file).of(ExprTag::Unary) {
            let ExprKind::Unary {
                op: UnOp::Delete,
                operand,
            } = hir[id].kind
            else {
                continue;
            };
            // The binder visits every node of the tree, whether or not the checker does.
            if matches!(bound.expr_parent[id.idx()], Parent::None) {
                continue;
            }
            match hir[operand].kind {
                // A parenthesized expression is not an identifier, whatever it contains.
                ExprKind::Ident(_) if !is_parenthesized(hir, operand) => {
                    self.error_at((file, hir[operand].pos, 0), 1102, &[]);
                }
                // A missing operand is a missing identifier, which starts at the end of the keyword
                // (`createMissingNode`).
                ExprKind::Missing => {
                    let start = hir[id].pos + b"delete".len() as u32;
                    self.error_at((file, start, start), 1102, &[]);
                }
                _ => {}
            }
        }
    }
}

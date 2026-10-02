//! What is wrong with a file whatever the types in it are: uses of syntax that the options or strict mode do not allow.
//!
//! From TypeScript 7.0.2's grammarchecks.go, the `checkStrictMode*` functions of its binder.go, and the checks of this kind that
//! sit in checker.go. As there, nothing of this is said of a file that does not parse.

use super::sink::held;
use super::*;
use crate::bind::{ClassOwner, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind};
use crate::resolve::ModuleKind;

impl Checker<'_> {
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
            self.add_diagnostic(diagnostic);
        }
    }

    pub(super) fn check_grammar(&mut self, file: FileId) {
        let hir = self.hir(file);
        // A JSON file has no statements of its own: its `export =` is the binder's.
        if hir.has_errors || hir.kind == FileKind::Json {
            return;
        }
        // `grammarErrorOnNode` and its like say nothing of a file the parser objected to, nor does `checkContextualIdentifier`.
        let parses = !has_parse_diagnostics(hir);
        if parses {
            self.check_yield_in_property_initializers(file);
        }
        let said_before = self.reported.len();
        self.check_strict_mode(file, parses);
        // `getStrictModeIdentifierMessage`: all of them are reported on the name they are about.
        let names: Vec<u32> = self.reported[said_before..]
            .iter()
            .filter(|d| d.code == 1214)
            .map(|d| d.start)
            .collect();
        for start in names {
            self.note(
                start,
                0,
                1214,
                &[Arg::Text(&self.source_text(
                    file,
                    start,
                    self.end_of_name_at(file, start),
                ))],
            );
        }
    }

    /// `getSourceFileFromReference`, `processingDiagnostic.toDiagnostic`: what is said of the `/// <reference>` whose value is written at
    /// `start`: 2727 for 2726 where a library has nearly that name.
    fn report_missing_reference(&mut self, file: FileId, start: u32, mut code: u32) {
        let references = &self.hir(file).references;
        let Some(&(_, value, ..)) = references.iter().find(|r| r.2 == start) else {
            self.error_at((file, start, 0), code, &[]);
            return;
        };
        let name = self.atom_text(value);
        let end = start + self.files().atoms.bytes(value).len() as u32;
        // `supportedExtensions`
        let extensions = if self.p.files.options.allow_js {
            "'.ts', '.tsx', '.d.ts', '.js', '.jsx', '.cts', '.d.cts', '.cjs', '.mts', '.d.mts', '.mjs'"
        } else {
            "'.ts', '.tsx', '.d.ts', '.cts', '.d.cts', '.mts', '.d.mts'"
        };
        let args = match code {
            1006 => Vec::new(),
            2688 => vec![name],
            2726 => {
                let lib = name.to_lowercase();
                let unqualified = lib.strip_prefix("lib.").unwrap_or(&lib);
                let unqualified = unqualified.strip_suffix(".d.ts").unwrap_or(unqualified);
                let suggestion = spelling_suggestion(
                    unqualified.as_bytes(),
                    crate::resolve::LIB_NAMES.split(' ').map(str::as_bytes),
                );
                match suggestion {
                    Some(suggestion) => {
                        code = 2727;
                        vec![lib, suggestion]
                    }
                    None => vec![lib],
                }
            }
            6054 | 6231 => vec![name.replace('\\', "/"), extensions.to_owned()],
            _ => vec![name.replace('\\', "/")],
        };
        self.add_diagnostic(Reported::new((file, start, end), code, held(args)));
    }

    /// From `checkImportEqualsDeclaration`, past `checkGrammarModuleElementContext`: 1202 1392.
    pub(super) fn check_grammar_import_equals_declaration(&mut self, file: FileId, s: StmtId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let StmtKind::ImportEquals(id) = hir[s].kind else {
            return;
        };
        let (import, kind) = (&hir[id], self.p.files.options.module);
        // In a namespace it is out of place to begin with.
        if matches!(import.target, ImportEqualsTarget::Require(_))
            && matches!(bound.stmt_parent[s.idx()], Parent::File)
            && (ModuleKind::Es2015..=ModuleKind::EsNext).contains(&kind)
            && !import.flags.intersects(Flags::TYPE_ONLY | Flags::AMBIENT)
            && hir.kind != FileKind::Declaration
        {
            self.grammar_error_on_node(file, s, 1202, &[]);
        }
        if matches!(import.target, ImportEqualsTarget::Entity(_))
            && import.flags.contains(Flags::TYPE_ONLY)
        {
            self.grammar_error_on_node(file, s, 1392, &[]);
        }
    }

    /// From `checkExportAssignment`, of an `export =` that is in its place: 1203 1218.
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

    /// `checkGrammarImportCallExpression`: the first error of a call is the only one. `xm_import_calls_and_types` reports 1286 and 1295,
    /// `check_commas_of_import_calls` 1009, the parser 1326.
    pub(super) fn check_grammar_import_call_expression(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, kind) = (self.hir(file), self.p.files.options.module);
        let ExprKind::ImportCall { args, .. } = hir[e].kind else {
            return false;
        };
        if self.p.files.options.verbatim_module_syntax && kind == ModuleKind::CommonJs {
            return false;
        }
        let after_keyword = skip_trivia(&hir.text, hir[e].pos as usize + b"import".len());
        let after_keyword = hir.text.get(after_keyword).copied();
        if after_keyword == Some(b'.') {
            // `import.defer(..)`
            if !matches!(kind, ModuleKind::EsNext | ModuleKind::Preserve) {
                return self.grammar_error_on_node(file, e, 18060, &[]);
            }
        } else if kind == ModuleKind::Es2015 {
            let start = hir[e].pos;
            self.reported.retain(|d| d.code != 1326 || d.start != start);
            return self.grammar_error_on_node(file, e, 1323, &[]);
        }
        if after_keyword == Some(b'<') {
            return false;
        }
        let (specifier, options) = (hir.id_at(args, 0), hir.ids(args).nth(1));
        let has_import_attributes =
            kind.is_node() || matches!(kind, ModuleKind::EsNext | ModuleKind::Preserve);
        if !has_import_attributes && let Some(options) = options {
            let at = (
                file,
                self.start_of(file, options),
                self.error_end_of(file, options),
            );
            return self.grammar_error_at(at, 1324, &[]);
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

    /// `checkGrammarYieldExpression`: 1163. `parsePropertyDeclaration` parses an initializer outside of the yield context around the
    /// class, where `yield` is the keyword only if a name, a keyword or a literal follows on the same line (`isYieldExpression`).
    fn check_yield_in_property_initializers(&mut self, file: FileId) {
        let hir = self.hir(file);
        let index = self.exprs_by_kind(file);
        for &id in index.of(ExprTag::Yield) {
            let e = &hir[id];
            if !is_word_at(&hir.text, e.pos as usize, b"yield")
                || !operand_follows_on_the_line(&hir.text, e.pos as usize + 5)
            {
                continue;
            }
            let container = hir.get_this_container(hir.node(id), true, false);
            if hir.kind(container) == Kind::PropertyDeclaration {
                self.error_at((file, e.pos, 0), 1163, &[]);
            }
        }
    }

    /// From `checkBinaryLikeExpression`, of `id`, which is `left, right`: 2695
    pub(super) fn check_comma_operator(
        &mut self,
        file: FileId,
        id: ExprId,
        left: ExprId,
        right: ExprId,
    ) {
        if self.p.files.options.allow_unreachable_code || !self.is_side_effect_free(file, left) {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `isIndirectCall`: `(0, x.f)()` is a way of calling `x.f` without `x` for `this`.
        let is_zero =
            matches!(hir[left].kind, ExprKind::Number(n) if hir.numbers[n as usize] == 0.0);
        let is_callee = matches!(bound.expr_parent[id.idx()], Parent::Expr(p)
            if matches!(hir[p].kind, ExprKind::Call(c) | ExprKind::TaggedTemplate(c) if hir[c].callee == id));
        let is_reference = matches!(
            hir[right].kind,
            ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Ident(known::eval)
        );
        if is_zero && is_callee && is_reference {
            return;
        }
        let start = self.start_of(file, left);
        if !self.is_in_adjacent_jsx_elements(file, id, start) {
            // An operand that is left out is a name that takes no room (`createMissingNode`).
            let end = match hir[left].kind {
                ExprKind::Missing | ExprKind::Ident(known::empty) => super::explain::NO_LENGTH,
                _ => self.error_end_of(file, left),
            };
            self.error_at((file, start, end), 2695, &[]);
        }
    }

    /// `isInDiag2657` of `checkBinaryLikeExpression`: whether `start`, where the left operand of `comma` starts, is in the span of a
    /// 2657. The span covers the adjacent elements, which the parser joins into a comma expression that starts where the error does.
    fn is_in_adjacent_jsx_elements(&self, file: FileId, comma: ExprId, start: u32) -> bool {
        let hir = self.hir(file);
        if !hir.early_errors.iter().any(|&(_, code)| code == 2657) {
            return false;
        }
        let is_reported_at = |pos: u32| hir.early_errors.contains(&(pos, 2657));
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
            ExprKind::Binary { left, right, .. } => {
                self.is_side_effect_free(file, left) && self.is_side_effect_free(file, right)
            }
            _ => false,
        }
    }

    // ───────────────────────────── strict mode ─────────────────────────────

    /// 1100 1210 1215, 1212 1213 1214, 1102: everything is strict mode code. Reserved words are only looked for in a file that `parses`.
    fn check_strict_mode(&mut self, file: FileId, parses: bool) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.kind == FileKind::Declaration {
            return;
        }
        let is_module = hir.has_module_syntax;
        // What is said depends on why the code is strict: `[in a class, in a module, otherwise]`.
        let because = |in_class: bool, codes: [u32; 3]| {
            if in_class {
                codes[0]
            } else if is_module {
                codes[1]
            } else {
                codes[2]
            }
        };
        let pick = |c: &Self, parent: Parent, codes: [u32; 3]| {
            because(!c.classes_around(file, parent).is_empty(), codes)
        };
        const EVAL_OR_ARGUMENTS: [u32; 3] = [1210, 1215, 1100];
        const RESERVED: [u32; 3] = [1213, 1214, 1212];
        let is_eval_or_arguments = |name: Atom| name == known::eval || name == known::arguments;
        // Every name of the file is interned by now: a word that is not is the name of nothing here.
        const RESERVED_WORDS: [&[u8]; 9] = [
            b"implements",
            b"interface",
            b"let",
            b"package",
            b"private",
            b"protected",
            b"public",
            b"static",
            b"yield",
        ];
        let atoms = &self.files().atoms;
        let reserved_words: [Atom; 9] = if parses {
            RESERVED_WORDS.map(|word| atoms.lookup(word).unwrap_or(Atom::NONE))
        } else {
            [Atom::NONE; 9]
        };
        let is_reserved = |name: Atom| parses && name.is_some() && reserved_words.contains(&name);
        // What is in parentheses is no identifier, whatever is in them.
        let index = self.exprs_by_kind(file);
        if parses {
            for &id in index.of(ExprTag::Ident) {
                let e = &hir[id];
                // The operand of a `typeof` in a type is seen to with the types.
                if let ExprKind::Ident(name) = e.kind
                    && is_reserved(name)
                    && !bound.is_unchecked(id.idx())
                    && !bound.is_in_type_query(id)
                    && !hir.is_ambient(hir.node(id))
                {
                    self.error_at(
                        (file, e.pos, 0),
                        pick(self, Parent::Expr(id), RESERVED),
                        &[],
                    );
                }
            }
        }
        for &id in index
            .of(ExprTag::Assign)
            .iter()
            .chain(index.of(ExprTag::Unary))
        {
            if bound.is_unchecked(id.idx()) {
                continue;
            }
            let e = &hir[id];
            match e.kind {
                ExprKind::Assign {
                    target: operand, ..
                }
                | ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                    operand,
                } => {
                    if let ExprKind::Ident(name) = hir[operand].kind
                        && is_eval_or_arguments(name)
                        && !is_parenthesized(hir, operand)
                    {
                        self.error_at(
                            (file, hir[operand].pos, 0),
                            pick(self, Parent::Expr(id), EVAL_OR_ARGUMENTS),
                            &[],
                        );
                    }
                }
                // `checkStrictModeDeleteExpression`
                ExprKind::Unary {
                    op: UnOp::Delete,
                    operand,
                } if matches!(hir[operand].kind, ExprKind::Ident(_))
                    && !is_parenthesized(hir, operand) =>
                {
                    self.error_at((file, hir[operand].pos, 0), 1102, &[]);
                }
                // A missing operand is a missing identifier, which starts where the keyword ends (`createMissingNode`).
                ExprKind::Unary {
                    op: UnOp::Delete,
                    operand,
                } if matches!(hir[operand].kind, ExprKind::Missing) => {
                    let start = e.pos + b"delete".len() as u32;
                    self.error_at((file, start, start), 1102, &[]);
                }
                _ => {}
            }
        }
        'pats: for (i, pat) in hir.pats.iter().enumerate() {
            let PatKind::Ident(name) = pat.kind else {
                continue;
            };
            let is_eval = is_eval_or_arguments(name);
            if !(is_eval || is_reserved(name)) {
                continue;
            }
            let mut root = PatId(i as u32);
            let (in_class, is_ambient, is_parameter) = loop {
                match bound.pat_parent[root.idx()] {
                    PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => root = outer,
                    PatParent::Var(d) => {
                        break (
                            !self.classes_around(file, Parent::VarInit(d)).is_empty(),
                            hir[d].flags.contains(Flags::AMBIENT),
                            false,
                        );
                    }
                    PatParent::Param(p) if bound.param_fn[p.idx()].is_some() => {
                        // A signature or a function type says nothing of itself: what it is written in does.
                        let (in_class, is_ambient) = self.in_class_and_ambient(
                            file,
                            bound.fns[bound.param_fn[p.idx()].idx()].scope,
                        );
                        break (
                            in_class,
                            is_ambient || self.is_in_declared_variable(file, pat.pos),
                            true,
                        );
                    }
                    PatParent::Param(_) | PatParent::None => continue 'pats,
                }
            };
            // `checkContextualIdentifier` leaves alone what is ambient, and `bindParameter` the name of an ambient parameter.
            // `bindVariableDeclarationOrBindingElement` looks for `eval` and `arguments` all the same.
            if is_ambient && (!is_eval || is_parameter && root.idx() == i) {
                continue;
            }
            self.error_at(
                (file, pat.pos, 0),
                because(in_class, if is_eval { EVAL_OR_ARGUMENTS } else { RESERVED }),
                &[],
            );
        }
        for (i, f) in hir.fns.iter().enumerate() {
            if !matches!(f.kind, FnKind::Decl | FnKind::Expr) || f.flags.contains(Flags::AMBIENT) {
                continue;
            }
            if !(is_eval_or_arguments(f.name) || is_reserved(f.name)) {
                continue;
            }
            let parent = match bound.fns[i].owner {
                FnOwner::Expr(x) if x.is_some() => bound.expr_parent[x.idx()],
                FnOwner::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                _ => continue,
            };
            let codes = if is_eval_or_arguments(f.name) {
                EVAL_OR_ARGUMENTS
            } else {
                RESERVED
            };
            self.error_at((file, f.name_pos, 0), pick(self, parent, codes), &[]);
        }
        for (i, c) in hir.classes.iter().enumerate() {
            let is_bound = match bound.class_owner[i] {
                ClassOwner::Expr(x) => x.is_some() && !bound.is_unchecked(x.idx()),
                ClassOwner::Stmt(s) => s.is_some(),
            };
            // Its name is inside it.
            if is_bound && !c.flags.contains(Flags::AMBIENT) && is_reserved(c.name) {
                self.error_at((file, c.name_pos, 0), RESERVED[0], &[]);
            }
        }
        if !parses {
            return;
        }

        // `checkContextualIdentifier` is run on every identifier: on those of types and of the names of declarations too.
        let text: &[u8] = &hir.text;
        let in_scope = |c: &mut Self, name: Atom, start: u32, scope: ScopeId| {
            if scope.is_some()
                && is_reserved(name)
                && is_word_at(text, start as usize, c.files().atoms.bytes(name))
            {
                let (in_class, is_ambient) = c.in_class_and_ambient(file, scope);
                if !is_ambient && !c.is_in_declared_variable(file, start) {
                    c.error_at((file, start, 0), because(in_class, RESERVED), &[]);
                }
            }
        };
        for (i, t) in hir.types.iter().enumerate() {
            let scope = bound.type_scope[i];
            if bound.is_unchecked_type(i) {
                continue;
            }
            match t.kind {
                // `IsIdentifierName`: of `a.b.c` only `a` is looked at.
                TypeNodeKind::Ref { name, .. } if !name.is_empty() => {
                    in_scope(self, hir[name.at(0)].text, t.pos, scope)
                }
                TypeNodeKind::Typeof { expr, .. } if expr.is_some() => {
                    let leftmost = first_identifier(hir, expr);
                    if let ExprKind::Ident(name) = hir[leftmost].kind {
                        in_scope(self, name, hir[leftmost].pos, scope);
                    }
                }
                TypeNodeKind::Import { name, .. }
                    if !name.is_empty() && is_reserved(hir[name.at(0)].text) =>
                {
                    // Where the name is is not kept: past `import( .. )` and the dot.
                    let (mut at, mut depth) = (t.pos as usize, 0u32);
                    while let Some(&b) = text.get(at) {
                        match b {
                            b'(' => depth += 1,
                            b')' if depth <= 1 => break,
                            b')' => depth -= 1,
                            _ => {}
                        }
                        at += 1;
                    }
                    let dot = skip_trivia(text, at + 1);
                    if text.get(dot) == Some(&b'.') {
                        in_scope(
                            self,
                            hir[name.at(0)].text,
                            skip_trivia(text, dot + 1) as u32,
                            scope,
                        );
                    }
                }
                TypeNodeKind::Predicate { param, asserts, .. } => {
                    let start = if asserts {
                        skip_trivia(text, t.pos as usize + b"asserts".len()) as u32
                    } else {
                        t.pos
                    };
                    in_scope(self, param, start, scope);
                }
                TypeNodeKind::Tuple(elems) => {
                    for e in elems.iter() {
                        let elem = &hir[e];
                        if !is_reserved(elem.name) {
                            continue;
                        }
                        // Where the name is is not kept: back from the type over `...`, `:` and `?`.
                        let Some(before) = text.get(..hir[elem.ty].pos as usize) else {
                            continue;
                        };
                        let before = before.trim_ascii_end();
                        let before = before
                            .strip_suffix(b"...")
                            .map_or(before, <[u8]>::trim_ascii_end);
                        let Some(before) = before.strip_suffix(b":") else {
                            continue;
                        };
                        let before = before.trim_ascii_end();
                        let before = before
                            .strip_suffix(b"?")
                            .map_or(before, <[u8]>::trim_ascii_end);
                        let len = self.files().atoms.bytes(elem.name).len();
                        if before.len() >= len {
                            in_scope(self, elem.name, (before.len() - len) as u32, scope);
                        }
                    }
                }
                _ => {}
            }
        }
        for (i, p) in hir.type_params.iter().enumerate() {
            in_scope(self, p.name, p.pos, bound.type_param_scope[i]);
        }
        // The names statements give and use.
        let named = |c: &mut Self, name: Atom, start: u32, parent: Parent| {
            if is_reserved(name) && is_word_at(text, start as usize, c.files().atoms.bytes(name)) {
                c.error_at((file, start, 0), pick(c, parent, RESERVED), &[]);
            }
        };
        for (i, s) in hir.stmts.iter().enumerate() {
            let parent = bound.stmt_parent[i];
            // What is in an ambient namespace or module is ambient, whether or not it can say so.
            if matches!(parent, Parent::None)
                || matches!(parent, Parent::Module(m) if hir[m].flags.contains(Flags::AMBIENT))
            {
                continue;
            }
            match s.kind {
                StmtKind::Interface(x) if !hir[x].flags.contains(Flags::AMBIENT) => {
                    named(self, hir[x].name, hir[x].name_pos, parent)
                }
                StmtKind::TypeAlias(x) if !hir[x].flags.contains(Flags::AMBIENT) => {
                    named(self, hir[x].name, hir[x].name_pos, parent)
                }
                StmtKind::Enum(x) if !hir[x].flags.contains(Flags::AMBIENT) => {
                    named(self, hir[x].name, hir[x].name_pos, parent)
                }
                StmtKind::Module(x) if !hir[x].flags.contains(Flags::AMBIENT) => {
                    if let ModuleName::Ident(name) = hir[x].name {
                        named(self, name, hir[x].name_pos, parent);
                    }
                }
                StmtKind::ImportEquals(x) if !hir[x].flags.contains(Flags::AMBIENT) => {
                    let import = &hir[x];
                    named(self, import.name, import.name_pos, parent);
                    // Of `a.b.c` only `a`, which comes after the `=`.
                    if let ImportEqualsTarget::Entity(path) = import.target
                        && !path.is_empty()
                        && is_reserved(hir[path.at(0)].text)
                    {
                        let equals = skip_trivia(
                            text,
                            import.name_pos as usize + self.files().atoms.bytes(import.name).len(),
                        );
                        if text.get(equals) == Some(&b'=') {
                            named(
                                self,
                                hir[path.at(0)].text,
                                skip_trivia(text, equals + 1) as u32,
                                parent,
                            );
                        }
                    }
                }
                // The local names: what is imported can go by any word.
                StmtKind::Import(x) => {
                    let import = &hir[x];
                    named(self, import.default, import.default_pos, parent);
                    named(self, import.namespace, import.namespace_pos, parent);
                    for spec in import.named.iter() {
                        named(self, hir[spec].local, hir[spec].pos, parent);
                    }
                }
                StmtKind::ExportStar {
                    alias, alias_pos, ..
                } if is_reserved(alias) => named(self, alias, alias_pos, parent),
                StmtKind::Labeled { label, .. } => named(self, label, s.start, parent),
                StmtKind::Break(label) if label.is_some() => {
                    named(
                        self,
                        label,
                        skip_trivia(text, s.start as usize + b"break".len()) as u32,
                        parent,
                    );
                }
                StmtKind::Continue(label) if label.is_some() => {
                    named(
                        self,
                        label,
                        skip_trivia(text, s.start as usize + b"continue".len()) as u32,
                        parent,
                    );
                }
                _ => {}
            }
        }
    }

    /// Of what is written in `scope`: whether a class is around it (`GetContainingClass`), and whether it is ambient
    /// (`NodeFlagsAmbient`).
    fn in_class_and_ambient(&self, file: FileId, mut scope: ScopeId) -> (bool, bool) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut in_class, mut flags) = (false, Flags::empty());
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            flags |= match s.kind {
                ScopeKind::Module(m) => hir[m].flags,
                ScopeKind::Fn(f) => hir[f].flags,
                ScopeKind::Class(c) => {
                    in_class = true;
                    hir[c].flags
                }
                ScopeKind::Interface(i) => hir[i].flags,
                ScopeKind::Enum(e) => hir[e].flags,
                ScopeKind::TypeAlias(a) => hir[a].flags,
                _ => Flags::empty(),
            };
            scope = s.parent;
        }
        (in_class, flags.contains(Flags::AMBIENT))
    }

    /// Whether `at` is in a variable statement or in a property of a class that says `declare` for itself: neither opens a scope that
    /// would tell. What starts last before `at` is what it is in: no statement is written in a type.
    fn is_in_declared_variable(&self, file: FileId, at: u32) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let stmt = (0..hir.stmts.len())
            .filter(|&s| hir.stmts[s].start <= at && !matches!(bound.stmt_parent[s], Parent::None))
            .max_by_key(|&s| hir.stmts[s].start);
        let member = (0..hir.members.len())
            .filter(|&m| {
                hir.members[m].start <= at && matches!(bound.member_owner[m], MemberOwner::Class(_))
            })
            .max_by_key(|&m| hir.members[m].start);
        match (stmt, member) {
            (stmt, Some(m)) if stmt.is_none_or(|s| hir.stmts[s].start < hir.members[m].start) => {
                hir.members[m].kind == MemberKind::Property
                    && hir.members[m].flags.contains(Flags::AMBIENT)
            }
            (Some(s), _) => {
                matches!(hir.stmts[s].kind, StmtKind::Var(decls) if decls.iter().next().is_some_and(|d| hir[d].flags.contains(Flags::AMBIENT)))
            }
            (None, _) => false,
        }
    }
}

// ───────────────────────────── the text ─────────────────────────────

/// `nextTokenIsIdentifierOrKeywordOrLiteralOnSameLine`, of the token that ends at `at`.
fn operand_follows_on_the_line(text: &[u8], mut at: usize) -> bool {
    loop {
        match text.get(at..).unwrap_or_default() {
            [b' ' | b'\t' | 0x0b | 0x0c, ..] => at += 1,
            [b'/', b'*', rest @ ..] => {
                let Some(end) = rest.windows(2).position(|w| w == b"*/") else {
                    return false;
                };
                if rest[..end].iter().any(|b| matches!(b, b'\n' | b'\r')) {
                    return false;
                }
                at += end + 4;
            }
            [b'.', second, ..] => return second.is_ascii_digit(),
            [first, ..] => {
                return first.is_ascii_alphanumeric()
                    || matches!(first, b'_' | b'$' | b'\\' | b'"' | b'\'')
                    || *first >= 0x80;
            }
            [] => return false,
        }
    }
}

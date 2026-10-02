//! What is wrong with a file whatever the types in it are: uses of syntax that the options or strict mode do not allow.
//!
//! From TypeScript 7.0.2's grammarchecks.go, the `checkStrictMode*` functions of its binder.go, and the checks of this kind that
//! sit in checker.go. As there, nothing of this is said of a file that does not parse.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{ClassOwner, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind};
use crate::resolve::ModuleKind;

impl Checker<'_> {
    pub(super) fn check_grammar(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        for &(start, code) in &self.files().module(file).missing_references {
            let code = self.note_missing_reference(file, start, code);
            out.push(Diagnostic { start, code });
        }
        for (_, start, end, problem) in self.files().include_problems_in(file) {
            out.push(Diagnostic {
                start: *start,
                code: problem.code,
            });
            self.note(*start, *end, problem.code, problem.args.clone());
            self.explain_chain(*start, problem.code, |_| {
                problem
                    .chain
                    .iter()
                    .map(|(level, code, args)| super::explain::Line {
                        code: *code,
                        args: args.clone(),
                        level: *level,
                    })
                    .collect()
            });
        }
        let hir = self.hir(file);
        // A JSON file has no statements of its own: its `export =` is the binder's.
        if hir.has_errors || hir.kind == FileKind::Json {
            return;
        }
        // `grammarErrorOnNode` and its like say nothing of a file the parser objected to, nor does `checkContextualIdentifier`.
        let parses = !has_parse_diagnostics(hir);
        if parses {
            self.check_module_syntax(file, out);
            self.check_variables_are_initialized(file, out);
            self.check_yield_in_property_initializers(file, out);
        }
        let said_before = out.len();
        self.check_strict_mode(file, parses, out);
        // `getStrictModeIdentifierMessage`: all of them are reported on the name they are about.
        for d in &out[said_before..] {
            if d.code == 1214 {
                let start = d.start;
                self.explain(start, 1214, |c| {
                    vec![c.source_text(file, start, c.end_of_name_at(file, start))]
                });
            }
        }
        self.check_comma_operators(file, out);
    }

    /// `getSourceFileFromReference`, `processingDiagnostic.toDiagnostic`: what is said of the `/// <reference>` whose value is written at
    /// `start`. Returns the code of what is said: 2727 for 2726 where a library has nearly that name.
    fn note_missing_reference(&self, file: FileId, start: u32, mut code: u32) -> u32 {
        let references = &self.hir(file).references;
        let Some(&(_, value, ..)) = references.iter().find(|r| r.2 == start) else {
            return code;
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
                let suggestion = super::errors_x_regexp_scanner::spelling_suggestion(
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
        self.note(start, end, code, args);
        code
    }

    /// `GetImpliedNodeFormatForEmit`: `Some(true)` for an ECMAScript module, `Some(false)` for CommonJS.
    fn implied_format_for_emit(&self, file: FileId) -> Option<bool> {
        let module = self.files().module(file);
        if self.p.files.options.module.is_node() {
            return Some(module.is_esm);
        }
        let path = module.path.as_str();
        if path.ends_with(".cts") || path.ends_with(".cjs") {
            Some(false)
        } else if path.ends_with(".mts") || path.ends_with(".mjs") || module.says_esm {
            Some(true)
        } else {
            None
        }
    }

    /// 1202 1203 1218 1392, 1323 1324 1325 18060
    fn check_module_syntax(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let kind = self.p.files.options.module;
        let is_declaration_file = hir.kind == FileKind::Declaration;
        for (i, s) in hir.stmts.iter().enumerate() {
            if !matches!(
                s.kind,
                StmtKind::ImportEquals(_) | StmtKind::ExportAssign(_)
            ) || matches!(bound.stmt_parent[i], Parent::None)
            {
                continue;
            }
            match s.kind {
                StmtKind::ImportEquals(id) => {
                    let import = &hir[id];
                    // In a namespace it is out of place to begin with.
                    if matches!(import.target, ImportEqualsTarget::Require(_))
                        && matches!(bound.stmt_parent[i], Parent::File)
                        && (ModuleKind::Es2015..=ModuleKind::EsNext).contains(&kind)
                        && !import.flags.intersects(Flags::TYPE_ONLY | Flags::AMBIENT)
                        && !is_declaration_file
                    {
                        out.push(Diagnostic {
                            start: s.pos,
                            code: 1202,
                        });
                        let end = self.end_of_stmt(file, StmtId(i as u32));
                        self.note(s.pos, end, 1202, Vec::new());
                    }
                    // `checkImportEqualsDeclaration`
                    if matches!(import.target, ImportEqualsTarget::Entity(_))
                        && import.flags.contains(Flags::TYPE_ONLY)
                        && matches!(bound.stmt_parent[i], Parent::File | Parent::Module(_))
                    {
                        out.push(Diagnostic {
                            start: s.pos,
                            code: 1392,
                        });
                        let end = self.end_of_stmt(file, StmtId(i as u32));
                        self.note(s.pos, end, 1392, Vec::new());
                    }
                }
                StmtKind::ExportAssign(_) => {
                    // `checkExportAssignment`: where it is out of place, in a block or in a namespace, no more is said of it.
                    match bound.stmt_parent[i] {
                        Parent::File => {}
                        Parent::Module(m) if !matches!(hir[m].name, ModuleName::Ident(_)) => {}
                        _ => continue,
                    }
                    let is_ambient = is_declaration_file
                        || matches!(bound.stmt_parent[i], Parent::Module(m) if hir[m].flags.contains(Flags::AMBIENT));
                    let format = self.implied_format_for_emit(file);
                    if kind >= ModuleKind::Es2015
                        && kind != ModuleKind::Preserve
                        && (is_ambient && format == Some(true)
                            || !is_ambient && format != Some(false))
                    {
                        out.push(Diagnostic {
                            start: s.pos,
                            code: 1203,
                        });
                        let end = self.end_of_stmt(file, StmtId(i as u32));
                        self.note(s.pos, end, 1203, Vec::new());
                    } else if kind == ModuleKind::System && !is_ambient {
                        out.push(Diagnostic {
                            start: s.pos,
                            code: 1218,
                        });
                        let end = self.end_of_stmt(file, StmtId(i as u32));
                        self.note(s.pos, end, 1218, Vec::new());
                    }
                }
                _ => {}
            }
        }
        // `checkGrammarImportCallExpression`: the first error of a call is the only one. `xm_import_calls_and_types` reports 1286 and
        // 1295, `check_commas_of_import_calls` 1009, the parser 1326.
        if self.p.files.options.verbatim_module_syntax && kind == ModuleKind::CommonJs {
            return;
        }
        let has_import_attributes =
            kind.is_node() || matches!(kind, ModuleKind::EsNext | ModuleKind::Preserve);
        let index = self.exprs_by_kind(file);
        for &id in index.of(ExprTag::ImportCall) {
            let (i, e) = (id.idx(), &hir[id]);
            let ExprKind::ImportCall(specifier) = e.kind else {
                continue;
            };
            if matches!(bound.expr_parent[i], Parent::None) {
                continue;
            }
            let after_keyword = hir
                .text
                .get(skip_trivia(&hir.text, e.pos as usize + b"import".len()))
                .copied();
            if after_keyword == Some(b'.') {
                // `import.defer(..)`
                if !matches!(kind, ModuleKind::EsNext | ModuleKind::Preserve) {
                    out.push(Diagnostic {
                        start: e.pos,
                        code: 18060,
                    });
                    let end = self.end_inside_parentheses(file, ExprId(i as u32));
                    self.note(e.pos, end, 18060, Vec::new());
                    continue;
                }
            } else if kind == ModuleKind::Es2015 {
                out.retain(|d| d.code != 1326 || d.start != e.pos);
                out.push(Diagnostic {
                    start: e.pos,
                    code: 1323,
                });
                let end = self.end_inside_parentheses(file, ExprId(i as u32));
                self.note(e.pos, end, 1323, Vec::new());
                continue;
            }
            if after_keyword == Some(b'<') {
                continue;
            }
            let options = hir
                .import_options
                .iter()
                .find(|o| o.0 == specifier)
                .map(|o| o.1);
            if !has_import_attributes && let Some(options) = options {
                let start = self.start_of(file, options);
                out.push(Diagnostic { start, code: 1324 });
                self.note(start, self.error_end_of(file, options), 1324, Vec::new());
                continue;
            }
            // Of the arguments only the first two are kept.
            let has_a_third = options.is_some_and(|options| {
                let comma = skip_trivia(&hir.text, self.end_of_expr(file, options) as usize);
                hir.text.get(comma) == Some(&b',')
                    && hir.text.get(skip_trivia(&hir.text, comma + 1)) != Some(&b')')
            });
            if has_a_third || matches!(hir[specifier].kind, ExprKind::Missing) {
                out.push(Diagnostic {
                    start: e.pos,
                    code: 1450,
                });
                let end = self.end_inside_parentheses(file, id);
                self.note(e.pos, end, 1450, Vec::new());
                continue;
            }
            if let Some(spread) = [Some(specifier), options]
                .into_iter()
                .flatten()
                .find(|&a| matches!(hir[a].kind, ExprKind::Spread(_)))
            {
                out.push(Diagnostic {
                    start: hir[spread].pos,
                    code: 1325,
                });
                let end = self.end_of_expr(file, spread);
                self.note(hir[spread].pos, end, 1325, Vec::new());
            }
        }
    }

    /// `checkGrammarVariableDeclaration`, as far as what has to be initialized goes: 1492, 1182, 1155.
    fn check_variables_are_initialized(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.kind == FileKind::Declaration {
            return;
        }
        for (d, decl) in hir.var_decls.iter().enumerate() {
            let is_using = matches!(decl.kind, VarKind::Using | VarKind::AwaitUsing);
            if !is_using && (decl.init.is_some() || decl.flags.contains(Flags::AMBIENT)) {
                continue;
            }
            // The variable of a `catch` clause is put down to the `try` statement: `checkVariableDeclaration` does not see it.
            let stmt = bound.var_stmt[d];
            if stmt.is_none() || !matches!(hir[stmt].kind, StmtKind::Var(_)) {
                continue;
            }
            let is_pattern = matches!(hir[decl.pat].kind, PatKind::Object(_) | PatKind::Array(_));
            let start = hir[decl.pat].pos;
            let keyword = match decl.kind {
                VarKind::AwaitUsing => "await using",
                VarKind::Using => "using",
                _ => "const",
            };
            if is_pattern && is_using {
                out.push(Diagnostic { start, code: 1492 });
                let end = self.end_of_pat(file, decl.pat);
                self.note(start, end, 1492, vec![keyword.to_owned()]);
                continue;
            }
            if decl.init.is_some() || decl.flags.contains(Flags::AMBIENT) {
                continue;
            }
            // The head of a `for`-`in` or a `for`-`of` gives its variable a value.
            if let Parent::Stmt(owner) = bound.stmt_parent[stmt.idx()]
                && owner.is_some()
                && matches!(hir[owner].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt)
            {
                continue;
            }
            if is_pattern {
                out.push(Diagnostic { start, code: 1182 });
                self.note(start, self.end_of_pat(file, decl.pat), 1182, Vec::new());
            } else if is_using || decl.kind == VarKind::Const {
                out.push(Diagnostic { start, code: 1155 });
                self.note(start, 0, 1155, vec![keyword.to_owned()]);
            }
        }
    }

    /// `checkGrammarYieldExpression`: 1163. `parsePropertyDeclaration` parses an initializer outside of the yield context around the
    /// class, where `yield` is the keyword only if a name, a keyword or a literal follows on the same line (`isYieldExpression`).
    fn check_yield_in_property_initializers(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let index = self.exprs_by_kind(file);
        for &id in index.of(ExprTag::Yield) {
            let e = &hir[id];
            if !is_word_at(&hir.text, e.pos as usize, b"yield")
                || !operand_follows_on_the_line(&hir.text, e.pos as usize + 5)
            {
                continue;
            }
            let (mut at, mut below) = (bound.expr_parent[id.idx()], id);
            let is_in_initializer = loop {
                match at {
                    Parent::MemberInit(_) => break true,
                    Parent::Expr(x) if x.is_some() => below = x,
                    Parent::Prop(_)
                    | Parent::Key(_)
                    | Parent::MemberKey
                    | Parent::ClassExtends(_)
                    | Parent::Decorator(..) => {}
                    _ => break false,
                }
                at = self.outward_from_names(file, at, below);
            };
            if is_in_initializer {
                out.push(Diagnostic {
                    start: e.pos,
                    code: 1163,
                });
            }
        }
    }

    /// What is around what `at` stands for, as `outward` has it, computed names included. `below` is the expression gone through last.
    fn outward_from_names(&self, file: FileId, at: Parent, below: ExprId) -> Parent {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match at {
            Parent::Key(object) if object.is_some() => Parent::Expr(object),
            // The name of a member is where the class is, that of a method of an object literal where the literal is.
            Parent::MemberKey => {
                let key = PropKey::Computed(below);
                if let Some(m) = hir.members.iter().position(|m| m.key == key) {
                    match bound.member_owner[m] {
                        MemberOwner::Class(c) => Parent::ClassExtends(c),
                        _ => Parent::None,
                    }
                } else if let Some(p) = hir.props.iter().position(|p| p.key == key) {
                    Parent::Prop(PropId(p as u32))
                } else {
                    Parent::None
                }
            }
            _ => self.outward(file, at),
        }
    }

    /// 2695
    fn check_comma_operators(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        if self.p.files.options.allow_unreachable_code {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let index = self.exprs_by_kind(file);
        for &id in index.of(ExprTag::Binary) {
            let ExprKind::Binary {
                op: BinOp::Comma,
                left,
                right,
            } = hir[id].kind
            else {
                continue;
            };
            let i = id.idx();
            if matches!(bound.expr_parent[i], Parent::None) || !self.is_side_effect_free(file, left)
            {
                continue;
            }
            // `isIndirectCall`: `(0, x.f)()` is a way of calling `x.f` without `x` for `this`.
            let is_zero =
                matches!(hir[left].kind, ExprKind::Number(n) if hir.numbers[n as usize] == 0.0);
            let is_callee = matches!(bound.expr_parent[i], Parent::Expr(p)
                if matches!(hir[p].kind, ExprKind::Call(c) | ExprKind::TaggedTemplate(c) if hir[c].callee == id));
            let is_reference = matches!(
                hir[right].kind,
                ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Ident(known::eval)
            );
            if is_zero && is_callee && is_reference {
                continue;
            }
            let start = self.start_of(file, left);
            if !self.is_in_adjacent_jsx_elements(file, id, start) {
                out.push(Diagnostic { start, code: 2695 });
                // An operand that is left out is a name that takes no room (`createMissingNode`).
                let end = match hir[left].kind {
                    ExprKind::Missing | ExprKind::Ident(known::empty) => super::explain::NO_LENGTH,
                    _ => self.error_end_of(file, left),
                };
                self.note(start, end, 2695, Vec::new());
            }
        }
    }

    /// `isInDiag2657` of `checkBinaryLikeExpression`: whether `start`, where the left operand of `comma` starts, is in the span of a
    /// 2657. The span covers the adjacent elements, which the parser joins into a comma expression that starts where the error does.
    fn is_in_adjacent_jsx_elements(&self, file: FileId, comma: ExprId, start: u32) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.early_errors.iter().any(|&(_, code)| code == 2657) {
            return false;
        }
        let is_reported_at = |pos: u32| hir.early_errors.contains(&(pos, 2657));
        if is_reported_at(start) {
            return true;
        }
        let (mut at, mut below) = (Parent::Expr(comma), comma);
        loop {
            at = match at {
                Parent::None | Parent::File => return false,
                Parent::Expr(x) if x.is_none() => return false,
                Parent::Expr(x) => {
                    if let ExprKind::Binary {
                        op: BinOp::Comma,
                        left,
                        ..
                    } = hir[x].kind
                        && matches!(hir[left].kind, ExprKind::Jsx(_))
                        && is_reported_at(hir[left].pos)
                    {
                        return true;
                    }
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                other => self.outward_from_names(file, other, below),
            };
        }
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
    fn check_strict_mode(&mut self, file: FileId, parses: bool, out: &mut Vec<Diagnostic>) {
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
        let is_parenthesized = |e: ExprId| hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok();
        let index = self.exprs_by_kind(file);
        if parses {
            for &id in index.of(ExprTag::Ident) {
                let e = &hir[id];
                // The operand of a `typeof` in a type is seen to with the types.
                if let ExprKind::Ident(name) = e.kind
                    && is_reserved(name)
                    && !matches!(bound.expr_parent[id.idx()], Parent::None)
                    && !bound.is_in_type_query(id)
                    && !self.is_ambient_expr(file, id)
                {
                    out.push(Diagnostic {
                        start: e.pos,
                        code: pick(self, Parent::Expr(id), RESERVED),
                    });
                }
            }
        }
        for &id in index
            .of(ExprTag::Assign)
            .iter()
            .chain(index.of(ExprTag::Unary))
        {
            if matches!(bound.expr_parent[id.idx()], Parent::None) {
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
                        && !is_parenthesized(operand)
                    {
                        out.push(Diagnostic {
                            start: hir[operand].pos,
                            code: pick(self, Parent::Expr(id), EVAL_OR_ARGUMENTS),
                        });
                    }
                }
                // `checkStrictModeDeleteExpression`
                ExprKind::Unary {
                    op: UnOp::Delete,
                    operand,
                } if matches!(hir[operand].kind, ExprKind::Ident(_))
                    && !is_parenthesized(operand) =>
                {
                    out.push(Diagnostic {
                        start: hir[operand].pos,
                        code: 1102,
                    });
                }
                // A missing operand is a missing identifier, which starts where the keyword ends (`createMissingNode`).
                ExprKind::Unary {
                    op: UnOp::Delete,
                    operand,
                } if matches!(hir[operand].kind, ExprKind::Missing) => {
                    let start = e.pos + b"delete".len() as u32;
                    out.push(Diagnostic { start, code: 1102 });
                    self.note(start, super::explain::NO_LENGTH, 1102, Vec::new());
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
            out.push(Diagnostic {
                start: pat.pos,
                code: because(in_class, if is_eval { EVAL_OR_ARGUMENTS } else { RESERVED }),
            });
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
            out.push(Diagnostic {
                start: f.name_pos,
                code: pick(self, parent, codes),
            });
        }
        for (i, c) in hir.classes.iter().enumerate() {
            let is_bound = match bound.class_owner[i] {
                ClassOwner::Expr(x) => {
                    x.is_some() && !matches!(bound.expr_parent[x.idx()], Parent::None)
                }
                ClassOwner::Stmt(s) => s.is_some(),
            };
            // Its name is inside it.
            if is_bound && !c.flags.contains(Flags::AMBIENT) && is_reserved(c.name) {
                out.push(Diagnostic {
                    start: c.name_pos,
                    code: RESERVED[0],
                });
            }
        }
        if !parses {
            return;
        }

        // `checkContextualIdentifier` is run on every identifier: on those of types and of the names of declarations too.
        let text: &[u8] = &hir.text;
        let in_scope =
            |c: &Self, name: Atom, start: u32, scope: ScopeId, out: &mut Vec<Diagnostic>| {
                if scope.is_some()
                    && is_reserved(name)
                    && is_word_at(text, start as usize, c.files().atoms.bytes(name))
                {
                    let (in_class, is_ambient) = c.in_class_and_ambient(file, scope);
                    if !is_ambient && !c.is_in_declared_variable(file, start) {
                        out.push(Diagnostic {
                            start,
                            code: because(in_class, RESERVED),
                        });
                    }
                }
            };
        for (i, t) in hir.types.iter().enumerate() {
            let scope = bound.type_scope[i];
            if scope.is_none() {
                continue;
            }
            match t.kind {
                // `IsIdentifierName`: of `a.b.c` only `a` is looked at.
                TypeNodeKind::Ref { name, .. } if !name.is_empty() => {
                    in_scope(self, hir.id_at(name, 0), t.pos, scope, out)
                }
                TypeNodeKind::Typeof { expr, .. } if expr.is_some() => {
                    let mut leftmost = expr;
                    while let ExprKind::Dot { obj, .. } = hir[leftmost].kind {
                        leftmost = obj;
                    }
                    if let ExprKind::Ident(name) = hir[leftmost].kind {
                        in_scope(self, name, hir[leftmost].pos, scope, out);
                    }
                }
                TypeNodeKind::Import { name, .. }
                    if !name.is_empty() && is_reserved(hir.id_at(name, 0)) =>
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
                            hir.id_at(name, 0),
                            skip_trivia(text, dot + 1) as u32,
                            scope,
                            out,
                        );
                    }
                }
                TypeNodeKind::Predicate { param, asserts, .. } => {
                    let start = if asserts {
                        skip_trivia(text, t.pos as usize + b"asserts".len()) as u32
                    } else {
                        t.pos
                    };
                    in_scope(self, param, start, scope, out);
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
                            in_scope(self, elem.name, (before.len() - len) as u32, scope, out);
                        }
                    }
                }
                _ => {}
            }
        }
        for (i, p) in hir.type_params.iter().enumerate() {
            in_scope(self, p.name, p.pos, bound.type_param_scope[i], out);
        }
        // The names statements give and use.
        let named =
            |c: &Self, name: Atom, start: u32, parent: Parent, out: &mut Vec<Diagnostic>| {
                if is_reserved(name)
                    && is_word_at(text, start as usize, c.files().atoms.bytes(name))
                {
                    out.push(Diagnostic {
                        start,
                        code: pick(c, parent, RESERVED),
                    });
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
                    named(self, hir[x].name, hir[x].name_pos, parent, out)
                }
                StmtKind::TypeAlias(x) if !hir[x].flags.contains(Flags::AMBIENT) => {
                    named(self, hir[x].name, hir[x].name_pos, parent, out)
                }
                StmtKind::Enum(x) if !hir[x].flags.contains(Flags::AMBIENT) => {
                    named(self, hir[x].name, hir[x].name_pos, parent, out)
                }
                StmtKind::Module(x) if !hir[x].flags.contains(Flags::AMBIENT) => {
                    if let ModuleName::Ident(name) = hir[x].name {
                        named(self, name, hir[x].name_pos, parent, out);
                    }
                }
                StmtKind::ImportEquals(x) if !hir[x].flags.contains(Flags::AMBIENT) => {
                    let import = &hir[x];
                    named(self, import.name, import.name_pos, parent, out);
                    // Of `a.b.c` only `a`, which comes after the `=`.
                    if let ImportEqualsTarget::Entity(path) = import.target
                        && !path.is_empty()
                        && is_reserved(hir.id_at(path, 0))
                    {
                        let equals = skip_trivia(
                            text,
                            import.name_pos as usize + self.files().atoms.bytes(import.name).len(),
                        );
                        if text.get(equals) == Some(&b'=') {
                            named(
                                self,
                                hir.id_at(path, 0),
                                skip_trivia(text, equals + 1) as u32,
                                parent,
                                out,
                            );
                        }
                    }
                }
                // The local names: what is imported can go by any word.
                StmtKind::Import(x) => {
                    let import = &hir[x];
                    named(self, import.default, import.default_pos, parent, out);
                    named(self, import.namespace, import.namespace_pos, parent, out);
                    for spec in import.named.iter() {
                        named(self, hir[spec].local, hir[spec].pos, parent, out);
                    }
                }
                StmtKind::ExportStar { alias, .. } if is_reserved(alias) => {
                    // Where the name is is not kept: past `export`, `type`, `*` and `as`.
                    let words: [&[u8]; 4] = [b"export", b"type", b"*", b"as"];
                    let mut at = s.pos as usize;
                    for word in words {
                        at = skip_trivia(text, at);
                        if text.get(at..).is_some_and(|rest| rest.starts_with(word)) {
                            at += word.len();
                        }
                    }
                    named(self, alias, skip_trivia(text, at) as u32, parent, out);
                }
                StmtKind::Labeled { label, .. } => named(self, label, s.pos, parent, out),
                StmtKind::Break(label) if label.is_some() => {
                    named(
                        self,
                        label,
                        skip_trivia(text, s.pos as usize + b"break".len()) as u32,
                        parent,
                        out,
                    );
                }
                StmtKind::Continue(label) if label.is_some() => {
                    named(
                        self,
                        label,
                        skip_trivia(text, s.pos as usize + b"continue".len()) as u32,
                        parent,
                        out,
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
                // That of a type alias, if it is one.
                ScopeKind::TypeParams => bound
                    .alias_scope
                    .iter()
                    .position(|&a| a == scope)
                    .map_or(Flags::empty(), |a| hir.aliases[a].flags),
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
            .filter(|&s| hir.stmts[s].pos <= at && !matches!(bound.stmt_parent[s], Parent::None))
            .max_by_key(|&s| hir.stmts[s].pos);
        let member = (0..hir.members.len())
            .filter(|&m| {
                hir.members[m].pos <= at && matches!(bound.member_owner[m], MemberOwner::Class(_))
            })
            .max_by_key(|&m| hir.members[m].pos);
        match (stmt, member) {
            (stmt, Some(m)) if stmt.is_none_or(|s| hir.stmts[s].pos < hir.members[m].pos) => {
                hir.members[m].kind == MemberKind::Property
                    && hir.members[m].flags.contains(Flags::AMBIENT)
            }
            (Some(s), _) => {
                matches!(hir.stmts[s].kind, StmtKind::Var(decls) if decls.iter().next().is_some_and(|d| hir[d].flags.contains(Flags::AMBIENT)))
            }
            (None, _) => false,
        }
    }

    /// `NodeFlagsAmbient`, of the expression `e`.
    fn is_ambient_expr(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let scope_of = |kind: ScopeKind| {
            bound
                .scopes
                .iter()
                .position(|s| s.kind == kind)
                .map_or(ScopeId::NONE, |i| ScopeId(i as u32))
        };
        let (mut at, mut below) = (bound.expr_parent[e.idx()], e);
        // Out to what opens a scope, which tells the rest.
        let scope = loop {
            match at {
                Parent::None | Parent::File => return false,
                Parent::Expr(x) if x.is_none() => return false,
                Parent::Expr(x) => below = x,
                Parent::VarInit(d) if hir[d].flags.contains(Flags::AMBIENT) => return true,
                Parent::MemberInit(m) if hir[m].flags.contains(Flags::AMBIENT) => return true,
                Parent::MemberKey => {
                    if let Some(m) = hir
                        .members
                        .iter()
                        .position(|m| m.key == PropKey::Computed(below))
                    {
                        if hir.members[m].flags.contains(Flags::AMBIENT) {
                            return true;
                        }
                        match bound.member_owner[m] {
                            MemberOwner::Interface(i) => break scope_of(ScopeKind::Interface(i)),
                            MemberOwner::TypeLiteral(t) => break bound.type_scope[t.idx()],
                            _ => {}
                        }
                    }
                }
                Parent::FnBody(f) => break bound.fns[f.idx()].scope,
                Parent::ParamDefault(p) if bound.param_fn[p.idx()].is_some() => {
                    break bound.fns[bound.param_fn[p.idx()].idx()].scope;
                }
                Parent::ClassExtends(c) | Parent::Decorator(c, _) => {
                    break bound.class_scope[c.idx()];
                }
                Parent::EnumInit(m) => {
                    break scope_of(ScopeKind::Enum(bound.enum_member_owner[m.idx()]));
                }
                Parent::Module(m) => break scope_of(ScopeKind::Module(m)),
                _ => {}
            }
            at = self.outward_from_names(file, at, below);
        };
        self.in_class_and_ambient(file, scope).1
    }
}

// ───────────────────────────── the text ─────────────────────────────

/// `hasParseDiagnostics`. What the parser objected to and went on from is kept with what tsgo's binder and checker say of syntax.
/// They are told apart by the code: these are the ones only parser.go and scanner.go give, and 1003, 1005, 1453 and 2880, which are
/// only ever noted for what the parser objected to. Where type syntax was given up on it cannot be told.
/// The codes only decide for declaration files. Elsewhere `parse_for_sema` sets the flag by the origin of each error.
fn has_parse_diagnostics(hir: &hir::File) -> bool {
    hir.has_parse_diagnostics
        || hir.has_errors
        || hir.syntax_errors > 0
        || hir.kind == FileKind::Declaration && hir.early_errors.iter().any(|&(_, code)| {
            matches!(
                code,
                1002 | 1003 | 1005 | 1007 | 1010..=1012 | 1034 | 1068 | 1084 | 1109 | 1121 | 1124..=1132 | 1134 | 1135 | 1137..=1140
                    | 1144..=1146 | 1160 | 1161 | 1177..=1181 | 1185 | 1198 | 1199 | 1209 | 1260 | 1351..=1353 | 1357 | 1381 | 1382
                    | 1385..=1390 | 1434..=1443 | 1453 | 1472 | 1477 | 1478 | 1487..=1490 | 2754 | 2809 | 2819 | 2880 | 6188 | 6189
                    | 17002 | 17006..=17008 | 17014 | 17015 | 17021 | 18009 | 18026 | 18029 | 18030
            )
        })
}

/// Whether `word` is written at `at`, and ends there.
fn is_word_at(text: &[u8], at: usize, word: &[u8]) -> bool {
    text.get(at..).is_some_and(|rest| {
        rest.starts_with(word)
            && !rest.get(word.len()).is_some_and(|&b| {
                b.is_ascii_alphanumeric() || matches!(b, b'_' | b'$' | b'\\') || b >= 0x80
            })
    })
}

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

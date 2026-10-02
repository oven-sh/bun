//! Small things, each with a rule of its own: 2698, 2358 2359, 2491, 2414 2427 2431 2457, 2432, 1344.
//!
//! Follows `isValidSpreadType`, `checkInstanceOfExpression` with `resolveInstanceofExpression`, `checkForInStatement`,
//! `checkTypeNameIsReserved` and `checkEnumDeclaration` of TypeScript 7.0.2's checker.go, and `checkStrictModeLabeledStatement` of
//! its binder.go.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeKind, SymbolId};
use smallvec::SmallVec;

/// The expressions of `lists`, each of which is in the order of the file, all together in that order.
pub(super) fn in_file_order<const N: usize>(
    mut lists: [&[ExprId]; N],
) -> impl Iterator<Item = ExprId> + '_ {
    // Takes the first of a list off it. `u32::MAX`: there is none left.
    fn take_first(list: &mut &[ExprId]) -> u32 {
        match list.split_first() {
            Some((first, rest)) => {
                *list = rest;
                first.0
            }
            None => u32::MAX,
        }
    }
    let mut firsts = [u32::MAX; N];
    for (first, list) in firsts.iter_mut().zip(lists.iter_mut()) {
        *first = take_first(list);
    }
    std::iter::from_fn(move || {
        let mut least = 0;
        for i in 1..N {
            if firsts[i] < firsts[least] {
                least = i;
            }
        }
        let e = firsts[least];
        if e == u32::MAX {
            return None;
        }
        firsts[least] = take_first(&mut lists[least]);
        Some(ExprId(e))
    })
}

/// Whether `checkGrammarParameterList` objects to the parameters of `func`: 1014 1047 1048, 1015, 1016.
pub(super) fn has_parameter_list_error(hir: &hir::File, func: &Func) -> bool {
    let mut seen_optional = false;
    for (i, p) in func.params.iter().enumerate() {
        let param = &hir[p];
        if param.flags.contains(Flags::REST) {
            if i + 1 != func.params.len()
                || param.flags.contains(Flags::OPTIONAL)
                || param.default.is_some()
            {
                return true;
            }
        } else if param.flags.contains(Flags::OPTIONAL) {
            seen_optional = true;
            if param.default.is_some() && !param.flags.contains(Flags::REPARSED) {
                return true;
            }
        } else if seen_optional && param.default.is_none() {
            return true;
        }
    }
    false
}

impl Checker<'_> {
    /// `checkVarDeclaredNamesNotShadowed`: 2481, a `var` cannot get past a `let` or a `const` of the same name on its way up.
    fn check_vars_not_shadowed(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &(pat, written_in) in &bound.hoisted_vars {
            let PatKind::Ident(name) = hir[pat].kind else {
                continue;
            };
            let own = bound.pat_symbol[pat.idx()];
            let mut scope = written_in;
            while scope.is_some() && matches!(bound.scopes[scope.idx()].kind, ScopeKind::Block) {
                let found = bound
                    .lookup(bound.scopes[scope.idx()].locals, name)
                    .filter(|&s| bound.symbols[s.idx()].flags.intersects(SymFlags::VARIABLE));
                if let Some(found) = found {
                    let is_lexical = found != own
                        && bound.symbols[found.idx()].decls.iter().any(|&d| {
                            let Decl::Var(mut root) = d else { return false };
                            loop {
                                match bound.pat_parent[root.idx()] {
                                    PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => {
                                        root = outer
                                    }
                                    // What `catch` binds does not count.
                                    PatParent::Var(d) => {
                                        let stmt = bound.var_stmt[d.idx()];
                                        return hir[d].kind != VarKind::Var
                                            && stmt.is_some()
                                            && matches!(hir[stmt].kind, StmtKind::Var(_));
                                    }
                                    _ => return false,
                                }
                            }
                        });
                    if is_lexical {
                        out.push(Diagnostic {
                            start: hir[pat].pos,
                            code: 2481,
                        });
                    }
                    break;
                }
                scope = bound.scopes[scope.idx()].parent;
            }
        }
    }

    /// `checkGrammarNameInLetOrConstDeclarations`: 2480. What `checkContextualIdentifier` of binder.go says of what is declared
    /// by the name of `await` at the top of a module: 1262.
    fn check_names_that_are_keywords(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.kind == FileKind::Declaration {
            return;
        }
        let atoms = &self.files().atoms;
        let (r#let, r#await) = (atoms.lookup(b"let"), atoms.lookup(b"await"));
        if r#let.is_none() && r#await.is_none() {
            return;
        }
        let is_module = self.files().module(file).is_module();
        // Not in a function, a member of a class or a namespace.
        let is_at_the_top = |mut s: StmtId| loop {
            match bound.stmt_parent[s.idx()] {
                Parent::Stmt(outer) if outer.is_some() => s = outer,
                Parent::Case(c) => s = bound.case_stmt[c.idx()],
                Parent::File => return true,
                _ => return false,
            }
        };
        for symbol in &bound.symbols {
            if Some(symbol.name) != r#let && Some(symbol.name) != r#await {
                continue;
            }
            for &decl in &symbol.decls {
                let at_the_top_of_the_file = |start: u32| (start, true);
                let (start, at_the_top) = match decl {
                    Decl::Var(pat) => {
                        let mut root = pat;
                        let d = loop {
                            match bound.pat_parent[root.idx()] {
                                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => {
                                    root = outer
                                }
                                PatParent::Var(d) => break d,
                                _ => break VarDeclId::NONE,
                            }
                        };
                        if d.is_none() || hir[d].flags.contains(Flags::AMBIENT) {
                            continue;
                        }
                        if Some(symbol.name) == r#let {
                            if matches!(hir[d].kind, VarKind::Let | VarKind::Const) {
                                out.push(Diagnostic {
                                    start: hir[pat].pos,
                                    code: 2480,
                                });
                            }
                            continue;
                        }
                        let stmt = bound.var_stmt[d.idx()];
                        (hir[pat].pos, stmt.is_some() && is_at_the_top(stmt))
                    }
                    Decl::Fn(f)
                        if hir[f].kind == FnKind::Decl
                            && !hir[f].flags.contains(Flags::AMBIENT) =>
                    {
                        match bound.fns[f.idx()].owner {
                            FnOwner::Stmt(s) => (hir[f].name_pos, is_at_the_top(s)),
                            _ => continue,
                        }
                    }
                    Decl::Class(c) if !hir[c].flags.contains(Flags::AMBIENT) => {
                        match bound.class_owner[c.idx()] {
                            ClassOwner::Stmt(s) => (hir[c].name_pos, is_at_the_top(s)),
                            _ => continue,
                        }
                    }
                    Decl::ImportDefault(i) => at_the_top_of_the_file(hir[i].default_pos),
                    Decl::ImportNamespace(i) => at_the_top_of_the_file(hir[i].namespace_pos),
                    Decl::ImportSpec(s) => at_the_top_of_the_file(hir[s].pos),
                    Decl::ImportEquals(i) => at_the_top_of_the_file(hir[i].name_pos),
                    _ => continue,
                };
                if Some(symbol.name) == r#await && is_module && at_the_top {
                    out.push(Diagnostic { start, code: 1262 });
                }
            }
        }
    }

    pub(super) fn check_small_things(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        self.check_spreads(file, out);
        self.check_instanceof(file, out);
        self.check_reserved_type_names(file, out);
        self.check_enum_declarations(file, out);
        self.check_accessor_parameters(file, out);
        self.check_names_that_are_keywords(file, out);
        self.check_vars_not_shadowed(file, out);
        if self.p.files.options.strict_null_checks {
            self.check_known_truthy_tests(file, out);
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parses = !has_parse_diagnostics(hir);
        for s in 0..hir.stmts.len() {
            if matches!(bound.stmt_parent[s], Parent::None) {
                continue;
            }
            match hir.stmts[s].kind {
                // A declaration cannot be jumped to.
                StmtKind::Labeled { body, .. }
                    if matches!(
                        hir[body].kind,
                        StmtKind::Var(_)
                            | StmtKind::Fn(_)
                            | StmtKind::Class(_)
                            | StmtKind::Interface(_)
                            | StmtKind::TypeAlias(_)
                            | StmtKind::Enum(_)
                            | StmtKind::Module(_)
                            | StmtKind::Import(_)
                            | StmtKind::ImportEquals(_)
                            | StmtKind::ExportNamed(_)
                            | StmtKind::ExportStar { .. }
                            | StmtKind::ExportDefault(_)
                            | StmtKind::ExportAssign(_)
                            | StmtKind::ExportAsNamespace(_)
                    ) =>
                {
                    out.push(Diagnostic {
                        start: hir.stmts[s].pos,
                        code: 1344,
                    });
                }
                // `checkGrammarForDisallowedBlockScopedVariableStatement`. `checkVariableStatement` only calls it when
                // `checkGrammarModifiers` reported nothing: a modifier in such a place is 1184, unless the file has parse diagnostics.
                StmtKind::Var(decls)
                    if decls.iter().next().is_some_and(|d| {
                        hir[d].kind != VarKind::Var
                            && !(parses && hir[d].flags.intersects(Flags::EXPORT | Flags::AMBIENT))
                    }) =>
                {
                    let mut parent = bound.stmt_parent[s];
                    while let Parent::Stmt(p) = parent
                        && p.is_some()
                        && matches!(hir[p].kind, StmtKind::Labeled { .. })
                    {
                        parent = bound.stmt_parent[p.idx()];
                    }
                    let me = StmtId(s as u32);
                    if let Parent::Stmt(p) = parent
                        && p.is_some()
                        && match hir[p].kind {
                            StmtKind::If { .. }
                            | StmtKind::While { .. }
                            | StmtKind::DoWhile { .. } => true,
                            // Not what a loop starts with.
                            StmtKind::For { init, .. } => init != me,
                            StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => {
                                left != me
                            }
                            _ => false,
                        }
                    {
                        out.push(Diagnostic {
                            start: hir.stmts[s].pos,
                            code: 1156,
                        });
                        let keyword = match decls.iter().next().map(|d| hir[d].kind) {
                            Some(VarKind::Let) => "let",
                            Some(VarKind::Const) => "const",
                            Some(VarKind::Using) => "using",
                            _ => "await using",
                        };
                        let end = self.end_of_stmt(file, me);
                        self.explain_to(hir.stmts[s].pos, end, 1156, |_| vec![keyword.to_owned()]);
                    }
                }
                // `checkTypeAliasDeclaration`, `checkInterfaceDeclaration`: `containerAllowsBlockScopedVariable`. A matter of grammar.
                StmtKind::TypeAlias(_) | StmtKind::Interface(_) if parses => {
                    let mut parent = bound.stmt_parent[s];
                    while let Parent::Stmt(p) = parent
                        && p.is_some()
                        && matches!(hir[p].kind, StmtKind::Labeled { .. })
                    {
                        parent = bound.stmt_parent[p.idx()];
                    }
                    if let Parent::Stmt(p) = parent
                        && p.is_some()
                        && matches!(
                            hir[p].kind,
                            StmtKind::If { .. }
                                | StmtKind::While { .. }
                                | StmtKind::DoWhile { .. }
                                | StmtKind::For { .. }
                                | StmtKind::ForIn { .. }
                                | StmtKind::ForOf { .. }
                        )
                    {
                        let (start, keyword) = match hir.stmts[s].kind {
                            StmtKind::TypeAlias(a) => (hir[a].name_pos, "type"),
                            StmtKind::Interface(i) => (hir[i].name_pos, "interface"),
                            _ => continue,
                        };
                        out.push(Diagnostic { start, code: 1156 });
                        self.explain(start, 1156, |_| vec![keyword.to_owned()]);
                    }
                }
                StmtKind::ForOf { left, .. } if matches!(hir[left].kind, StmtKind::Var(_)) => {
                    self.check_loop_declaration(file, left, false, out);
                }
                // The keys of an object are strings: there is nothing to take apart.
                StmtKind::ForIn { left, .. } => match hir[left].kind {
                    StmtKind::Var(decls) => {
                        self.check_loop_declaration(file, left, true, out);
                        if let Some(d) = decls.iter().next()
                            && matches!(
                                hir[hir[d].pat].kind,
                                PatKind::Object(_) | PatKind::Array(_)
                            )
                        {
                            out.push(Diagnostic {
                                start: hir[hir[d].pat].pos,
                                code: 2491,
                            });
                            let end = self.end_of_pat(file, hir[d].pat);
                            self.explain_to(hir[hir[d].pat].pos, end, 2491, |_| vec![]);
                        }
                    }
                    StmtKind::Expr(x)
                        if matches!(hir[x].kind, ExprKind::Object(_) | ExprKind::Array(_)) =>
                    {
                        out.push(Diagnostic {
                            start: hir[x].pos,
                            code: 2491,
                        });
                        let end = self.end_inside_parentheses(file, x);
                        self.explain_to(hir[x].pos, end, 2491, |_| vec![]);
                    }
                    _ => {}
                },
                _ => {}
            }
        }
    }

    /// `checkGrammarForInOrForOfStatement`, of the variable a loop declares: 1091 1188, 1189 1190, 2404 2483.
    fn check_loop_declaration(
        &mut self,
        file: FileId,
        left: StmtId,
        is_for_in: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let StmtKind::Var(decls) = hir[left].kind else {
            return;
        };
        let mut all = decls.iter();
        let Some(first) = all.next() else { return };
        if let Some(second) = all.next() {
            out.push(Diagnostic {
                start: hir[hir[second].pat].pos,
                code: if is_for_in { 1091 } else { 1188 },
            });
        } else if hir[first].init.is_some() {
            let code = if is_for_in { 1189 } else { 1190 };
            out.push(Diagnostic {
                start: hir[hir[first].pat].pos,
                code,
            });
            let end = self.end_of_pat(file, hir[first].pat);
            self.explain_to(hir[hir[first].pat].pos, end, code, |_| vec![]);
        } else if hir[first].ty.is_some() {
            let code = if is_for_in { 2404 } else { 2483 };
            out.push(Diagnostic {
                start: hir[hir[first].pat].pos,
                code,
            });
            let end = self.end_of_pat(file, hir[first].pat);
            self.explain_to(hir[hir[first].pat].pos, end, code, |_| vec![]);
        }
    }

    /// `checkGrammarAccessor`, as far as parameters go: 1054 1049, 1053 1051 1052, 1095, 1094.
    fn check_accessor_parameters(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if has_parse_diagnostics(hir) {
            return;
        }
        for f in 0..hir.fns.len() {
            let func = &hir.fns[f];
            if !matches!(func.kind, FnKind::Getter | FnKind::Setter)
                || matches!(bound.fns[f].owner, FnOwner::None)
            {
                continue;
            }
            // `checkAccessorDeclaration`: it is only asked once `checkGrammarFunctionLikeDeclaration` has found nothing.
            if has_parameter_list_error(hir, func) {
                continue;
            }
            // Of a body that is missing or out of place something else is said, and nothing more: 1005, 1318, 1183.
            let is_in_type = matches!(bound.fns[f].owner, FnOwner::Member(m) if !matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)));
            let has_body =
                !matches!(func.body, FnBody::None) || func.flags.contains(Flags::BODY_DROPPED);
            let needs_none = func.flags.contains(Flags::ABSTRACT) || is_in_type;
            let is_body_wrong = if has_body {
                needs_none
            } else {
                !needs_none && !func.flags.contains(Flags::AMBIENT)
            };
            if is_body_wrong {
                continue;
            }
            let start = match bound.fns[f].owner {
                FnOwner::Member(m) => hir[m].pos,
                _ => func.name_pos,
            };
            let params: SmallVec<[ParamId; 4]> = func
                .params
                .iter()
                .filter(|&p| !matches!(hir[hir[p].pat].kind, PatKind::Ident(known::this)))
                .collect();
            let is_getter = func.kind == FnKind::Getter;
            // `doesAccessorHaveCorrectParameterCount`: `this` is a parameter like another when it is the only one.
            let has_only_this = !is_getter && params.is_empty() && func.this_ty(hir).is_some();
            let code = if !func.type_params.is_empty() {
                1094
            } else if params.len() != usize::from(!is_getter) && !has_only_this {
                if is_getter { 1054 } else { 1049 }
            } else if is_getter {
                continue;
            } else if func.ret.is_some() {
                1095
            } else if has_only_this {
                continue;
            } else if hir[params[0]].flags.contains(Flags::REST) {
                // At the dots, which come after what decorates the parameter.
                let before = hir
                    .text
                    .get(..hir[hir[params[0]].pat].pos as usize)
                    .unwrap_or_default()
                    .trim_ascii_end();
                let start = if before.ends_with(b"...") {
                    before.len() as u32 - 3
                } else {
                    hir[params[0]].pos
                };
                out.push(Diagnostic { start, code: 1053 });
                continue;
            } else if hir[params[0]].flags.contains(Flags::OPTIONAL) {
                // At the `?`, which comes after the name or the pattern.
                let (mut at, mut depth) = (hir[hir[params[0]].pat].pos as usize, 0u32);
                while let Some(&byte) = hir.text.get(at) {
                    match byte {
                        b'[' | b'{' => depth += 1,
                        b']' | b'}' => depth = depth.saturating_sub(1),
                        b'?' | b':' | b'=' | b',' | b')' if depth == 0 => break,
                        _ => {}
                    }
                    at += 1;
                }
                if hir.text.get(at) == Some(&b'?') {
                    out.push(Diagnostic {
                        start: at as u32,
                        code: 1051,
                    });
                }
                continue;
            } else if hir[params[0]].default.is_some() {
                1052
            } else {
                continue;
            };
            out.push(Diagnostic { start, code });
            let end = self.end_of_name_at(file, start);
            self.explain_to(start, end, code, |_| vec![]);
        }
    }

    /// `checkTestingKnownTruthyCallableOrAwaitableOrEnumMemberType`: 2774 2801 2845
    fn check_known_truthy_tests(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for s in 0..hir.stmts.len() {
            if let StmtKind::If { test, yes, .. } = hir.stmts[s].kind
                && !matches!(bound.stmt_parent[s], Parent::None)
            {
                self.check_known_truthy_types(file, test, test, Parent::Stmt(yes), out);
            }
        }
        let index = self.exprs_by_kind(file);
        for e in in_file_order([index.of(ExprTag::Cond), index.of(ExprTag::Binary)]) {
            let i = e.idx();
            if bound.is_unchecked(i) {
                continue;
            }
            match hir.exprs[i].kind {
                ExprKind::Cond { test, yes, .. } => {
                    self.check_known_truthy_types(file, test, test, Parent::Expr(yes), out)
                }
                ExprKind::Binary {
                    op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish),
                    left,
                    ..
                } => {
                    // Out of the chain it is part of.
                    let mut parent = bound.expr_parent[i];
                    while let Parent::Expr(p) = parent
                        && matches!(
                            hir[p].kind,
                            ExprKind::Binary {
                                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                                ..
                            }
                        )
                    {
                        parent = bound.expr_parent[p.idx()];
                    }
                    let body = match parent {
                        Parent::Stmt(s) if s.is_some() => match hir[s].kind {
                            StmtKind::If { yes, .. } => Some(Parent::Stmt(yes)),
                            _ => None,
                        },
                        _ => None,
                    };
                    if op == BinOp::And || body.is_some() {
                        self.check_known_truthy_types(
                            file,
                            left,
                            left,
                            body.unwrap_or(Parent::None),
                            out,
                        );
                    }
                }
                _ => {}
            }
        }
        out.sort_unstable_by_key(|d| (d.start, d.code));
        out.dedup_by_key(|d| (d.start, d.code));
    }

    /// `checkTestingKnownTruthyTypes`. `whole`: the condition that was first asked about, whose type is `condType`.
    fn check_known_truthy_types(
        &mut self,
        file: FileId,
        test: ExprId,
        whole: ExprId,
        body: Parent,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let mut test = test;
        self.check_known_truthy_type(file, test, whole, body, out);
        while let ExprKind::Binary {
            op: BinOp::Or | BinOp::Nullish,
            left,
            ..
        } = hir[test].kind
        {
            test = left;
            self.check_known_truthy_type(file, test, whole, body, out);
        }
    }

    /// `checkTestingKnownTruthyType`
    fn check_known_truthy_type(
        &mut self,
        file: FileId,
        test: ExprId,
        whole: ExprId,
        body: Parent,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_logical = |e: ExprId| {
            matches!(
                hir[e].kind,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    ..
                }
            )
        };
        let location = match hir[test].kind {
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                right,
                ..
            } => right,
            _ => test,
        };
        if is_logical(location) {
            return self.check_known_truthy_types(file, location, whole, body, out);
        }
        // Only a right operand is judged by its own type: anything else by that of the whole condition.
        let judged_by = if location == test { whole } else { location };
        let ty = self.type_of_expr(file, judged_by);
        if !self.is_known(ty) || self.is_uncertain(file, judged_by) {
            return;
        }
        let start = self.start_inside_parentheses(file, location);
        // A member of an enum is what it is.
        if let (TypeData::EnumLit { value, .. }, ExprKind::Dot { obj, .. }) =
            (self.data(ty), hir[location].kind)
            && self.is_resolved_to_an_enum(file, obj)
        {
            out.push(Diagnostic { start, code: 2845 });
            // `evaluator.IsTruthy`
            let is_truthy = match *value {
                EnumValue::String(text) => !self.files().atoms.bytes(text).is_empty(),
                EnumValue::Number(bits) => {
                    let number = f64::from_bits(bits);
                    number != 0.0 && !number.is_nan()
                }
            };
            let end = self.end_inside_parentheses(file, location);
            self.explain_to(start, end, 2845, |_| vec![is_truthy.to_string()]);
            return;
        }
        // `isPropertyExpressionCast`
        if matches!(hir[location].kind, ExprKind::Dot { obj, .. } if matches!(hir[obj].kind, ExprKind::As { .. } | ExprKind::AsConst(_)))
            || !self.can_be_truthy(ty)
        {
            return;
        }
        // `getAwaitedTypeOfPromise(t) != nil`
        let is_promise = self
            .thenable_value(ty)
            .and_then(|promised| self.awaited_or_none(promised))
            .is_some_and(|awaited| self.is_known(awaited));
        if self.signatures(ty, false).is_empty() && !is_promise {
            return;
        }
        let is_named = matches!(
            hir[location].kind,
            ExprKind::Ident(_) | ExprKind::Dot { .. }
        );
        if !is_named && !is_promise {
            return;
        }
        // An optional method or property that is narrowed here is tested for good reason.
        let is_used = is_named && {
            let mut used = false;
            // To the right of it in a chain of `&&`, which parentheses end.
            let mut chain = if is_parenthesized(self.hir(file), test) {
                Parent::None
            } else {
                bound.expr_parent[test.idx()]
            };
            while let Parent::Expr(p) = chain
                && let ExprKind::Binary {
                    op: BinOp::And,
                    right,
                    ..
                } = hir[p].kind
            {
                used |= self.is_mentioned_within(file, location, test, Parent::Expr(right), true);
                chain = if is_parenthesized(self.hir(file), p) {
                    Parent::None
                } else {
                    bound.expr_parent[p.idx()]
                };
            }
            used || !matches!(body, Parent::None)
                && self.is_mentioned_within(file, location, test, body, false)
        };
        if !is_used {
            let code = if is_promise { 2801 } else { 2774 };
            out.push(Diagnostic { start, code });
            let end = self.end_inside_parentheses(file, location);
            self.explain_to(start, end, code, |c| {
                if code != 2801 {
                    return vec![];
                }
                // `getTypeNameForErrorDisplay`: two types that read the same are both written with qualified names.
                vec![c.type_names_for_error_display(ty, ty).0]
            });
            // `errorAndMaybeSuggestAwait`
            if is_promise {
                self.relate(start, code, |_| {
                    vec![super::explain::Related {
                        at: Some((file, start, end)),
                        code: 2773,
                        args: Vec::new(),
                    }]
                });
            }
        }
    }

    /// `getResolvedSymbolOrNil(e).Flags&SymbolFlagsEnum`: whether the name `e`, or the name after the dot in it, was found to mean an
    /// enum. What is imported was found to mean the import.
    fn is_resolved_to_an_enum(&mut self, file: FileId, e: ExprId) -> bool {
        if is_parenthesized(self.hir(file), e) {
            return false;
        }
        match self.hir(file)[e].kind {
            ExprKind::Ident(name) => self
                .symbol_of_identifier(file, e, name)
                .is_some_and(|s| self.files().flags(s).intersects(SymFlags::ENUM)),
            ExprKind::Dot { obj, name, .. } => {
                let of = self.type_of_expr(file, obj);
                let of = self.apparent_type(of);
                self.prop_of(of, name).is_some_and(|(prop, _)| matches!(prop.source, PropSource::Symbol(s) if self.files().flags(s).intersects(SymFlags::ENUM)))
            }
            _ => false,
        }
    }

    /// `isSymbolUsedInConditionBody`, `isSymbolUsedInBinaryExpressionChain`: whether what `tested` names is named again inside
    /// `container`. `by_name_alone`: on whatever it may be.
    fn is_mentioned_within(
        &mut self,
        file: FileId,
        tested: ExprId,
        test: ExprId,
        container: Parent,
        by_name_alone: bool,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `IsIdentifier`: only those are looked at, and a private name is not one.
        if matches!(hir[tested].kind, ExprKind::Dot { name, .. } if self.files().atoms.bytes(name).first() == Some(&b'#'))
        {
            return false;
        }
        let same_variable = |a: ExprId, b: ExprId| matches!((hir[a].kind, hir[b].kind), (ExprKind::Ident(x), ExprKind::Ident(y)) if x == y && bound.expr_symbol[a.idx()] == bound.expr_symbol[b.idx()]);
        let index = self.exprs_by_kind(file);
        let of_its_kind = match hir[tested].kind {
            ExprKind::Ident(_) => index.of(ExprTag::Ident),
            ExprKind::Dot { .. } => index.of(ExprTag::Dot),
            _ => return false,
        };
        for &child in of_its_kind {
            let i = child.idx();
            let may_be_the_same = same_variable(tested, child)
                || matches!((hir[tested].kind, hir[child].kind), (ExprKind::Dot { name: x, .. }, ExprKind::Dot { name: y, .. }) if x == y);
            if child == tested || !may_be_the_same || bound.is_unchecked(i) {
                continue;
            }
            // `ForEachChild`: what is in `container` is gone through, not `container` itself, and there is nothing in a name.
            if container == Parent::Expr(child)
                && matches!(hir[child].kind, ExprKind::Ident(_))
                && !is_parenthesized(self.hir(file), child)
            {
                continue;
            }
            // `getSymbolAtLocation`: the name in `{ name }` is that of the property.
            if matches!(bound.expr_parent[i], Parent::Prop(p) if hir[p].kind == PropKind::Shorthand)
            {
                continue;
            }
            // Inside?
            let mut parent = Parent::Expr(child);
            let mut is_inside = false;
            for _ in 0..4096 {
                if parent == container {
                    is_inside = true;
                    break;
                }
                if matches!(parent, Parent::None)
                    || matches!(parent, Parent::Stmt(s) if s.is_none())
                {
                    break;
                }
                parent = match parent {
                    Parent::Expr(x) => bound.expr_parent[x.idx()],
                    other => self.outward(file, other),
                };
            }
            if !is_inside || !self.same_property(file, tested, child) {
                continue;
            }
            if by_name_alone || matches!(hir[test].kind, ExprKind::Ident(_)) {
                return true;
            }
            let (ExprKind::Dot { obj: mut a, .. }, ExprKind::Dot { obj: mut b, .. }) =
                (hir[tested].kind, hir[child].kind)
            else {
                // `IsBinaryExpression(testedNode.Parent)`: a name that is an operand of the test. In parentheses it is not one, and
                // nothing is like it.
                if is_parenthesized(self.hir(file), tested) {
                    continue;
                }
                return true;
            };
            // On the same thing, written the same way.
            while !is_parenthesized(self.hir(file), a) && !is_parenthesized(self.hir(file), b) {
                match (hir[a].kind, hir[b].kind) {
                    (ExprKind::Ident(_), ExprKind::Ident(_)) => {
                        if same_variable(a, b) {
                            return true;
                        }
                        break;
                    }
                    (ExprKind::This, ExprKind::This) => return true,
                    (
                        ExprKind::Dot {
                            obj: x, name: n, ..
                        },
                        ExprKind::Dot {
                            obj: y, name: m, ..
                        },
                    ) if n == m && self.same_property(file, a, b) => (a, b) = (x, y),
                    (ExprKind::Call(x), ExprKind::Call(y)) => {
                        (a, b) = (hir[x].callee, hir[y].callee)
                    }
                    _ => break,
                }
            }
        }
        false
    }

    /// `getSymbolAtLocation` of the name in `a.name`: what declares the property that is found. `None`: it cannot be told.
    fn property_found(&mut self, file: FileId, e: ExprId) -> Option<PropSource> {
        let ExprKind::Dot { obj, name, .. } = self.hir(file)[e].kind else {
            return None;
        };
        let ty = self.type_of_expr(file, obj);
        let ty = self.non_nullable(ty);
        let ty = self.apparent_type(ty);
        self.prop_of(ty, name).map(|(prop, _)| prop.source)
    }

    /// Whether `a.name` and `b.name` find one property. What cannot be told counts as one.
    fn same_property(&mut self, file: FileId, a: ExprId, b: ExprId) -> bool {
        match (self.property_found(file, a), self.property_found(file, b)) {
            (Some(x), Some(y)) => x == y,
            _ => true,
        }
    }

    /// `isValidSpreadType`
    pub(super) fn is_valid_spread_type(&mut self, ty: TypeId) -> bool {
        // `getBaseConstraintOrType`
        let ty = self.map_type(ty, |c, m| c.base_constraint_if_any(m, 0).unwrap_or(m));
        // `removeDefinitelyFalsyTypes`: what is sure to be falsy spreads nothing.
        let ty = self.remove_definitely_falsy(ty);
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().all(|&p| self.is_valid_spread_type(p))
            }
            // `TypeFlagsInstantiableNonPrimitive` has no `keyof T`.
            TypeData::Keyof(_) => false,
            _ => {
                self.is_any(ty)
                    || ty == TypeId::OBJECT
                    || self.is_object_type(ty)
                    || self.is_deferred(ty)
            }
        }
    }

    /// `getBaseConstraintOfType`. `None`: there is none, which is not `unknown`. What extends nothing may turn out to be an object,
    /// what extends `unknown` can be anything at all.
    fn base_constraint_if_any(&mut self, ty: TypeId, depth: u32) -> Option<TypeId> {
        match self.data(ty) {
            TypeData::TypeParam(..) => {
                // Round in circles.
                if depth > 16 {
                    return None;
                }
                let constraint = self.constraint_of_type_param(ty)?;
                self.base_constraint_if_any(constraint, depth + 1)
            }
            // `computeBaseConstraint`: of the members that have one.
            TypeData::Intersection(parts) => {
                let mut constraints = Vec::with_capacity(parts.len());
                for &part in parts.iter() {
                    constraints.extend(self.base_constraint_if_any(part, depth + 1));
                }
                if constraints.is_empty() {
                    None
                } else {
                    Some(self.intersection(&constraints))
                }
            }
            // All of them have to have one.
            TypeData::Union(parts) => {
                let mut constraints = Vec::with_capacity(parts.len());
                for &part in parts.iter() {
                    constraints.push(self.base_constraint_if_any(part, depth + 1)?);
                }
                Some(self.union(&constraints))
            }
            _ if self.is_deferred(ty) => {
                let constraint = self.base_constraint(ty);
                if constraint != TypeId::UNKNOWN {
                    return Some(constraint);
                }
                // Only of `T[K]` is it told apart whether there is none or it is `unknown`. `computeBaseConstraint`: both parts have
                // one, and the one has something under the other.
                let TypeData::IndexedAccess {
                    obj,
                    index,
                    undefined,
                } = *self.data(ty)
                else {
                    return None;
                };
                if depth > 16 {
                    return None;
                }
                let base_object = self.base_constraint_if_any(obj, depth + 1)?;
                let base_index = self.base_constraint_if_any(index, depth + 1)?;
                let access =
                    self.indexed_access_flagged(base_object, base_index, undefined, None)?;
                self.base_constraint_if_any(access, depth + 1)
            }
            _ => Some(ty),
        }
    }

    /// `checkObjectLiteral`, `createJsxAttributesTypeFromAttributesProperty`: 2698
    fn check_spreads(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for p in 0..hir.props.len() {
            let prop = &hir.props[p];
            if prop.kind != PropKind::Spread || prop.value.is_none() {
                continue;
            }
            let owner = bound.prop_owner[p];
            if owner.is_none()
                || bound.is_unchecked(owner.idx())
                || self.is_assignment_target(file, owner)
            {
                continue;
            }
            let ty = self.type_of_expr(file, prop.value);
            if !self.is_known(ty) || self.is_uncertain(file, prop.value) {
                continue;
            }
            let ty = self.reduced(ty);
            if self.is_valid_spread_type(ty) {
                continue;
            }
            // In JSX it is what is spread that is pointed at, in an object literal the dots.
            let start = if matches!(hir[owner].kind, ExprKind::Jsx(_)) {
                self.error_start_of(file, prop.value)
            } else {
                let value = self.start_of(file, prop.value);
                let before = hir
                    .text
                    .get(..value as usize)
                    .unwrap_or_default()
                    .trim_ascii_end();
                if before.ends_with(b"...") {
                    before.len() as u32 - 3
                } else {
                    value.saturating_sub(3)
                }
            };
            out.push(Diagnostic { start, code: 2698 });
            let end = if matches!(hir[owner].kind, ExprKind::Jsx(_)) {
                self.error_end_of(file, prop.value)
            } else {
                self.end_of_expr(file, prop.value)
            };
            self.explain_to(start, end, 2698, |_| vec![]);
        }
    }

    /// `allTypesAssignableToKind(ty, TypeFlagsPrimitive)`
    fn is_all_assignable_to_primitives(&mut self, ty: TypeId) -> bool {
        const KINDS: [TypeId; 8] = [
            TypeId::NUMBER,
            TypeId::BIGINT,
            TypeId::STRING,
            TypeId::BOOLEAN,
            TypeId::VOID,
            TypeId::NULL,
            TypeId::UNDEFINED,
            TypeId::SYMBOL,
        ];
        match self.data(ty) {
            TypeData::Union(parts) => parts
                .iter()
                .all(|&p| self.is_all_assignable_to_primitives(p)),
            _ => self.is_primitive(ty) || KINDS.iter().any(|&kind| self.is_assignable(ty, kind)),
        }
    }

    /// `checkInstanceOfExpression`, `resolveInstanceofExpression`: 2358 2359
    fn check_instanceof(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let index = self.exprs_by_kind(file);
        for &e in index.of(ExprTag::Binary) {
            let ExprKind::Binary {
                op: BinOp::Instanceof,
                left,
                right,
            } = hir[e].kind
            else {
                continue;
            };
            if bound.is_unchecked(e.idx()) {
                continue;
            }
            let (l, r) = (
                self.type_of_expr(file, left),
                self.type_of_expr(file, right),
            );
            if self.is_known(l)
                && !self.is_any(l)
                && !self.is_uncertain(file, left)
                && self.is_all_assignable_to_primitives(l)
            {
                let start = self.error_start_of(file, left);
                out.push(Diagnostic { start, code: 2358 });
                let end = self.error_end_of(file, left);
                self.explain_to(start, end, 2358, |_| vec![]);
            }
            if !self.is_known(r)
                || self.is_any(r)
                || self.is_uncertain(file, right)
                || self.symbol_has_instance_method_of_object_type(r).is_some()
            {
                continue;
            }
            let function = self.global_ref(known::Function, &[]);
            if self.signatures(r, false).is_empty()
                && self.signatures(r, true).is_empty()
                && !self.is_subtype(r, function)
            {
                let start = self.error_start_of(file, right);
                out.push(Diagnostic { start, code: 2359 });
                let end = self.error_end_of(file, right);
                self.explain_to(start, end, 2359, |_| vec![]);
            }
        }
    }

    /// `checkTypeNameIsReserved`
    fn check_reserved_type_names(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let is_reserved = |c: &Self, name: Atom| {
            name.is_some()
                && matches!(
                    c.files().atoms.bytes(name),
                    b"any"
                        | b"unknown"
                        | b"never"
                        | b"number"
                        | b"bigint"
                        | b"boolean"
                        | b"string"
                        | b"symbol"
                        | b"void"
                        | b"object"
                        | b"undefined"
                )
        };
        out.extend(
            hir.classes
                .iter()
                .filter(|c| is_reserved(self, c.name))
                .map(|c| Diagnostic {
                    start: c.name_pos,
                    code: 2414,
                }),
        );
        out.extend(
            hir.interfaces
                .iter()
                .filter(|i| is_reserved(self, i.name))
                .map(|i| Diagnostic {
                    start: i.name_pos,
                    code: 2427,
                }),
        );
        out.extend(
            hir.enums
                .iter()
                .filter(|e| is_reserved(self, e.name))
                .map(|e| Diagnostic {
                    start: e.name_pos,
                    code: 2431,
                }),
        );
        out.extend(
            hir.aliases
                .iter()
                .filter(|a| is_reserved(self, a.name))
                .map(|a| Diagnostic {
                    start: a.name_pos,
                    code: 2457,
                }),
        );
    }

    /// `checkEnumDeclaration`, as far as several declarations of one enum go.
    fn check_enum_declarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        // Only what an enum of this file starts with is objected to.
        if self.hir(file).enums.is_empty() {
            return;
        }
        let bound = self.bound(file);
        for i in 0..bound.symbols.len() {
            let symbol = &bound.symbols[i];
            if !symbol.flags.intersects(SymFlags::ENUM)
                || symbol.decls.len() < 2 && !symbol.flags.contains(SymFlags::MERGED)
            {
                continue;
            }
            let sym = self.files().sym(file, SymbolId(i as u32));
            if sym.file == file && sym.id.idx() != i {
                continue;
            }
            let enums: Vec<(FileId, EnumId)> = self
                .files()
                .decls(sym)
                .into_iter()
                .filter_map(|(f, d)| match d {
                    Decl::Enum(e) => Some((f, e)),
                    _ => None,
                })
                .collect();
            let mut seen_without_initializer = false;
            for &(f, e) in &enums {
                let decl = &self.hir(f)[e];
                let Some(member) = decl.members.iter().next() else {
                    continue;
                };
                let member = &self.hir(f)[member];
                if member.init.is_none() {
                    if seen_without_initializer && f == file {
                        out.push(Diagnostic {
                            start: member.pos,
                            code: 2432,
                        });
                        let end = self.end_of_name_at(file, member.pos);
                        self.explain_to(member.pos, end, 2432, |_| vec![]);
                    }
                    seen_without_initializer = true;
                }
            }
        }
    }
}

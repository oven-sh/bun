//! Compares two HIRs of one text node by node, from the root: every field of every node that can be
//! reached, and every side list. Ids are not compared, because the two parsers number their nodes
//! in different orders and one of them leaves nodes behind that nothing refers to.

use bun_sema::hir::*;
use std::fmt::Debug;

pub(crate) struct Comparison<'a, A: Storage, B: Storage> {
    a: &'a FileIn<A>,
    b: &'a FileIn<B>,
    /// Where the walk is: what the node is to its parent, and its position.
    path: Vec<(&'static str, u32)>,
    pub(crate) difference: Option<String>,
    /// For each node of `b`, whether the walk has reached it.
    seen: Seen,
    /// The expression of `b` that corresponds to each expression of `a`.
    exprs: Vec<u32>,
    stmts: Vec<u32>,
    params: Vec<u32>,
    members: Vec<u32>,
    classes: Vec<u32>,
    fns: Vec<u32>,
}

macro_rules! seen {
    ($($field:ident,)*) => {
        #[derive(Default)]
        struct Seen { $($field: Vec<bool>,)* }
        impl Seen {
            fn new<S: Storage>(file: &FileIn<S>) -> Seen {
                Seen { $($field: vec![false; file.$field.len()],)* }
            }
            /// The first list with a node that was not reached, and the index of that node.
            fn unreached(&self) -> Option<(&'static str, usize)> {
                $(if let Some(index) = self.$field.iter().position(|seen| !seen) {
                    return Some((stringify!($field), index));
                })*
                None
            }
        }
    };
}

seen! {
    exprs, stmts, types, pats, pat_props, pat_elems, fns, params, type_params, classes, interfaces,
    aliases, enums, enum_members, modules, members, props, var_decls, calls, cases, jsx, imports,
    import_specs, import_equals, exports, export_specs, tuple_elems, mapped, modifiers, names,
}

macro_rules! same {
    ($self:ident, $x:ident, $y:ident, $($field:ident),*) => {
        $(if $x.$field != $y.$field {
            $self.differ(stringify!($field), &$x.$field, &$y.$field);
        })*
    };
}

impl<'a, A: Storage, B: Storage> Comparison<'a, A, B> {
    pub(crate) fn new(a: &'a FileIn<A>, b: &'a FileIn<B>) -> Self {
        Comparison {
            a,
            b,
            path: Vec::new(),
            difference: None,
            seen: Seen::new(b),
            exprs: vec![u32::MAX; a.exprs.len()],
            stmts: vec![u32::MAX; a.stmts.len()],
            params: vec![u32::MAX; a.params.len()],
            members: vec![u32::MAX; a.members.len()],
            classes: vec![u32::MAX; a.classes.len()],
            fns: vec![u32::MAX; a.fns.len()],
        }
    }

    fn differ(&mut self, what: &str, a: &dyn Debug, b: &dyn Debug) {
        if self.difference.is_some() {
            return;
        }
        let path: Vec<String> = (self.path.iter())
            .map(|(name, pos)| format!("{name}@{pos}"))
            .collect();
        self.difference = Some(format!(
            "{} .{what}: reference {a:?}, direct {b:?}",
            path.join(" > ")
        ));
    }

    fn is_done(&self) -> bool {
        self.difference.is_some()
    }

    /// Whether both ids are present. Reports a difference if only one is.
    fn both(&mut self, what: &'static str, a: u32, b: u32) -> bool {
        if (a == u32::MAX) != (b == u32::MAX) {
            self.differ(what, &(a != u32::MAX), &(b != u32::MAX));
        }
        a != u32::MAX && b != u32::MAX && !self.is_done()
    }

    pub(crate) fn run(&mut self) {
        let (a, b) = (self.a, self.b);
        same!(
            self, a, b, kind, is_js, check_directive, has_module_syntax, has_errors,
            ran_out_of_stack, has_parse_diagnostics, syntax_errors, source_len, jsx_pragmas
        );
        if a.diagnostics[..] != b.diagnostics[..] {
            self.differ("diagnostics", &&a.diagnostics[..], &&b.diagnostics[..]);
        }
        if a.references[..] != b.references[..] {
            self.differ("references", &&a.references[..], &&b.references[..]);
        }
        if a.comment_directives[..] != b.comment_directives[..] {
            let (x, y) = (&a.comment_directives[..], &b.comment_directives[..]);
            self.differ("comment_directives", &x, &y);
        }
        if a.with_bodies[..] != b.with_bodies[..] {
            self.differ("with_bodies", &&a.with_bodies[..], &&b.with_bodies[..]);
        }
        self.stmt_list("body", a.body, b.body);
        if self.is_done() {
            return;
        }
        // The lists that are in the order of the source, or in that of the ids.
        let uses = |list: &[SpecifierUse]| {
            let mut uses: Vec<_> = list
                .iter()
                .map(|it| (it.pos, it.spec, it.kind as u8, it.mode))
                .collect();
            uses.sort_by_key(|it| it.0);
            uses
        };
        let (x, y) = (uses(&a.specifier_uses), uses(&b.specifier_uses));
        if x != y {
            self.differ("specifier_uses", &x, &y);
        }
        let owner_a = |this: &Self, owner: DecoratorOwner| match owner {
            DecoratorOwner::Class(c) => (0, this.classes[c.idx()]),
            DecoratorOwner::Member(m) => (1, this.members[m.idx()]),
            DecoratorOwner::Param(p) => (2, this.params[p.idx()]),
        };
        let owner_b = |owner: DecoratorOwner| match owner {
            DecoratorOwner::Class(c) => (0, c.0),
            DecoratorOwner::Member(m) => (1, m.0),
            DecoratorOwner::Param(p) => (2, p.0),
        };
        let x: Vec<_> = (a.decorators.iter())
            .map(|&(owner, e)| (owner_a(self, owner), self.exprs[e.idx()]))
            .collect();
        let y: Vec<_> = (b.decorators.iter())
            .map(|&(owner, e)| (owner_b(owner), e.0))
            .collect();
        if x != y {
            self.differ("decorators", &x, &y);
        }
        let mut x: Vec<u32> = a.keyword_identifier_positions.to_vec();
        let mut y: Vec<u32> = b.keyword_identifier_positions.to_vec();
        x.sort_unstable();
        x.dedup();
        y.sort_unstable();
        y.dedup();
        if x != y {
            self.differ("keyword_identifier_positions", &x, &y);
        }
        let x: Vec<_> = (a.import_attributes.iter())
            .map(|&(pos, e)| (pos, self.exprs[e.idx()]))
            .collect();
        let y: Vec<_> = b.import_attributes.iter().map(|&(pos, e)| (pos, e.0)).collect();
        if x != y {
            self.differ("import_attributes", &x, &y);
        }
        let x: Vec<_> = (a.deferred_import_calls.iter())
            .map(|&(e, pos)| (self.exprs[e.idx()], pos))
            .collect();
        let y: Vec<_> = (b.deferred_import_calls.iter())
            .map(|&(e, pos)| (e.0, pos))
            .collect();
        if x != y {
            self.differ("deferred_import_calls", &x, &y);
        }
        // The direct parser leaves nothing behind.
        if !self.is_done()
            && let Some((list, index)) = self.seen.unreached()
        {
            self.differ("unreached node of the direct parser", &list, &index);
        }
        for (name, is_sorted) in [
            ("parens", b.parens.is_sorted_by_key(|it| it.0.0)),
            ("non_null_ends", b.non_null_ends.is_sorted_by_key(|it| it.0.0)),
            ("jsx_expressions", b.jsx_expressions.is_sorted_by_key(|it| it.0.0)),
            ("body_starts", b.body_starts.is_sorted_by_key(|it| it.0.0)),
            ("modifiers_of_props", b.modifiers_of_props.is_sorted_by_key(|it| it.0.0)),
        ] {
            if !is_sorted {
                self.differ("order", &name, &"not sorted");
            }
        }
    }

    // ───────────────────────────── lists ─────────────────────────────

    fn lens(&mut self, what: &'static str, a: usize, b: usize) -> bool {
        if a != b {
            self.differ(what, &format!("{a} items"), &format!("{b} items"));
        }
        a == b && !self.is_done()
    }

    fn stmt_list(&mut self, what: &'static str, a: IdList<StmtId>, b: IdList<StmtId>) {
        if self.lens(what, a.len(), b.len()) {
            for i in 0..a.len() {
                self.stmt(what, self.a.id_at(a, i), self.b.id_at(b, i));
            }
        }
    }

    fn expr_list(&mut self, what: &'static str, a: IdList<ExprId>, b: IdList<ExprId>) {
        if self.lens(what, a.len(), b.len()) {
            for i in 0..a.len() {
                self.expr(what, self.a.id_at(a, i), self.b.id_at(b, i));
            }
        }
    }

    fn type_list(&mut self, what: &'static str, a: IdList<TypeNodeId>, b: IdList<TypeNodeId>) {
        if self.lens(what, a.len(), b.len()) {
            for i in 0..a.len() {
                self.ty(what, self.a.id_at(a, i), self.b.id_at(b, i));
            }
        }
    }

    fn atom_list(
        &mut self,
        what: &'static str,
        a: IdList<bun_sema::atom::Atom>,
        b: IdList<bun_sema::atom::Atom>,
    ) {
        let x: Vec<_> = self.a.ids(a).collect();
        let y: Vec<_> = self.b.ids(b).collect();
        if x != y {
            self.differ(what, &x, &y);
        }
    }

    fn names(&mut self, what: &'static str, a: Span<NameId>, b: Span<NameId>) {
        let of = |names: &[Name]| -> Vec<_> {
            names
                .iter()
                .map(|it| (it.text, it.pos(), it.is_qualified()))
                .collect()
        };
        let (x, y) = (of(&self.a.names[a.range()]), of(&self.b.names[b.range()]));
        if x != y {
            self.differ(what, &x, &y);
        }
        for i in b.range() {
            self.seen.names[i] = true;
        }
    }

    fn modifiers(&mut self, a: Span<ModifierId>, b: Span<ModifierId>) {
        if !self.lens("modifiers", a.len(), b.len()) {
            return;
        }
        for i in 0..a.len() {
            let (x, y) = (self.a[a.at(i)], self.b[b.at(i)]);
            self.seen.modifiers[b.at(i).idx()] = true;
            same!(self, x, y, pos);
            match (x.kind, y.kind) {
                (ModifierKind::Decorator(x), ModifierKind::Decorator(y)) => {
                    self.expr("decorator", x, y);
                }
                (x, y) if x != y => self.differ("modifier", &x, &y),
                _ => {}
            }
        }
    }

    // ───────────────────────────── statements ─────────────────────────────

    fn stmt(&mut self, what: &'static str, a: StmtId, b: StmtId) {
        if !self.both(what, a.0, b.0) {
            return;
        }
        let (x, y) = (self.a[a], self.b[b]);
        self.path.push((what, x.start));
        self.stmts[a.idx()] = b.0;
        self.seen.stmts[b.idx()] = true;
        same!(self, x, y, start, loc);
        self.modifiers(x.modifiers, y.modifiers);
        self.stmt_kind(x.kind, y.kind, a, b);
        self.path.pop();
    }

    fn stmt_kind(&mut self, x: StmtKind, y: StmtKind, a: StmtId, b: StmtId) {
        use StmtKind::*;
        match (x, y) {
            (Empty, Empty) | (Debugger, Debugger) => {}
            (Expr(x), Expr(y))
            | (Return(x), Return(y))
            | (Throw(x), Throw(y))
            | (ExportDefault(x), ExportDefault(y))
            | (ExportAssign(x), ExportAssign(y)) => self.expr("expression", x, y),
            (Var(x), Var(y)) => {
                if self.lens("declarations", x.len(), y.len()) {
                    for i in 0..x.len() {
                        self.var_decl(x.at(i), y.at(i));
                    }
                }
            }
            (Fn(x), Fn(y)) => self.func("function", x, y),
            (Class(x), Class(y)) => self.class(x, y),
            (Interface(x), Interface(y)) => {
                let (i, j) = (self.a[x], self.b[y]);
                self.seen.interfaces[y.idx()] = true;
                same!(self, i, j, name, name_pos, flags);
                self.back_reference(i.stmt, a, j.stmt, b);
                self.type_params(i.type_params, j.type_params);
                self.type_list("extends", i.extends, j.extends);
                self.type_list("other_heritage", i.other_heritage, j.other_heritage);
                self.member_span(i.members, j.members);
            }
            (TypeAlias(x), TypeAlias(y)) => {
                let (i, j) = (self.a[x], self.b[y]);
                self.seen.aliases[y.idx()] = true;
                same!(self, i, j, name, name_pos, flags);
                self.back_reference(i.stmt, a, j.stmt, b);
                self.type_params(i.type_params, j.type_params);
                self.ty("type", i.ty, j.ty);
            }
            (Enum(x), Enum(y)) => {
                let (i, j) = (self.a[x], self.b[y]);
                self.seen.enums[y.idx()] = true;
                same!(self, i, j, name, name_pos, flags);
                self.back_reference(i.stmt, a, j.stmt, b);
                if self.lens("members", i.members.len(), j.members.len()) {
                    for n in 0..i.members.len() {
                        let (m, k) = (self.a[i.members.at(n)], self.b[j.members.at(n)]);
                        self.seen.enum_members[j.members.at(n).idx()] = true;
                        self.path.push(("enum member", m.pos));
                        same!(self, m, k, name, name_kind, pos, loc);
                        self.expr("computed_name", m.computed_name, k.computed_name);
                        self.expr("init", m.init, k.init);
                        self.path.pop();
                    }
                }
            }
            (Module(x), Module(y)) => {
                let (i, j) = (self.a[x], self.b[y]);
                self.seen.modules[y.idx()] = true;
                same!(self, i, j, name, name_pos, flags, has_body, specifies_module);
                self.back_reference(i.stmt, a, j.stmt, b);
                self.stmt_list("body", i.body, j.body);
            }
            (
                If { test, yes, no },
                If {
                    test: test2,
                    yes: yes2,
                    no: no2,
                },
            ) => {
                self.expr("test", test, test2);
                self.stmt("then", yes, yes2);
                self.stmt("else", no, no2);
            }
            (
                For {
                    init,
                    test,
                    update,
                    body,
                },
                For {
                    init: init2,
                    test: test2,
                    update: update2,
                    body: body2,
                },
            ) => {
                self.stmt("init", init, init2);
                self.expr("test", test, test2);
                self.expr("update", update, update2);
                self.stmt("body", body, body2);
            }
            (
                ForIn { left, expr, body },
                ForIn {
                    left: left2,
                    expr: expr2,
                    body: body2,
                },
            ) => {
                self.stmt("left", left, left2);
                self.expr("expr", expr, expr2);
                self.stmt("body", body, body2);
            }
            (
                ForOf {
                    left,
                    expr,
                    body,
                    is_await,
                },
                ForOf {
                    left: left2,
                    expr: expr2,
                    body: body2,
                    is_await: is_await2,
                },
            ) => {
                if is_await != is_await2 {
                    self.differ("is_await", &is_await, &is_await2);
                }
                self.stmt("left", left, left2);
                self.expr("expr", expr, expr2);
                self.stmt("body", body, body2);
            }
            (
                While { test, body },
                While {
                    test: test2,
                    body: body2,
                },
            )
            | (
                DoWhile { test, body },
                DoWhile {
                    test: test2,
                    body: body2,
                },
            ) => {
                self.expr("test", test, test2);
                self.stmt("body", body, body2);
            }
            (Block(x), Block(y)) => self.stmt_list("statement", x, y),
            (
                Switch { expr, cases },
                Switch {
                    expr: expr2,
                    cases: cases2,
                },
            ) => {
                self.expr("expr", expr, expr2);
                if self.lens("cases", cases.len(), cases2.len()) {
                    for n in 0..cases.len() {
                        let (c, d) = (self.a[cases.at(n)], self.b[cases2.at(n)]);
                        self.seen.cases[cases2.at(n).idx()] = true;
                        self.path.push(("case", c.pos));
                        same!(self, c, d, pos, end);
                        self.expr("test", c.test, d.test);
                        self.stmt_list("statement", c.body, d.body);
                        self.path.pop();
                    }
                }
            }
            (
                Try {
                    block,
                    param,
                    handler,
                    finalizer,
                },
                Try {
                    block: block2,
                    param: param2,
                    handler: handler2,
                    finalizer: finalizer2,
                },
            ) => {
                self.stmt("block", block, block2);
                if self.both("catch parameter", param.0, param2.0) {
                    self.var_decl(param, param2);
                }
                self.stmt("handler", handler, handler2);
                self.stmt("finalizer", finalizer, finalizer2);
            }
            (Break(x), Break(y)) | (Continue(x), Continue(y)) | (ExportAsNamespace(x), ExportAsNamespace(y)) => {
                if x != y {
                    self.differ("name", &x, &y);
                }
            }
            (
                Labeled { label, body },
                Labeled {
                    label: label2,
                    body: body2,
                },
            ) => {
                if label != label2 {
                    self.differ("label", &label, &label2);
                }
                self.stmt("body", body, body2);
            }
            (Import(x), Import(y)) => {
                let (i, j) = (self.a[x], self.b[y]);
                self.seen.imports[y.idx()] = true;
                same!(
                    self, i, j, spec, default, default_pos, namespace, namespace_pos, clause_start,
                    clause_end, namespace_start, has_named_imports, type_only, is_deferred, mode
                );
                self.back_reference(i.stmt, a, j.stmt, b);
                if self.lens("named", i.named.len(), j.named.len()) {
                    for n in 0..i.named.len() {
                        let (s, t) = (self.a[i.named.at(n)], self.b[j.named.at(n)]);
                        self.seen.import_specs[j.named.at(n).idx()] = true;
                        self.path.push(("import specifier", s.start));
                        same!(self, s, t, start, imported, local, pos, type_only, imported_pos, end);
                        if (s.import == x) != (t.import == y) {
                            self.differ("import", &s.import, &t.import);
                        }
                        self.path.pop();
                    }
                }
            }
            (ImportEquals(x), ImportEquals(y)) => {
                let (i, j) = (self.a[x], self.b[y]);
                self.seen.import_equals[y.idx()] = true;
                same!(self, i, j, name, name_pos, flags);
                self.back_reference(i.stmt, a, j.stmt, b);
                self.expr("expression", i.expression, j.expression);
                match (i.target, j.target) {
                    (ImportEqualsTarget::Require(x), ImportEqualsTarget::Require(y)) if x == y => {}
                    (ImportEqualsTarget::Entity(x), ImportEqualsTarget::Entity(y)) => {
                        self.names("target", x, y);
                    }
                    (x, y) => self.differ("target", &x, &y),
                }
            }
            (ExportNamed(x), ExportNamed(y)) => {
                let (i, j) = (self.a[x], self.b[y]);
                self.seen.exports[y.idx()] = true;
                same!(self, i, j, spec, has_module_specifier, type_only, mode);
                self.back_reference(i.stmt, a, j.stmt, b);
                if self.lens("items", i.items.len(), j.items.len()) {
                    for n in 0..i.items.len() {
                        let (s, t) = (self.a[i.items.at(n)], self.b[j.items.at(n)]);
                        self.seen.export_specs[j.items.at(n).idx()] = true;
                        self.path.push(("export specifier", s.start));
                        same!(self, s, t, start, local, exported, pos, type_only, local_pos, end);
                        if (s.export == x) != (t.export == y) {
                            self.differ("export", &s.export, &t.export);
                        }
                        self.path.pop();
                    }
                }
            }
            (x @ ExportStar { .. }, y @ ExportStar { .. }) => {
                let (x, y) = (format!("{x:?}"), format!("{y:?}"));
                if x != y {
                    self.differ("export star", &x, &y);
                }
            }
            (x, y) => self.differ("kind", &x, &y),
        }
    }

    fn back_reference(&mut self, x: StmtId, a: StmtId, y: StmtId, b: StmtId) {
        if x != a || y != b {
            self.differ("stmt", &(x, a), &(y, b));
        }
    }

    fn var_decl(&mut self, a: VarDeclId, b: VarDeclId) {
        let (x, y) = (self.a[a], self.b[b]);
        self.seen.var_decls[b.idx()] = true;
        self.path.push(("declaration", x.loc.pos));
        same!(self, x, y, kind, flags, loc);
        self.pat("name", x.pat, y.pat);
        self.ty("type", x.ty, y.ty);
        self.expr("init", x.init, y.init);
        self.path.pop();
    }

    // ───────────────────────────── patterns ─────────────────────────────

    fn pat(&mut self, what: &'static str, a: PatId, b: PatId) {
        if !self.both(what, a.0, b.0) {
            return;
        }
        let (x, y) = (self.a[a], self.b[b]);
        self.seen.pats[b.idx()] = true;
        self.path.push((what, x.pos));
        same!(self, x, y, pos, end);
        match (x.kind, y.kind) {
            (PatKind::Missing, PatKind::Missing) => {}
            (PatKind::Ident(x), PatKind::Ident(y)) if x == y => {}
            (PatKind::Object(x), PatKind::Object(y)) => {
                if self.lens("properties", x.len(), y.len()) {
                    for n in 0..x.len() {
                        let (p, q) = (self.a[x.at(n)], self.b[y.at(n)]);
                        self.seen.pat_props[y.at(n).idx()] = true;
                        self.path.push(("property", p.pos));
                        same!(self, p, q, name_kind, is_rest, pos, key_pos, end);
                        self.key(p.key, q.key);
                        self.pat("value", p.value, q.value);
                        self.expr("default", p.default, q.default);
                        self.path.pop();
                    }
                }
            }
            (PatKind::Array(x), PatKind::Array(y)) => {
                if self.lens("elements", x.len(), y.len()) {
                    for n in 0..x.len() {
                        let (p, q) = (self.a[x.at(n)], self.b[y.at(n)]);
                        self.seen.pat_elems[y.at(n).idx()] = true;
                        self.path.push(("element", p.start));
                        same!(self, p, q, is_rest, start, end);
                        self.pat("pattern", p.pat, q.pat);
                        self.expr("default", p.default, q.default);
                        self.path.pop();
                    }
                }
            }
            (x, y) => self.differ("kind", &x, &y),
        }
        self.path.pop();
    }

    fn key(&mut self, x: PropKey, y: PropKey) {
        match (x, y) {
            (PropKey::Computed(x), PropKey::Computed(y)) => self.expr("key", x, y),
            (x, y) if x != y => self.differ("key", &x, &y),
            _ => {}
        }
    }

    // ───────────────────────────── functions and classes ─────────────────────────────

    fn type_params(&mut self, a: Span<TypeParamId>, b: Span<TypeParamId>) {
        if self.lens("type parameters", a.len(), b.len()) {
            for n in 0..a.len() {
                self.type_param(a.at(n), b.at(n));
            }
        }
    }

    fn type_param(&mut self, a: TypeParamId, b: TypeParamId) {
        let (x, y) = (self.a[a], self.b[b]);
        self.seen.type_params[b.idx()] = true;
        self.path.push(("type parameter", x.pos));
        same!(self, x, y, name, pos, start, end, flags);
        self.modifiers(x.modifiers, y.modifiers);
        self.ty("constraint", x.constraint, y.constraint);
        self.ty("default", x.default, y.default);
        self.path.pop();
    }

    fn param(&mut self, what: &'static str, a: ParamId, b: ParamId) {
        if !self.both(what, a.0, b.0) {
            return;
        }
        let (x, y) = (self.a[a], self.b[b]);
        self.params[a.idx()] = b.0;
        self.seen.params[b.idx()] = true;
        self.path.push((what, x.pos));
        same!(self, x, y, flags, pos, loc);
        self.modifiers(self.a.param_modifiers(a), self.b.param_modifiers(b));
        self.pat("name", x.pat, y.pat);
        self.ty("type", x.ty, y.ty);
        self.expr("default", x.default, y.default);
        self.path.pop();
    }

    fn func(&mut self, what: &'static str, a: FnId, b: FnId) {
        if !self.both(what, a.0, b.0) {
            return;
        }
        let (x, y) = (self.a[a], self.b[b]);
        self.fns[a.idx()] = b.0;
        self.seen.fns[b.idx()] = true;
        self.path.push((what, x.start));
        same!(self, x, y, kind, flags, name, name_pos, anchor, start);
        self.type_params(x.type_params, y.type_params);
        self.param("this", x.this_param, y.this_param);
        if self.lens("parameters", x.params.len(), y.params.len()) {
            for n in 0..x.params.len() {
                self.param("parameter", x.params.at(n), y.params.at(n));
            }
        }
        self.ty("return type", x.ret, y.ret);
        let open = |list: &[(FnId, u32)], f: FnId| {
            list.binary_search_by_key(&f.0, |it| it.0.0)
                .ok()
                .map(|at| list[at].1)
        };
        let (p, q) = (open(&self.a.body_starts, a), open(&self.b.body_starts, b));
        if p != q {
            self.differ("body start", &p, &q);
        }
        match (x.body, y.body) {
            (FnBody::None, FnBody::None) => {}
            (FnBody::Block(x), FnBody::Block(y)) => self.stmt_list("statement", x, y),
            (FnBody::Expr(x), FnBody::Expr(y)) => self.expr("body", x, y),
            (x, y) => self.differ("body", &x, &y),
        }
        self.path.pop();
    }

    fn member_span(&mut self, a: Span<MemberId>, b: Span<MemberId>) {
        if self.lens("members", a.len(), b.len()) {
            for n in 0..a.len() {
                self.member(a.at(n), b.at(n));
            }
        }
    }

    fn member(&mut self, a: MemberId, b: MemberId) {
        let (x, y) = (self.a[a], self.b[b]);
        self.members[a.idx()] = b.0;
        self.seen.members[b.idx()] = true;
        self.path.push(("member", x.start));
        same!(self, x, y, kind, flags, name_pos, start, loc);
        self.key(x.key, y.key);
        self.modifiers(x.modifiers, y.modifiers);
        self.func("function", x.func, y.func);
        // The type of an index signature is the return type of its signature: one node, not two.
        if x.kind == MemberKind::IndexSignature {
            let shared = |ty: TypeNodeId, ret: TypeNodeId| ty == ret;
            let (p, q) = (
                shared(x.ty, self.a[x.func].ret),
                y.func.is_some() && shared(y.ty, self.b[y.func].ret),
            );
            if p != q {
                self.differ("the type is the return type", &p, &q);
            }
        } else {
            self.ty("type", x.ty, y.ty);
        }
        self.expr("init", x.init, y.init);
        self.path.pop();
    }

    fn class(&mut self, a: ClassId, b: ClassId) {
        let (x, y) = (self.a[a], self.b[b]);
        self.classes[a.idx()] = b.0;
        self.seen.classes[b.idx()] = true;
        self.path.push(("class", x.start));
        same!(self, x, y, name, name_pos, flags, start);
        self.modifiers(x.modifiers, y.modifiers);
        self.type_params(x.type_params, y.type_params);
        self.expr("extends", x.extends, y.extends);
        self.type_list("extends_args", x.extends_args, y.extends_args);
        self.expr_list("other_extends", x.other_extends, y.other_extends);
        self.type_list("implements", x.implements, y.implements);
        self.type_list("other_implements", x.other_implements, y.other_implements);
        self.member_span(x.members, y.members);
        self.path.pop();
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn props(&mut self, a: Span<PropId>, b: Span<PropId>) {
        if !self.lens("properties", a.len(), b.len()) {
            return;
        }
        for n in 0..a.len() {
            let (x, y) = (self.a[a.at(n)], self.b[b.at(n)]);
            self.seen.props[b.at(n).idx()] = true;
            self.path.push(("property", x.start));
            same!(self, x, y, kind, name_kind, pos, start, end, postfix_token);
            self.key(x.key, y.key);
            self.modifiers(self.a.prop_modifiers(a.at(n)), self.b.prop_modifiers(b.at(n)));
            self.expr("value", x.value, y.value);
            self.path.pop();
        }
    }

    fn call(&mut self, a: CallId, b: CallId) {
        let (x, y) = (self.a[a], self.b[b]);
        self.seen.calls[b.idx()] = true;
        same!(self, x, y, close_pos, chain);
        self.expr("callee", x.callee, y.callee);
        self.type_list("type argument", x.type_args, y.type_args);
        self.expr_list("argument", x.args, y.args);
        self.expr("template", x.template, y.template);
    }

    fn expr(&mut self, what: &'static str, a: ExprId, b: ExprId) {
        if !self.both(what, a.0, b.0) {
            return;
        }
        let (x, y) = (self.a[a], self.b[b]);
        // The substitutions of a tagged template are reached twice.
        self.exprs[a.idx()] = b.0;
        self.seen.exprs[b.idx()] = true;
        self.path.push((what, x.pos));
        same!(self, x, y, pos, end);
        let strip = |list: &[(ExprId, u32, u32)]| -> Vec<(u32, u32)> {
            list.iter().map(|it| (it.1, it.2)).collect()
        };
        let (p, q) = (
            strip(parentheses_around(self.a, a)),
            strip(parentheses_around(self.b, b)),
        );
        if p != q {
            self.differ("parentheses", &p, &q);
        }
        let ends = |list: &[(ExprId, u32)]| -> Vec<u32> { list.iter().map(|it| it.1).collect() };
        let (p, q) = (
            ends(non_null_ends_in(self.a, a)),
            ends(non_null_ends_in(self.b, b)),
        );
        if p != q {
            self.differ("non_null_ends", &p, &q);
        }
        let braces = |list: &[(ExprId, u32, u32)], e: ExprId| {
            list.binary_search_by_key(&e.0, |it| it.0.0)
                .ok()
                .map(|at| (list[at].1, list[at].2))
        };
        let (p, q) = (
            braces(&self.a.jsx_expressions, a),
            braces(&self.b.jsx_expressions, b),
        );
        if p != q {
            self.differ("jsx_expressions", &p, &q);
        }
        self.expr_kind(x.kind, y.kind);
        self.path.pop();
    }

    fn expr_kind(&mut self, x: ExprKind, y: ExprKind) {
        use ExprKind::*;
        match (x, y) {
            (Missing, Missing)
            | (This, This)
            | (Super, Super)
            | (Null, Null)
            | (True, True)
            | (False, False)
            | (Regex, Regex)
            | (ImportMeta, ImportMeta) => {}
            (Ident(x), Ident(y))
            | (PrivateIdentifier(x), PrivateIdentifier(y))
            | (String(x), String(y))
            | (BigInt(x), BigInt(y))
            | (NewTarget(x), NewTarget(y)) => {
                if x != y {
                    self.differ("text", &x, &y);
                }
            }
            (Number(x), Number(y)) => {
                let (x, y) = (self.a.numbers[x as usize], self.b.numbers[y as usize]);
                if x.to_bits() != y.to_bits() {
                    self.differ("number", &x, &y);
                }
            }
            (Template { exprs: x }, Template { exprs: y }) => {
                self.expr_list("substitution", x, y);
                self.atom_list("texts", self.a.template_texts(x), self.b.template_texts(y));
            }
            (TaggedTemplate(x), TaggedTemplate(y)) | (Call(x), Call(y)) | (New(x), New(y)) => {
                self.call(x, y);
            }
            (Array(x), Array(y)) => self.expr_list("element", x, y),
            (ImportCall { args: x }, ImportCall { args: y }) => {
                self.expr_list("argument", x, y);
                let (p, q) = (
                    self.a.type_args_of_import_call(x),
                    self.b.type_args_of_import_call(y),
                );
                self.type_list("type argument", p, q);
            }
            (Object(x), Object(y)) => self.props(x, y),
            (Fn(x), Fn(y)) => self.func("function", x, y),
            (Class(x), Class(y)) => self.class(x, y),
            (
                Dot {
                    obj,
                    name,
                    name_pos,
                    chain,
                },
                Dot {
                    obj: obj2,
                    name: name2,
                    name_pos: name_pos2,
                    chain: chain2,
                },
            ) => {
                if (name, name_pos, chain) != (name2, name_pos2, chain2) {
                    self.differ("name", &(name, name_pos, chain), &(name2, name_pos2, chain2));
                }
                self.expr("object", obj, obj2);
            }
            (
                Index { obj, index, chain },
                Index {
                    obj: obj2,
                    index: index2,
                    chain: chain2,
                },
            ) => {
                if chain != chain2 {
                    self.differ("chain", &chain, &chain2);
                }
                self.expr("object", obj, obj2);
                self.expr("index", index, index2);
            }
            (
                Unary { op, operand },
                Unary {
                    op: op2,
                    operand: operand2,
                },
            ) => {
                if op != op2 {
                    self.differ("operator", &op, &op2);
                }
                self.expr("operand", operand, operand2);
            }
            (
                Binary { op, left, right },
                Binary {
                    op: op2,
                    left: left2,
                    right: right2,
                },
            ) => {
                if op != op2 {
                    self.differ("operator", &op, &op2);
                }
                self.expr("left", left, left2);
                self.expr("right", right, right2);
            }
            (
                Assign { op, target, value },
                Assign {
                    op: op2,
                    target: target2,
                    value: value2,
                },
            ) => {
                if op != op2 {
                    self.differ("operator", &op, &op2);
                }
                self.expr("target", target, target2);
                self.expr("value", value, value2);
            }
            (
                Cond { test, yes, no },
                Cond {
                    test: test2,
                    yes: yes2,
                    no: no2,
                },
            ) => {
                self.expr("test", test, test2);
                self.expr("yes", yes, yes2);
                self.expr("no", no, no2);
            }
            (Spread(x), Spread(y))
            | (Await(x), Await(y))
            | (AsConst(x), AsConst(y))
            | (NonNull(x), NonNull(y)) => self.expr("operand", x, y),
            (
                Yield { value, star },
                Yield {
                    value: value2,
                    star: star2,
                },
            ) => {
                if star != star2 {
                    self.differ("star", &star, &star2);
                }
                self.expr("value", value, value2);
            }
            (As { expr, ty }, As { expr: expr2, ty: ty2 })
            | (Satisfies { expr, ty }, Satisfies { expr: expr2, ty: ty2 }) => {
                self.expr("operand", expr, expr2);
                self.ty("type", ty, ty2);
            }
            (
                Instantiation { expr, type_args },
                Instantiation {
                    expr: expr2,
                    type_args: type_args2,
                },
            ) => {
                self.expr("operand", expr, expr2);
                self.type_list("type argument", type_args, type_args2);
            }
            (Jsx(x), Jsx(y)) => {
                let (i, j) = (self.a[x], self.b[y]);
                self.seen.jsx[y.idx()] = true;
                same!(self, i, j, opening_end, close_pos, end);
                self.expr("tag", i.tag, j.tag);
                self.expr("close_tag", i.close_tag, j.close_tag);
                self.props(i.attrs, j.attrs);
                self.expr_list("child", i.children, j.children);
                self.type_list("type argument", i.type_args, j.type_args);
            }
            (x, y) => self.differ("kind", &x, &y),
        }
    }

    // ───────────────────────────── types ─────────────────────────────

    fn ty(&mut self, what: &'static str, a: TypeNodeId, b: TypeNodeId) {
        if !self.both(what, a.0, b.0) {
            return;
        }
        let (x, y) = (self.a[a], self.b[b]);
        self.seen.types[b.idx()] = true;
        self.path.push((what, x.pos));
        same!(self, x, y, pos, end);
        self.type_kind(x.kind, y.kind);
        self.path.pop();
    }

    fn type_kind(&mut self, x: TypeNodeKind, y: TypeNodeKind) {
        use TypeNodeKind::*;
        match (x, y) {
            (Error, Error) | (UniqueSymbol, UniqueSymbol) => {}
            (Keyword(x), Keyword(y)) if x == y => {}
            (StringLit(x), StringLit(y)) if x == y => {}
            (BoolLit(x), BoolLit(y)) if x == y => {}
            (
                BigIntLit { text, negative },
                BigIntLit {
                    text: text2,
                    negative: negative2,
                },
            ) if (text, negative) == (text2, negative2) => {}
            (NumberLit(x), NumberLit(y)) => {
                let (x, y) = (self.a.numbers[x as usize], self.b.numbers[y as usize]);
                if x.to_bits() != y.to_bits() {
                    self.differ("number", &x, &y);
                }
            }
            (
                Heritage { expr, args },
                Heritage {
                    expr: expr2,
                    args: args2,
                },
            ) => {
                self.expr("expression", expr, expr2);
                self.type_list("type argument", args, args2);
            }
            (
                Ref { name, args },
                Ref {
                    name: name2,
                    args: args2,
                },
            ) => {
                self.names("name", name, name2);
                self.type_list("type argument", args, args2);
            }
            (
                Template { types, texts },
                Template {
                    types: types2,
                    texts: texts2,
                },
            ) => {
                self.type_list("type", types, types2);
                self.atom_list("texts", texts, texts2);
            }
            (Array(x), Array(y))
            | (Keyof(x), Keyof(y))
            | (Readonly(x), Readonly(y))
            | (Unique(x), Unique(y)) => self.ty("operand", x, y),
            (Tuple(x), Tuple(y)) => {
                if self.lens("elements", x.len(), y.len()) {
                    for n in 0..x.len() {
                        let (e, g) = (self.a[x.at(n)], self.b[y.at(n)]);
                        self.seen.tuple_elems[y.at(n).idx()] = true;
                        self.path.push(("element", e.start));
                        same!(self, e, g, member_type, name, optional, rest, has_dots, start, end);
                        self.ty("type", e.ty, g.ty);
                        if (e.written == e.ty) != (g.written == g.ty) {
                            self.differ("written", &e.written, &g.written);
                        } else if e.written != e.ty {
                            self.ty("written", e.written, g.written);
                        }
                        self.path.pop();
                    }
                }
            }
            (Union(x), Union(y)) | (Intersection(x), Intersection(y)) => {
                self.type_list("member", x, y);
            }
            (Fn(x), Fn(y)) => self.func("signature", x, y),
            (Object(x), Object(y)) => self.member_span(x, y),
            (
                Cond {
                    check,
                    extends,
                    yes,
                    no,
                },
                Cond {
                    check: check2,
                    extends: extends2,
                    yes: yes2,
                    no: no2,
                },
            ) => {
                self.ty("check", check, check2);
                self.ty("extends", extends, extends2);
                self.ty("yes", yes, yes2);
                self.ty("no", no, no2);
            }
            (Infer(x), Infer(y)) => self.type_param(x, y),
            (Mapped(x), Mapped(y)) => {
                let (i, j) = (self.a[x], self.b[y]);
                self.seen.mapped[y.idx()] = true;
                same!(
                    self, i, j, readonly, optional, is_readonly_with_plus, is_optional_with_plus
                );
                self.type_param(i.param, j.param);
                self.ty("name type", i.name_ty, j.name_ty);
                self.ty("type", i.ty, j.ty);
                self.member_span(i.members, j.members);
            }
            (
                IndexedAccess { obj, index },
                IndexedAccess {
                    obj: obj2,
                    index: index2,
                },
            ) => {
                self.ty("object", obj, obj2);
                self.ty("index", index, index2);
            }
            (
                JSDoc {
                    ty,
                    kind,
                    is_postfix,
                },
                JSDoc {
                    ty: ty2,
                    kind: kind2,
                    is_postfix: is_postfix2,
                },
            ) => {
                if (kind, is_postfix) != (kind2, is_postfix2) {
                    self.differ("kind", &(kind, is_postfix), &(kind2, is_postfix2));
                }
                self.ty("operand", ty, ty2);
            }
            (
                Typeof {
                    name,
                    args,
                    has_type_arguments,
                    expr,
                },
                Typeof {
                    name: name2,
                    args: args2,
                    has_type_arguments: has_type_arguments2,
                    expr: expr2,
                },
            ) => {
                if has_type_arguments != has_type_arguments2 {
                    self.differ("has_type_arguments", &has_type_arguments, &has_type_arguments2);
                }
                self.names("name", name, name2);
                self.type_list("type argument", args, args2);
                self.expr("expression", expr, expr2);
            }
            (
                Import {
                    spec,
                    name,
                    args,
                    is_typeof,
                    mode,
                    attributes,
                },
                Import {
                    spec: spec2,
                    name: name2,
                    args: args2,
                    is_typeof: is_typeof2,
                    mode: mode2,
                    attributes: attributes2,
                },
            ) => {
                let (x, y) = (
                    (spec, is_typeof, mode, attributes),
                    (spec2, is_typeof2, mode2, attributes2),
                );
                if x != y {
                    self.differ("import type", &x, &y);
                }
                self.names("name", name, name2);
                self.type_list("type argument", args, args2);
            }
            (
                Predicate { param, ty, asserts },
                Predicate {
                    param: param2,
                    ty: ty2,
                    asserts: asserts2,
                },
            ) => {
                if (param, asserts) != (param2, asserts2) {
                    self.differ("predicate", &(param, asserts), &(param2, asserts2));
                }
                self.ty("type", ty, ty2);
            }
            (x, y) => self.differ("kind", &x, &y),
        }
    }
}

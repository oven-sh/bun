use super::*;

// What a file reads from the object of a module that `import()` or `require()` evaluates to, by the rules of `bun build`:
// `dynamic_import_namespace_locals`, `try_track_dynamic_import_destructure` and `track_promise_all_destructure` in
// src/js_parser/p.rs, `bare_statement_namespace` in src/js_parser/visit/visit_stmt.rs. Every function here answers `None` where
// those rules lose sight of the object: all of its names are read then.
#[derive(Default)]
pub(super) struct ObjectReads {
    pub(super) names: Vec<Atom>,
    // Bindings that hold the object, or a copy of what a pattern leaves of it.
    pub(super) holders: Vec<SymbolId>,
    // A name that a pattern reads into a binding, which counts if the binding is used.
    pub(super) names_of_bindings: Vec<(SymbolId, Atom)>,
}

impl ObjectReads {
    fn of_name(name: Atom) -> ObjectReads {
        ObjectReads {
            names: vec![name],
            ..ObjectReads::default()
        }
    }

    fn of_holder(holder: SymbolId) -> ObjectReads {
        ObjectReads {
            holders: vec![holder],
            ..ObjectReads::default()
        }
    }

    pub(super) fn add(&mut self, more: ObjectReads) {
        self.names.extend(more.names);
        self.holders.extend(more.holders);
        self.names_of_bindings.extend(more.names_of_bindings);
    }
}

fn is_type_syntax(kind: ExprKind) -> bool {
    matches!(
        kind,
        ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
    )
}

impl Summary<'_, '_> {
    // `node` with the type syntax around it, and the parent of that.
    fn with_type_syntax(&self, mut node: ExprId) -> (ExprId, Parent) {
        loop {
            match self.bound.parent_of_expr(node) {
                Parent::Expr(parent) if is_type_syntax(self.hir[parent].kind) => node = parent,
                parent => return (node, parent),
            }
        }
    }

    fn without_type_syntax(&self, mut node: ExprId) -> ExprId {
        loop {
            match self.hir[node].kind {
                ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } => node = expr,
                ExprKind::AsConst(expr) | ExprKind::NonNull(expr) => node = expr,
                _ => return node,
            }
        }
    }

    fn is_statement(&self, node: ExprId, parent: Parent) -> bool {
        match parent {
            Parent::Stmt(statement) => {
                matches!(self.hir[statement].kind, StmtKind::Expr(value) if value == node)
            }
            _ => false,
        }
    }

    fn is_null_or_undefined(&self, node: ExprId) -> bool {
        match self.hir[self.without_type_syntax(node)].kind {
            ExprKind::Null => true,
            ExprKind::Ident(name) => {
                name == known::undefined
                    && self.bound.binding(self.without_type_syntax(node)) == Binding::Free
            }
            _ => false,
        }
    }

    // The binding that a name in a pattern makes, if only this pattern gives it a value.
    fn find_own_binding(&self, name: PatId) -> Option<SymbolId> {
        match (self.hir[name].kind, self.bound.initialized_binding(name)) {
            (PatKind::Ident(_), Binding::Symbol(symbol)) => {
                self.bound.is_stable_binding(symbol).then_some(symbol)
            }
            _ => None,
        }
    }

    // `keeps_all`: the bindings are exported.
    fn find_reads_of_pattern(
        &self,
        properties: Span<PatPropId>,
        keeps_all: bool,
    ) -> Option<ObjectReads> {
        let hir = self.hir;
        let mut reads = ObjectReads::default();
        let mut seen = Vec::new();
        let last = properties.iter().last();
        for property in properties.iter() {
            let node = &hir[property];
            if node.is_rest {
                if Some(property) != last || keeps_all {
                    return None;
                }
                reads.holders.push(self.find_own_binding(node.value)?);
                continue;
            }
            let name = match (node.key, node.name_kind) {
                (PropKey::Name(name), NameKind::Identifier | NameKind::StringLiteral) => name,
                _ => return None,
            };
            // A default value shows whether the export is there, and a pattern reads through it.
            match self.find_own_binding(node.value) {
                Some(binding) if !keeps_all && node.default.is_none() && !seen.contains(&name) => {
                    reads.names_of_bindings.push((binding, name));
                }
                _ => reads.names.push(name),
            }
            seen.push(name);
        }
        Some(reads)
    }

    // `is_copy`: the initializer is a binding that holds the object, and not the call.
    fn find_reads_of_declaration(
        &self,
        declaration: VarDeclId,
        is_copy: bool,
    ) -> Option<ObjectReads> {
        let node = &self.hir[declaration];
        let is_exported = node.flags.contains(Flags::EXPORT);
        match (self.hir[node.pat].kind, node.kind) {
            (PatKind::Object(properties), VarKind::Var | VarKind::Let | VarKind::Const) => {
                self.find_reads_of_pattern(properties, is_exported)
            }
            (PatKind::Ident(_), VarKind::Let | VarKind::Const) if !is_exported && !is_copy => {
                self.find_own_binding(node.pat).map(ObjectReads::of_holder)
            }
            _ => None,
        }
    }

    fn find_reads_of_binding_pattern(&self, pattern: PatId) -> Option<ObjectReads> {
        match self.hir[pattern].kind {
            PatKind::Object(properties) => self.find_reads_of_pattern(properties, false),
            PatKind::Ident(_) => self.find_own_binding(pattern).map(ObjectReads::of_holder),
            PatKind::Missing | PatKind::Array(_) => None,
        }
    }

    // The call of which `callee` is the callee.
    fn find_call_of(&self, callee: ExprId) -> Option<(ExprId, CallId)> {
        let Parent::Expr(parent) = self.bound.parent_of_expr(callee) else {
            return None;
        };
        match self.hir[parent].kind {
            ExprKind::Call(call) if self.hir[call].callee == callee => Some((parent, call)),
            _ => None,
        }
    }

    // `promise.then(callback)`, `promise.then(callback, other)`: the pattern of the first parameter of the callback, `None` inside
    // if it has no parameter. Only an arrow function: another function reaches its arguments without a parameter.
    fn find_then_parameter(&self, member: ExprId) -> Option<Option<PatId>> {
        let hir = self.hir;
        let (_, call) = self.find_call_of(member)?;
        let mut arguments = hir.ids(hir[call].args);
        if arguments.len() > 2 {
            return None;
        }
        let ExprKind::Fn(callback) = hir[arguments.next()?].kind else {
            return None;
        };
        let mut parameters = hir[callback].params.iter();
        if hir[callback].kind != FnKind::Arrow
            || parameters
                .clone()
                .any(|it| hir[it].flags.contains(Flags::REST))
        {
            return None;
        }
        match parameters.next() {
            None => Some(None),
            Some(first) => hir[first].default.is_none().then_some(Some(hir[first].pat)),
        }
    }

    // What the element of an array pattern reads that stands where the promise of the object stands in the list.
    fn find_reads_of_element(&self, pattern: PatId, place: usize) -> Option<ObjectReads> {
        let hir = self.hir;
        let PatKind::Array(elements) = hir[pattern].kind else {
            return None;
        };
        if elements.iter().any(|element| hir[element].is_rest) {
            return None;
        }
        let Some(element) = elements.iter().nth(place) else {
            return Some(ObjectReads::default());
        };
        if !hir[element].default.is_none() {
            return None;
        }
        match hir[hir[element].pat].kind {
            PatKind::Missing => Some(ObjectReads::default()),
            PatKind::Ident(_) | PatKind::Object(_) => {
                self.find_reads_of_binding_pattern(hir[element].pat)
            }
            PatKind::Array(_) => None,
        }
    }

    // `const [{ a }, ns] = await Promise.all([import("a"), import("b")])`, `Promise.all([..]).then(([{ a }, ns]) => ..)`
    fn find_reads_through_promise_all(&self, promise: ExprId, list: ExprId) -> Option<ObjectReads> {
        let (hir, bound) = (self.hir, self.bound);
        let ExprKind::Array(items) = hir[list].kind else {
            return None;
        };
        if hir
            .ids(items)
            .any(|item| matches!(hir[item].kind, ExprKind::Spread(_)))
        {
            return None;
        }
        let place = hir.ids(items).position(|item| item == promise)?;
        let Parent::Expr(all) = bound.parent_of_expr(list) else {
            return None;
        };
        let ExprKind::Call(call) = hir[all].kind else {
            return None;
        };
        let ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
            ..
        } = hir[hir[call].callee].kind
        else {
            return None;
        };
        if hir[call].args.len() != 1
            || name != self.names.all
            || !matches!(hir[obj].kind, ExprKind::Ident(name) if name == known::Promise)
            || bound.binding(obj) != Binding::Free
        {
            return None;
        }
        let (all, Parent::Expr(parent)) = self.with_type_syntax(all) else {
            return None;
        };
        match hir[parent].kind {
            ExprKind::Await(_) => {
                let (_, Parent::VarInit(declaration)) = self.with_type_syntax(parent) else {
                    return None;
                };
                let node = &hir[declaration];
                match node.kind {
                    VarKind::Let | VarKind::Const if !node.flags.contains(Flags::EXPORT) => {
                        self.find_reads_of_element(node.pat, place)
                    }
                    _ => None,
                }
            }
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } if obj == all && name == known::then => match self.find_then_parameter(parent)? {
                None => Some(ObjectReads::default()),
                Some(pattern) => self.find_reads_of_element(pattern, place),
            },
            _ => None,
        }
    }

    fn is_constant_site(&self, kind: ImportSiteKind) -> bool {
        let site = self.analysis.import_site_index(kind);
        site.is_some_and(|site| {
            matches!(
                self.analysis.import_sites[site].specifier,
                ImportSpecifier::Constant(_)
            )
        })
    }

    // `c ? require("a") : d ? await import("b") : null`
    fn holds_objects_or_nothing(&self, value: ExprId) -> bool {
        let hir = self.hir;
        let value = self.without_type_syntax(value);
        match hir[value].kind {
            ExprKind::Cond { branches, .. } => {
                let branches = hir.branches(branches);
                self.holds_objects_or_nothing(branches.yes)
                    && self.holds_objects_or_nothing(branches.no)
            }
            ExprKind::Call(_) => {
                self.is_constant_site(ImportSiteKind::Require(value))
                    || self.is_constant_site(ImportSiteKind::ImportMetaRequire(value))
            }
            ExprKind::Await(promise) => self.is_constant_site(ImportSiteKind::ImportCall(
                self.without_type_syntax(promise),
            )),
            _ => self.is_null_or_undefined(value),
        }
    }

    // `const ns = c ? require("a") : null`: the binding holds one of several objects, or none.
    fn find_reads_of_branch(&self, mut conditional: ExprId) -> Option<ObjectReads> {
        let hir = self.hir;
        loop {
            match self.with_type_syntax(conditional) {
                (node, Parent::Expr(parent)) => match hir[parent].kind {
                    ExprKind::Cond { test, .. } if test != node => conditional = parent,
                    _ => return None,
                },
                (node, Parent::VarInit(declaration)) => {
                    let is_name = matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_));
                    return match is_name && self.holds_objects_or_nothing(node) {
                        true => self.find_reads_of_declaration(declaration, false),
                        false => None,
                    };
                }
                _ => return None,
            }
        }
    }

    // `object.a`, `object["a"]`
    fn find_member_read(&self, object: ExprId, member: ExprId) -> Option<Atom> {
        match self.hir.member_key(member) {
            Some((of, MemberKey::Name(name))) if of == object && self.is_only_read(member) => {
                Some(name)
            }
            _ => None,
        }
    }

    fn find_reads_of_object(
        &self,
        object: ExprId,
        parent: Parent,
        is_required: bool,
    ) -> Option<ObjectReads> {
        let hir = self.hir;
        if self.is_statement(object, parent) {
            return Some(ObjectReads::default());
        }
        let parent = match parent {
            Parent::VarInit(declaration) => {
                return self.find_reads_of_declaration(declaration, false);
            }
            Parent::Expr(parent) => parent,
            _ => return None,
        };
        match hir[parent].kind {
            ExprKind::Dot {
                chain: Chain::No, ..
            }
            | ExprKind::Index {
                chain: Chain::No, ..
            } => self
                .find_member_read(object, parent)
                .map(ObjectReads::of_name),
            ExprKind::Cond { test, .. } if test != object => self.find_reads_of_branch(parent),
            // `await require("m");`
            ExprKind::Await(_) if is_required => {
                let (awaited, parent) = self.with_type_syntax(parent);
                self.is_statement(awaited, parent)
                    .then(|| ObjectReads::of_name(known::then))
            }
            _ => None,
        }
    }

    fn find_reads_of_promise(&self, call: ExprId) -> Option<ObjectReads> {
        let hir = self.hir;
        let (promise, parent) = self.with_type_syntax(call);
        if self.is_statement(promise, parent) {
            return Some(ObjectReads::default());
        }
        let Parent::Expr(parent) = parent else {
            return None;
        };
        match hir[parent].kind {
            ExprKind::Await(_) => {
                let (object, parent) = self.with_type_syntax(parent);
                self.find_reads_of_object(object, parent, false)
            }
            ExprKind::Dot { name, .. } if name == known::then => {
                match self.find_then_parameter(parent)? {
                    None => Some(ObjectReads::default()),
                    Some(pattern) => self.find_reads_of_binding_pattern(pattern),
                }
            }
            // `import("m").catch(..);`, `await import("m").finally(..);`
            ExprKind::Dot { name, .. }
                if name == self.names.catch || name == self.names.finally =>
            {
                let (handled, _) = self.find_call_of(parent)?;
                let (mut value, mut parent) = self.with_type_syntax(handled);
                if let Parent::Expr(awaited) = parent
                    && matches!(hir[awaited].kind, ExprKind::Await(_))
                {
                    (value, parent) = self.with_type_syntax(awaited);
                }
                self.is_statement(value, parent).then(ObjectReads::default)
            }
            ExprKind::Array(_) => self.find_reads_through_promise_all(promise, parent),
            _ => None,
        }
    }

    pub(super) fn find_reads_of_site(&self, site: &ImportSite) -> Option<ObjectReads> {
        match site.kind {
            ImportSiteKind::ImportCall(call) => self.find_reads_of_promise(call),
            ImportSiteKind::Require(call) | ImportSiteKind::ImportMetaRequire(call) => {
                let (object, parent) = self.with_type_syntax(call);
                self.find_reads_of_object(object, parent, true)
            }
            ImportSiteKind::JsxRuntime
            | ImportSiteKind::JsxPackage
            | ImportSiteKind::Import(_)
            | ImportSiteKind::ExportFrom(_)
            | ImportSiteKind::ExportStar(_)
            | ImportSiteKind::ImportEquals(_)
            | ImportSiteKind::RequireResolve(_)
            | ImportSiteKind::ImportMetaResolve(_)
            | ImportSiteKind::GetBuiltinModule(_) => None,
        }
    }

    // What one mention of a binding that holds the object reads from it.
    pub(super) fn find_reads_of_mention(&self, mention: ExprId) -> Option<ObjectReads> {
        let hir = self.hir;
        let (holder, parent) = self.with_type_syntax(mention);
        let parent = match parent {
            Parent::VarInit(declaration) => {
                return self.find_reads_of_declaration(declaration, true);
            }
            Parent::Stmt(statement) => {
                let is_test =
                    matches!(hir[statement].kind, StmtKind::If { test, .. } if test == holder);
                return is_test.then(ObjectReads::default);
            }
            Parent::Expr(parent) => parent,
            _ => return None,
        };
        // A test of the binding looks at none of the names.
        let is_test = match hir[parent].kind {
            ExprKind::Dot {
                chain: Chain::No | Chain::Start,
                ..
            }
            | ExprKind::Index {
                chain: Chain::No, ..
            } => {
                return self
                    .find_member_read(holder, parent)
                    .map(ObjectReads::of_name);
            }
            ExprKind::Unary { op, .. } => matches!(op, UnOp::Not | UnOp::Typeof),
            ExprKind::Binary { op, left, right } => match op {
                BinOp::And => left == holder,
                BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => {
                    self.is_null_or_undefined(if left == holder { right } else { left })
                }
                _ => false,
            },
            ExprKind::Cond { test, .. } => test == holder,
            _ => false,
        };
        is_test.then(ObjectReads::default)
    }
}

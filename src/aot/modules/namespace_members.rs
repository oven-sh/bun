use super::bindings::{AccessedModule, Holder, ImportBinding};
use super::imports::{BoundName, FileBinder, NamedMember, PendingBinding};
use super::interop::{ImportPhase, ModuleKind};
use super::order::{PlannedSite, SiteKey};
use super::plan::{Member, ModuleRef, View};
use super::wrapped::InnerModuleKind;
use crate::builtins::id::BuiltinId;
use crate::builtins::table;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Bound, Decl, Parent, SymbolId};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    self, BinOp, Chain, ExprId, ExprKind, MemberKey, PatId, PatKind, PropKey, StmtKind, UnOp,
};
use bun_sema::util::SharedSort;

/// A name that stands for a module: an import of its namespace or of its exports as a whole, or a holder.
#[derive(Copy, Clone)]
struct Root {
    symbol: SymbolId,
    stands_for: StandsFor,
    /// The position in the list of holders.
    holder: Option<usize>,
}

/// What the members of an expression are the members of.
#[derive(Copy, Clone)]
enum StandsFor {
    /// What `import * as ns` shows.
    ImportedNamespace(ModuleRef),
    /// What `require` of an ES module answers.
    RequiredNamespace(ModuleRef),
    /// `module.exports` of a CommonJS module.
    Exports(ModuleRef),
}

impl StandsFor {
    fn module(self) -> ModuleRef {
        match self {
            StandsFor::ImportedNamespace(module)
            | StandsFor::RequiredNamespace(module)
            | StandsFor::Exports(module) => module,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Use {
    /// The member around it is bound, so that nothing looks at the object.
    Member,
    /// Only this counts: it is an object.
    Tested,
    Value,
}

#[derive(Copy, Clone)]
enum Resolved {
    Binding(PendingBinding),
    Fixed(Member),
}

impl FileBinder<'_, '_> {
    pub(super) fn bind_namespace_members(&mut self) {
        let mut roots = self.collect_imported_roots();
        let sites: Vec<PlannedSite> = self.context.sites.of(self.file).to_vec();
        let mut holders = Vec::new();
        for site in &sites {
            self.bind_site(site, &mut roots, &mut holders);
        }
        if !roots.is_empty() {
            roots.shared_sort_by_key(|root| root.symbol);
            self.bind_references(&roots, &mut holders);
        }
        let mut holders: Vec<Holder> = holders.into_iter().flatten().collect();
        holders.shared_sort_unstable_by_key(|holder| holder.symbol);
        self.imports.holders = holders;
        self.imports
            .unread_sites
            .shared_sort_unstable_by_key(|&(call, _)| call);
        self.imports
            .accessed
            .shared_sort_unstable_by_key(|&(member, _)| member);
        self.imports
            .fixed_members
            .shared_sort_unstable_by_key(|&(member, _)| member);
    }

    fn collect_imported_roots(&self) -> Vec<Root> {
        let bindings = self.imports.bindings.iter();
        let mut roots: Vec<Root> = bindings
            .filter_map(|&(symbol, binding)| {
                Some(Root {
                    symbol,
                    stands_for: imported_module(binding)?,
                    holder: None,
                })
            })
            .collect();
        roots.shared_sort_by_key(|root| root.symbol);
        roots.dedup_by_key(|root| root.symbol);
        roots
    }

    fn bind_references(&mut self, roots: &[Root], holders: &mut [Option<Holder>]) {
        let (hir, bound, analysis) = (self.hir, self.bound, self.analysis);
        for root in roots {
            if bound.is_visible_to_eval(root.symbol) {
                self.look_at(root.stands_for);
            }
        }
        let mut references: Vec<(usize, ExprId)> = Vec::new();
        for index in 0..hir.exprs.len() as u32 {
            let reference = ExprId(index);
            if !bound.is_evaluated_ident(reference) || analysis.decisions.is_dead_expr(reference) {
                continue;
            }
            let Binding::Symbol(symbol) = bound.binding(reference) else {
                continue;
            };
            if let Ok(position) = roots.binary_search_by_key(&symbol, |root| root.symbol) {
                references.push((position, reference));
            }
        }
        references.shared_sort_unstable();
        let mut rest = &references[..];
        while let Some(&(position, _)) = rest.first() {
            let count = rest.partition_point(|reference| reference.0 == position);
            let (of_root, others) = rest.split_at(count);
            rest = others;
            self.bind_references_to(roots[position], of_root, holders);
        }
    }

    fn bind_references_to(
        &mut self,
        root: Root,
        references: &[(usize, ExprId)],
        holders: &mut [Option<Holder>],
    ) {
        let mut is_needed_as_value = false;
        for &(_, reference) in references {
            is_needed_as_value |= self.bind_member_path(reference, root.stands_for) == Use::Value;
        }
        if !is_needed_as_value {
            return;
        }
        let Some(holder) = root.holder else {
            return self.look_at(root.stands_for);
        };
        if let Some(holder) = &mut holders[holder] {
            holder.is_needed_as_value = true;
        }
        self.look_at(root.stands_for);
    }

    // Something looks at the object of the module.
    fn look_at(&mut self, stands_for: StandsFor) {
        let module = stands_for.module();
        let is_namespace = match stands_for {
            StandsFor::ImportedNamespace(_) | StandsFor::RequiredNamespace(_) => true,
            StandsFor::Exports(_) => false,
        };
        if is_namespace && !self.imports.namespace_values.contains(&module) {
            self.imports.namespace_values.push(module);
        }
        // The namespace object of a CommonJS module shows `module.exports` as `default`.
        let is_commonjs = self.context.modules.interop(module).kind == ModuleKind::CommonJs;
        if is_commonjs && !self.imports.exports_values.contains(&module) {
            self.imports.exports_values.push(module);
        }
    }

    fn what_require_answers(&self, target: ModuleRef) -> StandsFor {
        match self.context.modules.interop(target).kind {
            ModuleKind::SourceText => StandsFor::RequiredNamespace(target),
            _ => StandsFor::Exports(target),
        }
    }

    fn marker(&self, module: ModuleRef) -> Option<bool> {
        match self.context.modules.interop(module).kind {
            // From the first `require` on.
            ModuleKind::SourceText => Some(true),
            ModuleKind::CommonJs => (self.context.marker)(module),
            _ => None,
        }
    }

    fn is_esm_wrapper(&self, module: ModuleRef) -> bool {
        let ModuleRef::Inner { file, callback } = module else {
            return false;
        };
        let inner = self.context.modules.wrapped.of_callback(file, callback);
        inner.is_some_and(|inner| inner.kind == InnerModuleKind::Esm)
    }

    fn bind_site(
        &mut self,
        site: &PlannedSite,
        roots: &mut Vec<Root>,
        holders: &mut Vec<Option<Holder>>,
    ) {
        // `init_x()` gives `undefined`.
        if self.is_esm_wrapper(site.target) {
            return;
        }
        let answer = self.what_require_answers(site.target);
        if !site.evaluates || !site.is_proven {
            return self.look_at(answer);
        }
        let view = match answer {
            StandsFor::RequiredNamespace(module) => View::Namespace(module),
            _ => View::Exports(site.target),
        };
        let call = match site.key {
            SiteKey::Call(call) => call,
            SiteKey::ImportEquals(declaration) => {
                let symbol = self.bound.declared_symbol(Decl::ImportEquals(declaration));
                let is_holder = symbol.is_some()
                    && !self.is_exported(symbol)
                    && !self.bound.is_visible_to_eval(symbol);
                return match is_holder {
                    true => add_holder(roots, holders, symbol, ExprId::NONE, view, answer),
                    false => self.look_at(answer),
                };
            }
        };
        if let Some(symbol) = self.find_holder_initialized_by(call) {
            self.imports.unread_sites.push((call, false));
            return add_holder(roots, holders, symbol, call, view, answer);
        }
        if self.is_statement(call) {
            return self.imports.unread_sites.push((call, true));
        }
        if self.bind_pattern_initialized_by(call, answer) {
            return self.imports.unread_sites.push((call, false));
        }
        match self.bind_member_path(call, answer) {
            Use::Member => self.imports.unread_sites.push((call, false)),
            // A module that is one value may be false, zero or null.
            Use::Tested => self.imports.unread_sites.push((call, false)),
            Use::Value => self.look_at(answer),
        }
    }

    // A `const`, `let` or `var` that is declared once, never stored to again, not exported and not seen by `eval`.
    fn find_holder_initialized_by(&self, initializer: ExprId) -> Option<SymbolId> {
        let (hir, bound) = (self.hir, self.bound);
        let initializer = find_outermost_type_assertion(hir, bound, initializer);
        let Parent::VarInit(declaration) = bound.parent_of_expr(initializer) else {
            return None;
        };
        let pattern = hir[declaration].pat;
        if !matches!(hir[pattern].kind, PatKind::Ident(_)) {
            return None;
        }
        let holder = bound.declared_symbol(Decl::Var(pattern));
        let is_holder = holder.is_some()
            && bound.is_stable_binding(holder)
            && !self.is_exported(holder)
            && !bound.is_visible_to_eval(holder);
        is_holder.then_some(holder)
    }

    fn is_statement(&self, expression: ExprId) -> bool {
        let outermost = find_outermost_type_assertion(self.hir, self.bound, expression);
        match self.bound.parent_of_expr(outermost) {
            Parent::Stmt(statement) => matches!(self.hir[statement].kind, StmtKind::Expr(_)),
            _ => false,
        }
    }

    // `const { a, b: c = d } = require(K)` reads the names once, at that point.
    fn bind_pattern_initialized_by(&mut self, call: ExprId, answer: StandsFor) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let initializer = find_outermost_type_assertion(hir, bound, call);
        let Parent::VarInit(declaration) = bound.parent_of_expr(initializer) else {
            return false;
        };
        let Some(names) = self.find_names_of_pattern(hir[declaration].pat) else {
            return false;
        };
        let mut resolved = Vec::with_capacity(names.len());
        for &name in &names {
            match self.resolve_member(answer, name) {
                // A namespace or a built-in object behind the name is no variable that a copy could be taken of.
                Some(Resolved::Binding(binding)) if !has_variable(binding) => return false,
                Some(found) => resolved.push(found),
                None => return false,
            }
        }
        let module = answer.module();
        for (name, found) in names.into_iter().zip(resolved) {
            self.imports
                .named_members
                .push(((module, name), found.into_named()));
        }
        true
    }

    fn find_names_of_pattern(&self, pattern: PatId) -> Option<Vec<Atom>> {
        let hir = self.hir;
        let PatKind::Object(properties) = hir[pattern].kind else {
            return None;
        };
        let mut names = Vec::new();
        for property in properties.iter().map(|id| hir[id]) {
            let PropKey::Name(name) = property.key else {
                return None;
            };
            if property.is_rest {
                return None;
            }
            names.push(name);
        }
        Some(names)
    }

    /// An object finds the other names without having them, or keeps what is stored under them elsewhere.
    fn is_plain_name(&self, name: Atom) -> bool {
        let context = self.context;
        let is_index = context
            .files
            .atoms
            .bytes(name)
            .first()
            .is_some_and(u8::is_ascii_digit);
        let is_inherited = context
            .builtin_names
            .get(name)
            .is_some_and(|name| table::own_member(BuiltinId::ObjectPrototype, name).is_some());
        !is_index && !is_inherited && name != known::__proto__
    }

    // What a read of the name finds. `None`: only the object knows.
    fn resolve_member(&self, stands_for: StandsFor, name: Atom) -> Option<Resolved> {
        let module = stands_for.module();
        let is_exports = match stands_for {
            StandsFor::ImportedNamespace(_) => false,
            StandsFor::RequiredNamespace(_) => false,
            StandsFor::Exports(_) => true,
        };
        if is_exports && !self.is_plain_name(name) {
            return None;
        }
        if name == known::__esModule {
            // An ES module may export the name itself.
            if let StandsFor::RequiredNamespace(_) = stands_for
                && let Ok(BoundName {
                    binding,
                    required_name: None,
                }) = self.resolve_name(module, name)
            {
                return Some(Resolved::Binding(binding));
            }
            return match stands_for {
                StandsFor::RequiredNamespace(_) | StandsFor::Exports(_) => {
                    Some(Resolved::Fixed(Member::Marker(self.marker(module)?)))
                }
                StandsFor::ImportedNamespace(_) => None,
            };
        }
        match self.resolve_name(module, name) {
            Ok(BoundName {
                binding,
                required_name: None,
            }) => (!is_exports || has_variable(binding)).then_some(Resolved::Binding(binding)),
            // The namespace object of a module whose names are all known has no such property.
            Err(_) if matches!(stands_for, StandsFor::RequiredNamespace(_)) => {
                Some(Resolved::Fixed(Member::Undefined))
            }
            Ok(_) | Err(_) => None,
        }
    }

    // The member that the reference is the object of, and what that member stands for in its turn.
    fn bind_enclosing_member(
        &mut self,
        reference: ExprId,
        stands_for: StandsFor,
    ) -> Option<(ExprId, Option<StandsFor>)> {
        let (hir, bound) = (self.hir, self.bound);
        let (member, name) = enclosing_member(hir, bound, reference)?;
        let is_stored = is_assignment_target(hir, bound, member);
        let module = stands_for.module();
        let is_exports = matches!(stands_for, StandsFor::Exports(_));
        if is_exports && !is_plain_access(hir, bound, member) {
            return None;
        }
        let binding = match self.resolve_member(stands_for, name)? {
            Resolved::Fixed(_) if is_stored => return None,
            Resolved::Fixed(fixed) => {
                self.imports.fixed_members.push((member, (module, fixed)));
                return Some((member, None));
            }
            Resolved::Binding(binding) => binding,
        };
        if is_stored {
            // The namespace object refuses a store, and so does a name that stands for a name of another module.
            let has_own_variable = matches!(binding, PendingBinding::Synthetic { module: owner, .. } if owner == module);
            if !is_exports || !has_own_variable || !is_stored_directly(hir, bound, member) {
                return None;
            }
        }
        self.imports.members.push((member, binding));
        let is_imported = matches!(stands_for, StandsFor::ImportedNamespace(_));
        let accessed = AccessedModule {
            module,
            is_imported,
        };
        self.imports.accessed.push((member, accessed));
        if is_exports
            && let PendingBinding::Synthetic {
                module: owner,
                name,
            } = binding
            && is_callee(hir, bound, member)
        {
            self.imports.called_members.push((module, owner, name));
        }
        let inner = eager_namespace_module(binding).map(|inner| match stands_for {
            StandsFor::RequiredNamespace(_) => StandsFor::RequiredNamespace(inner),
            _ => StandsFor::ImportedNamespace(inner),
        });
        Some((member, inner))
    }

    fn bind_member_path(&mut self, mut reference: ExprId, mut stands_for: StandsFor) -> Use {
        let mut is_member_bound = false;
        while let Some((member, inner)) = self.bind_enclosing_member(reference, stands_for) {
            is_member_bound = true;
            let Some(inner) = inner else {
                return Use::Member;
            };
            (reference, stands_for) = (member, inner);
        }
        if is_member_bound {
            // `ns.inner`, where something looks at the namespace that `inner` is.
            self.look_at(stands_for);
            return Use::Member;
        }
        match self.is_only_tested(reference) {
            true => Use::Tested,
            false => Use::Value,
        }
    }

    fn is_null_or_undefined(&self, expression: ExprId) -> bool {
        let expression = self.hir.skip_type_assertions(expression);
        matches!(
            self.analysis.decisions.constant(self.hir, expression),
            FoldedValue::Constant(Constant::Undefined | Constant::Null)
        )
    }

    // Of an object `true` in its place gives the same.
    fn is_only_tested(&self, expression: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let tested = find_outermost_type_assertion(hir, bound, expression);
        match bound.parent_of_expr(tested) {
            Parent::Expr(user) if user.is_some() => match hir[user].kind {
                ExprKind::Unary { op: UnOp::Not, .. } => true,
                ExprKind::Cond { test, .. } => test == tested,
                ExprKind::Binary {
                    op: BinOp::And,
                    left,
                    ..
                } => left == tested,
                ExprKind::Binary {
                    op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                    left,
                    right,
                } => self.is_null_or_undefined(if left == tested { right } else { left }),
                _ => false,
            },
            Parent::Stmt(statement) => match hir[statement].kind {
                StmtKind::If { test, .. }
                | StmtKind::While { test, .. }
                | StmtKind::DoWhile { test, .. }
                | StmtKind::For { test, .. } => test == tested,
                _ => false,
            },
            _ => false,
        }
    }
}

impl Resolved {
    fn into_named(self) -> NamedMember {
        match self {
            Resolved::Binding(binding) => NamedMember::Binding(binding),
            Resolved::Fixed(member) => NamedMember::Fixed(member),
        }
    }
}

fn has_variable(binding: PendingBinding) -> bool {
    matches!(
        binding,
        PendingBinding::Synthetic { .. } | PendingBinding::Bound(ImportBinding::Variable(_))
    )
}

fn add_holder(
    roots: &mut Vec<Root>,
    holders: &mut Vec<Option<Holder>>,
    symbol: SymbolId,
    call: ExprId,
    view: View,
    stands_for: StandsFor,
) {
    roots.push(Root {
        symbol,
        stands_for,
        holder: Some(holders.len()),
    });
    holders.push(Some(Holder {
        symbol,
        call,
        view,
        is_needed_as_value: false,
    }));
}

fn imported_module(binding: PendingBinding) -> Option<StandsFor> {
    match binding {
        PendingBinding::Bound(ImportBinding::Exports { module }) => {
            Some(StandsFor::Exports(module))
        }
        _ => eager_namespace_module(binding).map(StandsFor::ImportedNamespace),
    }
}

fn eager_namespace_module(binding: PendingBinding) -> Option<ModuleRef> {
    match binding {
        PendingBinding::Bound(ImportBinding::Namespace { module, phase }) => match phase {
            ImportPhase::Evaluation => Some(module),
            ImportPhase::Defer => None,
        },
        PendingBinding::Bound(
            ImportBinding::Local
            | ImportBinding::Unused
            | ImportBinding::Unbound
            | ImportBinding::Variable(_)
            | ImportBinding::Builtin(_)
            | ImportBinding::CapturedBuiltin { .. }
            | ImportBinding::BuiltinMember { .. }
            | ImportBinding::Synthetic(_)
            | ImportBinding::NamespaceRead { .. }
            | ImportBinding::Exports { .. },
        )
        | PendingBinding::Synthetic { .. }
        | PendingBinding::CapturedBuiltin { .. } => None,
    }
}

fn find_outermost_type_assertion(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    operand: ExprId,
) -> ExprId {
    let mut outermost = operand;
    while let Parent::Expr(parent) = bound.parent_of_expr(outermost)
        && hir.type_assertion_operand(parent) == Some(outermost)
    {
        outermost = parent;
    }
    outermost
}

fn enclosing_member(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    object: ExprId,
) -> Option<(ExprId, Atom)> {
    let object = find_outermost_type_assertion(hir, bound, object);
    let Parent::Expr(member) = bound.parent_of_expr(object) else {
        return None;
    };
    match hir.member_key(member) {
        Some((member_object, MemberKey::Name(name))) if member_object == object => {
            Some((member, name))
        }
        Some((_, MemberKey::Name(_) | MemberKey::PrivateName(_) | MemberKey::Computed(_)))
        | None => None,
    }
}

fn is_assignment_target(hir: &hir::File<'_>, bound: &Bound<'_>, member: ExprId) -> bool {
    let target = find_outermost_type_assertion(hir, bound, member);
    bound.get_assignment_target(hir, target).is_some()
}

// `a.n = v`, `a.n += v`, `a.n++`: no part of a pattern, and not the head of a loop.
fn is_stored_directly(hir: &hir::File<'_>, bound: &Bound<'_>, member: ExprId) -> bool {
    let target = find_outermost_type_assertion(hir, bound, member);
    let Parent::Expr(user) = bound.parent_of_expr(target) else {
        return false;
    };
    match hir[user].kind {
        ExprKind::Assign {
            target: assigned, ..
        } => assigned == target && !bound.is_shorthand_property_assignment(hir, user),
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
            ..
        } => true,
        _ => false,
    }
}

// No link of an optional chain, and not what `delete` removes.
fn is_plain_access(hir: &hir::File<'_>, bound: &Bound<'_>, member: ExprId) -> bool {
    let (ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }) = hir[member].kind else {
        return false;
    };
    let outermost = find_outermost_type_assertion(hir, bound, member);
    let is_deleted = matches!(bound.parent_of_expr(outermost), Parent::Expr(user)
        if user.is_some() && matches!(hir[user].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
    chain == Chain::No && !is_deleted
}

// The object would be `this`.
fn is_callee(hir: &hir::File<'_>, bound: &Bound<'_>, member: ExprId) -> bool {
    let outermost = find_outermost_type_assertion(hir, bound, member);
    let Parent::Expr(user) = bound.parent_of_expr(outermost) else {
        return false;
    };
    match hir[user].kind {
        ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => hir[call].callee == outermost,
        _ => false,
    }
}

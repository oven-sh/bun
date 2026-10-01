//! What comes back to itself: 2506 2310 2313 2615, and 2502 2577 7022 7023 7024.
//!
//! In TypeScript 7.0.2's checker.go these fall out of `pushTypeResolution` finding what is asked for already under way, in
//! `getBaseConstructorTypeOfClass`, `getBaseTypes` and `getResolvedBaseConstraint`: everything from there to the top of the stack
//! is in the circle, and what only leads to it is not. Here the circles are looked for in what is written, and among those that
//! `Checker::enter` came upon when the types were asked for.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, Symbol, SymbolId};

/// `getConstraintDeclaration`: where the constraint `node` starts as it is written. Neither the parentheses around a type are kept
/// nor a `|` or a `&` before its only member; what comes before a constraint is `extends` or `in`, which none of these can be
/// mistaken for.
fn start_of_constraint(hir: &hir::File, node: TypeNodeId) -> u32 {
    let text = &hir.text[..];
    let mut at = (hir[node].pos as usize).min(text.len());
    loop {
        let before = text[..at].trim_ascii_end().len();
        if before == 0 || !matches!(text[before - 1], b'(' | b'|' | b'&') {
            return at as u32;
        }
        at = before - 1;
    }
}

/// `getUnionType`, `getIntersectionType`: what the type at `node` is whatever else is written in it. In a union `any`, and then
/// `unknown`, leaves nothing of the rest; in an intersection `never`, and then `any`.
fn keyword_it_comes_to(hir: &hir::File, node: TypeNodeId) -> Option<Keyword> {
    let strongest = |members: IdList<TypeNodeId>, first: Keyword, second: Keyword| {
        let mut found = None;
        for member in hir.ids(members) {
            match keyword_it_comes_to(hir, member) {
                Some(keyword) if keyword == first => return Some(first),
                Some(keyword) if keyword == second => found = Some(second),
                _ => {}
            }
        }
        found
    };
    match hir[node].kind {
        TypeNodeKind::Keyword(keyword @ (Keyword::Any | Keyword::Unknown | Keyword::Never)) => {
            Some(keyword)
        }
        TypeNodeKind::Union(members) => strongest(members, Keyword::Any, Keyword::Unknown),
        TypeNodeKind::Intersection(members) => strongest(members, Keyword::Never, Keyword::Any),
        _ => None,
    }
}

impl Checker<'_> {
    pub(super) fn check_circularities(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        self.check_circular_resolutions(file, out);
        let (hir, bound) = (self.hir(file), self.bound(file));
        for c in 0..hir.classes.len() {
            if bound.class_symbol[c].is_none() {
                continue;
            }
            let own = self.class_sym(file, ClassId(c as u32));
            if self.extends_itself_as_written(own) {
                out.push(Diagnostic {
                    start: hir.classes[c].name_pos,
                    code: 2506,
                });
            } else if matches!(bound.class_owner[c], ClassOwner::Stmt(_)) && self.is_own_base(own) {
                out.push(Diagnostic {
                    start: hir.classes[c].name_pos,
                    code: 2310,
                });
                self.explain(hir.classes[c].name_pos, 2310, |c| {
                    let ty = c.declared_type(own);
                    vec![c.type_to_string(ty)]
                });
            }
        }
        for i in 0..hir.interfaces.len() {
            if bound.interface_symbol[i].is_none() {
                continue;
            }
            let own = self.files().sym(file, bound.interface_symbol[i]);
            if self.is_own_base(own) {
                out.push(Diagnostic {
                    start: hir.interfaces[i].name_pos,
                    code: 2310,
                });
                self.explain(hir.interfaces[i].name_pos, 2310, |c| {
                    let ty = c.declared_type(own);
                    vec![c.type_to_string(ty)]
                });
            }
        }
        // `getResolvedBaseConstraint`, of the key of a mapped type that had to be known to tell whether the type can be extended.
        for (n, node) in hir.types.iter().enumerate() {
            if let TypeNodeKind::Mapped(m) = node.kind
                && hir[hir[m].param].constraint.is_some()
                && self
                    .p
                    .circular_mapped_keys
                    .get(&(file, TypeNodeId(n as u32)))
                    .is_some()
            {
                let param = &hir[hir[m].param];
                let start = start_of_constraint(hir, param.constraint);
                out.push(Diagnostic { start, code: 2313 });
                let end = self.end_of_type_node_from(file, param.constraint, start);
                self.note(start, end, 2313, vec![self.atom_text(param.name)]);
            }
        }
        self.check_circular_mapped_properties(file, out);
        for p in 0..hir.type_params.len() {
            let constraint = hir.type_params[p].constraint;
            if constraint.is_none() {
                continue;
            }
            let own = TypeParamId(p as u32);
            let mut is_circular = self.is_constraint_circular(file, own);
            // `checkTypeParameter`: the base constraint is asked for, which shows the circles that are not written out: through what
            // a type alias stands for, through `T[K]`, through a conditional type.
            if !is_circular && bound.type_param_symbol[p].is_some() {
                let param = self.type_param(file, own);
                is_circular = self
                    .constraint_from_type_param(param)
                    .is_some_and(|extended| self.constraint_comes_back(param, extended));
                if !is_circular {
                    self.base_constraint(param);
                    is_circular = self.p.circular_constraints.get(&param).is_some();
                }
            }
            if is_circular {
                let start = start_of_constraint(hir, constraint);
                out.push(Diagnostic { start, code: 2313 });
                let end = self.end_of_type_node_from(file, constraint, start);
                let name = self.atom_text(hir.type_params[p].name);
                self.note(start, end, 2313, vec![name]);
            }
        }
    }

    /// 2502 2577 7022 7023 7024: `reportCircularityError`, `getReturnTypeOfSignature`, `getTypeOfAccessors`. The circles themselves are
    /// found by `Checker::enter` when the types are asked for, which is what is done here.
    fn check_circular_resolutions(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let no_implicit_any = self.p.files.options.no_implicit_any;
        for i in 0..hir.pats.len() {
            let pat = PatId(i as u32);
            if !matches!(hir[pat].kind, PatKind::Ident(_))
                || matches!(bound.pat_parent[i], PatParent::None)
            {
                continue;
            }
            self.type_of_pat(file, pat);
            // `parameterInitializerContainsUndefined` is asked where the parameter is read: in its own default, that comes back to itself.
            if let PatParent::Param(p) = bound.pat_parent[i]
                && hir[p].ty.is_some()
                && hir[p].default.is_some()
            {
                self.type_of_expr(file, hir[p].default);
            }
            if self.p.circular_pats.get(&(file, pat)).is_none() {
                continue;
            }
            // `GetErrorRangeForNode`: a parameter is not pointed at by its name, but starts where it starts, modifiers and `...` included.
            let (is_annotated, is_bare_parameter, start) = match bound.pat_parent[i] {
                PatParent::Var(d) => (hir[d].ty.is_some(), false, hir[pat].pos),
                PatParent::Param(p) => (hir[p].ty.is_some(), hir[p].default.is_none(), hir[p].pos),
                _ => (false, false, hir[pat].pos),
            };
            let code = if is_annotated { 2502 } else { 7022 };
            if is_annotated {
                out.push(Diagnostic { start, code: 2502 });
            } else if no_implicit_any && !is_bare_parameter {
                out.push(Diagnostic { start, code: 7022 });
            }
            if let PatKind::Ident(name) = hir[pat].kind {
                let end = match bound.pat_parent[i] {
                    PatParent::Param(p) => self.end_of_param(file, p),
                    _ => 0,
                };
                self.note(start, end, code, vec![self.atom_text(name)]);
            }
        }
        for i in 0..hir.members.len() {
            let member = MemberId(i as u32);
            if !matches!(
                hir[member].kind,
                MemberKind::Property | MemberKind::Getter | MemberKind::Setter
            ) {
                continue;
            }
            if hir[member].kind == MemberKind::Property {
                self.type_of_member_declaration(file, member);
                if self.p.circular_members.get(&(file, member)).is_none() {
                    continue;
                }
                if hir[member].ty.is_some() {
                    out.push(Diagnostic {
                        start: hir[member].pos,
                        code: 2502,
                    });
                    self.note_at_member_name(file, member, member, 2502);
                } else if no_implicit_any {
                    out.push(Diagnostic {
                        start: hir[member].pos,
                        code: 7022,
                    });
                    self.note_at_member_name(file, member, member, 7022);
                }
                continue;
            }
            // A getter and a setter are one property, known by whichever is written first.
            let all = match bound.member_owner[i] {
                MemberOwner::Class(c) => hir[c].members,
                MemberOwner::Interface(x) => hir[x].members,
                MemberOwner::TypeLiteral(t) => match hir[t].kind {
                    TypeNodeKind::Object(members) => members,
                    _ => continue,
                },
                MemberOwner::None => continue,
            };
            // They go together by name, as the members of a type are grouped: two names that are worked out are never the same
            // expression. One whose name could be anything stays alone.
            let name = self.member_name(file, hir[member].key);
            let is_static = hir[member].flags.contains(Flags::STATIC);
            let (mut getter, mut setter) = (None, None);
            for m in all.iter() {
                let found = match hir[m].kind {
                    MemberKind::Getter => &mut getter,
                    MemberKind::Setter => &mut setter,
                    _ => continue,
                };
                if found.is_none()
                    && hir[m].flags.contains(Flags::STATIC) == is_static
                    && (m == member || name.is_some() && self.member_name(file, hir[m].key) == name)
                {
                    *found = Some(m);
                }
            }
            let first = match (getter, setter) {
                (Some(g), Some(s)) => g.min(s),
                (Some(m), None) | (None, Some(m)) => m,
                (None, None) => continue,
            };
            if first != member {
                continue;
            }
            let both: Vec<(FileId, MemberId)> = [getter, setter]
                .into_iter()
                .flatten()
                .map(|m| (file, m))
                .collect();
            let mut both = both;
            both.sort_unstable();
            self.type_of_member_declarations(&both);
            if self.p.circular_members.get(&(file, first)).is_none() {
                continue;
            }
            let setter_is_annotated = |s: MemberId| {
                hir[hir[s].func]
                    .params
                    .iter()
                    .next()
                    .is_some_and(|p| hir[p].ty.is_some())
            };
            if let Some(g) = getter.filter(|&g| hir[hir[g].func].ret.is_some()) {
                out.push(Diagnostic {
                    start: hir[g].pos,
                    code: 2502,
                });
                self.note_at_member_name(file, g, first, 2502);
            } else if let Some(s) = setter.filter(|&s| setter_is_annotated(s)) {
                out.push(Diagnostic {
                    start: hir[s].pos,
                    code: 2502,
                });
                self.note_at_member_name(file, s, first, 2502);
            } else if let Some(g) = getter
                && no_implicit_any
            {
                out.push(Diagnostic {
                    start: hir[g].pos,
                    code: 7023,
                });
                self.note_at_member_name(file, g, first, 7023);
            }
        }
        // The circle of a composite signature is reported at its first member, which may come before the function that closes it.
        for i in 0..hir.fns.len() {
            let func = FnId(i as u32);
            if !matches!(hir[func].body, FnBody::None) && hir[func].ret.is_none() {
                self.return_type_of_fn(file, func);
            }
        }
        for i in 0..hir.fns.len() {
            let func = FnId(i as u32);
            // The accessors of classes, interfaces and type literals were seen to above, with the property they make.
            let is_literal_getter =
                hir[func].kind == FnKind::Getter && matches!(bound.fns[i].owner, FnOwner::Expr(_));
            if matches!(hir[func].body, FnBody::None) && hir[func].ret.is_none()
                || matches!(hir[func].kind, FnKind::Getter | FnKind::Setter) && !is_literal_getter
            {
                continue;
            }
            self.return_type_of_fn(file, func);
            if self.p.circular_returns.get(&(file, func)).is_none() {
                continue;
            }
            if is_literal_getter {
                // `getTypeOfAccessors`: it is the property that comes back to itself, through whichever of the two says what it is.
                let setter = self
                    .sibling_accessor(file, func, FnKind::Setter)
                    .filter(|&s| {
                        hir[s]
                            .params
                            .iter()
                            .next()
                            .is_some_and(|p| hir[p].ty.is_some())
                    });
                let (accessor, code) = match setter {
                    _ if hir[func].ret.is_some() => (func, 2502),
                    Some(setter) => (setter, 2502),
                    None if no_implicit_any => (func, 7023),
                    None => continue,
                };
                if let Some(start) = self.name_of_function(file, accessor) {
                    out.push(Diagnostic { start, code });
                    let end = self.end_of_name_at(file, start);
                    self.note(start, end, code, vec![self.source_text(file, start, end)]);
                }
                continue;
            }
            if hir[func].ret.is_some() {
                out.push(Diagnostic {
                    start: hir[hir[func].ret].pos,
                    code: 2577,
                });
                let end = self.end_of_type_node(file, hir[func].ret);
                self.note(hir[hir[func].ret].pos, end, 2577, Vec::new());
            } else if no_implicit_any {
                self.report_implicit_any_return(file, func, out);
            }
        }
        if no_implicit_any {
            self.check_circular_exports(file, out);
            self.check_circular_assignment_declarations(file, out);
        }
    }

    /// What is noted of the error `code` on the name of `member`: `symbolToString` of its symbol, which `first` declares first.
    fn note_at_member_name(&self, file: FileId, member: MemberId, first: MemberId, code: u32) {
        let name = self.source_text(
            file,
            self.hir(file)[first].pos,
            self.end_of_member_name(file, first),
        );
        let end = self.end_of_member_name(file, member);
        self.note(self.hir(file)[member].pos, end, code, vec![name]);
    }

    /// `symbol.ValueDeclaration` of the CommonJS export `symbol` of `file`: the first assignment that sets it. `None` if `symbol` has
    /// no such assignment.
    pub(super) fn commonjs_value_declaration(
        &self,
        file: FileId,
        symbol: &Symbol,
    ) -> Option<ExprId> {
        let hir = self.hir(file);
        symbol.decls.iter().find_map(|&decl| match decl {
            // `bindModuleExportsAssignment` calls `SetValueDeclaration` for every `module.exports = e`.
            Decl::ModuleExports(assignment) => Some(assignment),
            // `addDeclarationToSymbol` calls it only for a declaration with a value flag, which an alias declaration lacks.
            Decl::ExportsProperty(assignment) => match hir[assignment].kind {
                ExprKind::Assign { value, .. } if !self.expression_is_alias(file, value) => {
                    Some(assignment)
                }
                _ => None,
            },
            _ => None,
        })
    }

    /// `reportCircularityError` for `export default e`, `export = e`, `module.exports = e` and `exports.a = e`: 7022 at
    /// `symbol.ValueDeclaration`. None of these declarations has a name, so the error starts where the declaration starts.
    fn check_circular_exports(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (i, symbol) in bound.symbols.iter().enumerate() {
            // `getTypeOfAlias` reports a cycle through a symbol that is only an alias at the target of the alias.
            if !symbol
                .flags
                .intersects(SymFlags::VARIABLE | SymFlags::EXPORT_VALUE)
            {
                continue;
            }
            let start = match symbol.decls.first() {
                Some(&Decl::ExportExpr(stmt)) => hir[stmt].pos,
                Some(&(Decl::ModuleExports(_) | Decl::ExportsProperty(_))) => {
                    match self.commonjs_value_declaration(file, symbol) {
                        Some(assignment) => self.start_inside_parentheses(file, assignment),
                        None => continue,
                    }
                }
                _ => continue,
            };
            let sym = self.files().sym(file, SymbolId(i as u32));
            self.type_of_symbol(sym);
            if self.p.circular_symbols.get(&sym).is_some() {
                out.push(Diagnostic { start, code: 7022 });
                let end = match symbol.decls.first() {
                    Some(&Decl::ExportExpr(stmt)) => self.end_of_stmt(file, stmt),
                    _ => match self.commonjs_value_declaration(file, symbol) {
                        Some(assignment) => self.end_inside_parentheses(file, assignment),
                        None => 0,
                    },
                };
                self.explain_to(start, end, 7022, |c| vec![c.symbol_to_string(sym)]);
            }
        }
    }

    /// `reportCircularityError` for a property declared by `f.a = e`, `this.a = e` or `Object.defineProperty(f, "a", descriptor)`:
    /// 7022 at `symbol.ValueDeclaration`, the first declaration. `circular_assignments` is keyed by that declaration.
    fn check_circular_assignment_declarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &declaration in bound
            .expando_declarations
            .iter()
            .chain(bound.this_properties.iter().map(|property| &property.3))
        {
            // `checkPropertyAccessExpression` resolves the type of the property when it checks the left side. A call resolves it
            // only if the descriptor reads the property.
            let checked = match hir[declaration].kind {
                ExprKind::Assign { target, .. } => target,
                _ => declaration,
            };
            self.type_of_expr(file, checked);
            if self
                .p
                .circular_assignments
                .get(&(file, declaration))
                .is_some()
            {
                let start = self.start_inside_parentheses(file, declaration);
                out.push(Diagnostic { start, code: 7022 });
                // `GetNameOfDeclaration`
                let name = match hir[checked].kind {
                    ExprKind::Dot { name, .. } => self.atom_text(name),
                    ExprKind::Index { index, .. } => self.source_text(
                        file,
                        self.start_inside_parentheses(file, index),
                        self.end_inside_parentheses(file, index),
                    ),
                    _ => continue,
                };
                let end = self.end_inside_parentheses(file, declaration);
                self.note(start, end, 7022, vec![name]);
            }
        }
    }

    /// `getTypeOfMappedSymbol`: 2615 at `c.currentNode`, the type node being checked when the type of a property of a mapped type
    /// turns out to depend on itself.
    fn check_circular_mapped_properties(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `checkSourceElement` makes each type node the current node, checks its children, then resolves the node. Children have
        // lower ids.
        for n in 0..hir.types.len() {
            let node = TypeNodeId(n as u32);
            if bound.type_scope[n].is_some() && self.is_resolved_by_check(file, node) {
                self.type_from_node(file, node);
            }
        }
        if self.p.circular_mapped_props.len() == 0 {
            return;
        }
        for (n, node) in hir.types.iter().enumerate() {
            if self
                .p
                .circular_mapped_props
                .get(&(file, TypeNodeId(n as u32)))
                .is_some()
            {
                out.push(Diagnostic {
                    start: node.pos,
                    code: 2615,
                });
                // Which property of which mapped type is not kept.
                let end = self.end_of_type_node(file, TypeNodeId(n as u32));
                self.note(node.pos, end, 2615, Vec::new());
            }
        }
    }

    /// `getNameOfDeclaration`: where the name of `func` is: its own or, for a function expression that has none, that of what it is
    /// given to (`GetAssignedName`).
    fn name_of_function(&self, file: FileId, func: FnId) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let e = match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => return Some(hir[m].pos),
            _ if hir[func].name.is_some() => return Some(hir[func].name_pos),
            FnOwner::Expr(e) => e,
            _ => return None,
        };
        let is_in_parentheses =
            |x: ExprId| hir.parens.binary_search_by_key(&x.0, |p| p.0.0).is_ok();
        match bound.expr_parent[e.idx()] {
            // A method or an accessor of an object literal, under a name that is worked out.
            Parent::Prop(p)
                if matches!(
                    hir[p].kind,
                    PropKind::Method | PropKind::Getter | PropKind::Setter
                ) =>
            {
                Some(hir[p].pos)
            }
            // What is in parentheses is given to nothing.
            _ if is_in_parentheses(e) => None,
            Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => {
                Some(hir[hir[d].pat].pos)
            }
            // Not the attribute of a JSX element.
            Parent::Prop(p)
                if hir[p].kind == PropKind::Init
                    && matches!(hir[bound.prop_owner[p.idx()]].kind, ExprKind::Object(_)) =>
            {
                Some(hir[p].pos)
            }
            Parent::PatPropDefault(p) => Some(hir[hir[p].value].pos),
            Parent::PatElemDefault(p) => Some(hir[hir[p].pat].pos),
            // On the right of any operator.
            Parent::Expr(outer) => {
                let (ExprKind::Assign {
                    target: left,
                    value: right,
                    ..
                }
                | ExprKind::Binary { left, right, .. }) = hir[outer].kind
                else {
                    return None;
                };
                if right != e || is_in_parentheses(left) {
                    return None;
                }
                match hir[left].kind {
                    ExprKind::Ident(_) => Some(hir[left].pos),
                    ExprKind::Dot { name_pos, .. } => Some(name_pos),
                    ExprKind::Index { index, .. }
                        if matches!(hir[index].kind, ExprKind::String(_) | ExprKind::Number(_)) =>
                    {
                        Some(hir[index].pos)
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// `getReturnTypeOfSignature`: 7023 at the name of a function whose result depends on itself, 7024 at one that has none.
    pub(super) fn report_implicit_any_return(
        &self,
        file: FileId,
        func: FnId,
        out: &mut Vec<Diagnostic>,
    ) {
        match self.name_of_function(file, func) {
            Some(start) => {
                out.push(Diagnostic { start, code: 7023 });
                let end = self.end_of_name_at(file, start);
                self.note(start, end, 7023, vec![self.source_text(file, start, end)]);
            }
            None => {
                let start = self.hir(file)[func].pos;
                out.push(Diagnostic { start, code: 7024 });
                if let FnOwner::Expr(e) = self.bound(file).fns[func.idx()].owner {
                    let end = self.error_end_inside_parentheses(file, e);
                    self.note(start, end, 7024, Vec::new());
                }
            }
        }
    }

    /// `getBaseConstructorTypeOfClass`: whether the class `own` comes back to itself by way of what is written after `extends`. One
    /// base each: round and back, or never.
    pub(super) fn extends_itself_as_written(&self, own: Sym) -> bool {
        let mut at = own;
        for _ in 0..64 {
            let Some(next) = self.base_class_written(at) else {
                return false;
            };
            if next == own {
                return true;
            }
            at = next;
        }
        false
    }

    /// `getBaseTypes`: whether the base types of the class or interface `own` were asked for again while they were worked out.
    /// Every class declaration and every interface of that name is told, whichever of them extends what.
    fn is_own_base(&mut self, own: Sym) -> bool {
        // A base constructor that comes back to itself is the error type, and there it ends.
        if self.extends_itself_as_written(own) {
            return false;
        }
        self.base_types(own);
        if self.p.circular_bases.get(&own).is_some() {
            return true;
        }
        let mut seen = Vec::new();
        let mut todo = self.base_types_written(own);
        while let Some(next) = todo.pop() {
            if next == own {
                return true;
            }
            if !seen.contains(&next) {
                seen.push(next);
                todo.extend(self.base_types_written(next));
            }
        }
        false
    }

    /// The class `class` says it extends, if it says so by name.
    fn base_class_written(&self, class: Sym) -> Option<Sym> {
        let files = self.files();
        let (of, c) = files.decls(class).into_iter().find_map(|(of, d)| match d {
            Decl::Class(c) => Some((of, c)),
            _ => None,
        })?;
        let hir = self.hir(of);
        let mut names = Vec::new();
        let mut e = hir[c].extends;
        if e.is_none() {
            return None;
        }
        loop {
            match hir[e].kind {
                ExprKind::Ident(name) => {
                    names.push(name);
                    break;
                }
                ExprKind::Dot { obj, name, .. } => {
                    names.push(name);
                    e = obj;
                }
                _ => return None,
            }
        }
        names.reverse();
        let found = files.resolve_entity(
            of,
            self.bound(of).class_scope[c.idx()],
            &names,
            SymFlags::VALUE,
        )?;
        let found = files.resolve_alias_if_needed(found)?;
        files
            .flags(found)
            .contains(SymFlags::CLASS)
            .then_some(found)
    }

    /// The classes and interfaces that the declarations of `sym` say they extend.
    fn base_types_written(&self, sym: Sym) -> Vec<Sym> {
        let files = self.files();
        let mut bases = Vec::new();
        for (of, decl) in files.decls(sym) {
            match decl {
                Decl::Interface(i) => {
                    let (hir, bound) = (self.hir(of), self.bound(of));
                    for node in hir.ids(hir[i].extends) {
                        let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
                            continue;
                        };
                        let names: Vec<Atom> = hir.ids(name).collect();
                        if let Some(found) = files
                            .resolve_entity(
                                of,
                                bound.type_scope[node.idx()],
                                &names,
                                SymFlags::TYPE,
                            )
                            .and_then(|s| files.resolve_alias_if_needed(s))
                            && files
                                .flags(found)
                                .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
                        {
                            bases.push(found);
                        }
                    }
                }
                Decl::Class(_) if !self.extends_itself_as_written(sym) => {
                    bases.extend(self.base_class_written(sym))
                }
                _ => {}
            }
        }
        bases
    }

    /// `hasNonCircularBaseConstraint`, the other way round and going by what is written: whether what the type parameter `own`
    /// extends comes back to it, by way of what `type_parameters_written` finds in each constraint. One that only leads to a circle
    /// is not in it.
    pub(super) fn is_constraint_circular(&self, file: FileId, own: TypeParamId) -> bool {
        let hir = self.hir(file);
        if hir[own].constraint.is_none() {
            return false;
        }
        let (mut seen, mut todo) = (Vec::new(), Vec::new());
        self.type_parameters_written(file, hir[own].constraint, &mut todo);
        while let Some(next) = todo.pop() {
            if next == own {
                return true;
            }
            if !seen.contains(&next) {
                seen.push(next);
                if hir[next].constraint.is_some() {
                    self.type_parameters_written(file, hir[next].constraint, &mut todo);
                }
            }
        }
        false
    }

    /// The type parameters a constraint comes down to: itself, the members of a union or an intersection, and the keys of the mapped
    /// types that are made with it.
    fn type_parameters_written(&self, file: FileId, node: TypeNodeId, into: &mut Vec<TypeParamId>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[node].kind {
            TypeNodeKind::Ref { name, args } if args.is_empty() && name.len() == 1 => {
                let found = self.files().resolve_name(
                    file,
                    bound.type_scope[node.idx()],
                    hir.id_at(name, 0),
                    SymFlags::TYPE,
                );
                if let Some(found) = found
                    && found.file == file
                    && let Some(&Decl::TypeParam(p)) = self.files().symbol(found).decls.first()
                {
                    into.push(p);
                }
            }
            // `computeBaseConstraint` goes by the type: of `T | unknown` or `T & never` no `T` is left.
            TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types)
                if keyword_it_comes_to(hir, node).is_none() =>
            {
                for t in hir.ids(types) {
                    self.type_parameters_written(file, t, into);
                }
            }
            _ => self.mapped_keys_made_at_once(file, node, into),
        }
    }

    /// `getTypeFromMappedTypeNode` resolves the constraint of its key as soon as the type is made: the keys of the mapped types that
    /// are made together with `node`, which is in a constraint, where nothing is put off (`isDeferredTypeReferenceNode`). Members,
    /// signatures, the templates of mapped types and what they rename to wait.
    fn mapped_keys_made_at_once(
        &self,
        file: FileId,
        node: TypeNodeId,
        into: &mut Vec<TypeParamId>,
    ) {
        if node.is_none() {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[node].kind {
            TypeNodeKind::Mapped(m) => into.push(hir[m].param),
            TypeNodeKind::Array(t) | TypeNodeKind::Keyof(t) | TypeNodeKind::Readonly(t) => {
                self.mapped_keys_made_at_once(file, t, into)
            }
            TypeNodeKind::Tuple(elems) => {
                for e in elems.iter() {
                    self.mapped_keys_made_at_once(file, hir[e].ty, into);
                }
            }
            TypeNodeKind::Ref { name, args } => {
                if args.is_empty() {
                    return;
                }
                // `getTypeFromClassOrInterfaceReference`, `getTypeFromTypeAliasReference`: the wrong number of type arguments is an
                // error, and they are not looked at. Those of a name that means nothing are.
                let files = self.files();
                let names: Vec<Atom> = hir.ids(name).collect();
                let named = files
                    .resolve_entity(file, bound.type_scope[node.idx()], &names, SymFlags::TYPE)
                    .and_then(|s| files.resolve_alias_if_needed(s));
                if let Some(named) = named {
                    let (least, most) = self.type_argument_arity(named);
                    if !(least..=most).contains(&args.len()) {
                        return;
                    }
                }
                for t in hir.ids(args) {
                    self.mapped_keys_made_at_once(file, t, into);
                }
            }
            TypeNodeKind::Union(list)
            | TypeNodeKind::Intersection(list)
            | TypeNodeKind::Template { types: list, .. }
            | TypeNodeKind::Typeof { args: list, .. } => {
                for t in hir.ids(list) {
                    self.mapped_keys_made_at_once(file, t, into);
                }
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.mapped_keys_made_at_once(file, obj, into);
                self.mapped_keys_made_at_once(file, index, into);
            }
            // Which branch is taken, if any, is not a matter of how it is written.
            TypeNodeKind::Cond { check, extends, .. } => {
                self.mapped_keys_made_at_once(file, check, into);
                self.mapped_keys_made_at_once(file, extends, into);
            }
            _ => {}
        }
    }
}

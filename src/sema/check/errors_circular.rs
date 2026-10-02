//! What comes back to itself: 2313 2615, and 2502 2577 7022 7023 7024.
//!
//! In TypeScript 7.0.2's checker.go these fall out of `pushTypeResolution` finding what is asked for already under way, in
//! `getBaseConstructorTypeOfClass`, `getBaseTypes` and `getResolvedBaseConstraint`: everything from there to the top of the stack
//! is in the circle, and what only leads to it is not. Here the circles are looked for in what is written, and among those that
//! `Checker::enter` came upon when the types were asked for.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, Symbol, SymbolId};
use smallvec::SmallVec;

type TypeParams = SmallVec<[TypeParamId; 8]>;

/// Whether `mapped_keys_made_at_once` has anything to find in `node`, however many type arguments the names in it take.
fn is_mapped_type_written_in(hir: &hir::File, node: TypeNodeId) -> bool {
    if node.is_none() {
        return false;
    }
    match hir[node].kind {
        TypeNodeKind::Mapped(_) => true,
        TypeNodeKind::Array(t) | TypeNodeKind::Keyof(t) | TypeNodeKind::Readonly(t) => {
            is_mapped_type_written_in(hir, t)
        }
        TypeNodeKind::Tuple(elems) => elems
            .iter()
            .any(|e| is_mapped_type_written_in(hir, hir[e].ty)),
        TypeNodeKind::Ref { args: list, .. }
        | TypeNodeKind::Union(list)
        | TypeNodeKind::Intersection(list)
        | TypeNodeKind::Template { types: list, .. }
        | TypeNodeKind::Typeof { args: list, .. } => {
            hir.ids(list).any(|t| is_mapped_type_written_in(hir, t))
        }
        TypeNodeKind::IndexedAccess { obj, index } => {
            is_mapped_type_written_in(hir, obj) || is_mapped_type_written_in(hir, index)
        }
        TypeNodeKind::Cond { check, extends, .. } => {
            is_mapped_type_written_in(hir, check) || is_mapped_type_written_in(hir, extends)
        }
        _ => false,
    }
}

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
        self.check_circular_resolutions(file);
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `checkClassLikeDeclaration`, `checkInterfaceDeclaration`
        for c in 0..hir.classes.len() {
            if bound.class_symbol[c].is_some() {
                let own = self.class_sym(file, ClassId(c as u32));
                self.base_constructor_type_of_class(own);
                self.base_types(own);
            }
        }
        for &symbol in bound.interface_symbol.iter().filter(|s| s.is_some()) {
            let own = self.files().sym(file, symbol);
            self.base_types(own);
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
                self.relate(start, 2313, |c| {
                    c.origin_of_circular_constraint(file, own, start, end)
                });
            }
        }
    }

    /// `getResolvedBaseConstraint`: 2313, of the key of the mapped type at `mapped`, which had to be known to tell whether `extending`
    /// can extend the type. `c.currentNode` is `extending`, which is being checked.
    pub(super) fn report_circular_mapped_key(
        &mut self,
        file: FileId,
        mapped: TypeNodeId,
        extending: (FileId, Decl),
    ) {
        let hir = self.hir(file);
        let TypeNodeKind::Mapped(m) = hir[mapped].kind else {
            return;
        };
        let param = &hir[hir[m].param];
        // `GetDiagnostics` reads what is said of a file when it has checked the file, in the order of the program. What the check of a
        // later file says of it is never read.
        let files = self.files();
        let order = |f: FileId| (!files.module(f).is_lib, files.rank_of_file(f));
        if param.constraint.is_none() || order(extending.0) > order(file) {
            return;
        }
        let start = start_of_constraint(hir, param.constraint);
        let end = self.end_of_type_node_from(file, param.constraint, start);
        let mut err = self.new_diagnostic((file, start, end), 2313, &[Arg::Atom(param.name)]);
        if let (of, Decl::Interface(i)) = extending {
            // `isNodeDescendantOf`
            let is_written_in_it = of == file
                && (hir[hir[i].stmt].pos..self.end_of_stmt(file, hir[i].stmt))
                    .contains(&hir[mapped].pos);
            if !is_written_in_it {
                let at = self.place_of_token(of, self.hir(of)[i].name_pos);
                let origin = self.new_diagnostic(at, 2751, &[]);
                err.add_related_info(origin);
            }
        }
        self.add_diagnostic(err);
    }

    /// Asks for the types that `reportCircularityError`, `getReturnTypeOfSignature` and `getTypeOfAccessors` report circles of.
    fn check_circular_resolutions(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
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
        }
        for i in 0..hir.members.len() {
            let member = MemberId(i as u32);
            if !matches!(
                hir[member].kind,
                MemberKind::Property | MemberKind::Getter | MemberKind::Setter
            ) {
                continue;
            }
            // `getTypeOfSymbol`: the properties and accessors among the declarations of one symbol are one property, known by the
            // first.
            let all: SmallVec<[(FileId, MemberId); 2]> =
                if bound.member_owner[i] == MemberOwner::None {
                    SmallVec::new()
                } else {
                    self.declarations_of_member(file, Decl::Member(member))
                        .iter()
                        .filter_map(|&(of, declaration)| match declaration {
                            Decl::Member(m)
                                if matches!(
                                    self.hir(of)[m].kind,
                                    MemberKind::Property | MemberKind::Getter | MemberKind::Setter
                                ) =>
                            {
                                Some((of, m))
                            }
                            _ => None,
                        })
                        .collect()
                };
            if all.first() == Some(&(file, member)) {
                self.type_of_member_declarations(&all);
            } else if hir[member].kind == MemberKind::Property {
                self.type_of_member_declaration(file, member);
            }
        }
        for i in 0..hir.fns.len() {
            let func = FnId(i as u32);
            // An accessor of a class, an interface or a type literal that says what it is was asked above, with the property it makes.
            let is_member = matches!(hir[func].kind, FnKind::Getter | FnKind::Setter)
                && !(hir[func].kind == FnKind::Getter
                    && matches!(bound.fns[i].owner, FnOwner::Expr(_)));
            if hir[func].ret.is_some() && !is_member
                || hir[func].ret.is_none() && !matches!(hir[func].body, FnBody::None)
            {
                self.return_type_of_fn(file, func);
            }
        }
        self.check_circular_exports(file);
        self.check_circular_assignment_declarations(file);
    }

    /// The end of `getTypeOfAccessors`, where `popTypeResolution` finds the circle. `members`: the declarations of the property.
    pub(super) fn report_circular_accessors(&mut self, members: &[(FileId, MemberId)]) {
        let of_kind = |kind: MemberKind| {
            members
                .iter()
                .copied()
                .find(|&(file, m)| self.hir(file)[m].kind == kind)
        };
        let (getter, setter) = (of_kind(MemberKind::Getter), of_kind(MemberKind::Setter));
        // `getAnnotatedAccessorTypeNode`
        let annotated_getter = getter.filter(|&(file, g)| {
            let hir = self.hir(file);
            hir[hir[g].func].ret.is_some()
        });
        let annotated_setter = setter.filter(|&(file, s)| {
            let hir = self.hir(file);
            let first = hir[hir[s].func].params.iter().next();
            first.is_some_and(|p| hir[p].ty.is_some())
        });
        let auto_accessor = of_kind(MemberKind::Property);
        // `symbolToString`
        let (file, first) = members[0];
        let end = self.end_of_member_name(file, first);
        let name = self.source_text(file, self.hir(file)[first].name_pos, end);
        let ((file, accessor), code) = match (annotated_getter, annotated_setter) {
            (Some(getter), _) => (getter, 2502),
            (None, Some(setter)) => (setter, 2502),
            // It goes to the set accessor, which is nil.
            _ if auto_accessor.is_some_and(|(file, m)| self.hir(file)[m].ty.is_some()) => {
                return self.report_global_error(2502, vec![name]);
            }
            _ => match getter {
                Some(getter) if self.p.files.options.no_implicit_any => (getter, 7023),
                _ => return,
            },
        };
        let at = (
            file,
            self.hir(file)[accessor].name_pos,
            self.end_of_member_name(file, accessor),
        );
        let err = self.new_diagnostic(at, code, &[Arg::Text(&name)]);
        self.commit(err);
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
                ExprKind::Assign { value, .. } if !expression_is_alias(self.hir(file), value) => {
                    Some(assignment)
                }
                _ => None,
            },
            _ => None,
        })
    }

    /// `checkExportAssignment`, `checkBinaryLikeExpression`: the types of `export default e`, `export = e`, `module.exports = e` and
    /// `exports.a = e` are asked for.
    fn check_circular_exports(&mut self, file: FileId) {
        for (i, symbol) in self.bound(file).symbols.iter().enumerate() {
            if symbol
                .flags
                .intersects(SymFlags::VARIABLE | SymFlags::PROPERTY)
                && matches!(
                    symbol.decls.first(),
                    Some(Decl::ExportExpr(_) | Decl::ModuleExports(_) | Decl::ExportsProperty(_))
                )
            {
                let sym = self.files().sym(file, SymbolId(i as u32));
                self.type_of_symbol(sym);
            }
        }
    }

    /// `checkPropertyAccessExpression` resolves the type of a property declared by `f.a = e` or `this.a = e` when it checks the left
    /// side. `Object.defineProperty(f, "a", descriptor)` resolves it only if the descriptor reads the property.
    fn check_circular_assignment_declarations(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &declaration in bound
            .expando_declarations
            .iter()
            .chain(bound.this_properties.iter().map(|property| &property.3))
        {
            let checked = match hir[declaration].kind {
                ExprKind::Assign { target, .. } => target,
                _ => declaration,
            };
            self.type_of_expr(file, checked);
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
            if !bound.is_unchecked_type(n) && self.is_resolved_by_check(file, node) {
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
                // A variable of that type that is read while the file is emitted makes the type first.
                let made = self.type_from_node(file, TypeNodeId(n as u32));
                // Under whichever alias: the keys of the mapped type, which lead into the circle, are the same.
                let made = self.intern(self.data(made).clone());
                let variable = if matches!(self.data(made), TypeData::Anon { .. }) {
                    self.first_variable_read_by_emit(file, |c, ty| {
                        c.intern(c.data(ty).clone()) == made
                    })
                } else {
                    None
                };
                let (start, end) = match variable {
                    Some(at) => (at, self.end_of_token_at(file, at)),
                    None => (node.pos, self.end_of_type_node(file, TypeNodeId(n as u32))),
                };
                out.push(Diagnostic { start, code: 2615 });
                let names = &self.p.circular_mapped_prop_names;
                let named = names.get(&(file, TypeNodeId(n as u32)));
                self.explain_to(start, end, 2615, |c| match named {
                    Some((mapped, name)) => vec![
                        match c.prop_of(mapped, name) {
                            Some((prop, _)) => c.prop_to_string(&prop),
                            None => c.atom_text(name),
                        },
                        c.type_to_string(mapped),
                    ],
                    None => Vec::new(),
                });
            }
        }
    }

    /// `getNameOfDeclaration`: where the name of `func` is: its own or, for a function expression that has none, that of what it is
    /// given to (`GetAssignedName`).
    fn name_of_function(&self, file: FileId, func: FnId) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let e = match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => return Some(hir[m].name_pos),
            _ if hir[func].name.is_some() => return Some(hir[func].name_pos),
            FnOwner::Expr(e) => e,
            _ => return None,
        };
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
            _ => bound.get_assigned_name(hir, e),
        }
    }

    /// The end of `getReturnTypeOfSignature`, where `popTypeResolution` finds the circle: 2577, 7023 at the name of the function, 7024
    /// at one that has none. Of a getter of an object literal it is the end of `getTypeOfAccessors`.
    pub(super) fn report_circular_return_type(&mut self, file: FileId, func: FnId) {
        self.p.circular_returns.insert((file, func), ());
        let (hir, bound) = (self.hir(file), self.bound(file));
        let no_implicit_any = self.p.files.options.no_implicit_any;
        let owner = bound.fns[func.idx()].owner;
        let named = |c: &mut Self, of: FnId, code: u32| {
            if let Some(start) = c.name_of_function(file, of) {
                let end = c.end_of_name_at(file, start);
                let name = c.source_text(file, start, end);
                let err = c.new_diagnostic((file, start, end), code, &[Arg::Text(&name)]);
                c.commit(err);
                return true;
            }
            false
        };
        if matches!(hir[func].kind, FnKind::Getter | FnKind::Setter) {
            // The accessors of classes, interfaces and type literals are reported with the property they make.
            if hir[func].kind == FnKind::Getter && matches!(owner, FnOwner::Expr(_)) {
                let setter = self
                    .sibling_accessor(file, func, FnKind::Setter)
                    .filter(|&s| {
                        let first = hir[s].params.iter().next();
                        first.is_some_and(|p| hir[p].ty.is_some())
                    });
                match setter {
                    _ if hir[func].ret.is_some() => named(self, func, 2502),
                    Some(setter) => named(self, setter, 2502),
                    None => no_implicit_any && named(self, func, 7023),
                };
            }
        } else if hir[func].ret.is_some() {
            let ret = hir[func].ret;
            let at = (file, hir[ret].pos, self.end_of_type_node(file, ret));
            let err = self.new_diagnostic(at, 2577, &[]);
            self.commit(err);
        } else if no_implicit_any
            && !matches!(hir[func].body, FnBody::None)
            && !named(self, func, 7023)
        {
            let start = hir[func].pos;
            let end = match owner {
                FnOwner::Expr(e) => self.error_end_inside_parentheses(file, e),
                _ => self.end_of_token_at(file, start),
            };
            let err = self.new_diagnostic((file, start, end), 7024, &[]);
            self.commit(err);
        }
    }

    /// A file is emitted before it is checked: `markPropertyAliasReferenced` takes the type of the `a` of every `a.b`, then
    /// `GetConstantValue` that of every `a.b` and `a[b]`. Where the first `a`, in that order, is that is a name and `is_it` holds for
    /// the type of.
    fn first_variable_read_by_emit(
        &mut self,
        file: FileId,
        mut is_it: impl FnMut(&mut Self, TypeId) -> bool,
    ) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let options = &self.p.files.options;
        if options.no_emit_is_set || options.isolated_modules || hir.kind == FileKind::Declaration {
            return None;
        }
        let index = self.exprs_by_kind(file);
        // Whether it is only looked at the second time round, and where it is.
        let mut first: Option<(bool, u32)> = None;
        for (tag, is_second) in [(ExprTag::Dot, hir.is_js), (ExprTag::Index, true)] {
            for &e in index.of(tag) {
                let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[e].kind else {
                    continue;
                };
                let at = (is_second, hir[obj].pos);
                if !matches!(hir[obj].kind, ExprKind::Ident(_))
                    || bound.is_unchecked(e.idx())
                    || bound.is_in_type_query(e)
                    || first.is_some_and(|first| first <= at)
                {
                    continue;
                }
                let ty = self.type_of_expr(file, obj);
                if is_it(self, ty) {
                    first = Some(at);
                }
            }
        }
        first.map(|first| first.1)
    }

    /// `getResolvedBaseConstraint`: `c.currentNode` when the circle the type parameter `own` is in is first come upon, unless that is in
    /// what `own` extends, which is written from `start` to `end`, or around it.
    fn origin_of_circular_constraint(
        &mut self,
        file: FileId,
        own: TypeParamId,
        start: u32,
        end: u32,
    ) -> Vec<super::explain::Related> {
        // `getNarrowableTypeForReference` asks what the type of a variable extends.
        let variable = self.first_variable_read_by_emit(file, |c, ty| {
            matches!(
                *c.data(ty),
                TypeData::TypeParam(of, declared, around)
                    if of == file
                        && around == MapperId::IDENTITY
                        && c.constraint_leads_to(file, declared, own)
            )
        });
        let at = match variable {
            Some(at) => Some(self.place_of_token(file, at)),
            None => self
                .first_reference_that_makes_mapped_key(file, own)
                .map(|node| {
                    let from = self.hir(file)[node].pos;
                    (file, from, self.end_of_type_node(file, node))
                })
                .filter(|&(_, from, to)| {
                    !(start..end).contains(&from) && !(from..to).contains(&start)
                }),
        };
        at.map(|at| super::explain::Related {
            at: Some(at),
            code: 2751,
            args: Vec::new(),
        })
        .into_iter()
        .collect()
    }

    /// Whether `from` is `to`, or what it extends leads there, going by what is written as `is_constraint_circular` does.
    fn constraint_leads_to(&self, file: FileId, from: TypeParamId, to: TypeParamId) -> bool {
        let hir = self.hir(file);
        let (mut seen, mut todo) = (TypeParams::new(), TypeParams::new());
        todo.push(from);
        while let Some(next) = todo.pop() {
            if next == to {
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

    /// `getTypeFromMappedTypeNode` resolves the constraint of its key as soon as the type is made. For `own`, the key of a mapped type
    /// that is written in a type alias, that is when the first type reference that leads to the alias is checked. Children have lower
    /// ids and are checked first.
    fn first_reference_that_makes_mapped_key(
        &self,
        file: FileId,
        own: TypeParamId,
    ) -> Option<TypeNodeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.mapped.iter().any(|m| m.param == own) {
            return None;
        }
        let written = hir[hir[own].constraint].pos;
        let around = hir.aliases.iter().position(|alias| {
            alias.ty.is_some()
                && (hir[alias.ty].pos..self.end_of_type_node(file, alias.ty)).contains(&written)
        })?;
        if bound.alias_symbol[around].is_none() {
            return None;
        }
        let alias = self.files().sym(file, bound.alias_symbol[around]);
        (0..hir.types.len() as u32).map(TypeNodeId).find(|&node| {
            self.alias_referred_to(file, node)
                .is_some_and(|named| self.alias_leads_to(named, alias, &mut Vec::new()))
        })
    }

    /// The type alias the type reference `node` names.
    fn alias_referred_to(&self, file: FileId, node: TypeNodeId) -> Option<Sym> {
        let (hir, files) = (self.hir(file), self.files());
        let scope = self.bound(file).type_scope[node.idx()];
        let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
            return None;
        };
        if scope.is_none() {
            return None;
        }
        let names: SmallVec<[Atom; 4]> = hir.ids(name).collect();
        let named = files
            .resolve_entity(file, scope, &names, SymFlags::TYPE)
            .and_then(|s| files.resolve_alias_if_needed(s))?;
        files
            .flags(named)
            .contains(SymFlags::TYPE_ALIAS)
            .then_some(named)
    }

    /// Whether making what the type alias `from` stands for makes what `to` stands for.
    fn alias_leads_to(&self, from: Sym, to: Sym, seen: &mut Vec<Sym>) -> bool {
        if from == to {
            return true;
        }
        if seen.contains(&from) {
            return false;
        }
        seen.push(from);
        let mut named = Vec::new();
        for &(file, decl) in self.files().decls_of(from).iter() {
            if let Decl::Alias(a) = decl {
                self.aliases_made_at_once(file, self.hir(file)[a].ty, &mut named);
            }
        }
        named
            .into_iter()
            .any(|next| self.alias_leads_to(next, to, seen))
    }

    /// The type aliases referred to in what is resolved as soon as the type at `node` is made, as in `mapped_keys_made_at_once`: of a
    /// mapped type what its key extends.
    fn aliases_made_at_once(&self, file: FileId, node: TypeNodeId, into: &mut Vec<Sym>) {
        if node.is_none() {
            return;
        }
        let hir = self.hir(file);
        match hir[node].kind {
            TypeNodeKind::Mapped(m) => {
                self.aliases_made_at_once(file, hir[hir[m].param].constraint, into)
            }
            TypeNodeKind::Array(t) | TypeNodeKind::Keyof(t) | TypeNodeKind::Readonly(t) => {
                self.aliases_made_at_once(file, t, into)
            }
            TypeNodeKind::Tuple(elems) => {
                for e in elems.iter() {
                    self.aliases_made_at_once(file, hir[e].ty, into);
                }
            }
            TypeNodeKind::Ref { args, .. } => {
                into.extend(self.alias_referred_to(file, node));
                for t in hir.ids(args) {
                    self.aliases_made_at_once(file, t, into);
                }
            }
            TypeNodeKind::Union(list)
            | TypeNodeKind::Intersection(list)
            | TypeNodeKind::Template { types: list, .. } => {
                for t in hir.ids(list) {
                    self.aliases_made_at_once(file, t, into);
                }
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.aliases_made_at_once(file, obj, into);
                self.aliases_made_at_once(file, index, into);
            }
            TypeNodeKind::Cond { check, extends, .. } => {
                self.aliases_made_at_once(file, check, into);
                self.aliases_made_at_once(file, extends, into);
            }
            _ => {}
        }
    }

    /// `hasNonCircularBaseConstraint`, the other way round and going by what is written: whether what the type parameter `own`
    /// extends comes back to it, by way of what `type_parameters_written` finds in each constraint. One that only leads to a circle
    /// is not in it.
    pub(super) fn is_constraint_circular(&self, file: FileId, own: TypeParamId) -> bool {
        let hir = self.hir(file);
        if hir[own].constraint.is_none() {
            return false;
        }
        let (mut seen, mut todo) = (TypeParams::new(), TypeParams::new());
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
    fn type_parameters_written(&self, file: FileId, node: TypeNodeId, into: &mut TypeParams) {
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
    fn mapped_keys_made_at_once(&self, file: FileId, node: TypeNodeId, into: &mut TypeParams) {
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
                if !hir.ids(args).any(|t| is_mapped_type_written_in(hir, t)) {
                    return;
                }
                // `getTypeFromClassOrInterfaceReference`, `getTypeFromTypeAliasReference`: the wrong number of type arguments is an
                // error, and they are not looked at. Those of a name that means nothing are.
                let files = self.files();
                let names: SmallVec<[Atom; 4]> = hir.ids(name).collect();
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

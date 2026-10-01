//! Declarations that are out of place or at odds with each other:
//! 2369 2370 2371 2463, 2372 2373, 2302, 2428, 2440, 2507, 2374, 2717 2403.
//!
//! Follows `checkParameter`, the end of `onSuccessfullyResolvedSymbol`, `checkTypeParameterListsIdentical`, `checkAliasSymbol`,
//! `getSymbolFlags`, `getExternalModuleMember`, `getBaseConstructorTypeOfClass`, `checkTypeForDuplicateIndexSignatures` and
//! `checkVariableLikeDeclaration` of TypeScript 7.0.2's checker.go, and `Resolve` of its nameresolver.go.

use super::errors::Diagnostic;
use super::errors_order::Named;
use super::*;
use crate::bind::{Decl, FnOwner, Parent, PatParent, SymbolId};
use smallvec::SmallVec;

const PROPERTY: u8 = 1 << 0;
const METHOD: u8 = 1 << 1;
const GET_ACCESSOR: u8 = 1 << 2;
const SET_ACCESSOR: u8 = 1 << 3;
const ACCESSOR: u8 = GET_ACCESSOR | SET_ACCESSOR;

/// A member of a class, an interface or a type literal, or a parameter property (`member` is `NONE`), as the binder declares it.
#[derive(Copy, Clone)]
struct DeclaredMember {
    name: Atom,
    is_static: bool,
    /// Its name has to be worked out.
    is_late: bool,
    /// The how manieth it is.
    order: u32,
    includes: u8,
    excludes: u8,
    file: FileId,
    member: MemberId,
    param: ParamId,
    /// From the type parameters of the declaration it is written in to those the whole goes by.
    mapper: MapperId,
}

impl Checker<'_> {
    pub(super) fn check_declarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        self.check_parameters(file, out);
        self.check_parameter_references(file, out);
        self.check_static_type_parameter_references(file, out);
        self.check_merged_declarations(file, out);
        self.check_subsequent_property_declarations(file, out);
        self.check_base_constructors(file, out);
        self.check_index_signatures(file, out);
    }

    /// `checkParameter`
    fn check_parameters(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for f in 0..hir.fns.len() {
            let func = &hir.fns[f];
            if matches!(bound.fns[f].owner, FnOwner::None) {
                continue;
            }
            // `NodeIsPresent(fn.Body())`: written, whether or not it is kept.
            let has_body =
                !matches!(func.body, FnBody::None) || func.flags.contains(Flags::BODY_DROPPED);
            for p in func.params.iter() {
                let param = &hir[p];
                if param.flags.contains(Flags::PARAMETER_PROPERTY)
                    && !(func.kind == FnKind::Constructor && has_body)
                {
                    out.push(Diagnostic {
                        start: param.pos,
                        code: 2369,
                    });
                    let end = self.end_of_param(file, p);
                    self.explain_to(param.pos, end, 2369, |_| vec![]);
                }
                // A leading `this` parameter is `this_ty`, so one listed in `params` is never the first.
                if matches!(hir[param.pat].kind, PatKind::Ident(known::this)) {
                    out.push(Diagnostic {
                        start: param.pos,
                        code: 2680,
                    });
                    let end = self.end_of_param(file, p);
                    self.explain_to(param.pos, end, 2680, |_| vec!["this".to_owned()]);
                }
                if !has_body {
                    self.check_element_initializers(file, param.pat, out);
                    if param.default.is_some() {
                        out.push(Diagnostic {
                            start: param.pos,
                            code: 2371,
                        });
                        let end = self.end_of_param(file, p);
                        self.explain_to(param.pos, end, 2371, |_| vec![]);
                    }
                }
                let is_pattern =
                    matches!(hir[param.pat].kind, PatKind::Object(_) | PatKind::Array(_));
                // `fn.Body() != nil`, which holds for a block whose `{` is missing.
                let is_body_non_nil = has_body || func.flags.contains(Flags::MISSING_BODY);
                if param.default.is_none()
                    && param.flags.contains(Flags::OPTIONAL)
                    && is_pattern
                    && is_body_non_nil
                {
                    out.push(Diagnostic {
                        start: param.pos,
                        code: 2463,
                    });
                    let end = self.end_of_param(file, p);
                    self.explain_to(param.pos, end, 2463, |_| vec![]);
                }
                if param.flags.contains(Flags::REST) && !is_pattern {
                    let mut ty = self.type_of_param(file, p);
                    // `assignParameterType`: by the time it is checked, a parameter of a context sensitive function expression has
                    // had its `?` added.
                    if param.flags.contains(Flags::OPTIONAL)
                        && param.ty.is_none()
                        && param.default.is_none()
                        && func.type_params.is_empty()
                        && matches!(func.kind, FnKind::Expr | FnKind::Arrow | FnKind::Method)
                        && matches!(bound.fns[f].owner, FnOwner::Expr(_))
                        && self.is_known(ty)
                    {
                        ty = self.optional(ty);
                    }
                    let ty = self.reduced(ty);
                    let list = self.readonly_array_of(TypeId::ANY);
                    if self.is_known(ty)
                        && !matches!(self.data(ty), TypeData::Cond { .. })
                        && !self.is_assignable(ty, list)
                    {
                        out.push(Diagnostic {
                            start: param.pos,
                            code: 2370,
                        });
                        let end = self.end_of_param(file, p);
                        self.explain_to(param.pos, end, 2370, |_| vec![]);
                    }
                }
            }
        }
    }

    /// `checkVariableLikeDeclaration`, of the elements of the pattern `pat` of a parameter of a function without a body: 2371, at what
    /// the element binds.
    fn check_element_initializers(&self, file: FileId, pat: PatId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Object(props) => {
                for p in props.iter() {
                    let prop = &hir[p];
                    // `{ a: b }` there looks like a type that is none: that is said, and nothing else.
                    if !prop.is_rest
                        && prop.pos != hir[prop.value].pos
                        && matches!(hir[prop.value].kind, PatKind::Ident(_))
                    {
                        continue;
                    }
                    self.check_element_initializers(file, prop.value, out);
                    if prop.default.is_some() {
                        out.push(Diagnostic {
                            start: hir[prop.value].pos,
                            code: 2371,
                        });
                        let end = self.end_of_pat(file, prop.value);
                        self.note(hir[prop.value].pos, end, 2371, vec![]);
                    }
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    let elem = &hir[e];
                    self.check_element_initializers(file, elem.pat, out);
                    if elem.default.is_some() {
                        out.push(Diagnostic {
                            start: hir[elem.pat].pos,
                            code: 2371,
                        });
                        let end = self.end_of_pat(file, elem.pat);
                        self.note(hir[elem.pat].pos, end, 2371, vec![]);
                    }
                }
            }
            _ => {}
        }
    }

    /// The end of `onSuccessfullyResolvedSymbol`: the default of a parameter, and the names in its pattern, are worked out before the
    /// parameter, and what the function declares after it, are there.
    fn check_parameter_references(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir
            .params
            .iter()
            .any(|p| p.default.is_some() || !matches!(hir[p.pat].kind, PatKind::Ident(_)))
        {
            return;
        }
        // Around a statement are statements, and then a function, a namespace or the file. From there it only goes on to a parameter
        // if the function runs where it is written, and is written in one.
        let runs_in_place = (0..hir.fns.len() as u32).map(FnId).any(|f| {
            (hir[f].kind == FnKind::StaticBlock || self.is_immediately_invoked(file, f))
                && self
                    .parameter_around(file, ExprId::NONE, Parent::FnBody(f), true)
                    .0
                    .is_some()
        });
        let index = self.exprs_by_kind(file);
        for &id in index.of(ExprTag::Ident) {
            let i = id.idx();
            let (within, param) =
                self.parameter_around(file, id, bound.expr_parent[i], runs_in_place);
            if within.is_none() {
                continue;
            }
            let ExprKind::Ident(name) = hir.exprs[i].kind else {
                continue;
            };
            let local = bound.expr_symbol[i];
            if local.is_none() || bound.is_in_type_query(id) {
                continue;
            }
            // `candidate.ValueDeclaration`: where it is, and the pattern that binds it if it is a parameter.
            let (declared, declared_pos) = match bound.symbols[local.idx()].decls.first() {
                Some(&Decl::Param(p)) => (p, hir[p].pos),
                Some(&Decl::Var(p)) => (PatId::NONE, hir[p].pos),
                Some(&Decl::Fn(f)) => (PatId::NONE, hir[f].pos),
                _ => continue,
            };
            // `root.Parent.Locals()`: a local of the function whose parameter it is.
            let scope = bound.fns[bound.param_fn[param.idx()].idx()].scope;
            if bound.lookup(
                bound.scopes[scope.idx()].locals,
                bound.symbols[local.idx()].name,
            ) != Some(local)
            {
                continue;
            }
            if declared == within {
                out.push(Diagnostic {
                    start: hir.exprs[i].pos,
                    code: 2372,
                });
            } else if declared_pos > hir[within].pos {
                out.push(Diagnostic {
                    start: hir.exprs[i].pos,
                    code: 2373,
                });
                self.explain(hir.exprs[i].pos, 2373, |c| {
                    let end = c.end_of_pat(file, within);
                    vec![c.source_text(file, hir[within].pos, end), c.atom_text(name)]
                });
            }
        }
    }

    /// Out from `parent`, which `below` is written in, to the first parameter, or element of the pattern of one, whose default or whose
    /// pattern that is in; not through anything that runs later (`getIsDeferredContext`). What that parameter or element binds, and
    /// the parameter: `NONE` if there is none. `past_statements`: whether to go on from a statement.
    fn parameter_around(
        &self,
        file: FileId,
        mut below: ExprId,
        mut parent: Parent,
        past_statements: bool,
    ) -> (PatId, ParamId) {
        const NOWHERE: (PatId, ParamId) = (PatId::NONE, ParamId::NONE);
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The parameter whose pattern `pat` is part of.
        let param_of = |mut pat: PatId| loop {
            match bound.pat_parent[pat.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                PatParent::Param(p) => break Some(p),
                _ => break None,
            }
        };
        loop {
            parent = match parent {
                Parent::Expr(e) if e.is_none() => return NOWHERE,
                Parent::Expr(e) => {
                    below = e;
                    bound.expr_parent[e.idx()]
                }
                Parent::ParamDefault(p) => return (hir[p].pat, p),
                Parent::PatPropDefault(_) | Parent::PatElemDefault(_) => {
                    let element = match parent {
                        Parent::PatPropDefault(p) => hir[p].value,
                        Parent::PatElemDefault(p) => hir[p].pat,
                        _ => unreachable!(),
                    };
                    match param_of(element) {
                        Some(p) => return (element, p),
                        // Of a variable.
                        None => self.outward(file, parent),
                    }
                }
                // A name is worked out where the object literal, the pattern or the class is.
                Parent::Key(_) | Parent::MemberKey => match self.what_is_named(file, parent, below)
                {
                    Named::Property(literal) | Named::Function(literal) => Parent::Expr(literal),
                    // It is no part of the element it names: it goes with what has the pattern around it for a name.
                    Named::Element(p) => {
                        let PatParent::Prop(pattern, _) = bound.pat_parent[hir[p].value.idx()]
                        else {
                            return NOWHERE;
                        };
                        match param_of(pattern) {
                            Some(q) => return (pattern, q),
                            None => self.outward(file, Parent::PatPropDefault(p)),
                        }
                    }
                    Named::Member(m) => self.parent_of(file, Parent::MemberInit(m)),
                    Named::Unknown => return NOWHERE,
                },
                Parent::FnBody(f) => {
                    let runs_now = match hir[f].kind {
                        FnKind::StaticBlock => true,
                        FnKind::Arrow | FnKind::Expr => {
                            !hir[f].flags.intersects(Flags::ASYNC | Flags::GENERATOR)
                                && self.is_immediately_invoked(file, f)
                        }
                        _ => false,
                    };
                    if !runs_now {
                        return NOWHERE;
                    }
                    self.parent_of(file, parent)
                }
                Parent::MemberInit(m) if hir[m].flags.contains(Flags::STATIC) => {
                    self.parent_of(file, parent)
                }
                Parent::Stmt(s) if s.is_none() || !past_statements => return NOWHERE,
                Parent::Stmt(s) => bound.stmt_parent[s.idx()],
                Parent::Prop(_)
                | Parent::VarInit(_)
                | Parent::Case(_)
                | Parent::ClassExtends(_)
                | Parent::Decorator(..) => self.outward(file, parent),
                _ => return NOWHERE,
            };
        }
    }

    /// 2302: the type parameters of a class are those of its instances.
    fn check_static_type_parameter_references(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let has_static =
            |members: Span<MemberId>| members.iter().any(|m| hir[m].flags.contains(Flags::STATIC));
        // The names of the type parameters of what has a static member.
        let mut names: SmallVec<[Atom; 8]> = SmallVec::new();
        let classes = hir.classes.iter().map(|c| (c.type_params, c.members));
        let interfaces = hir.interfaces.iter().map(|i| (i.type_params, i.members));
        for (type_params, members) in classes.chain(interfaces) {
            if !type_params.is_empty() && has_static(members) {
                names.extend(type_params.iter().map(|p| hir[p].name));
            }
        }
        if names.is_empty() {
            return;
        }
        for t in 0..hir.types.len() {
            if let TypeNodeKind::Ref { name, .. } = hir.types[t].kind
                && name.len() == 1
                && names.contains(&hir.id_at(name, 0))
                && self.is_class_type_parameter_in_static(file, TypeNodeId(t as u32))
            {
                out.push(Diagnostic {
                    start: hir.types[t].pos,
                    code: 2302,
                });
            }
        }
    }

    /// `Resolve`, on getting to a class or an interface: whether the type reference `t` names a type parameter of it from one of
    /// its static members, however deep in the member it is written. It names nothing then.
    pub(super) fn is_class_type_parameter_in_static(&self, file: FileId, t: TypeNodeId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let TypeNodeKind::Ref { name, .. } = hir[t].kind else {
            return false;
        };
        let scope = bound.type_scope[t.idx()];
        if scope.is_none() || name.len() != 1 {
            return false;
        }
        let Some(sym) = self
            .files()
            .resolve_name(file, scope, hir.id_at(name, 0), SymFlags::TYPE)
        else {
            return false;
        };
        if sym.file != file || !self.files().flags(sym).contains(SymFlags::TYPE_PARAMETER) {
            return false;
        }
        let Some(&Decl::TypeParam(tp)) = self.files().symbol(sym).decls.first() else {
            return false;
        };
        let is_among = |params: Span<TypeParamId>| params.range().contains(&tp.idx());
        let (members, is_class) =
            if let Some(c) = hir.classes.iter().find(|c| is_among(c.type_params)) {
                (c.members, true)
            } else if let Some(i) = hir.interfaces.iter().find(|i| is_among(i.type_params)) {
                (i.members, false)
            } else {
                return false;
            };
        // The member it is written in. Members are in the order they are written and start at their names. What comes before the
        // first, the type parameters and what is extended and implemented, is in none.
        let pos = hir[t].pos;
        let mut owner = None;
        for m in members.iter() {
            if hir[m].pos <= pos {
                owner = Some(m);
                continue;
            }
            // What decorates a member comes before its name. From there the search goes on at the member.
            if hir
                .decorators
                .iter()
                .any(|&(of, e)| of == DecoratorOwner::Member(m) && self.start_of(file, e) <= pos)
            {
                owner = Some(m);
            }
            break;
        }
        let Some(m) = owner else { return false };
        let member = &hir[m];
        // `IsStatic`, `IsClassElement`: of what is in an interface only an index signature and an accessor are the kind of node
        // that is in a class.
        if !member.flags.contains(Flags::STATIC)
            || !is_class
                && !matches!(
                    member.kind,
                    MemberKind::IndexSignature | MemberKind::Getter | MemberKind::Setter
                )
        {
            return false;
        }
        if !matches!(member.key, PropKey::Computed(_)) || pos < member.pos {
            return true;
        }
        // From the computed name of a member the search ends before it gets to the class: that is 2467, static or not. What comes
        // after the name starts here.
        let after = if member.func.is_some() {
            let func = &hir[member.func];
            func.type_params
                .iter()
                .next()
                .map_or(func.anchor, |p| hir[p].pos)
        } else if member.ty.is_some() {
            hir[member.ty].pos
        } else if member.init.is_some() {
            self.start_of(file, member.init)
        } else {
            u32::MAX
        };
        pos >= after
    }

    /// What several declarations make together: 2428 2374 2440.
    fn check_merged_declarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let bound = self.bound(file);
        for i in 0..bound.symbols.len() {
            let symbol = &bound.symbols[i];
            if symbol.decls.len() < 2 && !symbol.flags.contains(SymFlags::MERGED)
                || !symbol
                    .flags
                    .intersects(SymFlags::CLASS | SymFlags::INTERFACE | SymFlags::ALIAS)
            {
                continue;
            }
            let sym = self.files().sym(file, SymbolId(i as u32));
            if sym.file == file && sym.id.idx() != i {
                continue;
            }
            let decls = self.files().decls_of(sym);
            if symbol
                .flags
                .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
            {
                let together = Self::declarations_put_together(&decls);
                if together.len() > 1 {
                    self.check_type_parameter_lists_identical(file, sym, &together, out);
                    self.check_merged_index_signatures(file, &together, out);
                }
            }
            if symbol.flags.contains(SymFlags::ALIAS) {
                self.check_alias_conflicts(file, sym, &decls, out);
            }
        }
    }

    /// `declareSymbolEx`, `mergeSymbol`: the classes and interfaces among `decls`, all that is declared by one name, that are one
    /// symbol. What does not go together is not put together: nothing that is a type goes with an enum, a type alias or a type
    /// parameter, nor a class with a variable, nor with a class that came before it.
    fn declarations_put_together(decls: &[(FileId, Decl)]) -> Vec<(FileId, Decl)> {
        let is_type_refused = decls
            .iter()
            .any(|(_, d)| matches!(d, Decl::Enum(_) | Decl::Alias(_) | Decl::TypeParam(_)));
        let is_class_refused = is_type_refused
            || decls
                .iter()
                .any(|(_, d)| matches!(d, Decl::Var(_) | Decl::Param(_)));
        let mut has_class = false;
        decls
            .iter()
            .copied()
            .filter(|&(_, d)| match d {
                Decl::Class(_) => !std::mem::replace(&mut has_class, true) && !is_class_refused,
                Decl::Interface(_) => !is_type_refused,
                _ => false,
            })
            .collect()
    }

    /// `checkTypeParameterListsIdentical`, of the declarations `decls` that `sym` is put together from.
    fn check_type_parameter_lists_identical(
        &mut self,
        file: FileId,
        sym: Sym,
        decls: &[(FileId, Decl)],
        out: &mut Vec<Diagnostic>,
    ) {
        let lists: Vec<(FileId, Span<TypeParamId>, u32)> = decls
            .iter()
            .filter_map(|&(f, d)| match d {
                Decl::Class(c) => Some((f, self.hir(f)[c].type_params, self.hir(f)[c].name_pos)),
                Decl::Interface(i) => {
                    Some((f, self.hir(f)[i].type_params, self.hir(f)[i].name_pos))
                }
                _ => None,
            })
            .collect();
        if lists.len() < 2 {
            return;
        }
        let targets = self.type_params_of_symbol(sym);
        let least = self.min_type_argument_count(&targets);
        let mut identical = true;
        'all: for &(f, params, _) in &lists {
            if params.len() < least || params.len() > targets.len() {
                identical = false;
                break;
            }
            let mapper = self.decl_params_mapper(sym, f, params);
            for (k, tp) in params.iter().enumerate() {
                let decl = self.hir(f)[tp];
                let Some((_, target)) = self.type_param_decl(targets[k]) else {
                    continue;
                };
                if decl.name != target.name {
                    identical = false;
                    break 'all;
                }
                for (node, wanted) in [
                    (decl.constraint, self.constraint_of_type_param(targets[k])),
                    (decl.default, self.default_of_type_param(targets[k])),
                ] {
                    if node.is_some()
                        && let Some(wanted) = wanted
                    {
                        let own = self.type_from_node(f, node);
                        let own = self.instantiate(own, mapper);
                        if self.is_known(own)
                            && self.is_known(wanted)
                            && !self.is_identical(own, wanted)
                        {
                            identical = false;
                            break 'all;
                        }
                    }
                }
            }
        }
        if !identical {
            out.extend(lists.iter().filter(|l| l.0 == file).map(|l| Diagnostic {
                start: l.2,
                code: 2428,
            }));
        }
    }

    /// `checkVariableLikeDeclaration`, of a property that is not the first declaration of its symbol: 2717, and 2403 of a parameter
    /// property. In every class, interface and type literal of the file.
    fn check_subsequent_property_declarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut symbols: SmallVec<[Sym; 8]> = bound
            .class_symbol
            .iter()
            .chain(&bound.interface_symbol)
            .filter(|s| s.is_some())
            .map(|&s| self.files().sym(file, s))
            .collect();
        symbols.sort_unstable();
        symbols.dedup();
        let mut declared: Vec<DeclaredMember> = Vec::new();
        for sym in symbols {
            declared.clear();
            let decls = self.files().decls_of(sym);
            if let [(of, decl)] = *decls {
                let alone = match decl {
                    Decl::Class(c) => Some((self.hir(of)[c].members, self.hir(of)[c].type_params)),
                    Decl::Interface(i) => {
                        Some((self.hir(of)[i].members, self.hir(of)[i].type_params))
                    }
                    _ => None,
                };
                if alone.is_none_or(|(members, params)| {
                    params.is_empty() && declares_each_name_once(self.hir(of), members)
                }) {
                    continue;
                }
            }
            // The members of what is not put together with the rest are its own.
            let together = Self::declarations_put_together(&decls);
            for (of, decl) in decls {
                let (members, params) = match decl {
                    Decl::Class(c) => (self.hir(of)[c].members, self.hir(of)[c].type_params),
                    Decl::Interface(i) => (self.hir(of)[i].members, self.hir(of)[i].type_params),
                    _ => continue,
                };
                if together.contains(&(of, decl)) {
                    let mapper = self.type_params_by_name(sym, of, params);
                    self.collect_declared_members(of, members, mapper, &mut declared);
                } else if of == file {
                    let mut alone = Vec::new();
                    self.collect_declared_members(of, members, MapperId::IDENTITY, &mut alone);
                    self.compare_declared_members(file, &mut alone, out);
                }
            }
            self.compare_declared_members(file, &mut declared, out);
        }
        for t in 0..hir.types.len() {
            if let TypeNodeKind::Object(members) = hir.types[t].kind
                && members.len() > 1
                && bound.type_scope[t].is_some()
                && !declares_each_name_once(hir, members)
            {
                declared.clear();
                self.collect_declared_members(file, members, MapperId::IDENTITY, &mut declared);
                self.compare_declared_members(file, &mut declared, out);
            }
        }
    }

    /// From the type parameters of one declaration of `sym` to those of the same name the symbol goes by: `bindTypeParameter`
    /// declares them among the members of the symbol, so that one name is one type parameter.
    fn type_params_by_name(
        &mut self,
        sym: Sym,
        file: FileId,
        params: Span<TypeParamId>,
    ) -> MapperId {
        if params.is_empty() {
            return MapperId::IDENTITY;
        }
        let canonical = self.type_params_of_symbol(sym);
        let (mut from, mut to) = (Vec::new(), Vec::new());
        for tp in params.iter() {
            let own = self.type_param(file, tp);
            let name = self.hir(file)[tp].name;
            if let Some(&target) = canonical
                .iter()
                .find(|&&c| self.type_param_decl(c).is_some_and(|(_, d)| d.name == name))
                && target != own
            {
                from.push(own);
                to.push(target);
            }
        }
        if from.is_empty() {
            MapperId::IDENTITY
        } else {
            self.mapper_from(&from, &to)
        }
    }

    /// What the members `members` declare, in the order the binder gets to them.
    fn collect_declared_members(
        &mut self,
        file: FileId,
        members: Span<MemberId>,
        mapper: MapperId,
        into: &mut Vec<DeclaredMember>,
    ) {
        let hir = self.hir(file);
        for m in members.iter() {
            let member = &hir[m];
            let (includes, excludes) = match member.kind {
                MemberKind::Property if member.flags.contains(Flags::ACCESSOR) => {
                    (ACCESSOR, METHOD | ACCESSOR)
                }
                MemberKind::Property => (PROPERTY, METHOD),
                MemberKind::Method => (METHOD, PROPERTY | ACCESSOR),
                MemberKind::Getter => (GET_ACCESSOR, METHOD | GET_ACCESSOR),
                MemberKind::Setter => (SET_ACCESSOR, METHOD | SET_ACCESSOR),
                // `bindParameter`: a parameter property is a property as well.
                MemberKind::Constructor if member.func.is_some() => {
                    for p in hir[member.func].params.iter() {
                        if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                            && let PatKind::Ident(name) = hir[hir[p].pat].kind
                        {
                            into.push(DeclaredMember {
                                name,
                                is_static: false,
                                is_late: false,
                                order: into.len() as u32,
                                includes: PROPERTY,
                                excludes: METHOD,
                                file,
                                member: MemberId::NONE,
                                param: p,
                                mapper,
                            });
                        }
                    }
                    continue;
                }
                _ => continue,
            };
            let Some(name) = self.member_name(file, member.key) else {
                continue;
            };
            into.push(DeclaredMember {
                name,
                is_static: member.flags.contains(Flags::STATIC),
                is_late: matches!(member.key, PropKey::Computed(_)),
                order: into.len() as u32,
                includes,
                excludes,
                file,
                member: m,
                param: ParamId::NONE,
                mapper,
            });
        }
    }

    /// `getWidenedTypeForVariableLikeDeclaration`, of one declaration of a property.
    fn type_of_declared_member(&mut self, d: &DeclaredMember) -> TypeId {
        let ty = if d.member.is_none() {
            self.type_of_param(d.file, d.param)
        } else {
            let ty = self.type_of_member_declaration(d.file, d.member);
            let flags = self.hir(d.file)[d.member].flags;
            if !flags.contains(Flags::OPTIONAL) || !self.is_known(ty) {
                ty
            } else if flags.contains(Flags::ACCESSOR) {
                self.optional(ty)
            } else {
                self.optional_property(ty)
            }
        };
        self.instantiate(ty, d.mapper)
    }

    /// 2717 2403, of the members of one class, interface or type literal. What is said about `file` is kept.
    fn compare_declared_members(
        &mut self,
        file: FileId,
        declared: &mut [DeclaredMember],
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        // `combineSymbolTables`: the names that have to be worked out come after the others.
        declared.sort_unstable_by_key(|d| (d.name, d.is_static, d.is_late, d.order));
        // A property or a parameter property of `file`.
        let is_checked = |d: &DeclaredMember| {
            d.file == file && (d.member.is_none() || hir[d.member].kind == MemberKind::Property)
        };
        let mut merged: Vec<DeclaredMember> = Vec::new();
        let mut start = 0;
        while start < declared.len() {
            let first = declared[start];
            let len = declared[start..]
                .iter()
                .take_while(|d| d.name == first.name && d.is_static == first.is_static)
                .count();
            let run = &declared[start..start + len];
            start += len;
            if len < 2 {
                continue;
            }
            // `declareSymbolEx`: what does not go with what is in the table gets a symbol of its own.
            let mut flags = 0;
            merged.clear();
            for d in run {
                if flags & d.excludes == 0 {
                    flags |= d.includes;
                    merged.push(*d);
                } else if flags & ACCESSOR != 0 && flags & ACCESSOR != d.includes & ACCESSOR {
                    flags |= ACCESSOR;
                }
            }
            // The first is `symbol.ValueDeclaration`.
            if merged.len() < 2 || !merged[1..].iter().any(is_checked) {
                continue;
            }
            // `getTypeOfSymbol`: what the accessors say if there are any, whatever came first; otherwise what the first says.
            let of_symbol = if flags & ACCESSOR != 0 {
                let accessors: Vec<(FileId, MemberId)> = merged
                    .iter()
                    .filter(|d| d.includes & ACCESSOR != 0)
                    .map(|d| (d.file, d.member))
                    .collect();
                let mapper = merged
                    .iter()
                    .find(|d| d.includes & ACCESSOR != 0)
                    .map_or(MapperId::IDENTITY, |d| d.mapper);
                let ty = self.type_of_member_declarations(&accessors);
                self.instantiate(ty, mapper)
            } else {
                self.type_of_declared_member(&merged[0])
            };
            if !self.is_known(of_symbol) {
                continue;
            }
            for d in &merged[1..] {
                if !is_checked(d) {
                    continue;
                }
                let again = self.type_of_declared_member(d);
                if !self.is_known(again) || self.is_identical(of_symbol, again) {
                    continue;
                }
                // As sure as with variables: see 2403.
                let differs = if self.is_any(of_symbol) || self.is_any(again) {
                    self.is_any(of_symbol) != self.is_any(again)
                } else {
                    !self.is_assignable(of_symbol, again) || !self.is_assignable(again, of_symbol)
                };
                if differs {
                    let (start, end, code) = if d.member.is_some() {
                        (
                            hir[d.member].pos,
                            self.end_of_member_name(file, d.member),
                            2717,
                        )
                    } else {
                        let name = hir[d.param].pat;
                        (hir[name].pos, self.end_of_pat(file, name), 2403)
                    };
                    out.push(Diagnostic { start, code });
                    self.explain_to(start, end, code, |c| {
                        vec![
                            c.source_text(file, start, end),
                            c.type_to_string(of_symbol),
                            c.type_to_string(again),
                        ]
                    });
                    // `symbol.ValueDeclaration`
                    let first = merged[0];
                    self.relate(start, code, |c| {
                        // `GetErrorRangeForNode`: all of a parameter, the name of a member.
                        let at = if first.member.is_none() {
                            (
                                first.file,
                                c.hir(first.file)[first.param].pos,
                                c.end_of_param(first.file, first.param),
                            )
                        } else {
                            let from = c.hir(first.file)[first.member].pos;
                            // The text of the default library is not kept.
                            let to = if c.hir(first.file).text.is_empty() {
                                from
                            } else {
                                c.end_of_member_name(first.file, first.member)
                            };
                            (first.file, from, to)
                        };
                        vec![super::explain::Related {
                            at: Some(at),
                            code: 6203,
                            args: vec![c.source_text(file, start, end)],
                        }]
                    });
                }
            }
        }
    }

    /// `checkAliasSymbol`: what is imported means something that is declared here as well.
    fn check_alias_conflicts(
        &mut self,
        file: FileId,
        sym: Sym,
        decls: &[(FileId, Decl)],
        out: &mut Vec<Diagnostic>,
    ) {
        let files = self.files();
        let flags = files.flags(sym);
        let mut excluded = SymFlags::empty();
        for meaning in [SymFlags::VALUE, SymFlags::TYPE, SymFlags::NAMESPACE] {
            if flags.intersects(meaning) {
                excluded |= meaning;
            }
        }
        if excluded.is_empty() {
            return;
        }
        // `declareSymbolEx`: an import after another of the name is refused, and is a symbol of its own that means nothing besides.
        let is_import = |d: Decl| {
            matches!(
                d,
                Decl::ImportDefault(_)
                    | Decl::ImportNamespace(_)
                    | Decl::ImportSpec(_)
                    | Decl::ImportEquals(_)
            )
        };
        let Some(&(of, decl)) = decls.iter().find(|d| is_import(d.1)) else {
            return;
        };
        if of != file {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        // What it is declared by, the module that names if it names one, and where it starts (`GetErrorRangeForNode`): `* as ns` at
        // the name, `import a = b` where the statement does.
        let (import, import_equals, spec, start) = match decl {
            Decl::ImportDefault(i) => {
                let start = start_with_type(&hir.text, hir[i].default_pos, hir[i].type_only);
                (i, ImportEqualsId::NONE, hir[i].spec, Some(start))
            }
            Decl::ImportNamespace(i) => (
                i,
                ImportEqualsId::NONE,
                hir[i].spec,
                Some(hir[i].namespace_pos),
            ),
            Decl::ImportSpec(s) => {
                let Some(i) = hir
                    .imports
                    .iter()
                    .position(|i| i.named.range().contains(&s.idx()))
                else {
                    return;
                };
                let start = start_with_type(&hir.text, hir[s].imported_pos, hir[s].type_only);
                (
                    ImportId(i as u32),
                    ImportEqualsId::NONE,
                    hir.imports[i].spec,
                    Some(start),
                )
            }
            Decl::ImportEquals(i) => match hir[i].target {
                ImportEqualsTarget::Require(spec) => (ImportId::NONE, i, spec, None),
                ImportEqualsTarget::Entity(_) => (ImportId::NONE, i, Atom::NONE, None),
            },
            _ => return,
        };
        let statement = hir.stmts.iter().position(|s| match s.kind {
            StmtKind::Import(x) => x == import,
            StmtKind::ImportEquals(x) => x == import_equals,
            _ => false,
        });
        let Some(statement) = statement else { return };
        // `checkGrammarModuleElementContext`, `checkExternalImportOrExportDeclaration`: an import that is out of place is looked at no
        // further. In a namespace no module can be named, and in `declare module "m"` none by where its file is, unless that
        // adds to a module.
        let is_in_place = match bound.stmt_parent[statement] {
            Parent::File => true,
            Parent::Module(m) => {
                spec.is_none()
                    || !matches!(hir[m].name, ModuleName::Ident(_))
                        && (files.module(file).is_module()
                            || !crate::resolve::is_relative(&files.atoms.text(spec)))
            }
            _ => false,
        };
        if is_in_place && self.flags_of_alias_target(sym).intersects(excluded) {
            let start = start.unwrap_or(hir.stmts[statement].pos);
            out.push(Diagnostic { start, code: 2440 });
            let end = match decl {
                Decl::ImportDefault(i) => end_of_import_clause(self, file, i),
                Decl::ImportSpec(s) => self.end_of_import_spec(file, s),
                Decl::ImportEquals(_) => self.end_of_stmt(file, StmtId(statement as u32)),
                _ => 0,
            };
            self.explain_to(start, end, 2440, |c| vec![c.symbol_to_string(sym)]);
        }
    }

    /// `getSymbolFlags(resolveAlias(sym))`: what all that is on the way from the alias `sym` to what it stands for in the end means,
    /// taken together, `sym` itself left out. Where the way is lost, what is known to be meant up to there.
    fn flags_of_alias_target(&mut self, sym: Sym) -> SymFlags {
        let files = self.files();
        let mut flags = SymFlags::empty();
        let mut at = sym;
        for _ in 0..32 {
            let next = files
                .alias_target(at)
                .map(|t| files.canonical(t))
                .filter(|&t| t != at);
            // `combineValueAndTypeSymbols`: next to an export that is no value, the value that goes by the name counts too; and it
            // alone if it is more than a value.
            if next.is_none_or(|t| !files.flags(t).intersects(SymFlags::VALUE))
                && let Some(of_value) = self.flags_of_imported_value(at)
            {
                flags |= of_value;
                if of_value.intersects(SymFlags::TYPE | SymFlags::NAMESPACE) {
                    return flags;
                }
            }
            let Some(next) = next else { return flags };
            flags |= files.flags(next);
            if !files.flags(next).contains(SymFlags::ALIAS) {
                return flags;
            }
            at = next;
        }
        flags
    }

    /// `getExternalModuleMember`: what `import { a }` or `export { a } from`, if the alias `sym` is declared by one, finds that is not
    /// among the exports of the module. `declare module "m";` is itself all that is asked of it. Of a module that is
    /// `export = value`, the properties of the value can be had by their names.
    fn flags_of_imported_value(&mut self, sym: Sym) -> Option<SymFlags> {
        let files = self.files();
        let hir = self.hir(sym.file);
        let (spec, mode, name) =
            files
                .symbol(sym)
                .decls
                .iter()
                .rev()
                .find_map(|&decl| match decl {
                    Decl::ImportSpec(s) => hir
                        .imports
                        .iter()
                        .find(|i| i.named.range().contains(&s.idx()))
                        .map(|i| (i.spec, i.mode, hir[s].imported)),
                    Decl::ExportSpec(s) => hir
                        .exports
                        .iter()
                        .find(|x| x.spec.is_some() && x.items.range().contains(&s.idx()))
                        .map(|x| (x.spec, x.mode, hir[s].local)),
                    _ => None,
                })?;
        // `getTargetOfImportSpecifier`: `{ default as d }` is the default import by another spelling.
        if name == known::default {
            return None;
        }
        let module =
            files.module_of_specifier_as(sym.file, spec, files.mode_of_import(sym.file, mode))?;
        // `isShorthandAmbientModuleSymbol`
        if files
            .decls(module)
            .iter()
            .any(|&(f, d)| matches!(d, Decl::Module(id) if !files.hir(f)[id].has_body))
        {
            return Some(files.flags(module));
        }
        let value = files.module_value(module);
        if value == module {
            return None;
        }
        let ty = self.type_of_symbol(value);
        if !self.is_known(ty) || self.is_any(ty) {
            return None;
        }
        // `getPropertyOfTypeEx`, `skipObjectFunctionPropertyAugment`: its own properties. Not what every object and every function
        // has, and no index signature.
        let apparent = self.apparent_type(ty);
        let apparent = self.reduced(apparent);
        let (prop, _) = self.prop_of(apparent, name)?;
        match prop.source {
            // What a namespace or a module exports means what it means there, if that is known.
            PropSource::Symbol(member) => {
                Some(files.symbol_flags(member)).filter(|&flags| flags != SymFlags::all())
            }
            // A property is a value and nothing else. `SymFlags::VALUE` would not say so: it shares bits with `TYPE` and `NAMESPACE`.
            _ => Some(SymFlags::FUNCTION_SCOPED_VARIABLE),
        }
    }

    /// `getBaseConstructorTypeOfClass`: 2507
    fn check_base_constructors(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for c in 0..hir.classes.len() {
            let extends = hir.classes[c].extends;
            if extends.is_none()
                || bound.class_symbol[c].is_none()
                || matches!(bound.expr_parent[extends.idx()], Parent::None)
            {
                continue;
            }
            let base = self.type_of_expr(file, extends);
            if !self.is_known(base)
                || self.is_any(base)
                || base == TypeId::NULL
                || self.is_uncertain(file, extends)
            {
                continue;
            }
            // `isConstructorType`
            let apparent = self.apparent_type(base);
            if self.signatures(apparent, true).is_empty() {
                let start = self.start_of(file, extends);
                out.push(Diagnostic { start, code: 2507 });
                let end = self.end_of_expr(file, extends);
                self.explain_to(start, end, 2507, |c| vec![c.type_to_string(base)]);
            }
        }
    }

    /// `checkTypeForDuplicateIndexSignatures`: 2374, within each class, interface and type literal of the file.
    fn check_index_signatures(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if hir
            .members
            .iter()
            .filter(|m| m.kind == MemberKind::IndexSignature)
            .nth(1)
            .is_none()
        {
            return;
        }
        // The lists of members, and whether they are those of a class.
        let classes = hir.classes.iter().map(|c| (c.members, true));
        let interfaces = hir.interfaces.iter().map(|i| (i.members, false));
        let literals = hir.types.iter().filter_map(|t| match t.kind {
            TypeNodeKind::Object(members) => Some((members, false)),
            _ => None,
        });
        let lists = classes.chain(interfaces).chain(literals);
        let mut seen = Vec::new();
        for (members, is_class) in lists {
            if members
                .iter()
                .filter(|&m| hir[m].kind == MemberKind::IndexSignature)
                .count()
                < 2
            {
                continue;
            }
            self.collect_index_signatures(file, members, is_class, &mut seen);
            self.report_duplicate_index_signatures(file, &mut seen, out);
        }
    }

    /// The same over `decls`, the declarations a class or an interface is put together from: they share one `__index`.
    fn check_merged_index_signatures(
        &mut self,
        file: FileId,
        decls: &[(FileId, Decl)],
        out: &mut Vec<Diagnostic>,
    ) {
        let mut seen = Vec::new();
        for &(of, decl) in decls {
            let (members, is_class) = match decl {
                Decl::Class(c) => (self.hir(of)[c].members, true),
                Decl::Interface(i) => (self.hir(of)[i].members, false),
                _ => continue,
            };
            self.collect_index_signatures(of, members, is_class, &mut seen);
        }
        self.report_duplicate_index_signatures(file, &mut seen, out);
    }

    /// `getIndexSymbol`: adds the index signatures among `members` to `seen`, which has where they are by the type of the key. A key
    /// that is a union counts once for each of its members.
    fn collect_index_signatures(
        &mut self,
        file: FileId,
        members: Span<MemberId>,
        is_class: bool,
        seen: &mut Vec<(TypeId, Vec<(FileId, MemberId)>)>,
    ) {
        let hir = self.hir(file);
        for m in members.iter() {
            let member = &hir[m];
            // `declareClassMember`: what is static in a class is among its exports, which are not looked at. Elsewhere `static`
            // moves nothing.
            if member.kind != MemberKind::IndexSignature
                || is_class && member.flags.contains(Flags::STATIC)
            {
                continue;
            }
            let params = hir[member.func].params;
            let Some(p) = params.iter().next() else {
                continue;
            };
            if params.len != 1 || hir[p].ty.is_none() {
                continue;
            }
            let keys = self.type_from_node(file, hir[p].ty);
            for &key in self.parts(keys) {
                if !self.is_known(key) {
                    continue;
                }
                match seen.iter_mut().find(|s| s.0 == key) {
                    Some(entry) => entry.1.push((file, m)),
                    None => seen.push((key, vec![(file, m)])),
                }
            }
        }
    }

    /// 2374 at each index signature of `file` whose key another of those in `seen` has too. Empties `seen`.
    fn report_duplicate_index_signatures(
        &mut self,
        file: FileId,
        seen: &mut Vec<(TypeId, Vec<(FileId, MemberId)>)>,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        for (key, places) in seen.drain(..) {
            if places.len() > 1 {
                for (_, m) in places.into_iter().filter(|place| place.0 == file) {
                    let start = hir[m].pos;
                    out.push(Diagnostic { start, code: 2374 });
                    let end = self.end_of_member(file, m);
                    self.explain_another(start, end, 2374, |c| vec![c.type_to_string(key)]);
                }
            }
        }
    }
}

/// Whether the names that `members` declare, parameter properties included, are all written out and all different.
fn declares_each_name_once(hir: &hir::File, members: Span<MemberId>) -> bool {
    let mut names: SmallVec<[Atom; 16]> = SmallVec::new();
    for m in members.iter() {
        let member = &hir[m];
        match member.kind {
            MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                match member.key {
                    PropKey::Name(name) | PropKey::Private(name) => names.push(name),
                    PropKey::Computed(_) => return false,
                    PropKey::None => {}
                }
            }
            MemberKind::Constructor if member.func.is_some() => {
                for p in hir[member.func].params.iter() {
                    if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                        && let PatKind::Ident(name) = hir[hir[p].pat].kind
                    {
                        names.push(name);
                    }
                }
            }
            _ => {}
        }
    }
    names.sort_unstable();
    names.windows(2).all(|pair| pair[0] != pair[1])
}

/// `node.End()` of the import clause of `import`, which has a default import: that, and the `{ .. }` or `* as ns` after it.
fn end_of_import_clause(c: &Checker<'_>, file: FileId, import: ImportId) -> u32 {
    let hir = c.hir(file);
    let name_end = c.end_of_name_at(file, hir[import].default_pos);
    if hir[import].namespace.is_some() {
        return c.end_of_name_at(file, hir[import].namespace_pos);
    }
    let rest = hir.text.get(name_end as usize..).unwrap_or_default();
    let Some(after_comma) = rest.trim_ascii_start().strip_prefix(b",") else {
        return name_end;
    };
    let braces = after_comma.trim_ascii_start();
    if braces.starts_with(b"{") {
        c.end_of_bracket_at(file, (hir.text.len() - braces.len()) as u32)
    } else {
        name_end
    }
}

/// Where an import clause or an import specifier starts, whose name is at `name_pos`: at the `type` before the name if it has one.
fn start_with_type(text: &[u8], name_pos: u32, type_only: bool) -> u32 {
    if !type_only {
        return name_pos;
    }
    let mut before = text[..(name_pos as usize).min(text.len())].trim_ascii_end();
    while before.ends_with(b"*/") {
        let Some(open) = before.windows(2).rposition(|w| w == b"/*") else {
            break;
        };
        before = before[..open].trim_ascii_end();
    }
    if before.ends_with(b"type") {
        before.len() as u32 - 4
    } else {
        name_pos
    }
}

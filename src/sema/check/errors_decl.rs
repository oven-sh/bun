//! Declarations that are out of place or at odds with each other:
//! 2369 2370 2371 2463, 2372 2373, 2428, 2440, 2374, 2717 2403.
//!
//! Follows `checkParameter`, the end of `onSuccessfullyResolvedSymbol`, `checkTypeParameterListsIdentical`, `checkAliasSymbol`,
//! `getSymbolFlags`, `getExternalModuleMember`, `checkTypeForDuplicateIndexSignatures` and
//! `checkVariableLikeDeclaration` of TypeScript 7.0.2's checker.go, and `Resolve` of its nameresolver.go.

use super::errors::Diagnostic;
use super::errors_order::Named;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, SymbolId, flags_of_member};
use smallvec::SmallVec;

impl Checker<'_> {
    pub(super) fn check_declarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        self.check_parameters(file, out);
        self.check_parameter_references(file, out);
        self.check_merged_declarations(file, out);
        self.check_subsequent_property_declarations(file, out);
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
            let has_body = has_body(&func);
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
        let elements: SmallVec<[(PatId, ExprId); 8]> = match hir[pat].kind {
            PatKind::Object(props) => props
                .iter()
                .map(|p| &hir[p])
                // `{ a: b }` there looks like a type that is none: that is said, and nothing else.
                .filter(|prop| {
                    prop.is_rest
                        || prop.pos == hir[prop.value].pos
                        || !matches!(hir[prop.value].kind, PatKind::Ident(_))
                })
                .map(|prop| (prop.value, prop.default))
                .collect(),
            PatKind::Array(elems) => elems.iter().map(|e| (hir[e].pat, hir[e].default)).collect(),
            _ => return,
        };
        for (binding, initializer) in elements {
            self.check_element_initializers(file, binding, out);
            if initializer.is_some() {
                let start = hir[binding].pos;
                out.push(Diagnostic { start, code: 2371 });
                self.note(start, self.end_of_pat(file, binding), 2371, vec![]);
            }
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
            if local.is_none() || bound.is_in_type_query(id) || bound.is_unchecked(i) {
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
                Parent::PropKey(..)
                | Parent::PatKey(_)
                | Parent::MemberKey(_)
                | Parent::MethodKey(_) => match self.what_is_named(file, parent, below) {
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
                // `getClassOrInterfaceDeclarationsOfSymbol`
                let is_one =
                    |d: &&(FileId, Decl)| matches!(d.1, Decl::Class(_) | Decl::Interface(_));
                if decls.iter().filter(is_one).count() > 1 {
                    self.check_type_parameter_lists_identical(file, sym, &decls, out);
                    self.check_merged_index_signatures(file, &decls, out);
                }
            }
            if symbol.flags.contains(SymFlags::ALIAS) {
                self.check_alias_conflicts(file, sym, &decls, out);
            }
        }
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
        let properties = (0..hir.members.len() as u32)
            .map(MemberId)
            .filter(|&m| {
                hir[m].kind == MemberKind::Property
                    && bound.member_owner[m.idx()] != MemberOwner::None
            })
            .map(Decl::Member);
        let parameter_properties = (0..hir.params.len() as u32)
            .map(ParamId)
            .filter(|&p| hir[p].flags.contains(Flags::PARAMETER_PROPERTY))
            .map(Decl::ParameterProperty);
        for declaration in properties.chain(parameter_properties) {
            let declarations = self.declarations_of_member(file, declaration);
            if declarations.len() > 1 {
                self.compare_with_value_declaration(file, declaration, &declarations, out);
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

    /// From the type parameters of the declaration that `declaration` is written in to those its symbol goes by.
    fn mapper_of_member_declaration(&mut self, file: FileId, declaration: Decl) -> MapperId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let member = match declaration {
            Decl::Member(m) => m,
            Decl::ParameterProperty(p) => match bound.fns[bound.param_fn[p.idx()].idx()].owner {
                FnOwner::Member(constructor) => constructor,
                _ => return MapperId::IDENTITY,
            },
            _ => return MapperId::IDENTITY,
        };
        let (symbol, params) = match bound.member_owner[member.idx()] {
            MemberOwner::Class(c) => (bound.class_symbol[c.idx()], hir[c].type_params),
            MemberOwner::Interface(i) => (bound.interface_symbol[i.idx()], hir[i].type_params),
            _ => return MapperId::IDENTITY,
        };
        self.type_params_by_name(self.files().sym(file, symbol), file, params)
    }

    /// `getWidenedTypeForVariableLikeDeclaration`, of one declaration of a property.
    fn type_of_declared_member(&mut self, (file, declaration): (FileId, Decl)) -> TypeId {
        let ty = match declaration {
            Decl::ParameterProperty(p) => self.type_of_param(file, p),
            Decl::Member(m) => {
                let ty = self.type_of_member_declaration(file, m);
                let flags = self.hir(file)[m].flags;
                if !flags.contains(Flags::OPTIONAL) || !self.is_known(ty) {
                    ty
                } else if flags.contains(Flags::ACCESSOR) {
                    self.optional(ty)
                } else {
                    self.optional_property(ty)
                }
            }
            _ => return TypeId::UNRESOLVED,
        };
        let mapper = self.mapper_of_member_declaration(file, declaration);
        self.instantiate(ty, mapper)
    }

    /// 2717 2403, of the property or parameter property `declaration` of `file`, one of the `declarations` of its symbol.
    fn compare_with_value_declaration(
        &mut self,
        file: FileId,
        declaration: Decl,
        declarations: &[(FileId, Decl)],
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let is_value =
            |d: &&(FileId, Decl)| matches!(d.1, Decl::Member(_) | Decl::ParameterProperty(_));
        // The first is `symbol.ValueDeclaration`.
        let Some(&first) = declarations.iter().find(is_value) else {
            return;
        };
        if first == (file, declaration) {
            return;
        }
        // `getTypeOfSymbol`: what the accessors say if there are any, whatever came first; otherwise what the first says.
        let accessors: Vec<(FileId, MemberId)> = declarations
            .iter()
            .filter_map(|&(of, d)| match d {
                Decl::Member(m)
                    if flags_of_member(&self.hir(of)[m])
                        .is_some_and(|flags| flags.0.intersects(SymFlags::ACCESSOR)) =>
                {
                    Some((of, m))
                }
                _ => None,
            })
            .collect();
        let of_symbol = match accessors.first() {
            Some(&(of, m)) => {
                let mapper = self.mapper_of_member_declaration(of, Decl::Member(m));
                let ty = self.type_of_member_declarations(&accessors);
                self.instantiate(ty, mapper)
            }
            None => self.type_of_declared_member(first),
        };
        if !self.is_known(of_symbol) || self.is_error_type(of_symbol) {
            return;
        }
        let again = self.type_of_declared_member((file, declaration));
        if !self.is_known(again) || self.is_error_type(again) || self.is_identical(of_symbol, again)
        {
            return;
        }
        // As sure as with variables: see 2403.
        let differs = if self.is_any(of_symbol) || self.is_any(again) {
            self.is_any(of_symbol) != self.is_any(again)
        } else {
            !self.is_assignable(of_symbol, again) || !self.is_assignable(again, of_symbol)
        };
        if !differs {
            return;
        }
        let (start, end, code) = match declaration {
            Decl::ParameterProperty(p) => {
                let name = hir[p].pat;
                (hir[name].pos, self.end_of_pat(file, name), 2403)
            }
            Decl::Member(m) => (hir[m].name_pos, self.end_of_member_name(file, m), 2717),
            _ => return,
        };
        out.push(Diagnostic { start, code });
        self.explain_to(start, end, code, |c| {
            vec![
                c.source_text(file, start, end),
                c.type_to_string(of_symbol),
                c.type_to_string(again),
            ]
        });
        self.relate(start, code, |c| {
            // `GetErrorRangeForNode`: all of a parameter, the name of a member.
            let at = match first {
                (of, Decl::ParameterProperty(p)) => (of, c.hir(of)[p].pos, c.end_of_param(of, p)),
                (of, Decl::Member(m)) => {
                    let from = c.hir(of)[m].name_pos;
                    // The text of the default library is not kept.
                    let to = if c.hir(of).text.is_empty() {
                        from
                    } else {
                        c.end_of_member_name(of, m)
                    };
                    (of, from, to)
                }
                (of, _) => (of, 0, 0),
            };
            vec![super::explain::Related {
                at: Some(at),
                code: 6203,
                args: vec![c.source_text(file, start, end)],
            }]
        });
    }

    /// `checkAliasSymbol`: what is imported, or exported by a specifier, means something that is declared here as well.
    fn check_alias_conflicts(
        &mut self,
        file: FileId,
        sym: Sym,
        decls: &[(FileId, Decl)],
        out: &mut Vec<Diagnostic>,
    ) {
        let files = self.files();
        // `getMergedSymbol(core.OrElse(symbol.ExportSymbol, symbol))`
        let flags = match files.symbol(sym).export_symbol {
            SymbolId::NONE => files.flags(sym),
            exported => files.flags(files.sym(sym.file, exported)),
        };
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
                Decl::ExportSpec(_)
                    | Decl::ImportDefault(_)
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
            Decl::ImportDefault(i) => (
                i,
                ImportEqualsId::NONE,
                hir[i].spec,
                Some(hir[i].clause_start),
            ),
            Decl::ImportNamespace(i) => (
                i,
                ImportEqualsId::NONE,
                hir[i].spec,
                Some(hir[i].namespace_pos),
            ),
            Decl::ImportSpec(s) => {
                let i = hir[s].import;
                let start = hir[s].start;
                (i, ImportEqualsId::NONE, hir[i].spec, Some(start))
            }
            Decl::ImportEquals(i) => match hir[i].target {
                ImportEqualsTarget::Require(spec) => (ImportId::NONE, i, spec, None),
                ImportEqualsTarget::Entity(_) => (ImportId::NONE, i, Atom::NONE, None),
            },
            Decl::ExportSpec(s) => (
                ImportId::NONE,
                ImportEqualsId::NONE,
                hir[hir[s].export].spec,
                Some(hir[s].start),
            ),
            _ => return,
        };
        let statement = hir.stmts.iter().position(|s| match s.kind {
            StmtKind::Import(x) => x == import,
            StmtKind::ImportEquals(x) => x == import_equals,
            StmtKind::ExportNamed(x) => matches!(decl, Decl::ExportSpec(s) if hir[s].export == x),
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
            let code = match decl {
                Decl::ExportSpec(_) => 2484,
                _ => 2440,
            };
            out.push(Diagnostic { start, code });
            let end = match decl {
                Decl::ImportDefault(i) => end_of_import_clause(self, file, i),
                Decl::ImportSpec(s) => self.end_of_import_spec(file, s),
                Decl::ImportEquals(_) => self.end_of_stmt(file, StmtId(statement as u32)),
                Decl::ExportSpec(s) => self.end_of_export_spec(file, s),
                _ => 0,
            };
            self.explain_to(start, end, code, |c| vec![c.symbol_to_string(sym)]);
        }
    }

    /// `getSymbolFlags(resolveAlias(sym))`: what all that is on the way from the alias `sym` to what it stands for in the end means,
    /// taken together, `sym` itself left out. Where the way is lost, what is known to be meant up to there.
    fn flags_of_alias_target(&mut self, sym: Sym) -> SymFlags {
        let files = self.files();
        let mut flags = SymFlags::empty();
        let mut at = sym;
        for _ in 0..32 {
            let next = files.alias_target(at).map(|t| files.canonical(t));
            // `resolveEntityName` returns what has a meaning without `resolveAlias`: `export { a }` next to an exported `a` stands for
            // the symbol it is a declaration of.
            if next == Some(at) {
                return flags | files.flags(at);
            }
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
        let (spec, mode, name) = files
            .symbol(sym)
            .decls
            .iter()
            .rev()
            .filter(|decl| !matches!(decl, Decl::Require(_)))
            .find_map(|&decl| files.external_module_member_of(sym.file, decl))?;
        // `getTargetOfImportSpecifier`: `{ default as d }` is the default import by another spelling.
        if name == known::default {
            return None;
        }
        let module = files.module_of_specifier_as(sym.file, spec, mode)?;
        if files.is_shorthand_ambient_module_symbol(module) {
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
                    let start = hir[m].start;
                    out.push(Diagnostic { start, code: 2374 });
                    let end = hir[m].loc.end;
                    self.explain_another(start, end, 2374, |c| vec![c.type_to_string(key)]);
                }
            }
        }
    }
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

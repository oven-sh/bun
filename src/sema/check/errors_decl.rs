//! Declarations that are out of place or at odds with each other:
//! 2369 2370 2371 2463, 2372 2373, 2428, 2440, 2374, 2717 2403.
//!
//! Follows `checkParameter`, the end of `onSuccessfullyResolvedSymbol`, `checkTypeParameterListsIdentical`, `checkAliasSymbol`,
//! `getSymbolFlags`, `getExternalModuleMember`, `checkTypeForDuplicateIndexSignatures` and
//! `checkVariableLikeDeclaration` of TypeScript 7.0.2's checker.go, and `Resolve` of its nameresolver.go.

use super::sink::held;
use super::*;
use crate::bind::{Decl, MemberOwner, SymbolId, flags_of_member};
use smallvec::SmallVec;

impl Checker<'_> {
    pub(super) fn check_declarations(&mut self, file: FileId) {
        self.check_parameter_references(file);
        self.check_merged_declarations(file);
        self.check_subsequent_property_declarations(file);
        self.check_index_signatures(file);
    }

    /// `checkVariableLikeDeclaration`, of the elements of the pattern `pat` of a parameter of a function without a body: 2371, at what
    /// the element binds.
    pub(super) fn check_element_initializers(&mut self, file: FileId, pat: PatId) {
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
            self.check_element_initializers(file, binding);
            if initializer.is_some() {
                self.error(file, binding, 2371, &[]);
            }
        }
    }

    /// The end of `onSuccessfullyResolvedSymbol`: the default of a parameter, and the names in its pattern, are worked out before the
    /// parameter, and what the function declares after it, are there.
    fn check_parameter_references(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Only what is written in one of these is in the default or in the pattern of a parameter: told by its position, no walk.
        let has_more_than_a_name =
            |p: &&Param| p.default.is_some() || !matches!(hir[p.pat].kind, PatKind::Ident(_));
        let parameters = Places::new(
            hir.params
                .iter()
                .filter(has_more_than_a_name)
                .map(|p| p.loc),
        );
        let index = self.exprs_by_kind(file);
        for &id in index.of(ExprTag::Ident) {
            let i = id.idx();
            if !parameters.contain(hir.exprs[i].pos) {
                continue;
            }
            let associated = Self::associated_declaration(hir, hir.node(id));
            let (NodeData::Pat(within), NodeData::Param(param)) = (
                hir.data(hir.name(associated)),
                hir.data(hir.get_root_declaration(associated)),
            ) else {
                continue;
            };
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
                Some(&Decl::Fn(f)) => (PatId::NONE, hir[f].start),
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
                self.error_at((file, hir.exprs[i].pos, 0), 2372, &[Arg::Atom(name)]);
            } else if declared_pos > hir[within].pos {
                {
                    let end = self.end_of_pat(file, within);
                    self.error_at(
                        (file, hir.exprs[i].pos, 0),
                        2373,
                        &[
                            Arg::Text(&self.source_text(file, hir[within].pos, end)),
                            Arg::Atom(name),
                        ],
                    );
                }
            }
        }
    }

    /// `associatedDeclarationForContainingInitializerOrBindingName`, as `Resolve` has it when it gets from `usage` to the function whose
    /// parameter that is. `NONE`: there is none, or `withinDeferredContext`.
    fn associated_declaration(hir: &File, usage: Node) -> Node {
        let (mut last, mut location) = (Node::NONE, usage);
        while location.is_some() {
            let kind = hir.kind(location);
            let is_name = || last.is_some() && last == hir.name(location);
            // `getIsDeferredContext`
            let is_deferred = match kind {
                Kind::ArrowFunction | Kind::FunctionExpression => {
                    !is_name()
                        && (hir
                            .flags(location)
                            .intersects(Flags::ASYNC | Flags::GENERATOR)
                            || hir
                                .get_immediately_invoked_function_expression(location)
                                .is_none())
                }
                Kind::TypeQuery => true,
                Kind::PropertyDeclaration => !hir.is_static(location) && !is_name(),
                _ => kind.is_function_like_declaration() && !is_name(),
            };
            if is_deferred {
                return Node::NONE;
            }
            match kind {
                Kind::Decorator => {
                    if hir.kind(hir.parent(location)) == Kind::Parameter {
                        location = hir.parent(location);
                    }
                    let parent = hir.kind(hir.parent(location));
                    if parent.is_class_element() || parent == Kind::ClassDeclaration {
                        location = hir.parent(location);
                    }
                }
                Kind::Parameter | Kind::BindingElement
                    if last.is_some()
                        && (last == hir.initializer(location)
                            || is_name()
                                && matches!(
                                    hir.kind(last),
                                    Kind::ObjectBindingPattern | Kind::ArrayBindingPattern
                                ))
                        && hir.kind(hir.get_root_declaration(location)) == Kind::Parameter =>
                {
                    return location;
                }
                _ => {}
            }
            (last, location) = (location, hir.parent(location));
        }
        Node::NONE
    }

    /// What several declarations make together: 2428 2374.
    fn check_merged_declarations(&mut self, file: FileId) {
        let bound = self.bound(file);
        for i in 0..bound.symbols.len() {
            let symbol = &bound.symbols[i];
            if symbol.decls.len() < 2 && !symbol.flags.contains(SymFlags::MERGED)
                || !symbol
                    .flags
                    .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
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
                    self.check_type_parameter_lists_identical(file, sym, &decls);
                    self.check_merged_index_signatures(file, &decls);
                }
            }
        }
    }

    /// `checkTypeParameterListsIdentical`, of the declarations `decls` that `sym` is put together from.
    fn check_type_parameter_lists_identical(
        &mut self,
        file: FileId,
        sym: Sym,
        decls: &[(FileId, Decl)],
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
            for l in lists.iter().filter(|l| l.0 == file) {
                self.error_at((file, l.2, 0), 2428, &[Arg::Sym(sym)]);
            }
        }
    }

    /// `checkVariableLikeDeclaration`, of a property that is not the first declaration of its symbol: 2717, and 2403 of a parameter
    /// property. In every class, interface and type literal of the file.
    fn check_subsequent_property_declarations(&mut self, file: FileId) {
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
                self.compare_with_value_declaration(file, declaration, &declarations);
            }
        }
    }

    /// `getWidenedTypeForVariableLikeDeclaration`, of one declaration of a property.
    fn type_of_declared_member(&mut self, (file, declaration): (FileId, Decl)) -> TypeId {
        match declaration {
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
            _ => TypeId::UNRESOLVED,
        }
    }

    /// 2717 2403, of the property or parameter property `declaration` of `file`, one of the `declarations` of its symbol.
    fn compare_with_value_declaration(
        &mut self,
        file: FileId,
        declaration: Decl,
        declarations: &[(FileId, Decl)],
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
        let of_symbol = if accessors.is_empty() {
            self.type_of_declared_member(first)
        } else {
            self.type_of_member_declarations(&accessors)
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
        self.error_at(
            (file, start, end),
            code,
            &[
                Arg::Text(&self.source_text(file, start, end)),
                Arg::Type(of_symbol),
                Arg::Type(again),
            ],
        );
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
            vec![Reported::new(
                at,
                6203,
                held(vec![c.source_text(file, start, end)]),
            )]
        });
    }

    /// `checkTypeForDuplicateIndexSignatures`: 2374, within each class, interface and type literal of the file.
    fn check_index_signatures(&mut self, file: FileId) {
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
            self.report_duplicate_index_signatures(file, &mut seen);
        }
    }

    /// The same over `decls`, the declarations a class or an interface is put together from: they share one `__index`.
    fn check_merged_index_signatures(&mut self, file: FileId, decls: &[(FileId, Decl)]) {
        let mut seen = Vec::new();
        for &(of, decl) in decls {
            let (members, is_class) = match decl {
                Decl::Class(c) => (self.hir(of)[c].members, true),
                Decl::Interface(i) => (self.hir(of)[i].members, false),
                _ => continue,
            };
            self.collect_index_signatures(of, members, is_class, &mut seen);
        }
        self.report_duplicate_index_signatures(file, &mut seen);
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
    ) {
        let hir = self.hir(file);
        for (key, places) in seen.drain(..) {
            if places.len() > 1 {
                for (_, m) in places.into_iter().filter(|place| place.0 == file) {
                    let start = hir[m].start;
                    let end = hir[m].loc.end;
                    self.error_at((file, start, end), 2374, &[Arg::Type(key)]);
                }
            }
        }
    }
}

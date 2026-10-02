//! Declarations that are out of place or at odds with each other:
//! 2369 2370 2371 2463, 2372 2373, 2428, 2440, 2374, 2717 2403 2687.
//!
//! Follows `checkParameter`, the end of `onSuccessfullyResolvedSymbol`, `checkTypeParameterListsIdentical`, `checkAliasSymbol`,
//! `getSymbolFlags`, `getExternalModuleMember`, `checkTypeForDuplicateIndexSignatures` and
//! `checkVariableLikeDeclaration` of TypeScript 7.0.2's checker.go, and `Resolve` of its nameresolver.go.

use super::*;
use crate::bind::{Decl, PatParent, SymbolId};
use smallvec::SmallVec;

impl Checker<'_> {
    pub(super) fn check_declarations(&mut self, file: FileId) {
        self.check_parameter_references(file);
        self.check_merged_declarations(file);
        self.check_variable_like_declarations(file);
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
        for &(id, within, func) in bound.identifiers_in_parameters.iter() {
            let i = id.idx();
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
                Some(&Decl::Module(m)) => (PatId::NONE, hir[m].name_pos),
                _ => continue,
            };
            // `root.Parent.Locals()`: a local of the function whose parameter it is.
            let scope = bound.fns[func.idx()].scope;
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
                let written = hir[within].pos as usize..self.end_of_pat(file, within) as usize;
                let args = [Arg::Bytes(&hir.text[written]), Arg::Atom(name)];
                self.error_at((file, hir.exprs[i].pos, 0), 2373, &args);
            }
        }
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
                        if !self.is_identical(own, wanted) {
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

    /// What `checkVariableLikeDeclaration` is called for in `file`, where the symbol has other declarations.
    fn check_variable_like_declarations(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The text of the default library is not kept: there is no name to report with.
        if hir.text.is_empty() {
            return;
        }
        for (i, symbol) in bound.symbols.iter().enumerate() {
            if symbol.decls.len() < 2
                && !symbol.flags.contains(SymFlags::MERGED)
                && symbol.name != known::computed
            {
                continue;
            }
            for &node in &symbol.decls {
                let is_checked = match node {
                    Decl::Var(_) | Decl::ParameterProperty(_) => true,
                    // `bindParameter` declares the property last, so that is the symbol of the node.
                    Decl::Param(pat) => !matches!(bound.pat_parent[pat.idx()], PatParent::Param(p)
                        if bound.symbol_of_declaration(Decl::ParameterProperty(p)).is_some()),
                    Decl::Member(m) => hir[m].kind == MemberKind::Property,
                    _ => false,
                };
                // The local symbol of a module or a namespace also lists what is exported under the name.
                if is_checked && bound.symbol_of_declaration(node).idx() == i {
                    self.check_variable_like_declaration(file, node);
                }
            }
        }
    }

    /// The end of `checkVariableLikeDeclaration`, from `t := c.convertAutoToAny(c.getTypeOfSymbol(symbol))` on, but for the initializer.
    pub(super) fn check_variable_like_declaration(&mut self, file: FileId, node: Decl) {
        let (own, hir) = ((file, node), self.hir(file));
        let declarations = self.declarations_of_member(file, node);
        if declarations.len() < 2 {
            return;
        }
        let symbol = match node {
            Decl::Member(m) => self.symbol_of_member(file, m),
            _ => (self.files()).sym(file, self.bound(file).symbol_of_declaration(node)),
        };
        let Some(value_declaration) = self.files().value_declaration(symbol) else {
            return;
        };
        let (start, end) = match node {
            Decl::Member(m) => (hir[m].name_pos, self.end_of_member_name(file, m)),
            Decl::ParameterProperty(p) => (hir[hir[p].pat].pos, self.end_of_pat(file, hir[p].pat)),
            Decl::Var(pat) | Decl::Param(pat) => (hir[pat].pos, self.end_of_pat(file, pat)),
            _ => return,
        };
        // `DeclarationNameToString`
        let (at, name) = (
            (file, start, end),
            Arg::Bytes(&hir.text[start as usize..end as usize]),
        );
        let differs = if value_declaration == own {
            declarations.iter().any(|&d| {
                d != own
                    && self.is_variable_like(d)
                    && !self.are_declaration_flags_identical(d, own)
            })
        } else {
            self.check_type_of_secondary_declaration(symbol, value_declaration, own, at, name);
            !self.are_declaration_flags_identical(own, value_declaration)
        };
        if differs {
            self.error_at(at, 2687, &[name]);
        }
    }

    /// "Node is a secondary declaration, check that type is identical to primary declaration", with
    /// `errorNextVariableOrPropertyDeclarationMustHaveSameType`.
    fn check_type_of_secondary_declaration(
        &mut self,
        symbol: Sym,
        value_declaration: (FileId, Decl),
        node: (FileId, Decl),
        at: (FileId, u32, u32),
        name: Arg<'_>,
    ) {
        // A second parameter of the name is a name taken twice.
        if matches!(node.1, Decl::Param(_))
            || self.files().flags(symbol).contains(SymFlags::ASSIGNMENT)
        {
            return;
        }
        let t = self.get_widened_type_for_variable_like_declaration(value_declaration);
        let declaration_type = self.get_widened_type_for_variable_like_declaration(node);
        if self.is_error_type(t)
            || self.is_error_type(declaration_type)
            || self.is_identical(t, declaration_type)
        {
            return;
        }
        let is_property = matches!(node.1, Decl::Member(_));
        // Of a property or a parameter property only where the two are not even assignable to each other.
        if !matches!(node.1, Decl::Var(_))
            && self.is_any(t) == self.is_any(declaration_type)
            && (self.is_any(t)
                || self.is_assignable(t, declaration_type)
                    && self.is_assignable(declaration_type, t))
        {
            return;
        }
        let (of, first) = value_declaration;
        let related = self.error_range_of_declaration(of, first);
        let related =
            related.map(|(start, end)| self.new_diagnostic((of, start, end), 6203, &[name]));
        let code = if is_property { 2717 } else { 2403 };
        let args = [name, Arg::Type(t), Arg::Type(declaration_type)];
        self.error_at(at, code, &args)
            .related_information
            .extend(related);
    }

    /// `convertAutoToAny(getWidenedTypeForVariableLikeDeclaration(declaration, false))`. Of `symbol.ValueDeclaration` it is
    /// `getTypeOfSymbol(symbol)`.
    fn get_widened_type_for_variable_like_declaration(
        &mut self,
        (file, declaration): (FileId, Decl),
    ) -> TypeId {
        let ty = match declaration {
            Decl::Var(pat) | Decl::Param(pat) => self.type_of_pat(file, pat),
            Decl::ParameterProperty(p) => self.type_of_param(file, p),
            Decl::Member(m) => {
                let ty = self.type_of_member_declaration(file, m);
                let flags = self.hir(file)[m].flags;
                if !flags.contains(Flags::OPTIONAL) {
                    ty
                } else if flags.contains(Flags::ACCESSOR) {
                    self.optional(ty)
                } else {
                    self.optional_property(ty)
                }
            }
            _ => TypeId::UNRESOLVED,
        };
        self.convert_auto_to_any(ty)
    }

    /// `ast.IsVariableLike`
    fn is_variable_like(&self, (file, decl): (FileId, Decl)) -> bool {
        match decl {
            Decl::Member(m) => self.hir(file)[m].kind == MemberKind::Property,
            Decl::Var(_) | Decl::Param(_) | Decl::ParameterProperty(_) => true,
            _ => matches!(decl, Decl::EnumMember(_) | Decl::Property(_)),
        }
    }

    /// `areDeclarationFlagsIdentical`
    fn are_declaration_flags_identical(&self, left: (FileId, Decl), right: (FileId, Decl)) -> bool {
        // The parameter a declaration is, as opposed to a binding element in one.
        let parameter = |(file, decl): (FileId, Decl)| match decl {
            Decl::ParameterProperty(p) => Some(p),
            Decl::Param(pat) => match self.bound(file).pat_parent[pat.idx()] {
                PatParent::Param(p) => Some(p),
                _ => None,
            },
            _ => None,
        };
        let is_variable_declaration = |(file, decl): (FileId, Decl)| {
            matches!(decl, Decl::Var(pat)
                if matches!(self.bound(file).pat_parent[pat.idx()], PatParent::Var(_)))
        };
        // `isOptionalDeclaration`, `getSelectedModifierFlags`
        let interesting_flags = Flags::OPTIONAL
            | Flags::PRIVATE
            | Flags::PROTECTED
            | Flags::ASYNC
            | Flags::ABSTRACT
            | Flags::READONLY
            | Flags::STATIC;
        let flags = |declaration: (FileId, Decl)| {
            let hir = self.hir(declaration.0);
            interesting_flags
                & match (declaration.1, parameter(declaration)) {
                    (Decl::Member(m), _) => hir[m].flags,
                    (_, Some(p)) => hir[p].flags,
                    _ => Flags::empty(),
                }
        };
        // "Differences in optionality between parameters and variables are allowed."
        parameter(left).is_some() && is_variable_declaration(right)
            || is_variable_declaration(left) && parameter(right).is_some()
            || flags(left) == flags(right)
    }

    /// `checkTypeForDuplicateIndexSignatures`: 2374, of each `__index` that a class, an interface or a type literal of `file` has.
    fn check_index_signatures(&mut self, file: FileId) {
        let (bound, files) = (self.bound(file), self.files());
        for (i, symbol) in bound.symbols.iter().enumerate() {
            if symbol.name != known::index_signature
                || symbol.decls.len() < 2 && !symbol.flags.contains(SymFlags::MERGED)
            {
                continue;
            }
            let index_symbol = files.sym(file, SymbolId(i as u32));
            // `getIndexSymbol`: among the members. What is static in a class is among its exports, which are not looked at.
            if files
                .parent_of_symbol(index_symbol)
                .and_then(|parent| files.member(parent, known::index_signature))
                != Some(index_symbol)
            {
                continue;
            }
            let mut index_signature_map: Vec<(TypeId, SmallVec<[(FileId, MemberId); 2]>)> =
                Vec::new();
            for (of, m) in members_among(&files.decls_of(index_symbol)) {
                let hir = self.hir(of);
                let parameters = hir[hir[m].func].params;
                if parameters.len() != 1 || hir[parameters.at(0)].ty.is_none() {
                    continue;
                }
                let keys = self.type_from_node(of, hir[parameters.at(0)].ty);
                for &t in self.parts(keys) {
                    match index_signature_map.iter_mut().find(|it| it.0 == t) {
                        Some(entry) => entry.1.push((of, m)),
                        None => index_signature_map.push((t, smallvec::smallvec![(of, m)])),
                    }
                }
            }
            for (t, declarations) in index_signature_map {
                for (of, m) in declarations
                    .iter()
                    .copied()
                    .filter(|_| declarations.len() > 1)
                {
                    let member = &self.hir(of)[m];
                    self.error_at((of, member.start, member.loc.end), 2374, &[Arg::Type(t)]);
                }
            }
        }
    }
}

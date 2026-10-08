//! Misplaced or conflicting declarations:
//! 2369 2370 2371 2463, 2372 2373, 2428, 2440, 2374, 2717 2403 2687.
//!
//! Follows `checkParameter`, the end of `onSuccessfullyResolvedSymbol`,
//! `checkTypeParameterListsIdentical`, `checkAliasSymbol`, `getSymbolFlags`,
//! `getExternalModuleMember`, `checkTypeForDuplicateIndexSignatures` and
//! `checkVariableLikeDeclaration` of TypeScript 7.0.2's checker.go, and `Resolve` of its
//! nameresolver.go.

use super::*;
use crate::bind::{Decl, PatParent, SymbolId};
use smallvec::SmallVec;

impl Checker<'_, '_> {
    pub(super) fn check_declarations(&mut self, file: FileId) {
        self.check_parameter_references(file);
        self.check_merged_declarations(file);
        self.check_variable_like_declarations(file);
        self.check_index_signatures(file);
    }

    /// `check_reference_in_parameter` for the identifiers of `file`.
    fn check_parameter_references(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &(id, within, _) in bound.identifiers_in_parameters.iter() {
            let local = bound.expr_symbol[id.idx()];
            if local.is_none() || bound.is_in_type_query(id) || bound.is_unchecked(id.idx()) {
                continue;
            }
            let candidate = self.files().sym(file, local);
            let associated_declaration = hir.node(Decl::Param(within));
            self.check_reference_in_parameter(
                file,
                hir.node(id),
                candidate,
                associated_declaration,
            );
        }
    }

    /// `onSuccessfullyResolvedSymbol`: "If we're in a parameter initializer or binding name, we
    /// can't reference the values of the parameter whose initializer we're within or parameters to
    /// the right". `associated_declaration`:
    /// `associatedDeclarationForContainingInitializerOrBindingName`, where the name is not
    /// `withinDeferredContext` and is resolved as a value.
    pub(super) fn check_reference_in_parameter(
        &mut self,
        file: FileId,
        error_location: Node,
        candidate: Sym,
        associated_declaration: Node,
    ) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let name = hir.name(associated_declaration);
        // `bindParameter` declares the property last: it is the symbol of a parameter property.
        let property = match hir.data(associated_declaration) {
            NodeData::Param(p) => bound.symbol_of_declaration(Decl::ParameterProperty(p)),
            _ => SymbolId::NONE,
        };
        let declared = match hir.data(name) {
            _ if property.is_some() => property,
            NodeData::Pat(name) => bound.pat_symbol[name.idx()],
            _ => SymbolId::NONE,
        };
        // `DeclarationNameToString`
        let text_of = |c: &Self, node: Node| {
            let written = hir.start(node) as usize..c.end_of_node(file, node) as usize;
            hir.text.get(written).unwrap_or_default()
        };
        if declared.is_some() && candidate == files.sym(file, declared) {
            let args = [Arg::Bytes(text_of(self, name))];
            self.error(file, error_location, 2372, &args);
            return;
        }
        let root = hir.get_root_declaration(associated_declaration);
        let function = hir.function_of(hir.parent(root));
        let is_declared_after =
            files
                .value_declaration(candidate)
                .is_some_and(|(of, declaration)| {
                    of == file
                        && hir.start(hir.node(declaration)) > hir.start(associated_declaration)
                });
        if !is_declared_after || function.is_none() {
            return;
        }
        let locals = bound.scopes[bound.fns[function.idx()].scope.idx()].locals;
        let local = bound.lookup(locals, files.symbol(candidate).name);
        if local.map(|local| files.sym(file, local)) == Some(candidate) {
            let args = [
                Arg::Bytes(text_of(self, name)),
                Arg::Bytes(text_of(self, error_location)),
            ];
            self.error(file, error_location, 2373, &args);
        }
    }

    /// Merged declarations: 2428 2374.
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

    /// `checkTypeParameterListsIdentical` for the declarations `decls` that merge into `sym`.
    fn check_type_parameter_lists_identical(
        &mut self,
        file: FileId,
        sym: Sym,
        decls: &[(FileId, Decl)],
    ) {
        // With `declaration.Name()`, which is nil for `export default class {}`.
        let lists: Vec<(FileId, Span<TypeParamId>, Option<u32>)> = decls
            .iter()
            .filter_map(|&(f, d)| match d {
                Decl::Class(c) => {
                    let class = &self.hir(f)[c];
                    let name = class.name.is_some().then_some(class.name_pos);
                    Some((f, class.type_params, name))
                }
                Decl::Interface(i) => {
                    Some((f, self.hir(f)[i].type_params, Some(self.hir(f)[i].name_pos)))
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
                for (node, expected) in [
                    (decl.constraint, self.constraint_of_type_param(targets[k])),
                    (decl.default, self.default_of_type_param(targets[k])),
                ] {
                    if node.is_some()
                        && let Some(expected) = expected
                    {
                        let own = self.type_from_node(f, node);
                        if !self.is_identical(own, expected) {
                            identical = false;
                            break 'all;
                        }
                    }
                }
            }
        }
        if !identical {
            for l in lists.iter().filter(|l| l.0 == file) {
                match l.2 {
                    Some(name) => {
                        self.error_at((file, name, 0), 2428, &[Arg::Sym(sym)]);
                    }
                    // `c.error(nil, ..)`
                    None => {
                        let at = super::explain::NOWHERE;
                        let diagnostic = self.new_diagnostic(at, 2428, &[Arg::Sym(sym)]);
                        self.add_diagnostic_of(None, diagnostic);
                    }
                }
            }
        }
    }

    /// The variables and parameters of `file` that `checkVariableLikeDeclaration` is called for,
    /// where the symbol has other declarations. `check_members` calls it for a property.
    fn check_variable_like_declarations(&mut self, file: FileId) {
        let bound = self.bound(file);
        for (i, symbol) in bound.symbols.iter().enumerate() {
            // A late-bound member can be another declaration of a parameter property.
            if symbol.decls.len() < 2
                && !symbol.flags.contains(SymFlags::MERGED)
                && !matches!(symbol.decls.first(), Some(Decl::ParameterProperty(_)))
            {
                continue;
            }
            for &node in &symbol.decls {
                let is_checked = match node {
                    Decl::Var(_) | Decl::ParameterProperty(_) => true,
                    // `bindParameter` declares the property last, so that is the symbol of the node.
                    Decl::Param(pat) => !matches!(bound.pat_parent[pat.idx()], PatParent::Param(p)
                        if bound.symbol_of_declaration(Decl::ParameterProperty(p)).is_some()),
                    _ => false,
                };
                // The local symbol of a module or a namespace also lists the declarations exported
                // under the name.
                if is_checked && bound.symbol_of_declaration(node).idx() == i {
                    let current = CurrentNode::Node(file, self.hir(file).node(node));
                    let saved = self.enter_source_element(current);
                    self.check_variable_like_declaration(file, node);
                    self.current_source_element = saved;
                }
            }
        }
    }

    /// The end of `checkVariableLikeDeclaration`, starting at `if ast.IsBigIntLiteral(name)`,
    /// except for the initializer.
    pub(super) fn check_variable_like_declaration(&mut self, file: FileId, node: Decl) {
        let (own, hir) = ((file, node), self.hir(file));
        // The source text of the default library is not stored: there is no name to report.
        if hir.text.is_empty() {
            return;
        }
        if let Decl::Member(m) = node
            && hir[m].key == PropKey::None
            && is_bigint_literal_at(hir, hir[m].name_pos)
        {
            self.error_at((file, hir[m].name_pos, 0), 1539, &[]);
        }
        let declarations = self.declarations_of_symbol_of_checked_declaration(file, node);
        if declarations.len() < 2 {
            return;
        }
        let symbol = match node {
            Decl::Member(m) => self.symbol_of_member(file, m),
            _ => (self.files()).sym(file, self.bound(file).symbol_of_declaration(node)),
        };
        let Some(value_declaration) = self.value_declaration_of_property(symbol) else {
            return;
        };
        let (start, end) = match node {
            Decl::Member(m) => (hir[m].name_pos, self.end_of_member_name(file, m)),
            Decl::ParameterProperty(p) => (hir[hir[p].pat].pos, self.end_of_pat(file, hir[p].pat)),
            Decl::Var(pat) | Decl::Param(pat) => (hir[pat].pos, self.end_of_pat(file, pat)),
            _ => return,
        };
        let start = super::spans::start_of_error_range(hir, start, end);
        // `DeclarationNameToString`
        let name: &[u8] = match start == end {
            true => b"(Missing)",
            false => &hir.text[start as usize..end as usize],
        };
        let (at, name) = ((file, start, end), Arg::Bytes(name));
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
        // A second parameter with the same name is a duplicate identifier.
        if matches!(node.1, Decl::Param(_))
            || self.files().flags(symbol).contains(SymFlags::ASSIGNMENT)
        {
            return;
        }
        // `getTypeOfSymbol`: `getTypeOfAccessors` adds no optionality.
        let t = if self.files().flags(symbol).intersects(SymFlags::ACCESSOR)
            || self.is_prototype_symbol(symbol)
        {
            let ty = self.type_of_symbol(symbol);
            self.convert_auto_to_any(ty)
        } else {
            self.get_widened_type_for_variable_like_declaration(value_declaration)
        };
        let declaration_type = self.get_widened_type_for_variable_like_declaration(node);
        if self.is_error_type(t)
            || self.is_error_type(declaration_type)
            || self.is_identical(t, declaration_type)
        {
            return;
        }
        let is_property = matches!(node.1, Decl::Member(_));
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

    /// `convertAutoToAny(getWidenedTypeForVariableLikeDeclaration(declaration, false))`. For
    /// `symbol.ValueDeclaration` it is `getTypeOfSymbol(symbol)`.
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
        // The parameter, if the declaration is a parameter itself rather than a binding element in
        // one.
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

    /// `checkTypeForDuplicateIndexSignatures`: 2374 for each `__index` of a class, an interface or
    /// a type literal of `file`.
    fn check_index_signatures(&mut self, file: FileId) {
        let (bound, files) = (self.bound(file), self.files());
        let unchecked = self.unchecked_jsdoc_types(file);
        for (i, symbol) in bound.symbols.iter().enumerate() {
            if symbol.name != known::index_signature
                || symbol.decls.len() < 2 && !symbol.flags.contains(SymFlags::MERGED)
                || matches!(symbol.decls.first(), Some(&Decl::Member(m)) if unchecked.contain(self.hir(file)[m].start))
            {
                continue;
            }
            let index_symbol = files.sym(file, SymbolId(i as u32));
            // `getIndexSymbol`: among the members. Static members of a class are among its exports,
            // which are not searched.
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

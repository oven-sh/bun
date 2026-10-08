//! `getSymbolAtLocation`: what a name refers to.

use super::super::errors_small::SymbolAtLocation;
use super::symbols::Key;
use super::*;
use crate::node::Part;

impl<'c, 'p, 's> Services<'c, 'p, 's> {
    fn symbol_found(&mut self, found: SymbolAtLocation<'p>) -> SymbolRef {
        let key = match found {
            SymbolAtLocation::Symbol(symbol) => return self.symbol(symbol),
            SymbolAtLocation::Instantiated(symbol, instantiation) => Key::Instantiated(symbol, instantiation),
            SymbolAtLocation::Property(source, name) => Key::Property(source, name, MapperId::IDENTITY),
            SymbolAtLocation::Index(ty, declaration) => Key::Index(ty, declaration),
            SymbolAtLocation::IndexOfSeveral => return self.unique_symbol(),
            SymbolAtLocation::ThisParameter(file, function) => Key::ThisParameter(file, function),
            SymbolAtLocation::Anonymous(file, node) => Key::Anonymous(file, node),
        };
        self.intern_symbol(key, None)
    }

    /// `type.symbol`
    pub fn symbol_of_type(&mut self, ty: TypeId) -> Option<SymbolRef> {
        // The declared type of an enum with several members is a union that has the symbol of the
        // enum.
        if self.c.flags(ty) & (tf::UNION | tf::ENUM_LITERAL) == tf::UNION | tf::ENUM_LITERAL
            && let Some(symbol) = self.c.alias_symbol_of_type(ty)
        {
            return Some(self.symbol(symbol));
        }
        if let TypeData::UniqueSymbol { symbol, .. } = *self.c.data(ty) {
            return match symbol {
                UniqueSymbolDeclaration::Variable(symbol) => Some(self.symbol(symbol)),
                UniqueSymbolDeclaration::Member(file, member) => {
                    let symbol = self.c.symbol_of_member(file, member);
                    Some(self.symbol(symbol))
                }
                UniqueSymbolDeclaration::SymbolConstructor => None,
            };
        }
        let found = self.c.symbol_of_type(ty)?;
        Some(self.symbol_found(found))
    }

    /// `getSymbolAtLocation`
    pub fn symbol_at_location(&mut self, node: NodeRef) -> Option<SymbolRef> {
        let (hir, at) = self.valid(node)?;
        let (file, files, bound) = (node.file, self.c.files(), self.c.bound(node.file));
        if at == Node::FILE {
            return files.module(file).is_module().then(|| self.symbol(files.file_symbol(file)));
        }
        let start = hir.start(at);
        if hir.is_in_with(start) || hir.is_in_jsdoc(start) {
            return None;
        }
        // The specifier of an import or an export: the module.
        if at.part() == Some(Part::Specifier) {
            let specifier = Some(hir.text(at)).filter(|text| text.is_some())?;
            let module = files.module_of_specifier(file, specifier)?;
            return Some(self.symbol(module));
        }
        match self.visited_kind(node)? {
            VisitedKind::DeclarationName(_, symbol) => Some(self.symbol(files.sym(file, symbol.some()?))),
            VisitedKind::SpecifierPropertyName(_, symbol) => {
                let symbol = self.symbol(files.sym(file, symbol.some()?));
                self.symbol_op(SymbolOp::ImmediateAliased, symbol)
            }
            VisitedKind::LiteralInEnumMemberName(m) => Some(self.symbol(files.sym(file, bound.enum_member_symbol[m.idx()].some()?))),
            VisitedKind::MemberName(m) | VisitedKind::LiteralInMemberName(m) => {
                let symbol = self.c.symbol_of_member(file, m);
                symbol.id.is_some().then(|| self.symbol(symbol))
            }
            VisitedKind::PropertyName(p) | VisitedKind::LiteralInPropertyName(p) => {
                let name = hir[p].key.name()?;
                let owner = *bound.prop_owner.get(p.idx())?;
                let ty = self.c.type_of_expr(file, owner.some()?);
                let (prop, mapper) = self.c.get_property_of_type(ty, name)?;
                Some(self.symbol_of_prop(prop, mapper))
            }
            VisitedKind::BindingName(pat) => {
                // `bindParameter` declares the property last, so that is the symbol of the node.
                if let crate::bind::PatParent::Param(parameter) = bound.pat_parent[pat.idx()]
                    && hir[parameter].flags.contains(Flags::PARAMETER_PROPERTY)
                    && hir[bound.param_fn[parameter.idx()]].kind == FnKind::Constructor
                {
                    let property = bound.symbol_of_declaration(Decl::ParameterProperty(parameter));
                    return Some(self.symbol(files.sym(file, property.some()?)));
                }
                Some(self.symbol(files.sym(file, bound.pat_symbol[pat.idx()].some()?)))
            }
            VisitedKind::LiteralInBindingPropertyName(p) => {
                let value = hir[p].value.some()?;
                Some(self.symbol(files.sym(file, bound.pat_symbol[value.idx()].some()?)))
            }
            VisitedKind::ThisParameter(f) => Some(self.intern_symbol(Key::ThisParameter(file, f), None)),
            VisitedKind::TypeReferenceName(reference, index)
            | VisitedKind::HeritageClauseName(reference, index)
            | VisitedKind::HeritageClausePropertyAccess(reference, index) => {
                let TypeNodeKind::Ref { name, .. } = hir[reference].kind else {
                    return None;
                };
                let scope = bound.type_scope[reference.idx()].some()?;
                let names: SmallVec<[Atom; 4]> = hir.texts(name).take(index as usize + 1).collect();
                let meaning = match names.len() == name.len() {
                    true => SymFlags::TYPE,
                    false => SymFlags::NAMESPACE,
                };
                let symbol = self.c.resolve_entity(file, scope, &names, meaning)?;
                Some(self.symbol(symbol))
            }
            VisitedKind::ImportEqualsName(import, index) => {
                let ImportEqualsTarget::Entity(list) = hir[import].target else {
                    return None;
                };
                let names: SmallVec<[Atom; 4]> = hir.texts(list).take(index as usize + 1).collect();
                let meaning = match index > 0 && names.len() == list.len() {
                    true => SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE,
                    false => SymFlags::NAMESPACE,
                };
                let scope = bound.import_equals_scope[import.idx()];
                Some(self.symbol(files.resolve_entity(file, scope, &names, meaning)?))
            }
            VisitedKind::Expression(e) if matches!(hir[e].kind, ExprKind::Dot { .. }) => {
                let found = self.c.get_symbol_at_location(file, hir.name(at))?;
                Some(self.symbol_found_at_access(file, e, found))
            }
            VisitedKind::AccessName(e) if matches!(hir[e].kind, ExprKind::Dot { .. }) => {
                let found = self.c.get_symbol_at_location(file, at)?;
                Some(self.symbol_found_at_access(file, e, found))
            }
            // `a["name"]`, `a[0]`: the property.
            VisitedKind::Expression(e) if matches!(hir[e].kind, ExprKind::String(_) | ExprKind::Number(_)) => {
                let crate::bind::Parent::Expr(parent) = *bound.expr_parent.get(e.idx())? else {
                    return None;
                };
                let ExprKind::Index { obj, index, .. } = hir[parent.some()?].kind else {
                    return None;
                };
                if index != e {
                    return None;
                }
                let name = match hir[e].kind {
                    ExprKind::String(text) => text,
                    ExprKind::Number(number) => self.c.number_name(*hir.numbers.get(number as usize)?),
                    _ => return None,
                };
                let ty = self.c.type_of_expr(file, obj);
                let (prop, mapper) = self.c.get_property_of_type(ty, name)?;
                Some(self.symbol_of_prop(prop, mapper))
            }
            _ => {
                let found = self.c.get_symbol_at_location(file, at)?;
                Some(self.symbol_found(found))
            }
        }
    }

    /// The symbol `found` for the name of the property access `e`, with the property that it is.
    fn symbol_found_at_access(&mut self, file: FileId, e: ExprId, found: SymbolAtLocation<'p>) -> SymbolRef {
        if let ExprKind::Dot { obj, name, .. } = self.c.hir(file)[e].kind
            && !matches!(found, SymbolAtLocation::Index(..) | SymbolAtLocation::IndexOfSeveral)
        {
            let receiver = self.c.type_of_expr(file, obj);
            let ty = self.c.non_nullable(receiver);
            if let Some((prop, mapper)) = self.c.get_property_of_type(ty, name) {
                return self.symbol_of_prop(prop, mapper);
            }
        }
        self.symbol_found(found)
    }

    pub fn shorthand_assignment_value_symbol(&mut self, node: NodeRef) -> Option<SymbolRef> {
        let (hir, at) = self.valid(node)?;
        let NodeData::Prop(p) = hir.data(at) else {
            return None;
        };
        if hir[p].kind != PropKind::Shorthand {
            return None;
        }
        let value = match hir[hir[p].value].kind {
            ExprKind::Assign { target, .. } => target,
            _ => hir[p].value,
        };
        let ExprKind::Ident(name) = hir[value].kind else {
            return None;
        };
        let symbol = self.c.resolve_identifier(node.file, value, name, true).ok()??;
        Some(self.symbol(symbol))
    }

    pub fn resolve_name(
        &mut self,
        node: NodeRef,
        name: &[u8],
        meaning: SymbolFlags,
        exclude_globals: bool,
    ) -> Option<SymbolRef> {
        let name = self.c.atoms().lookup(name)?;
        let scope = self.scope_at(node)?;
        let files = self.c.files();
        let symbol = files.resolve_name(node.file, scope, name, SymFlags::from(meaning))?;
        if exclude_globals && files.global(name, SymFlags::from(meaning)) == Some(symbol) {
            return None;
        }
        Some(self.symbol(symbol))
    }

    /// `getSymbolsInScope`: the innermost declaration of each name comes first, and only that.
    pub fn symbols_in_scope(&mut self, node: NodeRef, meaning: SymbolFlags) -> &'c [SymbolRef] {
        let Some(mut scope) = self.scope_at(node) else {
            return &[];
        };
        let (files, bound) = (self.c.files(), self.c.bound(node.file));
        let meaning = SymFlags::from(meaning);
        let mut seen: FxHashMap<Atom, ()> = FxHashMap::default();
        let mut found: Vec<Sym> = Vec::new();
        let mut depth = 0;
        while let Some(at) = bound.scopes.get(scope.idx()) {
            let mut names: SmallVec<[Atom; 16]> = SmallVec::new();
            if at.locals.is_some() {
                names.extend(bound.table(at.locals).iter().map(|it| it.0));
            }
            if at.symbol.is_some() {
                names.extend(files.each_export(files.sym(node.file, at.symbol)).map(|it| it.0));
            }
            for name in names {
                if seen.insert(name, ()).is_none()
                    && let Some(symbol) = files.resolve_name(node.file, scope, name, meaning)
                {
                    found.push(symbol);
                }
            }
            scope = at.parent;
            depth += 1;
            if scope.is_none() || depth > 4096 {
                break;
            }
        }
        let symbols: Vec<SymbolRef> = found.into_iter().map(|it| self.symbol(it)).collect();
        self.list(&symbols)
    }
}

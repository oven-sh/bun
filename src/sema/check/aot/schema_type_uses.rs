use super::answers::CheckedType;
use super::queries::Queries;
use crate::bind::Decl;
use crate::hir::{
    ExprId, File, IdList, MemberId, MemberKind, Span, TypeNodeId, TypeNodeKind, TypeParamId,
};
use crate::program::{FileId, Sym};
use crate::util::FxHashSet;

/// `Schema.FromJSONSchema<S, ..>` where it is written.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SchemaTypeUse {
    pub file: FileId,
    pub reference: TypeNodeId,
    /// `schema` of `typeof schema`, an expression of `file`. `None`: `S` is written in another way.
    pub schema: Option<ExprId>,
    pub ty: CheckedType,
    /// It stands beside other types in an intersection, or an interface extends it: what they declare counts as declared by it.
    pub is_intersected: bool,
    /// It, or a type that holds it, is handed to another type, which may turn its answer round.
    pub is_operand: bool,
}

#[derive(Default, Debug)]
pub struct SchemaTypeUses {
    pub uses: Vec<SchemaTypeUse>,
    /// More declarations are named than were read, so there may be more uses.
    pub is_cut_short: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
struct Place {
    is_intersected: bool,
    is_operand: bool,
}

impl Place {
    const WHOLE: Place = Place {
        is_intersected: false,
        is_operand: false,
    };

    fn of_part(self) -> Place {
        Place {
            is_intersected: false,
            ..self
        }
    }

    fn of_intersected(self) -> Place {
        Place {
            is_intersected: true,
            ..self
        }
    }

    fn of_operand(self) -> Place {
        Place {
            is_intersected: false,
            is_operand: true,
        }
    }
}

struct Walk {
    translation: Sym,
    /// `Schema.JSONSchema`, which holds what the translation is made of.
    parts_of_translation: Option<Sym>,
    found: SchemaTypeUses,
    pending: Vec<(FileId, TypeNodeId, Place)>,
    entered: FxHashSet<(Sym, Place)>,
    max_declarations: usize,
}

impl Walk {
    fn push(&mut self, file: FileId, nodes: impl Iterator<Item = TypeNodeId>, place: Place) {
        let written = nodes.filter(|node| node.is_some());
        self.pending.extend(written.map(|node| (file, node, place)));
    }

    fn push_members(
        &mut self,
        hir: &File<'_>,
        file: FileId,
        members: Span<MemberId>,
        place: Place,
    ) {
        let holds_data = |member: &MemberId| {
            matches!(
                hir[*member].kind,
                MemberKind::Property | MemberKind::IndexSignature
            )
        };
        let types = members.iter().filter(holds_data);
        self.push(file, types.map(|member| hir[member].ty), place.of_part());
    }

    fn push_defaults(
        &mut self,
        hir: &File<'_>,
        file: FileId,
        parameters: Span<TypeParamId>,
        place: Place,
    ) {
        let defaults = parameters.iter().map(|parameter| hir[parameter].default);
        self.push(file, defaults, place.of_operand());
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    /// Every `Schema.FromJSONSchema<..>` that the type at `node` is written with, through the aliases and interfaces that it names. At most `max_declarations` of them are read.
    /// A type that is reached through a value (`typeof value`) or is inferred is not followed.
    pub fn schema_types_written_under(
        &mut self,
        node: TypeNodeId,
        max_declarations: usize,
    ) -> SchemaTypeUses {
        let Some(translation) = self.c.p.aot_symbols().from_json_schema() else {
            return SchemaTypeUses::default();
        };
        let cut_short = SchemaTypeUses {
            uses: Vec::new(),
            is_cut_short: true,
        };
        let found = self.ask(|queries| {
            let mut walk = Walk {
                translation,
                parts_of_translation: queries.find_parts_of_translation(translation),
                found: SchemaTypeUses::default(),
                pending: vec![(queries.file, node, Place::WHOLE)],
                entered: FxHashSet::default(),
                max_declarations,
            };
            while let Some((file, node, place)) = walk.pending.pop() {
                queries.visit_node_for_schema_types(&mut walk, file, node, place);
            }
            Ok(walk.found)
        });
        found.unwrap_or(cut_short)
    }

    fn find_parts_of_translation(&self, translation: Sym) -> Option<Sym> {
        let files = self.c.files();
        let schema = files.parent_of_symbol(translation)?;
        let name = files.atoms.lookup(b"JSONSchema")?;
        files
            .export(schema, name)
            .map(|parts| files.canonical(parts))
    }

    fn visit_node_for_schema_types(
        &mut self,
        walk: &mut Walk,
        file: FileId,
        node: TypeNodeId,
        place: Place,
    ) {
        let hir = self.c.hir(file);
        let operand = place.of_operand();
        match hir[node].kind {
            TypeNodeKind::Ref { name, args } => {
                let symbol = self.find_referenced_symbol(file, node, name);
                self.visit_reference_for_schema_types(walk, file, node, symbol, args, place);
            }
            TypeNodeKind::Import {
                args,
                is_typeof: false,
                ..
            } => {
                let symbol = self.find_imported_symbol(file, node);
                self.visit_reference_for_schema_types(walk, file, node, symbol, args, place);
            }
            TypeNodeKind::Readonly(written) | TypeNodeKind::JSDoc { ty: written, .. } => {
                walk.push(file, [written].into_iter(), place);
            }
            TypeNodeKind::Union(list) => walk.push(file, hir.ids(list), place),
            TypeNodeKind::Intersection(list) => {
                walk.push(file, hir.ids(list), place.of_intersected());
            }
            TypeNodeKind::Array(element) => walk.push(file, [element].into_iter(), place.of_part()),
            TypeNodeKind::Tuple(elements) => {
                let types = elements.iter().map(|element| hir[element].ty);
                walk.push(file, types, place.of_part());
            }
            TypeNodeKind::Object(members) => walk.push_members(hir, file, members, place),
            TypeNodeKind::Mapped(mapped) => {
                let mapped = hir[mapped];
                let constraint = hir[mapped.param].constraint;
                walk.push(
                    file,
                    [constraint, mapped.name_ty, mapped.ty].into_iter(),
                    operand,
                );
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => walk.push(file, [check, extends, yes, no].into_iter(), operand),
            TypeNodeKind::IndexedAccess { obj, index } => {
                walk.push(file, [obj, index].into_iter(), operand);
            }
            TypeNodeKind::Keyof(written)
            | TypeNodeKind::Unique(written)
            | TypeNodeKind::Predicate { ty: written, .. } => {
                walk.push(file, [written].into_iter(), operand);
            }
            TypeNodeKind::Template { types, .. } => walk.push(file, hir.ids(types), operand),
            TypeNodeKind::Heritage { args, .. } => walk.push(file, hir.ids(args), operand),
            TypeNodeKind::Infer(parameter) => {
                walk.push(file, [hir[parameter].constraint].into_iter(), operand);
            }
            TypeNodeKind::Import {
                is_typeof: true, ..
            }
            | TypeNodeKind::Typeof { .. }
            | TypeNodeKind::Fn(_)
            | TypeNodeKind::Error
            | TypeNodeKind::Keyword(_)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_)
            | TypeNodeKind::UniqueSymbol => {}
        }
    }

    fn visit_reference_for_schema_types(
        &mut self,
        walk: &mut Walk,
        file: FileId,
        reference: TypeNodeId,
        symbol: Option<Sym>,
        arguments: IdList<TypeNodeId>,
        place: Place,
    ) {
        let hir = self.c.hir(file);
        walk.push(file, hir.ids(arguments), place.of_operand());
        let Some(symbol) = symbol else {
            return;
        };
        let symbol = self.c.files().canonical(symbol);
        let is_translation = symbol == walk.translation;
        let holder = self.c.files().parent_of_symbol(symbol);
        let holder = holder.map(|holder| self.c.files().canonical(holder));
        if !is_translation && (holder.is_none() || holder != walk.parts_of_translation) {
            self.enter_declarations_for_schema_types(walk, symbol, place);
            return;
        }
        let mut known = walk.found.uses.iter_mut();
        if let Some(known) = known.find(|known| (known.file, known.reference) == (file, reference))
        {
            known.is_intersected |= place.is_intersected;
            known.is_operand |= place.is_operand;
            return;
        }
        let declared = self.c.type_from_node(file, reference);
        let written = hir.ids(arguments).next().map(|schema| hir[schema].kind);
        let schema = match written {
            Some(TypeNodeKind::Typeof {
                has_type_arguments: false,
                expr,
                ..
            }) if is_translation && !self.c.has_type_variables(declared) => Some(expr),
            Some(_) | None => None,
        };
        walk.found.uses.push(SchemaTypeUse {
            file,
            reference,
            schema,
            ty: self.resolved(declared),
            is_intersected: place.is_intersected,
            is_operand: place.is_operand,
        });
    }

    fn enter_declarations_for_schema_types(&mut self, walk: &mut Walk, symbol: Sym, place: Place) {
        if walk.entered.contains(&(symbol, place)) {
            return;
        }
        if walk.entered.len() >= walk.max_declarations {
            walk.found.is_cut_short = true;
            return;
        }
        walk.entered.insert((symbol, place));
        for &(declared_in, declaration) in self.c.files().decls_of(symbol).iter() {
            let hir = self.c.hir(declared_in);
            match declaration {
                Decl::Alias(alias) => {
                    let alias = hir[alias];
                    walk.push(declared_in, [alias.ty].into_iter(), place);
                    walk.push_defaults(hir, declared_in, alias.type_params, place);
                }
                Decl::Interface(interface) => {
                    let interface = hir[interface];
                    walk.push_members(hir, declared_in, interface.members, place);
                    let extended = hir.ids(interface.extends);
                    walk.push(declared_in, extended, place.of_intersected());
                    walk.push_defaults(hir, declared_in, interface.type_params, place);
                }
                Decl::Var(_)
                | Decl::Param(_)
                | Decl::Fn(_)
                | Decl::Class(_)
                | Decl::Enum(_)
                | Decl::EnumMember(_)
                | Decl::Module(_)
                | Decl::TypeParam(_)
                | Decl::ImportDefault(_)
                | Decl::ImportNamespace(_)
                | Decl::ImportSpec(_)
                | Decl::ImportEquals(_)
                | Decl::ExportSpec(_)
                | Decl::ExportStarAs(_)
                | Decl::ExportExpr(_)
                | Decl::UmdGlobal(_)
                | Decl::File
                | Decl::Require(_)
                | Decl::ModuleExports(_)
                | Decl::ExportsProperty(_)
                | Decl::Expando(_)
                | Decl::ObjectLiteral(_)
                | Decl::CommonJsVariable
                | Decl::Member(_)
                | Decl::ParameterProperty(_)
                | Decl::ThisProperty(_)
                | Decl::Property(_)
                | Decl::TypeLiteral(_) => {}
            }
        }
    }
}

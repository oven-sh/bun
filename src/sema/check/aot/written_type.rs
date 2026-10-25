use super::answers::{GaveUp, WrittenType};
use super::queries::{AliasForm, AliasScan, Queries};
use crate::atom::known;
use crate::bind::{Decl, SymFlags};
use crate::check::decl::is_variadic_tuple_element;
use crate::check::errors_type_nodes::rest_element_type_node;
use crate::components::strongly_connected_components;
use crate::hir::{
    self, Alias, ExprId, ExprKind, IdList, NameId, Span, TupleElem, TupleElemId, TypeNodeId,
    TypeNodeKind,
};
use crate::program::{FileId, Sym};
use crate::types::{Intrinsic, MapperId, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

type Forms = SmallVec<[TypeId; 8]>;
type PendingNodes = SmallVec<[TypeNodeId; 8]>;

#[derive(Default)]
struct NamedTypes {
    symbols: SmallVec<[Sym; 8]>,
    has_untrusted_part: bool,
    reads_declarations: bool,
}

struct ScannedSymbol {
    symbol: Sym,
    referrers: SmallVec<[usize; 4]>,
    mentions_untrusted_alias: bool,
}

#[derive(Default)]
struct AliasScanGraph {
    nodes: Vec<ScannedSymbol>,
    index_of: FxHashMap<Sym, usize>,
}

impl AliasScanGraph {
    fn add(&mut self, symbol: Sym) {
        self.index_of.insert(symbol, self.nodes.len());
        self.nodes.push(ScannedSymbol {
            symbol,
            referrers: SmallVec::new(),
            mentions_untrusted_alias: false,
        });
    }

    fn add_referrer(&mut self, symbol: Sym, referrer: usize) -> bool {
        let Some(&index) = self.index_of.get(&symbol) else {
            return false;
        };
        self.nodes[index].referrers.push(referrer);
        true
    }

    fn propagate_mentions(&mut self) {
        let mut pending: Vec<usize> = (0..self.nodes.len())
            .filter(|&index| self.nodes[index].mentions_untrusted_alias)
            .collect();
        while let Some(index) = pending.pop() {
            for referrer in std::mem::take(&mut self.nodes[index].referrers) {
                if !self.nodes[referrer].mentions_untrusted_alias {
                    self.nodes[referrer].mentions_untrusted_alias = true;
                    pending.push(referrer);
                }
            }
        }
    }

    fn mentions_untrusted_alias(&self, symbol: Sym) -> bool {
        let index = self.index_of.get(&symbol);
        index.is_some_and(|&index| self.nodes[index].mentions_untrusted_alias)
    }
}

struct AliasReferences {
    aliases: Vec<Sym>,
    edges: Vec<Vec<u32>>,
}

#[derive(Default)]
struct StripWalk {
    path: SmallVec<[TypeId; 8]>,
    finished: FxHashMap<TypeId, TypeId>,
}

fn push_nodes(pending: &mut PendingNodes, nodes: impl IntoIterator<Item = TypeNodeId>) {
    pending.extend(nodes.into_iter().filter(|node| node.is_some()));
}

fn tuple_element_type_node(hir: &hir::File<'_>, element: &TupleElem) -> TypeNodeId {
    let rest_element = match element.has_dots {
        true => rest_element_type_node(hir, element),
        false => None,
    };
    rest_element.unwrap_or(element.ty)
}

fn is_function_of_key(answer: Result<TypeId, GaveUp>) -> bool {
    match answer {
        Ok(_) => true,
        Err(reason) => reason.is_function_of_key(),
    }
}

fn is_undeclared_intrinsic(intrinsic: Intrinsic) -> bool {
    matches!(
        intrinsic,
        Intrinsic::String
            | Intrinsic::Number
            | Intrinsic::BigInt
            | Intrinsic::Symbol
            | Intrinsic::Object
    )
}

pub fn declares_type_alone(declaration: Decl) -> bool {
    matches!(
        declaration,
        Decl::Interface(_)
            | Decl::Alias(_)
            | Decl::ImportDefault(_)
            | Decl::ImportNamespace(_)
            | Decl::ImportSpec(_)
    )
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn compute_written_type(&mut self, file: FileId, node: TypeNodeId) -> WrittenType {
        if node.is_none() || !self.file_trust(file).is_trusted() {
            return WrittenType::Unwritten;
        }
        WrittenType::from_result(self.written_form(file, node))
    }

    pub(super) fn compute_written_variable_type(&mut self, symbol: Sym) -> WrittenType {
        let mut written: Option<TypeId> = None;
        for &(file, decl) in self.c.files().decls_of(symbol).iter() {
            let pattern = match decl {
                Decl::Var(pattern) | Decl::Param(pattern) => pattern,
                _ if declares_type_alone(decl) => continue,
                _ => return WrittenType::Unwritten,
            };
            let node = self.c.type_annotation_of_pat(file, pattern);
            let declared =
                match self.ask_written(|queries| queries.compute_written_type(file, node)) {
                    WrittenType::Written(declared) => declared,
                    WrittenType::Unwritten => return WrittenType::Unwritten,
                    WrittenType::GaveUp(reason) => return WrittenType::GaveUp(reason),
                };
            if written.is_some_and(|first| first != declared) {
                return WrittenType::Unwritten;
            }
            written = Some(declared);
        }
        written.map_or(WrittenType::Unwritten, WrittenType::Written)
    }

    pub(super) fn written_form(
        &mut self,
        file: FileId,
        node: TypeNodeId,
    ) -> Result<TypeId, GaveUp> {
        if let Some(&known) = self.kept.written_forms.get(&(file, node)) {
            return Ok(known);
        }
        if let Some(&reason) = self.memo.unwritten_forms.get(&(file, node)) {
            return Err(reason);
        }
        if self.c.is_stack_low() {
            return Err(GaveUp::Unresolved);
        }
        let full = self.c.type_from_node(file, node);
        let answer = match self.resolved(full) {
            Ok(full) => match self.mentions_untrusted_alias(file, node) {
                true => self.rebuild(file, node, full),
                false => Ok(full),
            },
            Err(reason) => Err(reason),
        };
        if is_function_of_key(answer) && !self.is_cut_short() {
            match answer {
                Ok(form) => drop(self.kept.written_forms.insert((file, node), form)),
                Err(reason) => drop(self.memo.unwritten_forms.insert((file, node), reason)),
            }
        }
        answer
    }

    fn is_cut_short(&self) -> bool {
        self.c.ran_out_of_stack.get() || !self.c.flow_analysis_disabled.is_empty()
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn mentions_untrusted_alias(&mut self, file: FileId, node: TypeNodeId) -> bool {
        let mut named = NamedTypes::default();
        self.collect_named_types(file, [node], &mut named);
        self.has_untrusted_mention(&named)
    }

    fn collect_named_types(
        &mut self,
        file: FileId,
        nodes: impl IntoIterator<Item = TypeNodeId>,
        named: &mut NamedTypes,
    ) {
        let hir = self.c.hir(file);
        let mut pending = PendingNodes::new();
        push_nodes(&mut pending, nodes);
        while let Some(node) = pending.pop() {
            match hir[node].kind {
                TypeNodeKind::Ref { name, args } => {
                    push_nodes(&mut pending, hir.ids(args));
                    let symbol = self.find_referenced_symbol(file, node, name);
                    self.add_named_type(symbol, args.len(), named);
                    self.add_alias_arguments(file, symbol, args, named);
                }
                TypeNodeKind::Import {
                    args,
                    is_typeof: false,
                    ..
                } => {
                    push_nodes(&mut pending, hir.ids(args));
                    let symbol = self.find_imported_symbol(file, node);
                    self.add_named_type(symbol, args.len(), named);
                    self.add_alias_arguments(file, symbol, args, named);
                }
                TypeNodeKind::Import {
                    args,
                    is_typeof: true,
                    ..
                } => {
                    push_nodes(&mut pending, hir.ids(args));
                    let value = self.find_imported_symbol(file, node);
                    named.has_untrusted_part |= !self.is_trusted_value(value);
                }
                TypeNodeKind::Typeof { expr, args, .. } => {
                    push_nodes(&mut pending, hir.ids(args));
                    let value = self.find_first_identifier_symbol(file, expr);
                    named.has_untrusted_part |= !self.is_trusted_value(value);
                }
                TypeNodeKind::Array(operand)
                | TypeNodeKind::Readonly(operand)
                | TypeNodeKind::Unique(operand)
                | TypeNodeKind::JSDoc { ty: operand, .. } => push_nodes(&mut pending, [operand]),
                TypeNodeKind::Keyof(operand) => {
                    push_nodes(&mut pending, [operand]);
                    self.add_read_types(file, [operand], named);
                }
                TypeNodeKind::Tuple(elements) => {
                    push_nodes(&mut pending, elements.iter().map(|element| hir[element].ty));
                }
                TypeNodeKind::Union(list)
                | TypeNodeKind::Intersection(list)
                | TypeNodeKind::Template { types: list, .. }
                | TypeNodeKind::Heritage { args: list, .. } => {
                    push_nodes(&mut pending, hir.ids(list));
                }
                TypeNodeKind::Cond {
                    check,
                    extends,
                    yes,
                    no,
                } => {
                    push_nodes(&mut pending, [check, extends, yes, no]);
                    self.add_read_types(file, [check, extends], named);
                }
                TypeNodeKind::IndexedAccess { obj, index } => {
                    push_nodes(&mut pending, [obj, index]);
                    self.add_read_types(file, [obj], named);
                }
                TypeNodeKind::Fn(_)
                | TypeNodeKind::Object(_)
                | TypeNodeKind::Mapped(_)
                | TypeNodeKind::Predicate { .. }
                | TypeNodeKind::Error
                | TypeNodeKind::Keyword(_)
                | TypeNodeKind::StringLit(_)
                | TypeNodeKind::NumberLit(_)
                | TypeNodeKind::BigIntLit { .. }
                | TypeNodeKind::BoolLit(_)
                | TypeNodeKind::Infer(_)
                | TypeNodeKind::UniqueSymbol => {}
            }
        }
    }

    fn add_named_type(&self, symbol: Option<Sym>, written_count: usize, named: &mut NamedTypes) {
        let Some(symbol) = symbol else {
            return;
        };
        let symbol = self.c.files().canonical(symbol);
        let flags = self.c.files().flags(symbol);
        if self.find_type_alias(symbol).is_some() {
            named.symbols.push(symbol);
        } else if flags.contains(SymFlags::TYPE_ALIAS) || !flags.intersects(SymFlags::TYPE) {
            named.has_untrusted_part = true;
        } else if written_count < self.c.files().type_argument_arity(symbol).1 {
            named.symbols.push(symbol);
        }
    }

    fn add_read_types(
        &mut self,
        file: FileId,
        nodes: impl IntoIterator<Item = TypeNodeId>,
        named: &mut NamedTypes,
    ) {
        named.reads_declarations = true;
        if !named.has_untrusted_part {
            named.has_untrusted_part = self.reads_untrusted_type(file, nodes);
        }
    }

    fn add_alias_arguments(
        &mut self,
        file: FileId,
        symbol: Option<Sym>,
        arguments: IdList<TypeNodeId>,
        named: &mut NamedTypes,
    ) {
        let Some(symbol) = symbol else {
            return;
        };
        let symbol = self.c.files().canonical(symbol);
        if self.reads_declarations_of_arguments(symbol, arguments.len()) {
            let hir = self.c.hir(file);
            self.add_read_types(file, hir.ids(arguments), named);
        }
    }

    fn reads_declarations_of_arguments(&mut self, symbol: Sym, written_count: usize) -> bool {
        if written_count == 0 || self.find_type_alias(symbol).is_none() {
            return false;
        }
        if let Some(&known) = self.kept.alias_reads.get(&symbol) {
            return known;
        }
        if self.c.is_stack_low() {
            return true;
        }
        self.kept.alias_reads.insert(symbol, true);
        let reads = self.collect_declaration_types(symbol).reads_declarations;
        self.kept.alias_reads.insert(symbol, reads);
        reads
    }

    fn reads_untrusted_type(
        &mut self,
        file: FileId,
        nodes: impl IntoIterator<Item = TypeNodeId>,
    ) -> bool {
        nodes.into_iter().any(|node| {
            node.is_some() && {
                let ty = self.c.type_from_node(file, node);
                self.reads_untrusted_declaration(ty)
            }
        })
    }

    fn reads_untrusted_declaration(&mut self, ty: TypeId) -> bool {
        if let Some(known) = self
            .kept
            .find_type(ty)
            .and_then(|answers| answers.reads_untrusted_declaration)
        {
            return known;
        }
        let answer = self.has_untrusted_declaration(ty, &mut FxHashSet::default());
        if !self.is_cut_short() {
            let row = self.kept.type_row(ty);
            self.kept.type_at(row).reads_untrusted_declaration = Some(answer);
        }
        answer
    }

    fn has_untrusted_declaration(&mut self, ty: TypeId, visited: &mut FxHashSet<TypeId>) -> bool {
        let has_parts = matches!(
            self.c.data(ty),
            TypeData::Union(_)
                | TypeData::Intersection(_)
                | TypeData::Ref { .. }
                | TypeData::Tuple { .. }
                | TypeData::Anon { .. }
                | TypeData::Fns { .. }
                | TypeData::Synth(_)
                | TypeData::ReverseMapped { .. }
        );
        if !has_parts || !visited.insert(ty) {
            return false;
        }
        if self.c.is_stack_low() {
            return true;
        }
        match self.c.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => parts
                .iter()
                .any(|&part| self.has_untrusted_declaration(part, visited)),
            TypeData::Ref { target, .. } => {
                !self.is_declared_in_type_function_files(*target)
                    || (self.c.type_arguments(ty).iter())
                        .any(|&argument| self.has_untrusted_declaration(argument, visited))
            }
            TypeData::Tuple { .. } => (self.c.type_arguments(ty).iter())
                .any(|&element| self.has_untrusted_declaration(element, visited)),
            TypeData::Anon { .. }
            | TypeData::Fns { .. }
            | TypeData::Synth(_)
            | TypeData::ReverseMapped { .. } => !self.object_type_trust(ty).is_trusted(),
            _ => false,
        }
    }

    fn is_trusted_value(&mut self, value: Option<Sym>) -> bool {
        let Some(value) = value else {
            return false;
        };
        let value = self.c.files().canonical(value);
        if !self.symbol_trust(value).is_trusted() || self.c.is_stack_low() {
            return false;
        }
        let declarations = self.c.files().decls_of(value);
        declarations
            .iter()
            .all(|&(file, declaration)| match declaration {
                Decl::Var(pattern) | Decl::Param(pattern) => {
                    let annotation = self.c.type_annotation_of_pat(file, pattern);
                    annotation.is_some() && !self.mentions_untrusted_alias(file, annotation)
                }
                _ => true,
            })
    }

    fn has_untrusted_mention(&mut self, named: &NamedTypes) -> bool {
        if named.has_untrusted_part {
            return true;
        }
        let mut graph = AliasScanGraph::default();
        let mut mentions = false;
        for &symbol in &named.symbols {
            mentions |= self.scan_alias(symbol, &mut graph) == AliasScan::MentionsUntrustedAlias;
        }
        self.scan_alias_declarations(&mut graph);
        let mut symbols = named.symbols.iter();
        mentions || symbols.any(|&symbol| graph.mentions_untrusted_alias(symbol))
    }

    fn has_transparent_defaults(&self, symbol: Sym) -> bool {
        let lists = self.c.files().type_param_lists(symbol);
        self.find_type_alias(symbol).is_none()
            && lists.iter().all(|&(file, parameters)| {
                parameters.is_empty() || self.is_type_function_file(file)
            })
    }

    fn scan_alias(&mut self, symbol: Sym, graph: &mut AliasScanGraph) -> AliasScan {
        if !self.is_transparent_alias(symbol) && !self.has_transparent_defaults(symbol) {
            return AliasScan::MentionsUntrustedAlias;
        }
        if let Some(&scan) = self.kept.alias_scans.get(&symbol) {
            return scan;
        }
        self.kept.alias_scans.insert(symbol, AliasScan::InProgress);
        graph.add(symbol);
        AliasScan::InProgress
    }

    fn scan_alias_declarations(&mut self, graph: &mut AliasScanGraph) {
        let mut scanned = 0;
        while let Some(symbol) = graph.nodes.get(scanned).map(|node| node.symbol) {
            let named = self.collect_declaration_types(symbol);
            let mut mentions = named.has_untrusted_part;
            for &target in &named.symbols {
                mentions |= match self.scan_alias(target, graph) {
                    AliasScan::MentionsUntrustedAlias => true,
                    AliasScan::MentionsNone => false,
                    AliasScan::InProgress => !graph.add_referrer(target, scanned),
                };
            }
            graph.nodes[scanned].mentions_untrusted_alias = mentions;
            scanned += 1;
        }
        graph.propagate_mentions();
        let is_cut_short = self.is_cut_short();
        for node in &graph.nodes {
            let scan = match node.mentions_untrusted_alias {
                true => AliasScan::MentionsUntrustedAlias,
                false => AliasScan::MentionsNone,
            };
            if is_cut_short {
                self.kept.alias_scans.remove(&node.symbol);
            } else {
                self.kept.alias_scans.insert(node.symbol, scan);
            }
        }
    }

    fn collect_declaration_types(&mut self, symbol: Sym) -> NamedTypes {
        let mut named = NamedTypes::default();
        if let Some((alias_file, declaration)) = self.find_type_alias(symbol) {
            self.collect_named_types(alias_file, [declaration.ty], &mut named);
        }
        for (file, parameters) in self.c.files().type_param_lists(symbol) {
            let hir = self.c.hir(file);
            let defaults = parameters.iter().map(|parameter| hir[parameter].default);
            self.collect_named_types(file, defaults, &mut named);
        }
        named
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    fn rebuild(&mut self, file: FileId, node: TypeNodeId, full: TypeId) -> Result<TypeId, GaveUp> {
        let hir = self.c.hir(file);
        match hir[node].kind {
            TypeNodeKind::Union(members) => {
                let forms = self.collect_written_forms(file, hir.ids(members))?;
                Ok(self.c.union(&forms))
            }
            TypeNodeKind::Intersection(parts) => {
                let forms = self.collect_written_forms(file, hir.ids(parts))?;
                Ok(self.intersect_forms(&forms))
            }
            TypeNodeKind::Array(element) if self.c.is_array(full) => {
                let form = self.written_form(file, element)?;
                Ok(self.c.create_type_reference(full, &[form]))
            }
            TypeNodeKind::Tuple(elements) => self.rebuild_tuple(file, elements, full),
            TypeNodeKind::Readonly(operand) if operand.is_some() => {
                self.rebuild(file, operand, full)
            }
            TypeNodeKind::Ref { name, args } => {
                let named = self.find_referenced_symbol(file, node, name);
                self.rebuild_reference(file, named, args, full)
            }
            TypeNodeKind::Import {
                args,
                is_typeof: false,
                ..
            } => {
                let named = self.find_imported_symbol(file, node);
                self.rebuild_reference(file, named, args, full)
            }
            TypeNodeKind::Import {
                is_typeof: true, ..
            }
            | TypeNodeKind::Typeof { .. }
            | TypeNodeKind::Array(_)
            | TypeNodeKind::Readonly(_)
            | TypeNodeKind::Keyof(_)
            | TypeNodeKind::Unique(_)
            | TypeNodeKind::JSDoc { .. }
            | TypeNodeKind::Template { .. }
            | TypeNodeKind::Heritage { .. }
            | TypeNodeKind::Cond { .. }
            | TypeNodeKind::IndexedAccess { .. }
            | TypeNodeKind::Predicate { .. }
            | TypeNodeKind::Fn(_)
            | TypeNodeKind::Object(_)
            | TypeNodeKind::Mapped(_)
            | TypeNodeKind::Error
            | TypeNodeKind::Keyword(_)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_)
            | TypeNodeKind::Infer(_)
            | TypeNodeKind::UniqueSymbol => Ok(self.strip_undeclared_parts(full)),
        }
    }

    fn collect_written_forms(
        &mut self,
        file: FileId,
        nodes: impl Iterator<Item = TypeNodeId>,
    ) -> Result<Forms, GaveUp> {
        nodes.map(|node| self.written_form(file, node)).collect()
    }

    fn intersect_forms(&mut self, forms: &[TypeId]) -> TypeId {
        match forms.contains(&TypeId::UNKNOWN) {
            true => TypeId::UNKNOWN,
            false => self.c.intersection(forms),
        }
    }

    fn rebuild_tuple(
        &mut self,
        file: FileId,
        elements: Span<TupleElemId>,
        full: TypeId,
    ) -> Result<TypeId, GaveUp> {
        let hir = self.c.hir(file);
        let TypeData::Tuple {
            flags, readonly, ..
        } = self.c.data(full)
        else {
            return Ok(self.strip_undeclared_parts(full));
        };
        let has_variadic_element = elements
            .iter()
            .any(|element| is_variadic_tuple_element(hir, &hir[element]));
        if has_variadic_element || flags.len() != elements.len() {
            return Ok(self.strip_undeclared_parts(full));
        }
        let nodes = elements
            .iter()
            .map(|element| tuple_element_type_node(hir, &hir[element]));
        let forms = self.collect_written_forms(file, nodes)?;
        Ok(self.c.tuple(&forms, flags, *readonly))
    }

    fn rebuild_reference(
        &mut self,
        file: FileId,
        named: Option<Sym>,
        arguments: IdList<TypeNodeId>,
        full: TypeId,
    ) -> Result<TypeId, GaveUp> {
        let Some(named) = named else {
            return Ok(self.strip_undeclared_parts(full));
        };
        let symbol = self.c.files().canonical(named);
        let is_alias = self.find_type_alias(symbol).is_some();
        if !is_alias && !self.takes_only_written_arguments(symbol, arguments.len()) {
            return Ok(self.strip_undeclared_parts(full));
        }
        let hir = self.c.hir(file);
        if self.reads_declarations_of_arguments(symbol, arguments.len())
            && self.reads_untrusted_type(file, hir.ids(arguments))
        {
            return Ok(self.strip_undeclared_parts(full));
        }
        let forms = self.collect_written_forms(file, hir.ids(arguments))?;
        let has_exact_arguments = *forms == *self.c.types_from_nodes(file, arguments);
        if !has_exact_arguments && (is_alias || self.decides_by_type_arguments(symbol)) {
            return Ok(TypeId::UNKNOWN);
        }
        if is_alias {
            return self.reference_to_alias(symbol, &forms, full);
        }
        let ty = self.c.type_reference(symbol, &forms);
        self.resolved(ty)
    }

    fn decides_by_type_arguments(&self, symbol: Sym) -> bool {
        let is_class_alone = self.compiled_class(symbol).is_some()
            && !self.c.files().flags(symbol).contains(SymFlags::INTERFACE);
        self.symbol_trust(symbol).is_trusted() && !is_class_alone
    }

    fn takes_only_written_arguments(&mut self, symbol: Sym, written_count: usize) -> bool {
        let flags = self.c.files().flags(symbol);
        flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE)
            && !flags.contains(SymFlags::TYPE_ALIAS)
            && self.c.local_type_params_of_symbol(symbol).len() == written_count
            && self.c.outer_type_params_of_symbol(symbol).is_empty()
    }

    fn reference_to_alias(
        &mut self,
        alias: Sym,
        arguments: &[TypeId],
        full: TypeId,
    ) -> Result<TypeId, GaveUp> {
        let parameters = self.c.local_type_params_of_symbol(alias);
        if parameters.len() != arguments.len() {
            return Ok(self.strip_undeclared_parts(full));
        }
        if self.c.intrinsic_alias(alias).is_some() {
            let ty = self.c.type_reference(alias, arguments);
            return self.resolved(ty);
        }
        let form = self.alias_form(alias)?;
        if parameters.is_empty() {
            return Ok(form);
        }
        let pairs: SmallVec<[(TypeId, TypeId); 4]> = parameters
            .iter()
            .copied()
            .zip(arguments.iter().copied())
            .collect();
        let mapper = self.c.types().mapper_of(&pairs);
        let ty = self.c.instantiate(form, mapper);
        self.resolved(ty)
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    fn alias_form(&mut self, alias: Sym) -> Result<TypeId, GaveUp> {
        match self.memo.alias_forms.get(&alias).copied() {
            Some(AliasForm::Computed(answer)) => answer,
            Some(AliasForm::InProgress) => Ok(TypeId::UNKNOWN),
            None => self.compute_alias_forms(alias),
        }
    }

    fn compute_alias_forms(&mut self, requested: Sym) -> Result<TypeId, GaveUp> {
        let AliasReferences { aliases, edges } = self.collect_alias_references(requested);
        let (_, components) = strongly_connected_components(&edges);
        let mut unstable: Vec<Sym> = Vec::new();
        for component in &components {
            for &member in component {
                self.memo
                    .alias_forms
                    .insert(aliases[member], AliasForm::InProgress);
            }
            let answers: SmallVec<[Result<TypeId, GaveUp>; 4]> = component
                .iter()
                .map(|&member| self.compute_alias_form(aliases[member]))
                .collect();
            for (&member, &answer) in component.iter().zip(&answers) {
                self.memo
                    .alias_forms
                    .insert(aliases[member], AliasForm::Computed(answer));
            }
            if !answers.iter().all(|&answer| is_function_of_key(answer)) {
                unstable.extend(component.iter().map(|&member| aliases[member]));
            }
        }
        let requested_answer = match self.memo.alias_forms.get(&requested) {
            Some(&AliasForm::Computed(answer)) => answer,
            Some(AliasForm::InProgress) | None => Err(GaveUp::Unresolved),
        };
        let not_memoized = match self.is_cut_short() {
            true => &aliases,
            false => &unstable,
        };
        for alias in not_memoized {
            self.memo.alias_forms.remove(alias);
        }
        requested_answer
    }

    fn collect_alias_references(&mut self, requested: Sym) -> AliasReferences {
        let mut aliases = vec![requested];
        let mut index_of: FxHashMap<Sym, u32> = FxHashMap::default();
        index_of.insert(requested, 0);
        let mut edges: Vec<Vec<u32>> = Vec::new();
        while let Some(&alias) = aliases.get(edges.len()) {
            let mut targets = Vec::new();
            for target in self.collect_rebuilt_aliases(alias) {
                if self.memo.alias_forms.contains_key(&target) {
                    continue;
                }
                let index = *index_of.entry(target).or_insert_with(|| {
                    aliases.push(target);
                    (aliases.len() - 1) as u32
                });
                targets.push(index);
            }
            edges.push(targets);
        }
        AliasReferences { aliases, edges }
    }

    fn collect_rebuilt_aliases(&mut self, alias: Sym) -> SmallVec<[Sym; 8]> {
        if !self.is_transparent_alias(alias) {
            return SmallVec::new();
        }
        let Some((alias_file, declaration)) = self.find_type_alias(alias) else {
            return SmallVec::new();
        };
        let mut named = NamedTypes::default();
        self.collect_named_types(alias_file, [declaration.ty], &mut named);
        if !self.has_untrusted_mention(&named) {
            return SmallVec::new();
        }
        named
            .symbols
            .retain(|symbol| self.find_type_alias(*symbol).is_some());
        named.symbols
    }

    fn compute_alias_form(&mut self, alias: Sym) -> Result<TypeId, GaveUp> {
        if self.is_transparent_alias(alias)
            && let Some((alias_file, declaration)) = self.find_type_alias(alias)
        {
            return self.written_form(alias_file, declaration.ty);
        }
        let declared = self.c.declared_type(alias);
        let declared = self.resolved(declared)?;
        Ok(self.strip_undeclared_parts(declared))
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    fn strip_undeclared_parts(&mut self, ty: TypeId) -> TypeId {
        self.strip_within(ty, &mut StripWalk::default())
    }

    fn strip_within(&mut self, ty: TypeId, walk: &mut StripWalk) -> TypeId {
        if let Some(&stripped) = walk.finished.get(&ty) {
            return stripped;
        }
        if walk.path.contains(&ty) || self.c.is_stack_low() {
            return TypeId::UNKNOWN;
        }
        walk.path.push(ty);
        let stripped = self.strip_parts(ty, walk);
        walk.path.pop();
        walk.finished.insert(ty, stripped);
        stripped
    }

    fn strip_all(&mut self, types: &[TypeId], walk: &mut StripWalk) -> Forms {
        types
            .iter()
            .map(|&ty| self.strip_within(ty, walk))
            .collect()
    }

    fn strip_parts(&mut self, ty: TypeId, walk: &mut StripWalk) -> TypeId {
        match self.c.data(ty) {
            TypeData::Intrinsic(intrinsic) => match is_undeclared_intrinsic(*intrinsic) {
                true => TypeId::UNKNOWN,
                false => ty,
            },
            TypeData::EnumLit { .. }
            | TypeData::Enum { .. }
            | TypeData::TypeParam(..)
            | TypeData::ThisParam(_)
            | TypeData::Marker(_)
            | TypeData::Synth(_)
            | TypeData::ReverseMapped { .. } => ty,
            TypeData::Anon { mapper, .. } | TypeData::Fns { mapper, .. } => {
                match self.has_only_declared_arguments(*mapper, walk) {
                    true => ty,
                    false => TypeId::UNKNOWN,
                }
            }
            TypeData::Union(parts) => {
                let stripped = self.strip_all(parts, walk);
                match *stripped == **parts {
                    true => ty,
                    false => self.c.union(&stripped),
                }
            }
            TypeData::Intersection(parts) => {
                let stripped = self.strip_all(parts, walk);
                match *stripped == **parts {
                    true => ty,
                    false => self.intersect_forms(&stripped),
                }
            }
            TypeData::Ref { target, .. } if self.has_undeclared_shape(ty, *target) => {
                TypeId::UNKNOWN
            }
            TypeData::Ref { target, .. } => {
                let arguments = self.c.type_arguments(ty);
                let stripped = self.strip_all(arguments, walk);
                if *stripped == *arguments {
                    ty
                } else if self.symbol_trust(*target).is_trusted() {
                    TypeId::UNKNOWN
                } else {
                    self.c.create_type_reference(ty, &stripped)
                }
            }
            TypeData::Tuple { .. } => TypeId::UNKNOWN,
            _ => TypeId::UNKNOWN,
        }
    }

    fn has_undeclared_shape(&self, ty: TypeId, target: Sym) -> bool {
        self.c.is_array(ty)
            || self.c.is_reference_to_global(ty, known::Object, 0)
            || self.c.is_reference_to_global(ty, known::Function, 0)
            || self.inputs.builtin_types.class_of(target).is_some()
    }

    fn has_only_declared_arguments(&mut self, mapper: MapperId, walk: &mut StripWalk) -> bool {
        let mapping = self.c.mapping_in_declaration_order(mapper);
        mapping
            .iter()
            .all(|&(_, argument)| self.strip_within(argument, walk) == argument)
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn find_referenced_symbol(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        name: Span<NameId>,
    ) -> Option<Sym> {
        let scope = self.c.bound(file).type_scope[node.idx()];
        self.c.resolve_type_reference_name(file, scope, name, true)
    }

    pub(super) fn find_imported_symbol(&mut self, file: FileId, node: TypeNodeId) -> Option<Sym> {
        let target = self.c.resolve_import_type(file, node, false)?;
        self.c.resolve_symbol(target).symbol()
    }

    pub(super) fn find_type_alias(&self, symbol: Sym) -> Option<(FileId, Alias)> {
        let files = self.c.files();
        if !files.flags(symbol).contains(SymFlags::TYPE_ALIAS) {
            return None;
        }
        let declarations = files.decls_of(symbol);
        let mut aliases = declarations.iter().filter_map(|&(file, decl)| {
            if let Decl::Alias(alias) = decl {
                Some((file, alias))
            } else {
                None
            }
        });
        let (Some((file, alias)), None) = (aliases.next(), aliases.next()) else {
            return None;
        };
        Some((file, self.c.hir(file)[alias]))
    }

    fn find_first_identifier_symbol(&self, file: FileId, entity_name: ExprId) -> Option<Sym> {
        let hir = self.c.hir(file);
        let mut first = entity_name;
        while let ExprKind::Dot { obj, .. } = hir[first].kind {
            first = obj;
        }
        self.c
            .resolve_entity_name_expression(file, first, SymFlags::VALUE)
    }
}

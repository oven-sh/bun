use bun_core::strings::split;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{
    Binding, BindingInitializer, Bound, Decl, FnOwner, Parent, PatParent, SymbolId,
};
use bun_sema::fold::{Constant, FoldedValue, KnownSets};
use bun_sema::hir::{
    BinOp, CallId, ExprId, ExprKind, File, Flags, FnKind, IdList, ImportId, MemberKey, NameKind,
    NodeData, ParamId, PatId, PatKind, PropId, PropKey, PropKind, StmtKind, TypeNodeId,
    TypeNodeKind, UnOp,
};
use bun_sema::import_sites::{ImportSiteKind, find_values_of_parameter};
use bun_sema::program::{CodeAnswer, FileId, Files};
use bun_sema::resolve::{CodeResolution, FinishedFile, SiteResolution};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};

use super::FileOfRun;
use super::out_of_sight::find_outermost_assertion;
use crate::builtins::table::MemberLookup;
use crate::builtins::{BuiltinId, ResolvedBuiltins, table};
use crate::load::sources::parsed_source;

fn find_member_of(holder: BuiltinId, atoms: &Interner<'_>, name: Atom) -> Option<BuiltinId> {
    match table::member(holder, table::find_name(atoms.bytes(name))?) {
        MemberLookup::Found(member) => Some(table::canonical_id(member)),
        _ => None,
    }
}

fn hands_each_item_to_callback(method: BuiltinId) -> bool {
    matches!(
        method,
        BuiltinId::ArrayPrototypeForEach
            | BuiltinId::ArrayPrototypeMap
            | BuiltinId::ArrayPrototypeFlatMap
            | BuiltinId::ArrayPrototypeFilter
            | BuiltinId::ArrayPrototypeSome
            | BuiltinId::ArrayPrototypeEvery
            | BuiltinId::ArrayPrototypeFind
    )
}

fn leaves_its_list_as_it_is(method: BuiltinId) -> bool {
    hands_each_item_to_callback(method)
        || matches!(
            method,
            BuiltinId::ArrayPrototypeAt
                | BuiltinId::ArrayPrototypeConcat
                | BuiltinId::ArrayPrototypeEntries
                | BuiltinId::ArrayPrototypeFindIndex
                | BuiltinId::ArrayPrototypeFindLast
                | BuiltinId::ArrayPrototypeIncludes
                | BuiltinId::ArrayPrototypeIndexOf
                | BuiltinId::ArrayPrototypeJoin
                | BuiltinId::ArrayPrototypeKeys
                | BuiltinId::ArrayPrototypeLastIndexOf
                | BuiltinId::ArrayPrototypeReduce
                | BuiltinId::ArrayPrototypeSlice
                | BuiltinId::ArrayPrototypeValues
        )
}

fn find_call_that_takes_callback(
    hir: &File<'_>,
    bound: &Bound<'_>,
    parameter: ParamId,
) -> Option<(CallId, ExprId)> {
    let FnOwner::Expr(mut callback) = bound.fns[bound.param_fn[parameter.idx()].idx()].owner else {
        return None;
    };
    while let Parent::Expr(parent) = bound.parent_of_expr(callback)
        && hir.type_assertion_operand(parent) == Some(callback)
    {
        callback = parent;
    }
    let Parent::Expr(user) = bound.parent_of_expr(callback) else {
        return None;
    };
    match hir[user].kind {
        ExprKind::Call(call) if hir.ids(hir[call].args).any(|it| it == callback) => {
            Some((call, callback))
        }
        _ => None,
    }
}

pub(crate) fn find_items_handed_to_callback(
    hir: &File<'_>,
    bound: &Bound<'_>,
    atoms: &Interner<'_>,
    mention: ExprId,
) -> Option<IdList<ExprId>> {
    let Binding::Symbol(name) = bound.binding(mention) else {
        return None;
    };
    let &[Decl::Param(pattern)] = bound.symbol(name).decls else {
        return None;
    };
    let PatParent::Param(parameter) = bound.pat_parent[pattern.idx()] else {
        return None;
    };
    let function = bound.param_fn[parameter.idx()];
    let is_first_as_handed = hir[function].params.iter().next() == Some(parameter)
        && hir[function].kind == FnKind::Arrow
        && hir[parameter].default.is_none()
        && !hir[parameter].flags.contains(Flags::REST)
        && bound.stores_to(name).is_empty()
        && !bound.is_visible_to_eval(name)
        && bound.is_evaluated_ident(mention)
        && bound
            .dynamic_lookup_scope(NodeData::Expr(mention))
            .is_none();
    let (call, callback) = find_call_that_takes_callback(hir, bound, parameter)?;
    if !is_first_as_handed || hir.ids(hir[call].args).next() != Some(callback) {
        return None;
    }
    let (list, MemberKey::Name(method)) =
        hir.member_key(hir.skip_type_assertions(hir[call].callee))?
    else {
        return None;
    };
    let method = find_member_of(BuiltinId::ArrayPrototype, atoms, method)?;
    match hir[hir.skip_type_assertions(list)].kind {
        ExprKind::Array(items) if hands_each_item_to_callback(method) => Some(items),
        _ => None,
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Step {
    Member(Atom),
    AnyElement,
    Row(u32),
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Read {
    Whole,
    FromOutside,
    NotRead,
}

struct Following<'k, 'a, 's> {
    known: &'k mut KnownSets<'a, 's>,
    path: Vec<Step>,
    on_the_way: Vec<(ExprId, Vec<Step>)>,
    sums_being_filled: usize,
    texts: Vec<Atom>,
}

pub(super) struct NamesFromOutside<'a, 's> {
    request: &'a FinishedFile<'a, 's>,
    builtins: &'a ResolvedBuiltins,
    is_in_package: bool,
    calls: Vec<(ExprId, CallId)>,
    names_stored: Vec<Atom>,
    names_stored_above_literals: Vec<(BuiltinId, Atom)>,
}

impl<'a, 's> NamesFromOutside<'a, 's> {
    pub(super) fn new(
        request: &'a FinishedFile<'a, 's>,
        builtins: &'a ResolvedBuiltins,
        is_in_package: bool,
    ) -> NamesFromOutside<'a, 's> {
        NamesFromOutside {
            request,
            builtins,
            is_in_package,
            calls: Vec::new(),
            names_stored: Vec::new(),
            names_stored_above_literals: Vec::new(),
        }
    }

    fn find_constant_text(&self, value: ExprId) -> Option<Atom> {
        let &FinishedFile { hir, analysis, .. } = self.request;
        match analysis
            .decisions
            .constant(hir, hir.skip_type_assertions(value))
        {
            FoldedValue::Constant(Constant::String(text))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) => Some(text),
            FoldedValue::Constant(_)
            | FoldedValue::ConstantOutsideDeadZone(_)
            | FoldedValue::Unknown => None,
        }
    }

    fn collect_texts_of_written_type(&self, written: TypeNodeId, texts: &mut Vec<Atom>) -> bool {
        let hir = self.request.hir;
        match written.some().map(|written| hir[written].kind) {
            Some(TypeNodeKind::StringLit(text)) => {
                texts.push(text);
                true
            }
            Some(TypeNodeKind::Union(parts)) => hir
                .ids(parts)
                .all(|part| self.collect_texts_of_written_type(part, texts)),
            _ => false,
        }
    }

    fn find_texts_of_key(&self, key: ExprId) -> Vec<Atom> {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        if let Some(text) = self.find_constant_text(key) {
            return vec![text];
        }
        let key = hir.skip_type_assertions(key);
        if !matches!(hir[key].kind, ExprKind::Ident(_)) {
            return Vec::new();
        }
        if let Some(values) = find_values_of_parameter(hir, bound, &analysis.decisions, key) {
            let texts = values.into_iter().map(|it| self.find_constant_text(it));
            if let Some(texts) = texts.collect::<Option<Vec<Atom>>>() {
                return texts;
            }
        }
        let Binding::Symbol(name) = bound.binding(key) else {
            return Vec::new();
        };
        let &[Decl::Param(pattern)] = bound.symbol(name).decls else {
            return Vec::new();
        };
        let PatParent::Param(parameter) = bound.pat_parent[pattern.idx()] else {
            return Vec::new();
        };
        let mut texts = Vec::new();
        let is_as_written = bound.stores_to(name).is_empty()
            && !bound.is_visible_to_eval(name)
            && self.collect_texts_of_written_type(hir[parameter].ty, &mut texts);
        match is_as_written {
            true => texts,
            false => Vec::new(),
        }
    }

    fn may_lie_right_below_object_prototype(&self, value: ExprId) -> bool {
        let &FinishedFile { hir, bound, .. } = self.request;
        let mut value = hir.skip_type_assertions(value);
        if let (ExprKind::Ident(_), Binding::Symbol(name)) = (hir[value].kind, bound.binding(value))
            && let BindingInitializer::Expression(written) = bound.binding_initializer(hir, name)
            && bound.stores_to(name).is_empty()
        {
            value = hir.skip_type_assertions(written);
        }
        let ExprKind::Object(properties) = hir[value].kind else {
            return false;
        };
        let lays_something_else_above = |property: PropId| {
            let property = hir[property];
            let is_object_or_null = matches!(
                hir[hir.skip_type_assertions(property.value)].kind,
                ExprKind::Null
                    | ExprKind::Object(_)
                    | ExprKind::Array(_)
                    | ExprKind::Fn(_)
                    | ExprKind::Class(_)
                    | ExprKind::Regex { .. }
            );
            property.kind == PropKind::Init
                && property.key == PropKey::Name(known::__proto__)
                && property.name_kind != NameKind::ComputedString
                && is_object_or_null
        };
        !properties.iter().any(lays_something_else_above)
    }

    fn find_closed_holder_above_literal(&self, object: ExprId) -> Option<BuiltinId> {
        let &FinishedFile { hir, bound, .. } = self.request;
        let object = hir.skip_type_assertions(object);
        if !matches!(hir[object].kind, ExprKind::Ident(_)) {
            return None;
        }
        let Binding::Symbol(holder) = bound.binding(object) else {
            return None;
        };
        if !bound.stores_to(holder).is_empty() || bound.is_visible_to_eval(holder) {
            return None;
        }
        let read = match bound.binding_initializer(hir, holder) {
            BindingInitializer::Expression(read) => hir.skip_type_assertions(read),
            BindingInitializer::PatternProperty { source, path } => {
                let finds_link = path.as_slice() == [known::__proto__];
                return (finds_link && self.may_lie_right_below_object_prototype(source))
                    .then_some(BuiltinId::ObjectPrototype);
            }
            _ => return None,
        };
        let may_name_link = |key: ExprId| {
            self.find_constant_text(key)
                .is_none_or(|text| text == known::__proto__)
        };
        let (receiver, finds_link) = match (hir.member_key(read), hir[read].kind) {
            (Some((receiver, MemberKey::Name(name))), _) => (receiver, name == known::__proto__),
            (Some((receiver, MemberKey::Computed(key))), _) => (receiver, may_name_link(key)),
            (None, ExprKind::Call(call)) => {
                let callee = self.builtins.builtin_of_expression(hir[call].callee);
                let mut operands = hir.ids(hir[call].args);
                match (
                    callee.map(table::canonical_id),
                    operands.next(),
                    operands.next(),
                    operands.next(),
                ) {
                    (Some(BuiltinId::ReflectGet), Some(receiver), Some(key), None) => {
                        (receiver, may_name_link(key))
                    }
                    (
                        Some(BuiltinId::ObjectGetPrototypeOf | BuiltinId::ReflectGetPrototypeOf),
                        Some(receiver),
                        None,
                        None,
                    ) => (receiver, true),
                    _ => return None,
                }
            }
            _ => return None,
        };
        (finds_link && self.may_lie_right_below_object_prototype(receiver))
            .then_some(BuiltinId::ObjectPrototype)
    }

    fn note_store_above_literal(&mut self, object: ExprId, key: ExprId) {
        if let Some(holder) = self.find_closed_holder_above_literal(object) {
            let texts = self.find_texts_of_key(key).into_iter();
            self.names_stored_above_literals
                .extend(texts.map(|text| (holder, text)));
        }
    }

    fn is_object_from_somewhere(&self, object: ExprId) -> bool {
        let &FinishedFile { hir, bound, .. } = self.request;
        let object = hir.skip_type_assertions(object);
        if !matches!(hir[object].kind, ExprKind::Ident(_))
            || self.builtins.of_expr(object).is_some()
        {
            return false;
        }
        let Binding::Symbol(holder) = bound.binding(object) else {
            return false;
        };
        match bound.binding_initializer(hir, holder) {
            BindingInitializer::Opaque | BindingInitializer::PatternProperty { .. } => true,
            BindingInitializer::Expression(value) => !matches!(
                hir[hir.skip_type_assertions(value)].kind,
                ExprKind::Object(_)
                    | ExprKind::Array(_)
                    | ExprKind::Fn(_)
                    | ExprKind::Class(_)
                    | ExprKind::New(_)
            ),
            BindingInitializer::Class(_)
            | BindingInitializer::Function(_)
            | BindingInitializer::Namespace(_)
            | BindingInitializer::Enum(_)
            | BindingInitializer::EntityName(_)
            | BindingInitializer::Import => false,
        }
    }

    fn is_namespace_in_sight(&self, object: ExprId) -> bool {
        let &FinishedFile {
            hir, bound, atoms, ..
        } = self.request;
        let object = hir.skip_type_assertions(object);
        if !bound.is_evaluated_ident(object)
            || bound.dynamic_lookup_scope(NodeData::Expr(object)).is_some()
        {
            return false;
        }
        let Binding::Symbol(symbol) = bound.binding(object) else {
            return false;
        };
        match *bound.symbol(symbol).decls {
            [Decl::ImportNamespace(import)] => self.is_import_of_one_module(import),
            [Decl::Param(_)] => {
                let items = find_items_handed_to_callback(hir, bound, atoms, object);
                items.is_some_and(|items| {
                    let mut items = hir.ids(items).peekable();
                    items.peek().is_some() && items.all(|item| self.is_namespace_in_sight(item))
                })
            }
            _ => false,
        }
    }

    fn is_import_of_one_module(&self, import: ImportId) -> bool {
        let &FinishedFile {
            analysis,
            resolutions,
            ..
        } = self.request;
        let site = analysis.import_site_index(ImportSiteKind::Import(import));
        matches!(
            site.and_then(|site| resolutions.get(site)),
            Some(SiteResolution::Constant(
                CodeResolution::File(_) | CodeResolution::HostModule(_)
            ))
        )
    }

    fn look_at_store(&mut self, target: ExprId) {
        let hir = self.request.hir;
        let Some((object, key)) = hir.member_key(hir.skip_type_assertions(target)) else {
            return;
        };
        match key {
            MemberKey::Name(name) => {
                if let Some(holder) = self.find_closed_holder_above_literal(object) {
                    self.names_stored_above_literals.push((holder, name));
                }
            }
            MemberKey::Computed(key) => self.note_store_above_literal(object, key),
            MemberKey::PrivateName(_) => {}
        }
        let name = match key {
            MemberKey::Name(name) => Some(name),
            MemberKey::Computed(key) => self.find_constant_text(key),
            MemberKey::PrivateName(_) => None,
        };
        if let Some(name) = name.filter(|_| self.is_object_from_somewhere(object)) {
            self.names_stored.push(name);
        }
    }

    fn look_at_call_that_stores(&mut self, call: CallId) {
        let hir = self.request.hir;
        let callee = self.builtins.builtin_of_expression(hir[call].callee);
        let stores = matches!(
            callee.map(table::canonical_id),
            Some(
                BuiltinId::ReflectSet
                    | BuiltinId::ReflectDefineProperty
                    | BuiltinId::ObjectDefineProperty
            )
        );
        let mut operands = hir.ids(hir[call].args);
        let (true, Some(object), Some(key)) = (stores, operands.next(), operands.next()) else {
            return;
        };
        self.note_store_above_literal(object, key);
        if let Some(name) = self.find_constant_text(key)
            && self.is_object_from_somewhere(object)
        {
            self.names_stored.push(name);
        }
    }

    pub(super) fn look_at(&mut self, expression: ExprId, kind: ExprKind) {
        if self.is_in_package {
            return;
        }
        match kind {
            ExprKind::Call(call) => {
                self.calls.push((expression, call));
                self.look_at_call_that_stores(call);
            }
            ExprKind::Assign { target, .. } => self.look_at_store(target),
            _ => {}
        }
    }

    fn find_import_of(&self, symbol: SymbolId) -> Option<ImportId> {
        let &FinishedFile { hir, bound, .. } = self.request;
        match *bound.symbol(symbol).decls {
            [Decl::ImportSpec(specifier)] => Some(hir[specifier].import),
            [Decl::ImportDefault(import) | Decl::ImportNamespace(import)] => Some(import),
            _ => None,
        }
    }

    fn find_root_of(&self, value: ExprId) -> Option<SymbolId> {
        let &FinishedFile { hir, bound, .. } = self.request;
        let value = hir.skip_type_assertions(value);
        let name = hir.member_key(value).map_or(value, |(object, _)| object);
        let name = hir.skip_type_assertions(name);
        match (hir[name].kind, bound.binding(name)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => Some(symbol),
            _ => None,
        }
    }

    fn find_what_imports_make(&self) -> Vec<(SymbolId, ImportId)> {
        let &FinishedFile { hir, bound, .. } = self.request;
        let mut made_by: Vec<(SymbolId, ImportId)> = Vec::new();
        for &(made, call) in &self.calls {
            let root = self.find_root_of(hir[call].callee);
            let Some(import) = root.and_then(|root| self.find_import_of(root)) else {
                continue;
            };
            let mut value = made;
            while let Parent::Expr(parent) = bound.parent_of_expr(value)
                && (hir.type_assertion_operand(parent) == Some(value)
                    || matches!(hir[parent].kind, ExprKind::Await(_)))
            {
                value = parent;
            }
            match bound.parent_of_expr(value) {
                Parent::VarInit(declaration) => {
                    let pattern = hir[declaration].pat;
                    let parts: Vec<PatId> = match hir[pattern].kind {
                        PatKind::Object(properties) => {
                            properties.iter().map(|it| hir[it].value).collect()
                        }
                        _ => vec![pattern],
                    };
                    let holders = parts.into_iter();
                    let holders = holders.map(|part| bound.declared_symbol(Decl::Var(part)));
                    made_by.extend(holders.filter(|it| it.is_some()).map(|it| (it, import)));
                }
                Parent::Expr(user) => {
                    if let ExprKind::Assign {
                        op: None,
                        target,
                        value: stored,
                    } = hir[user].kind
                        && stored == value
                        && let Binding::Symbol(holder) =
                            bound.binding(hir.skip_type_assertions(target))
                    {
                        made_by.push((holder, import));
                    }
                }
                _ => {}
            }
        }
        made_by.shared_sort_by_key(|it| it.0);
        made_by.dedup_by_key(|it| it.0);
        made_by
    }

    fn find_site_of_file(&self, import: ImportId) -> Option<u32> {
        let &FinishedFile {
            analysis,
            resolutions,
            ..
        } = self.request;
        let site = analysis.import_site_index(ImportSiteKind::Import(import))?;
        match resolutions.get(site) {
            Some(SiteResolution::Constant(CodeResolution::File(file)))
                if file.host_module.is_none() =>
            {
                Some(site as u32)
            }
            _ => None,
        }
    }

    fn find_texts_passed(&self) -> Vec<(u32, Atom)> {
        let &FinishedFile { hir, bound, .. } = self.request;
        let made_by = self.find_what_imports_make();
        let source_of = |symbol: SymbolId| {
            let made = made_by.binary_search_by_key(&symbol, |it| it.0);
            (self.find_import_of(symbol)).or_else(|| made.ok().map(|at| made_by[at].1))
        };
        let is_parameter =
            |symbol: SymbolId| matches!(bound.symbol(symbol).decls, &[Decl::Param(_)]);
        let mut handed_to_calls: Vec<ImportId> = Vec::new();
        for &(_, call) in &self.calls {
            for operand in hir.ids(hir[call].args) {
                if let Some(import) = self.find_root_of(operand).and_then(source_of)
                    && !handed_to_calls.contains(&import)
                {
                    handed_to_calls.push(import);
                }
            }
        }
        let mut passed: Vec<(u32, Atom)> = Vec::new();
        let mut seen: FxHashSet<(u32, Atom)> = FxHashSet::default();
        for &(_, call) in &self.calls {
            let Some(root) = self.find_root_of(hir[call].callee) else {
                continue;
            };
            let import = source_of(root);
            let imports = match import {
                Some(ref import) => core::slice::from_ref(import),
                None if is_parameter(root) => &handed_to_calls[..],
                None => continue,
            };
            for site in imports.iter().filter_map(|&it| self.find_site_of_file(it)) {
                let operands = hir.ids(hir[call].args);
                for text in operands.filter_map(|operand| self.find_constant_text(operand)) {
                    if seen.insert((site, text)) {
                        passed.push((site, text));
                    }
                }
            }
        }
        passed
    }

    fn is_left_as_written(&self, holder: SymbolId, arrived_by: ExprId) -> bool {
        let &FinishedFile {
            hir, bound, atoms, ..
        } = self.request;
        let text = bound.symbol(holder).name;
        let mentions = (0..hir.exprs.len() as u32).map(ExprId).filter(|&it| {
            it != arrived_by
                && matches!(hir[it].kind, ExprKind::Ident(name) if name == text)
                && bound.is_evaluated_ident(it)
                && bound.binding(it) == Binding::Symbol(holder)
        });
        mentions.into_iter().all(|mention| {
            let mention = find_outermost_assertion(self.request, mention);
            let read = match bound.parent_of_expr(mention) {
                Parent::Expr(read) => read,
                Parent::Stmt(walk) => {
                    return matches!(hir[walk].kind, StmtKind::ForOf { expr, .. } if expr == mention);
                }
                _ => return false,
            };
            let Some((object, key)) = hir.member_key(read) else {
                return matches!(hir[read].kind, ExprKind::Spread(_));
            };
            if object != mention {
                return false;
            }
            match bound.parent_of_expr(read) {
                Parent::Expr(user) => match hir[user].kind {
                    ExprKind::Call(call) if hir[call].callee == read => matches!(
                        key,
                        MemberKey::Name(method)
                            if find_member_of(BuiltinId::ArrayPrototype, atoms, method)
                                .is_some_and(leaves_its_list_as_it_is)
                    ),
                    ExprKind::Assign { target, .. } => target != read,
                    ExprKind::Unary { op, .. } => !matches!(
                        op,
                        UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
                    ),
                    ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::New(_) => false,
                    _ => true,
                },
                _ => true,
            }
        })
    }

    fn follow(&self, state: &mut Following<'_, 'a, 's>, value: ExprId) -> Read {
        let value = self.request.hir.skip_type_assertions(value);
        if let Some((_, path)) = state.on_the_way.iter().find(|it| it.0 == value) {
            let adds_nothing = *path == state.path && state.sums_being_filled == 0;
            return if adds_nothing {
                Read::Whole
            } else {
                Read::NotRead
            };
        }
        let path = state.path.clone();
        state.on_the_way.push((value, path.clone()));
        let read = self.follow_by_kind(state, value);
        state.on_the_way.pop();
        state.path = path;
        read
    }

    fn follow_each(
        &self,
        state: &mut Following<'_, 'a, 's>,
        values: impl Iterator<Item = ExprId>,
    ) -> Read {
        let mut read = Read::Whole;
        for value in values {
            read = read.max(self.follow(state, value));
            if read == Read::NotRead {
                break;
            }
        }
        read
    }

    fn follow_by_kind(&self, state: &mut Following<'_, 'a, 's>, value: ExprId) -> Read {
        let &FinishedFile { hir, atoms, .. } = self.request;
        if matches!(state.path[..], [] | [Step::Row(0)]) {
            if let Some(text) = self.find_constant_text(value) {
                state.texts.push(text);
                return Read::Whole;
            }
            let set = state.known.of(value);
            if !set.is_empty() {
                state.texts.extend(set.iter().filter_map(|&it| match it {
                    Constant::String(text) => Some(text),
                    _ => None,
                }));
                return Read::Whole;
            }
        }
        match hir[value].kind {
            ExprKind::Ident(_) => self.follow_name(state, value),
            ExprKind::Array(items) => {
                let is_written =
                    |it: ExprId| !matches!(hir[it].kind, ExprKind::Spread(_) | ExprKind::Missing);
                let place = match state.path.pop() {
                    Some(Step::AnyElement) => {
                        let mut read = Read::Whole;
                        for item in hir.ids(items) {
                            read = read.max(match hir[item].kind {
                                ExprKind::Missing => Read::NotRead,
                                ExprKind::Spread(list) => {
                                    state.path.push(Step::AnyElement);
                                    let read = self.follow(state, list);
                                    state.path.pop();
                                    read
                                }
                                _ => self.follow(state, item),
                            });
                        }
                        return read;
                    }
                    Some(Step::Row(place)) => Some(place as usize),
                    Some(Step::Member(place)) => core::str::from_utf8(atoms.bytes(place))
                        .ok()
                        .and_then(|it| it.parse().ok()),
                    None => None,
                };
                match place.and_then(|place| hir.ids(items).nth(place).map(|item| (place, item))) {
                    Some((place, item)) if hir.ids(items).take(place + 1).all(is_written) => {
                        self.follow(state, item)
                    }
                    _ => Read::NotRead,
                }
            }
            ExprKind::Object(properties) => {
                if state.path.last() == Some(&Step::Row(0)) {
                    state.path.pop();
                }
                let Some(Step::Member(name)) = state.path.pop() else {
                    return Read::NotRead;
                };
                let mut found = None;
                for property in properties.iter().map(|it| hir[it]) {
                    match (property.kind, property.key) {
                        (PropKind::Init | PropKind::Shorthand, PropKey::Name(key))
                            if key == name =>
                        {
                            found = Some(property.value);
                        }
                        (_, PropKey::Name(key))
                            if key != name && property.kind != PropKind::Spread => {}
                        _ => return Read::NotRead,
                    }
                }
                found.map_or(Read::NotRead, |value| self.follow(state, value))
            }
            ExprKind::Template { .. } | ExprKind::Binary { op: BinOp::Add, .. }
                if state.path.is_empty() =>
            {
                self.follow_sum(state, value)
            }
            ExprKind::Call(call) => self.follow_call(state, call),
            _ => match hir.member_key(value) {
                Some((object, MemberKey::Name(name))) => {
                    state.path.push(Step::Member(name));
                    self.follow(state, object)
                }
                Some((object, MemberKey::Computed(_))) => {
                    state.path.push(Step::AnyElement);
                    self.follow(state, object)
                }
                _ => Read::NotRead,
            },
        }
    }

    fn follow_name(&self, state: &mut Following<'_, 'a, 's>, mention: ExprId) -> Read {
        let &FinishedFile {
            hir, bound, atoms, ..
        } = self.request;
        let Binding::Symbol(name) = bound.binding(mention) else {
            return Read::NotRead;
        };
        let &[Decl::Var(mut pattern) | Decl::Param(mut pattern)] = bound.symbol(name).decls else {
            return Read::NotRead;
        };
        if !bound.stores_to(name).is_empty()
            || bound.is_visible_to_eval(name)
            || !bound.is_evaluated_ident(mention)
            || bound
                .dynamic_lookup_scope(NodeData::Expr(mention))
                .is_some()
            || !(state.path.is_empty() || self.is_left_as_written(name, mention))
        {
            return Read::NotRead;
        }
        let is_whole_parameter = matches!(bound.pat_parent[pattern.idx()], PatParent::Param(_));
        let top = loop {
            match bound.pat_parent[pattern.idx()] {
                PatParent::Elem(above, element) => {
                    let PatKind::Array(elements) = hir[above].kind else {
                        return Read::NotRead;
                    };
                    let Some(place) = elements.iter().position(|it| it == element) else {
                        return Read::NotRead;
                    };
                    if hir[element].is_rest || hir[element].default.is_some() {
                        return Read::NotRead;
                    }
                    let place = atoms.intern(place.to_string().as_bytes());
                    state.path.push(Step::Member(place));
                    pattern = above;
                }
                PatParent::Prop(above, property) => {
                    let PropKey::Name(key) = hir.runtime_binding_key(property) else {
                        return Read::NotRead;
                    };
                    if hir[property].is_rest || hir[property].default.is_some() {
                        return Read::NotRead;
                    }
                    state.path.push(Step::Member(key));
                    pattern = above;
                }
                top => break top,
            }
        };
        match top {
            PatParent::Var(declaration) => {
                let statement = bound.var_stmt[declaration.idx()];
                if let Parent::Stmt(above) = bound.parent_of_stmt(statement) {
                    match hir[above].kind {
                        StmtKind::ForOf { left, expr, .. } if left == statement => {
                            state.path.push(Step::AnyElement);
                            return self.follow(state, expr);
                        }
                        StmtKind::ForIn { left, .. } if left == statement => return Read::NotRead,
                        _ => {}
                    }
                }
                match hir[declaration].init.some() {
                    Some(value) => self.follow(state, value),
                    None => Read::NotRead,
                }
            }
            PatParent::Param(parameter) => {
                self.follow_parameter(state, mention, parameter, is_whole_parameter)
            }
            _ => Read::NotRead,
        }
    }

    fn follow_parameter(
        &self,
        state: &mut Following<'_, 'a, 's>,
        mention: ExprId,
        parameter: ParamId,
        is_whole_parameter: bool,
    ) -> Read {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            atoms,
            ..
        } = self.request;
        if is_whole_parameter
            && let Some(values) = find_values_of_parameter(hir, bound, &analysis.decisions, mention)
        {
            return self.follow_each(state, values.into_iter());
        }
        let function = bound.param_fn[parameter.idx()];
        let Some((call, callback)) = find_call_that_takes_callback(hir, bound, parameter) else {
            return Read::FromOutside;
        };
        let place = hir[function].params.iter().position(|it| it == parameter);
        let is_as_handed =
            hir[parameter].default.is_none() && !hir[parameter].flags.contains(Flags::REST);
        let (Some(place), true) = (place, is_as_handed) else {
            return Read::NotRead;
        };
        let callee = hir.skip_type_assertions(hir[call].callee);
        match (hir.member_key(callee), hir[callee].kind) {
            (Some((list, MemberKey::Name(method))), _)
                if place == 0
                    && find_member_of(BuiltinId::ArrayPrototype, atoms, method)
                        .is_some_and(hands_each_item_to_callback)
                    && hir.ids(hir[call].args).next() == Some(callback) =>
            {
                state.path.push(Step::AnyElement);
                self.follow(state, list)
            }
            (None, ExprKind::Call(in_front)) => {
                let mut operands = hir.ids(hir[in_front].args);
                let (Some(rows), None) = (operands.next(), operands.next()) else {
                    return Read::NotRead;
                };
                state.path.push(Step::Row(place as u32));
                state.path.push(Step::AnyElement);
                self.follow(state, rows)
            }
            _ => Read::NotRead,
        }
    }

    fn follow_apart(&self, state: &mut Following<'_, 'a, 's>, value: ExprId) -> (Read, Vec<Atom>) {
        let (path, texts) = (
            core::mem::take(&mut state.path),
            core::mem::take(&mut state.texts),
        );
        let read = self.follow(state, value);
        state.path = path;
        (read, core::mem::replace(&mut state.texts, texts))
    }

    fn follow_call(&self, state: &mut Following<'_, 'a, 's>, call: CallId) -> Read {
        let &FinishedFile { hir, atoms, .. } = self.request;
        let mut operands = hir.ids(hir[call].args);
        let (Some(at), None) = (operands.next(), operands.next()) else {
            return Read::NotRead;
        };
        let callee = hir.member_key(hir.skip_type_assertions(hir[call].callee));
        if let Some((list, MemberKey::Name(method))) = callee
            && find_member_of(BuiltinId::ArrayPrototype, atoms, method)
                == Some(BuiltinId::ArrayPrototypeFilter)
            && state.path.last() == Some(&Step::AnyElement)
        {
            return self.follow(state, list);
        }
        let (Some((whole, MemberKey::Name(method))), Some(at), [Step::AnyElement]) =
            (callee, self.find_constant_text(at), &state.path[..])
        else {
            return Read::NotRead;
        };
        let method = find_member_of(BuiltinId::StringPrototype, atoms, method);
        if method != Some(BuiltinId::StringPrototypeSplit) || atoms.bytes(at).is_empty() {
            return Read::NotRead;
        }
        let (read, wholes) = self.follow_apart(state, whole);
        if read != Read::Whole {
            return Read::NotRead;
        }
        for whole in wholes {
            let whole = atoms.bytes(whole).to_vec();
            let pieces = split(&whole, atoms.bytes(at));
            state.texts.extend(pieces.map(|piece| atoms.intern(piece)));
        }
        Read::Whole
    }

    fn follow_sum(&self, state: &mut Following<'_, 'a, 's>, text: ExprId) -> Read {
        let &FinishedFile { hir, atoms, .. } = self.request;
        let mut parts: Vec<Result<Atom, ExprId>> = Vec::new();
        match hir[text].kind {
            ExprKind::Template { exprs } => {
                let mut between = hir.ids(hir.template_texts(exprs));
                parts.extend(between.next().map(Ok));
                for (hole, behind) in hir.ids(exprs).zip(between) {
                    parts.extend([Err(hole), Ok(behind)]);
                }
            }
            ExprKind::Binary { left, right, .. } => parts.extend([Err(left), Err(right)]),
            _ => return Read::NotRead,
        }
        let mut joined: Vec<Vec<u8>> = vec![Vec::new()];
        for part in parts {
            let fillings = match part {
                Ok(written) if written.is_none() => return Read::NotRead,
                Ok(written) => vec![written],
                Err(hole) => {
                    state.sums_being_filled += 1;
                    let (read, fillings) = self.follow_apart(state, hole);
                    state.sums_being_filled -= 1;
                    if read != Read::Whole {
                        return Read::NotRead;
                    }
                    fillings
                }
            };
            if joined.len() > 1 && fillings.len() > 1 {
                return Read::NotRead;
            }
            let longer = joined.iter().flat_map(|start| {
                let fillings = fillings.iter();
                fillings.map(move |&filling| [&start[..], atoms.bytes(filling)].concat())
            });
            joined = longer.collect();
        }
        state
            .texts
            .extend(joined.iter().map(|text| atoms.intern(text)));
        Read::Whole
    }

    pub(super) fn finish(mut self, found: &mut FileOfRun) {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            atoms,
            ..
        } = self.request;
        found.texts_passed = self.find_texts_passed();
        let mut known = KnownSets::new(hir, bound, &analysis.decisions, atoms);
        for spy in self.builtins.spy_calls() {
            if spy.name.is_some()
                || analysis.decisions.is_dead_expr(spy.call)
                || self.is_namespace_in_sight(spy.object)
            {
                continue;
            }
            let mut state = Following {
                known: &mut known,
                path: Vec::new(),
                on_the_way: Vec::new(),
                sums_being_filled: 0,
                texts: Vec::new(),
            };
            let name = match hir[spy.call].kind {
                ExprKind::Call(call) => hir.ids(hir[call].args).nth(1),
                _ => None,
            };
            let read = name.map_or(Read::NotRead, |name| self.follow(&mut state, name));
            found.spies_under_names_from_outside |= read == Read::FromOutside;
            found.spies_under_names_that_nobody_reads |= read == Read::NotRead;
            if read != Read::NotRead {
                found.spies_read.push(spy.call);
                found.names_of_spies_read.extend(state.texts);
            }
        }
        self.names_stored.shared_sort_unstable_by_key(|name| name.0);
        self.names_stored.dedup();
        found.names_stored_on_unknown_objects = self.names_stored;
        found.names_stored_above_literals = self.names_stored_above_literals;
    }
}

pub(super) struct NamesOfHelpers {
    pub names: Vec<Atom>,
    pub texts_passed: Vec<usize>,
}

fn find_helpers_behind(files: &Files<'_>, taker: FileId, helpers: &[FileId]) -> Vec<usize> {
    let mut reached = vec![taker];
    let mut looked_at = 0;
    while let Some(&file) = reached.get(looked_at) {
        looked_at += 1;
        let Some(compiled) = files.compiled(file) else {
            continue;
        };
        let sites = compiled.analysis.import_sites.iter();
        for (site, answer) in sites.zip(compiled.code_answers) {
            if let ImportSiteKind::ExportFrom(_) | ImportSiteKind::ExportStar(_) = site.kind
                && let CodeAnswer::File(again) = *answer
                && !reached.contains(&again)
            {
                reached.push(again);
            }
        }
    }
    let positions = reached.iter();
    positions
        .filter_map(|file| helpers.binary_search(file).ok())
        .collect()
}

pub(super) fn settle_names_of_helpers(files: &Files<'_>, helpers: &[FileId]) -> NamesOfHelpers {
    let mut settled = NamesOfHelpers {
        names: Vec::new(),
        texts_passed: vec![0; helpers.len()],
    };
    if helpers.is_empty() {
        return settled;
    }
    let mut helpers_behind: FxHashMap<FileId, Vec<usize>> = FxHashMap::default();
    for &file in files.compiled_files() {
        let Some(source) = parsed_source(files, file) else {
            continue;
        };
        let answers = files.compiled(file).map_or(&[][..], |it| it.code_answers);
        for &(site, text) in &source.of_run.texts_passed {
            let Some(&CodeAnswer::File(taker)) = answers.get(site as usize) else {
                continue;
            };
            let behind = helpers_behind.entry(taker);
            let behind = behind.or_insert_with(|| find_helpers_behind(files, taker, helpers));
            for &position in behind.iter() {
                settled.texts_passed[position] += 1;
            }
            if !behind.is_empty() {
                settled.names.push(text);
            }
        }
    }
    settled
}

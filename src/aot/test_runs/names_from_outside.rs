//! Names that reach a write from another place than the write itself.
//! `export const watch = (object, name) => spyOn(object, name)` in one file, `watch(lib, "total")` in another: the texts that go to the helper may be the name.
//! `const put = object => { object.__mark = 1; }`, `put(Object.prototype)`: the name is spelled, and the object comes from somewhere.

use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingInitializer, Decl, FnOwner, Parent, PatParent, SymbolId};
use bun_sema::fold::{Constant, FoldedValue, KnownSets};
use bun_sema::hir::{
    BinOp, CallId, ExprId, ExprKind, FnId, IdList, ImportId, MemberKey, PatId, PatKind, PropKind,
    StmtKind,
};
use bun_sema::import_sites::{ImportSiteKind, find_values_of_parameter};
use bun_sema::program::{CodeAnswer, FileId, Files};
use bun_sema::resolve::{CodeResolution, FinishedFile, SiteResolution};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};

use super::FileOfRun;
use super::out_of_sight::find_outermost_assertion;
use crate::builtins::{BuiltinId, ResolvedBuiltins, table};
use crate::load::sources::parsed_source;

/// In `FileOfRun::texts_passed`, in the place of an import site: the file spells the text for a spy of its own.
pub(super) const OWN_FILE: u32 = u32::MAX;

pub(super) struct NamesFromOutside<'a, 's> {
    request: &'a FinishedFile<'a, 's>,
    builtins: &'a ResolvedBuiltins,
    /// A package imports no helper of the tests, and is handed no object of theirs to write on.
    is_in_package: bool,
    /// The calls in code that runs, in the order of the expressions.
    calls: Vec<(ExprId, CallId)>,
    names_stored: Vec<Atom>,
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

    /// A parameter, a variable of a loop, what a call answers: a name that holds an object which the file has not made where the name is bound.
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

    // `object.name = value`, `object["name"] = value`
    fn look_at_store(&mut self, target: ExprId) {
        let hir = self.request.hir;
        let Some((object, key)) = hir.member_key(hir.skip_type_assertions(target)) else {
            return;
        };
        let name = match key {
            MemberKey::Name(name) => Some(name),
            MemberKey::Computed(key) => self.find_constant_text(key),
            MemberKey::PrivateName(_) => None,
        };
        if let Some(name) = name.filter(|_| self.is_object_from_somewhere(object)) {
            self.names_stored.push(name);
        }
    }

    // `Reflect.set(object, "name", value)`, `Object.defineProperty(object, "name", descriptor)`
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
        if let (true, Some(object), Some(key)) = (stores, operands.next(), operands.next())
            && let Some(name) = self.find_constant_text(key)
            && self.is_object_from_somewhere(object)
        {
            self.names_stored.push(name);
        }
    }

    /// `expression`: in code that runs.
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

    // `watch` of `watch(..)`, `tracker` of `tracker.watch(..)`
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

    /// `const tracker = createTracker(); tracker.watch(holder, "read")`, `const { watch } = createTracker()`, `tracker = createTracker()` in a hook:
    /// what a function of another file returns takes its texts there too. By the name that holds it, each once.
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

    /// The import site of a file of the program.
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

    /// The constant texts among the operands of each call of what the file imports from another file, or of what that has made.
    fn find_texts_passed(&self) -> Vec<(u32, Atom)> {
        let &FinishedFile { hir, bound, .. } = self.request;
        let made_by = self.find_what_imports_make();
        let source_of = |symbol: SymbolId| {
            let made = made_by.binary_search_by_key(&symbol, |it| it.0);
            (self.find_import_of(symbol)).or_else(|| made.ok().map(|at| made_by[at].1))
        };
        // `function start(watch: Tracker["watch"]) { watch(holder, "read"); }`, `start(tracker.watch)`: what goes into a call may be what a parameter of this file holds.
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

    // `["half"]`, or a name that is bound once to such a list.
    fn find_list_written(&self, list: ExprId) -> Option<IdList<ExprId>> {
        let &FinishedFile { hir, bound, .. } = self.request;
        let list = hir.skip_type_assertions(list);
        let written = match (hir[list].kind, bound.binding(list)) {
            (ExprKind::Ident(_), Binding::Symbol(holder)) if bound.is_stable_binding(holder) => {
                match bound.binding_initializer(hir, holder) {
                    BindingInitializer::Expression(value) => hir.skip_type_assertions(value),
                    _ => return None,
                }
            }
            _ => list,
        };
        match hir[written].kind {
            ExprKind::Array(items) => Some(items),
            _ => None,
        }
    }

    // What stands at the top of the pattern that binds `mention`: a declaration, a parameter.
    fn find_top_of_pattern(&self, mention: ExprId) -> Option<PatParent> {
        let bound = self.request.bound;
        let Binding::Symbol(name) = bound.binding(mention) else {
            return None;
        };
        let &[Decl::Var(mut pattern) | Decl::Param(mut pattern)] = bound.symbol(name).decls else {
            return None;
        };
        if !bound.stores_to(name).is_empty() || bound.is_visible_to_eval(name) {
            return None;
        }
        loop {
            match bound.pat_parent[pattern.idx()] {
                PatParent::Elem(above, _) | PatParent::Prop(above, _) => pattern = above,
                top => return Some(top),
            }
        }
    }

    /// `ROWS` for `name` in `for (const [kind, name] of ROWS)`, `ROW` in `const { name } = ROW`: what a pattern takes out of a list or an object is somewhere in it.
    fn find_what_pattern_takes_apart(&self, mention: ExprId) -> Option<ExprId> {
        let &FinishedFile { hir, bound, .. } = self.request;
        let PatParent::Var(declaration) = self.find_top_of_pattern(mention)? else {
            return None;
        };
        let statement = bound.var_stmt[declaration.idx()];
        match bound.parent_of_stmt(statement) {
            Parent::Stmt(above) => match hir[above].kind {
                StmtKind::ForOf { left, expr, .. } if left == statement => return Some(expr),
                StmtKind::ForIn { left, .. } if left == statement => return None,
                _ => {}
            },
            _ => {}
        }
        hir[declaration].init.some()
    }

    // The function, for a name that a parameter binds, alone or in a pattern.
    fn find_function_of_parameter(&self, mention: ExprId) -> Option<FnId> {
        match self.find_top_of_pattern(mention)? {
            PatParent::Param(parameter) => Some(self.request.bound.param_fn[parameter.idx()]),
            _ => None,
        }
    }

    /// `LISTED` for `name` in `LISTED.map(name => tapped(object, name))`.
    fn find_list_walked_by_callback(&self, mention: ExprId) -> Option<IdList<ExprId>> {
        let &FinishedFile { hir, bound, .. } = self.request;
        let function = self.find_function_of_parameter(mention)?;
        let FnOwner::Expr(callback) = bound.fns[function.idx()].owner else {
            return None;
        };
        let callback = find_outermost_assertion(self.request, callback);
        let Parent::Expr(user) = bound.parent_of_expr(callback) else {
            return None;
        };
        let ExprKind::Call(call) = hir[user].kind else {
            return None;
        };
        if hir.ids(hir[call].args).next() != Some(callback) {
            return None;
        }
        match hir.member_key(hir.skip_type_assertions(hir[call].callee))? {
            (list, MemberKey::Name(_)) => self.find_list_written(list),
            _ => None,
        }
    }

    /// `[["half", 1]]` for `name` in `test.each([["half", 1]])("halves", (name, count) => tapped(object, name))`: what the call in front was handed may be what the callback is called with.
    fn find_operands_of_call_in_front(&self, mention: ExprId) -> Option<IdList<ExprId>> {
        let &FinishedFile { hir, bound, .. } = self.request;
        let function = self.find_function_of_parameter(mention)?;
        let FnOwner::Expr(callback) = bound.fns[function.idx()].owner else {
            return None;
        };
        let callback = find_outermost_assertion(self.request, callback);
        let Parent::Expr(user) = bound.parent_of_expr(callback) else {
            return None;
        };
        let ExprKind::Call(call) = hir[user].kind else {
            return None;
        };
        if !hir.ids(hir[call].args).any(|operand| operand == callback) {
            return None;
        }
        match hir[hir.skip_type_assertions(hir[call].callee)].kind {
            ExprKind::Call(in_front) => Some(hir[in_front].args),
            _ => None,
        }
    }

    /// The texts that the file itself spells for `value`: a constant, one of a known set, what the calls of a function of the file pass for a parameter, the elements of a list
    /// that a callback walks or that the call in front of the callback's was handed. What is not spelled here comes from outside.
    /// `being_filled`: the texts with holes around `value`. False: one of them fills a hole of its own, `watch(name + "Next")` in `watch(name)`, so nobody can list what the run makes.
    fn push_texts_spelled_for(
        &self,
        known: &mut KnownSets<'a, 's>,
        value: ExprId,
        being_filled: &mut Vec<ExprId>,
        texts: &mut Vec<Atom>,
    ) -> bool {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        let (mut seen, mut pending) = (Vec::new(), vec![value]);
        while let Some(value) = pending.pop() {
            let value = hir.skip_type_assertions(value);
            if seen.contains(&value) {
                continue;
            }
            seen.push(value);
            if let Some(text) = self.find_constant_text(value) {
                texts.push(text);
                continue;
            }
            let set = known.of(value);
            if !set.is_empty() {
                texts.extend(set.iter().filter_map(|&it| match it {
                    Constant::String(text) => Some(text),
                    _ => None,
                }));
                continue;
            }
            if let Some(items) = self.find_list_written(value) {
                pending.extend(hir.ids(items));
                continue;
            }
            match hir[value].kind {
                ExprKind::Ident(_) => {}
                ExprKind::Object(properties) => {
                    let written = properties.iter().map(|property| hir[property]);
                    let written = written.filter(|property| property.kind == PropKind::Init);
                    pending.extend(written.map(|property| property.value));
                    continue;
                }
                ExprKind::Template { .. } | ExprKind::Binary { op: BinOp::Add, .. } => {
                    if being_filled.contains(&value) {
                        return false;
                    }
                    being_filled.push(value);
                    let is_listed =
                        self.push_texts_with_holes_filled(known, value, being_filled, texts);
                    being_filled.pop();
                    if !is_listed {
                        return false;
                    }
                    continue;
                }
                _ => continue,
            }
            if let Some(values) = find_values_of_parameter(hir, bound, &analysis.decisions, value) {
                pending.extend(values);
            } else if let Some(items) = self.find_list_walked_by_callback(value) {
                pending.extend(hir.ids(items));
            } else if let Some(operands) = self.find_operands_of_call_in_front(value) {
                pending.extend(hir.ids(operands));
            } else if let Some(taken_apart) = self.find_what_pattern_takes_apart(value) {
                pending.push(taken_apart);
            }
        }
        true
    }

    /// `logHalf` and `logAdd` for `` `log${kind}` `` where `kind` is spelled as `Half` and `Add`. A hole that nobody spells leaves the whole text unspelled.
    /// `being_filled` ends with `text`. False as for `push_texts_spelled_for`.
    fn push_texts_with_holes_filled(
        &self,
        known: &mut KnownSets<'a, 's>,
        text: ExprId,
        being_filled: &mut Vec<ExprId>,
        texts: &mut Vec<Atom>,
    ) -> bool {
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
            _ => return true,
        }
        let mut joined: Vec<Vec<u8>> = vec![Vec::new()];
        for part in parts {
            let mut fillings = Vec::new();
            match part {
                Ok(written) if written.is_none() => return true,
                Ok(written) => fillings.push(written),
                Err(hole) => {
                    if !self.push_texts_spelled_for(known, hole, being_filled, &mut fillings) {
                        return false;
                    }
                }
            }
            let longer = joined.iter().flat_map(|start| {
                let fillings = fillings.iter();
                fillings.map(move |&filling| [&start[..], atoms.bytes(filling)].concat())
            });
            joined = longer.collect();
        }
        texts.extend(joined.iter().map(|text| atoms.intern(text)));
        true
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
        let spies = self.builtins.spy_calls().iter();
        let nameless =
            spies.filter(|spy| spy.name.is_none() && !analysis.decisions.is_dead_expr(spy.call));
        let mut known = KnownSets::new(hir, bound, &analysis.decisions, atoms);
        let mut spelled = Vec::new();
        for spy in nameless {
            found.spies_under_names_from_outside = true;
            if let ExprKind::Call(call) = hir[spy.call].kind
                && let Some(name) = hir.ids(hir[call].args).nth(1)
            {
                found.spies_under_names_made_of_themselves |=
                    !self.push_texts_spelled_for(&mut known, name, &mut Vec::new(), &mut spelled);
            }
        }
        (found.texts_passed).extend(spelled.into_iter().map(|text| (OWN_FILE, text)));
        self.names_stored.shared_sort_unstable_by_key(|name| name.0);
        self.names_stored.dedup();
        found.names_stored_on_unknown_objects = self.names_stored;
    }
}

/// What the spies under names from outside may be laid under.
pub(super) struct NamesOfHelpers {
    /// With repeats, in no order.
    pub names: Vec<Atom>,
    /// How many texts go to each helper. To one that gets none, nobody spells a name: it may be any name.
    pub texts_passed: Vec<usize>,
}

/// Where in `helpers` stand `taker` and the files that it exports again, `export * from "./helper"`, and so on down: whoever calls what the file hands on calls the helper.
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

/// `helpers`: the files with `FileOfRun::spies_under_names_from_outside`, ascending. Every text that goes to such a file may be the name.
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
            let taker = match (site, answers.get(site as usize)) {
                (OWN_FILE, _) => file,
                (_, Some(&CodeAnswer::File(taker))) => taker,
                _ => continue,
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

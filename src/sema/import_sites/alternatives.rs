//! A name that is given to a loader and is no constant may still be one of a few texts: an entry of a table, an element of a list that a loop walks, what a
//! function of the file returns, a variable that grows by a part in one arm of a condition. Every such text is followed like a constant.
//! Nothing is run. A value is what folding says, or the values of the expressions that a binding leads to.

use super::call_sites::{expr_kind, is_free_common_js, is_free_name, is_process};
use super::made_requires::{find_imported_export, may_be_modified};
use super::parameters::{find_values_passed_for, is_exported};
use super::{
    ImportSiteKind, ImportSpecifier, ResolvedForm, ScanInputs, call_site_arguments, call_site_kind,
};
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingKind, BindingStability, CommonJsVariable, Decl, FnOwner,
    Parent, PatParent, StoreKind, SymbolId, UNREACHABLE,
};
use crate::fold::{
    Constant, FoldedValue, PathBelowFolder, apply_binary, apply_template,
    find_path_joining_function, trim_lead_surrogate_at_end, trim_trail_surrogate_at_start,
};
use crate::hir::{
    BinOp, Branches, Call, Chain, ExprId, ExprKind, File, Flags, FnBody, FnId, IdList, MemberKey,
    NodeData, PatId, PatKind, PropKey, PropKind, StmtKind, UnOp, is_proto_setter,
};
use crate::util::{FxHashSet, SharedSort};
use bun_core::strings;
use std::cell::OnceCell;

const MOST_ALTERNATIVES: usize = 64;
const MOST_EXPRESSIONS_FOLLOWED: u32 = 4096;
const DEEPEST_EXPRESSION: u32 = 64;

#[derive(Clone, PartialEq, Debug)]
struct Text {
    start: Vec<u8>,
    /// `None`: `start` is all of it.
    end: Option<Vec<u8>>,
    starts_at_own_directory: bool,
}

impl Text {
    fn whole(text: &[u8]) -> Text {
        Text {
            start: text.to_vec(),
            end: None,
            starts_at_own_directory: false,
        }
    }

    fn unknown() -> Text {
        Text {
            start: Vec::new(),
            end: Some(Vec::new()),
            starts_at_own_directory: false,
        }
    }

    fn push(&mut self, next: &Text) {
        if self.end.is_none() && self.start.is_empty() {
            self.clone_from(next);
            return;
        }
        let next = match next.starts_at_own_directory {
            true => &Text::unknown(),
            false => next,
        };
        match (&mut self.end, &next.end) {
            (None, end) => {
                strings::push_wtf8(&mut self.start, &next.start);
                self.end.clone_from(end);
            }
            (Some(end), None) => strings::push_wtf8(end, &next.start),
            (Some(end), Some(next_end)) => end.clone_from(next_end),
        }
    }

    fn len(&self) -> usize {
        self.start.len() + self.end.as_ref().map_or(0, Vec::len)
    }
}

#[derive(Clone, PartialEq, Debug)]
enum Held {
    Text(Text),
    /// What a resolver answers for the name.
    Resolved(Text, ResolvedForm),
    /// No text.
    Primitive(Constant),
    /// For each place of a list, what it may hold.
    List(Vec<Vec<Held>>),
    /// A list of any length, and what each of its places may hold.
    ListOf(Vec<Held>),
    Object(ExprId),
    Function(FnId),
    /// The object `process`.
    Process,
    /// What `node:os` exports, and a function of it.
    Os,
    FunctionOfOs(Atom),
    /// Something else that is no text.
    Other,
}

impl Held {
    fn can_be_changed(&self) -> bool {
        matches!(self, Held::List(_) | Held::ListOf(_) | Held::Object(_))
    }
}

type Values = Vec<Held>;

fn add(values: &mut Values, value: Held) {
    if !values.contains(&value) {
        values.push(value);
    }
}

/// Where each name is written in a file, by name. Made for the first site that asks, and read by all the sites of the file.
#[derive(Default)]
pub(super) struct WrittenNames(OnceCell<Vec<(Atom, ExprId)>>);

impl WrittenNames {
    fn find(&self, hir: &File<'_>, name: Atom) -> &[(Atom, ExprId)] {
        let all = self.0.get_or_init(|| {
            let exprs = (0..).map(ExprId).zip(hir.exprs.iter());
            let mut all: Vec<(Atom, ExprId)> = exprs
                .filter_map(|(e, written)| match written.kind {
                    ExprKind::Ident(name) => Some((name, e)),
                    _ => None,
                })
                .collect();
            all.shared_sort_unstable_by_key(|it| (it.0.0, it.1));
            all
        });
        let first = all.partition_point(|it| it.0.0 < name.0);
        let count = all[first..].partition_point(|it| it.0 == name);
        &all[first..first + count]
    }
}

struct Follower<'i, 'a, 's> {
    inputs: &'i ScanInputs<'a, 's>,
    written_names: &'i WrittenNames,
    /// The variables whose lists and objects are taken to stay as they are written.
    kept_as_written: FxHashSet<SymbolId>,
    unchecked: Vec<SymbolId>,
    not_kept_as_written: FxHashSet<SymbolId>,
    variables_in_progress: Vec<SymbolId>,
    functions_in_progress: Vec<FnId>,
    expressions_left: u32,
    depth: u32,
}

pub(super) struct Found {
    pub(super) alternatives: Vec<ImportSpecifier>,
    /// Each is written from the folder of the file, `./lib/a.js`, where the program makes the whole path.
    pub(super) start_at_own_directory: bool,
    /// Each is the name that a resolver is asked for, where the program hands on what it answers.
    pub(super) resolved_form: Option<ResolvedForm>,
}

pub(super) fn find_alternatives(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    argument: ExprId,
) -> Option<Found> {
    let mut follower = Follower {
        inputs,
        written_names,
        kept_as_written: FxHashSet::default(),
        unchecked: Vec::new(),
        not_kept_as_written: FxHashSet::default(),
        variables_in_progress: Vec::new(),
        functions_in_progress: Vec::new(),
        expressions_left: MOST_EXPRESSIONS_FOLLOWED,
        depth: 0,
    };
    let values = follower.values_of_argument(argument)?;
    let mut texts: Vec<Text> = Vec::with_capacity(values.len());
    let mut forms: Vec<Option<ResolvedForm>> = Vec::with_capacity(values.len());
    for value in values {
        let (text, form) = match value {
            Held::Text(text) => (text, None),
            Held::Resolved(text, form) => (text, Some(form)),
            Held::Primitive(_) | Held::Other => continue,
            _ => return None,
        };
        texts.push(text);
        forms.push(form);
    }
    let resolved_form = *forms.first()?;
    if forms.iter().any(|&form| form != resolved_form) {
        return None;
    }
    // A resolver answers the same for `./lib/a.js` and for the whole path of that file.
    let start_at_own_directory = match resolved_form {
        Some(_) => false,
        None => texts.first()?.starts_at_own_directory,
    };
    if inputs.decisions.is_path_from_own_directory(argument) && !start_at_own_directory {
        return None;
    }
    let mut alternatives: Vec<(Vec<u8>, Option<Vec<u8>>)> = Vec::with_capacity(texts.len());
    for mut text in texts {
        let is_below_folder =
            text.start.starts_with(b"./") || text.end.is_none() && text.start == b".";
        if resolved_form.is_none() && text.starts_at_own_directory != start_at_own_directory
            || text.starts_at_own_directory && !is_below_folder
        {
            return None;
        }
        if let Some(end) = &mut text.end {
            trim_lead_surrogate_at_end(&mut text.start);
            trim_trail_surrogate_at_start(end);
            if text.start.is_empty() {
                return None;
            }
        }
        alternatives.push((text.start, text.end));
    }
    alternatives.shared_sort_unstable();
    alternatives.dedup();
    let atoms = inputs.atoms;
    let alternatives = alternatives.iter().map(|(start, end)| match end {
        None => ImportSpecifier::Constant(atoms.intern(start)),
        Some(end) => ImportSpecifier::Pattern {
            prefix: atoms.intern(start),
            suffix: atoms.intern(end),
        },
    });
    Some(Found {
        alternatives: alternatives.collect(),
        start_at_own_directory,
        resolved_form,
    })
}

impl Follower<'_, '_, '_> {
    fn values_of_argument(&mut self, argument: ExprId) -> Option<Values> {
        loop {
            let values = self.values_of(argument)?;
            let known_before = self.not_kept_as_written.len();
            while let Some(symbol) = self.unchecked.pop() {
                if !self.is_kept_as_written(symbol) {
                    self.not_kept_as_written.insert(symbol);
                }
            }
            if self.not_kept_as_written.len() == known_before {
                return Some(values);
            }
            self.kept_as_written.clear();
        }
    }

    fn text_of(&self, constant: Constant) -> Option<Text> {
        let atoms = self.inputs.atoms;
        if let Constant::String(text) = constant {
            return Some(Text::whole(atoms.bytes(text)));
        }
        let empty = atoms.intern(b"");
        match apply_template(atoms, &[empty, empty], &[constant], usize::MAX)? {
            Constant::String(text) => Some(Text::whole(atoms.bytes(text))),
            _ => None,
        }
    }

    fn held_constant(&self, constant: Constant) -> Held {
        match constant {
            Constant::String(text) => Held::Text(Text::whole(self.inputs.atoms.bytes(text))),
            _ => Held::Primitive(constant),
        }
    }

    fn as_text(&self, value: &Held) -> Option<Text> {
        match value {
            Held::Text(text) => Some(text.clone()),
            Held::Primitive(constant) => self.text_of(*constant),
            _ => Some(Text::unknown()),
        }
    }

    fn is_dead(&self, e: ExprId) -> bool {
        self.inputs.decisions.is_dead_expr(e)
    }

    fn values_of(&mut self, e: ExprId) -> Option<Values> {
        self.expressions_left = self.expressions_left.checked_sub(1)?;
        if self.depth == DEEPEST_EXPRESSION {
            return None;
        }
        self.depth += 1;
        let values = self.values_of_written(e);
        self.depth -= 1;
        values.filter(|values| values.len() <= MOST_ALTERNATIVES)
    }

    fn values_of_written(&mut self, e: ExprId) -> Option<Values> {
        let &ScanInputs {
            hir,
            bound,
            decisions,
            ..
        } = self.inputs;
        let e = hir.skip_type_assertions(e);
        match decisions.constant(hir, e) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                return Some(vec![self.held_constant(constant)]);
            }
            FoldedValue::Unknown => {}
        }
        if self.names_own_directory(e) {
            return Some(vec![Held::Text(Text {
                starts_at_own_directory: true,
                ..Text::whole(b".")
            })]);
        }
        if is_process(hir, bound, e, &[known::globalThis, known::global]) {
            return Some(vec![Held::Process]);
        }
        match expr_kind(hir, e)? {
            ExprKind::Template { exprs } => self.values_of_template(exprs),
            ExprKind::Binary { op, left, right } => self.values_of_binary(op, left, right),
            ExprKind::Cond { branches, .. } => {
                let Branches { yes, no } = hir.branches(branches);
                self.values_of_any([yes, no])
            }
            ExprKind::Assign {
                op: None, value, ..
            } => self.values_of(value),
            ExprKind::Ident(_) => self.values_of_name(e),
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => {
                self.values_of_member(e, chain)
            }
            ExprKind::Call(call) => self.values_of_call(e, hir[call]),
            ExprKind::Array(items) => self.values_of_list(items),
            ExprKind::Object(_) => Some(vec![Held::Object(e)]),
            ExprKind::Fn(function) => Some(vec![Held::Function(function)]),
            _ => None,
        }
    }

    fn values_of_any(&mut self, written: impl IntoIterator<Item = ExprId>) -> Option<Values> {
        let mut values = Values::new();
        for e in written {
            if self.is_dead(e) {
                continue;
            }
            for value in self.values_of(e)? {
                add(&mut values, value);
            }
        }
        Some(values)
    }

    fn names_own_directory(&self, e: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        if is_free_common_js(hir, bound, e, CommonJsVariable::Dirname) {
            return !may_be_modified(hir, bound, CommonJsVariable::Dirname);
        }
        matches!(expr_kind(hir, e), Some(ExprKind::Dot { obj, name, chain: Chain::No, .. })
            if (name == known::meta_dir || name == known::meta_dirname)
                && matches!(expr_kind(hir, hir.skip_type_assertions(obj)), Some(ExprKind::ImportMeta)))
            && !bound.import_meta_may_be_modified()
    }

    /// Every text that is made of one value of each part.
    fn join_parts(&self, parts: &[Values]) -> Option<Values> {
        let max_bytes = self.inputs.fold.max_string_bytes();
        let mut joined = vec![Text::whole(b"")];
        for (index, part) in parts.iter().enumerate() {
            let mut longer: Vec<Text> = Vec::with_capacity(joined.len() * part.len());
            for (start, next) in joined
                .iter()
                .flat_map(|it| part.iter().map(move |n| (it, n)))
            {
                let next = self.as_text(next)?;
                let text = match index {
                    0 => next,
                    _ => {
                        let mut text = start.clone();
                        text.push(&next);
                        text
                    }
                };
                if text.len() > max_bytes {
                    return None;
                }
                if !longer.contains(&text) {
                    longer.push(text);
                }
            }
            if longer.len() > MOST_ALTERNATIVES {
                return None;
            }
            joined = longer;
        }
        Some(joined.into_iter().map(Held::Text).collect())
    }

    fn values_of_template(&mut self, exprs: IdList<ExprId>) -> Option<Values> {
        let &ScanInputs { hir, atoms, .. } = self.inputs;
        let mut texts = hir.ids(hir.template_texts(exprs));
        let written = |text: Atom| vec![Held::Text(Text::whole(atoms.bytes(text)))];
        let mut parts: Vec<Values> = Vec::with_capacity(2 * exprs.len() + 1);
        parts.extend(texts.next().map(written));
        for (substitution, text) in hir.ids(exprs).zip(texts) {
            parts.push(self.values_of(substitution).unwrap_or_else(some_text));
            parts.push(written(text));
        }
        self.join_parts(&parts)
    }

    fn values_of_binary(&mut self, op: BinOp, left: ExprId, right: ExprId) -> Option<Values> {
        match op {
            BinOp::Add => {
                let is_text = |values: &Values| values.iter().all(|it| matches!(it, Held::Text(_)));
                match (self.values_of(left), self.values_of(right)) {
                    (Some(left), Some(right)) => self.add_values(&left, &right),
                    (Some(left), None) if is_text(&left) => self.add_values(&left, &some_text()),
                    (None, Some(right)) if is_text(&right) => self.add_values(&some_text(), &right),
                    _ => None,
                }
            }
            BinOp::Comma => self.values_of(right),
            BinOp::Or | BinOp::And | BinOp::Nullish => {
                let mut values = self.values_of(left)?;
                values.retain(|value| self.may_be_result_of_left(op, value));
                if !self.is_dead(right) {
                    for value in self.values_of(right)? {
                        add(&mut values, value);
                    }
                }
                Some(values)
            }
            _ => None,
        }
    }

    fn may_be_result_of_left(&self, op: BinOp, value: &Held) -> bool {
        let (may_be_truthy, may_be_falsy, may_be_nullish) = match value {
            Held::Text(text) if text.end.is_none() => {
                (!text.start.is_empty(), text.start.is_empty(), false)
            }
            Held::Text(text) => (true, text.len() == 0, false),
            Held::Primitive(Constant::Undefined | Constant::Null) => (false, true, true),
            Held::Primitive(_) | Held::Other => (true, true, false),
            _ => (true, false, false),
        };
        match op {
            BinOp::Or => may_be_truthy,
            BinOp::And => may_be_falsy,
            _ => !may_be_nullish,
        }
    }

    fn add_values(&self, left: &Values, right: &Values) -> Option<Values> {
        let &ScanInputs { atoms, fold, .. } = self.inputs;
        let mut sums = Values::new();
        for (left, right) in left.iter().flat_map(|l| right.iter().map(move |r| (l, r))) {
            let sum = match (left, right) {
                (&Held::Primitive(left), &Held::Primitive(right)) => {
                    let operands = [left, right];
                    let sum = apply_binary(atoms, BinOp::Add, operands, fold.max_string_bytes())?;
                    vec![self.held_constant(sum)]
                }
                (Held::Text(_), _) | (_, Held::Text(_)) => {
                    self.join_parts(&[vec![left.clone()], vec![right.clone()]])?
                }
                _ => return None,
            };
            for value in sum {
                add(&mut sums, value);
            }
        }
        Some(sums)
    }

    fn values_of_list(&mut self, items: IdList<ExprId>) -> Option<Values> {
        let hir = self.inputs.hir;
        let mut places = Vec::with_capacity(items.len());
        for item in hir.ids(items) {
            places.push(match expr_kind(hir, item)? {
                ExprKind::Missing => vec![Held::Primitive(Constant::Undefined)],
                ExprKind::Spread(_) => return None,
                _ => self.values_of(item).unwrap_or_else(some_text),
            });
        }
        Some(vec![Held::List(places)])
    }

    fn mentions_of(&self, symbol: SymbolId) -> Vec<ExprId> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let written = self.written_names.find(hir, bound.symbol(symbol).name);
        let written = written.iter().map(|it| it.1);
        written
            .filter(|&e| {
                bound.is_evaluated_ident(e)
                    && bound.binding(e) == Binding::Symbol(symbol)
                    && !self.is_dead(e)
            })
            .collect()
    }

    fn outermost_cast(&self, mut e: ExprId) -> ExprId {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        while let Parent::Expr(parent) = bound.parent_of_expr(e)
            && hir.type_assertion_operand(parent).is_some()
        {
            e = parent;
        }
        e
    }

    fn values_of_name(&mut self, name: ExprId) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let Binding::Symbol(symbol) = bound.binding(name) else {
            return None;
        };
        if bound.dynamic_lookup_scope(NodeData::Expr(name)).is_some()
            || bound.is_visible_to_eval(symbol)
            || self.variables_in_progress.contains(&symbol)
        {
            return None;
        }
        self.variables_in_progress.push(symbol);
        let values = match bound.binding_kind(symbol) {
            BindingKind::Const | BindingKind::Let | BindingKind::Var => {
                self.values_of_variable(symbol)
            }
            BindingKind::Parameter => {
                let written_names = self.written_names;
                let find_written = |name: Atom| {
                    let written = written_names.find(hir, name).iter();
                    written.map(|it| it.1).collect()
                };
                match find_values_passed_for(hir, bound, self.inputs.decisions, name, &find_written)
                {
                    Some(passed) => self.values_of_any(passed),
                    None => self.values_handed_by_walk(symbol),
                }
            }
            BindingKind::Function if bound.is_stable_binding(symbol) => {
                match bound.binding_initializer(hir, symbol) {
                    BindingInitializer::Function(function) => Some(vec![Held::Function(function)]),
                    _ => None,
                }
            }
            BindingKind::Import => match find_imported_export(hir, bound, symbol) {
                Some((specifier, Some(export))) if is_process_module(specifier) => {
                    let key = self.inputs.atoms.bytes(export).to_vec();
                    self.read_member(&vec![Held::Process], Some(&[key]), Chain::No)
                }
                Some((specifier, None)) if self.is_os_module(specifier) => Some(vec![Held::Os]),
                Some((specifier, Some(export))) if self.is_os_module(specifier) => {
                    Some(vec![Held::FunctionOfOs(export)])
                }
                _ => None,
            },
            _ => None,
        };
        self.variables_in_progress.pop();
        let values = values?;
        let is_as_written =
            !values.iter().any(Held::can_be_changed) || self.take_as_kept_as_written(symbol);
        is_as_written.then_some(values)
    }

    fn values_of_variable(&mut self, symbol: SymbolId) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let is_followed = matches!(
            bound.binding_stability(symbol),
            BindingStability::Stable
                | BindingStability::Stored
                | BindingStability::NotInitializedOnce
        );
        let &[Decl::Var(pattern) | Decl::Require(pattern)] = bound.symbol(symbol).decls else {
            return None;
        };
        if !is_followed {
            return None;
        }
        let mut values = self.values_of_declaration(symbol, pattern)?;
        if bound.binding_kind(symbol) == BindingKind::Var {
            add(&mut values, Held::Primitive(Constant::Undefined));
        }
        let mut appended: Vec<(ExprId, ExprId)> = Vec::new();
        for store in bound.stores_to(symbol) {
            if self.is_dead(store.target) {
                continue;
            }
            let Parent::Expr(assignment) = bound.parent_of_expr(self.outermost_cast(store.target))
            else {
                return None;
            };
            let Some(ExprKind::Assign { value, .. }) = expr_kind(hir, assignment) else {
                return None;
            };
            match store.kind {
                StoreKind::Assign
                | StoreKind::CompoundAssign(BinOp::Or | BinOp::And | BinOp::Nullish) => {
                    for value in self.values_of(value)? {
                        add(&mut values, value);
                    }
                }
                StoreKind::CompoundAssign(BinOp::Add) => appended.push((assignment, value)),
                _ => return None,
            }
        }
        appended.shared_sort_unstable_by_key(|it| hir[it.0].pos);
        for (assignment, value) in appended {
            if !self.runs_once_for_each_binding(assignment, symbol, pattern) {
                return None;
            }
            let value = self.values_of(value)?;
            for sum in self.add_values(&values, &value)? {
                add(&mut values, sum);
            }
            if values.len() > MOST_ALTERNATIVES {
                return None;
            }
        }
        self.add_pushed_values(symbol, pattern, values)
    }

    fn values_of_declaration(&mut self, symbol: SymbolId, pattern: PatId) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        if let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] {
            let statement = bound.var_stmt[declaration.idx()];
            if let Parent::Stmt(above) = bound.parent_of_stmt(statement) {
                match hir[above].kind {
                    StmtKind::ForOf {
                        left,
                        expr,
                        is_await: false,
                        ..
                    } if left == statement => return self.values_of_elements(expr),
                    StmtKind::ForOf { left, .. } | StmtKind::ForIn { left, .. }
                        if left == statement =>
                    {
                        return None;
                    }
                    _ => {}
                }
            }
            return match hir[declaration].init.some() {
                Some(initializer) => self.values_of(initializer),
                None => Some(vec![Held::Primitive(Constant::Undefined)]),
            };
        }
        let BindingInitializer::PatternProperty { source, path } =
            bound.binding_initializer(hir, symbol)
        else {
            return None;
        };
        let mut values = self.values_of(source)?;
        for &name in &path {
            let key = self.inputs.atoms.bytes(name).to_vec();
            values = self.read_member(&values, Some(&[key]), Chain::No)?;
        }
        Some(values)
    }

    fn values_of_elements(&mut self, list: ExprId) -> Option<Values> {
        let mut elements = Values::new();
        for value in self.values_of(list)? {
            let held = match value {
                Held::List(places) => places.into_iter().flatten().collect(),
                Held::ListOf(held) => held,
                _ => return None,
            };
            for value in held {
                add(&mut elements, value);
            }
        }
        Some(elements)
    }

    /// `list.forEach((name, index, all) => ..)`: what `name` or `all` holds.
    fn values_handed_by_walk(&mut self, parameter: SymbolId) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let &[Decl::Param(pattern)] = bound.symbol(parameter).decls else {
            return None;
        };
        let PatParent::Param(id) = bound.pat_parent[pattern.idx()] else {
            return None;
        };
        let function = bound.param_fn[id.idx()];
        let FnOwner::Expr(written) = bound.fns[function.idx()].owner else {
            return None;
        };
        let position = hir[function].params.iter().position(|it| it == id)?;
        let holds_what_it_is_handed = hir[id].default.is_none()
            && !hir[id].flags.contains(Flags::REST)
            && bound.stores_to(parameter).is_empty()
            && !bound.finds_itself(hir, function);
        let Parent::Expr(walk) = bound.parent_of_expr(written) else {
            return None;
        };
        let Some(ExprKind::Call(call)) = expr_kind(hir, walk) else {
            return None;
        };
        let call = hir[call];
        let (list, _) = self.find_walk_of_list(call)?;
        if !holds_what_it_is_handed || hir.ids(call.args).next() != Some(written) {
            return None;
        }
        match position {
            0 => self.values_of_elements(list),
            2 => self.values_of(list),
            _ => None,
        }
    }

    /// The list, where the call hands each element of a list to its first argument, which leaves the list as it is. A program cannot replace these members of a list.
    fn find_walk_of_list(&mut self, call: Call) -> Option<(ExprId, Atom)> {
        let hir = self.inputs.hir;
        let (list, MemberKey::Name(name)) =
            hir.member_key(hir.skip_type_assertions(call.callee))?
        else {
            return None;
        };
        let walks = matches!(
            self.inputs.atoms.bytes(name),
            b"forEach"
                | b"map"
                | b"filter"
                | b"find"
                | b"findLast"
                | b"findIndex"
                | b"findLastIndex"
                | b"some"
                | b"every"
        );
        (walks && call.chain == Chain::No && self.keeps_walked_list_as_written(call))
            .then_some((list, name))
    }

    /// A walk hands the list itself to its first argument too, as the third argument of each call.
    fn keeps_walked_list_as_written(&mut self, walk: Call) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let written = hir.ids(walk.args).next();
        let written = written.and_then(|it| expr_kind(hir, hir.skip_type_assertions(it)));
        let Some(ExprKind::Fn(function)) = written else {
            return false;
        };
        let parameters = hir[function].params;
        let has_rest = (parameters.iter()).any(|id| hir[id].flags.contains(Flags::REST));
        if has_rest || bound.finds_itself(hir, function) {
            return false;
        }
        let Some(list) = parameters.iter().nth(2) else {
            return true;
        };
        let pattern = hir[list].pat;
        if !matches!(hir[pattern].kind, PatKind::Ident(_)) {
            return false;
        }
        let holder = bound.declared_symbol(Decl::Param(pattern));
        self.take_as_kept_as_written(holder)
            && bound.dynamic_lookup_scope(NodeData::Pat(pattern)).is_none()
            && !bound.is_visible_to_eval(holder)
    }

    fn values_of_walk(&mut self, call: Call) -> Option<Values> {
        let (list, name) = self.find_walk_of_list(call)?;
        match self.inputs.atoms.bytes(name) {
            b"filter" => Some(vec![Held::ListOf(self.values_of_elements(list)?)]),
            b"find" | b"findLast" => {
                let mut elements = self.values_of_elements(list)?;
                add(&mut elements, Held::Primitive(Constant::Undefined));
                Some(elements)
            }
            b"map" => {
                let mut made = Values::new();
                for maker in self.values_of(self.inputs.hir.ids(call.args).next()?)? {
                    let Held::Function(maker) = maker else {
                        return None;
                    };
                    for value in self.values_returned_by(maker)? {
                        add(&mut made, value);
                    }
                }
                Some(vec![Held::ListOf(made)])
            }
            _ => None,
        }
    }

    /// `Object.values(table)` and `Object.keys(table)`, where `Object` is the global.
    fn find_listing_of_object(&self, call: Call) -> Option<(ExprId, bool)> {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        let (holder, MemberKey::Name(name)) =
            hir.member_key(hir.skip_type_assertions(call.callee))?
        else {
            return None;
        };
        let lists_keys = match atoms.bytes(name) {
            b"keys" => true,
            b"values" => false,
            _ => return None,
        };
        let holder = hir.skip_type_assertions(holder);
        let mut arguments = hir.ids(call.args);
        let table = arguments.next().filter(|_| arguments.next().is_none())?;
        (call.chain == Chain::No && is_free_name(hir, bound, holder, &[known::Object]))
            .then_some((table, lists_keys))
    }

    fn values_of_listing(&mut self, table: ExprId, lists_keys: bool) -> Option<Values> {
        let mut listed = Values::new();
        for table in self.values_of(table)? {
            let Held::Object(literal) = table else {
                return None;
            };
            for (key, value) in self.properties_of(literal)? {
                let held = match lists_keys {
                    true => vec![Held::Text(Text::whole(&key))],
                    false => self.values_of(value)?,
                };
                held.into_iter().for_each(|it| add(&mut listed, it));
            }
        }
        Some(vec![Held::ListOf(listed)])
    }

    /// Between the declaration of the variable and the code there is no loop and no function, so the code runs at most once while the variable holds what it held.
    fn runs_once_for_each_binding(&self, code: ExprId, symbol: SymbolId, pattern: PatId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
            return false;
        };
        let holder = match bound.binding_kind(symbol) {
            BindingKind::Var => None,
            _ => Some(bound.parent_of_stmt(bound.var_stmt[declaration.idx()])),
        };
        let mut e = code;
        let mut statement = loop {
            match bound.parent_of_expr(e) {
                Parent::Expr(above) => e = above,
                Parent::Stmt(statement) => break statement,
                Parent::VarInit(declaration) => break bound.var_stmt[declaration.idx()],
                _ => return false,
            }
        };
        if is_loop(hir[statement].kind) {
            return false;
        }
        loop {
            let above = bound.parent_of_stmt(statement);
            if Some(above) == holder {
                return true;
            }
            statement = match above {
                Parent::Stmt(above) if !is_loop(hir[above].kind) => above,
                Parent::Case(case) => bound.case_stmt[case.idx()],
                Parent::FnBody(_) | Parent::File => return holder.is_none(),
                _ => return false,
            };
        }
    }

    fn find_call_of_member(&self, member: ExprId) -> Option<(ExprId, Call)> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let Parent::Expr(above) = bound.parent_of_expr(member) else {
            return None;
        };
        match expr_kind(hir, above) {
            Some(ExprKind::Call(call)) if hir[call].callee == member => Some((above, hir[call])),
            _ => None,
        }
    }

    /// `list.push(value)` as a statement, where `list` is `mention`.
    fn find_push(&self, mention: ExprId) -> Option<(ExprId, Call)> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let Parent::Expr(member) = bound.parent_of_expr(mention) else {
            return None;
        };
        let Some((object, MemberKey::Name(known::push))) = hir.member_key(member) else {
            return None;
        };
        let (pushing, call) = self.find_call_of_member(member)?;
        let is_statement = matches!(bound.parent_of_expr(pushing), Parent::Stmt(statement)
            if matches!(hir[statement].kind, StmtKind::Expr(_)));
        (object == mention && call.chain == Chain::No && is_statement).then_some((pushing, call))
    }

    fn is_initialized_with_list(&self, symbol: SymbolId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        bound.is_stable_binding(symbol)
            && matches!(bound.binding_initializer(hir, symbol), BindingInitializer::Expression(written)
                if matches!(expr_kind(hir, hir.skip_type_assertions(written)), Some(ExprKind::Array(_))))
    }

    fn add_pushed_values(
        &mut self,
        symbol: SymbolId,
        pattern: PatId,
        mut values: Values,
    ) -> Option<Values> {
        if !self.is_initialized_with_list(symbol) {
            return Some(values);
        }
        for mention in self.mentions_of(symbol) {
            let Some((pushing, call)) = self.find_push(mention) else {
                continue;
            };
            if !self.runs_once_for_each_binding(pushing, symbol, pattern) {
                return None;
            }
            let Held::List(pushed) = self.values_of_list(call.args)?.pop()? else {
                return None;
            };
            for index in 0..values.len() {
                let Held::List(places) = &values[index] else {
                    return None;
                };
                let longer = places.iter().chain(&pushed).cloned().collect();
                add(&mut values, Held::List(longer));
            }
            if values.len() > MOST_ALTERNATIVES {
                return None;
            }
        }
        Some(values)
    }

    fn is_exported(&self, symbol: SymbolId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        is_exported(hir, bound, symbol)
    }

    /// It is looked at once nothing is half followed.
    fn take_as_kept_as_written(&mut self, symbol: SymbolId) -> bool {
        if self.not_kept_as_written.contains(&symbol) {
            return false;
        }
        if self.kept_as_written.insert(symbol) {
            self.unchecked.push(symbol);
        }
        true
    }

    fn is_kept_as_written(&mut self, symbol: SymbolId) -> bool {
        let bound = self.inputs.bound;
        let mentions = self.mentions_of(symbol);
        !self.is_exported(symbol)
            && mentions.into_iter().all(|mention| {
                bound.is_store_target(mention)
                    || self.find_push(mention).is_some() && self.is_initialized_with_list(symbol)
                    || self.keeps_as_written(mention)
            })
    }

    fn holds_what_cannot_be_changed(&mut self, e: ExprId) -> bool {
        let values = self.values_of(e);
        values.is_some_and(|values| !values.iter().any(Held::can_be_changed))
    }

    /// Whether the code around `e`, which holds a list or an object of the file, neither changes it nor hands it to code that may.
    fn keeps_as_written(&mut self, e: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let e = self.outermost_cast(e);
        let above = match bound.parent_of_expr(e) {
            Parent::Expr(above) => above,
            Parent::VarInit(declaration) => {
                let pattern = hir[declaration].pat;
                return matches!(hir[pattern].kind, PatKind::Ident(_))
                    && match bound.initialized_binding(pattern) {
                        Binding::Symbol(holder) => {
                            self.take_as_kept_as_written(holder)
                                && bound.dynamic_lookup_scope(NodeData::Pat(pattern)).is_none()
                                && !bound.is_visible_to_eval(holder)
                        }
                        _ => false,
                    };
            }
            Parent::Stmt(statement) => {
                return match hir[statement].kind {
                    StmtKind::Expr(_)
                    | StmtKind::If { .. }
                    | StmtKind::While { .. }
                    | StmtKind::DoWhile { .. }
                    | StmtKind::For { .. }
                    | StmtKind::ForIn { .. }
                    | StmtKind::Switch { .. } => true,
                    StmtKind::ForOf { expr, .. } if expr == e => {
                        let elements = self.values_of_elements(e);
                        elements.is_some_and(|it| !it.iter().any(Held::can_be_changed))
                    }
                    _ => false,
                };
            }
            _ => return false,
        };
        match hir[above].kind {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e => {
                let member = self.outermost_cast(above);
                let is_deleted = matches!(bound.parent_of_expr(member), Parent::Expr(user)
                    if matches!(hir[user].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
                if is_deleted || bound.get_assignment_target(hir, member).is_some() {
                    return false;
                }
                match self.find_call_of_member(above) {
                    Some(_) => self.asks_list_without_changing_it(above),
                    None => {
                        self.holds_what_cannot_be_changed(above) || self.keeps_as_written(above)
                    }
                }
            }
            ExprKind::Index { .. } | ExprKind::Template { .. } => true,
            ExprKind::Unary {
                op: UnOp::Not | UnOp::Typeof | UnOp::Void,
                ..
            } => true,
            ExprKind::Binary { op, left, .. } => match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => self.keeps_as_written(above),
                BinOp::Comma => left == e || self.keeps_as_written(above),
                // `Symbol.hasInstance` of the right side is called with the left side.
                BinOp::Instanceof => left != e,
                _ => true,
            },
            ExprKind::Cond { test, .. } => test == e || self.keeps_as_written(above),
            ExprKind::Call(call) if self.find_listing_of_object(hir[call]).is_some() => {
                let listed = self.values_of_elements(above);
                listed.is_some_and(|it| !it.iter().any(Held::can_be_changed))
            }
            ExprKind::Call(_) | ExprKind::ImportCall { .. } => {
                call_site_kind(hir, bound, above).is_some()
                    && !matches!(hir[above].kind, ExprKind::Call(call) if hir[call].callee == e)
            }
            _ => false,
        }
    }

    /// The object of `member`, which is called, is a list, and a program cannot replace these members of a list.
    fn asks_list_without_changing_it(&mut self, member: ExprId) -> bool {
        let hir = self.inputs.hir;
        let Some((object, MemberKey::Name(name))) = hir.member_key(member) else {
            return false;
        };
        let asks = name == known::join
            || matches!(
                self.inputs.atoms.bytes(name),
                b"includes" | b"indexOf" | b"lastIndexOf"
            );
        let hands_elements_on = match self.find_call_of_member(member) {
            Some((_, call)) => self.find_walk_of_list(call).is_some(),
            None => false,
        };
        let elements = self.values_of_elements(object);
        elements.is_some_and(|elements| {
            asks || hands_elements_on && !elements.iter().any(Held::can_be_changed)
        })
    }

    fn keys_of(&mut self, key: MemberKey) -> Option<Option<Vec<Vec<u8>>>> {
        let computed = match key {
            MemberKey::Name(name) => {
                return Some(Some(vec![self.inputs.atoms.bytes(name).to_vec()]));
            }
            MemberKey::PrivateName(_) => return None,
            MemberKey::Computed(computed) => computed,
        };
        let Some(values) = self.values_of(computed) else {
            return Some(None);
        };
        let mut keys = Vec::with_capacity(values.len());
        for value in &values {
            match self.as_text(value)? {
                Text {
                    start, end: None, ..
                } => keys.push(start),
                _ => return Some(None),
            }
        }
        Some(Some(keys))
    }

    fn values_of_member(&mut self, member: ExprId, chain: Chain) -> Option<Values> {
        let (object, key) = self.inputs.hir.member_key(member)?;
        let objects = self.values_of(object)?;
        let keys = self.keys_of(key)?;
        self.read_member(&objects, keys.as_deref(), chain)
    }

    /// `keys` is `None` where the key may be any.
    fn read_member(
        &mut self,
        objects: &Values,
        keys: Option<&[Vec<u8>]>,
        chain: Chain,
    ) -> Option<Values> {
        let mut values = Values::new();
        for object in objects {
            let read = match object {
                Held::Object(literal) => self.read_property(*literal, keys)?,
                Held::List(places) => read_place(places, keys)?,
                Held::ListOf(held) => read_place(std::slice::from_ref(held), None)?,
                Held::Os => {
                    let names = keys?.iter().map(|key| self.inputs.atoms.intern(key));
                    names.map(Held::FunctionOfOs).collect()
                }
                Held::Process => self.read_member_of_process(keys?)?,
                Held::Primitive(Constant::Undefined | Constant::Null) => match chain {
                    Chain::No => Values::new(),
                    Chain::Start | Chain::Continue => vec![Held::Primitive(Constant::Undefined)],
                },
                _ => return None,
            };
            for value in read {
                add(&mut values, value);
            }
        }
        Some(values)
    }

    fn read_member_of_process(&self, keys: &[Vec<u8>]) -> Option<Values> {
        let &ScanInputs { fold, atoms, .. } = self.inputs;
        let mut values = Values::new();
        for key in keys {
            let constant = fold.constant_of_member(known::process, atoms.intern(key))?;
            add(&mut values, self.held_constant(constant));
        }
        Some(values)
    }

    /// The last value that is written under each key.
    fn properties_of(&mut self, literal: ExprId) -> Option<Vec<(Vec<u8>, ExprId)>> {
        let &ScanInputs { hir, atoms, .. } = self.inputs;
        let Some(ExprKind::Object(properties)) = expr_kind(hir, literal) else {
            return None;
        };
        let mut written: Vec<(Vec<u8>, ExprId)> = Vec::with_capacity(properties.len());
        for id in properties.iter() {
            let property = &hir[id];
            let is_value = matches!(
                property.kind,
                PropKind::Init | PropKind::Shorthand | PropKind::Method
            );
            if !is_value || is_proto_setter(property) {
                return None;
            }
            let key = match hir.runtime_property_key(id) {
                PropKey::Name(name) => atoms.bytes(name).to_vec(),
                PropKey::Computed(key) => {
                    match self.keys_of(MemberKey::Computed(key))?.as_deref() {
                        Some([key]) => key.clone(),
                        _ => return None,
                    }
                }
                PropKey::None | PropKey::Private(_) => return None,
            };
            // An operator that converts the object calls these with the object as `this`.
            if matches!(&key[..], b"toString" | b"valueOf") {
                return None;
            }
            written.retain(|earlier| earlier.0 != key);
            written.push((key, property.value));
        }
        Some(written)
    }

    fn read_property(&mut self, literal: ExprId, keys: Option<&[Vec<u8>]>) -> Option<Values> {
        let written = self.properties_of(literal)?;
        let Some(keys) = keys else {
            // What every object inherits is no text, and as a part of a text it names no file.
            let mut values = self.values_of_any(written.iter().map(|it| it.1))?;
            add(&mut values, Held::Primitive(Constant::Undefined));
            return Some(values);
        };
        let mut values = Values::new();
        for key in keys {
            match written.iter().find(|it| it.0 == *key) {
                Some(&(_, value)) => {
                    for value in self.values_of(value)? {
                        add(&mut values, value);
                    }
                }
                None if is_member_of_every_object(key) => add(&mut values, Held::Other),
                None => add(&mut values, Held::Primitive(Constant::Undefined)),
            }
        }
        Some(values)
    }

    /// The constant name of the module whose exports the call answers with.
    fn find_required_module(&self, call: ExprId) -> Option<Atom> {
        let &ScanInputs {
            hir,
            bound,
            decisions,
            ..
        } = self.inputs;
        let (ImportSiteKind::Require(_)
        | ImportSiteKind::ImportMetaRequire(_)
        | ImportSiteKind::GetBuiltinModule(_)) = call_site_kind(hir, bound, call)?
        else {
            return None;
        };
        let name = hir.ids(call_site_arguments(hir, bound, call)?).next()?;
        match decisions.constant(hir, name) {
            FoldedValue::Constant(Constant::String(name))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(name)) => Some(name),
            _ => None,
        }
    }

    fn values_of_call(&mut self, e: ExprId, call: Call) -> Option<Values> {
        let hir = self.inputs.hir;
        if call.chain != Chain::No {
            return None;
        }
        if let Some(module) = self.find_required_module(e) {
            return match is_process_module(module) {
                true => Some(vec![Held::Process]),
                false => self.is_os_module(module).then(|| vec![Held::Os]),
            };
        }
        if let Some((name, form)) = self.find_name_asked_of_resolver(e) {
            return self.values_answered_by_resolver(name, form);
        }
        if let Some((table, lists_keys)) = self.find_listing_of_object(call) {
            return self.values_of_listing(table, lists_keys);
        }
        if let Some(values) = self.values_of_walk(call) {
            return Some(values);
        }
        let callee = hir.skip_type_assertions(call.callee);
        if let Some(function) = self.find_path_joining_function(callee) {
            return self.values_of_path_below_folder(call.args, function == known::join);
        }
        if let Some((list, MemberKey::Name(known::join))) = hir.member_key(callee)
            && let Some(lists) = self.values_of(list)
            && lists.iter().all(|value| matches!(value, Held::List(_)))
        {
            return self.values_of_joined_lists(&lists, call.args);
        }
        let mut values = Values::new();
        for callee in self.values_of(callee)? {
            let returned = match callee {
                Held::Function(function) => self.values_returned_by(function)?,
                Held::FunctionOfOs(name) => self.values_returned_by_function_of_os(name)?,
                _ => return None,
            };
            for value in returned {
                add(&mut values, value);
            }
        }
        Some(values)
    }

    /// `require.resolve(name)` and `import.meta.resolve(name)`.
    fn find_name_asked_of_resolver(&self, call: ExprId) -> Option<(ExprId, ResolvedForm)> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let form = match call_site_kind(hir, bound, call)? {
            ImportSiteKind::RequireResolve(_) => ResolvedForm::Path,
            ImportSiteKind::ImportMetaResolve(_) => ResolvedForm::Url,
            _ => return None,
        };
        let arguments = call_site_arguments(hir, bound, call)?;
        (arguments.len() == 1).then(|| (hir.id_at(arguments, 0), form))
    }

    /// A resolver throws for what is no text. For what a resolver has answered for a name it answers as for the name.
    fn values_answered_by_resolver(&mut self, name: ExprId, form: ResolvedForm) -> Option<Values> {
        let mut values = Values::new();
        for name in self.values_of(name)? {
            if let Held::Text(name) | Held::Resolved(name, _) = name {
                add(&mut values, Held::Resolved(name, form));
            }
        }
        Some(values)
    }

    fn is_os_module(&self, specifier: Atom) -> bool {
        matches!(self.inputs.atoms.bytes(specifier), b"os" | b"node:os")
    }

    /// `os.platform()` answers `process.platform`, and `os.arch()` answers `process.arch`.
    fn values_returned_by_function_of_os(&self, name: Atom) -> Option<Values> {
        match self.inputs.atoms.bytes(name) {
            key @ (b"platform" | b"arch") => self.read_member_of_process(&[key.to_vec()]),
            _ => None,
        }
    }

    fn find_path_joining_function(&self, callee: ExprId) -> Option<Atom> {
        let &ScanInputs {
            hir,
            bound,
            decisions,
            ..
        } = self.inputs;
        find_path_joining_function(hir, bound, callee, &|e| match decisions.constant(hir, e) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                Some(constant)
            }
            FoldedValue::Unknown => None,
        })
    }

    /// `path.join(__dirname, "lib", name)`. Only the last text may be known in part.
    fn values_of_path_below_folder(
        &mut self,
        args: IdList<ExprId>,
        is_join: bool,
    ) -> Option<Values> {
        let mut arguments = self.inputs.hir.ids(args);
        let folder = self.values_of(arguments.next()?)?;
        let [Held::Text(folder)] = &folder[..] else {
            return None;
        };
        if !folder.starts_at_own_directory || folder.end.is_some() || folder.start != b"." {
            return None;
        }
        let mut paths: Vec<Vec<Text>> = vec![Vec::new()];
        for argument in arguments {
            let values = self.values_of(argument).unwrap_or_else(some_text);
            let mut longer = Vec::with_capacity(paths.len() * values.len());
            for (path, value) in paths
                .iter()
                .flat_map(|it| values.iter().map(move |v| (it, v)))
            {
                let Held::Text(text) = value else {
                    return None;
                };
                longer.push(path.iter().chain([text]).cloned().collect());
            }
            if longer.len() > MOST_ALTERNATIVES {
                return None;
            }
            paths = longer;
        }
        let mut values = Values::new();
        for texts in &paths {
            let (whole, last) = match texts.split_last() {
                Some((last, whole)) if last.end.is_some() => (whole, Some(last)),
                _ => (&texts[..], None),
            };
            let mut path = PathBelowFolder::default();
            for text in whole {
                if text.end.is_some() || text.starts_at_own_directory {
                    return None;
                }
                path.push(&text.start, is_join)?;
            }
            if last.is_some_and(|last| path.leaves_folder() || last.starts_at_own_directory) {
                return None;
            }
            let mut joined = folder.clone();
            joined.start.extend(path.write(is_join, last.is_some()));
            if let Some(last) = last {
                joined.push(last);
            }
            add(&mut values, Held::Text(joined));
        }
        Some(values)
    }

    fn values_of_joined_lists(&mut self, lists: &Values, args: IdList<ExprId>) -> Option<Values> {
        let separators = match self.inputs.hir.ids(args).next() {
            Some(separator) => self.values_of(separator)?,
            None => vec![Held::Text(Text::whole(b","))],
        };
        let is_text = |value: &Held| matches!(value, Held::Text(_));
        if !separators.iter().all(is_text) {
            return None;
        }
        let empty = Held::Text(Text::whole(b""));
        let mut values = Values::new();
        for list in lists {
            let Held::List(places) = list else {
                return None;
            };
            let mut parts: Vec<Values> = Vec::with_capacity(2 * places.len());
            for (index, place) in places.iter().enumerate() {
                if index > 0 {
                    parts.push(separators.clone());
                }
                let mut part = Values::new();
                for value in place {
                    match value {
                        Held::Primitive(Constant::Undefined | Constant::Null) => {
                            add(&mut part, empty.clone());
                        }
                        Held::Text(_) | Held::Primitive(_) => add(&mut part, value.clone()),
                        _ => return None,
                    }
                }
                parts.push(part);
            }
            for value in self.join_parts(&parts)? {
                add(&mut values, value);
            }
        }
        Some(values)
    }

    fn values_returned_by(&mut self, function: FnId) -> Option<Values> {
        let &ScanInputs {
            hir,
            bound,
            decisions,
            ..
        } = self.inputs;
        if hir[function]
            .flags
            .intersects(Flags::ASYNC | Flags::GENERATOR)
            || self.functions_in_progress.contains(&function)
        {
            return None;
        }
        self.functions_in_progress.push(function);
        let values = match hir[function].body {
            FnBody::Expr(value) => self.values_of(value),
            FnBody::Block(_) => {
                let info = bound.fns[function.idx()];
                let mut values = Values::new();
                if info.end != UNREACHABLE {
                    values.push(Held::Primitive(Constant::Undefined));
                }
                let mut returned = bound
                    .ids(info.returns)
                    .filter(|&it| !decisions.is_dead_stmt(it));
                returned
                    .try_for_each(|statement| {
                        let StmtKind::Return(value) = hir[statement].kind else {
                            return None;
                        };
                        let returned = match value.some() {
                            Some(value) => self.values_of(value)?,
                            None => vec![Held::Primitive(Constant::Undefined)],
                        };
                        returned.into_iter().for_each(|it| add(&mut values, it));
                        Some(())
                    })
                    .map(|()| values)
            }
            FnBody::None => None,
        };
        self.functions_in_progress.pop();
        values
    }
}

fn some_text() -> Values {
    vec![Held::Text(Text::unknown())]
}

fn is_process_module(specifier: Atom) -> bool {
    specifier == known::process || specifier == known::node_process
}

fn is_loop(statement: StmtKind) -> bool {
    matches!(
        statement,
        StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. }
    )
}

fn read_place(places: &[Vec<Held>], keys: Option<&[Vec<u8>]>) -> Option<Values> {
    let mut values = Values::new();
    let Some(keys) = keys else {
        places
            .iter()
            .flatten()
            .for_each(|it| add(&mut values, it.clone()));
        add(&mut values, Held::Primitive(Constant::Undefined));
        return Some(values);
    };
    for key in keys {
        let index = std::str::from_utf8(key).ok()?.parse::<usize>().ok()?;
        match places.get(index) {
            Some(place) => place.iter().for_each(|it| add(&mut values, it.clone())),
            None => add(&mut values, Held::Primitive(Constant::Undefined)),
        }
    }
    Some(values)
}

fn is_member_of_every_object(key: &[u8]) -> bool {
    matches!(
        key,
        b"__defineGetter__"
            | b"__defineSetter__"
            | b"__lookupGetter__"
            | b"__lookupSetter__"
            | b"__proto__"
            | b"constructor"
            | b"hasOwnProperty"
            | b"isPrototypeOf"
            | b"propertyIsEnumerable"
            | b"toLocaleString"
            | b"toString"
            | b"valueOf"
    )
}

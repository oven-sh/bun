use super::call_sites::{expr_kind, is_free_common_js, is_free_name, is_process};
use super::made_requires::{find_imported_export, may_be_modified, names_own_file, settled_symbol};
use super::parameters::{
    ExportedNames, find_parameter_key_path, find_values_passed_by_call,
    find_values_passed_for_pattern, is_exported,
};
use super::touched_exports::{is_only_tested, stands_in_function_with_arguments};
use super::{
    ImportSiteKind, ImportSpecifier, ResolvedForm, ScanInputs, call_site_arguments, call_site_kind,
    write_question_where_file_lies,
};
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingKind, BindingStability, Bound, CommonJsVariable, Decl,
    FnOwner, FunctionFlags, Parent, PatParent, StoreKind, SymbolId, UNREACHABLE,
};
use crate::fold::{
    Constant, FoldedValue, MembersBehindNames, PathBelowFolder, apply_binary, apply_template,
    find_export_of_module_with, trim_lead_surrogate_at_end, trim_to_last_segment,
    trim_trail_surrogate_at_start,
};
use crate::hir::{
    BinOp, Branches, Call, Chain, ExprId, ExprKind, File, Flags, FnBody, FnId, IdList, MemberKey,
    MemberKind, NodeData, PatElemId, PatId, PatKind, PropId, PropKey, PropKind, StmtId, StmtKind,
    TextOfOtherFile, UnOp, is_proto_setter,
};
use crate::util::{FxBuild, FxHashMap, FxHashSet, SharedSort};
use bun_core::strings;
use std::cell::{Cell, OnceCell, RefCell};
use std::hash::{BuildHasher, Hash, Hasher};
use std::ops::{Deref, Range};
use std::rc::Rc;

const EXPRESSIONS_FOLLOWED_IN_ANY_FILE: u32 = 4096;
const MOST_TEXTS_MADE: u32 = 4096;
const DEEPEST_EXPRESSION: u32 = 64;
const FEW_ENOUGH_TO_COMPARE: usize = 16;

fn most_expressions_followed(hir: &File<'_>) -> u32 {
    let twice_the_file =
        u32::try_from(hir.exprs.len()).map_or(u32::MAX, |all| all.saturating_mul(2));
    twice_the_file.max(EXPRESSIONS_FOLLOWED_IN_ANY_FILE)
}

const PATH_MODULES: [&[u8]; 4] = [b"path", b"node:path", b"path/posix", b"node:path/posix"];

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
struct Text {
    start: Vec<u8>,
    end: Option<Vec<u8>>,
    starts_at_own_directory: bool,
    is_file_url: bool,
}

impl Text {
    fn whole(text: &[u8]) -> Text {
        Text {
            start: text.to_vec(),
            end: None,
            starts_at_own_directory: false,
            is_file_url: false,
        }
    }

    fn unknown() -> Text {
        Text {
            start: Vec::new(),
            end: Some(Vec::new()),
            starts_at_own_directory: false,
            is_file_url: false,
        }
    }

    fn push(&mut self, next: &Text) {
        if self.end.is_none() && self.start.is_empty() {
            self.clone_from(next);
            return;
        }
        if self.end.is_none()
            && self.start == b"file://"
            && next.starts_at_own_directory
            && !next.is_file_url
        {
            self.clone_from(next);
            self.is_file_url = true;
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
    Resolved(Text, ResolvedForm),
    Url(Text),
    Primitive(Constant),
    List(Vec<Vec<Held>>),
    ListOf(Vec<Held>),
    SetOf(Vec<Held>),
    Object(ExprId),
    Function(FnId),
    Process,
    Os,
    FunctionOfOs(Atom),
    PlainPattern {
        letters: Vec<u8>,
        is_at_end: bool,
    },
    Data {
        specifier: Atom,
        path: Vec<u8>,
        is_namespace: bool,
    },
    Other,
    Itself(SymbolId),
    BelowItself(SymbolId),
}

impl Held {
    fn can_be_changed(&self) -> bool {
        matches!(
            self,
            Held::List(_) | Held::ListOf(_) | Held::SetOf(_) | Held::Object(_)
        )
    }
}

impl Hash for Held {
    fn hash<H: Hasher>(&self, state: &mut H) {
        std::mem::discriminant(self).hash(state);
        match self {
            Held::Text(text) | Held::Url(text) => text.hash(state),
            Held::Resolved(text, form) => (text, form).hash(state),
            Held::Primitive(constant) => {
                std::mem::discriminant(constant).hash(state);
                match *constant {
                    Constant::Undefined | Constant::Null => {}
                    Constant::Boolean(truth) => truth.hash(state),
                    Constant::Number(number) => (number + 0.0).to_bits().hash(state),
                    Constant::String(text) | Constant::BigInt(text) => text.hash(state),
                }
            }
            Held::List(places) => places.hash(state),
            Held::ListOf(held) | Held::SetOf(held) => held.hash(state),
            Held::Object(literal) => literal.hash(state),
            Held::Function(function) => function.hash(state),
            Held::FunctionOfOs(name) => name.hash(state),
            Held::PlainPattern { letters, is_at_end } => (letters, is_at_end).hash(state),
            Held::Data {
                specifier,
                path,
                is_namespace,
            } => (specifier, path, is_namespace).hash(state),
            Held::Itself(symbol) | Held::BelowItself(symbol) => symbol.hash(state),
            Held::Process | Held::Os | Held::Other => {}
        }
    }
}

type Values = Vec<Held>;

struct Distinct<T> {
    all: Vec<T>,
    places: FxHashMap<u64, usize>,
}

impl<T: Hash + PartialEq> Distinct<T> {
    fn new() -> Distinct<T> {
        Distinct::from(Vec::new())
    }

    fn add(&mut self, value: T) {
        if self.all.len() < FEW_ENOUGH_TO_COMPARE {
            if !self.all.contains(&value) {
                self.all.push(value);
            }
            return;
        }
        if self.places.is_empty() {
            for (place, earlier) in self.all.iter().enumerate() {
                self.places
                    .entry(FxBuild.hash_one(earlier))
                    .or_insert(place);
            }
        }
        let end = self.all.len();
        let place = *self.places.entry(FxBuild.hash_one(&value)).or_insert(end);
        if place == end || self.all[place] != value && !self.all.contains(&value) {
            self.all.push(value);
        }
    }
}

impl<T> From<Vec<T>> for Distinct<T> {
    fn from(all: Vec<T>) -> Distinct<T> {
        Distinct {
            all,
            places: FxHashMap::default(),
        }
    }
}

impl<T> Deref for Distinct<T> {
    type Target = Vec<T>;

    fn deref(&self) -> &Vec<T> {
        &self.all
    }
}

#[derive(Copy, Clone, PartialEq)]
enum Listing {
    Keys,
    Values,
    Entries,
}

fn count_layers_that_can_be_changed(values: &[Held]) -> u32 {
    let layers = values.iter().map(|held| match held {
        Held::List(places) => {
            let below = places.iter().map(|it| count_layers_that_can_be_changed(it));
            1 + below.max().unwrap_or(0)
        }
        Held::ListOf(held) | Held::SetOf(held) => 1 + count_layers_that_can_be_changed(held),
        Held::Object(_) => 1,
        _ => 0,
    });
    layers.max().unwrap_or(0)
}

fn add(values: &mut Distinct<Held>, value: Held) {
    values.add(value);
}

fn with(values: Values, value: Held) -> Values {
    let mut values = Distinct::from(values);
    add(&mut values, value);
    values.all
}

fn with_undefined(values: Values) -> Values {
    with(values, Held::Primitive(Constant::Undefined))
}

fn keep_last_of_each_key(written: &mut Vec<(Vec<u8>, ExprId)>) {
    let mut later = FxHashSet::default();
    let entries = written.iter().rev();
    let mut is_last: Vec<bool> = entries.map(|it| later.insert(&it.0[..])).collect();
    written.retain(|_| is_last.pop().unwrap_or(false));
}

#[derive(Default)]
pub(super) struct WrittenNames(
    OnceCell<Vec<(Atom, ExprId)>>,
    MembersBehindNames,
    OnceCell<Vec<u32>>,
    RefCell<FxHashMap<Atom, Vec<(SymbolId, ExprId)>>>,
    OnceCell<ExportedNames>,
);

impl WrittenNames {
    pub(super) fn exported_names(&self, hir: &File<'_>, bound: &Bound<'_>) -> &ExportedNames {
        self.4.get_or_init(|| ExportedNames::new(hir, bound))
    }

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

    pub(super) fn find_expressions(&self, hir: &File<'_>, name: Atom) -> Vec<ExprId> {
        self.find(hir, name).iter().map(|it| it.1).collect()
    }
}

#[derive(Default)]
pub(super) struct AskedOfDataFiles(RefCell<Vec<(Atom, Atom)>>);

impl AskedOfDataFiles {
    pub(super) fn take(&self) -> Vec<(Atom, Atom)> {
        let mut asked = self.0.take();
        asked.shared_sort_unstable_by_key(|it| (it.0.0, it.1.0));
        asked.dedup();
        asked
    }
}

#[derive(Default)]
pub(super) struct AskedOfOwnExports(RefCell<Vec<Atom>>);

impl AskedOfOwnExports {
    pub(super) fn take(&self) -> Vec<Atom> {
        let mut asked = self.0.take();
        asked.shared_sort_unstable_by_key(|it| it.0);
        asked.dedup();
        asked
    }
}

struct Follower<'i, 'a, 's> {
    inputs: &'i ScanInputs<'a, 's>,
    written_names: &'i WrittenNames,
    data_file_queries: &'i AskedOfDataFiles,
    other_file_queries: Option<&'i AskedOfDataFiles>,
    own_export_queries: Option<&'i AskedOfOwnExports>,
    takes_all_as_written: bool,
    keeps_known_alternatives: bool,
    skips_reassigned_bindings: bool,
    has_read_data_file: Cell<bool>,
    kept_as_written: FxHashSet<SymbolId>,
    unchecked: Vec<SymbolId>,
    not_kept_as_written: FxHashSet<SymbolId>,
    variables_in_progress: Vec<SymbolId>,
    functions_in_progress: Vec<FnId>,
    calls_in_progress: Vec<(FnId, IdList<ExprId>)>,
    expressions_left: Cell<u32>,
    texts_left: Cell<u32>,
    depth: u32,
    follows_key: bool,
    folder: Folder,
    open_parameters: Vec<OpenParameter>,
    stand_in: Option<SymbolId>,
    stand_in_property: Option<Atom>,
    calls_of_resolvers: RefCell<FxHashMap<Vec<u8>, CallsUnderName>>,
    objects_asked_whether_their_functions_see_them:
        FxHashMap<ExprId, Option<Rc<FxHashSet<Vec<u8>>>>>,
    asked_who_takes: FxHashMap<(ExprId, u32), bool>,
    asked_while_open: Vec<(ExprId, u32)>,
    shallowest_being_asked: FxHashMap<ExprId, u32>,
    stored_under_keys: FxHashMap<ExprId, Vec<(Vec<u8>, ExprId)>>,
    stores_known: FxHashSet<(ExprId, ExprId)>,
    functions_whose_answers_are_asked: Vec<(FnId, u32)>,
}

#[derive(Default)]
struct CallsUnderName {
    calls: FxHashSet<ExprId>,
    are_asked_for: bool,
}

const STAND_IN: &[u8] = b"\0";

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Folder {
    OfFile,
    WorkingDirectory,
    OfCaller,
}

pub(super) struct Found {
    pub(super) alternatives: Vec<ImportSpecifier>,
    pub(super) start_at_own_directory: bool,
    pub(super) resolved_form: Option<ResolvedForm>,
    pub(super) is_from_data_file: bool,
}

impl<'i, 'a, 's> Follower<'i, 'a, 's> {
    fn new(
        inputs: &'i ScanInputs<'a, 's>,
        written_names: &'i WrittenNames,
        data_file_queries: &'i AskedOfDataFiles,
        follows_key: bool,
        folder: Folder,
    ) -> Follower<'i, 'a, 's> {
        Follower {
            inputs,
            written_names,
            data_file_queries,
            other_file_queries: None,
            own_export_queries: None,
            takes_all_as_written: false,
            keeps_known_alternatives: false,
            skips_reassigned_bindings: false,
            has_read_data_file: Cell::new(false),
            kept_as_written: FxHashSet::default(),
            unchecked: Vec::new(),
            not_kept_as_written: FxHashSet::default(),
            variables_in_progress: Vec::new(),
            functions_in_progress: Vec::new(),
            calls_in_progress: Vec::new(),
            expressions_left: Cell::new(most_expressions_followed(inputs.hir)),
            texts_left: Cell::new(MOST_TEXTS_MADE),
            depth: 0,
            follows_key,
            folder,
            open_parameters: Vec::new(),
            stand_in: None,
            stand_in_property: None,
            calls_of_resolvers: RefCell::default(),
            objects_asked_whether_their_functions_see_them: FxHashMap::default(),
            asked_who_takes: FxHashMap::default(),
            asked_while_open: Vec::new(),
            shallowest_being_asked: FxHashMap::default(),
            stored_under_keys: FxHashMap::default(),
            stores_known: FxHashSet::default(),
            functions_whose_answers_are_asked: Vec::new(),
        }
    }
}

pub(super) fn find_texts_of_key(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    data_file_queries: &AskedOfDataFiles,
    key: ExprId,
) -> Option<Vec<ImportSpecifier>> {
    let mut follower = Follower::new(
        inputs,
        written_names,
        data_file_queries,
        true,
        Folder::OfFile,
    );
    let values = follower.values_of_argument(key)?;
    if follower.has_read_data_file.get() {
        return None;
    }
    let mut texts: Vec<(Vec<u8>, Option<Vec<u8>>)> = Vec::with_capacity(values.len());
    for value in values {
        let mut text = match value {
            Held::Text(text) if text.is_file_url => return None,
            Held::Text(text) | Held::Resolved(text, _) | Held::Url(text) => text,
            Held::Primitive(_) => continue,
            _ => return None,
        };
        if let Some(end) = &mut text.end {
            trim_lead_surrogate_at_end(&mut text.start);
            trim_trail_surrogate_at_start(end);
            if text.start.is_empty() && end.is_empty() {
                return None;
            }
        }
        texts.push((text.start, text.end));
    }
    texts.shared_sort_unstable();
    texts.dedup();
    let atoms = inputs.atoms;
    let texts = texts.iter().map(|(start, end)| match end {
        None => ImportSpecifier::Constant(atoms.intern(start)),
        Some(end) => ImportSpecifier::Pattern {
            prefix: atoms.intern(start),
            suffix: atoms.intern(end),
        },
    });
    Some(texts.collect())
}

pub(super) fn find_alternatives(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    data_file_queries: &AskedOfDataFiles,
    argument: ExprId,
    folder: Folder,
    other_file_queries: Option<&AskedOfDataFiles>,
    own_export_queries: Option<&AskedOfOwnExports>,
) -> Option<Found> {
    let mut follower = Follower::new(inputs, written_names, data_file_queries, false, folder);
    follower.other_file_queries = other_file_queries;
    follower.own_export_queries = own_export_queries;
    find_alternatives_with(&mut follower, argument)
}

#[derive(Clone, Copy)]
pub(super) struct OpenParameter {
    pub(super) mention: ExprId,
    pub(super) destructured_key: Option<Atom>,
}

pub(super) fn find_known_alternatives(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    data_file_queries: &AskedOfDataFiles,
    argument: ExprId,
) -> (Option<Found>, Option<OpenParameter>) {
    let folder = Folder::OfFile;
    let mut follower = Follower::new(inputs, written_names, data_file_queries, false, folder);
    follower.keeps_known_alternatives = true;
    let found = find_alternatives_with(&mut follower, argument);
    (found, follower.open_parameters.first().copied())
}

pub(super) fn find_known_load_names(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    data_file_queries: &AskedOfDataFiles,
    argument: ExprId,
) -> Option<Found> {
    let folder = Folder::OfFile;
    let mut follower = Follower::new(inputs, written_names, data_file_queries, false, folder);
    follower.keeps_known_alternatives = true;
    follower.skips_reassigned_bindings = true;
    find_alternatives_with(&mut follower, argument)
}

pub(super) fn find_caller_relative_alternatives(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    data_file_queries: &AskedOfDataFiles,
    argument: ExprId,
    mention: ExprId,
    property: Option<Atom>,
) -> Option<Found> {
    let Binding::Symbol(parameter) = inputs.bound.binding(mention) else {
        return None;
    };
    let folder = Folder::OfCaller;
    let mut follower = Follower::new(inputs, written_names, data_file_queries, false, folder);
    follower.stand_in = Some(parameter);
    follower.stand_in_property = property;
    follower.keeps_known_alternatives = true;
    find_alternatives_with(&mut follower, argument)
}

pub(super) fn find_elements_of_list_that_nothing_changes(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    list: ExprId,
) -> Option<IdList<ExprId>> {
    let &ScanInputs { hir, bound, .. } = inputs;
    let list = hir.skip_type_assertions(list);
    if let ExprKind::Array(elements) = hir[list].kind {
        return Some(elements);
    }
    let holder = settled_symbol(hir, bound, list)?;
    let BindingInitializer::Expression(written) = bound.binding_initializer(hir, holder) else {
        return None;
    };
    let ExprKind::Array(elements) = hir[hir.skip_type_assertions(written)].kind else {
        return None;
    };
    let asked = AskedOfDataFiles::default();
    let mut follower = Follower::new(inputs, written_names, &asked, false, Folder::OfFile);
    let held = follower.values_of_argument(list)?;
    matches!(&held[..], [Held::List(places)] if places.len() == elements.len()).then_some(elements)
}

pub(super) fn find_names_as_written(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    argument: ExprId,
) -> Vec<Atom> {
    let asked = AskedOfDataFiles::default();
    let mut follower = Follower::new(inputs, written_names, &asked, false, Folder::OfFile);
    follower.takes_all_as_written = true;
    let found = find_alternatives_with(&mut follower, argument);
    let written = found.iter().flat_map(|it| it.alternatives.iter());
    written
        .filter_map(|it| match *it {
            ImportSpecifier::Constant(name) => Some(name),
            _ => None,
        })
        .collect()
}

pub(super) struct PathAroundParameter {
    pub(super) mention: ExprId,
    pub(super) start: Vec<u8>,
    pub(super) end: Vec<u8>,
    pub(super) starts_at_own_directory: bool,
}

pub(super) fn find_path_around_parameter(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    path: ExprId,
) -> Option<PathAroundParameter> {
    let asked = AskedOfDataFiles::default();
    let mut follower = Follower::new(inputs, written_names, &asked, false, Folder::OfFile);
    follower.values_of_argument(path);
    let mention = follower.open_parameters.first()?.mention;
    let Binding::Symbol(parameter) = inputs.bound.binding(mention) else {
        return None;
    };
    let mut follower = Follower::new(inputs, written_names, &asked, false, Folder::OfFile);
    follower.stand_in = Some(parameter);
    let found = find_alternatives_with(&mut follower, path)?;
    let (&[ImportSpecifier::Constant(text)], None, false) = (
        &found.alternatives[..],
        found.resolved_form,
        found.is_from_data_file,
    ) else {
        return None;
    };
    let text = inputs.atoms.bytes(text);
    let at = strings::index_of_char_usize(text, STAND_IN[0])?;
    let (start, end) = (&text[..at], &text[at + 1..]);
    if strings::contains_char(end, STAND_IN[0]) {
        return None;
    }
    Some(PathAroundParameter {
        mention,
        start: start.to_vec(),
        end: end.to_vec(),
        starts_at_own_directory: found.start_at_own_directory,
    })
}

fn find_alternatives_with(follower: &mut Follower<'_, '_, '_>, argument: ExprId) -> Option<Found> {
    let inputs = follower.inputs;
    let values = follower.values_of_argument(argument)?;
    let mut texts: Vec<Text> = Vec::with_capacity(values.len());
    let mut forms: Vec<Option<ResolvedForm>> = Vec::with_capacity(values.len());
    for value in values {
        let (text, form) = match value {
            Held::Text(text) if text.is_file_url => {
                let is_plain = |part: &[u8]| !part.iter().any(|byte| b"%?#".contains(byte));
                if !is_plain(&text.start) || !text.end.as_deref().is_none_or(is_plain) {
                    return None;
                }
                (text, Some(ResolvedForm::Url))
            }
            Held::Text(text) => (text, None),
            Held::Resolved(text, form) => (text, Some(form)),
            Held::Url(text) => (text, Some(ResolvedForm::UrlObject)),
            Held::Primitive(_) | Held::Function(_) | Held::Other => continue,
            _ => return None,
        };
        texts.push(text);
        forms.push(form);
    }
    let resolved_form = *forms.first()?;
    if forms.iter().any(|&form| form != resolved_form) {
        return None;
    }
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
        let is_asked_of_resolver = resolved_form.is_some() && !inputs.hir.runs_beside_loader;
        if is_asked_of_resolver && text.start.starts_with(b"./../") {
            text.start.drain(..2);
        }
        if let Some(end) = &mut text.end {
            trim_lead_surrogate_at_end(&mut text.start);
            trim_trail_surrogate_at_start(end);
            if text.start.is_empty() {
                return None;
            }
        }
        if follower.folder == Folder::OfCaller && text.start.contains(&STAND_IN[0]) {
            continue;
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
        is_from_data_file: follower.has_read_data_file.get(),
    })
}

impl Follower<'_, '_, '_> {
    fn values_of_argument(&mut self, argument: ExprId) -> Option<Values> {
        loop {
            let values = self.values_of(argument)?;
            let known_before = (self.not_kept_as_written.len(), self.stores_known.len());
            while let Some(symbol) = self.unchecked.pop() {
                if !self.is_kept_as_written(symbol) {
                    self.not_kept_as_written.insert(symbol);
                }
            }
            if (self.not_kept_as_written.len(), self.stores_known.len()) == known_before {
                return Some(values);
            }
            self.kept_as_written.clear();
            self.asked_who_takes.clear();
            self.objects_asked_whether_their_functions_see_them.clear();
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
            Held::Itself(_) | Held::BelowItself(_) | Held::Data { .. } => None,
            Held::Url(name) => Some(href_of(name)),
            Held::Resolved(name, form) if name.end.is_none() && name.start.ends_with(b"/") => {
                let start = match name.start.starts_with(b"./") {
                    true => name.start.clone(),
                    false if name.start.starts_with(b"../") => [b"./", &name.start[..]].concat(),
                    false => return Some(Text::unknown()),
                };
                Some(Text {
                    start,
                    end: None,
                    starts_at_own_directory: true,
                    is_file_url: *form != ResolvedForm::Path,
                })
            }
            _ => {
                self.ask_where_file_lies(value);
                Some(Text::unknown())
            }
        }
    }

    fn ask_where_file_lies(&self, answer: &Held) {
        if let Held::Resolved(name, ResolvedForm::Path | ResolvedForm::Url) = answer
            && name.end.is_none()
            && !self.inputs.hir.runs_beside_loader
        {
            let mut calls = self.calls_of_resolvers.borrow_mut();
            let Some(known) = calls.get_mut(&name.start) else {
                return;
            };
            if !std::mem::replace(&mut known.are_asked_for, true) {
                for &call in &known.calls {
                    self.ask_where_file_of_call_lies(&name.start, call);
                }
            }
        }
    }

    fn ask_where_file_of_call_lies(&self, name: &[u8], call: ExprId) {
        let atoms = self.inputs.atoms;
        let question = atoms.intern(&write_question_where_file_lies(call));
        let asked = (atoms.intern(name), question);
        self.data_file_queries.0.borrow_mut().push(asked);
    }

    fn note_call_of_resolver(&self, name: &[u8], call: ExprId) {
        let mut calls = self.calls_of_resolvers.borrow_mut();
        if !calls.contains_key(name) {
            calls.insert(name.to_vec(), CallsUnderName::default());
        }
        let Some(known) = calls.get_mut(name) else {
            return;
        };
        if known.calls.insert(call) && known.are_asked_for {
            self.ask_where_file_of_call_lies(name, call);
        }
    }

    fn find_where_file_lies(&self, call: ExprId, name: &Text, form: ResolvedForm) -> Option<Held> {
        let &ScanInputs { hir, atoms, .. } = self.inputs;
        if name.end.is_some() {
            return None;
        }
        let question = atoms.intern(&write_question_where_file_lies(call));
        let asked = (atoms.intern(&name.start), question);
        let answers = &hir.texts_of_data_files;
        let key = (asked.0.0, asked.1.0);
        let at = answers.binary_search_by_key(&key, |it| (it.specifier.0, it.path.0));
        let known = answers[at.ok()?];
        self.data_file_queries.0.borrow_mut().push(asked);
        Some(Held::Text(Text {
            starts_at_own_directory: true,
            is_file_url: form == ResolvedForm::Url,
            ..Text::whole(atoms.bytes(known.text))
        }))
    }

    fn values_apart_from_itself(&mut self, e: ExprId) -> Option<Values> {
        let is_itself = |value: &Held| matches!(value, Held::Itself(_) | Held::BelowItself(_));
        self.values_of(e)
            .filter(|values| !values.iter().any(is_itself))
    }

    fn is_dead(&self, e: ExprId) -> bool {
        self.inputs.decisions.is_dead_expr(e)
    }

    fn pay_for(&self, made: usize) -> Option<()> {
        let made = u32::try_from(made).ok()?;
        self.texts_left
            .set(self.texts_left.get().checked_sub(made)?);
        Some(())
    }

    fn pay_for_pairs(&self, left: usize, right: usize) -> Option<()> {
        self.pay_for(left.checked_mul(right)? - left.max(right).min(left * right))
    }

    fn values_of(&mut self, e: ExprId) -> Option<Values> {
        self.expressions_left
            .set(self.expressions_left.get().checked_sub(1)?);
        if self.depth == DEEPEST_EXPRESSION {
            return None;
        }
        self.depth += 1;
        let values = self.values_of_written(e);
        self.depth -= 1;
        values
    }

    fn values_of_written(&mut self, e: ExprId) -> Option<Values> {
        let &ScanInputs {
            hir,
            bound,
            decisions,
            atoms,
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
        if let Some(own_file) = self.find_own_file(e) {
            return Some(vec![Held::Text(own_file)]);
        }
        if is_process(hir, bound, e, &[known::globalThis, known::global]) {
            return Some(vec![Held::Process]);
        }
        let may_be_export = matches!(
            expr_kind(hir, e),
            Some(
                ExprKind::Ident(_)
                    | ExprKind::Dot {
                        chain: Chain::No,
                        ..
                    }
            )
        );
        if may_be_export
            && (self.find_export_of_path(e)).is_some_and(|name| atoms.bytes(name) == b"sep")
        {
            return Some(vec![Held::Text(Text::whole(b"/"))]);
        }
        if self.follows_key && is_free_name(hir, bound, e, &[known::undefined]) {
            return Some(vec![Held::Primitive(Constant::Undefined)]);
        }
        let is_born_here = matches!(
            expr_kind(hir, e)?,
            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::Array(_) | ExprKind::Object(_)
        );
        let values = match self.can_see_calls_in_progress(e) {
            true => self.values_of_kind(e),
            false => {
                let calls = std::mem::take(&mut self.calls_in_progress);
                let values = self.values_of_kind(e);
                self.calls_in_progress = calls;
                values
            }
        }?;
        let layers = match is_born_here {
            true => count_layers_that_can_be_changed(&values),
            false => 0,
        };
        let is_as_written =
            self.takes_all_as_written || (0..layers).all(|below| self.asks_who_takes(e, below));
        is_as_written.then_some(values)
    }

    fn can_see_calls_in_progress(&self, e: ExprId) -> bool {
        match expr_kind(self.inputs.hir, e) {
            Some(
                ExprKind::Template { .. }
                | ExprKind::Binary { .. }
                | ExprKind::Cond { .. }
                | ExprKind::Call(_),
            ) => true,
            Some(ExprKind::Ident(_)) => self.find_arguments_in_progress(e).is_some(),
            _ => false,
        }
    }

    fn find_arguments_in_progress(&self, name: ExprId) -> Option<IdList<ExprId>> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let &(called, arguments) = self.calls_in_progress.last()?;
        let Binding::Symbol(parameter) = bound.binding(name) else {
            return None;
        };
        let (function, ..) = find_parameter_key_path(hir, bound, name)?;
        (function == called && bound.is_stable_binding(parameter)).then_some(arguments)
    }

    fn values_of_kind(&mut self, e: ExprId) -> Option<Values> {
        let &ScanInputs { hir, atoms, .. } = self.inputs;
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
            ExprKind::New(call) => match self.is_construction_of_set(hir[call]) {
                true => self.values_of_new_set(hir[call]),
                false => self.values_of_new_url(hir[call]),
            },
            ExprKind::Array(items) => self.values_of_list(items),
            ExprKind::Object(_) => Some(vec![Held::Object(e)]),
            ExprKind::Fn(function) => Some(vec![Held::Function(function)]),
            ExprKind::Regex { pattern, flags } if atoms.bytes(flags).is_empty() => {
                Some(vec![find_plain_pattern(atoms.bytes(pattern))?])
            }
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => {
                let negate = |value: Held| match value {
                    Held::Primitive(Constant::Number(number)) => {
                        Some(Held::Primitive(Constant::Number(-number)))
                    }
                    _ => None,
                };
                self.values_of(operand)?.into_iter().map(negate).collect()
            }
            _ => None,
        }
    }

    fn values_of_alternative(&mut self, e: ExprId) -> Option<Values> {
        let values = self.values_of(e);
        match self.keeps_known_alternatives {
            true => Some(values.unwrap_or_default()),
            false => values,
        }
    }

    fn values_of_any(&mut self, written: impl IntoIterator<Item = ExprId>) -> Option<Values> {
        let mut values = Distinct::new();
        for e in written {
            if self.is_dead(e) {
                continue;
            }
            for value in self.values_of_alternative(e)? {
                add(&mut values, value);
            }
        }
        Some(values.all)
    }

    fn names_working_directory(&self, e: ExprId) -> bool {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        let Some(ExprKind::Call(call)) = expr_kind(hir, e) else {
            return false;
        };
        let call = hir[call];
        if call.chain != Chain::No || call.args.len() != 0 {
            return false;
        }
        let callee = hir.skip_type_assertions(call.callee);
        let is_cwd = |name: Atom| atoms.bytes(name) == b"cwd";
        if (self.find_export_of(callee, &[b"process", b"node:process"])).is_some_and(is_cwd) {
            return true;
        }
        matches!(hir.member_key(callee), Some((object, MemberKey::Name(name)))
            if is_cwd(name) && is_process(hir, bound, object, &[known::globalThis, known::global]))
    }

    fn names_own_directory(&self, e: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        match self.folder {
            Folder::OfFile => {}
            Folder::WorkingDirectory => return self.names_working_directory(e),
            Folder::OfCaller => return false,
        }
        if is_free_common_js(hir, bound, e, CommonJsVariable::Dirname) {
            return !may_be_modified(hir, bound, CommonJsVariable::Dirname);
        }
        if let Some(ExprKind::Call(call)) = expr_kind(hir, e) {
            let call = hir[call];
            return call.args.len() == 1
                && self.find_export_of(call.callee, &[b"path", b"node:path"])
                    == Some(known::meta_dirname)
                && names_own_file(hir, bound, hir.id_at(call.args, 0));
        }
        matches!(expr_kind(hir, e), Some(ExprKind::Dot { obj, name, chain: Chain::No, .. })
            if (name == known::meta_dir || name == known::meta_dirname)
                && matches!(expr_kind(hir, hir.skip_type_assertions(obj)), Some(ExprKind::ImportMeta)))
            && !bound.import_meta_may_be_modified()
    }

    fn find_own_file(&self, e: ExprId) -> Option<Text> {
        let &ScanInputs {
            hir, bound, file, ..
        } = self.inputs;
        let is_kept =
            |byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_');
        if file.own_name.is_empty()
            || !file.own_name.iter().all(is_kept)
            || self.folder != Folder::OfFile
        {
            return None;
        }
        let is_file_url = if is_free_common_js(hir, bound, e, CommonJsVariable::Filename) {
            if may_be_modified(hir, bound, CommonJsVariable::Filename) {
                return None;
            }
            false
        } else {
            let Some(ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            }) = expr_kind(hir, e)
            else {
                return None;
            };
            let is_of_import_meta = matches!(
                expr_kind(hir, hir.skip_type_assertions(obj)),
                Some(ExprKind::ImportMeta)
            );
            let is_own_file =
                name == known::url || name == known::meta_filename || name == known::path;
            if !is_of_import_meta || !is_own_file || bound.import_meta_may_be_modified() {
                return None;
            }
            name == known::url
        };
        Some(Text {
            starts_at_own_directory: true,
            is_file_url,
            ..Text::whole(&[b"./", file.own_name].concat())
        })
    }

    fn join_parts(&self, parts: &[Values]) -> Option<Values> {
        let max_bytes = self.inputs.fold.max_string_bytes();
        let is_empty = |part: &&Values| matches!(&part[..], [Held::Text(text)] if text.len() == 0 && text.end.is_none());
        let mut written = parts.iter().filter(|part| !is_empty(part));
        if let (Some(only), None) = (written.next(), written.next())
            && let Some(texts) = texts_of_answers(only)
        {
            return Some(texts);
        }
        let mut joined = vec![Text::whole(b"")];
        for (index, part) in parts.iter().enumerate() {
            self.pay_for_pairs(joined.len(), part.len())?;
            let mut longer = Distinct::from(Vec::with_capacity(joined.len() * part.len()));
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
                longer.add(text);
            }
            joined = longer.all;
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
            parts.push(
                self.values_apart_from_itself(substitution)
                    .unwrap_or_else(some_text),
            );
            parts.push(written(text));
        }
        self.join_parts(&parts)
    }

    fn values_of_binary(&mut self, op: BinOp, left: ExprId, right: ExprId) -> Option<Values> {
        match op {
            BinOp::Add => {
                let is_text = |values: &Values| {
                    let mut values = values.iter();
                    values.all(|it| matches!(it, Held::Text(_) | Held::Url(_)))
                };
                let operands = [left, right].map(|it| self.values_apart_from_itself(it));
                match operands.into() {
                    (Some(left), Some(right)) => self.add_values(&left, &right),
                    (Some(left), None) if is_text(&left) => self.add_values(&left, &some_text()),
                    (None, Some(right)) if is_text(&right) => self.add_values(&some_text(), &right),
                    _ => None,
                }
            }
            BinOp::Comma => self.values_of(right),
            BinOp::Or | BinOp::And | BinOp::Nullish => {
                let mut values = self.values_of_alternative(left)?;
                values.retain(|value| self.may_be_result_of_left(op, value));
                let mut values = Distinct::from(values);
                if !self.is_dead(right) {
                    for value in self.values_of_alternative(right)? {
                        add(&mut values, value);
                    }
                }
                Some(values.all)
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
            Held::Itself(_) | Held::BelowItself(_) => (true, true, true),
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
        let mut sums = Distinct::new();
        self.pay_for_pairs(left.len(), right.len())?;
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
        Some(sums.all)
    }

    fn values_of_list(&mut self, items: IdList<ExprId>) -> Option<Values> {
        let hir = self.inputs.hir;
        let mut places = Vec::with_capacity(items.len());
        let mut holds_spread = false;
        for item in hir.ids(items) {
            places.push(match expr_kind(hir, item)? {
                ExprKind::Missing => vec![Held::Primitive(Constant::Undefined)],
                ExprKind::Spread(spread) => {
                    holds_spread = true;
                    self.values_of_elements(spread)?
                }
                _ => self
                    .values_apart_from_itself(item)
                    .unwrap_or_else(some_text),
            });
        }
        if !holds_spread {
            return Some(vec![Held::List(places)]);
        }
        let mut held = Distinct::new();
        for value in places.into_iter().flatten() {
            add(&mut held, value);
        }
        Some(vec![Held::ListOf(held.all)])
    }

    fn is_construction_of_set(&self, call: Call) -> bool {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        let callee = hir.skip_type_assertions(call.callee);
        is_free_name(hir, bound, callee, &[atoms.intern(b"Set")])
    }

    fn values_of_new_set(&mut self, call: Call) -> Option<Values> {
        let mut arguments = self.inputs.hir.ids(call.args);
        let held = match (arguments.next(), arguments.next()) {
            (None, _) => Values::new(),
            (Some(list), None) => self.values_of_elements(list)?,
            _ => return None,
        };
        Some(vec![Held::SetOf(held)])
    }

    fn mentions_of(&self, symbol: SymbolId) -> Vec<ExprId> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let name = bound.symbol(symbol).name;
        let mut mentions_by_name = self.written_names.3.borrow_mut();
        let mentions = mentions_by_name.entry(name).or_insert_with(|| {
            let written = self.written_names.find(hir, name).iter().map(|it| it.1);
            let mut mentions: Vec<(SymbolId, ExprId)> = written
                .filter_map(|e| match bound.binding(e) {
                    Binding::Symbol(mentioned)
                        if bound.is_evaluated_ident(e) && !self.is_dead(e) =>
                    {
                        Some((mentioned, e))
                    }
                    _ => None,
                })
                .collect();
            mentions.sort_unstable();
            mentions
        });
        let first = mentions.partition_point(|it| it.0 < symbol);
        let of_symbol = mentions[first..].iter().take_while(|it| it.0 == symbol);
        of_symbol.map(|it| it.1).collect()
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
        {
            return None;
        }
        if self.stand_in == Some(symbol) {
            let text = match self.folder {
                Folder::OfFile | Folder::WorkingDirectory => Text::whole(STAND_IN),
                Folder::OfCaller if self.stand_in_property.is_some() => return None,
                Folder::OfCaller => caller_url_placeholder(),
            };
            return Some(vec![Held::Text(text)]);
        }
        if self.variables_in_progress.contains(&symbol) {
            return Some(vec![Held::Itself(symbol)]);
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
                let decisions = self.inputs.decisions;
                let arguments = self.find_arguments_in_progress(name);
                let passed = arguments
                    .and_then(|arguments| find_values_passed_by_call(hir, bound, name, arguments));
                let kept = match passed {
                    Some(_) => self.calls_in_progress.len() - 1,
                    None => 0,
                };
                let calls = self.calls_in_progress.split_off(kept);
                let passed = passed.or_else(|| {
                    find_values_passed_for_pattern(
                        hir,
                        bound,
                        decisions,
                        name,
                        &find_written,
                        false,
                    )
                });
                let values = match passed {
                    Some((passed, path, is_left_out)) => {
                        self.values_of_any(passed).and_then(|mut values| {
                            if is_left_out {
                                values = with_undefined(values);
                            }
                            for &key in &path {
                                let key = self.inputs.atoms.bytes(key).to_vec();
                                values = self.read_member(&values, Some(&[key]), Chain::No)?;
                            }
                            Some(values)
                        })
                    }
                    None => {
                        let handed = self.values_handed_by_walk(symbol);
                        if handed.is_none() {
                            self.open_parameters.push(OpenParameter {
                                mention: name,
                                destructured_key: None,
                            });
                        }
                        handed
                    }
                };
                self.calls_in_progress.extend(calls);
                values
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
                Some((specifier, export)) => {
                    let namespace = (specifier, &[][..], true);
                    Some(vec![match export {
                        Some(export) => {
                            self.read_data_file(namespace, self.inputs.atoms.bytes(export))
                        }
                        None => Held::Data {
                            specifier,
                            path: Vec::new(),
                            is_namespace: true,
                        },
                    }])
                }
                _ => None,
            },
            _ => None,
        };
        self.variables_in_progress.pop();
        let values = close_over_itself(symbol, values?)?;
        let is_as_written = self.takes_all_as_written
            || !values.iter().any(Held::can_be_changed)
            || self.take_as_kept_as_written(symbol);
        is_as_written.then_some(values)
    }

    fn values_of_variable(&mut self, symbol: SymbolId) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let is_followed = match bound.binding_stability(symbol) {
            BindingStability::Stable => true,
            BindingStability::Stored | BindingStability::NotInitializedOnce => {
                !self.skips_reassigned_bindings
            }
            _ => false,
        };
        let (pattern, declared_again) = match *bound.symbol(symbol).decls {
            [Decl::Var(pattern) | Decl::Require(pattern)] => (pattern, &[][..]),
            [Decl::Var(pattern), ref again @ ..] => (pattern, again),
            _ => return None,
        };
        let mut redeclared = bound.runtime.redeclared_commonjs_variables().iter();
        let is_filled_by_more_than_is_written = redeclared.any(|it| it.0 == symbol)
            || bound.is_appended_symbol(symbol)
            || bound.runtime.is_stored_by_function_of_block(symbol);
        if !is_followed || is_filled_by_more_than_is_written {
            return None;
        }
        let mut values = Distinct::from(self.values_of_declaration(symbol, pattern)?);
        for declaration in declared_again {
            let &Decl::Var(pattern) = declaration else {
                return None;
            };
            for value in self.values_of_declaration(symbol, pattern)? {
                add(&mut values, value);
            }
        }
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
                    for value in self.values_of_alternative(value)? {
                        add(&mut values, value);
                    }
                }
                StoreKind::CompoundAssign(BinOp::Add) => appended.push((assignment, value)),
                _ => return None,
            }
        }
        if !declared_again.is_empty() && !appended.is_empty() {
            return None;
        }
        appended.shared_sort_unstable_by_key(|it| hir[it.0].pos);
        for (assignment, value) in appended {
            if !self.runs_once_for_each_binding(assignment, symbol, pattern) {
                let mut open_at_end = Distinct::new();
                for held in values.all {
                    let Held::Text(mut text) = held else {
                        return None;
                    };
                    text.push(&Text::unknown());
                    add(&mut open_at_end, Held::Text(text));
                }
                values = open_at_end;
                continue;
            }
            let value = self.values_of(value)?;
            let before = values.len();
            for sum in self.add_values(&values, &value)? {
                add(&mut values, sum);
            }
            self.pay_for(values.len() - before)?;
        }
        let values = self.add_pushed_values(symbol, pattern, values.all)?;
        self.add_values_added_to_set(symbol, values)
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
                    StmtKind::ForIn { left, .. }
                        if left == statement && hir[declaration].init.is_some() =>
                    {
                        return None;
                    }
                    StmtKind::ForIn { left, expr, .. } if left == statement => {
                        return match self.values_of_listing(expr, Listing::Keys)?.pop() {
                            Some(Held::ListOf(keys)) => Some(keys),
                            _ => None,
                        };
                    }
                    StmtKind::ForOf { left, .. } if left == statement => return None,
                    _ => {}
                }
            }
            return match hir[declaration].init.some() {
                Some(initializer) => self.values_of(initializer),
                None => Some(vec![Held::Primitive(Constant::Undefined)]),
            };
        }
        if let PatParent::Elem(whole, element) = bound.pat_parent[pattern.idx()] {
            let (PatParent::Var(_) | PatParent::Elem(..)) = bound.pat_parent[whole.idx()] else {
                return None;
            };
            let lists = self.values_of_declaration(symbol, whole)?;
            return self.values_at_place_of(whole, element, lists);
        }
        let BindingInitializer::PatternProperty { source, path } =
            bound.binding_initializer(hir, symbol)
        else {
            return None;
        };
        if let (Some(parameter), &[name]) = (self.stand_in, &path[..])
            && self.stand_in_property == Some(name)
            && bound.binding(source) == Binding::Symbol(parameter)
            && bound.stores_to(symbol).is_empty()
        {
            return Some(vec![Held::Text(caller_url_placeholder())]);
        }
        let opened = self.open_parameters.len();
        let values = self.values_of(source);
        if let (&[name], Some(open)) = (&path[..], self.open_parameters.get_mut(opened))
            && open.mention == source
        {
            open.destructured_key = Some(name);
        }
        let mut values = values?;
        for &name in &path {
            let key = self.inputs.atoms.bytes(name).to_vec();
            values = self.read_member(&values, Some(&[key]), Chain::No)?;
        }
        Some(values)
    }

    fn values_at_place_of(
        &self,
        whole: PatId,
        element: PatElemId,
        lists: Values,
    ) -> Option<Values> {
        let hir = self.inputs.hir;
        let PatKind::Array(elements) = hir[whole].kind else {
            return None;
        };
        let position = elements.iter().position(|it| it == element)?;
        if hir[element].default.is_some() {
            return None;
        }
        let mut values = Distinct::new();
        for list in lists {
            let Held::List(mut places) = list else {
                return None;
            };
            if hir[element].is_rest {
                let rest = places.split_off(position.min(places.len()));
                add(&mut values, Held::List(rest));
                continue;
            }
            match places.into_iter().nth(position) {
                Some(place) => place.into_iter().for_each(|it| add(&mut values, it)),
                None => add(&mut values, Held::Primitive(Constant::Undefined)),
            }
        }
        Some(values.all)
    }

    fn values_of_elements(&mut self, list: ExprId) -> Option<Values> {
        let mut elements = Distinct::new();
        for value in self.values_of(list)? {
            let held = match value {
                Held::List(places) => places.into_iter().flatten().collect(),
                Held::ListOf(held) | Held::SetOf(held) => held,
                Held::Primitive(Constant::Undefined | Constant::Null) => continue,
                _ => return None,
            };
            for value in held {
                add(&mut elements, value);
            }
        }
        Some(elements.all)
    }

    fn values_handed_by_walk(&mut self, parameter: SymbolId) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let &[Decl::Param(pattern)] = bound.symbol(parameter).decls else {
            return None;
        };
        let (id, taken_out_of) = match bound.pat_parent[pattern.idx()] {
            PatParent::Param(id) => (id, None),
            PatParent::Elem(whole, element) => match bound.pat_parent[whole.idx()] {
                PatParent::Param(id) => (id, Some((whole, element))),
                _ => return None,
            },
            _ => return None,
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
        match (position, taken_out_of) {
            (0, None) => self.values_of_elements(list),
            (0, Some((whole, element))) => {
                let elements = self.values_of_elements(list)?;
                self.values_at_place_of(whole, element, elements)
            }
            (2, None) => self.values_of(list),
            _ => None,
        }
    }

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
            b"find" | b"findLast" => Some(with_undefined(self.values_of_elements(list)?)),
            b"map" => {
                let mut made = Distinct::new();
                for maker in self.values_of(self.inputs.hir.ids(call.args).next()?)? {
                    let Held::Function(maker) = maker else {
                        return None;
                    };
                    for value in self.values_returned_by(maker, None)? {
                        add(&mut made, value);
                    }
                }
                Some(vec![Held::ListOf(made.all)])
            }
            _ => None,
        }
    }

    fn find_listing_of_object(&self, call: Call) -> Option<(ExprId, Listing)> {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        let (holder, MemberKey::Name(name)) =
            hir.member_key(hir.skip_type_assertions(call.callee))?
        else {
            return None;
        };
        let (lister, listing) = match atoms.bytes(name) {
            b"keys" | b"getOwnPropertyNames" => (known::Object, Listing::Keys),
            b"ownKeys" => (atoms.intern(b"Reflect"), Listing::Keys),
            b"values" => (known::Object, Listing::Values),
            b"entries" => (known::Object, Listing::Entries),
            _ => return None,
        };
        let holder = hir.skip_type_assertions(holder);
        let mut arguments = hir.ids(call.args);
        let table = arguments.next().filter(|_| arguments.next().is_none())?;
        (call.chain != Chain::Start && is_free_name(hir, bound, holder, &[lister]))
            .then_some((table, listing))
    }

    fn values_of_listing(&mut self, table: ExprId, listing: Listing) -> Option<Values> {
        let mut listed = Distinct::new();
        for table in self.values_of(table)? {
            let literal = match table {
                Held::Object(literal) => literal,
                Held::Primitive(Constant::Undefined | Constant::Null) => continue,
                _ => return None,
            };
            for (key, value) in self.properties_of(literal)? {
                let held = match listing {
                    Listing::Keys => vec![Held::Text(Text::whole(&key))],
                    Listing::Values => self.values_of(value)?,
                    Listing::Entries => {
                        let key = vec![Held::Text(Text::whole(&key))];
                        vec![Held::List(vec![key, self.values_of(value)?])]
                    }
                };
                held.into_iter().for_each(|it| add(&mut listed, it));
            }
        }
        Some(vec![Held::ListOf(listed.all)])
    }

    fn runs_once_for_each_binding(&self, code: ExprId, symbol: SymbolId, pattern: PatId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
            return false;
        };
        let holder = match bound.binding_kind(symbol) {
            BindingKind::Var => None,
            _ => Some(bound.parent_of_stmt(bound.var_stmt[declaration.idx()])),
        };
        if matches!(holder, Some(Parent::Stmt(head)) if matches!(hir[head].kind, StmtKind::For { .. }))
        {
            return false;
        }
        let Some(mut statement) = bound.statement_of_expr(code) else {
            return false;
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

    fn find_add(&self, mention: ExprId) -> Option<Call> {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        let Parent::Expr(member) = bound.parent_of_expr(mention) else {
            return None;
        };
        let (object, MemberKey::Name(name)) = hir.member_key(member)? else {
            return None;
        };
        let (adding, call) = self.find_call_of_member(member)?;
        let is_statement = matches!(bound.parent_of_expr(adding), Parent::Stmt(statement)
            if matches!(hir[statement].kind, StmtKind::Expr(_)));
        (object == mention
            && atoms.bytes(name) == b"add"
            && call.chain == Chain::No
            && is_statement)
            .then_some(call)
    }

    fn is_initialized_with_set(&self, symbol: SymbolId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        bound.is_stable_binding(symbol)
            && matches!(bound.binding_initializer(hir, symbol), BindingInitializer::Expression(written)
                if matches!(expr_kind(hir, hir.skip_type_assertions(written)), Some(ExprKind::New(call))
                    if self.is_construction_of_set(hir[call])))
    }

    fn add_values_added_to_set(&mut self, symbol: SymbolId, values: Values) -> Option<Values> {
        if !self.is_initialized_with_set(symbol) {
            return Some(values);
        }
        let [Held::SetOf(held)] = <[Held; 1]>::try_from(values).ok()? else {
            return None;
        };
        let mut held = Distinct::from(held);
        let hir = self.inputs.hir;
        for mention in self.mentions_of(symbol) {
            let Some(call) = self.find_add(mention) else {
                continue;
            };
            let added = match hir.ids(call.args).next() {
                Some(added)
                    if matches!(expr_kind(hir, added), Some(ExprKind::Spread(_)) | None) =>
                {
                    return None;
                }
                Some(added) => self
                    .values_apart_from_itself(added)
                    .unwrap_or_else(some_text),
                None => vec![Held::Primitive(Constant::Undefined)],
            };
            for value in added {
                add(&mut held, value);
            }
        }
        Some(vec![Held::SetOf(held.all)])
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
        values: Values,
    ) -> Option<Values> {
        if !self.is_initialized_with_list(symbol) {
            return Some(values);
        }
        let mut values = Distinct::from(values);
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
            self.pay_for(values.len())?;
            for index in 0..values.len() {
                let Held::List(places) = &values[index] else {
                    return None;
                };
                let longer = places.iter().chain(&pushed).cloned().collect();
                add(&mut values, Held::List(longer));
            }
        }
        Some(values.all)
    }

    fn is_exported(&self, symbol: SymbolId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        is_exported(hir, bound, symbol)
    }

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
                bound
                    .dynamic_lookup_scope(NodeData::Expr(mention))
                    .is_none()
                    && (self.stores_without_handing_on(mention)
                        || self.find_push(mention).is_some()
                            && self.is_initialized_with_list(symbol)
                        || self.find_add(mention).is_some() && self.is_initialized_with_set(symbol)
                        || self.keeps_as_written(mention))
            })
    }

    fn stores_without_handing_on(&mut self, mention: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        if !bound.is_store_target(mention) {
            return false;
        }
        match bound.parent_of_expr(self.outermost_cast(mention)) {
            Parent::Expr(assignment)
                if matches!(
                    hir[assignment].kind,
                    ExprKind::Assign {
                        op: Some(BinOp::And | BinOp::Or | BinOp::Nullish),
                        ..
                    }
                ) =>
            {
                self.keeps_as_written(assignment)
            }
            _ => true,
        }
    }

    fn stands_in_options_of_resolve(&self, property: PropId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let options = self.outermost_cast(bound.prop_owner[property.idx()]);
        matches!(bound.parent_of_expr(options), Parent::Expr(call)
            if matches!(call_site_kind(hir, bound, call), Some(ImportSiteKind::RequireResolve(_)))
                && matches!(hir[call].kind, ExprKind::Call(call)
                    if hir[call].args.len() == 2 && hir.id_at(hir[call].args, 1) == options))
    }

    fn holds_what_cannot_be_changed(&mut self, e: ExprId) -> bool {
        let values = self.values_of(e);
        values.is_some_and(|values| !values.iter().any(Held::can_be_changed))
    }

    fn keeps_as_written(&mut self, e: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let e = self.outermost_cast(e);
        let above = match bound.parent_of_expr(e) {
            Parent::Expr(above) => above,
            Parent::VarInit(declaration) => {
                let pattern = hir[declaration].pat;
                return match hir[pattern].kind {
                    PatKind::Ident(_) => {
                        self.asks_name(pattern, bound.initialized_binding(pattern))
                    }
                    _ => self.asks_names_of(pattern, Decl::Var, u32::MAX),
                };
            }
            Parent::FnBody(function) => return self.is_answer_only_tested(function),
            Parent::Prop(property) => return self.stands_in_options_of_resolve(property),
            Parent::Stmt(statement) => {
                return match hir[statement].kind {
                    StmtKind::Return(_) => match self.find_function_around(statement) {
                        Some(function) => self.is_answer_only_tested(function),
                        None => false,
                    },
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
                let is_tag = matches!(bound.parent_of_expr(member), Parent::Expr(user)
                    if matches!(hir[user].kind, ExprKind::TaggedTemplate(call) if hir[call].callee == member));
                if bound.get_assignment_target(hir, member).is_some() {
                    return self.joins_what_is_stored(above, member);
                }
                if is_deleted || is_tag {
                    return false;
                }
                match self.find_call_of_member(member) {
                    Some(_) => {
                        self.asks_list_without_changing_it(above)
                            || self.calls_function_that_cannot_see_its_holder(above)
                    }
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
                BinOp::Instanceof => left != e,
                _ => true,
            },
            ExprKind::Cond { test, .. } => test == e || self.keeps_as_written(above),
            ExprKind::Spread(_) => {
                let is_in_list = matches!(bound.parent_of_expr(above), Parent::Expr(list)
                    if matches!(hir[list].kind, ExprKind::Array(_)));
                let elements = self.values_of_elements(e);
                is_in_list && elements.is_some_and(|it| !it.iter().any(Held::can_be_changed))
            }
            ExprKind::New(call) if self.is_construction_of_set(hir[call]) => {
                let elements = self.values_of_elements(e);
                hir[call].callee != e
                    && elements.is_some_and(|it| !it.iter().any(Held::can_be_changed))
            }
            ExprKind::Call(call) if self.find_listing_of_object(hir[call]).is_some() => {
                let lists_pairs = matches!(
                    self.find_listing_of_object(hir[call]),
                    Some((_, Listing::Entries))
                );
                let listed = self.values_of_elements(above);
                listed.is_some_and(|listed| {
                    listed.iter().all(|held| match held {
                        Held::List(pair) if lists_pairs => {
                            !pair.iter().flatten().any(Held::can_be_changed)
                        }
                        held => !held.can_be_changed(),
                    })
                })
            }
            ExprKind::Call(call) if hir[call].callee == e => true,
            ExprKind::Call(call) => {
                call_site_kind(hir, bound, above).is_some()
                    || self.asks_parameter_that_takes(e, hir[call], u32::MAX)
            }
            ExprKind::ImportCall { .. } => call_site_kind(hir, bound, above).is_some(),
            _ => false,
        }
    }

    fn asks_who_takes(&mut self, e: ExprId, layers: u32) -> bool {
        let e = self.outermost_cast(e);
        if let Some(&known) = self.asked_who_takes.get(&(e, layers)) {
            return known;
        }
        let shallowest = self.shallowest_being_asked.get(&e).copied();
        if shallowest.is_some_and(|open| open < layers) {
            return false;
        }
        self.asked_who_takes.insert((e, layers), true);
        let begun = self.asked_while_open.len();
        self.asked_while_open.push((e, layers));
        self.shallowest_being_asked.insert(e, layers);
        let is_asked = self.asks_who_stands_around(e, layers);
        match shallowest {
            Some(open) => self.shallowest_being_asked.insert(e, open),
            None => self.shallowest_being_asked.remove(&e),
        };
        if !is_asked {
            for leaned in self.asked_while_open.drain(begun..) {
                if self.asked_who_takes.get(&leaned) == Some(&true) {
                    self.asked_who_takes.remove(&leaned);
                }
            }
        } else if begun == 0 {
            self.asked_while_open.clear();
        }
        self.asked_who_takes.insert((e, layers), is_asked);
        is_asked
    }

    fn asks_name(&mut self, pattern: PatId, binding: Binding) -> bool {
        let bound = self.inputs.bound;
        match binding {
            Binding::Symbol(holder) => {
                self.take_as_kept_as_written(holder)
                    && bound.dynamic_lookup_scope(NodeData::Pat(pattern)).is_none()
                    && !bound.is_visible_to_eval(holder)
            }
            _ => false,
        }
    }

    fn fills_the_name_it_declares(
        &self,
        pattern: PatId,
        written: Atom,
        decl: fn(PatId) -> Decl,
    ) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let mut root = pattern;
        let function = loop {
            match bound.pat_parent[root.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => root = outer,
                PatParent::Param(it) => break bound.param_fn[it.idx()],
                PatParent::Var(_) => {
                    let declared = Binding::Symbol(bound.declared_symbol(decl(pattern)));
                    return bound.initialized_binding(pattern) == declared;
                }
                PatParent::None => return false,
            }
        };
        let owner = bound.fns[function.idx()].owner;
        let Some(text) = owner.text_of_expression_or_declaration(hir) else {
            return false;
        };
        let mut spelled = self.written_names.find(hir, written).iter();
        spelled.all(|it| !text.contains(&hir[it.1].pos))
    }

    fn asks_names_of(&mut self, pattern: PatId, decl: fn(PatId) -> Decl, layers: u32) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        match hir[pattern].kind {
            PatKind::Missing => true,
            PatKind::Ident(written) => {
                let name = bound.declared_symbol(decl(pattern));
                let is_destructuring_source = !matches!(
                    bound.pat_parent[pattern.idx()],
                    PatParent::Var(_) | PatParent::Param(_)
                );
                let is_copied = (bound.runtime.parameter_var_copies().iter())
                    .any(|copy| copy.parameter == name || copy.variable == name);
                let fills_another = matches!(decl(pattern), Decl::Var(_))
                    && bound.initialized_binding(pattern) != Binding::Symbol(name);
                if self.is_exported(name) || is_copied || fills_another {
                    return false;
                }
                let is_seen_here_alone =
                    bound.dynamic_lookup_scope(NodeData::Pat(pattern)).is_none()
                        && !bound.is_visible_to_eval(name);
                let mentions = self.mentions_of(name);
                let Some(&mention) = mentions.first() else {
                    return is_seen_here_alone
                        && self.fills_the_name_it_declares(pattern, written, decl);
                };
                let holds_nothing_to_change = is_destructuring_source
                    && is_seen_here_alone
                    && self.holds_what_cannot_be_changed(mention);
                holds_nothing_to_change || self.asks_name(pattern, Binding::Symbol(name))
            }
            PatKind::Object(_) | PatKind::Array(_) if layers == 0 => true,
            PatKind::Object(taken) => {
                (taken.iter()).all(|it| self.asks_names_of(hir[it].value, decl, layers - 1))
            }
            PatKind::Array(taken) => (taken.iter()).all(|it| {
                let below = layers - u32::from(!hir[it].is_rest);
                self.asks_names_of(hir[it].pat, decl, below)
            }),
        }
    }

    fn asks_parameter(&mut self, function: FnId, position: usize, layers: u32) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let parameters = hir[function].params;
        let has_rest = (parameters.iter()).any(|id| hir[id].flags.contains(Flags::REST));
        let ways = FunctionFlags::USES_ARGUMENTS | FunctionFlags::HAS_DIRECT_EVAL;
        if has_rest || bound.function_flags(function).intersects(ways) {
            return false;
        }
        let Some(id) = parameters.iter().nth(position) else {
            return true;
        };
        self.asks_names_of(hir[id].pat, Decl::Param, layers)
    }

    fn asks_parameter_that_takes(&mut self, argument: ExprId, call: Call, layers: u32) -> bool {
        let hir = self.inputs.hir;
        let mut arguments = hir.ids(call.args);
        let is_spread = |it: ExprId| matches!(expr_kind(hir, it), Some(ExprKind::Spread(_)) | None);
        let Some(position) = arguments.position(|it| it == argument) else {
            return false;
        };
        if call.chain != Chain::No || hir.ids(call.args).take(position).any(is_spread) {
            return false;
        }
        let Some(called) = self.values_of(call.callee) else {
            return false;
        };
        called.into_iter().all(|it| match it {
            Held::Function(function) => self.asks_parameter(function, position, layers),
            _ => false,
        })
    }

    fn find_function_around(&self, mut statement: StmtId) -> Option<FnId> {
        let bound = self.inputs.bound;
        loop {
            statement = match bound.parent_of_stmt(statement) {
                Parent::Stmt(above) => above,
                Parent::Case(case) => bound.case_stmt[case.idx()],
                Parent::FnBody(function) => return Some(function),
                _ => return None,
            };
        }
    }

    fn find_walk_that_calls(&mut self, function: FnId) -> Option<(ExprId, ExprId, Atom)> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let FnOwner::Expr(written) = bound.fns[function.idx()].owner else {
            return None;
        };
        let Parent::Expr(walk) = bound.parent_of_expr(self.outermost_cast(written)) else {
            return None;
        };
        let Some(ExprKind::Call(call)) = expr_kind(hir, walk) else {
            return None;
        };
        let call = hir[call];
        let first = hir
            .ids(call.args)
            .next()
            .map(|it| hir.skip_type_assertions(it));
        let (list, name) = self
            .find_walk_of_list(call)
            .filter(|_| first == Some(written))?;
        self.values_of_elements(list).map(|_| (walk, list, name))
    }

    fn is_answer_only_tested(&mut self, function: FnId) -> bool {
        let walk = self.find_walk_that_calls(function);
        self.answers_its_caller(function)
            && walk.is_some_and(|(_, _, name)| self.inputs.atoms.bytes(name) != b"map")
    }

    fn answers_its_caller(&self, function: FnId) -> bool {
        let flags = self.inputs.hir[function].flags;
        !flags.intersects(Flags::ASYNC | Flags::GENERATOR)
    }

    fn asks_who_takes_answer_of(&mut self, function: FnId, layers: u32) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        if !self.answers_its_caller(function) {
            return false;
        }
        if let Some((walk, _, name)) = self.find_walk_that_calls(function) {
            return self.inputs.atoms.bytes(name) != b"map"
                || self.asks_who_takes(walk, layers + 1);
        }
        let name = match bound.fns[function.idx()].owner {
            FnOwner::Stmt(_) => bound.declared_symbol(Decl::Fn(function)),
            FnOwner::Expr(written) => match bound.parent_of_expr(self.outermost_cast(written)) {
                Parent::VarInit(declaration) => {
                    match bound.initialized_binding(hir[declaration].pat) {
                        Binding::Symbol(name) => name,
                        _ => return false,
                    }
                }
                Parent::Prop(property) => {
                    return self.asks_who_takes_answer_of_member(property, layers);
                }
                _ => return false,
            },
            _ => return false,
        };
        if !bound.is_stable_binding(name)
            || self.is_exported(name)
            || bound.is_visible_to_eval(name)
        {
            return false;
        }
        let open = self.functions_whose_answers_are_asked.iter();
        let open = open.filter(|it| it.0 == function).map(|it| it.1);
        if let Some(shallowest) = open.min()
            && shallowest <= layers
        {
            return shallowest == layers;
        }
        self.functions_whose_answers_are_asked
            .push((function, layers));
        let are_asked = self.mentions_of(name).into_iter().all(|mention| {
            let callee = self.outermost_cast(mention);
            match bound.parent_of_expr(callee) {
                Parent::Expr(call) => {
                    matches!(hir[call].kind, ExprKind::Call(it) if hir[it].callee == callee && hir[it].chain == Chain::No)
                        && self.asks_who_takes(call, layers)
                }
                _ => false,
            }
        });
        self.functions_whose_answers_are_asked.pop();
        are_asked
    }

    fn asks_who_takes_answer_of_member(&mut self, property: PropId, layers: u32) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let holder = bound.prop_owner[property.idx()];
        let PropKey::Name(key) = hir.runtime_property_key(property) else {
            return false;
        };
        let Parent::VarInit(declaration) = bound.parent_of_expr(self.outermost_cast(holder)) else {
            return false;
        };
        let Binding::Symbol(name) = bound.initialized_binding(hir[declaration].pat) else {
            return false;
        };
        let is_literal = matches!(hir[holder].kind, ExprKind::Object(_));
        if !is_literal
            || !bound.is_stable_binding(name)
            || self.is_exported(name)
            || bound.is_visible_to_eval(name)
        {
            return false;
        }
        self.mentions_of(name).into_iter().all(|mention| {
            if bound
                .dynamic_lookup_scope(NodeData::Expr(mention))
                .is_some()
            {
                return false;
            }
            let object = self.outermost_cast(mention);
            let Parent::Expr(read) = bound.parent_of_expr(object) else {
                return false;
            };
            match hir.member_key(read) {
                Some((of, MemberKey::Name(other))) if of == object && other != key => true,
                Some((of, MemberKey::Name(_))) if of == object => {
                    match self.find_call_of_member(self.outermost_cast(read)) {
                        Some((answer, _)) => self.asks_who_takes(answer, layers),
                        None => false,
                    }
                }
                _ => false,
            }
        })
    }

    fn asks_who_takes_member(&mut self, read: ExprId, layers: u32) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let member = self.outermost_cast(read);
        let user = match bound.parent_of_expr(member) {
            Parent::Expr(user) => Some(hir[user].kind),
            _ => None,
        };
        let is_more_than_read = match user {
            Some(ExprKind::Unary {
                op: UnOp::Delete, ..
            }) => true,
            Some(ExprKind::TaggedTemplate(call) | ExprKind::New(call)) => {
                hir[call].callee == member
            }
            _ => false,
        };
        if is_more_than_read || bound.get_assignment_target(hir, member).is_some() {
            return false;
        }
        let Some((answer, call)) = self.find_call_of_member(member) else {
            return layers == 0 || self.asks_who_takes(member, layers - 1);
        };
        let Some((list, name)) = self.find_walk_of_list(call) else {
            return matches!(hir.member_key(read), Some((_, MemberKey::Name(name))) if self.only_asks(name));
        };
        if layers == 0 {
            return true;
        }
        let written = hir.ids(call.args).next();
        let written = written.and_then(|it| expr_kind(hir, hir.skip_type_assertions(it)));
        let Some(ExprKind::Fn(function)) = written else {
            return false;
        };
        let walks_set = self.values_of(list).is_none_or(|held| {
            let mut held = held.iter();
            held.any(|it| !matches!(it, Held::List(_) | Held::ListOf(_)))
        });
        if !self.asks_parameter(function, 0, layers - 1)
            || walks_set && !self.asks_parameter(function, 1, layers - 1)
        {
            return false;
        }
        match self.inputs.atoms.bytes(name) {
            b"filter" => self.asks_who_takes(answer, layers),
            b"find" | b"findLast" => self.asks_who_takes(answer, layers - 1),
            _ => true,
        }
    }

    fn asks_who_stands_around(&mut self, e: ExprId, layers: u32) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let above = match bound.parent_of_expr(e) {
            Parent::Expr(above) => above,
            Parent::VarInit(declaration) => {
                let pattern = hir[declaration].pat;
                return self.asks_names_of(pattern, Decl::Var, layers);
            }
            Parent::Prop(property) => {
                let holder = bound.prop_owner[property.idx()];
                return matches!(hir[holder].kind, ExprKind::Object(_))
                    && self.asks_who_takes(holder, layers + 1);
            }
            Parent::FnBody(function) => return self.asks_who_takes_answer_of(function, layers),
            Parent::ParamDefault(id) => {
                let function = bound.param_fn[id.idx()];
                let position = hir[function].params.iter().position(|it| it == id);
                return position.is_some_and(|it| self.asks_parameter(function, it, layers));
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
                    StmtKind::ForOf {
                        left,
                        expr,
                        is_await: false,
                        ..
                    } if expr == e => {
                        layers == 0
                            || match hir[left].kind {
                                StmtKind::Var(declared) => (declared.iter()).all(|it| {
                                    self.asks_names_of(hir[it].pat, Decl::Var, layers - 1)
                                }),
                                _ => false,
                            }
                    }
                    StmtKind::Return(_) => match self.find_function_around(statement) {
                        Some(function) => self.asks_who_takes_answer_of(function, layers),
                        None => false,
                    },
                    _ => false,
                };
            }
            _ => return false,
        };
        match hir[above].kind {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e => {
                self.asks_who_takes_member(above, layers)
            }
            ExprKind::Cond { test, .. } => test == e || self.asks_who_takes(above, layers),
            ExprKind::Binary { op, left, .. } => match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => self.asks_who_takes(above, layers),
                BinOp::Comma => left == e || self.asks_who_takes(above, layers),
                BinOp::Instanceof => left != e,
                _ => true,
            },
            ExprKind::Unary {
                op: UnOp::Not | UnOp::Typeof | UnOp::Void,
                ..
            } => true,
            ExprKind::Assign {
                op: None | Some(BinOp::Or | BinOp::And | BinOp::Nullish),
                target,
                value,
            } if value == e => {
                let is_asked = match (hir[target].kind, bound.binding(target)) {
                    (ExprKind::Ident(_), Binding::Symbol(holder)) => {
                        self.take_as_kept_as_written(holder)
                            && bound.dynamic_lookup_scope(NodeData::Expr(target)).is_none()
                            && !bound.is_visible_to_eval(holder)
                    }
                    _ => self.takes_export_as_written(target),
                };
                is_asked && self.asks_who_takes(above, layers)
            }
            ExprKind::Array(_) => self.asks_who_takes(above, layers + 1),
            ExprKind::Spread(_) => match bound.parent_of_expr(above) {
                Parent::Expr(list) if matches!(hir[list].kind, ExprKind::Array(_)) => {
                    layers == 0 || self.asks_who_takes(list, layers)
                }
                _ => false,
            },
            ExprKind::New(call) if self.is_construction_of_set(hir[call]) => {
                hir[call].callee != e && (layers == 0 || self.asks_who_takes(above, layers))
            }
            ExprKind::Call(call) if hir[call].callee == e => true,
            ExprKind::Call(call) => match self.find_listing_of_object(hir[call]) {
                Some((_, Listing::Keys)) => true,
                Some((_, Listing::Values)) => layers == 0 || self.asks_who_takes(above, layers),
                Some((_, Listing::Entries)) => {
                    layers == 0 || self.asks_who_takes(above, layers + 1)
                }
                None => {
                    call_site_kind(hir, bound, above).is_some()
                        || self.asks_parameter_that_takes(e, hir[call], layers)
                }
            },
            ExprKind::ImportCall { .. } => call_site_kind(hir, bound, above).is_some(),
            _ => false,
        }
    }

    fn takes_export_as_written(&self, target: ExprId) -> bool {
        let hir = self.inputs.hir;
        let (Some((_, MemberKey::Name(key))), Some(asked)) =
            (hir.member_key(target), self.own_export_queries)
        else {
            return false;
        };
        if !self.names_an_export(target) {
            return false;
        }
        let is_reached_by_name_alone = self.reaches_exports_by_their_name_alone(target);
        if is_reached_by_name_alone {
            asked.0.borrow_mut().push(key);
        }
        if !is_reached_by_name_alone || hir.exports_that_others_touch.contains(&key) {
            self.has_read_data_file.set(true);
        }
        true
    }

    fn names_an_export(&self, target: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let is_module = |it: ExprId| is_free_common_js(hir, bound, it, CommonJsVariable::Module);
        match hir.member_key(target) {
            Some((holder, MemberKey::Name(key))) => {
                key == known::exports && is_module(holder)
                    || is_free_common_js(hir, bound, holder, CommonJsVariable::Exports)
                    || matches!(hir.member_key(holder),
                        Some((of, MemberKey::Name(known::exports))) if is_module(of))
            }
            _ => false,
        }
    }

    fn reaches_exports_by_their_name_alone(&self, target: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let Some((holder, MemberKey::Name(key))) = hir.member_key(target) else {
            return false;
        };
        let is_module = |it: ExprId| is_free_common_js(hir, bound, it, CommonJsVariable::Module);
        let is_exports = |it: ExprId| is_free_common_js(hir, bound, it, CommonJsVariable::Exports);
        let of_module = |it: ExprId| match hir.member_key(it) {
            Some((of, MemberKey::Name(known::exports))) => is_module(of),
            _ => false,
        };
        let is_whole = key == known::exports && is_module(holder);
        let mut modules = self.written_names.find(hir, known::module).iter();
        let mut exports = self.written_names.find(hir, known::exports).iter();
        let mut loaders = self.written_names.find(hir, known::require).iter();
        let mut handed = self.written_names.find(hir, known::arguments).iter();
        let mut hosts = self.written_names.find(hir, known::process).iter();
        let mut see_everything = [known::globalThis, known::global, known::eval].into_iter();
        let mut expressions = (0..).map(ExprId).zip(hir.exprs.iter());
        (is_whole || is_exports(holder) || of_module(holder))
            && modules.all(|it| {
                let Parent::Expr(above) = bound.parent_of_expr(it.1) else {
                    return !is_module(it.1);
                };
                !is_module(it.1)
                    || self.is_only_tested(it.1)
                    || hir.member_key(above).is_some_and(|member| member.0 == it.1)
                        && self.is_only_tested(above)
                    || of_module(above)
                        && match is_whole {
                            true => above == target,
                            false => self.reads_another_export(above, key, target),
                        }
            })
            && exports.all(|it| {
                is_whole
                    || !is_exports(it.1)
                    || self.is_only_tested(it.1)
                    || self.reads_another_export(it.1, key, target)
            })
            && loaders.all(|it| self.hands_out_no_module(it.1))
            && handed.all(|it| stands_in_function_with_arguments(hir, bound, it.1))
            && hosts.all(|it| self.reads_no_module_off_process(it.1))
            && see_everything.all(|name| {
                let mut written = self.written_names.find(hir, name).iter();
                written.all(|it| !is_free_name(hir, bound, it.1, &[name]))
            })
            && expressions.all(|(it, written)| match written.kind {
                ExprKind::This => {
                    is_whole
                        || self.is_only_tested(it)
                        || self.reads_another_export(it, key, target)
                }
                _ => !self.may_load_own_file(it),
            })
    }

    fn reads_no_module_off_process(&self, host: ExprId) -> bool {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        if !is_free_name(hir, bound, host, &[known::process]) {
            return true;
        }
        let Parent::Expr(above) = bound.parent_of_expr(host) else {
            return false;
        };
        matches!(hir.member_key(above), Some((of, MemberKey::Name(read)))
            if of == host && atoms.bytes(read) != b"mainModule")
    }

    fn hands_out_no_module(&self, loader: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        if !is_free_common_js(hir, bound, loader, CommonJsVariable::Require) {
            return true;
        }
        let Parent::Expr(above) = bound.parent_of_expr(loader) else {
            return false;
        };
        match (hir[above].kind, hir.member_key(above)) {
            (ExprKind::Call(call), _) => hir[call].callee == loader,
            (_, Some((_, MemberKey::Name(known::resolve)))) => true,
            (_, Some((_, MemberKey::Name(known::main)))) => self.is_only_tested(above),
            _ => false,
        }
    }

    fn may_load_own_file(&self, call: ExprId) -> bool {
        let &ScanInputs {
            hir,
            bound,
            decisions,
            file,
            atoms,
            ..
        } = self.inputs;
        let is_call = matches!(
            hir[call].kind,
            ExprKind::Call(_) | ExprKind::ImportCall { .. }
        );
        if !is_call || call_site_kind(hir, bound, call).is_none() {
            return false;
        }
        let arguments = call_site_arguments(hir, bound, call);
        let Some(name) = arguments.and_then(|it| hir.ids(it).next()) else {
            return false;
        };
        if names_own_file(hir, bound, name) {
            return true;
        }
        let (FoldedValue::Constant(Constant::String(name))
        | FoldedValue::ConstantOutsideDeadZone(Constant::String(name))) =
            decisions.constant(hir, name)
        else {
            return false;
        };
        let name = atoms.bytes(name);
        let mut parts = name.rsplit(|&it| it == b'/' || it == b'\\');
        let last = parts.next().unwrap_or(name);
        let stem = file.own_name.rsplitn(2, |&it| it == b'.').last();
        let stem = stem.unwrap_or(file.own_name);
        !file.own_name.is_empty()
            && (last == file.own_name
                || last == stem
                || stem == b"index" && matches!(last, b"" | b"." | b".."))
    }

    fn is_only_tested(&self, e: ExprId) -> bool {
        is_only_tested(self.inputs.hir, self.inputs.bound, e)
    }

    fn reads_another_export(&self, exports: ExprId, key: Atom, target: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let Parent::Expr(above) = bound.parent_of_expr(exports) else {
            return false;
        };
        if let Some((of, MemberKey::Name(other))) = hir.member_key(above)
            && of == exports
        {
            let member = self.outermost_cast(above);
            let is_tag = matches!(bound.parent_of_expr(member), Parent::Expr(user)
                if matches!(hir[user].kind, ExprKind::TaggedTemplate(call) if hir[call].callee == member));
            let is_called = is_tag || self.find_call_of_member(member).is_some();
            let hands_them_on = may_change_or_hand_on_its_object(self.inputs.atoms.bytes(other));
            let stores_what_may_take_them = matches!(bound.parent_of_expr(member), Parent::Expr(user)
                if matches!(hir[user].kind, ExprKind::Assign { target, value, .. }
                    if target == member && !self.is_written_here_or_no_function(value)));
            return above == target
                || other != key && !is_called && !hands_them_on && !stores_what_may_take_them;
        }
        let ExprKind::Call(call) = hir[above].kind else {
            return false;
        };
        let defines = match hir.member_key(hir[call].callee) {
            Some((object, MemberKey::Name(name))) => {
                self.inputs.atoms.bytes(name) == b"defineProperty"
                    && is_free_name(hir, bound, object, &[known::Object])
            }
            _ => false,
        };
        let mut arguments = hir.ids(hir[call].args);
        defines
            && arguments.next() == Some(exports)
            && matches!(arguments.next().map(|it| hir[it].kind), Some(ExprKind::String(other)) if other != key)
            && arguments
                .next()
                .is_some_and(|it| self.describes_with_what_is_written_there(it))
            && matches!(bound.parent_of_expr(above), Parent::Stmt(statement)
                if matches!(hir[statement].kind, StmtKind::Expr(_)))
    }

    fn describes_with_what_is_written_there(&self, descriptor: ExprId) -> bool {
        let hir = self.inputs.hir;
        let ExprKind::Object(properties) = hir[descriptor].kind else {
            return false;
        };
        properties.iter().all(|it| {
            let property = hir[it];
            let is_function = matches!(
                hir[hir.skip_type_assertions(property.value)].kind,
                ExprKind::Fn(_)
            );
            match (property.kind, hir.runtime_property_key(it)) {
                (PropKind::Init | PropKind::Method, PropKey::Name(known::get | known::set)) => {
                    is_function
                }
                (PropKind::Init, PropKey::Name(_)) => {
                    self.is_written_here_or_no_function(property.value)
                }
                _ => false,
            }
        })
    }

    fn is_written_here_or_no_function(&self, value: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let value = hir.skip_type_assertions(value);
        match hir[value].kind {
            ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::Object(_)
            | ExprKind::Array(_)
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. }
            | ExprKind::Template { .. }
            | ExprKind::Unary { .. } => true,
            ExprKind::Assign { value, .. } => self.is_written_here_or_no_function(value),
            ExprKind::Ident(_) => match bound.binding(value) {
                Binding::Symbol(name) => {
                    let mut declarations = bound.symbol(name).decls.iter();
                    bound.is_stable_binding(name)
                        && declarations.all(|it| matches!(it, Decl::Fn(_) | Decl::Class(_)))
                }
                _ => false,
            },
            _ => false,
        }
    }

    fn joins_what_is_stored(&mut self, read: ExprId, member: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let Parent::Expr(assignment) = bound.parent_of_expr(member) else {
            return false;
        };
        let ExprKind::Assign {
            op: None,
            target,
            value,
        } = hir[assignment].kind
        else {
            return false;
        };
        let is_statement = matches!(bound.parent_of_expr(assignment), Parent::Stmt(statement)
            if matches!(hir[statement].kind, StmtKind::Expr(_)));
        let Some((object, key)) = hir.member_key(read) else {
            return false;
        };
        let Some(Some(keys)) = self.keys_of(key) else {
            return false;
        };
        let [key] = &keys[..] else {
            return false;
        };
        let is_plain_key = !matches!(&key[..], b"toString" | b"valueOf" | b"__proto__");
        if target != member
            || !is_statement
            || !is_plain_key
            || !self.holds_what_cannot_be_changed(value)
        {
            return false;
        }
        let Some(holders) = self.values_of(object) else {
            return false;
        };
        holders.into_iter().all(|holder| match holder {
            Held::Object(literal) => {
                if self.stores_known.insert((literal, value)) {
                    let stored = self.stored_under_keys.entry(literal).or_default();
                    stored.push((key.clone(), value));
                }
                true
            }
            Held::Primitive(Constant::Undefined | Constant::Null) => true,
            _ => false,
        })
    }

    fn only_asks(&self, name: Atom) -> bool {
        name == known::join
            || matches!(
                self.inputs.atoms.bytes(name),
                b"includes" | b"indexOf" | b"lastIndexOf" | b"has"
            )
    }

    fn asks_list_without_changing_it(&mut self, member: ExprId) -> bool {
        let hir = self.inputs.hir;
        let Some((object, MemberKey::Name(name))) = hir.member_key(member) else {
            return false;
        };
        let asks = self.only_asks(name);
        let hands_elements_on = match self.find_call_of_member(member) {
            Some((_, call)) => self.find_walk_of_list(call).is_some(),
            None => false,
        };
        let elements = self.values_of_elements(object);
        elements.is_some_and(|elements| {
            asks || hands_elements_on && !elements.iter().any(Held::can_be_changed)
        })
    }

    fn calls_function_that_cannot_see_its_holder(&mut self, member: ExprId) -> bool {
        let Some((object, key)) = self.inputs.hir.member_key(member) else {
            return false;
        };
        let Some(holders) = self.values_of(object) else {
            return false;
        };
        let places_read = self.keys_of(key).flatten();
        holders.into_iter().all(|holder| match holder {
            Held::Object(literal) => {
                let Some(read) = places_read.as_ref() else {
                    return false;
                };
                if let Some(written) = self.keys_of_object_out_of_sight_of_its_functions(literal) {
                    let mut read = read.iter();
                    return read.all(|key| {
                        written.contains(key) || !may_change_or_hand_on_its_object(key)
                    });
                }
                let Some(written) = self.properties_of(literal) else {
                    return false;
                };
                read.iter().all(|key| {
                    let mut under_key = written.iter().filter(|it| it.0 == *key).peekable();
                    match under_key.peek() {
                        Some(_) => under_key.all(|it| {
                            self.values_of(it.1).is_some_and(|named| {
                                let mut named = named.iter();
                                named.all(|it| self.cannot_change_what_it_is_called_on(it))
                            })
                        }),
                        None => !may_change_or_hand_on_its_object(key),
                    }
                })
            }
            Held::List(places) => {
                let is_blind = |key: &Vec<u8>| {
                    let index = bun_core::fmt::parse_int::<usize>(key, 10).ok();
                    index
                        .and_then(|index| places.get(index))
                        .is_some_and(|called| {
                            let mut called = called.iter();
                            called.all(|it| self.cannot_change_what_it_is_called_on(it))
                        })
                };
                places_read
                    .as_ref()
                    .is_some_and(|keys| keys.iter().all(is_blind))
            }
            Held::Primitive(Constant::Undefined | Constant::Null) => true,
            _ => false,
        })
    }

    fn cannot_change_what_it_is_called_on(&self, held: &Held) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let function = match held {
            &Held::Function(function) => function,
            Held::Text(_) | Held::Primitive(_) => return true,
            _ => return false,
        };
        let owner = bound.fns[function.idx()].owner;
        let Some(text) = owner.text_of_expression_or_declaration(hir) else {
            return false;
        };
        !bound
            .function_flags(function)
            .contains(FunctionFlags::HAS_DIRECT_EVAL)
            && !self.says_this_or_super(text)
    }

    fn says_this_or_super(&self, text: Range<u32>) -> bool {
        let said = self.written_names.2.get_or_init(|| {
            let said = self.inputs.hir.exprs.iter();
            let said = said.filter(|it| matches!(it.kind, ExprKind::This | ExprKind::Super));
            let mut places: Vec<u32> = said.map(|it| it.pos).collect();
            places.shared_sort_unstable();
            places
        });
        let first = said.partition_point(|&place| place < text.start);
        said.get(first).is_some_and(|&place| place < text.end)
    }

    fn keys_of_object_out_of_sight_of_its_functions(
        &mut self,
        literal: ExprId,
    ) -> Option<Rc<FxHashSet<Vec<u8>>>> {
        if let Some(known) = self
            .objects_asked_whether_their_functions_see_them
            .get(&literal)
        {
            return known.clone();
        }
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let text = hir[literal].pos..hir[literal].end;
        let mentions_itself = self.says_this_or_super(text);
        let written = self.properties_of(literal).filter(|written| {
            !mentions_itself
                && written.iter().all(|it| {
                    let value = hir.skip_type_assertions(it.1);
                    matches!(hir[value].kind, ExprKind::Fn(function)
                        if !self.says_this_or_super(hir[value].pos..hir[value].end)
                            && !bound.function_flags(function).contains(FunctionFlags::HAS_DIRECT_EVAL))
                })
        });
        let keys = written.map(|written| Rc::new(written.into_iter().map(|it| it.0).collect()));
        self.objects_asked_whether_their_functions_see_them
            .insert(literal, keys.clone());
        keys
    }

    fn keys_of(&mut self, key: MemberKey) -> Option<Option<Vec<Vec<u8>>>> {
        let computed = match key {
            MemberKey::Name(name) => {
                return Some(Some(vec![self.inputs.atoms.bytes(name).to_vec()]));
            }
            MemberKey::PrivateName(_) => return None,
            MemberKey::Computed(computed) => computed,
        };
        let Some(values) = self.values_apart_from_itself(computed) else {
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

    fn values_of_field_of_class_written_here(
        &mut self,
        object: ExprId,
        key: MemberKey,
    ) -> Option<Values> {
        let &ScanInputs {
            hir,
            decisions,
            atoms,
            ..
        } = self.inputs;
        let (class, is_static) = match expr_kind(hir, hir.skip_type_assertions(object))? {
            ExprKind::Class(class) => (class, true),
            ExprKind::New(call) if hir[call].args.is_empty() => {
                match expr_kind(hir, hir.skip_type_assertions(hir[call].callee))? {
                    ExprKind::Class(class) => (class, false),
                    _ => return None,
                }
            }
            _ => return None,
        };
        let class = hir[class];
        if class.extends.is_some() || !hir.decorators.is_empty() {
            return None;
        }
        let keys = self.keys_of(key)??;
        let [key] = &keys[..] else {
            return None;
        };
        let mut value = None;
        for member in class.members.iter().map(|id| hir[id]) {
            let PropKey::Name(name) = member.key else {
                return None;
            };
            let is_asked_for =
                atoms.bytes(name) == &key[..] && member.flags.contains(Flags::STATIC) == is_static;
            let constant = match member.kind {
                MemberKind::Method if !is_asked_for => continue,
                MemberKind::Property if member.init.is_none() => Constant::Undefined,
                MemberKind::Property => match decisions.constant(hir, member.init) {
                    FoldedValue::Constant(constant) => constant,
                    _ => return None,
                },
                _ => return None,
            };
            if is_asked_for {
                value = Some(self.held_constant(constant));
            }
        }
        Some(vec![value?])
    }

    fn values_of_entry_of_map_written_here(
        &mut self,
        callee: ExprId,
        call: Call,
    ) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let (map, MemberKey::Name(known::get)) = hir.member_key(callee)? else {
            return None;
        };
        let ExprKind::New(made) = expr_kind(hir, hir.skip_type_assertions(map))? else {
            return None;
        };
        let made = hir[made];
        if !is_free_name(
            hir,
            bound,
            hir.skip_type_assertions(made.callee),
            &[known::Map],
        ) {
            return None;
        }
        let (mut made_of, mut asked_for) = (hir.ids(made.args), hir.ids(call.args));
        let (Some(entries), None, Some(asked_for), None) = (
            made_of.next(),
            made_of.next(),
            asked_for.next(),
            asked_for.next(),
        ) else {
            return None;
        };
        let ExprKind::Array(entries) = expr_kind(hir, hir.skip_type_assertions(entries))? else {
            return None;
        };
        let mut written: Vec<(Vec<u8>, ExprId)> = Vec::new();
        for entry in hir.ids(entries) {
            let ExprKind::Array(entry) = expr_kind(hir, hir.skip_type_assertions(entry))? else {
                return None;
            };
            let mut entry = hir.ids(entry);
            let (Some(key), Some(value), None) = (entry.next(), entry.next(), entry.next()) else {
                return None;
            };
            let [Held::Text(key)] = &self.values_of(key)?[..] else {
                return None;
            };
            let key = whole_ascii(key)?.to_vec();
            written.push((key, value));
        }
        keep_last_of_each_key(&mut written);
        let asked_for = self.values_apart_from_itself(asked_for);
        let keys: Option<Vec<Vec<u8>>> = asked_for.and_then(|asked_for| {
            let whole = |value: &Held| match value {
                Held::Text(text) => whole_ascii(text).map(<[u8]>::to_vec),
                _ => None,
            };
            asked_for.iter().map(whole).collect()
        });
        let Some(keys) = keys else {
            let values = self.values_of_any(written.iter().map(|it| it.1))?;
            return Some(with_undefined(values));
        };
        let written: FxHashMap<&[u8], ExprId> =
            written.iter().map(|it| (&it.0[..], it.1)).collect();
        let mut values = Distinct::new();
        for key in keys {
            match written.get(&key[..]) {
                Some(&value) => {
                    for value in self.values_of(value)? {
                        add(&mut values, value);
                    }
                }
                None => add(&mut values, Held::Primitive(Constant::Undefined)),
            }
        }
        Some(values.all)
    }

    fn values_of_member(&mut self, member: ExprId, chain: Chain) -> Option<Values> {
        let (object, key) = self.inputs.hir.member_key(member)?;
        if let (Some(parameter), MemberKey::Name(name)) = (self.stand_in, key)
            && self.stand_in_property == Some(name)
            && self.inputs.bound.binding(object) == Binding::Symbol(parameter)
        {
            return Some(vec![Held::Text(caller_url_placeholder())]);
        }
        if let Some(values) = self.values_of_field_of_class_written_here(object, key) {
            return Some(values);
        }
        let objects = self.values_of(object)?;
        let keys = self.keys_of(key)?;
        self.read_member(&objects, keys.as_deref(), chain)
    }

    fn read_member(
        &mut self,
        objects: &Values,
        keys: Option<&[Vec<u8>]>,
        chain: Chain,
    ) -> Option<Values> {
        let mut values = Distinct::new();
        for object in objects {
            let read = match object {
                Held::Object(literal) => self.read_property(*literal, keys)?,
                Held::List(places) => read_place(places, keys)?,
                Held::ListOf(held) => {
                    let read = read_place(std::slice::from_ref(held), None)?;
                    let is_index =
                        |key: &Vec<u8>| bun_core::fmt::parse_int::<usize>(key, 10).is_ok();
                    match keys.is_some_and(|keys| !keys.iter().all(is_index)) {
                        true => with(read, Held::Other),
                        false => read,
                    }
                }
                Held::SetOf(_) => match keys? {
                    [key] if key == b"size" => vec![Held::Other],
                    _ => return None,
                },
                Held::Os => {
                    let names = keys?.iter().map(|key| self.inputs.atoms.intern(key));
                    names.map(Held::FunctionOfOs).collect()
                }
                Held::Process => self.read_member_of_process(keys?)?,
                Held::Data {
                    specifier,
                    path,
                    is_namespace,
                } => match keys? {
                    [key] => vec![self.read_data_file((*specifier, path, *is_namespace), key)],
                    _ => return None,
                },
                Held::Url(name) => match keys? {
                    [key] if key == b"href" => vec![Held::Text(href_of(name))],
                    [key] if key == b"pathname" => vec![Held::Text(name.clone())],
                    _ => return None,
                },
                Held::Resolved(name, ResolvedForm::UrlObject) => match keys? {
                    [key] if key == b"href" => {
                        vec![Held::Resolved(name.clone(), ResolvedForm::Url)]
                    }
                    [key] if key == b"pathname" => {
                        vec![Held::Resolved(name.clone(), ResolvedForm::Path)]
                    }
                    _ => return None,
                },
                Held::Text(text) => match (whole_ascii(text), keys?) {
                    (Some(text), [key]) if key == b"length" => {
                        vec![Held::Primitive(Constant::Number(text.len() as f64))]
                    }
                    _ => return None,
                },
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
        Some(values.all)
    }

    fn read_data_file(
        &self,
        (specifier, path, is_namespace): (Atom, &[u8], bool),
        key: &[u8],
    ) -> Held {
        if is_namespace && key == b"default" {
            return Held::Data {
                specifier,
                path: path.to_vec(),
                is_namespace: false,
            };
        }
        let path = match path {
            [] => key.to_vec(),
            _ => [path, b"\0", key].concat(),
        };
        let &ScanInputs { hir, atoms, .. } = self.inputs;
        let name = atoms.intern(&path);
        if let Some(asked) = self.other_file_queries
            && path.len() == key.len()
        {
            asked.0.borrow_mut().push((specifier, name));
            let is_asked = |it: &&TextOfOtherFile| it.specifier == specifier && it.export == name;
            let mut known = hir.texts_of_other_files.iter().filter(is_asked);
            if let (Some(known), None) = (known.next(), known.next())
                && (self.folder == Folder::OfFile || !known.starts_at_own_directory)
            {
                return Held::Text(Text {
                    starts_at_own_directory: known.starts_at_own_directory,
                    ..Text::whole(atoms.bytes(known.text))
                });
            }
        }
        self.data_file_queries
            .0
            .borrow_mut()
            .push((specifier, name));
        let mut known = hir.texts_of_data_files.iter();
        match known.find(|it| it.specifier == specifier && it.path == name) {
            Some(known) => {
                self.has_read_data_file.set(true);
                Held::Text(Text::whole(atoms.bytes(known.text)))
            }
            None => Held::Data {
                specifier,
                path,
                is_namespace: false,
            },
        }
    }

    fn read_member_of_process(&self, keys: &[Vec<u8>]) -> Option<Values> {
        let &ScanInputs { fold, atoms, .. } = self.inputs;
        let mut values = Distinct::new();
        for key in keys {
            let constant = fold.constant_of_member(known::process, atoms.intern(key))?;
            add(&mut values, self.held_constant(constant));
        }
        Some(values.all)
    }

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
            if matches!(&key[..], b"toString" | b"valueOf") {
                return None;
            }
            written.push((key, property.value));
        }
        keep_last_of_each_key(&mut written);
        if let Some(stored) = self.stored_under_keys.get(&literal) {
            written.extend(stored.iter().cloned());
        }
        Some(written)
    }

    fn read_property(&mut self, literal: ExprId, keys: Option<&[Vec<u8>]>) -> Option<Values> {
        let written = self.properties_of(literal)?;
        let Some(keys) = keys else {
            let values = self.values_of_any(written.iter().map(|it| it.1))?;
            return Some(with_undefined(values));
        };
        let mut under_keys: FxHashMap<&[u8], Vec<ExprId>> = FxHashMap::default();
        for (key, value) in &written {
            under_keys.entry(key).or_default().push(*value);
        }
        let mut values = Distinct::new();
        for key in keys {
            match under_keys.get(&key[..]) {
                Some(held) => {
                    for value in self.values_of_any(held.iter().copied())? {
                        add(&mut values, value);
                    }
                }
                None if is_member_of_every_object(key) => add(&mut values, Held::Other),
                None => add(&mut values, Held::Primitive(Constant::Undefined)),
            }
        }
        Some(values.all)
    }

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
        if let Some((table, listing)) = self.find_listing_of_object(call) {
            return self.values_of_listing(table, listing);
        }
        if call.chain != Chain::No {
            return None;
        }
        if let Some(module) = self.find_required_module(e) {
            return Some(vec![match is_process_module(module) {
                true => Held::Process,
                false if self.is_os_module(module) => Held::Os,
                false => Held::Data {
                    specifier: module,
                    path: Vec::new(),
                    is_namespace: false,
                },
            }]);
        }
        if let Some((name, form)) = self.find_name_asked_of_resolver(e) {
            return self.values_answered_by_resolver(e, name, form);
        }
        if let Some(values) = self.values_of_walk(call) {
            return Some(values);
        }
        let callee = hir.skip_type_assertions(call.callee);
        if let Some(values) = self.values_of_conversion(callee, call.args) {
            return Some(values);
        }
        if let Some(values) = self.values_of_method_of_text(callee, call.args) {
            return Some(values);
        }
        if let Some(values) = self.values_of_entry_of_map_written_here(callee, call) {
            return Some(values);
        }
        if let Some(function) = self.find_path_joining_function(callee) {
            let takes_one_path = function != known::join && function != known::resolve;
            if takes_one_path && call.args.len() != 1 {
                return None;
            }
            let is_join = function != known::resolve;
            let below_folder = self.values_of_path_below_folder(call.args, is_join);
            return match below_folder {
                None if self.follows_key => self.values_of_path_below_some_folder(call.args),
                below_folder => below_folder,
            };
        }
        if let Some((list, MemberKey::Name(known::join))) = hir.member_key(callee)
            && let Some(lists) = self.values_of(list)
            && lists.iter().all(|value| matches!(value, Held::List(_)))
        {
            return self.values_of_joined_lists(&lists, call.args);
        }
        let mut values = Distinct::new();
        for callee in self.values_of(callee)? {
            let returned = match callee {
                Held::Function(function) => self.values_returned_by(function, Some(call.args))?,
                Held::FunctionOfOs(name) => self.values_returned_by_function_of_os(name)?,
                _ => return None,
            };
            for value in returned {
                add(&mut values, value);
            }
        }
        Some(values.all)
    }

    fn find_name_asked_of_resolver(&self, call: ExprId) -> Option<(ExprId, ResolvedForm)> {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        let form = match call_site_kind(hir, bound, call)? {
            ImportSiteKind::RequireResolve(_) => ResolvedForm::Path,
            ImportSiteKind::ImportMetaResolve(_) => ResolvedForm::Url,
            _ => return None,
        };
        let arguments = call_site_arguments(hir, bound, call)?;
        let names_paths = |options: ExprId| {
            let paths = PropKey::Name(atoms.intern(b"paths"));
            matches!(expr_kind(hir, hir.skip_type_assertions(options)), Some(ExprKind::Object(properties))
                if properties.iter().any(|id| hir[id].key == paths))
        };
        let may_ask_from_own_file = arguments.len() == 1
            || form == ResolvedForm::Path && !names_paths(hir.id_at(arguments, 1));
        (may_ask_from_own_file && self.folder == Folder::OfFile)
            .then(|| (hir.id_at(arguments, 0), form))
    }

    fn values_answered_by_resolver(
        &mut self,
        call: ExprId,
        name: ExprId,
        form: ResolvedForm,
    ) -> Option<Values> {
        let mut values = Distinct::new();
        let joins_urls = form == ResolvedForm::Url && !self.inputs.hir.runs_beside_loader;
        for name in self.values_of(name)? {
            let joined = match &name {
                Held::Text(name)
                    if joins_urls
                        && (name.start.starts_with(b"./") || name.start.starts_with(b"../")) =>
                {
                    name_from_url_of_folder(b"./", name)
                }
                _ => None,
            };
            if let Some(joined) = joined {
                add(
                    &mut values,
                    Held::Text(href_of(&from_own_directory(joined))),
                );
                continue;
            }
            match name {
                Held::Text(name) | Held::Resolved(name, _) | Held::Url(name) => {
                    let known = self.find_where_file_lies(call, &name, form);
                    self.note_call_of_resolver(&name.start, call);
                    add(&mut values, known.unwrap_or(Held::Resolved(name, form)));
                }
                Held::Itself(_) | Held::BelowItself(_) => return None,
                _ => {}
            }
        }
        Some(values.all)
    }

    fn is_os_module(&self, specifier: Atom) -> bool {
        matches!(self.inputs.atoms.bytes(specifier), b"os" | b"node:os")
    }

    fn values_returned_by_function_of_os(&self, name: Atom) -> Option<Values> {
        match self.inputs.atoms.bytes(name) {
            key @ (b"platform" | b"arch") => self.read_member_of_process(&[key.to_vec()]),
            _ => None,
        }
    }

    fn find_path_joining_function(&self, callee: ExprId) -> Option<Atom> {
        let atoms = self.inputs.atoms;
        let joins_paths = |member: &Atom| {
            *member == known::join
                || *member == known::resolve
                || atoms.bytes(*member) == b"normalize"
        };
        self.find_export_of_path(callee).filter(joins_paths)
    }

    fn find_export_of_path(&self, e: ExprId) -> Option<Atom> {
        let &ScanInputs { hir, atoms, .. } = self.inputs;
        let known = Some(&self.written_names.1);
        if let Some(name) = self.find_export_with(e, &PATH_MODULES, known) {
            return Some(name);
        }
        let (object, MemberKey::Name(name)) = hir.member_key(e)? else {
            return None;
        };
        let object = hir.skip_type_assertions(object);
        let object = self.find_export_with(object, &PATH_MODULES, known)?;
        (atoms.bytes(object) == b"posix").then_some(name)
    }

    fn find_export_of(&self, callee: ExprId, names: &[&[u8]]) -> Option<Atom> {
        self.find_export_with(callee, names, None)
    }

    fn find_export_with(
        &self,
        callee: ExprId,
        names: &[&[u8]],
        known: Option<&MembersBehindNames>,
    ) -> Option<Atom> {
        let &ScanInputs {
            hir,
            bound,
            decisions,
            atoms,
            ..
        } = self.inputs;
        let find_constant = |e| match decisions.constant(hir, e) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                Some(constant)
            }
            FoldedValue::Unknown => None,
        };
        let is_module = |specifier: Atom| names.contains(&atoms.bytes(specifier));
        find_export_of_module_with(hir, bound, callee, &find_constant, &is_module, known)
    }

    fn values_of_new_url(&mut self, call: Call) -> Option<Values> {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        let callee = hir.skip_type_assertions(call.callee);
        if !is_free_name(hir, bound, callee, &[atoms.intern(b"URL")]) {
            return None;
        }
        let mut arguments = hir.ids(call.args);
        let (written, base) = (arguments.next()?, arguments.next());
        let is_spread = |e| matches!(expr_kind(hir, e), Some(ExprKind::Spread(_)) | None);
        if is_spread(written) || base.is_some_and(is_spread) {
            return None;
        }
        let written = self
            .values_apart_from_itself(written)
            .unwrap_or_else(some_text);
        let as_object = |name: &Text| Held::Resolved(name.clone(), ResolvedForm::UrlObject);
        let Some(base) = base else {
            let urls = written.iter().map(|value| match value {
                Held::Resolved(name, ResolvedForm::Url | ResolvedForm::UrlObject) => {
                    Some(as_object(name))
                }
                Held::Url(_) => Some(value.clone()),
                Held::Text(text) if !hir.runs_beside_loader => path_in_own_url(text).map(Held::Url),
                _ => None,
            });
            return urls.collect();
        };
        let folders = match self.names_own_url(base) {
            true => vec![(b"./".to_vec(), !hir.runs_beside_loader)],
            false => self.folders_of_urls(base)?,
        };
        self.pay_for_pairs(folders.len(), written.len())?;
        let urls = folders
            .iter()
            .flat_map(|folder| written.iter().map(move |value| (folder, value)));
        let urls = urls.map(|((folder, is_written), value)| match value {
            Held::Text(text) => {
                let name = name_from_url_of_folder(folder, text)?;
                Some(match is_written {
                    true => Held::Url(from_own_directory(name)),
                    false => as_object(&name),
                })
            }
            Held::Url(_) => Some(value.clone()),
            Held::Resolved(name, ResolvedForm::Url | ResolvedForm::UrlObject) => {
                Some(as_object(name))
            }
            _ => None,
        });
        urls.collect()
    }

    fn folders_of_urls(&mut self, base: ExprId) -> Option<Vec<(Vec<u8>, bool)>> {
        let runs_beside_loader = self.inputs.hir.runs_beside_loader;
        let folders = self.values_of(base)?.into_iter().map(|value| {
            let (name, is_written) = match value {
                Held::Resolved(name, ResolvedForm::Url | ResolvedForm::UrlObject) => (name, false),
                Held::Url(name) => (name, true),
                Held::Text(text) if !runs_beside_loader => (path_in_own_url(&text)?, true),
                _ => return None,
            };
            let end = strings::last_index_of_char(&name.start, b'/')?;
            name.end
                .is_none()
                .then(|| (name.start[..=end].to_vec(), is_written))
        });
        match self.keeps_known_alternatives {
            true => Some(folders.flatten().collect()),
            false => folders.collect(),
        }
    }

    fn names_own_url(&self, e: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        names_own_url(hir, bound, e) && self.folder == Folder::OfFile
    }

    fn values_of_method_of_text(&mut self, callee: ExprId, args: IdList<ExprId>) -> Option<Values> {
        let &ScanInputs { hir, atoms, .. } = self.inputs;
        let (object, MemberKey::Name(method)) = hir.member_key(callee)? else {
            return None;
        };
        let method = atoms.bytes(method);
        let is_known = matches!(
            method,
            b"trim"
                | b"trimStart"
                | b"trimEnd"
                | b"toLowerCase"
                | b"toUpperCase"
                | b"concat"
                | b"replace"
                | b"replaceAll"
                | b"slice"
                | b"substring"
        );
        if !is_known {
            return None;
        }
        let texts = self.values_of(object)?;
        if texts.is_empty() || !texts.iter().all(|value| matches!(value, Held::Text(_))) {
            return None;
        }
        let mut given: Vec<Values> = Vec::with_capacity(args.len());
        for argument in hir.ids(args) {
            if matches!(expr_kind(hir, argument), None | Some(ExprKind::Spread(_))) {
                return None;
            }
            given.push(self.values_of(argument)?);
        }
        if method == b"concat" {
            let is_joined = |value: &Held| matches!(value, Held::Text(_) | Held::Primitive(_));
            if !given.iter().flatten().all(is_joined) {
                return None;
            }
            given.insert(0, texts);
            return self.join_parts(&given);
        }
        let mut arguments: Vec<&Held> = Vec::with_capacity(given.len());
        for values in &given {
            let [value] = &values[..] else {
                return None;
            };
            arguments.push(value);
        }
        let mut values = Distinct::new();
        for text in &texts {
            let Held::Text(text) = text else {
                return None;
            };
            if self.folder == Folder::OfCaller && text.start.contains(&STAND_IN[0]) {
                return None;
            }
            if text.starts_at_own_directory {
                add(
                    &mut values,
                    Held::Text(call_method_of_path_below_own_directory(
                        text, method, &arguments,
                    )?),
                );
                continue;
            }
            let made = call_method_of_text(whole_ascii(text)?, method, &arguments)?;
            add(&mut values, Held::Text(Text::whole(&made)));
        }
        Some(values.all)
    }

    fn values_of_conversion(&mut self, callee: ExprId, args: IdList<ExprId>) -> Option<Values> {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        use ResolvedForm::{Path, Url, UrlObject};
        if let Some((object, MemberKey::Name(method))) = hir.member_key(callee)
            && args.len() == 0
            && matches!(atoms.bytes(method), b"toString" | b"toJSON" | b"trim")
        {
            let is_trim = atoms.bytes(method) == b"trim";
            let is_of_text = atoms.bytes(method) != b"toJSON";
            let converted = self
                .values_of(object)?
                .into_iter()
                .map(|value| match value {
                    Held::Resolved(name, UrlObject) if !is_trim => Some(Held::Resolved(name, Url)),
                    Held::Url(name) if !is_trim => Some(Held::Text(href_of(&name))),
                    Held::Resolved(_, Path | Url) if is_of_text => Some(value),
                    Held::Text(ref text) if is_of_text && !is_changed_by_trim(text) => Some(value),
                    _ => None,
                });
            return converted.collect();
        }
        if args.len() != 1 {
            return None;
        }
        let argument = hir.id_at(args, 0);
        if is_free_name(hir, bound, callee, &[known::String]) {
            let values = self.values_of(argument)?;
            let is_text = |value: &Held| matches!(value, Held::Text(_));
            return match values.iter().all(is_text) {
                true => Some(values),
                false => texts_of_answers(&values),
            };
        }
        let of_url = self.find_export_of(callee, &[b"url", b"node:url"]);
        let of_path = || self.find_export_of_path(callee);
        let export = of_url.or_else(of_path)?;
        let is_dirname = of_url.is_none() && export == known::meta_dirname;
        let function = atoms.bytes(export);
        let convert: fn(Held) -> Option<Held> = match (of_url.is_some(), function) {
            (true, b"fileURLToPath") => |value| match value {
                Held::Resolved(name, Url | UrlObject) => Some(Held::Resolved(name, Path)),
                Held::Url(name) => Some(Held::Text(name)),
                Held::Text(text) => path_in_own_url(&text).map(Held::Text),
                _ => None,
            },
            (true, b"pathToFileURL") => |value| match value {
                Held::Resolved(name, Path) => Some(Held::Resolved(name, UrlObject)),
                Held::Text(name) if name.starts_at_own_directory && !name.is_file_url => {
                    Some(Held::Url(name))
                }
                _ => None,
            },
            (false, b"normalize" | b"resolve") => |value| match value {
                Held::Resolved(_, Path) => Some(value),
                _ => None,
            },
            (false, _) if is_dirname && !hir.runs_beside_loader => |value| match value {
                Held::Text(path) => folder_of_path(&path).map(Held::Text),
                _ => None,
            },
            _ => return None,
        };
        let values = self.values_of(argument)?;
        if is_dirname {
            values.iter().for_each(|it| self.ask_where_file_lies(it));
        }
        let converted = values.into_iter().map(convert);
        if !hir.runs_beside_loader {
            return converted.collect();
        }
        let as_answers = converted.map(|value| match value? {
            Held::Url(name) => Some(Held::Resolved(name, UrlObject)),
            Held::Text(_) => None,
            answer => Some(answer),
        });
        as_answers.collect()
    }

    fn values_of_path_below_folder(
        &mut self,
        args: IdList<ExprId>,
        is_join: bool,
    ) -> Option<Values> {
        let mut arguments = self.inputs.hir.ids(args);
        let mut folders = self.values_of(arguments.next()?)?;
        let mut below_themselves = Distinct::new();
        folders.retain(|folder| match *folder {
            Held::Itself(symbol) | Held::BelowItself(symbol) => {
                add(&mut below_themselves, Held::BelowItself(symbol));
                false
            }
            _ => true,
        });
        let own_directory = Text {
            starts_at_own_directory: true,
            ..Text::whole(b".")
        };
        let mut paths: Vec<Vec<Text>> = Vec::with_capacity(folders.len());
        for folder in &folders {
            let Held::Text(folder) = folder else {
                self.ask_where_file_lies(folder);
                return None;
            };
            if !folder.starts_at_own_directory || folder.is_file_url {
                return None;
            }
            paths.push(vec![Text {
                start: match &folder.start[..] {
                    b"." => Vec::new(),
                    start => start.strip_prefix(b"./")?.to_vec(),
                },
                end: folder.end.clone(),
                starts_at_own_directory: false,
                is_file_url: false,
            }]);
        }
        let has_folder = !paths.is_empty();
        if !has_folder {
            paths.push(vec![Text::whole(b"")]);
        }
        for argument in arguments {
            let values = self
                .values_apart_from_itself(argument)
                .unwrap_or_else(some_text);
            self.pay_for_pairs(paths.len(), values.len())?;
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
            paths = longer;
        }
        let steps_back = |texts: &Vec<Text>| texts[1..].iter().any(may_step_back);
        if !below_themselves.is_empty() && paths.iter().any(steps_back) {
            return None;
        }
        if !has_folder {
            return (!below_themselves.is_empty()).then_some(below_themselves.all);
        }
        let mut values = below_themselves;
        for texts in &paths {
            let whole = texts.iter().take_while(|text| text.end.is_none()).count();
            let (whole, rest) = texts.split_at(whole);
            let mut path = PathBelowFolder::default();
            for (index, text) in whole.iter().enumerate() {
                if text.starts_at_own_directory {
                    return None;
                }
                path.push(&text.start, is_join || index == 0)?;
            }
            if self.inputs.hir.runs_beside_loader && !rest.is_empty() && path.leaves_folder() {
                return None;
            }
            let mut joined = own_directory.clone();
            joined.start.extend(path.write(is_join, !rest.is_empty()));
            for (index, text) in rest.iter().enumerate() {
                if text.starts_at_own_directory || index > 0 && may_step_back(text) {
                    return None;
                }
                if index > 0 {
                    joined.push(&Text::whole(b"/"));
                }
                joined.push(text);
            }
            add(&mut values, Held::Text(joined));
        }
        Some(values.all)
    }

    fn values_of_path_below_some_folder(&mut self, args: IdList<ExprId>) -> Option<Values> {
        let last = self.inputs.hir.ids(args).next_back()?;
        let mut values = Distinct::new();
        for part in self.values_apart_from_itself(last)? {
            let Held::Text(part) = part else {
                return None;
            };
            let mut end = part.end.unwrap_or(part.start);
            trim_to_last_segment(&mut end);
            if strings::count_char(&end, b'.') == end.len() {
                end.clear();
            }
            add(
                &mut values,
                Held::Text(Text {
                    start: Vec::new(),
                    end: Some(end),
                    starts_at_own_directory: false,
                    is_file_url: false,
                }),
            );
        }
        Some(values.all)
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
        let mut values = Distinct::new();
        for list in lists {
            let Held::List(places) = list else {
                return None;
            };
            let mut parts: Vec<Values> = Vec::with_capacity(2 * places.len());
            for (index, place) in places.iter().enumerate() {
                if index > 0 {
                    parts.push(separators.clone());
                }
                let mut part = Distinct::new();
                for value in place {
                    match value {
                        Held::Primitive(Constant::Undefined | Constant::Null) => {
                            add(&mut part, empty.clone());
                        }
                        Held::Text(_) | Held::Primitive(_) => add(&mut part, value.clone()),
                        _ => return None,
                    }
                }
                parts.push(part.all);
            }
            for value in self.join_parts(&parts)? {
                add(&mut values, value);
            }
        }
        Some(values.all)
    }

    fn values_returned_by(
        &mut self,
        function: FnId,
        arguments: Option<IdList<ExprId>>,
    ) -> Option<Values> {
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
        let hidden = match arguments {
            Some(_) => Vec::new(),
            None => std::mem::take(&mut self.calls_in_progress),
        };
        let depth = self.calls_in_progress.len();
        (self.calls_in_progress).extend(arguments.map(|arguments| (function, arguments)));
        let values = match hir[function].body {
            FnBody::Expr(value) => self.values_of(value),
            FnBody::Block(_) => {
                let info = bound.fns[function.idx()];
                let mut values = Distinct::new();
                if info.end != UNREACHABLE {
                    add(&mut values, Held::Primitive(Constant::Undefined));
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
                    .map(|()| values.all)
            }
            FnBody::None => None,
        };
        self.functions_in_progress.pop();
        self.calls_in_progress.truncate(depth);
        self.calls_in_progress.extend(hidden);
        values
    }
}

fn texts_of_answers(values: &Values) -> Option<Values> {
    let texts = values.iter().map(|value| match value {
        Held::Resolved(name, ResolvedForm::UrlObject) => {
            Some(Held::Resolved(name.clone(), ResolvedForm::Url))
        }
        Held::Resolved(..) => Some(value.clone()),
        Held::Url(name) => Some(Held::Text(href_of(name))),
        _ => None,
    });
    texts.collect()
}

fn folder_of_path(path: &Text) -> Option<Text> {
    let is_whole_path = path.starts_at_own_directory && !path.is_file_url && path.end.is_none();
    let slash = strings::last_index_of_char(&path.start, b'/')?;
    let is_name = !matches!(&path.start[slash + 1..], b"" | b"." | b"..");
    (is_whole_path && is_name).then(|| Text {
        starts_at_own_directory: true,
        ..Text::whole(&path.start[..slash])
    })
}

pub(super) fn names_own_url(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let e = hir.skip_type_assertions(e);
    matches!(expr_kind(hir, e), Some(ExprKind::Dot { obj, name, chain: Chain::No, .. })
        if name == known::url
            && matches!(expr_kind(hir, hir.skip_type_assertions(obj)), Some(ExprKind::ImportMeta)))
        && !bound.import_meta_may_be_modified()
}

fn caller_url_placeholder() -> Text {
    let path = [b"./", STAND_IN].concat();
    href_of(&from_own_directory(Text::whole(&path)))
}

fn href_of(path: &Text) -> Text {
    Text {
        is_file_url: true,
        ..path.clone()
    }
}

fn path_in_own_url(url: &Text) -> Option<Text> {
    (url.is_file_url && url.starts_at_own_directory).then(|| Text {
        is_file_url: false,
        ..url.clone()
    })
}

fn from_own_directory(mut name: Text) -> Text {
    if name.start.starts_with(b"../") {
        name.start.splice(0..0, *b"./");
    }
    name.starts_at_own_directory = true;
    name
}

fn close_over_itself(symbol: SymbolId, mut values: Values) -> Option<Values> {
    let holds_longer_ones = values.contains(&Held::BelowItself(symbol));
    values.retain(|value| *value != Held::Itself(symbol) && *value != Held::BelowItself(symbol));
    if !holds_longer_ones {
        return Some(values);
    }
    let mut values = Distinct::from(values);
    for index in 0..values.len() {
        let Held::Text(text) = &values[index] else {
            return None;
        };
        let mut below = text.clone();
        below.push(&Text::whole(b"/"));
        below.push(&Text::unknown());
        add(&mut values, Held::Text(below));
    }
    Some(values.all)
}

fn may_step_back(text: &Text) -> bool {
    let mut known = [Some(&text.start), text.end.as_ref()].into_iter().flatten();
    known.any(|part| {
        strings::contains_char(part, b'\\') || strings::split(part, b"/").any(|it| it == b"..")
    })
}

fn whole_ascii(text: &Text) -> Option<&[u8]> {
    let is_whole = text.end.is_none() && !text.starts_at_own_directory;
    (is_whole && text.start.is_ascii()).then_some(&text.start[..])
}

fn call_method_of_text(text: &[u8], method: &[u8], arguments: &[&Held]) -> Option<Vec<u8>> {
    let is_space = |byte: &u8| matches!(byte, b'\t' | b'\n' | 0x0b | 0x0c | b'\r' | b' ');
    let first_kept = || {
        text.iter()
            .position(|byte| !is_space(byte))
            .unwrap_or(text.len())
    };
    let end_of_kept = || {
        text.iter()
            .rposition(|byte| !is_space(byte))
            .map_or(0, |last| last + 1)
    };
    let text_at = |index: usize| match arguments.get(index) {
        Some(Held::Text(text)) => whole_ascii(text),
        _ => None,
    };
    let place_at = |index: usize, left_out: f64| match arguments.get(index) {
        None | Some(Held::Primitive(Constant::Undefined)) => Some(left_out),
        Some(Held::Primitive(Constant::Number(place))) if place.fract() == 0.0 => Some(*place),
        _ => None,
    };
    let length = text.len() as f64;
    match (method, arguments.len()) {
        (b"trim", 0) => Some(text[first_kept().min(end_of_kept())..end_of_kept()].to_vec()),
        (b"trimStart", 0) => Some(text[first_kept()..].to_vec()),
        (b"trimEnd", 0) => Some(text[..end_of_kept()].to_vec()),
        (b"toLowerCase", 0) => Some(text.to_ascii_lowercase()),
        (b"toUpperCase", 0) => Some(text.to_ascii_uppercase()),
        (b"replace" | b"replaceAll", 2) => {
            let replacement = text_at(1)?;
            let pattern = match arguments[0] {
                Held::PlainPattern { letters, is_at_end } if method == b"replace" => {
                    if *is_at_end && !strings::contains_char(replacement, b'$') {
                        return Some(match text.strip_suffix(&letters[..]) {
                            Some(kept) => [kept, replacement].concat(),
                            None => text.to_vec(),
                        });
                    }
                    &letters[..]
                }
                _ => text_at(0)?,
            };
            if pattern.is_empty() || strings::contains_char(replacement, b'$') {
                return None;
            }
            let mut made = Vec::with_capacity(text.len());
            let mut rest = text;
            while let Some(at) = strings::index_of(rest, pattern) {
                made.extend_from_slice(&rest[..at]);
                made.extend_from_slice(replacement);
                rest = &rest[at + pattern.len()..];
                if method == b"replace" {
                    break;
                }
            }
            made.extend_from_slice(rest);
            Some(made)
        }
        (b"slice", 0..=2) => {
            let from_end = |place: f64| match place < 0.0 {
                true => (length + place).max(0.0),
                false => place.min(length),
            };
            let (start, end) = (from_end(place_at(0, 0.0)?), from_end(place_at(1, length)?));
            Some(text[start as usize..end.max(start) as usize].to_vec())
        }
        (b"substring", 0..=2) => {
            let within = |place: f64| place.clamp(0.0, length);
            let (one, other) = (within(place_at(0, 0.0)?), within(place_at(1, length)?));
            Some(text[one.min(other) as usize..one.max(other) as usize].to_vec())
        }
        _ => None,
    }
}

fn call_method_of_path_below_own_directory(
    text: &Text,
    method: &[u8],
    arguments: &[&Held],
) -> Option<Text> {
    let below_folder = text.start.strip_prefix(b".")?;
    if text.end.is_some() || !below_folder.starts_with(b"/") || !below_folder.is_ascii() {
        return None;
    }
    let cuts_end_alone = method == b"slice"
        && matches!(
            arguments,
            [
                Held::Primitive(Constant::Number(start)),
                Held::Primitive(Constant::Number(end))
            ] if *start == 0.0 && *end < 0.0
        );
    if !cuts_end_alone && !matches!(method, b"replace" | b"replaceAll") {
        return None;
    }
    let made = call_method_of_text(below_folder, method, arguments)?;
    if !made.starts_with(b"/") || made == below_folder {
        return None;
    }
    Some(Text {
        start: [b".", &made[..]].concat(),
        ..text.clone()
    })
}

fn find_plain_pattern(pattern: &[u8]) -> Option<Held> {
    let (written, is_at_end) = match pattern.strip_suffix(b"$") {
        Some(written) if !written.ends_with(b"\\") => (written, true),
        _ => (pattern, false),
    };
    let mut letters = Vec::with_capacity(written.len());
    let mut bytes = written.iter().copied();
    while let Some(byte) = bytes.next() {
        match byte {
            b'\\' => match bytes.next()? {
                escaped @ (b'.' | b'/' | b'-') => letters.push(escaped),
                _ => return None,
            },
            b'-' | b'_' => letters.push(byte),
            _ if byte.is_ascii_alphanumeric() => letters.push(byte),
            _ => return None,
        }
    }
    (!letters.is_empty()).then_some(Held::PlainPattern { letters, is_at_end })
}

fn is_changed_by_trim(text: &Text) -> bool {
    let last = text
        .end
        .as_ref()
        .map_or_else(|| text.start.last(), |end| end.last());
    let is_kept = |byte: Option<&u8>| byte.is_some_and(|byte| byte.is_ascii_graphic());
    !is_kept(text.start.first()) || !(is_kept(last) || text.end.as_ref().is_some_and(Vec::is_empty))
}

fn name_from_url_of_folder(folder: &[u8], text: &Text) -> Option<Text> {
    let is_kept = |byte: &u8| {
        byte.is_ascii_alphanumeric()
            || matches!(byte, b'.' | b'/' | b'-' | b'_' | b'~' | b'@' | b'+')
    };
    let mut bytes = text.start.iter().chain(text.end.iter().flatten());
    if text.starts_at_own_directory || text.start.starts_with(b"/") || !bytes.all(is_kept) {
        return None;
    }
    if text.start.is_empty() && folder == b"./" {
        return None;
    }
    let mut name = text.clone();
    let last = name.start.rsplit(|&byte| byte == b'/').next();
    if name.end.is_none() && matches!(last, Some(b"." | b"..")) {
        name.start.push(b'/');
    }
    if folder == b"./" && name.start.starts_with(b"../") {
        return Some(name);
    }
    let below = name.start.strip_prefix(b"./").map(<[u8]>::to_vec);
    name.start = [folder, &below.unwrap_or(name.start)].concat();
    Some(name)
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
    let mut values = Distinct::new();
    let Some(keys) = keys else {
        places
            .iter()
            .flatten()
            .for_each(|it| add(&mut values, it.clone()));
        add(&mut values, Held::Primitive(Constant::Undefined));
        return Some(values.all);
    };
    for key in keys {
        let index = std::str::from_utf8(key).ok()?.parse::<usize>().ok()?;
        match places.get(index) {
            Some(place) => place.iter().for_each(|it| add(&mut values, it.clone())),
            None => add(&mut values, Held::Primitive(Constant::Undefined)),
        }
    }
    Some(values.all)
}

pub(super) fn may_change_or_hand_on_its_object(key: &[u8]) -> bool {
    matches!(
        key,
        b"__defineGetter__"
            | b"__defineSetter__"
            | b"__lookupGetter__"
            | b"__lookupSetter__"
            | b"__proto__"
            | b"constructor"
            | b"toLocaleString"
            | b"toString"
            | b"valueOf"
    )
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

use super::call_sites::{expr_kind, is_free_common_js, is_free_name, is_process};
use super::changed_files::{find_list_iterated_by_read, find_name_resolved_at_run_time};
use super::made_requires::{
    find_imported_export, find_mentions_of, follow_settled_bindings, may_be_modified,
    names_own_file, settled_symbol,
};
use super::parameters::{
    ExportedNames, find_name_of, find_only_name_of, find_parameter_key_path, find_parameter_place,
    find_values_passed_by_call, find_values_passed_for_pattern, find_values_passed_under_name,
    is_exported,
};
use super::touched_exports::{is_only_tested, stands_in_function_with_arguments};
use super::{
    ImportSiteKind, ImportSpecifier, ResolvedForm, ScanInputs, call_site_arguments, call_site_kind,
    write_question_where_file_lies,
};
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingKind, BindingStability, Bound, CommonJsVariable, Decl,
    FnOwner, FunctionFlags, MemberOwner, Parent, PatParent, PrivateNameId, StoreKind, SymbolId,
    UNREACHABLE,
};
use crate::fold::{
    Constant, FoldedValue, MembersBehindNames, Passes, PathBelowFolder, PathEnd, apply_binary,
    apply_template, find_export_of_module_with, outermost_cast, trim_lead_surrogate_at_end,
    trim_to_last_segment, trim_trail_surrogate_at_start,
};
use crate::hir::{
    BinOp, Branches, Call, Chain, ClassId, ExprId, ExprKind, File, Flags, FnBody, FnId, IdList,
    MemberId, MemberKey, MemberKind, NodeData, PatElemId, PatId, PatKind, PropId, PropKey,
    PropKind, StmtId, StmtKind, TextOfOtherFile, UnOp, is_proto_setter,
};
use crate::util::{FxBuild, FxHashMap, FxHashSet, SharedSort};
use bun_core::strings;
use bun_sort_by_number::SortByNumber;
use smallvec::SmallVec;
use std::cell::{Cell, OnceCell, RefCell};
use std::collections::hash_map::Entry;
use std::hash::{BuildHasher, Hash, Hasher};
use std::ops::{Deref, Range};
use std::rc::Rc;

const EXPRESSIONS_FOLLOWED_IN_ANY_FILE: u32 = 4096;
const MOST_TEXTS_MADE: u32 = 4096;
/// How many values of a property are joined onto again. Each store that may be skipped doubles them.
const MOST_VALUES_JOINED: usize = 256;
/// The same of a variable. Every mention of it makes a path of each.
const MOST_VALUES_ASSIGNED: usize = 16;
const MOST_STORES_FOLLOWED: u32 = 1 << 16;
/// How many expressions of one file are followed for what other code passes or makes.
const MOST_PASSED_IN_FILE: u32 = 1 << 16;
const DEEPEST_EXPRESSION: u32 = 64;
const FEW_ENOUGH_TO_COMPARE: usize = 16;

fn most_expressions_followed(hir: &File<'_>) -> u32 {
    let twice_the_file =
        u32::try_from(hir.exprs.len()).map_or(u32::MAX, |all| all.saturating_mul(2));
    twice_the_file.max(EXPRESSIONS_FOLLOWED_IN_ANY_FILE)
}

/// What leans on something in progress is followed again wherever it is met. All that a file may spend in vain on that
/// is linear in the file: each time it has not sufficed, the next argument has a
/// quarter of it.
fn max_revisited_expressions(hir: &File<'_>, run_outs: u32) -> u32 {
    let quartered = most_expressions_followed(hir).checked_shr(run_outs.saturating_mul(2));
    quartered.unwrap_or(0).max(EXPRESSIONS_FOLLOWED_IN_ANY_FILE)
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
    /// Its entries, each a list of a key and a value.
    MapOf(Rc<Vec<Held>>),
    Object(ExprId),
    Function(FnId),
    Process,
    ImportMeta,
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
    Itself(Place),
    BelowItself(Place),
}

impl Held {
    fn can_be_changed(&self) -> bool {
        matches!(
            self,
            Held::List(_) | Held::ListOf(_) | Held::SetOf(_) | Held::MapOf(_) | Held::Object(_)
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
            Held::MapOf(entries) => entries.hash(state),
            Held::Object(literal) => literal.hash(state),
            Held::Function(function) => function.hash(state),
            Held::FunctionOfOs(name) => name.hash(state),
            Held::PlainPattern { letters, is_at_end } => (letters, is_at_end).hash(state),
            Held::Data {
                specifier,
                path,
                is_namespace,
            } => (specifier, path, is_namespace).hash(state),
            Held::Itself(place) | Held::BelowItself(place) => place.hash(state),
            Held::Process | Held::ImportMeta | Held::Os | Held::Other => {}
        }
    }
}

type Values = Vec<Held>;

/// What an `if` tests.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Condition {
    /// The test of this statement.
    Test(StmtId),
    Constant(SymbolId),
    /// A variable of the environment, which this file does not set.
    Environment(Atom),
}

/// The conditions under which something is held, each with its truth.
type Assumptions = SmallVec<[(Condition, bool); 2]>;

fn may_hold_together(left: &Assumptions, right: &Assumptions) -> bool {
    let contradicts =
        |it: &(Condition, bool)| right.iter().any(|other| other.0 == it.0 && other.1 != it.1);
    !left.iter().any(contradicts)
}

fn add_assumptions(to: &mut Assumptions, from: &Assumptions) {
    for &it in from {
        if !to.contains(&it) {
            to.push(it);
        }
    }
}

#[derive(Clone)]
enum PartOfPath {
    Written(ExprId),
    Held(Values),
}

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

impl<T> Distinct<T> {
    fn truncate(&mut self, length: usize) {
        if self.all.len() > length {
            self.all.truncate(length);
            self.places.retain(|_, place| *place < length);
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
    Rc<OnceCell<Vec<(Atom, ExprId)>>>,
    MembersBehindNames,
    OnceCell<Vec<u32>>,
    RefCell<FxHashMap<Atom, Vec<(SymbolId, ExprId)>>>,
    OnceCell<ExportedNames>,
    Cell<u32>,
    /// `Follower::find_overwriting_store`: syntax alone, and a file may mention a variable many times.
    RefCell<FxHashMap<SymbolId, Option<(Parent, u32)>>>,
    OnceCell<MembersByName>,
    /// The second field's, where wrappers of modules are passed.
    MembersBehindNames,
);

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
enum MemberName {
    Public(Atom),
    Private(PrivateNameId),
}

#[derive(Default)]
struct MembersUnderName {
    of_classes: Vec<MemberId>,
    parameter_properties: Vec<(FnId, usize)>,
    /// The members that assignments store to.
    stores: Vec<ExprId>,
    /// The values in object literals, by where the literals stand.
    in_literals: NestedRanges<ExprId>,
}

/// Ranges of the text of which any two stand apart or one within the other.
struct NestedRanges<T>(Vec<(Range<u32>, T, u32)>);

impl<T> Default for NestedRanges<T> {
    fn default() -> NestedRanges<T> {
        NestedRanges(Vec::new())
    }
}

impl<T: Copy> NestedRanges<T> {
    fn new(mut ranges: Vec<(Range<u32>, T)>) -> NestedRanges<T> {
        ranges.shared_sort_unstable_by_key(|it| (it.0.start, std::cmp::Reverse(it.0.end)));
        let mut nested: Vec<(Range<u32>, T, u32)> = Vec::with_capacity(ranges.len());
        let mut open: Vec<u32> = Vec::new();
        for (range, value) in ranges {
            while (open.last()).is_some_and(|&it| nested[it as usize].0.end <= range.start) {
                open.pop();
            }
            let around = open.last().copied().unwrap_or(u32::MAX);
            open.push(nested.len() as u32);
            nested.push((range, value, around));
        }
        NestedRanges(nested)
    }

    /// What stands around `place`, from the innermost outward.
    fn around(&self, place: u32) -> impl Iterator<Item = T> + '_ {
        let last = (self.0.partition_point(|it| it.0.start <= place)).checked_sub(1);
        let outward = std::iter::successors(last, |&it| {
            Some(self.0[it].2 as usize).filter(|&around| around < self.0.len())
        });
        outward
            .filter(move |&it| self.0[it].0.contains(&place))
            .map(|it| self.0[it].1)
    }
}

/// What a file writes under each name of a member, and its calls of `super()`.
#[derive(Default)]
struct MembersByName {
    /// By the family of classes whose instance `this` is there. Without one: another object, or `this` outside of classes.
    by_name: FxHashMap<(MemberName, Option<ClassId>), MembersUnderName>,
    families: FxHashMap<MemberName, Vec<Option<ClassId>>>,
    members_of_classes: NestedRanges<ClassId>,
    /// A family is named by the topmost class of this file that its classes extend.
    families_of_classes: Vec<ClassId>,
    /// `new` may make no instance of these.
    families_with_returning_constructors: FxHashSet<ClassId>,
    /// In the order in which they stand.
    super_calls: Vec<ExprId>,
    /// The class behind each heritage.
    heirs: FxHashMap<ExprId, ClassId>,
    /// `object.name(..)` by the name.
    calls: FxHashMap<Atom, Vec<ExprId>>,
}

impl MembersByName {
    fn under(&mut self, name: MemberName, family: Option<ClassId>) -> &mut MembersUnderName {
        let family = family.filter(|_| matches!(name, MemberName::Public(_)));
        match self.by_name.entry((name, family)) {
            Entry::Occupied(known) => known.into_mut(),
            Entry::Vacant(new) => {
                self.families.entry(name).or_default().push(family);
                new.insert(MembersUnderName::default())
            }
        }
    }

    fn find_family_at(&self, place: u32) -> Option<ClassId> {
        let class = self.members_of_classes.around(place).next()?;
        Some(self.families_of_classes[class.idx()])
    }

    fn find_class_families(hir: &File<'_>, bound: &Bound<'_>) -> Vec<ClassId> {
        let find_extended = |class: ClassId| {
            let heritage = hir.skip_type_assertions(hir[class].extends.some()?);
            find_class_named_by(hir, bound, heritage)
        };
        let mut families: Vec<Option<ClassId>> = vec![None; hir.classes.len()];
        let mut below = Vec::new();
        for class in (0..hir.classes.len() as u32).map(ClassId) {
            let mut top = class;
            let family = loop {
                if let Some(known) = families[top.idx()] {
                    break known;
                }
                // It ends a ring.
                families[top.idx()] = Some(top);
                below.push(top);
                match find_extended(top) {
                    Some(extended) => top = extended,
                    None => break top,
                }
            };
            for class in below.drain(..) {
                families[class.idx()] = Some(family);
            }
        }
        families.into_iter().flatten().collect()
    }

    fn new(hir: &File<'_>, bound: &Bound<'_>) -> MembersByName {
        let mut members = MembersByName {
            families_of_classes: MembersByName::find_class_families(hir, bound),
            ..MembersByName::default()
        };
        let find_member_family = |members: &MembersByName, id: MemberId| match bound.member_owner
            [id.idx()]
        {
            MemberOwner::Class(class) => Some((class, members.families_of_classes[class.idx()])),
            _ => None,
        };
        let mut places = Vec::new();
        for id in (0..hir.members.len() as u32).map(MemberId) {
            let Some((class, family)) = find_member_family(&members, id) else {
                continue;
            };
            if hir[id].flags.contains(Flags::AMBIENT) {
                continue;
            }
            if hir[id].kind == MemberKind::Constructor && returns_value(hir, bound, hir[id].func) {
                members.families_with_returning_constructors.insert(family);
            }
            places.push((hir[id].loc.pos..hir[id].loc.end, class));
            let name = match hir[id].key {
                PropKey::Name(name) => Some(MemberName::Public(name)),
                _ => bound.private_name_of_member(id).map(MemberName::Private),
            };
            if let Some(name) = name {
                members.under(name, Some(family)).of_classes.push(id);
            }
        }
        members.members_of_classes = NestedRanges::new(places);
        for function in (0..hir.fns.len() as u32).map(FnId) {
            for (place, parameter) in hir[function].params.iter().enumerate() {
                let parameter = hir[parameter];
                if parameter.flags.contains(Flags::PARAMETER_PROPERTY)
                    && let PatKind::Ident(name) = hir[parameter.pat].kind
                {
                    let family = match bound.fns[function.idx()].owner {
                        FnOwner::Member(member) => find_member_family(&members, member),
                        _ => None,
                    };
                    let under_name = members.under(MemberName::Public(name), family.map(|it| it.1));
                    under_name.parameter_properties.push((function, place));
                }
            }
        }
        let mut in_literals: FxHashMap<Atom, Vec<(Range<u32>, ExprId)>> = FxHashMap::default();
        for e in (0..hir.exprs.len() as u32).map(ExprId) {
            match hir[e].kind {
                ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    let name = match hir.member_key(e) {
                        Some((_, MemberKey::Name(name))) => Some(MemberName::Public(name)),
                        Some((_, MemberKey::PrivateName(_))) => {
                            bound.private_name_of_reference(e).map(MemberName::Private)
                        }
                        Some((_, MemberKey::Computed(_))) | None => None,
                    };
                    if let Some(name) = name
                        && bound
                            .get_assignment_target(hir, outermost_cast(hir, bound, e))
                            .is_some()
                    {
                        let is_of_this = matches!(hir.member_key(e), Some((object, _))
                            if matches!(hir[hir.skip_type_assertions(object)].kind, ExprKind::This));
                        let family = match is_of_this {
                            true => members.find_family_at(hir[e].pos),
                            false => None,
                        };
                        members.under(name, family).stores.push(e);
                    }
                }
                ExprKind::Object(properties) => {
                    for id in properties.iter() {
                        if matches!(
                            hir[id].kind,
                            PropKind::Init | PropKind::Shorthand | PropKind::Method
                        ) && let PropKey::Name(name) = hir.runtime_property_key(id)
                        {
                            let literal = hir[e].pos..hir[e].end;
                            (in_literals.entry(name).or_default()).push((literal, hir[id].value));
                        }
                    }
                }
                ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Super) => {
                    members.super_calls.push(e);
                }
                ExprKind::Call(call) => {
                    let callee = hir.skip_type_assertions(hir[call].callee);
                    if let Some((_, MemberKey::Name(name))) = hir.member_key(callee) {
                        members.calls.entry(name).or_default().push(e);
                    }
                }
                _ => {}
            }
        }
        let mut in_literals: Vec<_> = in_literals.into_iter().collect();
        in_literals.shared_sort_unstable_by_key(|it| it.0.0);
        for (name, values) in in_literals {
            members.under(MemberName::Public(name), None).in_literals = NestedRanges::new(values);
        }
        (members.super_calls).shared_sort_unstable_by_key(|&it| hir[it].pos);
        for class in (0..hir.classes.len() as u32).map(ClassId) {
            if let Some(heritage) = hir[class].extends.some() {
                members
                    .heirs
                    .insert(hir.skip_type_assertions(heritage), class);
            }
        }
        members
    }
}

fn find_class_named_by(hir: &File<'_>, bound: &Bound<'_>, name: ExprId) -> Option<ClassId> {
    match bound.binding_initializer(hir, settled_symbol(hir, bound, name)?) {
        BindingInitializer::Class(class) => Some(class),
        BindingInitializer::Expression(written) => {
            match hir[hir.skip_type_assertions(written)].kind {
                ExprKind::Class(class) => Some(class),
                _ => None,
            }
        }
        _ => None,
    }
}

fn returns_value(hir: &File<'_>, bound: &Bound<'_>, function: FnId) -> bool {
    let mut returns = bound.ids(bound.fns[function.idx()].returns);
    returns.any(|it| matches!(hir[it].kind, StmtKind::Return(value) if value.some().is_some()))
}

/// In the order of the names, and of the expressions with one name.
fn grouped_by_name(mut written: Vec<(Atom, ExprId)>) -> Vec<(Atom, ExprId)> {
    let name_count = written.iter().map(|it| it.0.0 as usize + 1).max();
    let name_count = name_count.unwrap_or(0);
    if name_count > 4 * written.len() {
        written.sort_by_u32(|it| it.0.0);
        return written;
    }
    let mut next_places = vec![0u32; name_count];
    for (name, _) in &written {
        next_places[name.0 as usize] += 1;
    }
    let mut first_place = 0;
    for next_place in &mut next_places {
        let count = *next_place;
        *next_place = first_place;
        first_place += count;
    }
    let mut grouped = written.clone();
    for entry in written {
        let next_place = &mut next_places[entry.0.0 as usize];
        grouped[*next_place as usize] = entry;
        *next_place += 1;
    }
    grouped
}

impl WrittenNames {
    /// The same names, with nothing found out about them.
    pub(super) fn of_same_file(&self) -> WrittenNames {
        WrittenNames {
            0: Rc::clone(&self.0),
            ..WrittenNames::default()
        }
    }

    fn members(&self, hir: &File<'_>, bound: &Bound<'_>) -> &MembersByName {
        self.7.get_or_init(|| MembersByName::new(hir, bound))
    }

    pub(super) fn exported_names(&self, hir: &File<'_>, bound: &Bound<'_>) -> &ExportedNames {
        self.4.get_or_init(|| ExportedNames::new(hir, bound))
    }

    fn find(&self, hir: &File<'_>, name: Atom) -> &[(Atom, ExprId)] {
        let all = self.0.get_or_init(|| {
            let exprs = (0..).map(ExprId).zip(hir.exprs.iter());
            let written = exprs.filter_map(|(e, written)| match written.kind {
                ExprKind::Ident(name) => Some((name, e)),
                _ => None,
            });
            grouped_by_name(written.collect())
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

/// What may hold a value that is made of its own.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
enum Place {
    Variable(SymbolId),
    /// Of the object literal, under the key.
    Property(ExprId, Atom),
    /// Of the instances of the family, or of the object around the value.
    Field(MemberName, Option<ClassId>, Option<ExprId>),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum FollowedKey {
    Expr(ExprId),
    Symbol(SymbolId),
    Property(ExprId, Atom),
    /// The name of a method, and the place of its argument. `None` for a setter.
    Passed(Atom, Option<u32>),
}

#[derive(Clone)]
struct Followed {
    values: Option<Values>,
    open_parameter: Option<OpenParameter>,
    reads_data_file: bool,
}

/// The shallowest variable and function in progress that an evaluation has met.
#[derive(Copy, Clone)]
struct MetInProgress {
    /// A bit for each of the places in progress, from the outermost. The last one stands for all that are deeper.
    places: u128,
    function: usize,
}

impl MetInProgress {
    const NONE: MetInProgress = MetInProgress {
        places: 0,
        function: usize::MAX,
    };

    const DEEPEST: usize = 127;

    fn meet_place(&mut self, place: usize) {
        self.places |= 1 << place.min(MetInProgress::DEEPEST);
    }

    fn meets_place(&self, place: usize) -> bool {
        self.places >> place.min(MetInProgress::DEEPEST) & 1 == 1
    }

    fn forget_place(&mut self, place: usize) {
        if place < MetInProgress::DEEPEST {
            self.places &= !(1 << place);
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
struct FollowerMode {
    folder: Folder,
    follows_key: bool,
    keeps_known_alternatives: bool,
    skips_reassigned_bindings: bool,
    trusts_import_meta: bool,
    follows_fields: bool,
    reads_other_files: bool,
    reads_own_paths_of_others: bool,
    reads_own_exports: bool,
}

/// What the followers of a file have found out to the end. Each of them adds to it.
#[derive(Default)]
struct Findings {
    followed: FxHashMap<(u32, FollowedKey), Followed>,
    call_contexts: FxHashMap<(u32, FnId, u32, u32), u32>,
    kept_as_written: FxHashSet<SymbolId>,
    not_kept_as_written: FxHashSet<SymbolId>,
    asked_who_takes: FxHashMap<(ExprId, u32), bool>,
    objects_asked_whether_their_functions_see_them:
        FxHashMap<ExprId, Option<Rc<FxHashSet<Vec<u8>>>>>,
    stored_under_keys: FxHashMap<ExprId, Vec<(Vec<u8>, ExprId)>>,
    stores_known: FxHashSet<(ExprId, ExprId)>,
    members_of_objects: FxHashMap<ExprId, MembersOfObject>,
    /// The expressions that were left where following this used them all up.
    ran_out_from: FxHashMap<(u32, FollowedKey), u32>,
    calls_of_resolvers: RefCell<FxHashMap<Vec<u8>, CallsUnderName>>,
    passed_spent: u32,
}

#[derive(Clone)]
struct MembersOfObject {
    by_key: Option<Rc<FxHashMap<Vec<u8>, Vec<ExprId>>>>,
    stores: usize,
}

#[derive(Default)]
pub(super) struct FindingsOfFile(RefCell<FxHashMap<FollowerMode, Findings>>);

struct PlaceInProgress {
    place: Place,
    /// How many questions were open where the place was entered.
    open_questions: usize,
    /// What a mention of a property or a variable in progress holds.
    values: Values,
    /// What was followed and leans on a place in progress, of which this is the innermost.
    followed: Vec<(u32, FollowedKey)>,
}

struct Follower<'i, 'a, 's> {
    inputs: &'i ScanInputs<'a, 's>,
    written_names: &'i WrittenNames,
    data_file_queries: &'i AskedOfDataFiles,
    other_file_queries: Option<&'i AskedOfDataFiles>,
    own_path_queries: Option<&'i AskedOfDataFiles>,
    own_export_queries: Option<&'i AskedOfOwnExports>,
    takes_all_as_written: bool,
    keeps_known_alternatives: bool,
    skips_reassigned_bindings: bool,
    trusts_import_meta: bool,
    follows_fields: bool,
    /// The argument is a list, and what is asked for is what it holds.
    needs_elements: bool,
    has_read_data_file: Cell<bool>,
    findings_of_file: Option<&'i FindingsOfFile>,
    findings: Findings,
    followed: FxHashMap<(u32, FollowedKey), Followed>,
    kept_as_written: FxHashSet<SymbolId>,
    unchecked: Vec<SymbolId>,
    not_kept_since: Vec<SymbolId>,
    stored_since: Vec<(ExprId, ExprId)>,
    met_in_progress: MetInProgress,
    visited: FxHashSet<FollowedKey>,
    revisits_left: u32,
    has_revisited: bool,
    /// What `find_value_by_itself()` has not found. Remembered once something is followed again.
    plain_expressions: FxHashSet<ExprId>,
    /// The same of calls: their callees are names, and only what those hold tells what they return.
    plain_calls: FxHashSet<ExprId>,
    has_run_out: Cell<bool>,
    was_ever_exhausted: Cell<bool>,
    places_in_progress: Vec<PlaceInProgress>,
    stores_left: Cell<u32>,
    /// The expressions that are left for what other code passes or makes.
    passed_left: u32,
    is_following_passed: bool,
    failed_while_passed: FxHashSet<(u32, FollowedKey)>,
    found_while_passed: FxHashMap<ExprId, Option<Values>>,
    followed_while_in_progress: FxHashMap<(u32, FollowedKey), (Followed, u128)>,
    functions_in_progress: Vec<FnId>,
    /// Each was reached from the previous one by evaluating only expressions of that call.
    calls_in_progress: Vec<(FnId, IdList<ExprId>)>,
    expressions_left: Cell<u32>,
    texts_left: Cell<u32>,
    depth: u32,
    follows_key: bool,
    folder: Folder,
    open_parameters: Vec<OpenParameter>,
    stand_in: Option<SymbolId>,
    stand_in_property: Option<Atom>,
    asked_who_takes: FxHashMap<(ExprId, u32), bool>,
    asked_while_open: Vec<(ExprId, u32)>,
    shallowest_being_asked: FxHashMap<ExprId, u32>,
    functions_whose_answers_are_asked: Vec<(FnId, u32)>,
}

#[derive(Default)]
struct CallsUnderName {
    calls: FxHashSet<ExprId>,
    are_asked_for: bool,
}

const STAND_IN: &[u8] = b"\0";

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
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
            own_path_queries: None,
            own_export_queries: None,
            takes_all_as_written: false,
            keeps_known_alternatives: false,
            skips_reassigned_bindings: false,
            trusts_import_meta: false,
            follows_fields: false,
            needs_elements: false,
            has_read_data_file: Cell::new(false),
            findings_of_file: None,
            findings: Findings::default(),
            followed: FxHashMap::default(),
            kept_as_written: FxHashSet::default(),
            unchecked: Vec::new(),
            not_kept_since: Vec::new(),
            stored_since: Vec::new(),
            met_in_progress: MetInProgress::NONE,
            visited: FxHashSet::default(),
            revisits_left: max_revisited_expressions(inputs.hir, written_names.5.get()),
            has_revisited: false,
            plain_expressions: FxHashSet::default(),
            plain_calls: FxHashSet::default(),
            has_run_out: Cell::new(false),
            was_ever_exhausted: Cell::new(false),
            places_in_progress: Vec::new(),
            stores_left: Cell::new(MOST_STORES_FOLLOWED),
            passed_left: EXPRESSIONS_FOLLOWED_IN_ANY_FILE,
            is_following_passed: false,
            failed_while_passed: FxHashSet::default(),
            found_while_passed: FxHashMap::default(),
            followed_while_in_progress: FxHashMap::default(),
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
            asked_who_takes: FxHashMap::default(),
            asked_while_open: Vec::new(),
            shallowest_being_asked: FxHashMap::default(),
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
    findings_of_file: Option<&FindingsOfFile>,
) -> Option<Found> {
    let mut follower = Follower::new(inputs, written_names, data_file_queries, false, folder);
    follower.other_file_queries = other_file_queries;
    follower.own_export_queries = own_export_queries;
    follower.findings_of_file = findings_of_file;
    find_alternatives_with(&mut follower, argument)
}

/// A parameter with no visible caller.
#[derive(Clone, Copy)]
pub(super) struct OpenParameter {
    pub(super) mention: ExprId,
    /// The key that an object pattern reads from it.
    pub(super) destructured_key: Option<Atom>,
}

/// Returns the values of `argument` that can be resolved, and the parameters without a visible caller that blocked the rest.
pub(super) fn find_known_alternatives(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    data_file_queries: &AskedOfDataFiles,
    own_path_queries: &AskedOfDataFiles,
    argument: ExprId,
    findings_of_file: &FindingsOfFile,
) -> (Vec<Found>, Vec<OpenParameter>) {
    let folder = Folder::OfFile;
    let mut follower = Follower::new(inputs, written_names, data_file_queries, false, folder);
    follower.own_path_queries = Some(own_path_queries);
    follower.keeps_known_alternatives = true;
    follower.follows_fields = true;
    follower.findings_of_file = Some(findings_of_file);
    let found = find_alternatives_apart(&mut follower, argument);
    (found, follower.open_parameters)
}

/// Returns the elements of `list` that can be resolved, as the parameter of `list.find(it => ..)` is.
pub(super) fn find_known_elements(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    data_file_queries: &AskedOfDataFiles,
    own_path_queries: &AskedOfDataFiles,
    list: ExprId,
    findings_of_file: &FindingsOfFile,
) -> Option<Found> {
    let folder = Folder::OfFile;
    let mut follower = Follower::new(inputs, written_names, data_file_queries, false, folder);
    follower.own_path_queries = Some(own_path_queries);
    follower.keeps_known_alternatives = true;
    follower.needs_elements = true;
    follower.findings_of_file = Some(findings_of_file);
    find_alternatives_with(&mut follower, list)
}

/// Returns true if the file stores to a member of the URL in `name` that changes which file it names.
pub(super) fn writes_url_path(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    name: ExprId,
) -> bool {
    let &ScanInputs { hir, bound, .. } = inputs;
    let holder = bound.binding(name);
    let &ExprKind::Ident(written) = &hir[name].kind else {
        return false;
    };
    let outermost = |mut e: ExprId| {
        while let Parent::Expr(above) = bound.parent_of_expr(e)
            && hir.type_assertion_operand(above).is_some()
        {
            e = above;
        }
        e
    };
    let mut mentions = written_names.find(hir, written).iter();
    mentions.any(|&(_, mention)| {
        let object = outermost(mention);
        let Parent::Expr(member) = bound.parent_of_expr(object) else {
            return false;
        };
        let keeps_path = match hir.member_key(member) {
            Some((it, MemberKey::Name(name))) => {
                it != object || matches!(name, known::search | known::hash)
            }
            Some((it, _)) => it != object,
            None => true,
        };
        !keeps_path
            && bound.binding(mention) == holder
            && bound
                .get_assignment_target(hir, outermost(member))
                .is_some()
    })
}

/// Returns true if every value of `argument` is a constant, so `find_known_alternatives()` skips none and none has an unknown part.
pub(super) fn is_fully_known(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    data_file_queries: &AskedOfDataFiles,
    argument: ExprId,
    findings_of_file: &FindingsOfFile,
) -> bool {
    let folder = Folder::OfFile;
    let mut follower = Follower::new(inputs, written_names, data_file_queries, false, folder);
    follower.findings_of_file = Some(findings_of_file);
    let is_constant = |it: &ImportSpecifier| matches!(it, ImportSpecifier::Constant(_));
    find_alternatives_with(&mut follower, argument)
        .is_some_and(|found| found.alternatives.iter().all(is_constant))
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum UnknownValues {
    /// One value that can't be resolved leaves no name.
    Reject,
    Skip,
}

/// Returns the names that the `argument` of a Worker can resolve to. They only select files to compile, so code that gets `import.meta` is trusted not to change its paths.
pub(super) fn find_worker_names(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    data_file_queries: &AskedOfDataFiles,
    argument: ExprId,
    unknown_values: UnknownValues,
    findings_of_file: &FindingsOfFile,
) -> Option<Found> {
    let folder = Folder::OfFile;
    let mut follower = Follower::new(inputs, written_names, data_file_queries, false, folder);
    follower.keeps_known_alternatives = unknown_values == UnknownValues::Skip;
    follower.trusts_import_meta = true;
    follower.follows_fields = true;
    follower.findings_of_file = Some(findings_of_file);
    find_alternatives_with(&mut follower, argument)
}

/// Returns the names that `argument` of a load can be resolved to. A binding that is assigned again is not followed: the assignment may replace a default that the load never sees.
pub(super) fn find_known_load_names(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    data_file_queries: &AskedOfDataFiles,
    argument: ExprId,
    findings_of_file: &FindingsOfFile,
) -> Option<Found> {
    let folder = Folder::OfFile;
    let mut follower = Follower::new(inputs, written_names, data_file_queries, false, folder);
    follower.keeps_known_alternatives = true;
    follower.skips_reassigned_bindings = true;
    follower.findings_of_file = Some(findings_of_file);
    find_alternatives_with(&mut follower, argument)
}

/// `mention` names a parameter. What `argument` is where that, or its `property`, holds the `import.meta.url` of the file that calls: the own directory is that file's.
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

/// Methods of a list that hand each element to their callback.
pub(super) fn is_list_walk(name: &[u8]) -> bool {
    matches!(
        name,
        b"forEach"
            | b"map"
            | b"filter"
            | b"find"
            | b"findLast"
            | b"findIndex"
            | b"findLastIndex"
            | b"some"
            | b"every"
    )
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
    let values = follower.values_of_argument(argument)?;
    find_alternatives_among(follower, argument, values)
}

/// What each value is written as, without those that are no path of one kind.
fn find_alternatives_apart(follower: &mut Follower<'_, '_, '_>, argument: ExprId) -> Vec<Found> {
    let values = follower.values_of_argument(argument).unwrap_or_default();
    let apart = values.into_iter();
    apart
        .filter_map(|value| find_alternatives_among(follower, argument, vec![value]))
        .collect()
}

fn find_alternatives_among(
    follower: &Follower<'_, '_, '_>,
    argument: ExprId,
    values: Values,
) -> Option<Found> {
    let inputs = follower.inputs;
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
    fn mode(&self) -> FollowerMode {
        FollowerMode {
            folder: self.folder,
            follows_key: self.follows_key,
            keeps_known_alternatives: self.keeps_known_alternatives,
            skips_reassigned_bindings: self.skips_reassigned_bindings,
            trusts_import_meta: self.trusts_import_meta,
            follows_fields: self.follows_fields,
            reads_other_files: self.other_file_queries.is_some(),
            reads_own_paths_of_others: self.own_path_queries.is_some(),
            reads_own_exports: self.own_export_queries.is_some(),
        }
    }

    fn values_of_argument(&mut self, argument: ExprId) -> Option<Values> {
        let mode = self.mode();
        let findings_of_file = self.findings_of_file;
        if let Some(of_file) = findings_of_file {
            self.findings = of_file.0.borrow_mut().remove(&mode).unwrap_or_default();
        }
        let values = self.values_once_settled(argument);
        let first_left = max_revisited_expressions(self.inputs.hir, self.written_names.5.get());
        let has_visited_again = self.revisits_left != first_left;
        if self.expressions_left.get() == 0 && has_visited_again {
            let run_outs = &self.written_names.5;
            run_outs.set(run_outs.get().saturating_add(1));
        }
        if let Some(of_file) = findings_of_file {
            let findings = std::mem::take(&mut self.findings);
            of_file.0.borrow_mut().insert(mode, findings);
        }
        values
    }

    fn values_once_settled(&mut self, argument: ExprId) -> Option<Values> {
        loop {
            self.passed_left = EXPRESSIONS_FOLLOWED_IN_ANY_FILE;
            self.failed_while_passed.clear();
            self.found_while_passed.clear();
            let values = match self.needs_elements {
                true => self.values_of_elements(argument),
                false => self.values_of(argument),
            };
            let known_before = (self.not_kept_since.len(), self.stored_since.len());
            while let Some(symbol) = self.unchecked.pop() {
                if !self.is_kept_as_written(symbol)
                    && self.findings.not_kept_as_written.insert(symbol)
                {
                    self.not_kept_since.push(symbol);
                }
            }
            let is_settled = (self.not_kept_since.len(), self.stored_since.len()) == known_before;
            if self.was_ever_exhausted.get() {
                self.forget_unsettled();
                // What was taken to be kept as written needs no proof there.
                if is_settled || values.is_none() || self.needs_no_contents_proof() {
                    return values;
                }
                return None;
            }
            if is_settled {
                self.settle();
                return values;
            }
            self.forget_assumptions();
        }
    }

    fn forget_assumptions(&mut self) {
        self.visited.clear();
        self.followed.clear();
        self.kept_as_written.clear();
        self.asked_who_takes.clear();
        self.findings
            .objects_asked_whether_their_functions_see_them
            .clear();
    }

    fn settle(&mut self) {
        let findings = &mut self.findings;
        findings.followed.extend(self.followed.drain());
        (findings.kept_as_written).extend(self.kept_as_written.drain());
        (findings.asked_who_takes).extend(self.asked_who_takes.drain());
        self.not_kept_since.clear();
        self.stored_since.clear();
    }

    fn forget_unsettled(&mut self) {
        self.forget_assumptions();
        for symbol in self.not_kept_since.drain(..) {
            self.findings.not_kept_as_written.remove(&symbol);
        }
        for (literal, value) in self.stored_since.drain(..).rev() {
            self.findings.stores_known.remove(&(literal, value));
            if let Some(stored) = self.findings.stored_under_keys.get_mut(&literal) {
                stored.pop();
            }
            self.findings.members_of_objects.remove(&literal);
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
            let mut calls = self.findings.calls_of_resolvers.borrow_mut();
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
        let mut calls = self.findings.calls_of_resolvers.borrow_mut();
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

    fn note_run_out(&self) {
        self.has_run_out.set(true);
        self.was_ever_exhausted.set(true);
    }

    fn pay_for(&self, made: usize) -> Option<()> {
        let left = u32::try_from(made)
            .ok()
            .and_then(|made| self.texts_left.get().checked_sub(made));
        let Some(left) = left else {
            self.note_run_out();
            return None;
        };
        self.texts_left.set(left);
        Some(())
    }

    fn pay_for_pairs(&self, left: usize, right: usize) -> Option<()> {
        self.pay_for(left.checked_mul(right)? - left.max(right).min(left * right))
    }

    fn values_of(&mut self, e: ExprId) -> Option<Values> {
        let Some(left) = self.expressions_left.get().checked_sub(1) else {
            self.note_run_out();
            return None;
        };
        self.expressions_left.set(left);
        if self.depth == DEEPEST_EXPRESSION {
            self.note_run_out();
            return None;
        }
        self.depth += 1;
        let hir = self.inputs.hir;
        let written = hir.skip_type_assertions(e);
        let values = match expr_kind(hir, written) {
            Some(
                ExprKind::Call(_)
                | ExprKind::New(_)
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::Template { .. }
                | ExprKind::Binary { .. }
                | ExprKind::Cond { .. },
            ) => {
                let context = match self.can_see_calls_in_progress(written) {
                    true => self.call_context(),
                    false => 0,
                };
                let key = (context, FollowedKey::Expr(written));
                self.follow_once(key, written)
            }
            _ => self.values_of_written(written),
        };
        let values = match values {
            None if !self.is_following_passed && self.follows_assignments() => {
                self.values_passed_to(written)
            }
            values => values,
        };
        self.depth -= 1;
        values
    }

    /// What has no values without what is passed. Each expression is tried once.
    fn values_passed_to(&mut self, e: ExprId) -> Option<Values> {
        if let Some(found) = self.found_while_passed.get(&e) {
            return found.clone();
        }
        let values = self.follow_passed(&mut |follower| follower.values_of_written(e));
        let is_itself = |value: &Held| matches!(value, Held::Itself(_) | Held::BelowItself(_));
        let is_apart = values.as_ref().is_none_or(|it| !it.iter().any(is_itself));
        if is_apart && self.calls_in_progress.is_empty() {
            self.found_while_passed.insert(e, values.clone());
        }
        values
    }

    /// Equal for equal lists of calls in progress. 0 for none.
    fn call_context(&mut self) -> u32 {
        let mut context = 0;
        for &(function, arguments) in &self.calls_in_progress {
            let contexts = &mut self.findings.call_contexts;
            let next = contexts.len() as u32 + 1;
            let key = (context, function, arguments.start, arguments.len);
            context = *contexts.entry(key).or_insert(next);
        }
        context
    }

    fn enter_place(&mut self, place: Place, values: Values) {
        let open_questions = self.count_open_questions();
        self.places_in_progress.push(PlaceInProgress {
            place,
            open_questions,
            values,
            followed: Vec::new(),
        });
    }

    fn count_open_questions(&self) -> usize {
        self.asked_while_open.len() + self.functions_whose_answers_are_asked.len()
    }

    fn leave_place(&mut self) {
        let Some(left) = self.places_in_progress.pop() else {
            return;
        };
        for key in left.followed {
            self.followed_while_in_progress.remove(&key);
        }
    }

    /// `met` are the places in progress that the values are made of. While the innermost of them is, they are the same.
    fn keep_while_in_progress(&mut self, key: (u32, FollowedKey), followed: Followed, met: u128) {
        let Some(innermost) = met.checked_ilog2().map(|it| it as usize) else {
            return;
        };
        if innermost < MetInProgress::DEEPEST
            && let Some(place) = self.places_in_progress.get_mut(innermost)
        {
            place.followed.push(key);
            self.followed_while_in_progress.insert(key, (followed, met));
        }
    }

    fn follow_once(&mut self, key: (u32, FollowedKey), mention: ExprId) -> Option<Values> {
        if self.is_following_passed && self.failed_while_passed.contains(&key) {
            return None;
        }
        // What has no values may have some of what is passed.
        let is_final = |it: &&Followed| !self.is_following_passed || it.values.is_some();
        let settled = || self.findings.followed.get(&key);
        if let Some(followed) = (self.followed.get(&key).or_else(settled)).filter(is_final) {
            self.open_parameters.extend(followed.open_parameter);
            if followed.reads_data_file {
                self.has_read_data_file.set(true);
            }
            return followed.values.clone();
        }
        if self.count_open_questions() == 0
            && let Some((followed, met)) = self.followed_while_in_progress.get(&key)
            && (!self.is_following_passed || followed.values.is_some())
        {
            self.open_parameters.extend(followed.open_parameter);
            if followed.reads_data_file {
                self.has_read_data_file.set(true);
            }
            self.met_in_progress.places |= met;
            return followed.values.clone();
        }
        let left_before = self.expressions_left.get();
        let ran_out_from = self.findings.ran_out_from.get(&key);
        if ran_out_from.is_some_and(|&left| left_before <= left) {
            self.expressions_left.set(0);
            self.note_run_out();
            return None;
        }
        if !self.is_following_passed && !self.visited.insert(key.1) {
            let Some(left) = self.revisits_left.checked_sub(1) else {
                self.expressions_left.set(0);
                self.note_run_out();
                return None;
            };
            self.revisits_left = left;
            self.has_revisited = true;
        }
        let opened = self.open_parameters.len();
        let (variables, functions) = (
            self.places_in_progress.len(),
            self.functions_in_progress.len(),
        );
        let met_before = std::mem::replace(&mut self.met_in_progress, MetInProgress::NONE);
        let had_run_out = self.has_run_out.replace(false);
        let did_read_data_file = self.has_read_data_file.replace(false);
        let values = match key.1 {
            FollowedKey::Expr(written) => self.values_of_written(written),
            FollowedKey::Symbol(symbol) => self.values_of_symbol(mention, symbol),
            FollowedKey::Property(literal, key) => self.values_of_property(literal, key),
            FollowedKey::Passed(member, place) => self.values_passed_under_member(member, place),
        };
        let values =
            values.filter(|it| !self.is_following_passed || it.len() <= MOST_VALUES_JOINED);
        let met = self.met_in_progress;
        let met_around = match variables < MetInProgress::DEEPEST {
            true => met.places & ((1 << variables) - 1),
            false => met.places,
        };
        let depends_only_on_itself = met_around == 0 && met.function >= functions;
        // Where nothing needs to be proven, values do not lean on an open question, and what an answer finds stored is followed again.
        let is_asking = !self.needs_no_contents_proof()
            && (!self.asked_while_open.is_empty()
                || !self.functions_whose_answers_are_asked.is_empty());
        if met.function >= functions && !self.has_run_out.get() && !is_asking {
            let followed = Followed {
                values: values.clone(),
                open_parameter: self.open_parameters.get(opened).copied(),
                reads_data_file: self.has_read_data_file.get(),
            };
            match depends_only_on_itself {
                true => {
                    self.followed.insert(key, followed);
                }
                false => self.keep_while_in_progress(key, followed, met_around),
            }
        }
        if depends_only_on_itself && self.expressions_left.get() == 0 && !self.is_following_passed {
            let left = self.findings.ran_out_from.entry(key).or_default();
            *left = left_before.max(*left);
        }
        if self.is_following_passed && values.is_none() {
            self.failed_while_passed.insert(key);
        }
        self.met_in_progress = MetInProgress {
            places: met_before.places | met_around,
            function: met_before.function.min(met.function),
        };
        self.has_run_out.set(had_run_out || self.has_run_out.get());
        self.has_read_data_file
            .set(did_read_data_file || self.has_read_data_file.get());
        values
    }

    /// What `e` holds wherever it stands.
    fn find_value_by_itself(&self, e: ExprId) -> Option<Held> {
        let &ScanInputs {
            hir,
            bound,
            decisions,
            ..
        } = self.inputs;
        match decisions.constant(hir, e) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                return Some(self.held_constant(constant));
            }
            FoldedValue::Unknown => {}
        }
        if self.names_own_directory(e) {
            return Some(Held::Text(Text {
                starts_at_own_directory: true,
                ..Text::whole(b".")
            }));
        }
        if let Some(own_file) = self.find_own_file(e) {
            return Some(Held::Text(own_file));
        }
        if is_process(hir, bound, e, &[known::globalThis, known::global]) {
            return Some(Held::Process);
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
        if may_be_export && self.names_path_separator(e) {
            return Some(Held::Text(Text::whole(b"/")));
        }
        ((self.follows_key || self.trusts_import_meta)
            && is_free_name(hir, bound, e, &[known::undefined]))
        .then_some(Held::Primitive(Constant::Undefined))
    }

    fn values_of_written(&mut self, e: ExprId) -> Option<Values> {
        let hir = self.inputs.hir;
        let e = hir.skip_type_assertions(e);
        if !self.plain_expressions.contains(&e) {
            if let Some(value) = self.find_value_by_itself(e) {
                return Some(vec![value]);
            }
            if self.has_revisited {
                self.plain_expressions.insert(e);
            }
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
        // Asking finds what is stored there, also where no proof is needed.
        let is_as_written = self.takes_all_as_written
            || self.is_following_passed
            || (0..layers).all(|below| self.asks_who_takes(e, below))
            || self.needs_no_contents_proof();
        is_as_written.then_some(values)
    }

    /// What an object is given later is one more alternative, and those that can't be resolved are left out.
    fn needs_no_contents_proof(&self) -> bool {
        self.takes_all_as_written || (self.follows_fields && self.keeps_known_alternatives)
    }

    /// Returns false if `e` may hold what an earlier call stored: a variable, a property, an element, a closure.
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

    /// The arguments of the innermost call in progress, where `name` mentions a parameter of the called function that is never assigned.
    fn find_arguments_in_progress(&self, name: ExprId) -> Option<IdList<ExprId>> {
        let bound = self.inputs.bound;
        let &(called, arguments) = self.calls_in_progress.last()?;
        let Binding::Symbol(parameter) = bound.binding(name) else {
            return None;
        };
        let function = match self.find_followed_parameter(name) {
            Some((function, ..)) => function,
            None => self.find_rest_parameter(name)?.0,
        };
        let is_followed = bound.is_stable_binding(parameter) || self.is_following_passed;
        (function == called && is_followed).then_some(arguments)
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
            ExprKind::New(call) if self.is_construction_of_set(hir[call]) => {
                self.values_of_new_set(hir[call])
            }
            ExprKind::New(call) if self.is_map_construction(hir[call]) => {
                self.values_of_new_map(hir[call])
            }
            ExprKind::New(call) => self.values_of_new_url(hir[call]),
            ExprKind::Array(items) => self.values_of_list(items),
            ExprKind::Object(_) => Some(vec![Held::Object(e)]),
            ExprKind::Fn(function) => Some(vec![Held::Function(function)]),
            ExprKind::ImportMeta if self.trusts_import_meta && self.folder == Folder::OfFile => {
                Some(vec![Held::ImportMeta])
            }
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
            if self.is_following_passed && values.len() > MOST_VALUES_JOINED {
                return None;
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
                && (names_own_file(hir, bound, hir.id_at(call.args, 0))
                    || self.names_own_module_by(hir.id_at(call.args, 0), known::meta_filename));
        }
        if self.names_own_module_by(e, known::path) {
            return true;
        }
        matches!(expr_kind(hir, e), Some(ExprKind::Dot { obj, name, chain: Chain::No, .. })
            if (name == known::meta_dir || name == known::meta_dirname)
                && matches!(expr_kind(hir, hir.skip_type_assertions(obj)), Some(ExprKind::ImportMeta)))
            && !self.import_meta_may_be_modified()
    }

    fn import_meta_may_be_modified(&self) -> bool {
        !self.trusts_import_meta && self.inputs.bound.import_meta_may_be_modified()
    }

    fn spell_own_file(&self) -> Option<Vec<u8>> {
        let own_name = self.inputs.file.own_name;
        let is_kept =
            |byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_');
        let is_plain = !own_name.is_empty() && own_name.iter().all(is_kept);
        (is_plain && self.folder == Folder::OfFile).then(|| [b"./", own_name].concat())
    }

    /// `module.filename` and `module.path`, unless what they are is to be proven.
    fn names_own_module_by(&self, e: ExprId, property: Atom) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        self.needs_no_contents_proof()
            && self.folder == Folder::OfFile
            && matches!(expr_kind(hir, hir.skip_type_assertions(e)), Some(ExprKind::Dot { obj, name, chain: Chain::No, .. })
                if name == property
                    && is_free_common_js(hir, bound, hir.skip_type_assertions(obj), CommonJsVariable::Module))
            && !may_be_modified(hir, bound, CommonJsVariable::Module)
    }

    fn find_own_file(&self, e: ExprId) -> Option<Text> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let is_file_url = if is_free_common_js(hir, bound, e, CommonJsVariable::Filename) {
            if may_be_modified(hir, bound, CommonJsVariable::Filename) {
                return None;
            }
            false
        } else if self.names_own_module_by(e, known::meta_filename) {
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
            if !is_of_import_meta || !is_own_file || self.import_meta_may_be_modified() {
                return None;
            }
            name == known::url
        };
        Some(Text {
            starts_at_own_directory: true,
            is_file_url,
            ..Text::whole(&self.spell_own_file()?)
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

    /// Maps are followed only where nothing needs to be proven.
    fn is_map_construction(&self, call: Call) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let callee = hir.skip_type_assertions(call.callee);
        self.is_following_passed && is_free_name(hir, bound, callee, &[known::Map])
    }

    fn values_of_new_map(&mut self, call: Call) -> Option<Values> {
        let mut arguments = self.inputs.hir.ids(call.args);
        let entries = match (arguments.next(), arguments.next()) {
            (None, _) => Values::new(),
            (Some(list), None) => self.values_of_elements(list).unwrap_or_default(),
            _ => return None,
        };
        let is_entry = |it: &Held| matches!(it, Held::List(places) if places.len() == 2);
        let entries: Vec<Held> = entries.into_iter().filter(is_entry).collect();
        Some(vec![Held::MapOf(Rc::new(entries))])
    }

    fn add_entries_set(&mut self, symbol: SymbolId, values: Values) -> Values {
        if !values.iter().any(|it| matches!(it, Held::MapOf(_))) {
            return values;
        }
        let mut follow = |follower: &mut Self| Some(follower.entries_after_sets(symbol, &values));
        self.follow_passed(&mut follow).unwrap_or(values)
    }

    /// `map.set(key, value)`
    fn entries_after_sets(&mut self, symbol: SymbolId, values: &Values) -> Values {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let mut entries = Distinct::new();
        for value in values {
            if let Held::MapOf(held) = value {
                held.iter().for_each(|it| add(&mut entries, it.clone()));
            }
        }
        for mention in self.mentions_of(symbol) {
            let Parent::Expr(member) = bound.parent_of_expr(mention) else {
                continue;
            };
            let Some((object, MemberKey::Name(known::set))) = hir.member_key(member) else {
                continue;
            };
            let Some((_, call)) = self.find_call_of_member(member) else {
                continue;
            };
            let mut arguments = hir.ids(call.args);
            if let (true, Some(key), Some(value), None) = (
                object == mention,
                arguments.next(),
                arguments.next(),
                arguments.next(),
            ) {
                let key = self.values_apart_from_itself(key).unwrap_or_default();
                let value = self.values_apart_from_itself(value).unwrap_or_default();
                add(&mut entries, Held::List(vec![key, value]));
            }
        }
        vec![Held::MapOf(Rc::new(entries.all))]
    }

    /// What `map.get(key)`, `map.values()`, `map.keys()` and `map.entries()` return.
    fn values_of_map_method(&mut self, callee: ExprId, args: IdList<ExprId>) -> Option<Values> {
        let &ScanInputs { hir, atoms, .. } = self.inputs;
        let (map, MemberKey::Name(method)) = hir.member_key(callee)? else {
            return None;
        };
        let listing = atoms.bytes(method);
        let is_known = match method {
            known::get => args.len() == 1,
            _ => matches!(listing, b"values" | b"keys" | b"entries") && args.len() == 0,
        };
        if !self.is_following_passed || !is_known {
            return None;
        }
        let maps = self.values_of(map)?;
        let mut entries: Vec<(&Vec<Held>, &Vec<Held>)> = Vec::new();
        for map in &maps {
            let Held::MapOf(held) = map else {
                return None;
            };
            entries.extend(held.iter().filter_map(|entry| match entry {
                Held::List(places) => Some((&places[0], &places[1])),
                _ => None,
            }));
        }
        let mut values = Distinct::new();
        if method == known::get {
            let asked = self.values_apart_from_itself(hir.id_at(args, 0));
            let asked = asked.unwrap_or_else(some_text);
            let is_whole = |it: &Held| match it {
                Held::Text(text) => whole_ascii(text).is_some(),
                _ => matches!(it, Held::Primitive(_)),
            };
            let are_whole = asked.iter().all(is_whole);
            for (keys, held) in entries {
                if !are_whole || keys.iter().any(|it| !is_whole(it) || asked.contains(it)) {
                    held.iter().for_each(|it| add(&mut values, it.clone()));
                }
            }
            return Some(values.all);
        }
        for (keys, held) in entries {
            match listing {
                b"entries" => add(&mut values, Held::List(vec![keys.clone(), held.clone()])),
                b"keys" => keys.iter().for_each(|it| add(&mut values, it.clone())),
                _ => held.iter().for_each(|it| add(&mut values, it.clone())),
            }
        }
        Some(vec![Held::ListOf(values.all)])
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

    fn outermost_cast(&self, e: ExprId) -> ExprId {
        outermost_cast(self.inputs.hir, self.inputs.bound, e)
    }

    fn values_of_name(&mut self, name: ExprId) -> Option<Values> {
        let bound = self.inputs.bound;
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
        let mut in_progress = self.places_in_progress.iter();
        if let Some(place) = in_progress.position(|it| it.place == Place::Variable(symbol)) {
            self.met_in_progress.meet_place(place);
            return Some(match &self.places_in_progress[place].values[..] {
                [] => vec![Held::Itself(Place::Variable(symbol))],
                held => held.to_vec(),
            });
        }
        let context = match self.find_arguments_in_progress(name) {
            Some(_) => self.call_context(),
            None => 0,
        };
        let key = (context, FollowedKey::Symbol(symbol));
        self.follow_once(key, name)
    }

    fn values_of_symbol(&mut self, name: ExprId, symbol: SymbolId) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        if bound.binding_kind(symbol) == BindingKind::Parameter
            && !bound.stores_to(symbol).is_empty()
            && !self.is_following_passed
            && let Some(values) =
                self.follow_passed(&mut |follower| follower.values_of_symbol(name, symbol))
        {
            return Some(values);
        }
        self.enter_place(Place::Variable(symbol), Values::new());
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
                let place = self.find_followed_parameter(name);
                let passed = arguments.and_then(|arguments| {
                    find_values_passed_by_call(hir, place.clone()?, arguments)
                });
                // An argument is evaluated by the caller.
                let is_passed_by_call = passed.is_some()
                    || arguments.is_some() && self.find_rest_parameter(name).is_some();
                let kept = match is_passed_by_call {
                    true => self.calls_in_progress.len() - 1,
                    false => 0,
                };
                let calls = self.calls_in_progress.split_off(kept);
                let passed = passed.or_else(|| {
                    find_values_passed_for_pattern(
                        hir,
                        bound,
                        decisions,
                        place.clone()?,
                        &find_written,
                        false,
                    )
                });
                let is_open = passed.is_none();
                let is_assigned = place.is_some() && !bound.stores_to(symbol).is_empty();
                let passed = passed.or_else(|| {
                    let (function, index, path) = place.clone()?;
                    if !self.is_following_passed {
                        return None;
                    }
                    let name = find_name_of(hir, bound, function, &find_written)?;
                    let passed = self.find_known_values_passed(name, index);
                    (!passed.is_empty()).then_some((passed, path, false))
                });
                if is_open && passed.is_some() {
                    self.open_parameters.push(OpenParameter {
                        mention: name,
                        destructured_key: None,
                    });
                }
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
                        let handed = handed
                            .or_else(|| self.values_passed_to_constructor(name))
                            .or_else(|| self.values_of_defaulted_property(symbol))
                            .or_else(|| self.values_passed_to_member(name))
                            .or_else(|| {
                                let rest = self.find_rest_parameter(name)?;
                                self.values_of_rest_parameter(rest, arguments)
                            });
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
                match place {
                    Some((function, ..)) if is_assigned => {
                        let runs_once = |follower: &Self, e: ExprId| {
                            follower.find_holder_without_loop(e) == Some(Parent::FnBody(function))
                        };
                        let values = values.unwrap_or_default();
                        let all = self.values_after_assignments(symbol, values, None, &runs_once);
                        (!all.is_empty()).then_some(all)
                    }
                    _ => values,
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
        let values = match self.values_of_default(symbol) {
            Some(defaults) => {
                let mut all = Distinct::from(values.unwrap_or_default());
                defaults.into_iter().for_each(|it| add(&mut all, it));
                Some(all.all)
            }
            None => values,
        };
        self.leave_place();
        let values = close_over_itself(Place::Variable(symbol), values?)?;
        let is_as_written = self.takes_all_as_written
            || self.is_following_passed
            || !values.iter().any(Held::can_be_changed)
            || self.take_as_kept_as_written(symbol)
            || self.needs_no_contents_proof();
        is_as_written.then_some(values)
    }

    /// Follows what other code passes or makes, which leads anywhere in a large file. It has expressions of its own, and running out of them leaves the rest as it is.
    fn follow_passed(
        &mut self,
        follow: &mut dyn FnMut(&mut Self) -> Option<Values>,
    ) -> Option<Values> {
        if self.is_following_passed {
            return follow(self);
        }
        let left = self.expressions_left.get();
        let left_in_file = MOST_PASSED_IN_FILE.saturating_sub(self.findings.passed_spent);
        let granted = left.min(self.passed_left).min(left_in_file);
        if !self.follows_assignments() || granted == 0 {
            return None;
        }
        let (texts_left, stores_left) = (self.texts_left.get(), self.stores_left.get());
        let revisits_left = self.revisits_left;
        let had_run_out = (self.has_run_out.get(), self.was_ever_exhausted.get());
        let opened = self.open_parameters.len();
        self.is_following_passed = true;
        self.expressions_left.set(granted);
        let values = follow(self);
        // Who passes those is not asked for in turn.
        self.open_parameters.truncate(opened);
        let spent = granted - self.expressions_left.get();
        self.is_following_passed = false;
        self.passed_left -= spent;
        self.findings.passed_spent += spent;
        self.expressions_left.set(left - spent);
        self.texts_left.set(texts_left);
        self.stores_left.set(stores_left);
        self.revisits_left = revisits_left;
        self.has_run_out.set(had_run_out.0);
        self.was_ever_exhausted.set(had_run_out.1);
        values
    }

    /// What calls of the function `name` in this file pass at `index`. Others may call it too.
    fn find_known_values_passed(&self, name: SymbolId, index: usize) -> SmallVec<[ExprId; 4]> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let mut values = SmallVec::new();
        if name.is_none() || bound.is_visible_to_eval(name) {
            return values;
        }
        let is_spread = |it: ExprId| matches!(hir[it].kind, ExprKind::Spread(_));
        for mention in self.mentions_of(name) {
            if values.len() > MOST_VALUES_JOINED {
                return SmallVec::new();
            }
            if let Parent::Expr(above) = bound.parent_of_expr(mention)
                && let ExprKind::Call(call) | ExprKind::New(call) = hir[above].kind
                && hir[call].callee == mention
            {
                let mut passed = hir.ids(hir[call].args).take(index + 1);
                // `find_caller_relative_reads()` follows what is passed the own URL.
                let passed = match passed.clone().any(is_spread) {
                    true => None,
                    false => passed.nth(index),
                };
                values
                    .extend(passed.filter(|&it| !self.names_own_url(hir.skip_type_assertions(it))));
            }
        }
        values
    }

    /// The parameter that `name` mentions. One that is assigned is followed only where nothing needs to be proven.
    fn find_followed_parameter(&self, name: ExprId) -> Option<(FnId, usize, SmallVec<[Atom; 2]>)> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        match self.is_following_passed {
            true => find_parameter_place(hir, bound, name),
            false => find_parameter_key_path(hir, bound, name),
        }
    }

    /// The rest parameter that `name` mentions: its function and place.
    fn find_rest_parameter(&self, name: ExprId) -> Option<(FnId, usize)> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let Binding::Symbol(parameter) = bound.binding(name) else {
            return None;
        };
        let &[Decl::Param(pattern)] = bound.symbol(parameter).decls else {
            return None;
        };
        let PatParent::Param(id) = bound.pat_parent[pattern.idx()] else {
            return None;
        };
        let is_kept = self.is_following_passed
            && hir[id].flags.contains(Flags::REST)
            && bound.stores_to(parameter).is_empty()
            && !bound.is_visible_to_eval(parameter);
        let function = bound.param_fn[id.idx()];
        let place = hir[function].params.iter().position(|it| it == id)?;
        is_kept.then_some((function, place))
    }

    /// The lists that the rest parameter at `place` of `function` holds: that of the call with `arguments`, or one for each call by the only name of `function`.
    fn values_of_rest_parameter(
        &mut self,
        (function, place): (FnId, usize),
        arguments: Option<IdList<ExprId>>,
    ) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let written_names = self.written_names;
        let find_written = |name: Atom| written_names.find_expressions(hir, name);
        let mut calls: Vec<IdList<ExprId>> = arguments.into_iter().collect();
        if arguments.is_none() {
            match find_only_name_of(hir, bound, function, &find_written, true) {
                Some(name) => {
                    for mention in self.mentions_of(name) {
                        calls.extend(self.find_call_of_member(mention).map(|it| it.1.args));
                    }
                }
                None => {
                    let find = super::parameters::find_arguments_where_written;
                    calls.extend(find(hir, bound, function, &find_written));
                }
            }
        }
        let mut lists = Distinct::new();
        for call in calls {
            let mut places: Vec<Values> = Vec::new();
            for argument in hir.ids(call).skip(place) {
                if matches!(hir[argument].kind, ExprKind::Spread(_)) {
                    return None;
                }
                places.push(self.values_of(argument).unwrap_or_else(some_text));
            }
            add(&mut lists, Held::List(places));
        }
        (!lists.is_empty()).then_some(lists.all)
    }

    /// Names of files that are read, and no names of what is loaded or started.
    fn follows_assignments(&self) -> bool {
        self.keeps_known_alternatives
            && self.follows_fields
            && !self.takes_all_as_written
            && !self.trusts_import_meta
            && !self.skips_reassigned_bindings
    }

    /// What `symbol` holds, which held `values` first. An assignment may be made of what it held: `name = path.join(folder, name)`. `overwriting` is that of `find_overwriting_store()`.
    fn values_after_assignments(
        &mut self,
        symbol: SymbolId,
        values: Values,
        overwriting: Option<(Parent, u32)>,
        runs_once: &dyn Fn(&Self, ExprId) -> bool,
    ) -> Values {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let place = Place::Variable(symbol);
        let index = self.places_in_progress.len() - 1;
        let mut stores: Vec<(ExprId, ExprId)> = Vec::new();
        for store in bound.stores_to(symbol) {
            let is_plain = matches!(
                store.kind,
                StoreKind::Assign
                    | StoreKind::CompoundAssign(BinOp::Or | BinOp::And | BinOp::Nullish)
            );
            if is_plain
                && !self.is_dead(store.target)
                && let Parent::Expr(assignment) =
                    bound.parent_of_expr(self.outermost_cast(store.target))
                && let Some(ExprKind::Assign { value, .. }) = expr_kind(hir, assignment)
            {
                stores.push((assignment, value));
            }
        }
        stores.shared_sort_unstable_by_key(|it| hir[it.0].pos);
        let mut all = Distinct::from(values);
        for (assignment, value) in stores {
            let met_before = std::mem::replace(&mut self.met_in_progress, MetInProgress::NONE);
            let mut stored = self.values_of_alternative(value).unwrap_or_default();
            let met = self.met_in_progress;
            self.met_in_progress = MetInProgress {
                places: met_before.places | met.places,
                function: met_before.function.min(met.function),
            };
            if met.meets_place(index)
                && all.len() <= MOST_VALUES_ASSIGNED
                && runs_once(self, assignment)
            {
                self.leave_place();
                if let Some(values) = self.values_stored(place, value, all.to_vec()) {
                    stored = values;
                }
                self.enter_place(place, Values::new());
            }
            let overwrites = overwriting.is_some_and(|(list, start)| {
                matches!(bound.parent_of_expr(assignment), Parent::Stmt(statement)
                    if bound.parent_of_stmt(statement) == list && hir[statement].start <= start)
            });
            if overwrites {
                all = Distinct::new();
            }
            stored.into_iter().for_each(|it| add(&mut all, it));
        }
        all.all
    }

    /// The name by which an object's `function` is called, and whether it is a setter.
    fn find_member_name_of(&self, function: FnId) -> Option<(Atom, bool)> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        match bound.fns[function.idx()].owner {
            FnOwner::Member(member) => match (hir[member].kind, hir[member].key) {
                (MemberKind::Method, PropKey::Name(name)) => Some((name, false)),
                (MemberKind::Setter, PropKey::Name(name)) => Some((name, true)),
                _ => None,
            },
            FnOwner::Expr(written) => match bound.parent_of_expr(self.outermost_cast(written)) {
                Parent::Prop(id) => match (hir[id].kind, hir.runtime_property_key(id)) {
                    (PropKind::Init | PropKind::Method, PropKey::Name(name)) => Some((name, false)),
                    (PropKind::Setter, PropKey::Name(name)) => Some((name, true)),
                    _ => None,
                },
                Parent::Expr(assignment) => match hir[assignment].kind {
                    ExprKind::Assign {
                        op: None, target, ..
                    } => match hir.member_key(hir.skip_type_assertions(target))? {
                        (_, MemberKey::Name(name)) => Some((name, false)),
                        _ => None,
                    },
                    _ => None,
                },
                Parent::MemberInit(member) => match hir[member].key {
                    PropKey::Name(name) => Some((name, false)),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        }
    }

    /// Returns what this file passes for the parameter `name` of a method, or stores through a setter. Every object's member of that name may be the one.
    fn values_passed_to_member(&mut self, name: ExprId) -> Option<Values> {
        if !self.is_following_passed {
            return None;
        }
        let (function, place, path) = self.find_followed_parameter(name)?;
        let (member, is_setter) = self.find_member_name_of(function)?;
        let place = match is_setter {
            true => None,
            false => Some(u32::try_from(place).ok()?),
        };
        let calls = std::mem::take(&mut self.calls_in_progress);
        let passed = self.follow_once((0, FollowedKey::Passed(member, place)), name);
        self.calls_in_progress = calls;
        let mut held = passed?;
        for &key in &path {
            let key = self.inputs.atoms.bytes(key).to_vec();
            held = self.read_member(&held, Some(&[key]), Chain::No)?;
        }
        Some(held)
    }

    /// What this file passes at `place` to members called `member`, or stores to them.
    fn values_passed_under_member(&mut self, member: Atom, place: Option<u32>) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let members = self.written_names.members(hir, bound);
        let mut passed: Vec<ExprId> = Vec::new();
        let is_enough = |passed: &Vec<ExprId>| passed.len() > MOST_VALUES_JOINED;
        if place.is_none() {
            let families = members.families.get(&MemberName::Public(member));
            let under_names = families
                .into_iter()
                .flatten()
                .filter_map(|&family| (members.by_name).get(&(MemberName::Public(member), family)));
            for &store in under_names.flat_map(|it| &it.stores) {
                if let Parent::Expr(assignment) = bound.parent_of_expr(self.outermost_cast(store))
                    && let ExprKind::Assign { value, .. } = hir[assignment].kind
                {
                    passed.push(value);
                }
            }
        }
        if let Some(place) = place.map(|it| it as usize) {
            let is_spread = |it: ExprId| matches!(hir[it].kind, ExprKind::Spread(_));
            for &call in members.calls.get(&member).into_iter().flatten() {
                if is_enough(&passed) {
                    return None;
                }
                if let ExprKind::Call(written) = hir[call].kind
                    && !self.is_dead(call)
                {
                    let mut arguments = hir.ids(hir[written].args).take(place + 1);
                    if !arguments.clone().any(is_spread) {
                        passed.extend(arguments.nth(place));
                    }
                }
            }
        }
        let mut values = Distinct::new();
        for argument in passed {
            let held = self.values_of_alternative(argument).unwrap_or_default();
            held.into_iter().for_each(|it| add(&mut values, it));
        }
        (!values.is_empty()).then_some(values.all)
    }

    /// Returns the default values of `symbol`, if its other values may stay unknown.
    fn values_of_default(&mut self, symbol: SymbolId) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        if !self.keeps_known_alternatives || !self.follows_fields {
            return None;
        }
        let &[Decl::Var(pattern) | Decl::Param(pattern)] = bound.symbol(symbol).decls else {
            return None;
        };
        let default = match bound.pat_parent[pattern.idx()] {
            PatParent::Param(parameter) => hir[parameter].default,
            PatParent::Prop(_, property) => hir[property].default,
            PatParent::Elem(_, element) => hir[element].default,
            PatParent::Var(_) | PatParent::None => return None,
        };
        self.values_of(default.some()?)
    }

    /// Returns what `key` in `function f({ key = default })` holds, if this file shows every call of `f`.
    fn values_of_defaulted_property(&mut self, symbol: SymbolId) -> Option<Values> {
        let &ScanInputs {
            hir,
            bound,
            decisions,
            atoms,
            ..
        } = self.inputs;
        let &[Decl::Param(pattern)] = bound.symbol(symbol).decls else {
            return None;
        };
        let is_kept = self.trusts_import_meta
            && bound.stores_to(symbol).is_empty()
            && !bound.is_visible_to_eval(symbol);
        let PatParent::Prop(object, property) = bound.pat_parent[pattern.idx()] else {
            return None;
        };
        let (PatParent::Param(parameter), PropKey::Name(key), Some(default)) = (
            bound.pat_parent[object.idx()],
            hir.runtime_binding_key(property),
            hir[property].default.some(),
        ) else {
            return None;
        };
        if !is_kept || hir[parameter].flags.contains(Flags::REST) {
            return None;
        }
        let function = bound.param_fn[parameter.idx()];
        let mut parameters = hir[function].params.iter();
        let place = (function, parameters.position(|it| it == parameter)?);
        let written_names = self.written_names;
        let find_written = |name: Atom| written_names.find_expressions(hir, name);
        let name = find_only_name_of(hir, bound, function, &find_written, false)?;
        let (passed, _) =
            find_values_passed_under_name(hir, bound, decisions, place, name, &find_written)?;
        let objects = self.values_of_any(passed)?;
        let key = atoms.bytes(key).to_vec();
        let held = self.read_member(&objects, Some(&[key]), Chain::No)?;
        let mut values = Distinct::new();
        let defaults = self.values_of_alternative(default)?;
        let is_missing = |value: &Held| *value == Held::Primitive(Constant::Undefined);
        let held = held.into_iter().filter(|it| !is_missing(it));
        held.chain(defaults).for_each(|it| add(&mut values, it));
        Some(values.all)
    }

    /// The statement of `list` that holds `e`, with no function between them.
    fn find_statement_in_list(&self, e: ExprId, list: Parent) -> Option<StmtId> {
        let bound = self.inputs.bound;
        let mut statement = bound.statement_of_expr(e)?;
        loop {
            match bound.parent_of_stmt(statement) {
                above if above == list => return Some(statement),
                Parent::Stmt(above) => statement = above,
                _ => return None,
            }
        }
    }

    /// `None` if a read may come first: `symbol` is exported, or a function reads it. Where the stores are followed in their order, what they are made of is no such read.
    fn find_store_before_reads(
        &self,
        symbol: SymbolId,
        pattern: PatId,
        is_in_order: bool,
    ) -> Option<(Parent, u32)> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
            return None;
        };
        let declaration = bound.var_stmt[declaration.idx()];
        let list = bound.parent_of_stmt(declaration);
        let is_sequential = match list {
            Parent::File | Parent::FnBody(_) => true,
            Parent::Stmt(owner) => matches!(hir[owner].kind, StmtKind::Block(_)),
            _ => false,
        };
        if !is_sequential || self.is_exported(symbol) {
            return None;
        }
        let stores = bound.stores_to(symbol);
        let targets: FxHashSet<ExprId> = stores.iter().map(|store| store.target).collect();
        let plain_starts = stores.iter().filter_map(|store| {
            let Parent::Expr(assignment) = bound.parent_of_expr(self.outermost_cast(store.target))
            else {
                return None;
            };
            let Parent::Stmt(statement) = bound.parent_of_expr(assignment) else {
                return None;
            };
            let is_plain = store.kind == StoreKind::Assign
                && matches!(hir[statement].kind, StmtKind::Expr(_))
                && bound.parent_of_stmt(statement) == list;
            is_plain.then_some(hir[statement].start)
        });
        let plain_starts: FxHashSet<u32> = plain_starts.collect();
        let mut first_read = u32::MAX;
        for e in self.mentions_of(symbol) {
            if !targets.contains(&e) {
                let start = hir[self.find_statement_in_list(e, list)?].start;
                if !is_in_order || !plain_starts.contains(&start) {
                    first_read = first_read.min(start);
                }
            }
        }
        let starts = plain_starts.into_iter();
        let starts = starts.filter(|&it| hir[declaration].start < it && it < first_read);
        Some((list, starts.max()?))
    }

    /// The statement list that declares `symbol`, and the start of its last plain assignment there that runs before any read: earlier stores are never seen. Depends only on `symbol`, because `follow_once` caches by symbol.
    fn find_overwriting_store(&self, symbol: SymbolId, pattern: PatId) -> Option<(Parent, u32)> {
        if !self.keeps_known_alternatives || self.skips_reassigned_bindings {
            return None;
        }
        let known = self.written_names.6.borrow().get(&symbol).copied();
        known.unwrap_or_else(|| {
            let found = self.find_store_before_reads(symbol, pattern, false);
            self.written_names.6.borrow_mut().insert(symbol, found);
            found
        })
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
        let overwriting = match declared_again.is_empty() {
            true => self.find_overwriting_store(symbol, pattern),
            false => None,
        };
        let leans_on_itself = self.follows_assignments()
            && declared_again.is_empty()
            && self.has_assignment_made_of(symbol);
        if leans_on_itself && let Some(values) = self.values_in_order(symbol, pattern) {
            return Some(values);
        }
        let mut values = match overwriting {
            Some(_) => Distinct::new(),
            None => {
                let skips_unknown = self.keeps_known_alternatives && self.trusts_import_meta;
                let declared = self.values_of_declaration(symbol, pattern);
                if declared.is_none() && declared_again.is_empty() && !skips_unknown {
                    return self.values_in_order(symbol, pattern);
                }
                Distinct::from(declared.or_else(|| skips_unknown.then(Values::new))?)
            }
        };
        for declaration in declared_again {
            let &Decl::Var(pattern) = declaration else {
                return None;
            };
            for value in self.values_of_declaration(symbol, pattern)? {
                add(&mut values, value);
            }
        }
        if bound.binding_kind(symbol) == BindingKind::Var && overwriting.is_none() {
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
            if let (Some((list, start)), Parent::Stmt(statement)) =
                (overwriting, bound.parent_of_expr(assignment))
                && bound.parent_of_stmt(statement) == list
                && hir[statement].start < start
            {
                continue;
            }
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
        let values = self.add_entries_set(symbol, values.all);
        let values = self.add_pushed_values(symbol, pattern, values)?;
        self.add_values_added_to_set(symbol, values)
    }

    /// What the variable `symbol` holds, if its assignments are made of what it held or its declaration is unknown.
    fn values_in_order(&mut self, symbol: SymbolId, pattern: PatId) -> Option<Values> {
        let bound = self.inputs.bound;
        let stores = bound.stores_to(symbol);
        let is_appended = StoreKind::CompoundAssign(BinOp::Add);
        if !self.follows_assignments()
            || stores.is_empty()
            || stores.iter().any(|it| it.kind == is_appended)
        {
            return None;
        }
        self.follow_passed(&mut |follower| {
            let overwriting = follower.find_store_before_reads(symbol, pattern, true);
            let declared = follower.values_of_declaration(symbol, pattern);
            let runs_once =
                |it: &Self, e: ExprId| it.runs_once_for_each_binding(e, symbol, pattern);
            let values = follower.values_after_assignments(
                symbol,
                declared.unwrap_or_default(),
                overwriting,
                &runs_once,
            );
            (!values.is_empty()).then_some(values)
        })
    }

    /// Returns true if a value assigned to `symbol` mentions it.
    fn has_assignment_made_of(&self, symbol: SymbolId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let mut assigned: Vec<Range<u32>> = bound
            .stores_to(symbol)
            .iter()
            .filter_map(|store| {
                let target = self.outermost_cast(store.target);
                match bound.parent_of_expr(target) {
                    Parent::Expr(assignment) => match expr_kind(hir, assignment)? {
                        ExprKind::Assign { value, .. } => Some(hir[value].pos..hir[value].end),
                        _ => None,
                    },
                    _ => None,
                }
            })
            .collect();
        if assigned.is_empty() {
            return false;
        }
        assigned.shared_sort_unstable_by_key(|it| it.start);
        let mut mentions = self.mentions_of(symbol).into_iter().map(|it| hir[it].pos);
        mentions.any(|place| {
            let behind = assigned.partition_point(|it| it.start <= place);
            behind > 0 && assigned[behind - 1].contains(&place)
        })
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
                Held::MapOf(entries) => entries.to_vec(),
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
            (0 | 1, None) if self.follows_assignments() => {
                let held = self.values_of(list)?;
                if !held.iter().any(|it| matches!(it, Held::MapOf(_))) {
                    return match position {
                        0 => self.values_of_elements(list),
                        _ => None,
                    };
                }
                // `map.forEach((value, key) => ..)`
                let mut values = Distinct::new();
                for entry in self.values_of_elements(list)? {
                    if let Held::List(mut places) = entry
                        && places.len() == 2
                    {
                        let handed = places.swap_remove(1 - position);
                        handed.into_iter().for_each(|it| add(&mut values, it));
                    }
                }
                Some(values.all)
            }
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
        let walks = is_list_walk(self.inputs.atoms.bytes(name));
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

    /// Returns true if the file stores to a member of `holder`, deletes one, or hands `holder` to a built-in that writes into its first argument.
    fn writes_member_of(&self, holder: SymbolId, name: Atom) -> bool {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        let mentions = find_mentions_of(hir, bound, holder, name);
        mentions.into_iter().any(|mention| {
            let Parent::Expr(above) = bound.parent_of_expr(mention) else {
                return false;
            };
            if hir.member_key(above).is_some_and(|(of, _)| of == mention) {
                let is_deleted = matches!(bound.parent_of_expr(above), Parent::Expr(user)
                    if matches!(hir[user].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
                return is_deleted || bound.get_assignment_target(hir, above).is_some();
            }
            let ExprKind::Call(call) = hir[above].kind else {
                return false;
            };
            let Some((of, MemberKey::Name(method))) = hir.member_key(hir[call].callee) else {
                return false;
            };
            let is_global =
                is_free_name(hir, bound, of, &[known::Object, atoms.intern(b"Reflect")]);
            let writes = matches!(
                atoms.bytes(method),
                b"assign" | b"defineProperty" | b"defineProperties" | b"setPrototypeOf"
            ) || matches!(atoms.bytes(method), b"set" | b"deleteProperty");
            writes && is_global && hir.ids(hir[call].args).next() == Some(mention)
        })
    }

    /// `list.find(fs.existsSync)`: a function of `node:fs` that reads neither changes nor keeps what a walk hands it, unless the file replaces it. What the list was written with stays one of its values even then.
    fn find_walk_by_read(&self, call: Call) -> Option<(ExprId, Atom)> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        find_list_iterated_by_read(self.inputs, call.callee, call.args)?;
        let handed = hir.skip_type_assertions(hir.ids(call.args).next()?);
        let is_as_loaded = hir.member_key(handed).is_none_or(|(module, _)| {
            let module = hir.skip_type_assertions(module);
            match (hir[module].kind, bound.binding(module)) {
                (ExprKind::Ident(name), Binding::Symbol(holder)) => {
                    !self.writes_member_of(holder, name)
                }
                _ => true,
            }
        });
        if !is_as_loaded && !self.keeps_known_alternatives {
            return None;
        }
        match hir.member_key(hir.skip_type_assertions(call.callee))? {
            (list, MemberKey::Name(name)) => Some((list, name)),
            _ => None,
        }
    }

    fn values_of_walk(&mut self, call: Call) -> Option<Values> {
        let by_read = self.find_walk_by_read(call);
        let by_read = by_read.filter(|_| call.chain == Chain::No);
        let (list, name) = by_read.or_else(|| self.find_walk_of_list(call))?;
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
        if self.findings.not_kept_as_written.contains(&symbol) {
            return false;
        }
        if !self.findings.kept_as_written.contains(&symbol) && self.kept_as_written.insert(symbol) {
            self.unchecked.push(symbol);
        }
        true
    }

    fn is_kept_as_written(&mut self, symbol: SymbolId) -> bool {
        let bound = self.inputs.bound;
        let finds_every_store = self.needs_no_contents_proof();
        let mut is_kept = !self.is_exported(symbol);
        for mention in self.mentions_of(symbol) {
            if !is_kept && !finds_every_store {
                return false;
            }
            let keeps = bound
                .dynamic_lookup_scope(NodeData::Expr(mention))
                .is_none()
                && (self.stores_without_handing_on(mention)
                    || self.find_push(mention).is_some() && self.is_initialized_with_list(symbol)
                    || self.find_add(mention).is_some() && self.is_initialized_with_set(symbol)
                    || self.keeps_as_written(mention));
            is_kept &= keeps;
        }
        is_kept
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
        if let Some(answer) = self.has_readonly_property(e) {
            return answer;
        }
        let values = self.values_of(e);
        values.is_some_and(|values| !values.iter().any(Held::can_be_changed))
    }

    /// The same of `name.key`, without a list of what the property holds for each mention.
    fn has_readonly_property(&mut self, e: ExprId) -> Option<bool> {
        let hir = self.inputs.hir;
        let e = hir.skip_type_assertions(e);
        let ExprKind::Dot {
            chain: Chain::No, ..
        } = expr_kind(hir, e)?
        else {
            return None;
        };
        let (object, key) = hir.member_key(e)?;
        let object = hir.skip_type_assertions(object);
        if self.stand_in.is_some() || !matches!(expr_kind(hir, object)?, ExprKind::Ident(_)) {
            return None;
        }
        let objects = self.values_of(object)?;
        let keys = self.keys_of(key)??;
        for held in &objects {
            let Held::Object(literal) = *held else {
                return None;
            };
            let under_keys = self.find_members(literal).by_key?;
            for key in &keys {
                if !under_keys.contains_key(&key[..]) {
                    return None;
                }
                let key = self.inputs.atoms.intern(key);
                let known = (self.call_context(), FollowedKey::Property(literal, key));
                let settled = || self.findings.followed.get(&known);
                let can_be_changed = match self.followed.get(&known).or_else(settled) {
                    Some(followed) => (followed.values.as_ref()?).iter().any(Held::can_be_changed),
                    None => (self.values_of_property_once(literal, key)?)
                        .iter()
                        .any(Held::can_be_changed),
                };
                if can_be_changed {
                    return Some(false);
                }
            }
        }
        Some(true)
    }

    /// Whatever the operands are, the result is no object.
    fn makes_text(&self, e: ExprId) -> bool {
        let hir = self.inputs.hir;
        match expr_kind(hir, hir.skip_type_assertions(e)) {
            Some(ExprKind::Template { .. } | ExprKind::Binary { op: BinOp::Add, .. }) => true,
            Some(ExprKind::Call(call)) => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                self.find_path_joining_function(callee).is_some()
            }
            _ => false,
        }
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
            ExprKind::Call(call) if self.joins_assigned_values(e, hir[call]) => {
                self.keeps_as_written(above)
            }
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
        let settled = || self.findings.asked_who_takes.get(&(e, layers));
        if let Some(&known) = self.asked_who_takes.get(&(e, layers)).or_else(settled) {
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
        let by_read = self.find_walk_by_read(call);
        let by_read = by_read.filter(|_| call.chain == Chain::No);
        let is_iterated_by_read = by_read.is_some();
        let Some((list, name)) = by_read.or_else(|| self.find_walk_of_list(call)) else {
            return matches!(hir.member_key(read), Some((_, MemberKey::Name(name))) if self.only_asks(name));
        };
        if layers == 0 {
            return true;
        }
        if !is_iterated_by_read {
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
            || !self.stores_nothing_to_change(member, value)
        {
            return false;
        }
        let Some(holders) = self.values_of(object) else {
            return false;
        };
        holders.into_iter().all(|holder| match holder {
            Held::Object(literal) => {
                self.add_store(literal, key, value);
                true
            }
            Held::Primitive(Constant::Undefined | Constant::Null) => true,
            _ => false,
        })
    }

    /// `Object.assign(target, { dir: path.join(__dirname, "a") })` stores what is written there.
    fn joins_assigned_values(&mut self, target: ExprId, call: Call) -> bool {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        let Some((holder, MemberKey::Name(name))) =
            hir.member_key(hir.skip_type_assertions(call.callee))
        else {
            return false;
        };
        let holder = hir.skip_type_assertions(holder);
        if !self.keeps_known_alternatives
            || atoms.bytes(name) != b"assign"
            || !is_free_name(hir, bound, holder, &[known::Object])
        {
            return false;
        }
        let mut stored: Vec<(Vec<u8>, ExprId)> = Vec::new();
        for (index, argument) in hir.ids(call.args).enumerate() {
            let argument = hir.skip_type_assertions(argument);
            if index == 0 {
                if argument != hir.skip_type_assertions(target) {
                    return false;
                }
                continue;
            }
            let Some(ExprKind::Object(properties)) = expr_kind(hir, argument) else {
                return false;
            };
            for id in properties.iter() {
                let property = hir[id];
                let (PropKind::Init | PropKind::Shorthand, PropKey::Name(name)) =
                    (property.kind, hir.runtime_property_key(id))
                else {
                    return false;
                };
                let key = atoms.bytes(name);
                if matches!(key, b"toString" | b"valueOf" | b"__proto__")
                    || !(self.makes_text(property.value)
                        || self.holds_what_cannot_be_changed(property.value))
                {
                    return false;
                }
                stored.push((key.to_vec(), property.value));
            }
        }
        let Some(holders) = self.values_of(target) else {
            return false;
        };
        holders.into_iter().all(|holder| match holder {
            Held::Object(literal) => {
                for (key, value) in &stored {
                    self.add_store(literal, key, *value);
                }
                true
            }
            Held::Primitive(Constant::Undefined | Constant::Null) => true,
            _ => false,
        })
    }

    fn add_store(&mut self, literal: ExprId, key: &[u8], value: ExprId) {
        if self.findings.stores_known.insert((literal, value)) {
            self.stored_since.push((literal, value));
            let stored = self.findings.stored_under_keys.entry(literal).or_default();
            stored.push((key.to_vec(), value));
        }
    }

    /// What `member` holds already may be stored there again.
    fn stores_nothing_to_change(&mut self, member: ExprId, value: ExprId) -> bool {
        let hir = self.inputs.hir;
        let value = hir.skip_type_assertions(value);
        if self.makes_text(value) || self.reads_same_property(member, value) {
            return true;
        }
        match expr_kind(hir, value) {
            Some(ExprKind::Cond { branches, .. }) => {
                let Branches { yes, no } = hir.branches(branches);
                [yes, no]
                    .into_iter()
                    .all(|it| self.is_dead(it) || self.stores_nothing_to_change(member, it))
            }
            _ => self.holds_what_cannot_be_changed(value),
        }
    }

    fn reads_same_property(&self, member: ExprId, read: ExprId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let (Some((of, MemberKey::Name(key))), Some((from, MemberKey::Name(name)))) = (
            hir.member_key(hir.skip_type_assertions(member)),
            hir.member_key(read),
        ) else {
            return false;
        };
        let symbol_of = |e: ExprId| match bound.binding(hir.skip_type_assertions(e)) {
            Binding::Symbol(symbol) if bound.is_stable_binding(symbol) => Some(symbol),
            _ => None,
        };
        key == name && symbol_of(of).is_some_and(|symbol| symbol_of(from) == Some(symbol))
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
            Some((_, call)) => {
                self.find_walk_by_read(call).is_some() || self.find_walk_of_list(call).is_some()
            }
            None => false,
        };
        if !asks && !hands_elements_on {
            return false;
        }
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
            .findings
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
        self.findings
            .objects_asked_whether_their_functions_see_them
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
        if let Some(values) = self.values_of_part_of_parsed_path(object, key) {
            return Some(values);
        }
        self.values_of_followed_member(object, key, chain)
            .or_else(|| self.values_of_field(member, object, key))
    }

    fn values_of_followed_member(
        &mut self,
        object: ExprId,
        key: MemberKey,
        chain: Chain,
    ) -> Option<Values> {
        let objects = self.values_of(object)?;
        let keys = self.keys_of(key)?;
        self.read_member(&objects, keys.as_deref(), chain)
    }

    /// Returns the values of the field that `member` reads in instances of the classes of this file. Code that gets an instance is trusted not to write its private and readonly fields.
    fn values_of_field(
        &mut self,
        member: ExprId,
        object: ExprId,
        key: MemberKey,
    ) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        if !self.follows_fields {
            return None;
        }
        let private = bound.private_name_of_reference(member);
        let name = match (key, private) {
            (MemberKey::Name(name), _) => MemberName::Public(name),
            (MemberKey::PrivateName(_), Some(private)) => MemberName::Private(private),
            (MemberKey::PrivateName(_), None) | (MemberKey::Computed(_), _) => return None,
        };
        let members = self.written_names.members(hir, bound);
        let object = hir.skip_type_assertions(object);
        let is_this = matches!(expr_kind(hir, object)?, ExprKind::This);
        let class_named = match (expr_kind(hir, object), bound.binding(object)) {
            (Some(ExprKind::Ident(_)), Binding::Symbol(it)) => match bound.symbol(it).decls {
                [Decl::Class(class)] => Some(members.families_of_classes[class.idx()]),
                _ => None,
            },
            _ => None,
        };
        let is_of_class_here = is_this || class_named.is_some();
        let mut instance = None;
        if !is_of_class_here && private.is_none() && self.keeps_known_alternatives {
            instance = (self.find_instance_family(object))
                .filter(|it| members.by_name.contains_key(&(name, Some(it.1))));
        }
        let family = match (is_this, instance) {
            (true, _) => members.find_family_at(hir[member].pos),
            (false, Some((_, family))) => Some(family),
            (false, None) => class_named,
        };
        let has_family_alone = is_of_class_here && private.is_none() || instance.is_some();
        let families = match (has_family_alone, family) {
            (true, Some(_)) => &[family, None][..],
            (true, None) => &[None][..],
            (false, _) => &members.families.get(&name)?[..],
        };
        let written = families
            .iter()
            .filter_map(|&it| members.by_name.get(&(name, it)));
        let written: Vec<&MembersUnderName> = written.collect();
        if written.is_empty() {
            return None;
        }
        let around = |it: &&MembersUnderName| it.in_literals.around(hir[member].pos).next();
        let around = match is_this {
            true => written.iter().find_map(around),
            false => None,
        };
        let place = Place::Field(name, family, around);
        let mut in_progress = self.places_in_progress.iter();
        if let Some(found) = in_progress.position(|it| it.place == place) {
            self.met_in_progress.meet_place(found);
            return Some(vec![Held::Itself(place)]);
        }
        self.enter_place(place, Values::new());
        let is_of_class_here = is_of_class_here || private.is_some();
        let values = self.values_of_members(member, is_this, &written, is_of_class_here, instance);
        self.leave_place();
        let mut values = values?;
        if let Some(closed) = close_over_itself(place, values.clone()) {
            return Some(closed).filter(|it| !it.is_empty());
        }
        values.retain(|it| *it != Held::Itself(place) && *it != Held::BelowItself(place));
        (self.keeps_known_alternatives && !values.is_empty()).then_some(values)
    }

    /// The variable and the family of the instance that `object` names.
    fn find_instance_family(&self, object: ExprId) -> Option<(SymbolId, ClassId)> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let symbol = settled_symbol(hir, bound, object)?;
        let BindingInitializer::Expression(made) = bound.binding_initializer(hir, symbol) else {
            return None;
        };
        let ExprKind::New(call) = hir[hir.skip_type_assertions(made)].kind else {
            return None;
        };
        let callee = hir.skip_type_assertions(hir[call].callee);
        let class = find_class_named_by(hir, bound, callee)?;
        let members = self.written_names.members(hir, bound);
        let family = members.families_of_classes[class.idx()];
        (!(members.families_with_returning_constructors).contains(&family))
            .then_some((symbol, family))
    }

    /// Returns true if `store` stores to a member of another object than `instance`.
    fn stores_to_another_object(&self, store: ExprId, instance: (SymbolId, ClassId)) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let Some((object, _)) = hir.member_key(store) else {
            return false;
        };
        let object = hir.skip_type_assertions(object);
        if let Some((symbol, family)) = self.find_instance_family(object) {
            return symbol != instance.0 && family != instance.1;
        }
        let symbol = settled_symbol(hir, bound, object);
        symbol.is_some_and(|it| match bound.binding_initializer(hir, it) {
            BindingInitializer::Expression(made) => {
                let made = hir.skip_type_assertions(made);
                matches!(hir[made].kind, ExprKind::Object(_))
            }
            _ => false,
        })
    }

    /// `is_of_class_here` is false for a member of any object.
    fn values_of_members(
        &mut self,
        member: ExprId,
        is_this: bool,
        written: &[&MembersUnderName],
        is_of_class_here: bool,
        instance: Option<(SymbolId, ClassId)>,
    ) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let private = bound.private_name_of_reference(member);
        let mut values = Distinct::new();
        let mut is_only_written_here = is_of_class_here;
        let is_kept =
            |flags: Flags| private.is_some() || flags.intersects(Flags::PRIVATE | Flags::READONLY);
        for &id in written.iter().flat_map(|it| &it.of_classes) {
            let declared = hir[id];
            match declared.kind {
                MemberKind::Property => {
                    is_only_written_here &= is_kept(declared.flags);
                    match declared.init.some() {
                        Some(initial) => {
                            let initial = self.values_of_alternative(initial)?;
                            initial.into_iter().for_each(|it| add(&mut values, it));
                        }
                        None => add(&mut values, Held::Primitive(Constant::Undefined)),
                    }
                }
                MemberKind::Getter => {
                    let returned = self.values_returned_by(declared.func, None)?;
                    returned.into_iter().for_each(|it| add(&mut values, it));
                }
                MemberKind::Method if self.is_following_passed => {
                    let is_only_one = written.len() == 1 && written[0].of_classes.len() == 1;
                    if is_of_class_here || is_only_one {
                        add(&mut values, Held::Function(declared.func));
                    }
                }
                MemberKind::Setter if self.is_following_passed => {}
                _ => return None,
            }
        }
        for &(function, place) in written.iter().flat_map(|it| &it.parameter_properties) {
            let parameter = hir[function].params.iter().nth(place)?;
            is_only_written_here &= is_kept(hir[parameter].flags);
            let passed = self.values_passed_at_constructions(function, place)?;
            passed.into_iter().for_each(|it| add(&mut values, it));
        }
        for &store in written.iter().flat_map(|it| &it.stores) {
            if self.is_dead(store)
                || instance.is_some_and(|it| self.stores_to_another_object(store, it))
            {
                continue;
            }
            let of_this = matches!(hir.member_key(store), Some((object, _))
                if matches!(expr_kind(hir, hir.skip_type_assertions(object)), Some(ExprKind::This)));
            is_only_written_here &= of_this || private.is_some();
            let Parent::Expr(assignment) = bound.parent_of_expr(self.outermost_cast(store)) else {
                return None;
            };
            let ExprKind::Assign {
                op: None | Some(BinOp::Nullish | BinOp::Or),
                value,
                ..
            } = hir[assignment].kind
            else {
                return None;
            };
            let stored = self.values_of_alternative(value)?;
            stored.into_iter().for_each(|it| add(&mut values, it));
        }
        if is_this && self.keeps_known_alternatives {
            let place = hir[member].pos;
            for value in written.iter().flat_map(|it| it.in_literals.around(place)) {
                let is_method = matches!(bound.parent_of_expr(value), Parent::Prop(id)
                    if hir[id].kind == PropKind::Method);
                if !self.is_dead(value) && (!is_method || self.is_following_passed) {
                    let held = self.values_of_alternative(value)?;
                    held.into_iter().for_each(|it| add(&mut values, it));
                }
            }
        }
        let is_known = is_only_written_here || self.keeps_known_alternatives;
        (is_known && !values.is_empty()).then_some(values.all)
    }

    /// Returns what the parameter that `name` mentions gets, if its function is a constructor.
    fn values_passed_to_constructor(&mut self, name: ExprId) -> Option<Values> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        if !self.follows_fields {
            return None;
        }
        let (function, place, path) = find_parameter_key_path(hir, bound, name)?;
        let mut values = self.values_passed_at_constructions(function, place)?;
        for &key in &path {
            let key = self.inputs.atoms.bytes(key).to_vec();
            values = self.read_member(&values, Some(&[key]), Chain::No)?;
        }
        Some(values)
    }

    fn add_argument_passed(
        &self,
        call: Call,
        place: usize,
        default: ExprId,
        passed: &mut Vec<Option<ExprId>>,
    ) -> Option<()> {
        let hir = self.inputs.hir;
        let is_spread = |it: ExprId| matches!(hir[it].kind, ExprKind::Spread(_));
        let mut arguments = hir.ids(call.args).take(place + 1);
        if arguments.clone().any(is_spread) {
            return None;
        }
        let argument = arguments.nth(place);
        if argument.is_some() || default.is_none() {
            passed.push(argument);
        }
        Some(())
    }

    /// The calls of `super()` in the constructor that `class` declares.
    fn find_super_calls(&self, class: ClassId) -> Option<Vec<Call>> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let mut members = hir[class].members.iter().map(|id| hir[id]);
        let constructor = members.find(|it| it.kind == MemberKind::Constructor)?;
        let place = constructor.loc.pos..constructor.loc.end;
        let calls = &self.written_names.members(hir, bound).super_calls[..];
        let first = calls.partition_point(|&call| hir[call].pos < place.start);
        let calls = calls[first..].iter();
        let calls = calls.take_while(|&&call| hir[call].pos < place.end);
        let calls = calls.filter_map(|&call| match hir[call].kind {
            ExprKind::Call(call) => Some(hir[call]),
            _ => None,
        });
        Some(calls.collect())
    }

    fn values_passed_at_constructions(&mut self, function: FnId, place: usize) -> Option<Values> {
        let &ScanInputs {
            hir,
            bound,
            decisions,
            ..
        } = self.inputs;
        let FnOwner::Member(member) = bound.fns[function.idx()].owner else {
            return None;
        };
        let MemberOwner::Class(class) = bound.member_owner[member.idx()] else {
            return None;
        };
        if hir[member].kind != MemberKind::Constructor {
            return None;
        }
        let default = hir[hir[function].params.iter().nth(place)?].default;
        let mut passed: Vec<Option<ExprId>> = default.some().into_iter().map(Some).collect();
        let mut is_seen_whole = true;
        let written_names = self.written_names;
        let heirs = &written_names.members(hir, bound).heirs;
        let mut found = FxHashSet::default();
        found.insert(class);
        let mut classes = vec![class];
        let mut looked_at = 0;
        while let Some(&class) = classes.get(looked_at) {
            looked_at += 1;
            let class_name = bound.declared_symbol(Decl::Class(class));
            if class_name.is_none() {
                return None;
            }
            let names = [class_name, bound.inner_class_symbol(class)];
            is_seen_whole &= bound.is_stable_binding(class_name) && !self.is_exported(class_name);
            for &(_, mention) in self.written_names.find(hir, hir[class].name) {
                let names_class =
                    matches!(bound.binding(mention), Binding::Symbol(it) if names.contains(&it));
                if !names_class || decisions.is_dead_expr(mention) {
                    continue;
                }
                let above = match bound.parent_of_expr(mention) {
                    Parent::Expr(above) => hir[above].kind,
                    _ => {
                        match heirs.get(&mention).copied() {
                            Some(heir) if found.insert(heir) => match self.find_super_calls(heir) {
                                Some(calls) => {
                                    for call in calls {
                                        self.add_argument_passed(
                                            call,
                                            place,
                                            default,
                                            &mut passed,
                                        )?;
                                    }
                                }
                                None => classes.push(heir),
                            },
                            _ => is_seen_whole = false,
                        }
                        continue;
                    }
                };
                match above {
                    ExprKind::New(call) if hir[call].callee == mention => {
                        self.add_argument_passed(hir[call], place, default, &mut passed)?;
                    }
                    ExprKind::Dot { obj, .. } if obj == mention => {}
                    ExprKind::Binary {
                        op: BinOp::Instanceof,
                        right,
                        ..
                    } if right == mention => {}
                    _ => is_seen_whole = false,
                }
            }
        }
        if !is_seen_whole && !self.keeps_known_alternatives {
            return None;
        }
        let mut values = Distinct::new();
        for argument in passed {
            let held = match argument {
                Some(argument) => self.values_of_alternative(argument)?,
                None => vec![Held::Primitive(Constant::Undefined)],
            };
            held.into_iter().for_each(|it| add(&mut values, it));
        }
        (!values.is_empty()).then_some(values.all)
    }

    fn read_member(
        &mut self,
        objects: &Values,
        keys: Option<&[Vec<u8>]>,
        chain: Chain,
    ) -> Option<Values> {
        let mut values = Distinct::new();
        let mut beside_spreads = Vec::new();
        let looks_beside_spreads = self.follows_fields && self.keeps_known_alternatives;
        for object in objects {
            let read = match object {
                Held::Object(literal)
                    if looks_beside_spreads
                        && keys.is_some()
                        && self.find_members(*literal).by_key.is_none() =>
                {
                    beside_spreads.push(*literal);
                    continue;
                }
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
                Held::ImportMeta => match keys? {
                    [key] => self.read_import_meta_path(self.inputs.atoms.intern(key))?,
                    _ => return None,
                },
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
        if let (false, Some(keys)) = (beside_spreads.is_empty(), keys) {
            for value in self.read_property_beside_spreads(beside_spreads, keys)? {
                add(&mut values, value);
            }
            if values.is_empty() {
                return None;
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
        let asked = match (self.own_path_queries, self.other_file_queries) {
            (Some(asked), _) => Some(asked),
            (None, asked) => asked.filter(|_| path.len() == key.len()),
        };
        if let Some(asked) = asked {
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

    fn read_import_meta_path(&self, key: Atom) -> Option<Values> {
        let text = match key {
            known::meta_dir | known::meta_dirname => Text::whole(b"."),
            known::url | known::meta_filename | known::path => {
                let path = Text::whole(&self.spell_own_file()?);
                let is_file_url = key == known::url;
                Text {
                    is_file_url,
                    ..path
                }
            }
            _ => return None,
        };
        Some(vec![Held::Text(Text {
            starts_at_own_directory: true,
            ..text
        })])
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
            let is_value = match property.kind {
                PropKind::Init | PropKind::Shorthand | PropKind::Method => true,
                PropKind::Getter => self.is_following_passed,
                PropKind::Setter if self.is_following_passed => continue,
                PropKind::Setter | PropKind::Spread => false,
            };
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
        if let Some(stored) = self.findings.stored_under_keys.get(&literal) {
            written.extend(stored.iter().cloned());
        }
        Some(written)
    }

    fn find_members(&mut self, literal: ExprId) -> MembersOfObject {
        let stored = self.findings.stored_under_keys.get(&literal);
        let stores = stored.map_or(0, Vec::len);
        let known = self.findings.members_of_objects.get(&literal);
        if let Some(known) = known.filter(|it| it.stores == stores) {
            return known.clone();
        }
        let by_key = self.properties_of(literal).map(|written| {
            let mut by_key: FxHashMap<Vec<u8>, Vec<ExprId>> = FxHashMap::default();
            for (key, value) in written {
                by_key.entry(key).or_default().push(value);
            }
            Rc::new(by_key)
        });
        let members = MembersOfObject { by_key, stores };
        let hir = self.inputs.hir;
        let varies = match expr_kind(hir, literal) {
            Some(ExprKind::Object(properties)) => properties.iter().any(|id| {
                matches!(hir.runtime_property_key(id), PropKey::Computed(_))
                    || matches!(hir[id].kind, PropKind::Getter | PropKind::Setter)
            }),
            _ => false,
        };
        if !varies {
            (self.findings.members_of_objects).insert(literal, members.clone());
        }
        members
    }

    fn read_property(&mut self, literal: ExprId, keys: Option<&[Vec<u8>]>) -> Option<Values> {
        let Some(keys) = keys else {
            let written = self.properties_of(literal)?;
            let values = self.values_of_any(written.iter().map(|it| it.1))?;
            return Some(with_undefined(values));
        };
        let under_keys = self.find_members(literal).by_key?;
        let mut values = Distinct::new();
        for key in keys {
            match under_keys.contains_key(&key[..]) {
                true => {
                    let key = self.inputs.atoms.intern(key);
                    for value in self.values_of_property_once(literal, key)? {
                        add(&mut values, value);
                    }
                }
                false if is_member_of_every_object(key) => add(&mut values, Held::Other),
                false => add(&mut values, Held::Primitive(Constant::Undefined)),
            }
        }
        Some(values.all)
    }

    /// A store may be made of what the property held: `o.p = path.join(o.p, "x")`.
    fn values_of_property_once(&mut self, literal: ExprId, key: Atom) -> Option<Values> {
        let place = Place::Property(literal, key);
        // Who asks what takes an object follows it by each of its names, also by one that is in progress around the question.
        let open = self.count_open_questions();
        let mut in_progress = self.places_in_progress.iter();
        let is_asked_for = |it: &PlaceInProgress| it.place == place && it.open_questions == open;
        if let Some(found) = in_progress.position(is_asked_for) {
            self.met_in_progress.meet_place(found);
            return Some(self.places_in_progress[found].values.clone());
        }
        let key = (self.call_context(), FollowedKey::Property(literal, key));
        self.follow_once(key, literal)
    }

    fn values_of_property(&mut self, literal: ExprId, key: Atom) -> Option<Values> {
        let under_keys = self.find_members(literal).by_key?;
        let held = under_keys.get(self.inputs.atoms.bytes(key))?;
        let place = Place::Property(literal, key);
        let index = self.places_in_progress.len();
        let (mut apart, mut all) = (Distinct::new(), Distinct::new());
        let mut joined: FxHashSet<ExprId> = FxHashSet::default();
        self.enter_place(place, vec![Held::Itself(place)]);
        let mut met_by_all = self.met_in_progress;
        let mut is_whole = true;
        for &stored in held {
            if self.is_dead(stored) {
                continue;
            }
            if apart.len() > MOST_TEXTS_MADE as usize || self.pay_for_stores(1).is_none() {
                is_whole = false;
                break;
            }
            self.met_in_progress = MetInProgress::NONE;
            let values = match self.find_getter(stored) {
                Some(getter) => self
                    .values_returned_by(getter, None)
                    .or(Some(Values::new())),
                None => self.values_of_alternative(stored),
            };
            let met = self.met_in_progress;
            met_by_all.places |= met.places;
            met_by_all.function = met_by_all.function.min(met.function);
            let Some(values) = values else {
                self.met_in_progress = met_by_all;
                self.leave_place();
                return None;
            };
            let is_joined = met.meets_place(index);
            if is_joined {
                joined.insert(stored);
            }
            for value in values {
                if !is_joined {
                    add(&mut apart, value.clone());
                }
                add(&mut all, value);
            }
        }
        self.met_in_progress = met_by_all;
        self.leave_place();
        if apart.len() > MOST_VALUES_JOINED {
            if !self.keeps_known_alternatives {
                return None;
            }
            apart.truncate(MOST_VALUES_JOINED);
        }
        match (is_whole, self.keeps_known_alternatives) {
            (false, false) => {
                self.note_run_out();
                None
            }
            (false, true) => Some(apart.all),
            (true, keeps_known) if joined.is_empty() => {
                if !keeps_known || held.len() < 2 {
                    return Some(apart.all);
                }
                let stores = self.order_stores(literal, held);
                let values =
                    stores.and_then(|it| self.values_after_stores(literal, place, &it, &joined));
                values.or(Some(apart.all))
            }
            (true, keeps_known) => match self.order_stores(literal, held) {
                Some(stores) => self.values_after_stores(literal, place, &stores, &joined),
                None if keeps_known => self.values_of_stores_in_any_order(place, apart, &joined),
                None => close_over_itself(place, all.all),
            },
        }
    }

    fn find_getter(&self, value: ExprId) -> Option<FnId> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        match (bound.parent_of_expr(value), expr_kind(hir, value)) {
            (Parent::Prop(id), Some(ExprKind::Fn(function)))
                if hir[id].kind == PropKind::Getter =>
            {
                Some(function)
            }
            _ => None,
        }
    }

    fn pay_for_stores(&self, followed: usize) -> Option<()> {
        let followed = u32::try_from(followed).unwrap_or(u32::MAX);
        let left = self.stores_left.get().checked_sub(followed)?;
        self.stores_left.set(left);
        Some(())
    }

    /// What is known then is kept, and the other half is for who asks for it.
    fn has_spent_half(&self) -> bool {
        let hir = self.inputs.hir;
        let revisits = max_revisited_expressions(hir, self.written_names.5.get());
        self.expressions_left.get() < most_expressions_followed(hir) / 2
            || self.texts_left.get() < MOST_TEXTS_MADE / 2
            || self.revisits_left < revisits / 2
    }

    /// Follows `stored` where the property holds `values`.
    fn values_stored(&mut self, place: Place, stored: ExprId, values: Values) -> Option<Values> {
        if self.keeps_known_alternatives && self.has_spent_half() {
            return None;
        }
        self.pay_for_stores(values.len().max(1))?;
        let index = self.places_in_progress.len();
        self.enter_place(place, values);
        let values = self.values_of_alternative(stored);
        self.leave_place();
        self.met_in_progress.forget_place(index);
        values
    }

    /// The stores by their place in the text, if each runs at most once and in that order for each time the literal is made.
    /// What a file does itself it does once, also to an object that a function makes.
    fn order_stores(&self, literal: ExprId, held: &[ExprId]) -> Option<Vec<ExprId>> {
        let hir = self.inputs.hir;
        let around = hir[literal].pos..hir[literal].end;
        let holder = self.find_holder_without_loop(literal);
        let is_own = |it: &ExprId| around.contains(&hir[*it].pos);
        let (mut stores, mut behind): (Vec<ExprId>, Vec<ExprId>) =
            held.iter().copied().partition(is_own);
        let is_made_by_file = holder == Some(Parent::File);
        let runs_once = |it: &ExprId| match self.find_holder_without_loop(*it) {
            Some(Parent::File) => !is_made_by_file || hir[*it].pos >= around.end,
            found => found.is_some() && found == holder && hir[*it].pos >= around.end,
        };
        let is_by_file = |it: &ExprId| self.find_holder_without_loop(*it) == Some(Parent::File);
        let are_in_one = behind.iter().all(is_by_file) || !behind.iter().any(is_by_file);
        if !are_in_one || !behind.iter().all(runs_once) {
            return None;
        }
        stores.shared_sort_unstable_by_key(|&it| hir[it].pos);
        behind.shared_sort_unstable_by_key(|&it| hir[it].pos);
        stores.extend(behind);
        Some(stores)
    }

    /// The function or the file that runs `e`, unless it may run it again and again.
    fn find_holder_without_loop(&self, e: ExprId) -> Option<Parent> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let mut statement = bound.statement_of_expr(e)?;
        loop {
            if is_loop(hir[statement].kind)
                || matches!(hir[statement].kind, StmtKind::Labeled { .. })
            {
                return None;
            }
            statement = match bound.parent_of_stmt(statement) {
                Parent::Stmt(above) => above,
                Parent::Case(case) => bound.case_stmt[case.idx()],
                holder @ (Parent::FnBody(_) | Parent::File) => return Some(holder),
                _ => return None,
            };
        }
    }

    /// The variable of `literal`, and where it is first mentioned other than by `stores` or for another property. 0 if it may be read in front of them.
    fn find_first_read(
        &mut self,
        literal: ExprId,
        place: Place,
        stores: &[ExprId],
    ) -> (SymbolId, u32) {
        const ANYWHERE: (SymbolId, u32) = (SymbolId::NONE, 0);
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let Parent::VarInit(declaration) = bound.parent_of_expr(self.outermost_cast(literal))
        else {
            return ANYWHERE;
        };
        let Place::Property(_, key) = place else {
            return ANYWHERE;
        };
        let pattern = hir[declaration].pat;
        if !matches!(hir[pattern].kind, PatKind::Ident(_)) {
            return ANYWHERE;
        }
        let symbol = bound.declared_symbol(Decl::Var(pattern));
        if symbol.is_none() || !bound.is_stable_binding(symbol) || self.is_exported(symbol) {
            return ANYWHERE;
        }
        let mut assignments: Vec<Range<u32>> = Vec::with_capacity(stores.len());
        for &stored in stores {
            if let Parent::Expr(above) = bound.parent_of_expr(self.outermost_cast(stored)) {
                assignments.push(hir[above].pos..hir[above].end);
            }
        }
        let has_no_code = matches!(expr_kind(hir, literal), Some(ExprKind::Object(properties))
            if properties.iter().all(|it| matches!(hir[it].kind, PropKind::Init | PropKind::Shorthand)));
        let mut first = u32::MAX;
        for mention in self.mentions_of(symbol) {
            let place = hir[mention].pos;
            let behind = assignments.partition_point(|it| it.start <= place);
            if behind > 0 && assignments[behind - 1].contains(&place)
                || has_no_code && self.is_for_another_property(mention, key)
            {
                continue;
            }
            if self.is_in_hoisted_function(mention) {
                return ANYWHERE;
            }
            first = first.min(place);
        }
        (symbol, first)
    }

    /// `name.other`, and no call of it: what is called sees the whole object.
    fn is_for_another_property(&self, mention: ExprId, key: Atom) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let mention = self.outermost_cast(mention);
        let Parent::Expr(member) = bound.parent_of_expr(mention) else {
            return false;
        };
        let ExprKind::Dot { obj, .. } = hir[member].kind else {
            return false;
        };
        let is_other =
            matches!(hir.member_key(member), Some((_, MemberKey::Name(name))) if name != key);
        is_other
            && hir.skip_type_assertions(obj) == hir.skip_type_assertions(mention)
            && self
                .find_call_of_member(self.outermost_cast(member))
                .is_none()
            && !matches!(bound.parent_of_expr(self.outermost_cast(member)), Parent::Expr(user)
                if matches!(hir[user].kind, ExprKind::TaggedTemplate(_)))
    }

    fn is_in_hoisted_function(&self, mut e: ExprId) -> bool {
        let bound = self.inputs.bound;
        loop {
            let Some(mut statement) = bound.statement_of_expr(e) else {
                return true;
            };
            let function = loop {
                statement = match bound.parent_of_stmt(statement) {
                    Parent::Stmt(above) => above,
                    Parent::Case(case) => bound.case_stmt[case.idx()],
                    Parent::FnBody(function) => break function,
                    Parent::File => return false,
                    _ => return true,
                };
            };
            match bound.fns[function.idx()].owner {
                FnOwner::Expr(written) => e = written,
                _ => return true,
            }
        }
    }

    /// Whether the assignment of `stored` to a property of `symbol` runs whenever what is behind it does.
    fn runs_in_list_of(&self, literal: ExprId, stored: ExprId, symbol: SymbolId) -> Option<u32> {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let Parent::Expr(assignment) = bound.parent_of_expr(self.outermost_cast(stored)) else {
            return None;
        };
        let ExprKind::Assign {
            op: None, target, ..
        } = hir[assignment].kind
        else {
            return None;
        };
        let Parent::Stmt(statement) = bound.parent_of_expr(assignment) else {
            return None;
        };
        let (object, _) = hir.member_key(hir.skip_type_assertions(target))?;
        if bound.binding(hir.skip_type_assertions(object)) != Binding::Symbol(symbol) {
            return None;
        }
        let made = bound.statement_of_expr(literal)?;
        (bound.parent_of_stmt(statement) == bound.parent_of_stmt(made))
            .then_some(hir[assignment].pos)
    }

    /// What `test` of the statement `around` asks, and the truth that it is asked for.
    fn find_condition(&self, test: ExprId, around: StmtId) -> (Condition, bool) {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let (mut test, mut is_true) = (hir.skip_type_assertions(test), true);
        while let ExprKind::Unary {
            op: UnOp::Not,
            operand,
        } = hir[test].kind
        {
            (test, is_true) = (hir.skip_type_assertions(operand), !is_true);
        }
        if let (ExprKind::Ident(_), Binding::Symbol(symbol)) = (hir[test].kind, bound.binding(test))
            && bound.binding_kind(symbol) == BindingKind::Const
        {
            return (Condition::Constant(symbol), is_true);
        }
        if let Some((environment, MemberKey::Name(name))) = hir.member_key(test) {
            let environment =
                follow_settled_bindings(hir, bound, hir.skip_type_assertions(environment));
            let is_environment = matches!(hir.member_key(environment), Some((host, MemberKey::Name(it)))
                if it == known::env
                    && is_process(hir, bound, host, &[known::globalThis, known::global]));
            let members = self.written_names.members(hir, bound);
            let families = members.families.get(&MemberName::Public(name));
            let is_set = families.into_iter().flatten().any(|&family| {
                (members.by_name.get(&(MemberName::Public(name), family)))
                    .is_some_and(|it| !it.stores.is_empty())
            });
            if is_environment && !is_set {
                return (Condition::Environment(name), is_true);
            }
        }
        (Condition::Test(around), is_true)
    }

    /// The conditions under which the value `stored` is stored, and whether it surely is under them.
    fn find_assumptions(&self, stored: ExprId) -> (Assumptions, bool) {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let mut assumptions = Assumptions::new();
        let mut is_certain = matches!(bound.parent_of_expr(self.outermost_cast(stored)), Parent::Expr(assignment)
            if matches!(hir[assignment].kind, ExprKind::Assign { op: None, .. })
                && matches!(bound.parent_of_expr(assignment), Parent::Stmt(_)));
        let Some(mut statement) = bound.statement_of_expr(stored) else {
            return (assumptions, false);
        };
        is_certain &= matches!(hir[statement].kind, StmtKind::Expr(_));
        loop {
            let above = match bound.parent_of_stmt(statement) {
                Parent::Stmt(above) => above,
                Parent::Case(case) => bound.case_stmt[case.idx()],
                _ => return (assumptions, is_certain),
            };
            match hir[above].kind {
                StmtKind::If { test, yes, no } if statement == yes || statement == no => {
                    let (condition, truth) = self.find_condition(test, above);
                    let assumed: Assumptions =
                        std::iter::once((condition, truth == (statement == yes))).collect();
                    is_certain &= may_hold_together(&assumptions, &assumed);
                    add_assumptions(&mut assumptions, &assumed);
                }
                StmtKind::Block(_) => {}
                _ => is_certain = false,
            }
            statement = above;
        }
    }

    /// Returns true if the assignment of `stored` stores to a member of the variable `symbol`.
    fn stores_to_member_of(&self, stored: ExprId, symbol: SymbolId) -> bool {
        let &ScanInputs { hir, bound, .. } = self.inputs;
        let Parent::Expr(assignment) = bound.parent_of_expr(self.outermost_cast(stored)) else {
            return false;
        };
        let ExprKind::Assign { target, .. } = hir[assignment].kind else {
            return false;
        };
        symbol.is_some()
            && hir
                .member_key(hir.skip_type_assertions(target))
                .is_some_and(|(object, _)| {
                    bound.binding(hir.skip_type_assertions(object)) == Binding::Symbol(symbol)
                })
    }

    /// Values that only contradicting conditions can bring together are left out.
    fn values_after_stores(
        &mut self,
        literal: ExprId,
        place: Place,
        stores: &[ExprId],
        joined: &FxHashSet<ExprId>,
    ) -> Option<Values> {
        let mut all = Distinct::new();
        let mut current: Distinct<(Held, Assumptions)> = Distinct::new();
        let mut written: Option<Values> = None;
        let (symbol, first_read) = self.find_first_read(literal, place, stores);
        for &stored in stores {
            if self.is_dead(stored) {
                continue;
            }
            let (assumptions, is_certain) = match self.keeps_known_alternatives {
                true => self.find_assumptions(stored),
                false => (Assumptions::new(), false),
            };
            let mut made: Vec<(Held, Assumptions)> = Vec::new();
            let mut is_followed = true;
            if joined.contains(&stored) && current.len() <= MOST_VALUES_JOINED {
                let mut groups: Vec<(Assumptions, Values)> = Vec::new();
                let usable = (current.iter()).filter(|it| may_hold_together(&it.1, &assumptions));
                for (held, assumed) in usable {
                    match groups.iter_mut().find(|it| it.0 == *assumed) {
                        Some((_, values)) => values.push(held.clone()),
                        None => groups.push((assumed.clone(), vec![held.clone()])),
                    }
                }
                if current.is_empty() {
                    groups.push((Assumptions::new(), Values::new()));
                }
                for (mut assumed, values) in groups {
                    let Some(values) = self.values_stored(place, stored, values) else {
                        is_followed = false;
                        break;
                    };
                    add_assumptions(&mut assumed, &assumptions);
                    made.extend(values.into_iter().map(|it| (it, assumed.clone())));
                }
            } else {
                let values = match joined.contains(&stored) {
                    false => self.values_of_alternative(stored),
                    true if self.keeps_known_alternatives => {
                        self.values_stored(place, stored, written.clone().unwrap_or_default())
                    }
                    true => None,
                };
                match values {
                    Some(values) => {
                        made.extend(values.into_iter().map(|it| (it, assumptions.clone())));
                    }
                    None => is_followed = false,
                }
            }
            if !is_followed {
                if joined.is_empty() {
                    return None;
                }
                if self.keeps_known_alternatives {
                    break;
                }
                self.note_run_out();
                return None;
            }
            let replaces = self.runs_in_list_of(literal, stored, symbol);
            let is_before_reads = self.inputs.hir[stored].pos < first_read;
            if !made.is_empty() && replaces.is_some_and(|it| it < first_read) {
                (all, current) = (Distinct::new(), Distinct::new());
                written = None;
            } else if !made.is_empty()
                && is_certain
                && is_before_reads
                && current.len() <= MOST_VALUES_JOINED
                && self.stores_to_member_of(stored, symbol)
            {
                // What was held before is held on where the conditions do not hold.
                all = Distinct::new();
                for (held, mut assumed) in std::mem::replace(&mut current, Distinct::new()).all {
                    if may_hold_together(&assumed, &assumptions) {
                        let mut missing = assumptions.iter().filter(|it| !assumed.contains(it));
                        match (missing.next().copied(), missing.next()) {
                            (None, _) => continue,
                            (Some((condition, truth)), None) => assumed.push((condition, !truth)),
                            (Some(_), Some(_)) => {}
                        }
                    }
                    add(&mut all, held.clone());
                    current.add((held, assumed));
                }
            }
            if written.is_none() {
                written = Some(made.iter().map(|it| it.0.clone()).collect());
            }
            for (held, assumed) in made {
                add(&mut all, held.clone());
                current.add((held, assumed));
            }
        }
        Some(all.all)
    }

    /// Each store is followed for each new value.
    fn values_of_stores_in_any_order(
        &mut self,
        place: Place,
        mut all: Distinct<Held>,
        joined: &FxHashSet<ExprId>,
    ) -> Option<Values> {
        let mut stores: Vec<ExprId> = joined.iter().copied().collect();
        stores.shared_sort_unstable();
        let mut first_new = 0;
        while first_new < all.len() && all.len() <= MOST_VALUES_JOINED {
            let new = all[first_new..].to_vec();
            first_new = all.len();
            for &stored in &stores {
                let Some(values) = self.values_stored(place, stored, new.clone()) else {
                    return Some(all.all);
                };
                for value in values {
                    add(&mut all, value);
                }
            }
        }
        Some(all.all)
    }

    /// `{ ...defaults, ...options }`: what can be followed is kept.
    /// An object may be spread into itself: `options = { ...options, ...more }`. Each literal is looked at once, and so is each name that is spread.
    fn read_property_beside_spreads(
        &mut self,
        mut pending: Vec<ExprId>,
        keys: &[Vec<u8>],
    ) -> Option<Values> {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        let mut values = Distinct::new();
        let mut literals: FxHashSet<ExprId> = pending.iter().copied().collect();
        let mut names: FxHashSet<SymbolId> = FxHashSet::default();
        while let Some(literal) = pending.pop() {
            let ExprKind::Object(properties) = expr_kind(hir, literal)? else {
                continue;
            };
            for id in properties.iter() {
                let property = hir[id];
                let is_asked_for = match (property.kind, hir.runtime_property_key(id)) {
                    (PropKind::Spread, _) => {
                        let spread = hir.skip_type_assertions(property.value);
                        if let (Some(ExprKind::Ident(_)), Binding::Symbol(name)) =
                            (expr_kind(hir, spread), bound.binding(spread))
                            && !names.insert(name)
                        {
                            continue;
                        }
                        false
                    }
                    (PropKind::Init | PropKind::Shorthand, PropKey::Name(name))
                        if keys.iter().any(|key| key == atoms.bytes(name)) =>
                    {
                        true
                    }
                    _ => continue,
                };
                for held in self.values_of_alternative(property.value)? {
                    match held {
                        held if is_asked_for => add(&mut values, held),
                        Held::Object(spread) if literals.insert(spread) => pending.push(spread),
                        _ => {}
                    }
                }
            }
        }
        Some(values.all)
    }

    /// `Object.assign({}, defaults, options)` returns an object that has what any of them has.
    fn values_of_assigned_objects(&mut self, call: Call) -> Option<Values> {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        if !self.follows_fields || !self.keeps_known_alternatives {
            return None;
        }
        let (holder, MemberKey::Name(name)) =
            hir.member_key(hir.skip_type_assertions(call.callee))?
        else {
            return None;
        };
        let holder = hir.skip_type_assertions(holder);
        if !is_free_name(hir, bound, holder, &[known::Object]) {
            return None;
        }
        let written = atoms.bytes(name);
        if self.is_following_passed
            && (name == known::freeze || matches!(written, b"seal" | b"preventExtensions"))
        {
            return self.values_of_alternative(hir.ids(call.args).next()?);
        }
        if written != b"assign" {
            return None;
        }
        let mut values = Distinct::new();
        for argument in hir.ids(call.args) {
            let held = self.values_of_alternative(argument)?;
            let objects = held.into_iter().filter(|it| matches!(it, Held::Object(_)));
            objects.for_each(|it| add(&mut values, it));
        }
        (!values.is_empty()).then_some(values.all)
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
        if self.plain_calls.contains(&e) {
            return self.values_returned_by_callee(call);
        }
        let left = self.expressions_left.get();
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
        if let Some(values) = self.values_of_assigned_objects(call) {
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
        if let Some(values) = self.values_of_map_method(callee, call.args) {
            return Some(values);
        }
        if let Some((_, MemberKey::Name(known::parse))) = hir.member_key(callee)
            && let Some(values) = self.values_of_new_url(call)
        {
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
        if let Some(values) = self.values_of_path_made_of_parts(callee, call.args) {
            return Some(values);
        }
        if let Some(values) = self.values_of_path_converted(callee, call.args) {
            return Some(values);
        }
        if let Some((list, MemberKey::Name(known::join))) = hir.member_key(callee)
            && let Some(lists) = self.values_of(list)
            && lists.iter().all(|value| matches!(value, Held::List(_)))
        {
            return self.values_of_joined_lists(&lists, call.args);
        }
        let is_name = matches!(expr_kind(hir, callee), Some(ExprKind::Ident(_)));
        if self.has_revisited && is_name && left != 0 && self.expressions_left.get() == left {
            self.plain_calls.insert(e);
        }
        self.values_returned_by_callee(call)
    }

    fn values_returned_by_callee(&mut self, call: Call) -> Option<Values> {
        let callee = self.inputs.hir.skip_type_assertions(call.callee);
        let Some(callees) = self.values_of(callee) else {
            return self.guess_own_folder(call);
        };
        let mut values = Distinct::new();
        for callee in callees {
            let returned = match callee {
                Held::Function(function) => self.values_returned_by(function, Some(call.args))?,
                Held::FunctionOfOs(name) => self.values_returned_by_function_of_os(name)?,
                _ => return self.guess_own_folder(call),
            };
            for value in returned {
                add(&mut values, value);
            }
        }
        Some(values.all)
    }

    /// `path.dirname(a)`, and `path.format({ dir: a, base: b })`.
    fn values_of_path_made_of_parts(
        &mut self,
        callee: ExprId,
        args: IdList<ExprId>,
    ) -> Option<Values> {
        let &ScanInputs { hir, atoms, .. } = self.inputs;
        let function = self.find_export_of_path(callee)?;
        if args.len() == 2 && atoms.bytes(function) == b"relative" {
            // A path from the working directory leads to the same file.
            let from = follow_settled_bindings(hir, self.inputs.bound, hir.id_at(args, 0));
            return match self.needs_no_contents_proof() && self.names_working_directory(from) {
                true => self.values_of(hir.id_at(args, 1)),
                false => None,
            };
        }
        let only = match args.len() {
            1 => hir.skip_type_assertions(hir.id_at(args, 0)),
            _ => return None,
        };
        match atoms.bytes(function) {
            b"dirname" => self.values_of_path_below(only, &[b"..".to_vec()]),
            b"format" => {
                let ExprKind::Object(properties) = expr_kind(hir, only)? else {
                    return None;
                };
                let (mut folder, mut base) = (None, None);
                for id in properties.iter() {
                    let property = hir[id];
                    match (property.kind, hir.runtime_property_key(id)) {
                        (PropKind::Init | PropKind::Shorthand, PropKey::Name(name)) => {
                            match atoms.bytes(name) {
                                b"dir" => folder = Some(property.value),
                                b"base" => base = Some(property.value),
                                _ => return None,
                            }
                        }
                        _ => return None,
                    }
                }
                let (folder, base) = folder.zip(base)?;
                let mut names = Vec::new();
                for held in self.values_of(base)? {
                    match held {
                        Held::Text(text) if text.end.is_none() && !text.starts_at_own_directory => {
                            names.push(text.start);
                        }
                        _ => return None,
                    }
                }
                self.pay_for(names.len())?;
                self.values_of_path_below(folder, &names)
            }
            _ => None,
        }
    }

    /// `Bun.resolveSync("./a", folder)` and `Buffer.from(a)`.
    fn values_of_path_converted(&mut self, callee: ExprId, args: IdList<ExprId>) -> Option<Values> {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        if !self.follows_assignments() || self.folder != Folder::OfFile {
            return None;
        }
        if let Some((name, folder)) = find_name_resolved_at_run_time(self.inputs, callee, args) {
            let mut names = self.values_of(name)?;
            names.retain(|it| {
                matches!(it, Held::Text(text)
                if text.start.starts_with(b"./") || text.start.starts_with(b"../"))
            });
            if names.is_empty() {
                return None;
            }
            let parts = vec![PartOfPath::Written(folder), PartOfPath::Held(names)];
            return self.join_parts_below_folder(parts, true);
        }
        let (buffer, MemberKey::Name(method)) = hir.member_key(callee)? else {
            return None;
        };
        let makes_buffer = args.len() == 1
            && atoms.bytes(method) == b"from"
            && is_free_name(
                hir,
                bound,
                hir.skip_type_assertions(buffer),
                &[atoms.intern(b"Buffer")],
            );
        if !makes_buffer {
            return None;
        }
        let mut texts = self.values_of(hir.id_at(args, 0))?;
        texts.retain(|it| matches!(it, Held::Text(text) if text.starts_at_own_directory));
        (!texts.is_empty()).then_some(texts)
    }

    /// `path.parse(a).dir`.
    fn values_of_part_of_parsed_path(&mut self, object: ExprId, key: MemberKey) -> Option<Values> {
        let &ScanInputs { hir, atoms, .. } = self.inputs;
        let ExprKind::Call(call) = expr_kind(hir, hir.skip_type_assertions(object))? else {
            return None;
        };
        let (call, MemberKey::Name(key)) = (hir[call], key) else {
            return None;
        };
        let callee = hir.skip_type_assertions(call.callee);
        let parses = call.args.len() == 1
            && atoms.bytes(key) == b"dir"
            && atoms.bytes(self.find_export_of_path(callee)?) == b"parse";
        match parses {
            true => self.values_of_path_below(hir.id_at(call.args, 0), &[b"..".to_vec()]),
            false => None,
        }
    }

    /// The whole paths of `folder` from the own folder, and what `path.resolve(folder, name)` is for each of `names`.
    fn values_of_path_below(&mut self, folder: ExprId, names: &[Vec<u8>]) -> Option<Values> {
        let skips_unknown_folders = self.needs_no_contents_proof();
        let own_file = self.find_own_file(folder);
        let folders = match own_file {
            Some(own_file) => vec![Held::Text(own_file)],
            None => self.values_of(folder)?,
        };
        let mut values = Distinct::new();
        for held in folders {
            let from_own_folder = match &held {
                Held::Text(text) if text.starts_at_own_directory && !text.is_file_url => Some(text),
                // The file that is found lies in the folder that is asked for.
                Held::Resolved(text, _) if text.start.starts_with(b"./") => Some(text),
                _ => None,
            };
            let Some(text) = from_own_folder.filter(|text| text.end.is_none()) else {
                if skips_unknown_folders {
                    continue;
                }
                return None;
            };
            let start = text.start.strip_prefix(b".").unwrap_or(&text.start);
            for name in names {
                let mut path = PathBelowFolder::default();
                path.push(start.strip_prefix(b"/").unwrap_or(start), true)?;
                path.push(name, true)?;
                let written = path.write(PathEnd {
                    is_join: true,
                    is_followed: false,
                });
                let start = [b".", &written[..]].concat();
                let below = Text {
                    starts_at_own_directory: true,
                    ..Text::whole(&start)
                };
                add(&mut values, Held::Text(below));
            }
        }
        (!values.is_empty()).then_some(values.all)
    }

    /// An unknown function whose only argument is the URL of this file usually returns its folder.
    fn guess_own_folder(&mut self, call: Call) -> Option<Values> {
        let hir = self.inputs.hir;
        if !self.trusts_import_meta || !self.keeps_known_alternatives || call.args.len() != 1 {
            return None;
        }
        let callee = hir.skip_type_assertions(call.callee);
        let is_of_path_or_url = self.find_export_of_path(callee).is_some()
            || (self.find_export_of(callee, &[b"url", b"node:url"])).is_some();
        if is_of_path_or_url {
            return None;
        }
        let argument = hir.skip_type_assertions(hir.id_at(call.args, 0));
        let names_own_file = matches!(expr_kind(hir, argument), Some(ExprKind::ImportMeta))
            || self.names_own_url(argument)
            || self.find_own_file(argument).is_some();
        (names_own_file && self.folder == Folder::OfFile).then(|| {
            vec![Held::Text(Text {
                starts_at_own_directory: true,
                ..Text::whole(b".")
            })]
        })
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
        let known = Some(match self.keeps_known_alternatives {
            true => &self.written_names.8,
            false => &self.written_names.1,
        });
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

    /// `path.sep` itself: `parts.join(path.sep)` is another string.
    fn names_path_separator(&self, e: ExprId) -> bool {
        let &ScanInputs { hir, atoms, .. } = self.inputs;
        let known = Some(&self.written_names.1);
        let find = |e| self.find_export_passing(e, &PATH_MODULES, known, false);
        let is_separator = |name: Atom| atoms.bytes(name) == b"sep";
        find(e).is_some_and(is_separator)
            || match hir.member_key(e) {
                Some((object, MemberKey::Name(name))) if is_separator(name) => {
                    let object = find(hir.skip_type_assertions(object));
                    object.is_some_and(|it| atoms.bytes(it) == b"posix")
                }
                _ => false,
            }
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
        self.find_export_passing(callee, names, known, self.keeps_known_alternatives)
    }

    fn find_export_passing(
        &self,
        callee: ExprId,
        names: &[&[u8]],
        known: Option<&MembersBehindNames>,
        wrappers: bool,
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
        let passes = Passes {
            awaited_imports: false,
            wrappers,
        };
        find_export_of_module_with(
            hir,
            bound,
            callee,
            &find_constant,
            &is_module,
            passes,
            known,
        )
    }

    fn values_of_new_url(&mut self, call: Call) -> Option<Values> {
        let &ScanInputs {
            hir, bound, atoms, ..
        } = self.inputs;
        let mut callee = hir.skip_type_assertions(call.callee);
        if let Some((object, MemberKey::Name(known::parse))) = hir.member_key(callee) {
            callee = hir.skip_type_assertions(object);
        }
        if !is_free_name(hir, bound, callee, &[atoms.intern(b"URL")]) {
            return None;
        }
        let mut arguments = hir.ids(call.args);
        let (written, base) = (arguments.next()?, arguments.next());
        let is_spread = |e| matches!(expr_kind(hir, e), Some(ExprKind::Spread(_)) | None);
        if is_spread(written) || base.is_some_and(is_spread) {
            return None;
        }
        let mut written = self
            .values_apart_from_itself(written)
            .unwrap_or_else(some_text);
        if self.trusts_import_meta {
            written.retain(|it| *it != Held::Primitive(Constant::Undefined));
        }
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
        // A relative URL without a base throws.
        let is_missing =
            |value: &Held| matches!(value, Held::Primitive(Constant::Undefined | Constant::Null));
        let bases = self.values_of(base)?.into_iter();
        let folders = bases.filter(|base| !is_missing(base)).map(|value| {
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
        self.folder == Folder::OfFile
            && reads_import_meta_url(self.inputs.hir, e)
            && !self.import_meta_may_be_modified()
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
            let is_part = method == b"concat"
                || self.keeps_known_alternatives
                    && given.len() == 1
                    && matches!(method, b"replace" | b"replaceAll");
            given.push(match is_part {
                true => self
                    .values_apart_from_itself(argument)
                    .unwrap_or_else(some_text),
                false => self.values_of(argument)?,
            });
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
            if let Some(text) = replace_by_unknown(text, method, &arguments) {
                add(&mut values, Held::Text(text));
                continue;
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

    /// An embedded file is reached through no link, so its real path is the path that is asked about.
    fn values_of_real_path(&mut self, callee: ExprId, args: IdList<ExprId>) -> Option<Values> {
        let &ScanInputs { hir, atoms, .. } = self.inputs;
        use ResolvedForm::{Path, UrlObject};
        let function = match hir.member_key(callee) {
            Some((function, MemberKey::Name(name))) if atoms.bytes(name) == b"native" => {
                hir.skip_type_assertions(function)
            }
            _ => callee,
        };
        let export = self.find_export_of(function, &[b"fs", b"node:fs"])?;
        if atoms.bytes(export) != b"realpathSync" {
            return None;
        }
        let asked = self.values_of(hir.ids(args).next()?)?;
        let paths = asked.into_iter().map(|value| match value {
            Held::Text(_) | Held::Resolved(_, Path) => Some(value),
            Held::Url(name) => Some(Held::Text(name)),
            Held::Resolved(name, UrlObject) => Some(Held::Resolved(name, Path)),
            _ => None,
        });
        paths.collect()
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
        if let Some(values) = self.values_of_real_path(callee, args) {
            return Some(values);
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

    /// The parts that `args` pass: one list for each list that is spread among them.
    fn parts_of_path(&mut self, args: IdList<ExprId>) -> Vec<Vec<PartOfPath>> {
        let hir = self.inputs.hir;
        let mut paths: Vec<Vec<PartOfPath>> = vec![Vec::new()];
        for argument in hir.ids(args) {
            let lists = match hir[argument].kind {
                ExprKind::Spread(list) if self.follows_assignments() => {
                    self.follow_passed(&mut |follower| follower.values_of(list))
                }
                _ => None,
            };
            let lists = lists.unwrap_or_default();
            let is_list = |it: &Held| matches!(it, Held::List(_));
            if lists.is_empty()
                || !lists.iter().all(is_list)
                || self.pay_for_pairs(paths.len(), lists.len()).is_none()
            {
                (paths.iter_mut()).for_each(|it| it.push(PartOfPath::Written(argument)));
                continue;
            }
            let mut longer = Vec::with_capacity(paths.len() * lists.len());
            for path in &paths {
                for list in &lists {
                    if let Held::List(places) = list {
                        let spread = places.iter().cloned().map(PartOfPath::Held);
                        longer.push(path.iter().cloned().chain(spread).collect());
                    }
                }
            }
            paths = longer;
        }
        paths
    }

    fn values_of_path_below_folder(
        &mut self,
        args: IdList<ExprId>,
        is_join: bool,
    ) -> Option<Values> {
        let mut paths = self.parts_of_path(args);
        if paths.len() == 1 {
            return self.join_parts_below_folder(paths.pop()?, is_join);
        }
        let mut values = Distinct::new();
        for parts in paths {
            let below = self.join_parts_below_folder(parts, is_join);
            (below.unwrap_or_default().into_iter()).for_each(|it| add(&mut values, it));
        }
        (!values.is_empty()).then_some(values.all)
    }

    fn join_parts_below_folder(&mut self, parts: Vec<PartOfPath>, is_join: bool) -> Option<Values> {
        let mut arguments = parts.into_iter();
        let mut folders = match arguments.next()? {
            PartOfPath::Written(folder) => self.values_of(folder)?,
            PartOfPath::Held(folders) => folders,
        };
        let mut below_themselves = Distinct::new();
        folders.retain(|folder| match *folder {
            Held::Itself(place) | Held::BelowItself(place) => {
                add(&mut below_themselves, Held::BelowItself(place));
                false
            }
            _ => true,
        });
        let own_directory = Text {
            starts_at_own_directory: true,
            ..Text::whole(b".")
        };
        let mut paths: Vec<Vec<Text>> = Vec::with_capacity(folders.len());
        let skips_unknown_folders = self.needs_no_contents_proof();
        for folder in &folders {
            let Held::Text(folder) = folder else {
                self.ask_where_file_lies(folder);
                if skips_unknown_folders {
                    continue;
                }
                return None;
            };
            if !folder.starts_at_own_directory || folder.is_file_url {
                if skips_unknown_folders {
                    continue;
                }
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
            let values = match argument {
                PartOfPath::Written(argument) => self.values_apart_from_itself(argument),
                PartOfPath::Held(values) => Some(values),
            };
            let mut values = values.unwrap_or_else(some_text);
            if self.follows_assignments() {
                values.retain(|it| matches!(it, Held::Text(_)));
                if values.is_empty() {
                    values = some_text();
                }
            }
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
            joined.start.extend(path.write(PathEnd {
                is_join,
                is_followed: !rest.is_empty(),
            }));
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

    /// Without `arguments` the function may be a closure that an earlier call made.
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
        {
            return None;
        }
        let mut in_progress = self.functions_in_progress.iter();
        if let Some(place) = in_progress.position(|&it| it == function) {
            self.met_in_progress.function = self.met_in_progress.function.min(place);
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

fn reads_import_meta_url(hir: &File<'_>, e: ExprId) -> bool {
    let e = hir.skip_type_assertions(e);
    matches!(expr_kind(hir, e), Some(ExprKind::Dot { obj, name, chain: Chain::No, .. })
        if name == known::url
            && matches!(expr_kind(hir, hir.skip_type_assertions(obj)), Some(ExprKind::ImportMeta)))
}

pub(super) fn names_own_url(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    reads_import_meta_url(hir, e) && !bound.import_meta_may_be_modified()
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

fn close_over_itself(place: Place, mut values: Values) -> Option<Values> {
    let holds_longer_ones = values.contains(&Held::BelowItself(place));
    values.retain(|value| *value != Held::Itself(place) && *value != Held::BelowItself(place));
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

/// `"pages/NAME.html".replace("NAME", name)`
fn replace_by_unknown(text: &Text, method: &[u8], arguments: &[&Held]) -> Option<Text> {
    let [Held::Text(replaced), Held::Text(replacement)] = arguments else {
        return None;
    };
    if text.end.is_some() || replaced.end.is_some() || replaced.start.is_empty() {
        return None;
    }
    replacement.end.as_ref()?;
    let first = strings::index_of(&text.start, &replaced.start)?;
    let last = match method {
        b"replace" => first,
        _ => strings::last_index_of(&text.start, &replaced.start)?,
    };
    Some(Text {
        start: text.start[..first].to_vec(),
        end: Some(text.start[last + replaced.start.len()..].to_vec()),
        ..text.clone()
    })
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

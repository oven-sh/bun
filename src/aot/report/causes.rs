use core::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

use bun_options_types::aot_options::ExplainSet;
use bun_sema::util::SharedSort;

use super::format::{code_of, write_count, write_counted, write_percent};
use super::json::JsonWriter;
use super::levels::{ProgramTotals, compute_totals};
use super::model::OriginCounts;
use super::positions::{PathStyle, Positions, write_shown_position};
use super::summary::{write_access_counts, write_level_counts};
use super::wording::{DOCUMENTATION_URL, cause_code, cause_wording, ill_typed_cause_wording};
use super::{ReportEntry, ReportInput};
use crate::engine::{AccessRecord, Position, position_of};
use crate::ir::generated::{
    AccessCost, AccessKind, IllTypedCause, UnprovenCause, UnprovenCauseFamily,
};
use crate::ir::ids::{FunctionId, LayoutId, ModuleId};
use crate::link::{ModuleOrigin, ProgramNames};
use crate::statistics::LimitId;

const MAX_SHOWN_CAUSES: usize = 20;
const MAX_NAMED_TYPES: usize = 8;

#[derive(PartialEq, Eq, Debug)]
pub(super) struct Cause {
    pub cause: UnprovenCause,
    pub ill_typed_cause: IllTypedCause,
    pub limit: LimitId,
    pub position: Option<Position>,
    pub function: Option<FunctionId>,
    pub layouts: Vec<LayoutId>,
    pub accesses: OriginCounts,
    pub calls: OriginCounts,
    pub operators: OriginCounts,
    /// The operations that have no other root: the fix types them.
    pub alone: u64,
    pub cost: EstimatedCost,
    /// The position is in one of Bun's own modules.
    pub is_in_runtime: bool,
}

#[derive(Default)]
struct CauseGroup {
    function: Option<FunctionId>,
    layouts: BTreeSet<LayoutId>,
    accesses: OriginCounts,
    calls: OriginCounts,
    operators: OriginCounts,
    alone: u64,
    cost: EstimatedCost,
}

/// Instructions that types would save, by the compiler's own estimate of how often each operation runs.
#[derive(Copy, Clone, Default, PartialEq, Debug)]
pub(super) struct EstimatedCost {
    pub program: f64,
    pub dependencies: f64,
}

impl Eq for EstimatedCost {}

impl EstimatedCost {
    fn add_for_origin(&mut self, origin: ModuleOrigin, cost: f64) {
        match origin {
            ModuleOrigin::Program => self.program += cost,
            ModuleOrigin::Dependency => self.dependencies += cost,
            ModuleOrigin::Runtime => {}
        }
    }

    fn total(self) -> f64 {
        self.program + self.dependencies
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum OperationClass {
    PropertyAccess,
    Call,
    Operator,
}

type CauseKey = (UnprovenCause, LimitId, IllTypedCause, Option<Position>);

type RankOrder = (
    bool,
    Reverse<u64>,
    Reverse<u64>,
    Reverse<u64>,
    Reverse<u64>,
    bool,
    Option<Position>,
    UnprovenCause,
    LimitId,
    IllTypedCause,
);

impl Cause {
    fn operations(&self) -> OriginCounts {
        OriginCounts {
            program: self.accesses.program + self.calls.program + self.operators.program,
            dependencies: self.accesses.dependencies
                + self.calls.dependencies
                + self.operators.dependencies,
        }
    }

    fn is_in_dependency(&self) -> bool {
        self.operations().program == 0
    }
}

pub(super) fn operation_class(kind: AccessKind) -> Option<OperationClass> {
    match kind {
        AccessKind::Unknown => None,
        AccessKind::Read
        | AccessKind::Store
        | AccessKind::Define
        | AccessKind::Has
        | AccessKind::Delete => Some(OperationClass::PropertyAccess),
        AccessKind::Call | AccessKind::Construct => Some(OperationClass::Call),
        AccessKind::Truthiness
        | AccessKind::Equality
        | AccessKind::Arithmetic
        | AccessKind::Comparison
        | AccessKind::Conversion
        | AccessKind::TypeOf
        | AccessKind::InstanceOf
        | AccessKind::Iteration
        | AccessKind::Spread => Some(OperationClass::Operator),
    }
}

#[cfg(test)]
pub(super) fn is_property_access(kind: AccessKind) -> bool {
    operation_class(kind) == Some(OperationClass::PropertyAccess)
}

/// About how many instructions the operation executes beyond what it would with types. From test/aot/perf/operations.
fn instructions_saved_by_types(record: &AccessRecord) -> u32 {
    match (record.kind, record.cost) {
        (_, AccessCost::Free) | (AccessKind::Unknown, _) => 0,
        (AccessKind::Call | AccessKind::Construct, AccessCost::ByName) => 13,
        (AccessKind::Call | AccessKind::Construct, _) => 0,
        (_, AccessCost::TestsSlot) => 1,
        (_, AccessCost::TestsReceiver) => 2,
        (AccessKind::Truthiness, _) => 8,
        (AccessKind::TypeOf, _) => 6,
        (AccessKind::Equality, _) => 10,
        (AccessKind::Arithmetic | AccessKind::Comparison | AccessKind::Conversion, _) => 12,
        (AccessKind::InstanceOf, _) => 20,
        (AccessKind::Iteration, _) => 40,
        (AccessKind::Spread, _) => 60,
        (
            AccessKind::Read
            | AccessKind::Store
            | AccessKind::Define
            | AccessKind::Has
            | AccessKind::Delete,
            AccessCost::ByName,
        ) => 28,
    }
}

/// An operation without an estimate counts as one that runs once.
fn weight_of(heat: f64) -> f64 {
    if heat > 0.0 { heat } else { 1.0 }
}

/// Nothing in the program's text changes these.
fn is_fixed_in_the_compiler(cause: UnprovenCause) -> bool {
    matches!(
        cause,
        UnprovenCause::Unknown | UnprovenCause::ResultDisabled | UnprovenCause::LeftByPasses
    )
}

fn access_origin(
    record: &AccessRecord,
    origin_of: &dyn Fn(ModuleId) -> ModuleOrigin,
) -> ModuleOrigin {
    match position_of(record.location) {
        Some(position) => origin_of(position.module),
        None => ModuleOrigin::Program,
    }
}

fn family_bit(family: UnprovenCauseFamily) -> ExplainSet {
    match family {
        UnprovenCauseFamily::UnknownCode => ExplainSet::ONLY_UNKNOWN_CODE,
        UnprovenCauseFamily::UnprovenType => ExplainSet::ONLY_UNPROVEN_TYPE,
        UnprovenCauseFamily::Mutation => ExplainSet::ONLY_MUTATION,
        UnprovenCauseFamily::Limit => ExplainSet::ONLY_LIMIT,
    }
}

fn is_family_selected(families: ExplainSet, family: UnprovenCauseFamily) -> bool {
    families.is_empty() || families.contains(family_bit(family))
}

// The bits of a number that is not negative ascend with it.
fn rank_order(cause: &Cause) -> RankOrder {
    (
        is_fixed_in_the_compiler(cause.cause) || cause.is_in_runtime,
        Reverse(cause.cost.program.to_bits()),
        Reverse(cause.cost.dependencies.to_bits()),
        Reverse(cause.operations().program),
        Reverse(cause.operations().dependencies),
        cause.position.is_none(),
        cause.position,
        cause.cause,
        cause.limit,
        cause.ill_typed_cause,
    )
}

pub(super) fn collect_causes(
    records: &[AccessRecord],
    origin_of: &dyn Fn(ModuleId) -> ModuleOrigin,
    families: ExplainSet,
) -> Vec<Cause> {
    let mut groups: BTreeMap<CauseKey, CauseGroup> = BTreeMap::new();
    for record in records {
        let saved = instructions_saved_by_types(record);
        let Some(class) = operation_class(record.kind) else {
            continue;
        };
        if saved == 0 || !is_family_selected(families, record.cause.family()) {
            continue;
        }
        let origin = access_origin(record, origin_of);
        if origin == ModuleOrigin::Runtime {
            continue;
        }
        let key = (
            record.cause,
            record.limit,
            record.ill_typed_cause,
            position_of(record.witness.location),
        );
        let group = groups.entry(key).or_insert_with(|| CauseGroup {
            function: record.witness.function_id(),
            ..CauseGroup::default()
        });
        let counts = match class {
            OperationClass::PropertyAccess => &mut group.accesses,
            OperationClass::Call => &mut group.calls,
            OperationClass::Operator => &mut group.operators,
        };
        counts.add_for_origin(origin, 1);
        group.alone += u64::from(record.has_other_roots == 0);
        group
            .cost
            .add_for_origin(origin, weight_of(record.heat) * f64::from(saved));
        group.layouts.extend(record.layout_id());
    }

    let mut causes: Vec<Cause> = groups
        .into_iter()
        .map(|((cause, limit, ill_typed_cause, position), group)| Cause {
            cause,
            ill_typed_cause,
            limit,
            position,
            function: group.function,
            layouts: group.layouts.into_iter().collect(),
            accesses: group.accesses,
            calls: group.calls,
            operators: group.operators,
            alone: group.alone,
            cost: group.cost,
            is_in_runtime: position
                .is_some_and(|position| origin_of(position.module) == ModuleOrigin::Runtime),
        })
        .collect();
    causes.shared_sort_unstable_by_key(rank_order);
    causes
}

fn causes_of(input: &ReportInput<'_>, families: ExplainSet) -> Vec<Cause> {
    let origin_of = |module: ModuleId| input.names.module_origin(module);
    collect_causes(input.engine.accesses(), &origin_of, families)
}

fn function_name<'a>(cause: &Cause, names: &'a ProgramNames) -> &'a [u8] {
    match cause.function {
        Some(function) => names.function_name(function),
        None => b"",
    }
}

fn type_names<'a>(cause: &Cause, names: &'a ProgramNames) -> Vec<&'a [u8]> {
    let mut seen = BTreeSet::new();
    cause
        .layouts
        .iter()
        .map(|&layout| names.layout_name(layout))
        .filter(|&name| !name.is_empty() && seen.insert(name))
        .collect()
}

fn limit_name(limit: LimitId) -> Option<&'static [u8]> {
    (limit != LimitId::None).then(|| limit.name().as_bytes())
}

fn documentation_url(code: &[u8]) -> Vec<u8> {
    [DOCUMENTATION_URL, code].concat()
}

fn tenths_of_percent(part: f64, whole: f64) -> u32 {
    if whole > 0.0 {
        (part / whole * 1000.0) as u32
    } else {
        0
    }
}

fn total_cost(causes: &[Cause]) -> f64 {
    causes.iter().map(|cause| cause.cost.total()).sum()
}

fn write_other_operations(out: &mut Vec<u8>, cause: &Cause) {
    let (calls, operators) = (cause.calls.total(), cause.operators.total());
    if calls > 0 {
        write_counted(out, calls, "indirect call", "indirect calls");
    }
    if operators > 0 {
        if calls > 0 {
            out.extend_from_slice(b", ");
        }
        write_counted(out, operators, "untyped operator", "untyped operators");
    }
}

fn write_estimate(out: &mut Vec<u8>, cause: &Cause, whole: f64) {
    out.extend_from_slice(b"about ");
    write_percent(out, tenths_of_percent(cause.cost.total(), whole));
    out.extend_from_slice(
        b" of the time in untyped operations, by how often the compiler expects each to run",
    );
}

fn write_other_roots(out: &mut Vec<u8>, cause: &Cause) {
    let others = cause.operations().total() - cause.alone;
    if others > 0 {
        write_count(out, others);
        out.extend_from_slice(b" of these stay untyped until other entries are fixed too");
    }
}

fn write_share(out: &mut Vec<u8>, cause: &Cause, totals: &ProgramTotals) {
    if cause.accesses.total() == 0 {
        return;
    }
    let dependency_total = totals.dependencies.access_costs.not_free();
    if cause.accesses.program == 0 {
        write_count(out, cause.accesses.dependencies);
        out.extend_from_slice(b" of ");
        write_counted(out, dependency_total, "untyped access", "untyped accesses");
        out.extend_from_slice(b" in dependencies");
        return;
    }
    let program_total = totals.program.access_costs.not_free();
    write_count(out, cause.accesses.program);
    out.extend_from_slice(b" of ");
    write_counted(out, program_total, "untyped access", "untyped accesses");
    if cause.accesses.dependencies > 0 {
        out.extend_from_slice(b", and ");
        write_count(out, cause.accesses.dependencies);
        out.extend_from_slice(b" of ");
        write_count(out, dependency_total);
        out.extend_from_slice(b" in dependencies");
    }
}

fn write_function_name(out: &mut Vec<u8>, function_name: &[u8]) {
    if function_name.is_empty() {
        return;
    }
    out.extend_from_slice(b"in function '");
    out.extend_from_slice(function_name);
    out.push(b'\'');
}

fn write_type_names(out: &mut Vec<u8>, label: &[u8], type_names: &[&[u8]]) {
    let shown = &type_names[..type_names.len().min(MAX_NAMED_TYPES)];
    if shown.is_empty() {
        return;
    }
    out.extend_from_slice(label);
    out.push(b'\'');
    out.extend_from_slice(&shown.join(&b"', '"[..]));
    out.push(b'\'');
    if type_names.len() > shown.len() {
        out.extend_from_slice(b" and ");
        write_count(out, (type_names.len() - shown.len()) as u64);
        out.extend_from_slice(b" more");
    }
}

fn write_limit_value(out: &mut Vec<u8>, limit: LimitId, value: u64) {
    let Some(name) = limit_name(limit) else {
        return;
    };
    out.extend_from_slice(b"limit ");
    out.extend_from_slice(name);
    out.extend_from_slice(b" = ");
    write_count(out, value);
    out.extend_from_slice(b" (limits ");
    out.extend_from_slice(limit.purpose().as_bytes());
    out.push(b')');
}

fn write_ill_typed_cause(out: &mut Vec<u8>, cause: IllTypedCause) {
    let Some(wording) = ill_typed_cause_wording(cause) else {
        return;
    };
    out.extend_from_slice(b"why (");
    out.extend_from_slice(wording.code.as_bytes());
    out.extend_from_slice(b"): ");
    out.extend_from_slice(wording.message.as_bytes());
}

fn no_cause_sentence(totals: &ProgramTotals, families: ExplainSet) -> &'static [u8] {
    match (
        families.is_empty(),
        totals.combined().access_costs.not_free(),
    ) {
        (false, _) => b"No causes of this kind.",
        (true, 0) => b"Every property access is typed. Nothing to fix.",
        (true, _) => b"The compiler recorded no cause for the untyped property accesses.",
    }
}

fn heading_entry(cause_count: usize) -> ReportEntry {
    let mut heading = b"Untyped code works, but runs slower. ".to_vec();
    write_counted(&mut heading, cause_count as u64, "cause", "causes");
    heading.push(b':');
    ReportEntry::line(ExplainSet::TEXT, heading)
}

fn footer_entry(cause_count: usize) -> Option<ReportEntry> {
    if cause_count <= MAX_SHOWN_CAUSES {
        return None;
    }
    let hidden = (cause_count - MAX_SHOWN_CAUSES) as u64;
    let mut footer = Vec::new();
    write_counted(&mut footer, hidden, "more cause", "more causes");
    footer.extend_from_slice(
        b" not shown. Use --explain=json to print all of them, one JSON object per line.",
    );
    Some(ReportEntry::line(ExplainSet::TEXT, footer))
}

fn text_entry(
    cause: &Cause,
    rank: usize,
    totals: &ProgramTotals,
    names: &ProgramNames,
    limit_value: u64,
    whole_cost: f64,
) -> ReportEntry {
    let wording = cause_wording(cause.cause);
    let code = cause_code(cause.cause).as_bytes();

    let mut text = format!("{rank}. ").into_bytes();
    text.extend_from_slice(code);
    text.extend_from_slice(b": ");
    text.extend_from_slice(wording.message.as_bytes());

    let mut share = Vec::new();
    write_share(&mut share, cause, totals);
    let mut others = Vec::new();
    write_other_operations(&mut others, cause);
    let mut estimate = Vec::new();
    write_estimate(&mut estimate, cause, whole_cost);
    let mut other_roots = Vec::new();
    write_other_roots(&mut other_roots, cause);
    let mut function = Vec::new();
    write_function_name(&mut function, function_name(cause, names));
    let mut types = Vec::new();
    write_type_names(&mut types, b"types: ", &type_names(cause, names));
    let mut limit = Vec::new();
    write_limit_value(&mut limit, cause.limit, limit_value);
    let mut why = Vec::new();
    write_ill_typed_cause(&mut why, cause.ill_typed_cause);
    let fix = [&b"fix: "[..], wording.fix.as_bytes()].concat();
    let url = documentation_url(code);

    let mut entry = ReportEntry {
        kind: ExplainSet::TEXT,
        text,
        position: cause.position,
        notes: Vec::new(),
    };
    for note in [
        share,
        others,
        estimate,
        other_roots,
        function,
        types,
        limit,
        why,
        fix,
        url,
    ] {
        if !note.is_empty() {
            entry.add_note(note);
        }
    }
    entry
}

fn numbers_entry(totals: &ProgramTotals, cause_count: usize) -> ReportEntry {
    let (program, dependencies) = (&totals.program, &totals.dependencies);
    let mut json = JsonWriter::object();
    write_access_counts(&mut json, "accesses", program);
    write_access_counts(&mut json, "dependencyAccesses", dependencies);
    write_level_counts(&mut json, "calls", &program.calls);
    json.number("causes", cause_count as u64);
    ReportEntry::line(ExplainSet::JSON, json.finish())
}

fn write_ill_typed_member(json: &mut JsonWriter, cause: IllTypedCause) {
    let Some(wording) = ill_typed_cause_wording(cause) else {
        json.null("why");
        return;
    };
    json.begin_object("why");
    json.string("reason", wording.code.as_bytes());
    json.string("message", wording.message.as_bytes());
    json.string("fix", wording.fix.as_bytes());
    json.string("url", &documentation_url(wording.code.as_bytes()));
    json.end_object();
}

fn json_entry(
    cause: &Cause,
    rank: usize,
    names: &ProgramNames,
    positions: &mut Positions<'_>,
    whole_cost: f64,
) -> ReportEntry {
    let wording = cause_wording(cause.cause);
    let code = cause_code(cause.cause).as_bytes();
    let shown = positions.resolve_optional(cause.position);
    let source = match cause.position {
        Some(position) => positions.source_line(position),
        None => Vec::new(),
    };
    let (file, line, column) = match &shown {
        Some(shown) => (&shown.path[..], shown.line, shown.column),
        None => (&b""[..], 0, 0),
    };

    let mut json = JsonWriter::object();
    json.number("rank", rank as u64);
    json.string("reason", code);
    json.optional_string("limit", limit_name(cause.limit));
    json.string("file", file);
    json.number("line", u64::from(line));
    json.number("column", u64::from(column));
    json.boolean("inDependency", cause.is_in_dependency());
    json.string("source", &source);
    json.string("message", wording.message.as_bytes());
    json.string("fix", wording.fix.as_bytes());
    json.string("url", &documentation_url(code));
    json.number("accesses", cause.accesses.program);
    json.number("dependencyAccesses", cause.accesses.dependencies);
    json.number("calls", cause.calls.total());
    json.number("operators", cause.operators.total());
    json.number("fixedByThisAlone", cause.alone);
    let share = tenths_of_percent(cause.cost.total(), whole_cost);
    json.tenths("estimatedPercent", share);
    json.string("function", function_name(cause, names));
    json.strings("types", type_names(cause, names).into_iter());
    json.string("family", &code_of(cause.cause.family().name()));
    write_ill_typed_member(&mut json, cause.ill_typed_cause);
    ReportEntry {
        kind: ExplainSet::JSON,
        text: json.finish(),
        position: cause.position,
        notes: Vec::new(),
    }
}

fn list_entry(cause: &Cause, names: &ProgramNames, positions: &mut Positions<'_>) -> ReportEntry {
    let family = cause.cause.family();
    let shown = positions.resolve_optional(cause.position);

    let mut text = code_of(family.name());
    text.extend_from_slice(b": ");
    text.extend_from_slice(cause_code(cause.cause).as_bytes());
    text.extend_from_slice(b" at ");
    write_shown_position(&mut text, shown.as_ref());
    text.extend_from_slice(b", ");
    write_counted(&mut text, cause.accesses.total(), "access", "accesses");
    if cause.calls.total() + cause.operators.total() > 0 {
        text.extend_from_slice(b", ");
        write_other_operations(&mut text, cause);
    }
    write_type_names(&mut text, b", types ", &type_names(cause, names));
    if let Some(wording) = ill_typed_cause_wording(cause.ill_typed_cause) {
        text.extend_from_slice(b", why ");
        text.extend_from_slice(wording.code.as_bytes());
    }
    ReportEntry {
        kind: family_bit(family),
        text,
        position: cause.position,
        notes: Vec::new(),
    }
}

fn collect_ranked_entries(
    causes: &[Cause],
    out: &mut Vec<ReportEntry>,
    mut entry_of: impl FnMut(&Cause, usize) -> ReportEntry,
) {
    let mut by_position: Vec<usize> = (0..causes.len()).collect();
    by_position.shared_sort_unstable_by_key(|&index| causes[index].position);
    let mut entries: Vec<Option<ReportEntry>> = vec![None; causes.len()];
    // Ascending, so the locator scans the text of each module once.
    for index in by_position {
        entries[index] = Some(entry_of(&causes[index], index + 1));
    }
    out.extend(entries.into_iter().flatten());
}

fn collect_text_entries(
    causes: &[Cause],
    totals: &ProgramTotals,
    names: &ProgramNames,
    limit_value_of: impl Fn(LimitId) -> u64,
    out: &mut Vec<ReportEntry>,
) {
    out.push(heading_entry(causes.len()));
    let whole_cost = total_cost(causes);
    for (index, cause) in causes.iter().take(MAX_SHOWN_CAUSES).enumerate() {
        let limit_value = limit_value_of(cause.limit);
        let rank = index + 1;
        out.push(text_entry(
            cause,
            rank,
            totals,
            names,
            limit_value,
            whole_cost,
        ));
    }
    out.extend(footer_entry(causes.len()));
}

fn collect_json_entries(
    causes: &[Cause],
    totals: &ProgramTotals,
    names: &ProgramNames,
    positions: &mut Positions<'_>,
    out: &mut Vec<ReportEntry>,
) {
    out.push(numbers_entry(totals, causes.len()));
    let whole_cost = total_cost(causes);
    collect_ranked_entries(causes, out, |cause, rank| {
        json_entry(cause, rank, names, positions, whole_cost)
    });
}

pub(super) fn collect_text(
    input: &ReportInput<'_>,
    families: ExplainSet,
    out: &mut Vec<ReportEntry>,
) {
    let totals = compute_totals(input);
    let causes = causes_of(input, families);
    if causes.is_empty() {
        let sentence = no_cause_sentence(&totals, families);
        out.push(ReportEntry::line(ExplainSet::TEXT, sentence.to_vec()));
        return;
    }
    let limit_value_of = |limit| input.engine.limit_value(limit);
    collect_text_entries(&causes, &totals, input.names, limit_value_of, out);
}

pub(super) fn collect_json(
    input: &ReportInput<'_>,
    families: ExplainSet,
    out: &mut Vec<ReportEntry>,
) {
    let totals = compute_totals(input);
    let causes = causes_of(input, families);
    let mut positions = Positions::new(input, PathStyle::Posix);
    collect_json_entries(&causes, &totals, input.names, &mut positions, out);
}

pub(super) fn collect_list(
    input: &ReportInput<'_>,
    families: ExplainSet,
    out: &mut Vec<ReportEntry>,
) {
    let mut positions = Positions::new(input, PathStyle::Native);
    collect_ranked_entries(&causes_of(input, families), out, |cause, _| {
        list_entry(cause, input.names, &mut positions)
    });
}

#[cfg(test)]
mod tests;

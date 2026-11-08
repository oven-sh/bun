use core::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

use bun_options_types::aot_options::ExplainSet;
use bun_sema::util::SharedSort;

use super::format::{code_of, write_count, write_counted, write_parts};
use super::json::JsonWriter;
use super::levels::{ProgramTotals, compute_totals};
use super::model::OriginCounts;
use super::names::Names;
use super::positions::{PathStyle, Positions, write_position_members, write_shown_position};
use super::source_texts::ModuleOrigin;
use super::summary::{write_access_counts, write_level_counts};
use super::wording::{DOCUMENTATION_URL, cause_code, cause_wording, ill_typed_cause_wording};
use super::{ReportEntry, ReportInput};
use crate::engine::{AccessRecord, Position, position_of};
use crate::ir::generated::{
    AccessCost, AccessKind, IllTypedCause, UnprovenCause, UnprovenCauseFamily,
};
use crate::ir::ids::{FunctionId, LayoutId, ModuleId};

const MAX_SHOWN_CAUSES: usize = 20;
const MAX_NAMED_TYPES: usize = 8;

#[derive(PartialEq, Eq, Debug)]
pub(super) struct Cause {
    pub cause: UnprovenCause,
    pub ill_typed_cause: IllTypedCause,
    pub position: Option<Position>,
    pub function: Option<FunctionId>,
    pub layouts: Vec<LayoutId>,
    pub accesses: OriginCounts,
    pub calls: OriginCounts,
    pub operators: OriginCounts,
    pub in_loops: u64,
    pub cost: OriginCounts,
    pub cost_in_loops: OriginCounts,
    pub is_in_runtime: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum OperationClass {
    PropertyAccess,
    Call,
    Operator,
}

impl Cause {
    fn operations(&self) -> OriginCounts {
        OriginCounts {
            program: self.accesses.program + self.calls.program + self.operators.program,
            dependencies: self.accesses.dependencies
                + self.calls.dependencies
                + self.operators.dependencies,
        }
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

fn family_bit(family: UnprovenCauseFamily) -> ExplainSet {
    match family {
        UnprovenCauseFamily::UnknownCode => ExplainSet::ONLY_UNKNOWN_CODE,
        UnprovenCauseFamily::UnprovenType => ExplainSet::ONLY_UNPROVEN_TYPE,
    }
}

pub(super) fn collect_causes(
    records: &[AccessRecord],
    origin_of: &dyn Fn(ModuleId) -> ModuleOrigin,
    families: ExplainSet,
) -> Vec<Cause> {
    let mut groups = BTreeMap::new();
    for record in records {
        let saved = instructions_saved_by_types(record);
        let Some(class) = operation_class(record.kind) else {
            continue;
        };
        let family = family_bit(record.cause.family());
        if saved == 0 || !(families.is_empty() || families.contains(family)) {
            continue;
        }
        let origin = match position_of(record.location) {
            Some(position) => origin_of(position.module),
            None => ModuleOrigin::Program,
        };
        if origin == ModuleOrigin::Runtime {
            continue;
        }
        let position = position_of(record.witness.location);
        let key = (record.cause, record.ill_typed_cause, position);
        let (group, layouts) = groups.entry(key).or_insert_with(|| {
            let cause = Cause {
                cause: record.cause,
                ill_typed_cause: record.ill_typed_cause,
                position,
                function: record.witness.function_id(),
                layouts: Vec::new(),
                accesses: OriginCounts::default(),
                calls: OriginCounts::default(),
                operators: OriginCounts::default(),
                in_loops: 0,
                cost: OriginCounts::default(),
                cost_in_loops: OriginCounts::default(),
                is_in_runtime: position
                    .is_some_and(|position| origin_of(position.module) == ModuleOrigin::Runtime),
            };
            (cause, BTreeSet::new())
        });
        let counts = match class {
            OperationClass::PropertyAccess => &mut group.accesses,
            OperationClass::Call => &mut group.calls,
            OperationClass::Operator => &mut group.operators,
        };
        counts.add_for_origin(origin, 1);
        let saved = u64::from(saved);
        group.cost.add_for_origin(origin, saved);
        if record.loop_depth > 0 {
            group.in_loops += 1;
            group.cost_in_loops.add_for_origin(origin, saved);
        }
        layouts.extend(record.layout_id());
    }

    let mut causes: Vec<Cause> = groups
        .into_values()
        .map(|(cause, layouts)| Cause {
            layouts: layouts.into_iter().collect(),
            ..cause
        })
        .collect();
    causes.shared_sort_unstable_by_key(|cause| {
        let is_fixed_in_the_compiler = cause.cause == UnprovenCause::ResultDisabled;
        let operations = cause.operations();
        (
            is_fixed_in_the_compiler || cause.is_in_runtime,
            Reverse(cause.cost_in_loops.program),
            Reverse(cause.cost.program),
            Reverse(cause.cost_in_loops.dependencies),
            Reverse(cause.cost.dependencies),
            Reverse(operations.program),
            Reverse(operations.dependencies),
            cause.position.is_none(),
            cause.position,
            cause.cause,
            cause.ill_typed_cause,
        )
    });
    causes
}

#[optimize(size)]
fn causes_of(input: &ReportInput<'_>, families: ExplainSet) -> Vec<Cause> {
    let origin_of = |module: ModuleId| input.texts.origin(module);
    let engine = input.engine;
    collect_causes(engine.accesses(), &origin_of, families)
}

fn function_name<'a>(cause: &Cause, names: Names<'a>) -> &'a [u8] {
    let function = cause.function;
    function.map_or(&[][..], |function| names.function_name(function))
}

fn type_names<'a>(cause: &Cause, names: Names<'a>) -> Vec<&'a [u8]> {
    let mut seen = BTreeSet::new();
    cause
        .layouts
        .iter()
        .map(|&layout| names.layout_name(layout))
        .filter(|&name| !name.is_empty() && seen.insert(name))
        .collect()
}

fn documentation_url(code: &[u8]) -> Vec<u8> {
    [DOCUMENTATION_URL, code].concat()
}

fn shown_ill_typed_cause(cause: &Cause) -> IllTypedCause {
    match ill_typed_cause_wording(cause.ill_typed_cause) {
        Some(why) if why.code != cause_code(cause.cause) => cause.ill_typed_cause,
        Some(_) | None => IllTypedCause::None,
    }
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

fn write_operations_in_loops(out: &mut Vec<u8>, cause: &Cause) {
    if cause.in_loops > 0 {
        let (one, many) = ("of these runs in a loop", "of these run in a loop");
        write_counted(out, cause.in_loops, one, many);
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
    if !function_name.is_empty() {
        write_parts(out, &[b"in function '", function_name, b"'"]);
    }
}

fn write_type_names(out: &mut Vec<u8>, label: &[u8], type_names: &[&[u8]]) {
    let shown = &type_names[..type_names.len().min(MAX_NAMED_TYPES)];
    if shown.is_empty() {
        return;
    }
    write_parts(out, &[label, b"'", &shown.join(&b"', '"[..]), b"'"]);
    if type_names.len() > shown.len() {
        out.extend_from_slice(b" and ");
        write_count(out, (type_names.len() - shown.len()) as u64);
        out.extend_from_slice(b" more");
    }
}

fn write_ill_typed_cause(out: &mut Vec<u8>, cause: IllTypedCause) {
    let Some(wording) = ill_typed_cause_wording(cause) else {
        return;
    };
    let (code, message) = (wording.code.as_bytes(), wording.message.as_bytes());
    write_parts(out, &[b"why (", code, b"): ", message]);
}

fn no_cause_sentence(totals: &ProgramTotals, families: ExplainSet) -> &'static [u8] {
    let untyped = totals.combined().access_costs.not_free();
    match (families.is_empty(), untyped) {
        (false, _) => b"No causes of this kind.",
        (true, 0) => b"Every property access is typed. Nothing to fix.",
        (true, _) => b"The compiler recorded no cause for the untyped property accesses.",
    }
}

fn text_entry(cause: &Cause, rank: usize, totals: &ProgramTotals, names: Names<'_>) -> ReportEntry {
    let wording = cause_wording(cause.cause);
    let code = cause_code(cause.cause).as_bytes();

    let mut text = format!("{rank}. ").into_bytes();
    write_parts(&mut text, &[code, b": ", wording.message.as_bytes()]);

    let mut entry = ReportEntry::at(ExplainSet::TEXT, text, cause.position);
    let add_notes = |entry: &mut ReportEntry, writers: &[&dyn Fn(&mut Vec<u8>)]| {
        for write in writers {
            let mut note = Vec::new();
            write(&mut note);
            if !note.is_empty() {
                entry.add_note(note);
            }
        }
    };
    add_notes(
        &mut entry,
        &[
            &|out| write_share(out, cause, totals),
            &|out| write_other_operations(out, cause),
            &|out| write_operations_in_loops(out, cause),
        ],
    );
    add_notes(
        &mut entry,
        &[
            &|out| write_function_name(out, function_name(cause, names)),
            &|out| write_type_names(out, b"types: ", &type_names(cause, names)),
            &|out| write_ill_typed_cause(out, shown_ill_typed_cause(cause)),
        ],
    );
    entry.add_note([&b"fix: "[..], wording.fix.as_bytes()].concat());
    entry.add_note(documentation_url(code));
    entry
}

fn numbers_entry(totals: &ProgramTotals, cause_count: usize) -> ReportEntry {
    let mut json = JsonWriter::object();
    write_access_counts(&mut json, "accesses", &totals.program);
    write_access_counts(&mut json, "dependencyAccesses", &totals.dependencies);
    write_level_counts(&mut json, "calls", &totals.program.calls);
    json.number("causes", cause_count as u64);
    ReportEntry::line(ExplainSet::JSON, json.finish())
}

fn json_entry(
    cause: &Cause,
    rank: usize,
    names: Names<'_>,
    positions: &mut Positions<'_>,
) -> ReportEntry {
    let wording = cause_wording(cause.cause);
    let code = cause_code(cause.cause).as_bytes();
    let position = cause.position;
    let shown = position.and_then(|position| positions.resolve(position));
    let source = match position {
        Some(position) => positions.locator.source_line(position),
        None => Vec::new(),
    };

    let mut json = JsonWriter::object();
    json.number("rank", rank as u64);
    json.string("reason", code);
    write_position_members(&mut json, shown.as_ref(), "column");
    json.boolean("inDependency", cause.operations().program == 0);
    json.string("source", &source);
    json.string("message", wording.message.as_bytes());
    json.string("fix", wording.fix.as_bytes());
    json.string("url", &documentation_url(code));
    json.number("accesses", cause.accesses.program);
    json.number("dependencyAccesses", cause.accesses.dependencies);
    json.number("calls", cause.calls.total());
    json.number("operators", cause.operators.total());
    json.number("inLoops", cause.in_loops);
    json.string("function", function_name(cause, names));
    json.strings("types", type_names(cause, names).into_iter());
    json.string("family", &code_of(cause.cause.family().name()));
    match ill_typed_cause_wording(shown_ill_typed_cause(cause)) {
        Some(why) => {
            json.begin_object("why");
            json.string("reason", why.code.as_bytes());
            json.string("message", why.message.as_bytes());
            json.string("fix", why.fix.as_bytes());
            json.string("url", &documentation_url(why.code.as_bytes()));
            json.end_object();
        }
        None => json.null("why"),
    }
    ReportEntry::at(ExplainSet::JSON, json.finish(), cause.position)
}

fn list_entry(cause: &Cause, names: Names<'_>, positions: &mut Positions<'_>) -> ReportEntry {
    let family = cause.cause.family();
    let position = cause.position;
    let shown = position.and_then(|position| positions.resolve(position));

    let mut text = code_of(family.name());
    let code = cause_code(cause.cause).as_bytes();
    write_parts(&mut text, &[b": ", code, b" at "]);
    write_shown_position(&mut text, shown.as_ref());
    text.extend_from_slice(b", ");
    write_counted(&mut text, cause.accesses.total(), "access", "accesses");
    if cause.calls.total() + cause.operators.total() > 0 {
        text.extend_from_slice(b", ");
        write_other_operations(&mut text, cause);
    }
    write_type_names(&mut text, b", types ", &type_names(cause, names));
    if let Some(wording) = ill_typed_cause_wording(shown_ill_typed_cause(cause)) {
        write_parts(&mut text, &[b", why ", wording.code.as_bytes()]);
    }
    ReportEntry::at(family_bit(family), text, cause.position)
}

fn collect_ranked_entries(
    causes: &[Cause],
    out: &mut Vec<ReportEntry>,
    mut entry_of: impl FnMut(&Cause, usize) -> ReportEntry,
) {
    let mut by_position: Vec<usize> = (0..causes.len()).collect();
    by_position.shared_sort_unstable_by_key(|&index| causes[index].position);
    let mut entries: Vec<Option<ReportEntry>> = vec![None; causes.len()];
    for index in by_position {
        entries[index] = Some(entry_of(&causes[index], index + 1));
    }
    out.extend(entries.into_iter().flatten());
}

fn collect_text_entries(
    causes: &[Cause],
    totals: &ProgramTotals,
    names: Names<'_>,
    out: &mut Vec<ReportEntry>,
) {
    let mut heading = b"Untyped code works, but runs slower. ".to_vec();
    write_counted(&mut heading, causes.len() as u64, "cause", "causes");
    heading.push(b':');
    out.push(ReportEntry::line(ExplainSet::TEXT, heading));

    for (index, cause) in causes.iter().take(MAX_SHOWN_CAUSES).enumerate() {
        out.push(text_entry(cause, index + 1, totals, names));
    }
    if causes.len() > MAX_SHOWN_CAUSES {
        let hidden = (causes.len() - MAX_SHOWN_CAUSES) as u64;
        let mut footer = Vec::new();
        write_counted(&mut footer, hidden, "more cause", "more causes");
        footer.extend_from_slice(
            b" not shown. Use --explain=json to print all of them, one JSON object per line.",
        );
        out.push(ReportEntry::line(ExplainSet::TEXT, footer));
    }
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
    collect_text_entries(&causes, &totals, Names::new(input), out);
}

pub(super) fn collect_json(
    input: &ReportInput<'_>,
    families: ExplainSet,
    out: &mut Vec<ReportEntry>,
) {
    let causes = causes_of(input, families);
    let names = Names::new(input);
    let mut positions = Positions::new(input, PathStyle::Posix);
    out.push(numbers_entry(&compute_totals(input), causes.len()));
    collect_ranked_entries(&causes, out, |cause, rank| {
        json_entry(cause, rank, names, &mut positions)
    });
}

pub(super) fn collect_list(
    input: &ReportInput<'_>,
    families: ExplainSet,
    out: &mut Vec<ReportEntry>,
) {
    let names = Names::new(input);
    let mut positions = Positions::new(input, PathStyle::Posix);
    collect_ranked_entries(&causes_of(input, families), out, |cause, _| {
        list_entry(cause, names, &mut positions)
    });
}

#[cfg(test)]
mod tests;

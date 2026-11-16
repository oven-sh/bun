use core::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

use bun_options_types::aot_options::ExplainSet;
use bun_sema::util::SharedSort;

use super::format::{write_count, write_counted, write_parts};
use super::json::JsonWriter;
use super::levels::{ProgramTotals, compute_totals};
use super::model::OriginCounts;
use super::names::Names;
use super::positions::{PathStyle, Positions, write_position_members, write_shown_position};
use super::source_texts::ModuleOrigin;
use super::summary::{write_access_counts, write_level_counts};
use super::wording::{
    DOCUMENTATION_URL, OriginWording, cause_code, cause_wording, has_fix, origin_code,
    origin_wording,
};
use super::{ReportEntry, ReportInput};
use crate::builtins::table;
use crate::engine::{AccessRecord, Position, TypeOriginRecord, builtin_of, position_of};
use crate::ir::generated::{AccessCost, AccessKind, TypeOriginReason, UnprovenCause};
use crate::ir::ids::{FunctionId, LayoutId, ModuleId};

const MAX_SHOWN_CAUSES: usize = 20;
const MAX_NAMED_TYPES: usize = 8;
const MAX_NAMED_USES: usize = 3;
const MAX_LISTED_USES: usize = 100;

#[derive(PartialEq, Eq, Debug)]
pub(super) struct Cause {
    pub cause: UnprovenCause,
    /// The place to change: where the type became too wide, or else the operation itself.
    pub position: Option<Position>,
    pub origin: Option<TypeOriginRecord>,
    /// Where the operations are, if that is another place.
    pub uses: Vec<Position>,
    /// Operations whose type is too wide for other reasons too.
    pub shared: u64,
    /// The other operations, which a change at the place speeds up.
    pub freed: OriginCounts,
    pub freed_in_loops: OriginCounts,
    pub function: Option<FunctionId>,
    pub layouts: Vec<LayoutId>,
    pub accesses: OriginCounts,
    pub calls: OriginCounts,
    pub operators: OriginCounts,
    pub in_loops: OriginCounts,
    pub cost: OriginCounts,
    pub cost_in_loops: OriginCounts,
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

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum CauseKey {
    Origin(Position, TypeOriginReason),
    Operation(UnprovenCause, Option<TypeOriginReason>, Option<Position>),
}

/// The origin of an operation, and its place if that is in the program.
fn origin_of_operation(
    record: &AccessRecord,
    origins: &[TypeOriginRecord],
    origin_of: &dyn Fn(ModuleId) -> ModuleOrigin,
) -> Option<(TypeOriginRecord, Option<Position>)> {
    let origin = *origins.get(record.origin as usize)?;
    origin_wording(origin.reason)?;
    let place = position_of(origin.location)
        .filter(|position| origin_of(position.module) != ModuleOrigin::Runtime);
    Some((origin, place))
}

pub(super) fn collect_causes(
    records: &[AccessRecord],
    origins: &[TypeOriginRecord],
    origin_of: &dyn Fn(ModuleId) -> ModuleOrigin,
) -> Vec<Cause> {
    let mut groups = BTreeMap::new();
    for record in records {
        let saved = instructions_saved_by_types(record);
        let Some(class) = operation_class(record.kind) else {
            continue;
        };
        if saved == 0 {
            continue;
        }
        let position = position_of(record.location);
        let module_origin = match position {
            Some(position) => origin_of(position.module),
            None => ModuleOrigin::Program,
        };
        if module_origin == ModuleOrigin::Runtime {
            continue;
        }
        let found = origin_of_operation(record, origins, origin_of);
        let origin = found.map(|(origin, _)| origin);
        let reason = origin.map(|origin| origin.reason);
        let (key, place) = match (found, reason) {
            (Some((_, Some(place))), Some(reason)) => {
                (CauseKey::Origin(place, reason), Some(place))
            }
            _ => (
                CauseKey::Operation(record.cause, reason, position),
                position,
            ),
        };
        let (group, layouts, uses) = groups.entry(key).or_insert_with(|| {
            let cause = Cause {
                cause: record.cause,
                position: place,
                origin,
                uses: Vec::new(),
                shared: 0,
                freed: OriginCounts::default(),
                freed_in_loops: OriginCounts::default(),
                function: record.function_id(),
                layouts: Vec::new(),
                accesses: OriginCounts::default(),
                calls: OriginCounts::default(),
                operators: OriginCounts::default(),
                in_loops: OriginCounts::default(),
                cost: OriginCounts::default(),
                cost_in_loops: OriginCounts::default(),
            };
            (cause, BTreeSet::new(), BTreeSet::new())
        });
        group.cause = group.cause.min(record.cause);
        let counts = match class {
            OperationClass::PropertyAccess => &mut group.accesses,
            OperationClass::Call => &mut group.calls,
            OperationClass::Operator => &mut group.operators,
        };
        counts.add_for_origin(module_origin, 1);
        let saved = u64::from(saved);
        group.cost.add_for_origin(module_origin, saved);
        if record.loop_depth > 0 {
            group.in_loops.add_for_origin(module_origin, 1);
            group.cost_in_loops.add_for_origin(module_origin, saved);
        }
        if origin.is_some() && record.has_other_origins != 0 {
            group.shared += 1;
        } else {
            group.freed.add_for_origin(module_origin, 1);
            if record.loop_depth > 0 {
                group.freed_in_loops.add_for_origin(module_origin, 1);
            }
        }
        layouts.extend(record.layout_id());
        uses.extend(position.filter(|_| position != place));
    }

    let mut causes: Vec<Cause> = groups
        .into_values()
        .map(|(cause, layouts, uses)| Cause {
            layouts: layouts.into_iter().collect(),
            uses: uses.into_iter().collect(),
            ..cause
        })
        .collect();
    causes.shared_sort_unstable_by_key(|cause| {
        let is_fixed_in_the_compiler = cause.cause == UnprovenCause::Unknown;
        let has_nothing_to_fix = cause.origin.is_some_and(|it| !has_fix(it.reason));
        let operations = cause.operations();
        (
            (is_fixed_in_the_compiler, has_nothing_to_fix),
            Reverse((cause.freed_in_loops.program, cause.freed.program)),
            Reverse(cause.in_loops.program),
            Reverse(operations.program),
            Reverse(cause.cost_in_loops.program),
            Reverse(cause.cost.program),
            Reverse((cause.freed_in_loops.dependencies, cause.freed.dependencies)),
            Reverse(operations.dependencies),
            Reverse(cause.cost.dependencies),
            (cause.position.is_none(), cause.position, cause.cause),
        )
    });
    causes
}

#[optimize(size)]
fn causes_of(input: &ReportInput<'_>) -> Vec<Cause> {
    let origin_of = |module: ModuleId| input.texts.origin(module);
    collect_causes(
        input.engine.accesses(),
        input.engine.type_origins(),
        &origin_of,
    )
}

fn function_name<'a>(cause: &Cause, names: Names<'a>) -> &'a [u8] {
    let function = cause.function.filter(|_| cause.uses.is_empty());
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

fn origin_wording_of(cause: &Cause) -> Option<OriginWording> {
    origin_wording(cause.origin?.reason)
}

/// A built-in that programs can't name has no name here.
fn origin_name(origin: &TypeOriginRecord, names: Names<'_>) -> Vec<u8> {
    match builtin_of(origin.builtin) {
        Some(builtin) if !table::text_of(builtin).starts_with('%') => {
            [table::text_of(builtin).as_bytes(), b"()"].concat()
        }
        Some(_) => Vec::new(),
        None => match names.text(origin.name) {
            b"" => Vec::new(),
            name => [b"'", name, b"'"].concat(),
        },
    }
}

fn message_of(cause: &Cause, names: Names<'_>) -> Vec<u8> {
    match (origin_wording_of(cause), &cause.origin) {
        (Some(wording), Some(origin)) => wording.message(&origin_name(origin, names)),
        _ => cause_wording(cause.cause).message.as_bytes().to_vec(),
    }
}

fn fix_of(cause: &Cause) -> &'static str {
    match origin_wording_of(cause) {
        Some(wording) => wording.fix,
        None => cause_wording(cause.cause).fix,
    }
}

fn documentation_url(code: &[u8]) -> Vec<u8> {
    [DOCUMENTATION_URL, code].concat()
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
    if cause.in_loops.total() > 0 {
        let (one, many) = ("of these runs in a loop", "of these run in a loop");
        write_counted(out, cause.in_loops.total(), one, many);
    }
}

fn write_shared_operations(out: &mut Vec<u8>, cause: &Cause) {
    if cause.shared > 0 {
        let (one, many) = (
            "of these has another cause too",
            "of these have other causes too",
        );
        write_counted(out, cause.shared, one, many);
    }
}

fn write_entry_point(out: &mut Vec<u8>, cause: &Cause, positions: &mut Positions<'_>) {
    let entry = cause
        .origin
        .and_then(|origin| positions.resolve_location(origin.entry));
    if let Some(entry) = entry {
        out.extend_from_slice(b"it comes in at ");
        write_shown_position(out, Some(&entry));
    }
}

fn write_uses(out: &mut Vec<u8>, cause: &Cause, positions: &mut Positions<'_>) {
    let shown = &cause.uses[..cause.uses.len().min(MAX_NAMED_USES)];
    for (index, &position) in shown.iter().enumerate() {
        out.extend_from_slice(if index == 0 { b"used at " } else { b", " });
        write_shown_position(out, positions.resolve(position).as_ref());
    }
    if cause.uses.len() > shown.len() {
        out.extend_from_slice(b" and ");
        let hidden = (cause.uses.len() - shown.len()) as u64;
        write_counted(out, hidden, "other place", "other places");
    }
}

fn write_share(out: &mut Vec<u8>, cause: &Cause, totals: &ProgramTotals) {
    if cause.accesses.total() == 0 {
        return;
    }
    if cause.accesses.program == 0 {
        let dependency_total = totals.dependencies.access_costs.not_free();
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

fn no_cause_sentence(totals: &ProgramTotals) -> &'static [u8] {
    match totals.combined().access_costs.not_free() {
        0 => b"Every property access is typed. Nothing to fix.",
        _ => b"The compiler recorded no cause for the untyped property accesses.",
    }
}

fn text_entry(
    cause: &Cause,
    rank: usize,
    totals: &ProgramTotals,
    names: Names<'_>,
    positions: &mut Positions<'_>,
) -> ReportEntry {
    let code = cause_code(cause.cause).as_bytes();

    let mut text = format!("{rank}. ").into_bytes();
    write_parts(&mut text, &[code, b": ", &message_of(cause, names)]);

    let mut entry = ReportEntry::at(ExplainSet::TEXT, text, cause.position);
    let mut add_note = |write: &mut dyn FnMut(&mut Vec<u8>)| {
        let mut note = Vec::new();
        write(&mut note);
        if !note.is_empty() {
            entry.add_note(note);
        }
    };
    add_note(&mut |out| write_share(out, cause, totals));
    add_note(&mut |out| write_other_operations(out, cause));
    add_note(&mut |out| write_operations_in_loops(out, cause));
    add_note(&mut |out| write_shared_operations(out, cause));
    add_note(&mut |out| write_entry_point(out, cause, positions));
    add_note(&mut |out| write_uses(out, cause, positions));
    add_note(&mut |out| write_function_name(out, function_name(cause, names)));
    add_note(&mut |out| write_type_names(out, b"types: ", &type_names(cause, names)));
    entry.add_note([&b"fix: "[..], fix_of(cause).as_bytes()].concat());
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
    json.string("message", &message_of(cause, names));
    json.string("fix", fix_of(cause).as_bytes());
    json.string("url", &documentation_url(code));
    let why = cause.origin.map_or("", |origin| origin_code(origin.reason));
    json.string("why", why.as_bytes());
    let uses: Vec<Vec<u8>> = cause
        .uses
        .iter()
        .take(MAX_LISTED_USES)
        .map(|&position| {
            let mut shown = Vec::new();
            write_shown_position(&mut shown, positions.resolve(position).as_ref());
            shown
        })
        .collect();
    json.strings("uses", uses.iter().map(|shown| &shown[..]));
    json.number("accesses", cause.accesses.program);
    json.number("dependencyAccesses", cause.accesses.dependencies);
    json.number("calls", cause.calls.total());
    json.number("operators", cause.operators.total());
    json.number("inLoops", cause.in_loops.total());
    json.number("withOtherCauses", cause.shared);
    json.string("function", function_name(cause, names));
    json.strings("types", type_names(cause, names).into_iter());
    ReportEntry::at(ExplainSet::JSON, json.finish(), cause.position)
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
    positions: &mut Positions<'_>,
    out: &mut Vec<ReportEntry>,
) {
    let mut heading = b"Untyped code works, but runs slower. ".to_vec();
    write_counted(&mut heading, causes.len() as u64, "cause", "causes");
    heading.push(b':');
    out.push(ReportEntry::line(ExplainSet::TEXT, heading));

    for (index, cause) in causes.iter().take(MAX_SHOWN_CAUSES).enumerate() {
        out.push(text_entry(cause, index + 1, totals, names, positions));
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

pub(super) fn collect_text(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    let totals = compute_totals(input);
    let causes = causes_of(input);
    if causes.is_empty() {
        let sentence = no_cause_sentence(&totals);
        out.push(ReportEntry::line(ExplainSet::TEXT, sentence.to_vec()));
        return;
    }
    let mut positions = Positions::new(input, PathStyle::Posix);
    collect_text_entries(&causes, &totals, Names::new(input), &mut positions, out);
}

pub(super) fn collect_json(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    let causes = causes_of(input);
    let names = Names::new(input);
    let mut positions = Positions::new(input, PathStyle::Posix);
    out.push(numbers_entry(&compute_totals(input), causes.len()));
    collect_ranked_entries(&causes, out, |cause, rank| {
        json_entry(cause, rank, names, &mut positions)
    });
}

#[cfg(test)]
mod tests;

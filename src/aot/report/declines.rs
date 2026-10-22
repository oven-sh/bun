use bun_options_types::aot_options::ExplainSet;

use super::allocations::write_reasons;
use super::format::{write_count, write_counted};
use super::positions::{PathStyle, Positions, is_listed_site, write_shown_position};
use super::wording::{
    array_chain_decline_sentence, call_decline_sentence, decline_sentence,
    generator_fusion_decline_sentence, interpreted_cause_sentence, loop_decline_sentence,
    missed_optimization_code, string_builder_decline_sentence, typed_result_decline_sentence,
};
use super::{ReportEntry, ReportInput};
use crate::diagnostics::SourcePosition;
use crate::engine::{DeclineRecord, Position, position_of};
use crate::ir::generated::{AllocationEscapeReason, DeclineKind, LimitId};
use crate::link::ProgramNames;

struct MergedDecline<'r> {
    record: &'r DeclineRecord,
    times: u32,
}

#[derive(PartialEq, Eq, Debug)]
enum Reason {
    Absent,
    Sentence(&'static str),
    Escape(AllocationEscapeReason),
}

fn sort_key(record: &DeclineRecord) -> (bool, Option<Position>, DeclineKind, u32, u32, LimitId) {
    let position = position_of(record.witness.location);
    (position.is_none(), position, record.kind, record.reason, record.count, record.limit)
}

fn is_same_decline(first: &DeclineRecord, second: &DeclineRecord) -> bool {
    position_of(first.witness.location).is_some() && sort_key(first) == sort_key(second)
}

fn merge(records: &[DeclineRecord]) -> Vec<MergedDecline<'_>> {
    let mut sorted: Vec<&DeclineRecord> = records.iter().collect();
    sorted.sort_by_key(|record| sort_key(record));

    let mut merged: Vec<MergedDecline<'_>> = Vec::new();
    for record in sorted {
        match merged.last_mut() {
            Some(last) if is_same_decline(last.record, record) => last.times += 1,
            _ => merged.push(MergedDecline { record, times: 1 }),
        }
    }
    merged
}

pub(super) fn is_listed(record: &DeclineRecord, names: &ProgramNames) -> bool {
    is_listed_site(names, record.witness.location, record.witness.function_id())
}

fn kind_total_entry(kind: DeclineKind, times: u64) -> ReportEntry {
    let mut text = b"missed optimizations: ".to_vec();
    write_count(&mut text, times);
    text.push(b' ');
    text.extend_from_slice(missed_optimization_code(kind).as_bytes());
    text.extend_from_slice(b": ");
    text.extend_from_slice(decline_sentence(kind).as_bytes());
    ReportEntry::line(ExplainSet::DECLINES, text)
}

fn reason_of(record: &DeclineRecord) -> Reason {
    let reason = record.reason;
    let sentence = match record.kind {
        DeclineKind::HotCallNotResolved => call_decline_sentence(reason),
        DeclineKind::GeneratorLoopNotFused => generator_fusion_decline_sentence(reason),
        DeclineKind::ArrayChainNotFused => array_chain_decline_sentence(reason),
        DeclineKind::StringBuilderNotCreated => string_builder_decline_sentence(reason),
        DeclineKind::AllocationNotSunk if reason != 0 => {
            return Reason::Escape(AllocationEscapeReason(reason));
        }
        DeclineKind::TypedResultNotSelected => typed_result_decline_sentence(reason),
        DeclineKind::LoopNotVersioned
        | DeclineKind::LoopBoundNotClamped => loop_decline_sentence(reason),
        DeclineKind::ResultNodeInterpreted => interpreted_cause_sentence(reason),
        DeclineKind::Unknown
        | DeclineKind::HotCallNotInlined
        | DeclineKind::StringBuildersNotJoined
        | DeclineKind::AllocationNotSunk
        | DeclineKind::IterationNotExpandedByClass
        | DeclineKind::StretchNotGuarded
        | DeclineKind::GenericVersionNotCreated => None,
    };
    sentence.map_or(Reason::Absent, Reason::Sentence)
}

fn write_reason_clause(out: &mut Vec<u8>, record: &DeclineRecord) {
    match reason_of(record) {
        Reason::Absent => {}
        Reason::Sentence(sentence) => {
            out.extend_from_slice(b", ");
            out.extend_from_slice(sentence.as_bytes());
        }
        Reason::Escape(reasons) => {
            out.extend_from_slice(b", ");
            write_reasons(out, reasons);
        }
    }
}

fn write_count_clause(out: &mut Vec<u8>, record: &DeclineRecord) {
    if record.count == 0 {
        return;
    }
    let count = u64::from(record.count);
    out.extend_from_slice(b", ");
    match record.kind {
        DeclineKind::HotCallNotInlined => {
            let (one, many) = ("byte over the inlining budget", "bytes over the inlining budget");
            write_counted(out, count, one, many);
        }
        DeclineKind::StringBuilderNotCreated => write_counted(out, count, "append", "appends"),
        DeclineKind::GenericVersionNotCreated => write_counted(out, count, "check", "checks"),
        DeclineKind::Unknown
        | DeclineKind::HotCallNotResolved
        | DeclineKind::GeneratorLoopNotFused
        | DeclineKind::ArrayChainNotFused
        | DeclineKind::StringBuildersNotJoined
        | DeclineKind::AllocationNotSunk
        | DeclineKind::TypedResultNotSelected
        | DeclineKind::IterationNotExpandedByClass
        | DeclineKind::LoopNotVersioned
        | DeclineKind::LoopBoundNotClamped
        | DeclineKind::StretchNotGuarded
        | DeclineKind::ResultNodeInterpreted => {
            out.extend_from_slice(b"count ");
            write_count(out, count);
        }
    }
}

pub(super) fn write_limit(out: &mut Vec<u8>, limit: LimitId, value: u64) {
    if limit == LimitId::None {
        return;
    }
    out.extend_from_slice(b", limit ");
    out.extend_from_slice(limit.name().as_bytes());
    out.extend_from_slice(b" = ");
    write_count(out, value);
    out.extend_from_slice(b" (limits ");
    out.extend_from_slice(limit.purpose().as_bytes());
    out.push(b')');
}

fn write_decline_line(
    out: &mut Vec<u8>,
    decline: &MergedDecline<'_>,
    position: Option<&SourcePosition>,
    function_name: &[u8],
    limit_value: u64,
) {
    let record = decline.record;
    out.extend_from_slice(b"missed: ");
    out.extend_from_slice(missed_optimization_code(record.kind).as_bytes());
    out.extend_from_slice(b" at ");
    write_shown_position(out, position);

    if !function_name.is_empty() {
        out.extend_from_slice(b" in ");
        out.extend_from_slice(function_name);
    }
    if decline.times > 1 {
        out.extend_from_slice(b", ");
        write_counted(out, u64::from(decline.times), "time", "times");
    }
    write_reason_clause(out, record);
    write_count_clause(out, record);
    write_limit(out, record.limit, limit_value);
}

fn decline_entry(
    input: &ReportInput<'_>,
    positions: &mut Positions<'_>,
    decline: &MergedDecline<'_>,
) -> ReportEntry {
    let record = decline.record;
    let position = position_of(record.witness.location);
    let shown_position = positions.resolve_optional(position);
    let function_name: &[u8] = match record.witness.function_id() {
        Some(function) => input.names.function_name(function),
        None => &[],
    };
    let limit_value = input.engine.limit_value(record.limit);

    let mut text = Vec::new();
    write_decline_line(&mut text, decline, shown_position.as_ref(), function_name, limit_value);
    ReportEntry {
        kind: ExplainSet::DECLINES,
        text,
        position,
        notes: Vec::new(),
    }
}

pub(super) fn collect(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    let mut merged = merge(input.engine.declines());
    merged.retain(|decline| is_listed(decline.record, input.names));
    if merged.is_empty() {
        let text = b"missed optimizations: none".to_vec();
        out.push(ReportEntry::line(ExplainSet::DECLINES, text));
        return;
    }

    let mut totals = [0u64; DeclineKind::COUNT];
    for decline in &merged {
        totals[decline.record.kind as usize] += u64::from(decline.times);
    }
    let occurring = DeclineKind::ALL.into_iter().zip(totals).filter(|&(_, times)| times > 0);
    out.extend(occurring.map(|(kind, times)| kind_total_entry(kind, times)));

    let mut positions = Positions::new(input, PathStyle::Native);
    out.extend(merged.iter().map(|decline| decline_entry(input, &mut positions, decline)));
}

#[cfg(test)]
mod tests;

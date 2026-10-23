use bun_options_types::aot_options::ExplainSet;
use bun_trim::{Decision, Feature, RetainReason, Retained, UsedLocales, WitnessIndex};

use super::positions::{PathStyle, Positions, write_shown_position};
use super::wording::{trim_blocker_code, unseen_code_sentence};
use super::{ReportEntry, ReportInput};
use crate::builtins::BuiltinId;
use crate::builtins::table::{self, BuiltinKind};
use crate::engine::{BuiltinUseRecord, Position, SourceLocation, builtin_of, position_of};
use crate::ir::generated::{BuiltinUse, LocaleUseKind};

const PREFIX: &[u8] = b"trim: ";

pub(super) fn collect(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    let mut positions = Positions::new(input, PathStyle::Native);
    cause_lines(input, &mut positions, out);
    let items = item_lines(input.engine.builtins_used());
    out.extend(items.into_iter().map(|line| entry_at(line, None)));
    out.push(locale_line(input, &mut positions));
    match input.decision {
        Some(decision) => feature_lines(input, decision, &mut positions, out),
        None => out.push(entry_at(
            line_from(&[b"nothing removed: --trim wasn't passed"]),
            None,
        )),
    }
}

fn line_from(parts: &[&[u8]]) -> Vec<u8> {
    let mut line = PREFIX.to_vec();
    for part in parts {
        line.extend_from_slice(part);
    }
    line
}

fn entry_at(text: Vec<u8>, position: Option<Position>) -> ReportEntry {
    ReportEntry {
        position,
        ..ReportEntry::line(ExplainSet::RUNTIME_USE, text)
    }
}

fn record_at<T>(records: &[T], witness: Option<WitnessIndex>) -> Option<&T> {
    records.get(witness?.0 as usize)
}

fn write_location(
    line: &mut Vec<u8>,
    location: SourceLocation,
    positions: &mut Positions<'_>,
) -> Option<Position> {
    let position = position_of(location)?;
    if let Some(shown) = positions.resolve(position) {
        line.extend_from_slice(b" at ");
        write_shown_position(line, Some(&shown));
    }
    Some(position)
}

fn write_witness(
    line: &mut Vec<u8>,
    builtin: u32,
    location: SourceLocation,
    positions: &mut Positions<'_>,
) -> Option<Position> {
    if let Some(id) = builtin_of(builtin) {
        line.extend_from_slice(b" (");
        line.extend_from_slice(table::text_of(id).as_bytes());
        line.push(b')');
    }
    write_location(line, location, positions)
}

fn cause_lines(input: &ReportInput<'_>, positions: &mut Positions<'_>, out: &mut Vec<ReportEntry>) {
    if input.used_features.causes.is_empty() {
        let line = line_from(&[b"the compiler can see every API this program uses"]);
        out.push(entry_at(line, None));
        return;
    }
    for unseen in &input.used_features.causes {
        let code = trim_blocker_code(unseen.cause).as_bytes();
        let sentence = unseen_code_sentence(unseen.cause).as_bytes();
        let mut line = line_from(&[b"blocked by ", code, b": ", sentence]);
        let position = match record_at(input.engine.unseen_code(), unseen.witness) {
            Some(record) => write_witness(
                &mut line,
                record.builtin,
                record.witness.location,
                positions,
            ),
            None => None,
        };
        out.push(entry_at(line, position));
    }
}

fn item_lines(records: &[BuiltinUseRecord]) -> Vec<Vec<u8>> {
    let mut items = Vec::new();
    for record in records {
        let Some(id) = builtin_of(record.builtin) else {
            continue;
        };
        if record.uses.without(BuiltinUse::TESTED).is_empty() {
            continue;
        }
        push_item(&mut items, id);
        push_item(&mut items, table::root_of(id));
        if record.uses.contains(BuiltinUse::ESCAPED) {
            let holder = table::text_of(id);
            items.push(line_from(&[
                b"uses ",
                holder.as_bytes(),
                b" (escapes, so any member may be used)",
            ]));
        }
    }
    items.sort_unstable();
    items.dedup();
    items
}

fn push_item(items: &mut Vec<Vec<u8>>, id: BuiltinId) {
    let mut line = PREFIX.to_vec();
    if write_item(&mut line, id) {
        items.push(line);
    }
}

fn write_item(line: &mut Vec<u8>, id: BuiltinId) -> bool {
    if id == BuiltinId::GlobalThis {
        return false;
    }
    let entry = table::entry(id);
    let name = table::text_of_name(entry.name);
    line.extend_from_slice(b"uses ");
    match entry.holder {
        Some(BuiltinId::GlobalThis) => {
            line.extend_from_slice(b"global ");
            line.extend_from_slice(name);
        }
        None => {
            let word: &[u8] = match entry.kind {
                BuiltinKind::Namespace => b"module ",
                BuiltinKind::NativeBinding => b"native ",
                BuiltinKind::Constructor
                | BuiltinKind::Function
                | BuiltinKind::Prototype
                | BuiltinKind::Method
                | BuiltinKind::Accessor
                | BuiltinKind::DataProperty
                | BuiltinKind::Constant => b"builtin ",
            };
            line.extend_from_slice(word);
            line.extend_from_slice(table::text_of(id).as_bytes());
        }
        Some(holder) if table::entry(holder).kind == BuiltinKind::Prototype => {
            line.extend_from_slice(b"property ");
            line.extend_from_slice(name);
        }
        Some(holder) => {
            line.extend_from_slice(table::text_of(holder).as_bytes());
            line.push(b' ');
            line.extend_from_slice(name);
        }
    }
    true
}

fn locale_line(input: &ReportInput<'_>, positions: &mut Positions<'_>) -> ReportEntry {
    match &input.used_features.locales {
        UsedLocales::Listed(tags) if tags.is_empty() => {
            entry_at(line_from(&[b"locales: none"]), None)
        }
        UsedLocales::Listed(tags) => {
            let tags: Vec<&[u8]> = tags.iter().map(|tag| &tag.0[..]).collect();
            entry_at(
                line_from(&[b"locales: ", tags.join(&b", "[..]).as_slice()]),
                None,
            )
        }
        UsedLocales::Unknown(witness) => {
            let Some(record) = record_at(input.engine.locales_used(), *witness) else {
                return entry_at(line_from(&[b"locales: all"]), None);
            };
            let why: &[u8] = match record.kind {
                LocaleUseKind::HostDefault => b"a call passes no locale, so the system's applies",
                LocaleUseKind::Unknown | LocaleUseKind::Constant => b"the locale isn't a constant",
            };
            let mut line = line_from(&[b"locales: all, because ", why]);
            let location = record.witness.location;
            let position = write_witness(&mut line, record.builtin, location, positions);
            entry_at(line, position)
        }
    }
}

fn feature_lines(
    input: &ReportInput<'_>,
    decision: &Decision,
    positions: &mut Positions<'_>,
    out: &mut Vec<ReportEntry>,
) {
    for &Retained { feature, reason } in &decision.retained {
        let mut line = line_from(&[b"kept "]);
        write_feature(&mut line, feature);
        line.extend_from_slice(b": ");
        let position = write_reason(&mut line, reason, input, decision, feature, positions);
        out.push(entry_at(line, position));
    }
    for feature in decision.unused.iter() {
        let mut line = line_from(&[b"removed "]);
        write_feature(&mut line, feature);
        line.extend_from_slice(if decision.requested.contains(feature) {
            b": listed in compile.trim.remove" as &[u8]
        } else {
            b": unused"
        });
        out.push(entry_at(line, None));
    }
}

fn write_reason(
    line: &mut Vec<u8>,
    reason: RetainReason,
    input: &ReportInput<'_>,
    decision: &Decision,
    feature: Feature,
    positions: &mut Positions<'_>,
) -> Option<Position> {
    match reason {
        RetainReason::Allowed(name) => {
            line.extend_from_slice(b"listed in compile.trim.allow (");
            line.extend_from_slice(name.name().as_bytes());
            line.push(b')');
            None
        }
        RetainReason::Used(witness) => {
            line.extend_from_slice(b"used");
            let record = record_at(input.engine.features_used(), witness)?;
            write_witness(line, record.builtin, record.witness.location, positions)
        }
        RetainReason::RequiredByOption(index) => {
            line.extend_from_slice(b"needed by ");
            match decision.requirements.get(index) {
                Some(requirement) => line.extend_from_slice(&requirement.label),
                None => line.extend_from_slice(b"an option"),
            }
            None
        }
        RetainReason::AlwaysEntered => {
            line.extend_from_slice(b"runs at startup");
            None
        }
        RetainReason::ReachableByUnseenCode(index) => {
            line.extend_from_slice(b"code loaded at run time could use it");
            if let Some(unseen) = input.used_features.causes.get(index) {
                line.extend_from_slice(b" (");
                line.extend_from_slice(trim_blocker_code(unseen.cause).as_bytes());
                line.push(b')');
            }
            None
        }
        RetainReason::NeededBy { .. } => {
            let chain = decision.chain_of(feature);
            let dependents: Vec<&[u8]> = chain[1..]
                .iter()
                .map(|dependent| dependent.text().as_bytes())
                .collect();
            line.extend_from_slice(b"needed by ");
            line.extend_from_slice(&dependents.join(&b" <- "[..]));
            None
        }
        RetainReason::NotRequested => {
            line.extend_from_slice(b"not selected for removal");
            None
        }
    }
}

fn write_feature(line: &mut Vec<u8>, feature: Feature) {
    line.extend_from_slice(feature.text().as_bytes());
    if let Some(trim_feature) = feature.narrowest_trim_feature() {
        line.extend_from_slice(b" (");
        line.extend_from_slice(trim_feature.name().as_bytes());
        line.push(b')');
    }
}

#[cfg(test)]
mod tests;

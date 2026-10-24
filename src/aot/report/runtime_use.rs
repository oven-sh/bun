use bun_options_types::aot_options::ExplainSet;
use bun_sema::util::SharedSort;
use bun_trim::{Decision, Feature, RetainReason, Retained, UsedLocales, WitnessIndex};

use super::format::write_parts;
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
    write_parts(&mut line, parts);
    line
}

fn entry_at(text: Vec<u8>, position: Option<Position>) -> ReportEntry {
    ReportEntry::at(ExplainSet::RUNTIME_USE, text, position)
}

pub(super) fn record_at<T>(records: &[T], witness: Option<WitnessIndex>) -> Option<&T> {
    records.get(witness?.0 as usize)
}

fn write_witness(
    line: &mut Vec<u8>,
    builtin: u32,
    location: SourceLocation,
    positions: &mut Positions<'_>,
) -> Option<Position> {
    if let Some(id) = builtin_of(builtin) {
        write_parts(line, &[b" (", table::text_of(id).as_bytes(), b")"]);
    }
    let position = position_of(location)?;
    if let Some(shown) = positions.resolve(position) {
        line.extend_from_slice(b" at ");
        write_shown_position(line, Some(&shown));
    }
    Some(position)
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
        let record = record_at(input.engine.unseen_code(), unseen.witness);
        let position = record.and_then(|record| {
            let location = record.witness.location;
            write_witness(&mut line, record.builtin, location, positions)
        });
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
            let note = b" (escapes, so any member may be used)";
            items.push(line_from(&[b"uses ", holder.as_bytes(), note]));
        }
    }
    items.shared_sort_unstable();
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
        Some(BuiltinId::GlobalThis) => write_parts(line, &[b"global ", name]),
        None => {
            let word: &[u8] = match entry.kind {
                BuiltinKind::Namespace => b"module ",
                BuiltinKind::NativeBinding => b"native ",
                _ => b"builtin ",
            };
            write_parts(line, &[word, table::text_of(id).as_bytes()]);
        }
        Some(holder) if table::entry(holder).kind == BuiltinKind::Prototype => {
            write_parts(line, &[b"property ", name]);
        }
        Some(holder) => write_parts(line, &[table::text_of(holder).as_bytes(), b" ", name]),
    }
    true
}

fn locale_line(input: &ReportInput<'_>, positions: &mut Positions<'_>) -> ReportEntry {
    if let Some(tags) = &input.options.trim.locales {
        let tags = match tags.is_empty() {
            true => b"none".to_vec(),
            false => tags.join(&b", "[..]),
        };
        let line = line_from(&[b"locales: ", &tags, b": listed in compile.trim.locales"]);
        return entry_at(line, None);
    }
    match &input.used_features.locales {
        UsedLocales::Listed(tags) if tags.is_empty() => {
            entry_at(line_from(&[b"locales: none"]), None)
        }
        UsedLocales::Listed(tags) => {
            let tags: Vec<&[u8]> = tags.iter().map(|tag| &tag.0[..]).collect();
            entry_at(line_from(&[b"locales: ", &tags.join(&b", "[..])]), None)
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
            let name = name.name().as_bytes();
            write_parts(line, &[b"listed in compile.trim.allow (", name, b")"]);
        }
        RetainReason::Used(witness) => {
            line.extend_from_slice(b"used");
            let record = record_at(input.engine.features_used(), witness)?;
            return write_witness(line, record.builtin, record.witness.location, positions);
        }
        RetainReason::RequiredByOption(index) => {
            line.extend_from_slice(b"needed by ");
            match decision.requirements.get(index) {
                Some(requirement) => line.extend_from_slice(&requirement.label),
                None => line.extend_from_slice(b"an option"),
            }
        }
        RetainReason::AlwaysEntered => line.extend_from_slice(b"runs at startup"),
        RetainReason::ReachableByUnseenCode(index) => {
            line.extend_from_slice(b"code loaded at run time could use it");
            if let Some(unseen) = input.used_features.causes.get(index) {
                let code = trim_blocker_code(unseen.cause).as_bytes();
                write_parts(line, &[b" (", code, b")"]);
            }
        }
        RetainReason::NeededBy { .. } => {
            let chain = decision.chain_of(feature);
            let dependents: Vec<&[u8]> = chain[1..]
                .iter()
                .map(|dependent| dependent.text().as_bytes())
                .collect();
            write_parts(line, &[b"needed by ", &dependents.join(&b" <- "[..])]);
        }
        RetainReason::NotRequested => line.extend_from_slice(b"not selected for removal"),
    }
    None
}

fn write_feature(line: &mut Vec<u8>, feature: Feature) {
    line.extend_from_slice(feature.text().as_bytes());
    if let Some(trim_feature) = feature.narrowest_trim_feature() {
        write_parts(line, &[b" (", trim_feature.name().as_bytes(), b")"]);
    }
}

#[cfg(test)]
mod tests;

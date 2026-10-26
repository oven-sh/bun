use bun_options_types::aot_options::ExplainSet;
use bun_sema::util::SharedSort;
use bun_trim::{Decision, Feature, FeatureSet, RetainReason, Retained, UsedLocales, WitnessIndex};

use super::format::write_parts;
use super::positions::{PathStyle, Positions, write_shown_position};
use super::wording::{trim_blocker_code, unseen_code_sentence};
use super::{ReportEntry, ReportInput};
use crate::builtins::BuiltinId;
use crate::builtins::table::{self, BuiltinKind};
use crate::engine::{
    BuiltinUseRecord, FeatureUseRecord, Position, SourceLocation, builtin_of, feature_of,
    position_of,
};
use crate::ir::generated::{BuiltinUse, FeatureUseKind, LocaleUseKind};

const PREFIX: &[u8] = b"trim: ";

pub(super) fn collect(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    let mut positions = Positions::new(input, PathStyle::Native);
    let reachable = find_removed_but_reachable(input, &mut positions);
    cause_lines(input, &reachable, &mut positions, out);
    let items = item_lines(input.engine.builtins_used());
    out.extend(items.into_iter().map(|line| entry_at(line, None)));
    out.push(locale_line(input, &mut positions));
    match input.decision {
        Some(decision) => feature_lines(input, decision, &reachable, &mut positions, out),
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

type ReachableFeature<'a> = (Feature, &'a FeatureUseRecord);

// A feature that no code names, that --trim removes, and that a place in the program can still reach.
fn find_removed_but_reachable<'a>(
    input: &ReportInput<'a>,
    positions: &mut Positions<'_>,
) -> Vec<ReachableFeature<'a>> {
    let Some(decision) = input.decision else {
        return Vec::new();
    };
    let mut seen = FeatureSet::EMPTY;
    let mut found = Vec::new();
    for record in input.engine.features_used() {
        let Some(feature) = feature_of(record.feature) else {
            continue;
        };
        let is_removed = decision.unused.contains(feature) && !decision.requested.contains(feature);
        if record.kind == FeatureUseKind::Named || !is_removed || seen.contains(feature) {
            continue;
        }
        let position = position_of(record.witness.location);
        if position
            .and_then(|position| positions.resolve(position))
            .is_none()
        {
            continue;
        }
        seen.insert(feature);
        found.push((feature, record));
    }
    found
}

fn run_time_name_lines(
    reachable: &[ReachableFeature<'_>],
    positions: &mut Positions<'_>,
    out: &mut Vec<ReportEntry>,
) {
    let places = reachable.iter().map(|(_, record)| record.witness.location);
    let mut places: Vec<Position> = places.filter_map(position_of).collect();
    places.shared_sort_unstable();
    places.dedup();
    for position in places {
        let mut line = line_from(&[b"the compiler can't tell which API this program uses at "]);
        write_shown_position(&mut line, positions.resolve(position).as_ref());
        line.extend_from_slice(b", because the name is only known at run time");
        out.push(entry_at(line, Some(position)));
    }
}

fn cause_lines(
    input: &ReportInput<'_>,
    reachable: &[ReachableFeature<'_>],
    positions: &mut Positions<'_>,
    out: &mut Vec<ReportEntry>,
) {
    if input.used_features.causes.is_empty() && reachable.is_empty() {
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
    run_time_name_lines(reachable, positions, out);
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
    reachable: &[ReachableFeature<'_>],
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
        let record = reachable.iter().find(|(reached, _)| *reached == feature);
        let position = match record {
            Some((_, record)) => write_reachable(&mut line, feature, record, positions),
            None if decision.requested.contains(feature) => {
                line.extend_from_slice(b": listed in compile.trim.remove");
                None
            }
            None => {
                line.extend_from_slice(b": unused");
                None
            }
        };
        out.push(entry_at(line, position));
    }
}

fn write_reachable(
    line: &mut Vec<u8>,
    feature: Feature,
    record: &FeatureUseRecord,
    positions: &mut Positions<'_>,
) -> Option<Position> {
    line.extend_from_slice(b": no code names it, but a name from run time could reach it");
    let position = write_witness(line, record.builtin, record.witness.location, positions);
    match feature.narrowest_trim_feature() {
        Some(name) => {
            let name = name.name().as_bytes();
            write_parts(
                line,
                &[b". To keep it, add \"", name, b"\" to compile.trim.allow"],
            );
        }
        None => line.extend_from_slice(b". To keep it, use it by name somewhere in your code"),
    }
    position
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

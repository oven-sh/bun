use core::hash::Hash;

use bun_base64::VLQ;
use bun_collections::ArrayHashMap;
use bun_core::handle_oom;

use super::format::PathPrinter;
use super::json::JsonWriter;
use super::positions::resolve_ascending;
use super::source_texts::{ModuleLocator, SourceTexts};
use crate::engine::{EngineResult, ObfuscatedSiteRecord, Position, position_of};
use crate::ir::ids::ModuleId;
use crate::link::ProgramNames;

#[derive(Copy, Clone)]
struct Located {
    module: ModuleId,
    line: u32,
    column: u32,
}

struct Original {
    source: u32,
    line: u32,
    column: u32,
}

struct Site {
    function: u32,
    site: u32,
    original: Option<Original>,
    name: Option<u32>,
}

#[derive(Default)]
struct Previous {
    source: i32,
    line: i32,
    column: i32,
    name: i32,
}

pub fn write(
    engine: &EngineResult,
    names: &ProgramNames,
    texts: &SourceTexts,
    file_name: &[u8],
) -> Vec<u8> {
    let records = sort_records(engine.obfuscated_sites());
    let located = locate_records(&records, texts);
    let mut sources: ArrayHashMap<ModuleId, ()> = ArrayHashMap::default();
    let mut frame_names: ArrayHashMap<&[u8], ()> = ArrayHashMap::default();
    let sites: Vec<Site> = records
        .iter()
        .zip(located)
        .map(|(record, located)| {
            let name = engine.text(record.name);
            Site {
                function: record.function,
                site: record.site,
                original: located.map(|found| Original {
                    source: intern(&mut sources, found.module),
                    line: found.line,
                    column: found.column,
                }),
                name: (!name.is_empty()).then(|| intern(&mut frame_names, name)),
            }
        })
        .collect();
    let mut mappings = Vec::new();
    write_mappings(&sites, &mut mappings);

    let printer = PathPrinter::new();
    let source_paths: Vec<Vec<u8>> = sources
        .keys()
        .iter()
        .map(|&module| printer.posix_path(names.module_path(module)))
        .collect();
    let mut json = JsonWriter::object();
    json.number("version", 3);
    json.string("file", file_name);
    json.strings("sources", source_paths.iter().map(Vec::as_slice));
    json.strings("names", frame_names.keys().iter().copied());
    json.string("mappings", &mappings);
    json.finish()
}

fn intern<K: Eq + Hash>(keys: &mut ArrayHashMap<K, ()>, key: K) -> u32 {
    handle_oom(keys.get_or_put(key)).index as u32
}

fn site_key(record: &ObfuscatedSiteRecord) -> (u32, u32) {
    (record.function, record.site)
}

fn sort_records(records: &[ObfuscatedSiteRecord]) -> Vec<ObfuscatedSiteRecord> {
    let mut sorted = records.to_vec();
    sorted.sort_by_key(site_key);
    sorted.dedup_by_key(|record| site_key(record));
    sorted
}

fn locate_records(records: &[ObfuscatedSiteRecord], texts: &SourceTexts) -> Vec<Option<Located>> {
    let wanted: Vec<Option<Position>> = records
        .iter()
        .map(|record| position_of(record.location))
        .collect();
    let mut locator = ModuleLocator::new(texts);
    resolve_ascending(&wanted, |position| locate(&mut locator, position))
}

fn locate(locator: &mut ModuleLocator<'_>, position: Position) -> Option<Located> {
    let found = locator.position_of(position)?;
    Some(Located {
        module: position.module,
        line: found.line.saturating_sub(1),
        column: found.column.saturating_sub(1),
    })
}

fn write_mappings(sites: &[Site], out: &mut Vec<u8>) {
    let mut previous = Previous::default();
    let mut line = 0;
    let mut generated_column = 0;
    let mut is_line_empty = true;
    for site in sites {
        if site.function > line {
            out.resize(out.len() + (site.function - line) as usize, b';');
            line = site.function;
            generated_column = 0;
            is_line_empty = true;
        }
        if !is_line_empty {
            out.push(b',');
        }
        is_line_empty = false;

        push_delta(out, &mut generated_column, site.site);
        let Some(original) = &site.original else {
            continue;
        };
        push_delta(out, &mut previous.source, original.source);
        push_delta(out, &mut previous.line, original.line);
        push_delta(out, &mut previous.column, original.column);
        if let Some(name) = site.name {
            push_delta(out, &mut previous.name, name);
        }
    }
}

fn push_delta(out: &mut Vec<u8>, previous: &mut i32, value: u32) {
    let value = i32::try_from(value).unwrap_or(i32::MAX);
    push_vlq(out, value - *previous);
    *previous = value;
}

fn push_vlq(out: &mut Vec<u8>, value: i32) {
    out.extend_from_slice(VLQ::encode(value).slice());
}

#[cfg(test)]
mod tests;

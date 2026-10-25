use core::cmp::Reverse;
use core::hash::Hash;

use bun_base64::VLQ;
use bun_collections::ArrayHashMap;
use bun_core::handle_oom;

use super::format::PathPrinter;
use super::json::JsonWriter;
use super::positions::resolve_ascending;
use super::source_texts::{ModuleLocator, ModuleSource, SourceTexts};
use crate::engine::{EngineResult, ObfuscatedSiteRecord, Position, position_of};
use crate::ir::ids::ModuleId;
use crate::link::ProgramNames;

#[derive(Copy, Clone)]
struct Located {
    module: ModuleId,
    line: u32,
    column: u32,
}

/// A file in `sources`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
enum Source {
    Module(ModuleId),
    /// Built-in functions that are in no module, such as `Array.prototype.map`.
    Native,
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

/// What the map says about the executable it belongs to.
#[derive(Copy, Clone)]
pub struct Executable<'a> {
    pub file_name: &'a [u8],
    /// `bun_crash_handler::build_id::write_uuid`. `None` where the executable has no build ID.
    pub debug_id: Option<&'a [u8]>,
}

pub fn write(
    engine: &EngineResult,
    names: &ProgramNames,
    texts: &SourceTexts,
    executable: Executable<'_>,
) -> Vec<u8> {
    let records = sort_records(engine.obfuscated_sites());
    let located = locate_records(&records, texts);
    let mut sources: ArrayHashMap<Source, ()> = ArrayHashMap::default();
    let mut frame_names: ArrayHashMap<&[u8], ()> = ArrayHashMap::default();
    let sites: Vec<Site> = records
        .iter()
        .zip(located)
        .map(|(record, located)| {
            let name = engine.text(record.name);
            let name = (!name.is_empty()).then(|| intern(&mut frame_names, name));
            let original = match (located, name) {
                (Some(found), _) => Some(Original {
                    source: intern(&mut sources, Source::Module(found.module)),
                    line: found.line,
                    column: found.column,
                }),
                (None, Some(name)) => Some(Original {
                    source: intern(&mut sources, source_without_text(record)),
                    line: name,
                    column: 0,
                }),
                (None, None) => None,
            };
            Site {
                function: record.function,
                site: record.site,
                original,
                name,
            }
        })
        .collect();
    let mut mappings = Vec::new();
    write_mappings(&sites, &mut mappings);

    let printer = PathPrinter::new();
    let source_paths: Vec<Vec<u8>> = sources
        .keys()
        .iter()
        .map(|&source| match source {
            Source::Module(module) => printer.posix_path(names.module_path(module)),
            Source::Native => b"native".to_vec(),
        })
        .collect();
    let source_texts = sources.keys().iter().map(|&source| match source {
        Source::Module(module) => texts.get(module).map(ModuleSource::text),
        Source::Native => None,
    });
    let mut json = JsonWriter::object();
    json.number("version", 3);
    json.string("file", executable.file_name);
    if let Some(debug_id) = executable.debug_id {
        json.string("debugId", debug_id);
        // Older tools read this spelling.
        json.string("debug_id", debug_id);
    }
    json.strings("sources", source_paths.iter().map(Vec::as_slice));
    json.optional_strings("sourcesContent", source_texts);
    json.strings("names", frame_names.keys().iter().copied());
    json.string("mappings", &mappings);
    write_function_maps(&mut json, &sites, sources.count(), frame_names.keys());
    json.finish()
}

/// A segment only has a name if it has a place. In a file without text each function gets a line of its own, the number of its name.
fn source_without_text(record: &ObfuscatedSiteRecord) -> Source {
    position_of(record.location).map_or(Source::Native, |position| Source::Module(position.module))
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
    resolve_ascending(&wanted, |position| {
        let (line, column) = locator.line_and_column(position)?;
        Some(Located {
            module: position.module,
            line: line.saturating_sub(1),
            column: column.saturating_sub(1),
        })
    })
}

fn write_mappings(sites: &[Site], out: &mut Vec<u8>) {
    let (mut last_source, mut last_name) = (0, 0);
    let (mut last_line, mut last_column) = (0, 0);
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
        push_delta(out, &mut last_source, original.source);
        push_delta(out, &mut last_line, original.line);
        push_delta(out, &mut last_column, original.column);
        if let Some(name) = site.name {
            push_delta(out, &mut last_name, name);
        }
    }
}

const UNNAMED_FUNCTION: &[u8] = b"?";

/// From this place in a source file on, the code belongs to the function with this name.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct FunctionStart {
    line: u32,
    column: u32,
    name: Option<u32>,
}

/// `x_facebook_sources`, the function maps of Metro: for each source, which function each place belongs to. A `name` in
/// `mappings` is read as the name of the callee by some tools, and these maps are what they read for the function around a place.
fn write_function_maps(
    json: &mut JsonWriter,
    sites: &[Site],
    source_count: usize,
    frame_names: &[&[u8]],
) {
    let mut starts_by_source: Vec<Vec<FunctionStart>> = vec![Vec::new(); source_count];
    for site in sites {
        if let Some(original) = &site.original {
            starts_by_source[original.source as usize].push(FunctionStart {
                line: original.line,
                column: original.column,
                name: site.name,
            });
        }
    }
    json.begin_array("x_facebook_sources");
    for starts in &mut starts_by_source {
        keep_name_changes(starts);
        let mut names: ArrayHashMap<&[u8], ()> = ArrayHashMap::default();
        let mut mappings = Vec::new();
        write_function_mappings(starts, &mut mappings, |name| {
            let name = name.map_or(UNNAMED_FUNCTION, |name| frame_names[name as usize]);
            intern(&mut names, name)
        });
        json.begin_array_element();
        json.begin_element();
        json.strings("names", names.keys().iter().copied());
        json.string("mappings", &mappings);
        json.end_object();
        json.end_array();
    }
    json.end_array();
}

/// A reader takes the last start at or in front of a place, so a start with the name of the one in front of it says nothing.
fn keep_name_changes(starts: &mut Vec<FunctionStart>) {
    // Where two functions have a site at one place, a name wins over none.
    starts.sort_unstable_by_key(|start| (start.line, start.column, Reverse(start.name)));
    starts.dedup_by_key(|start| (start.line, start.column));
    starts.dedup_by_key(|start| start.name);
}

/// Each segment has a column, a name and a line, as differences. A `;` sets the column back to zero.
fn write_function_mappings(
    starts: &[FunctionStart],
    out: &mut Vec<u8>,
    mut name_index: impl FnMut(Option<u32>) -> u32,
) {
    let (mut last_line, mut last_column, mut last_name) = (0, 0, 0);
    for (index, start) in starts.iter().enumerate() {
        if index > 0 {
            let is_same_line = i32::try_from(start.line).is_ok_and(|line| line == last_line);
            out.push(if is_same_line { b',' } else { b';' });
            if !is_same_line {
                last_column = 0;
            }
        }
        push_delta(out, &mut last_column, start.column);
        push_delta(out, &mut last_name, name_index(start.name));
        push_delta(out, &mut last_line, start.line);
    }
}

fn push_delta(out: &mut Vec<u8>, previous: &mut i32, value: u32) {
    let value = i32::try_from(value).unwrap_or(i32::MAX);
    out.extend_from_slice(VLQ::encode(value - *previous).slice());
    *previous = value;
}

#[cfg(test)]
mod tests;

//! This implements the JavaScript SourceMap class from Node.js.

use std::sync::Arc;

use bun_core::{self as bstring, strings};
use bun_jsc::bindgen::{JsLocal, JsPayload as _, JsScope, JsStructure, JsWrapper};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _, bun_string_jsc};
use bun_sourcemap::{Mapping, Ordinal, ParsedSourceMap, mapping};

use crate::generated_bindgen::sourcemap::js_SourceMap as js;

pub(crate) struct JSSourceMap {
    sourcemap: Arc<ParsedSourceMap>,
    sources: Box<[bstring::String]>,
    names: Box<[bstring::String]>,
}

/// `module.findSourceMap(url)`: the map of a runtime-transpiled module whose text JSC compiled
/// while source maps were enabled, from what runs to the file that was loaded. A module that
/// loaded while they were off has no entry, and a switch after the load changes nothing, as in
/// Node. Returns `None` for anything else: Node's `findSourceMap` never throws.
pub(crate) fn find_source_map<'a>(
    cx: &mut JsScope<'a>,
    path: JsLocal<'a>,
) -> JsResult<Option<JsWrapper<'a, JSSourceMap>>> {
    let global = cx.global();
    let source_url_value = path.to_js();
    if !source_url_value.is_string() {
        return Ok(None);
    }

    let mut source_url_string = bun_core::String::from_js(source_url_value, global)?;
    let mut source_url_slice = source_url_string.to_utf8();

    {
        let source_url = source_url_slice.slice();
        if source_url.starts_with(b"node:")
            || source_url.starts_with(b"bun:")
            || source_url.starts_with(b"data:")
        {
            return Ok(None);
        }
    }

    // The table keys a module by its path. Node takes a `file:` URL or a path, which it makes a
    // URL of: a path goes through one the same way, so that its separators are the platform's.
    let is_file_url = strings::index_of(source_url_slice.slice(), b"://")
        .is_some_and(|index| &source_url_slice.slice()[..index] == b"file");
    if is_file_url || bun_paths::is_absolute(source_url_slice.slice()) {
        let url = if is_file_url {
            source_url_string.clone()
        } else {
            bun_url::file_url_from_string(&source_url_string)
        };
        let path = bun_url::path_from_file_url(&url);
        if path.is_dead() {
            return Ok(None);
        }
        drop(source_url_slice);
        source_url_string = path;
        source_url_slice = source_url_string.to_utf8();
    }

    let source_url = source_url_slice.slice();

    // SAFETY: `bun_vm()` returns the live per-thread VM for a Bun-owned global.
    let vm = global.bun_vm().as_mut();
    // Node asks the `nodeModules` setting at each lookup.
    if !vm.source_mappings().source_maps_support().node_modules
        && bun_paths::strings::path_contains_node_modules_folder(source_url)
    {
        return Ok(None);
    }
    let Some(source_map) = vm.source_mappings().get_recorded(source_url) else {
        return Ok(None);
    };
    // Bun's map has one source: the module itself. Node names a file by its URL.
    let source = if bun_paths::is_absolute(source_url) {
        bun_url::file_url_from_string(&source_url_string)
    } else {
        source_url_string.clone()
    };
    drop(source_url_slice);
    let sources: Box<[bstring::String]> = Box::new([source]);

    let this = JSSourceMap {
        sourcemap: source_map,
        sources,
        names: Box::default(),
    };
    Ok(Some(this.into_js(&cx.heap)))
}

impl JSSourceMap {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: JsStructure<'a, Self>,
        payload: JsLocal<'a>,
        options: JsLocal<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let global = cx.global();
        let payload = payload.to_js();
        let options = options.to_js();

        global.validate_object("payload", payload, Default::default())?;

        let mut line_lengths = JSValue::ZERO;
        if options.is_object() {
            // Node doesn't check it further than this.
            if let Some(lengths) = options.get_if_property_exists(global, b"lineLengths")? {
                if lengths.js_type().is_array() {
                    line_lengths = lengths;
                }
            }
        }

        // Parse the payload to create a proper sourcemap

        // Extract mappings string from payload
        let Some(mappings_value) = payload.get_stringish_allow_empty(global, b"mappings")? else {
            return Err(
                global.throw_invalid_arguments(format_args!("payload 'mappings' must be a string"))
            );
        };

        let mappings_str = mappings_value.to_utf8();

        let mut names: Vec<bstring::String> = Vec::new();
        let mut sources: Vec<bstring::String> = Vec::new();

        if let Some(sources_value) = payload.get_array(global, b"sources")? {
            let mut iter = sources_value.array_iterator(global)?;
            while let Some(source) = iter.next()? {
                let source_str = source.to_bun_string(global)?;
                sources.push(source_str);
            }
        }

        if let Some(names_value) = payload.get_array(global, b"names")? {
            let mut iter = names_value.array_iterator(global)?;
            while let Some(name) = iter.next()? {
                let name_str = name.to_bun_string(global)?;
                names.push(name_str);
            }
        }

        // Parse the VLQ mappings
        let parse_result = mapping::parse(
            mappings_str.slice(),
            None,                                            // estimated_mapping_count
            i32::try_from(sources.len()).expect("int cast"), // sources_count
            mapping::ParseOptions {
                allow_names: true,
                sort: true,
            },
        );

        let mapping_list = match parse_result {
            Ok(parsed) => parsed,
            Err(fail) => {
                if let Some(loc) = fail.loc.to_nullable() {
                    return Err(global.throw_value(global.create_syntax_error_instance(
                        format_args!("{} at {}", fail.err.message(), loc.start),
                    )));
                }
                return Err(global.throw_value(
                    global.create_syntax_error_instance(format_args!("{}", fail.err.message())),
                ));
            }
        };

        let this_value = structure.create(
            &cx.heap,
            JSSourceMap {
                sourcemap: Arc::new(mapping_list),
                sources: sources.into_boxed_slice(),
                names: names.into_boxed_slice(),
            },
        );

        let global = cx.global();
        js::payload_set_cached(this_value.to_js(), global, payload);
        if !line_lengths.is_empty() {
            js::line_lengths_set_cached(this_value.to_js(), global, line_lengths);
        }

        Ok(this_value)
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.sources.len() * core::mem::size_of::<bstring::String>() + self.sourcemap.memory_cost()
    }

    /// Runs for a map of `findSourceMap()` only: the constructor caches the payload it was given.
    /// Bun keeps the decoded mappings, so this writes them as a v3 document. The printer maps no
    /// names, so `names` is empty.
    pub(crate) fn get_payload(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let sources =
            JSValue::create_array_from_iter(global, self.sources.iter(), |s| s.to_js(global))?;
        let names = JSValue::create_empty_array(global, 0)?;
        let mappings = bun_string_jsc::create_utf8_for_js(global, self.sourcemap.vlq_mappings())?;

        let payload = JSValue::create_empty_object(global, 4);
        payload.put(global, b"version", JSValue::js_number(3.0));
        payload.put(global, b"sources", sources);
        payload.put(global, b"names", names);
        payload.put(global, b"mappings", mappings);
        Ok(payload)
    }

    /// The length of each line of the generated text, for a map of `findSourceMap()`. The
    /// constructor caches the `lineLengths` option, and `undefined` is the answer without one.
    pub(crate) fn get_line_lengths(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let line_lengths = self
            .sourcemap
            .line_lengths
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let Some(line_lengths) = line_lengths.as_deref() else {
            return Ok(JSValue::UNDEFINED);
        };
        JSValue::create_array_from_iter(cx.global(), line_lengths.iter(), |&length| {
            Ok(JSValue::js_number(f64::from(length)))
        })
    }

    fn mapping_name_to_js(&self, global: &JSGlobalObject, mapping: &Mapping) -> JsResult<JSValue> {
        let name_index = mapping.name_index;
        if name_index >= 0 {
            if let Some(name) = self.sourcemap.mappings.get_name(name_index) {
                return bun_string_jsc::create_utf8_for_js(global, name);
            } else {
                let index = usize::try_from(name_index).expect("int cast");
                if index < self.names.len() {
                    return self.names[index].to_js(global);
                }
            }
        }
        Ok(JSValue::UNDEFINED)
    }

    fn source_name_to_js(&self, global: &JSGlobalObject, mapping: &Mapping) -> JsResult<JSValue> {
        let source_index = mapping.source_index;
        if source_index >= 0 && source_index < i32::try_from(self.sources.len()).expect("int cast")
        {
            return self.sources[usize::try_from(source_index).expect("int cast")].to_js(global);
        }
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn find_origin(
        &self,
        cx: &mut JsScope<'_>,
        line_number: JsLocal<'_>,
        column_number: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let [line_number, column_number] = get_line_column(global, line_number, column_number)?;
        if line_number < 0 || column_number < 0 {
            return Ok(JSValue::create_empty_object(global, 0));
        }

        let Some(mapping) = self.sourcemap.find_mapping(
            Ordinal::from_zero_based(line_number),
            Ordinal::from_zero_based(column_number),
        ) else {
            return Ok(JSValue::create_empty_object(global, 0));
        };
        let name = self.mapping_name_to_js(global, &mapping)?;
        let source = self.source_name_to_js(global, &mapping)?;
        Ok(Bun__createNodeModuleSourceMapOriginObject(
            global,
            name,
            JSValue::js_number(mapping.original.lines.zero_based() as f64),
            JSValue::js_number(mapping.original.columns.zero_based() as f64),
            source,
        ))
    }

    pub(crate) fn find_entry(
        &self,
        cx: &mut JsScope<'_>,
        line_offset: JsLocal<'_>,
        column_offset: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let [line_offset, column_offset] = get_line_column(global, line_offset, column_offset)?;
        if line_offset < 0 || column_offset < 0 {
            return Ok(JSValue::create_empty_object(global, 0));
        }

        let Some(mapping) = self.sourcemap.find_mapping(
            Ordinal::from_zero_based(line_offset),
            Ordinal::from_zero_based(column_offset),
        ) else {
            return Ok(JSValue::create_empty_object(global, 0));
        };

        let name = self.mapping_name_to_js(global, &mapping)?;
        let source = self.source_name_to_js(global, &mapping)?;
        Ok(Bun__createNodeModuleSourceMapEntryObject(
            global,
            JSValue::js_number(mapping.generated.lines.zero_based() as f64),
            JSValue::js_number(mapping.generated.columns.zero_based() as f64),
            JSValue::js_number(mapping.original.lines.zero_based() as f64),
            JSValue::js_number(mapping.original.columns.zero_based() as f64),
            source,
            name,
        ))
    }
}

fn get_line_column(
    global: &JSGlobalObject,
    line_number: JsLocal<'_>,
    column_number: JsLocal<'_>,
) -> JsResult<[i32; 2]> {
    Ok([
        // Node.js does no validations.
        line_number.to_js().coerce_to_i32(global)?,
        column_number.to_js().coerce_to_i32(global)?,
    ])
}

// Hand-written in `src/jsc/modules/NodeModuleModule.cpp`.
unsafe extern "C" {
    safe fn Bun__createNodeModuleSourceMapOriginObject(
        globalObject: &JSGlobalObject,
        name: JSValue,
        line: JSValue,
        column: JSValue,
        source: JSValue,
    ) -> JSValue;

    safe fn Bun__createNodeModuleSourceMapEntryObject(
        globalObject: &JSGlobalObject,
        generatedLine: JSValue,
        generatedColumn: JSValue,
        originalLine: JSValue,
        originalColumn: JSValue,
        source: JSValue,
        name: JSValue,
    ) -> JSValue;
}

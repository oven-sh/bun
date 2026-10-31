//! This implements the JavaScript SourceMap class from Node.js.

use std::sync::Arc;

use bun_core::{self as bstring, EncodedSlice, strings};
use bun_jsc::bindgen::{JsLocal, JsPayload as _, JsScope, JsStructure, JsWrapper};
use bun_jsc::saved_source_map::{self, ChainedSourceMap};
use bun_jsc::{
    CompiledJsonParser, EncodedSliceJsc as _, JSGlobalObject, JSValue, JsError, JsResult,
    StringJsc as _, bun_string_jsc,
};
use bun_paths::resolve_path::{self, platform};
use bun_sourcemap::{Mapping, Ordinal, ParsedSourceMap, mapping};

use crate::generated_bindgen::sourcemap::js_SourceMap as js;

pub(crate) struct JSSourceMap {
    sourcemap: Arc<ParsedSourceMap>,
    sources: Box<[bstring::String]>,
    names: Box<[bstring::String]>,
}

/// As in Node.js, what cannot be read is `undefined` and no error: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/source_map/source_map_cache.js#L372-L407
pub(crate) fn find_source_map<'a>(
    cx: &mut JsScope<'a>,
    path: JsLocal<'a>,
) -> JsResult<Option<JsWrapper<'a, JSSourceMap>>> {
    let global = cx.global();
    let name = path.to_js();
    if !name.is_string_literal() {
        return Ok(None);
    }
    let name = bstring::String::from_js(name, global)?;
    let Some(path) = module_path(&name) else {
        return Ok(None);
    };

    // SAFETY: `bun_vm()` returns the live per-thread VM for a Bun-owned global.
    let vm = global.bun_vm().as_mut();
    // Never the map that Bun made of the module: it has no `payload`, and Next.js reports a `SourceMap` without one.
    let Some(own) = vm.source_mappings().own_source_map(&path) else {
        return Ok(None);
    };
    let Some((this, payload)) = JSSourceMap::of_module(global, &own)? else {
        return Ok(None);
    };

    let this_value = this.into_js(&cx.heap);
    js::payload_set_cached(this_value.to_js(), cx.global(), payload);
    Ok(Some(this_value))
}

/// The path of the module that `name` is: a `file:` URL, or a path, which Node.js resolves as `pathToFileURL()` does.
fn module_path(name: &bstring::String) -> Option<Vec<u8>> {
    let utf8 = name.to_utf8();
    let name_bytes = utf8.slice();
    if name_bytes.starts_with(b"node:")
        || name_bytes.starts_with(b"bun:")
        || name_bytes.starts_with(b"data:")
    {
        return None;
    }

    // `/^\w+:\/\//` is a URL to Node.js, and only a `file:` one is a module.
    if let Some(scheme_len) = strings::index_of(name_bytes, b"://")
        && scheme_len > 0
        && name_bytes[..scheme_len]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
    {
        if &name_bytes[..scheme_len] != b"file" {
            return None;
        }
        let path = bun_url::path_from_file_url(name);
        return (!path.is_dead()).then(|| path.to_owned_slice());
    }

    let cwd = bun_core::working_directory_in_executable()
        .unwrap_or_else(|| bun_paths::fs::FileSystem::instance().top_level_dir());
    // `name` can have any length, so a buffer of the pool may be too short.
    let mut buf = vec![0u8; cwd.len() + name_bytes.len() + 2];
    Some(resolve_path::join_abs_string_buf::<platform::Auto>(cwd, &mut buf, &[name_bytes]).to_vec())
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

        let this = match Self::parsed(mappings_str.slice(), sources, names) {
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

        let this_value = structure.create(&cx.heap, this);

        let global = cx.global();
        js::payload_set_cached(this_value.to_js(), global, payload);
        if !line_lengths.is_empty() {
            js::line_lengths_set_cached(this_value.to_js(), global, line_lengths);
        }

        Ok(this_value)
    }

    /// `mappings` is the VLQ text of a Source Map V3 payload that has these `sources` and `names`.
    fn parsed(
        mappings: &[u8],
        sources: Vec<bstring::String>,
        names: Vec<bstring::String>,
    ) -> Result<Self, bun_sourcemap::ParseFail> {
        let sourcemap = mapping::parse(
            mappings,
            None,                                            // estimated_mapping_count
            i32::try_from(sources.len()).expect("int cast"), // sources_count
            mapping::ParseOptions {
                allow_names: true,
                sort: true,
            },
        )?;
        Ok(JSSourceMap {
            sourcemap: Arc::new(sourcemap),
            sources: sources.into_boxed_slice(),
            names: names.into_boxed_slice(),
        })
    }

    /// The `SourceMap` of a module's own source map, and its payload. `None`: the map is not one that the class reads.
    fn of_module(
        global: &JSGlobalObject,
        own: &ChainedSourceMap,
    ) -> JsResult<Option<(Self, JSValue)>> {
        let arena = bun_alloc::Arena::new();
        let Some(json) = own.json(&arena) else {
            return Ok(None);
        };
        let payload = match EncodedSlice::utf8(json).to_json_object(global, CompiledJsonParser::Try)
        {
            Ok(payload) => payload,
            // Node.js catches what `JSON.parse()` throws: text that is no JSON is no source map.
            Err(JsError::Thrown) if global.clear_exception_except_termination() => {
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
        if !payload.is_object() {
            return Ok(None);
        }

        // Only own properties are read, and only strings are converted, so that no JavaScript runs.
        let (Some(listed_sources), Some(mappings)) = (
            payload
                .get_own_truthy(global, b"sources")?
                .filter(|sources| sources.is_array()),
            payload
                .get_own_truthy(global, b"mappings")?
                .filter(|mappings| mappings.is_string_literal()),
        ) else {
            return Ok(None);
        };
        let source_root = match payload.get_own_truthy(global, b"sourceRoot")? {
            Some(root) if root.is_string_literal() => root.to_bun_string(global)?,
            _ => bstring::String::EMPTY,
        };
        let source_root = source_root.to_utf8();

        // Node.js keeps each of `sources` as an absolute URL, and no `sourceRoot`: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/source_map/source_map_cache.js#L325-L337
        let base = own.sources_base();
        let mut listed_sources = listed_sources.array_iterator(global)?;
        let absolute_sources = JSValue::create_empty_array(global, listed_sources.len as usize)?;
        let mut sources: Vec<bstring::String> = Vec::with_capacity(listed_sources.len as usize);
        let mut rooted: Vec<u8> = Vec::new();
        while let Some(source) = listed_sources.next()? {
            let index = listed_sources.i - 1;
            if !source.is_string_literal() {
                absolute_sources.put_index(global, index, source)?;
                sources.push(bstring::String::EMPTY);
                continue;
            }
            rooted.clear();
            rooted.extend_from_slice(source_root.slice());
            rooted.extend_from_slice(source.to_bun_string(global)?.to_utf8().slice());
            let url = saved_source_map::source_url(&base, &rooted);
            if url.is_dead() {
                return Ok(None);
            }
            absolute_sources.put_index(global, index, url.to_js(global)?)?;
            sources.push(url);
        }
        payload.put(global, b"sources", absolute_sources);
        payload.put(global, b"sourceRoot", JSValue::js_empty_string(global));

        let mut names: Vec<bstring::String> = Vec::new();
        if let Some(listed_names) = payload
            .get_own_truthy(global, b"names")?
            .filter(|names| names.is_array())
        {
            let mut listed_names = listed_names.array_iterator(global)?;
            while let Some(name) = listed_names.next()? {
                names.push(if name.is_string_literal() {
                    name.to_bun_string(global)?
                } else {
                    bstring::String::EMPTY
                });
            }
        }

        let mappings = mappings.to_bun_string(global)?;
        Ok(Self::parsed(mappings.to_utf8().slice(), sources, names)
            .ok()
            .map(|this| (this, payload)))
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.sources.len() * core::mem::size_of::<bstring::String>() + self.sourcemap.memory_cost()
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

//! This implements the JavaScript SourceMap class from Node.js.

use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use bstr::BStr;

use bun_core::{self as bstring, strings};
use bun_jsc::bindgen::{JsLocal, JsPayload as _, JsScope, JsStructure, JsWrapper};
use bun_jsc::{JSBigInt, JSGlobalObject, JSValue, JsResult, StringJsc as _, bun_string_jsc};
use bun_sourcemap::{Mapping, Ordinal, ParsedSourceMap, mapping};

use crate::generated_bindgen::sourcemap::js_SourceMap as js;

pub(crate) struct JSSourceMap {
    sourcemap: Arc<ParsedSourceMap>,
    sources: Box<[bstring::String]>,
    names: Box<[bstring::String]>,
}

/// TODO: when we implement --enable-source-map CLI flag, set this to true.
// Mutable global; AtomicBool for safe mutation.
static ENABLE_SOURCE_MAPS: AtomicBool = AtomicBool::new(false);

pub(crate) fn find_source_map<'a>(
    cx: &mut JsScope<'a>,
    path: JsLocal<'a>,
) -> JsResult<Option<JsWrapper<'a, JSSourceMap>>> {
    // Node.js doesn't enable source maps by default.
    // In Bun, we do use them for almost all files since we transpile almost all files
    // If we enable this by default, we don't have a `payload` object since we don't internally create one.
    // This causes Next.js to emit errors like the below on start:
    //       .next/server/chunks/ssr/[root-of-the-server]__012ba519._.js: Invalid source map. Only conformant source maps can be used to filter stack frames. Cause: TypeError: payload is not an Object. (evaluating '"sections" in payload')
    if !ENABLE_SOURCE_MAPS.load(Ordering::Relaxed) {
        return Ok(None);
    }

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

    if let Some(source_url_index) = strings::index_of(source_url_slice.slice(), b"://") {
        if &source_url_slice.slice()[..source_url_index] == b"file" {
            let path = bun_url::path_from_file_url(&source_url_string);

            if path.is_dead() {
                return Err(global.throw_value(global.err_invalid_url(format_args!(
                    "Invalid URL: {}",
                    BStr::new(source_url_slice.slice())
                ))));
            }

            // Replace the file:// URL with the absolute path.
            drop(source_url_slice);
            source_url_string = path;
            source_url_slice = source_url_string.to_utf8();
        }
    }

    let source_url = source_url_slice.slice();

    // SAFETY: `bun_vm()` returns the live per-thread VM for a Bun-owned global.
    let vm = global.bun_vm().as_mut();
    let Some(source_map) = vm.source_mappings().get(source_url) else {
        return Ok(None);
    };
    drop(source_url_slice);
    let fake_sources_array: Box<[bstring::String]> = Box::new([source_url_string]);

    // `SavedSourceMap::get` hands back a +1 ref as an `Arc<ParsedSourceMap>`;
    // `Drop` on the field releases it — no manual `deref_()` needed.
    let this = JSSourceMap {
        sourcemap: source_map,
        sources: fake_sources_array,
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

    /// The search of Node's `findEntry`, which compares an argument as it is and only where it needs it: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/source_map/source_map.js#L196-L217
    fn mapping_at(
        &self,
        global: &JSGlobalObject,
        line: Argument,
        column: Argument,
    ) -> JsResult<Option<Mapping>> {
        // A map from `find_source_map` is a blob and has no list. There is none while `ENABLE_SOURCE_MAPS` is off.
        let mappings = &self.sourcemap.mappings;
        if mappings.generated().is_empty() {
            return Ok(None);
        }
        let line_number = line.to_f64(global)?;
        let mapping_line = last_not_after(line_number);
        // Only a Number is `===` the line of a mapping. Any other line is after every mapping of that line.
        if !line.is_number() || f64::from(mapping_line) != line_number {
            return Ok(mappings.find_at_or_before(mapping_line, i32::MAX));
        }
        if !column.is_number() {
            // Node compares the column only with a mapping of the line.
            let last = mappings.find_at_or_before(mapping_line, i32::MAX);
            if last.is_none_or(|last| last.generated.lines.zero_based() != mapping_line) {
                return Ok(last);
            }
        }
        let mapping_column = last_not_after(column.to_f64(global)?);
        Ok(mappings.find_at_or_before(mapping_line, mapping_column))
    }

    /// Node's `findOrigin` as one native call: it converts each argument once, and it does not call a `findEntry` that a program replaced, which costs an entry object and a JS call. https://github.com/nodejs/node/blob/v26.3.0/lib/internal/source_map/source_map.js#L233-L252
    pub(crate) fn find_origin(
        &self,
        cx: &mut JsScope<'_>,
        line_number: JsLocal<'_>,
        column_number: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let line_number = Argument::new(line_number.to_js()).to_number(global)?;
        let column_number = Argument::new(column_number.to_js()).to_number(global)?;

        let Some(mapping) = self
            .mapping_at(
                global,
                Argument::Number(line_number - 1.0),
                Argument::Number(column_number - 1.0),
            )?
            .filter(Mapping::has_source)
        else {
            return Ok(JSValue::create_empty_object(global, 0));
        };
        let name = self.mapping_name_to_js(global, &mapping)?;
        let source = self.source_name_to_js(global, &mapping)?;
        // In doubles, as Node adds them: the sum can be past `i32::MAX`.
        let line_offset = line_number - f64::from(mapping.generated.lines.zero_based());
        let column_offset = column_number - f64::from(mapping.generated.columns.zero_based());
        Ok(Bun__createNodeModuleSourceMapOriginObject(
            global,
            name,
            source,
            JSValue::js_number(f64::from(mapping.original.lines.zero_based()) + line_offset),
            JSValue::js_number(f64::from(mapping.original.columns.zero_based()) + column_offset),
        ))
    }

    pub(crate) fn find_entry(
        &self,
        cx: &mut JsScope<'_>,
        line_offset: JsLocal<'_>,
        column_offset: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let Some(mapping) = self.mapping_at(
            global,
            Argument::new(line_offset.to_js()),
            Argument::new(column_offset.to_js()),
        )?
        else {
            return Ok(JSValue::create_empty_object(global, 0));
        };

        let name = self.mapping_name_to_js(global, &mapping)?;
        let source = self.source_name_to_js(global, &mapping)?;
        // In Node's entry for a segment that has no source, everything but the generated position is undefined.
        let original = |position: Ordinal| {
            if mapping.has_source() {
                JSValue::js_number(position.zero_based() as f64)
            } else {
                JSValue::UNDEFINED
            }
        };
        Ok(Bun__createNodeModuleSourceMapEntryObject(
            global,
            JSValue::js_number(mapping.generated.lines.zero_based() as f64),
            JSValue::js_number(mapping.generated.columns.zero_based() as f64),
            source,
            original(mapping.original.lines),
            original(mapping.original.columns),
            name,
        ))
    }
}

/// An argument of `findEntry` or `findOrigin`, as the caller passed it.
#[derive(Clone, Copy)]
enum Argument {
    Number(f64),
    Other(JSValue),
}

impl Argument {
    fn new(value: JSValue) -> Argument {
        if value.is_number() {
            Argument::Number(value.as_number())
        } else {
            Argument::Other(value)
        }
    }

    fn is_number(self) -> bool {
        matches!(self, Argument::Number(_))
    }

    /// ToNumber, with no call for a Number.
    fn to_number(self, global: &JSGlobalObject) -> JsResult<f64> {
        match self {
            Argument::Number(number) => Ok(number),
            Argument::Other(value) => value.to_number(global),
        }
    }

    /// What `<` compares the argument as. Node converts an object in each comparison, by ToNumeric. This converts it once, by ToNumber, so an object that converts to a BigInt throws.
    fn to_f64(self, global: &JSGlobalObject) -> JsResult<f64> {
        let big_int = match self {
            Argument::Number(_) => None,
            Argument::Other(value) => JSBigInt::from_js(value),
        };
        let Some(big_int) = big_int else {
            return self.to_number(global);
        };
        // `<` compares a BigInt by its value. Every mapping is from 0 to `i32::MAX`: the place among them is all that counts.
        Ok(if big_int.order(i64::from(i32::MAX)).is_gt() {
            f64::INFINITY
        } else if big_int.order(0i64).is_lt() {
            f64::NEG_INFINITY
        } else {
            big_int.to_int64() as f64
        })
    }
}

/// The last line or column of a mapping that `<` does not put after `number`. NaN is not before any. `as` saturates.
fn last_not_after(number: f64) -> i32 {
    if number.is_nan() {
        i32::MAX
    } else {
        number.floor() as i32
    }
}

// Hand-written in `src/jsc/modules/NodeModuleModule.cpp`.
unsafe extern "C" {
    safe fn Bun__createNodeModuleSourceMapOriginObject(
        globalObject: &JSGlobalObject,
        name: JSValue,
        fileName: JSValue,
        lineNumber: JSValue,
        columnNumber: JSValue,
    ) -> JSValue;

    safe fn Bun__createNodeModuleSourceMapEntryObject(
        globalObject: &JSGlobalObject,
        generatedLine: JSValue,
        generatedColumn: JSValue,
        originalSource: JSValue,
        originalLine: JSValue,
        originalColumn: JSValue,
        name: JSValue,
    ) -> JSValue;
}

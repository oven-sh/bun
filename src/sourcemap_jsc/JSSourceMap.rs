//! This implements the JavaScript SourceMap class from Node.js.

use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use bstr::BStr;

use bun_core::{self as bstring, strings};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, bun_string_jsc};
use bun_sourcemap::{Mapping, Ordinal, ParseResult, ParsedSourceMap, mapping};

// generate-classes.ts does not emit Rust accessors yet, so the
// `to_js`/cached-setter helpers below forward to the codegen-emitted C++
// symbols by hand.
pub struct JSSourceMap {
    pub sourcemap: Arc<ParsedSourceMap>,
    pub sources: Box<[bstring::String]>,
    pub names: Box<[bstring::String]>,
}

/// TODO: when we implement --enable-source-map CLI flag, set this to true.
// Mutable global; AtomicBool for safe mutation.
pub(crate) static ENABLE_SOURCE_MAPS: AtomicBool = AtomicBool::new(false);

#[bun_jsc::host_fn(export = "Bun__JSSourceMap__find")]
pub(crate) fn find_source_map(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // Node.js doesn't enable source maps by default.
    // In Bun, we do use them for almost all files since we transpile almost all files
    // If we enable this by default, we don't have a `payload` object since we don't internally create one.
    // This causes Next.js to emit errors like the below on start:
    //       .next/server/chunks/ssr/[root-of-the-server]__012ba519._.js: Invalid source map. Only conformant source maps can be used to filter stack frames. Cause: TypeError: payload is not an Object. (evaluating '"sections" in payload')
    if !ENABLE_SOURCE_MAPS.load(Ordering::Relaxed) {
        return Ok(JSValue::UNDEFINED);
    }

    let source_url_value = frame.argument(0);
    if !source_url_value.is_string() {
        return Ok(JSValue::UNDEFINED);
    }

    // reshaped for borrowck — `source_url_slice` borrows `source_url_string`;
    // explicit deref/deinit calls become Drop on reassignment.
    let mut source_url_string = bun_string_jsc::from_js(source_url_value, global)?;
    let mut source_url_slice = source_url_string.to_utf8();

    {
        let source_url = source_url_slice.slice();
        if source_url.starts_with(b"node:")
            || source_url.starts_with(b"bun:")
            || source_url.starts_with(b"data:")
        {
            return Ok(JSValue::UNDEFINED);
        }
    }

    if let Some(source_url_index) = strings::index_of(source_url_slice.slice(), b"://") {
        if &source_url_slice.slice()[..source_url_index] == b"file" {
            let path = bun_jsc::URL::path_from_file_url(source_url_string.dupe_ref());

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
        return Ok(JSValue::UNDEFINED);
    };
    // Box allocation aborts on OOM (handleOom semantics).
    let fake_sources_array: Box<[bstring::String]> = Box::new([source_url_string.dupe_ref()]);

    // `SavedSourceMap::get` hands back a +1 ref as an `Arc<ParsedSourceMap>`;
    // `Drop` on the field releases it — no manual `deref_()` needed.
    let this = Box::new(JSSourceMap {
        sourcemap: source_map,
        sources: fake_sources_array,
        names: Box::default(),
    });
    Ok(JSSourceMap::to_js(this, global))
}

impl JSSourceMap {
    pub fn constructor(
        global: &JSGlobalObject,
        frame: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<Box<JSSourceMap>> {
        let payload_arg = frame.argument(0);
        let options_arg = frame.argument(1);

        global.validate_object("payload", payload_arg, Default::default())?;

        let mut line_lengths = JSValue::ZERO;
        if options_arg.is_object() {
            // Node doesn't check it further than this.
            if let Some(lengths) = options_arg.get_if_property_exists(global, b"lineLengths")? {
                if lengths.js_type().is_array() {
                    line_lengths = lengths;
                }
            }
        }

        // Parse the payload to create a proper sourcemap

        // Extract mappings string from payload
        let Some(mappings_value) = payload_arg.get_stringish(global, b"mappings")? else {
            return Err(
                global.throw_invalid_arguments(format_args!("payload 'mappings' must be a string"))
            );
        };
        let mappings_value = bstring::OwnedString::new(mappings_value);

        let mappings_str = mappings_value.to_utf8();

        // errdefer blocks deleted: Vec<bun_core::String> drops each element (deref) on `?` unwind.
        let mut names: Vec<bstring::String> = Vec::new();
        let mut sources: Vec<bstring::String> = Vec::new();

        if let Some(sources_value) = payload_arg.get_array(global, b"sources")? {
            let mut iter = sources_value.array_iterator(global)?;
            while let Some(source) = iter.next()? {
                let source_str = source.to_bun_string(global)?;
                sources.push(source_str);
            }
        }

        if let Some(names_value) = payload_arg.get_array(global, b"names")? {
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
            i32::MAX as usize,
            mapping::ParseOptions {
                allow_names: true,
                sort: true,
            },
        );

        let mapping_list = match parse_result {
            ParseResult::Success(parsed) => parsed,
            ParseResult::Fail(fail) => {
                if let Some(loc) = fail.loc.to_nullable() {
                    return Err(global.throw_value(global.create_syntax_error_instance(
                        format_args!("{} at {}", BStr::new(fail.msg), loc.start),
                    )));
                }
                return Err(global.throw_value(
                    global.create_syntax_error_instance(format_args!("{}", BStr::new(fail.msg))),
                ));
            }
        };

        let source_map = Box::new(JSSourceMap {
            sourcemap: Arc::new(mapping_list),
            sources: sources.into_boxed_slice(),
            names: names.into_boxed_slice(),
        });

        if !payload_arg.is_empty() {
            Self::payload_set_cached(this_value, global, payload_arg);
        }
        if !line_lengths.is_empty() {
            Self::line_lengths_set_cached(this_value, global, line_lengths);
        }

        Ok(source_map)
    }

    // ── codegen accessors ──
    // generate-classes.ts emits the C++ side of `*SetCachedValue`/`__create`;
    // these thunks forward to those extern symbols by hand.
    #[inline]
    fn to_js(this: Box<Self>, global: &JSGlobalObject) -> JSValue {
        // SAFETY: `global` is live; `this` is the freshly-constructed payload whose
        // ownership transfers to the C++ JSCell wrapper (`m_ctx`). The extern takes
        // an erased `*mut ()` (matching `src/jsc/generated.rs::__create`) since
        // C++ stores it opaquely; cast back in `finalize`.
        unsafe {
            SourceMap__create(
                global.as_mut_ptr(),
                bun_core::heap::into_raw(this).cast::<()>(),
            )
        }
    }
    #[inline]
    fn payload_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        // SAFETY: `global` is live; `this_value` is the freshly-constructed wrapper.
        unsafe {
            SourceMapPrototype__payloadSetCachedValue(this_value, global.as_mut_ptr(), value)
        };
    }
    #[inline]
    fn line_lengths_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        // SAFETY: `global` is live; `this_value` is the freshly-constructed wrapper.
        unsafe {
            SourceMapPrototype__lineLengthsSetCachedValue(this_value, global.as_mut_ptr(), value)
        };
    }

    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<JSSourceMap>()
            + self.sources.len() * core::mem::size_of::<bstring::String>()
            + self.sourcemap.memory_cost()
    }

    pub fn estimated_size(&self) -> usize {
        self.memory_cost()
    }

    // The cached value should handle this.
    pub fn get_payload(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    // The cached value should handle this.
    pub fn get_line_lengths(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
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

    pub fn find_origin(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [line_number, column_number] = get_line_column(global, frame)?;

        let Some(mapping) = this.sourcemap.find_mapping(
            Ordinal::from_zero_based(line_number),
            Ordinal::from_zero_based(column_number),
        ) else {
            return Ok(JSValue::create_empty_object(global, 0));
        };
        let name = this.mapping_name_to_js(global, &mapping)?;
        let source = this.source_name_to_js(global, &mapping)?;
        // SAFETY: C++ FFI; arguments are valid JSValues and a live JSGlobalObject.
        // `as_ptr()` derives `*mut` via the struct's `UnsafeCell` interior, so the
        // C++ callee may mutate the global without laundering a read-only pointer.
        Ok(unsafe {
            Bun__createNodeModuleSourceMapOriginObject(
                global.as_mut_ptr(),
                name,
                JSValue::js_number(mapping.original.lines.zero_based() as f64),
                JSValue::js_number(mapping.original.columns.zero_based() as f64),
                source,
            )
        })
    }

    pub fn find_entry(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [line_number, column_number] = get_line_column(global, frame)?;

        let Some(mapping) = this.sourcemap.find_mapping(
            Ordinal::from_zero_based(line_number),
            Ordinal::from_zero_based(column_number),
        ) else {
            return Ok(JSValue::create_empty_object(global, 0));
        };

        let name = this.mapping_name_to_js(global, &mapping)?;
        let source = this.source_name_to_js(global, &mapping)?;
        // SAFETY: C++ FFI; arguments are valid JSValues and a live JSGlobalObject.
        // `as_ptr()` derives `*mut` via the struct's `UnsafeCell` interior, so the
        // C++ callee may mutate the global without laundering a read-only pointer.
        Ok(unsafe {
            Bun__createNodeModuleSourceMapEntryObject(
                global.as_mut_ptr(),
                JSValue::js_number(mapping.generated.lines.zero_based() as f64),
                JSValue::js_number(mapping.generated.columns.zero_based() as f64),
                JSValue::js_number(mapping.original.lines.zero_based() as f64),
                JSValue::js_number(mapping.original.columns.zero_based() as f64),
                source,
                name,
            )
        })
    }
}

fn get_line_column(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<[i32; 2]> {
    let line_number_value = frame.argument(0);
    let column_number_value = frame.argument(1);

    Ok([
        // Node.js does no validations.
        line_number_value.coerce::<i32>(global)?,
        column_number_value.coerce::<i32>(global)?,
    ])
}

// Codegen-emitted helpers (`SourceMap__create`, `*SetCachedValue`) are defined
// in ZigGeneratedClasses.cpp with `extern JSC_CALLCONV` (= `"C" SYSV_ABI` on
// Windows-x64), so they must be imported via `jsc_abi_extern!` to get the
// matching `extern "sysv64"` cfg-arm — plain `extern "C"` here would call them
// with the win64 ABI and corrupt arguments.
bun_jsc::jsc_abi_extern! {
    // Codegen-emitted constructor thunk; ownership of `ctx` transfers to the C++ JSCell.
    // `ctx` is type-erased to `*mut ()` (C++ stores it as `void* m_ctx`) to keep
    // the extern FFI-safe — `JSSourceMap` itself has Rust-only field layout.
    fn SourceMap__create(globalObject: *mut JSGlobalObject, ctx: *mut ()) -> JSValue;

    // Codegen-emitted cached-value setters; names match generated_classes.ts output.
    fn SourceMapPrototype__payloadSetCachedValue(
        thisValue: JSValue,
        globalObject: *mut JSGlobalObject,
        value: JSValue,
    );
    fn SourceMapPrototype__lineLengthsSetCachedValue(
        thisValue: JSValue,
        globalObject: *mut JSGlobalObject,
        value: JSValue,
    );
}

// These two are hand-written in `src/jsc/modules/NodeModuleModule.cpp` as
// plain `extern "C"` (no `JSC_CALLCONV`/`SYSV_ABI`), so they use the platform
// default — keep them in a separate `extern "C"` block.
unsafe extern "C" {
    fn Bun__createNodeModuleSourceMapOriginObject(
        globalObject: *mut JSGlobalObject,
        name: JSValue,
        line: JSValue,
        column: JSValue,
        source: JSValue,
    ) -> JSValue;

    fn Bun__createNodeModuleSourceMapEntryObject(
        globalObject: *mut JSGlobalObject,
        generatedLine: JSValue,
        generatedColumn: JSValue,
        originalLine: JSValue,
        originalColumn: JSValue,
        source: JSValue,
        name: JSValue,
    ) -> JSValue;
}

//! `BUN_OTEL=1`, `[otel]` in bunfig.toml, and `Bun.otel.start()`.

use core::cell::Cell;
use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use bun_core::{String as BunString, StringPointer};
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{HeadersRef, JSArrayIterator, JSGlobalObject, JSObject, JSValue, JsResult};
use bun_removable_features::{Feature, is_removed, removable_body};
use bun_telemetry::processor::{self, Exporter};
use bun_telemetry::{Instrument, InstrumentSet, RootSampler, Sampler, Value};
use bun_telemetry_cold::config::{
    self, Activation, Compression, Config, ExporterConfig, OtlpExporterConfig, ResourceValue,
};
use bun_telemetry_cold::resource::{self, ResourceInfo};

use crate::exporter::{self, JsExporter, JsFormat, OwnedJsExporter, warn_now as warn};
use crate::generated_bindgen::telemetry::{
    ExporterCompression, ExporterOptions, Propagator, StartOptions,
};
use crate::state::VmState;
use crate::{engine, values};

unsafe extern "Rust" {
    /// `os.hostname()` and `os.release()`. Defined in `bun_runtime::jsc_hooks`.
    safe fn __bun_os_hostname_and_release() -> (BunString, BunString);
}

/// Whether the exporters of the environment are in place. Of the threads that start at once, one adds them.
static IS_SET_UP: bun_threading::Guarded<bool> = bun_threading::Guarded::new(false);

fn lossy(bytes: &[u8]) -> String {
    bstr::ByteSlice::to_str_lossy(bytes).into_owned()
}

/// On every thread, before its first module.
pub fn before_entry_point() {
    let vm = VirtualMachine::get();
    let variable = vm.env_loader().get(b"BUN_OTEL");
    if !bun_telemetry::configured() && variable.is_none() && config::bunfig().is_none() {
        return;
    }
    if is_removed(Feature::Telemetry) {
        if vm.is_main_thread.get() && variable.is_none_or(bun_core::env_var::string_is_truthy) {
            bun_core::warn!(
                "[otel] this executable was built without OpenTelemetry\nnote: --trim keeps it if your code uses Bun.otel. `void Bun.otel` is enough"
            );
        }
        return;
    }
    removable_body!(Telemetry, Abort, { configure_from_environment(vm) });
}

#[optimize(size)]
fn configure_from_environment(vm: &'static VirtualMachine) {
    let global = vm.global();
    let mut is_set_up = IS_SET_UP.lock();
    if !*is_set_up {
        let loader = vm.env_loader();
        let env = config::from_env(&|name| loader.get(name.as_bytes()).map(<[u8]>::to_vec));
        if env.activation != Activation::On {
            return;
        }
        for warning in &env.warnings {
            warn(format_args!("{warning}"));
        }
        let Some(state) = VmState::get(global) else {
            return;
        };
        match exporter::build(vm, &env.config.exporters) {
            Ok(exporters) => {
                apply(state, &env.config, exporters, Exporters::Add);
                *is_set_up = true;
            }
            Err(invalid) => warn(format_args!("{invalid}")),
        }
    }
    drop(is_set_up);
    if bun_telemetry::any_enabled()
        && let Some(state) = VmState::get(global)
        && let Err(thrown) = state.register_with_api()
    {
        let _ = bun_jsc::task::report_error_or_terminate(global, thrown);
    }
}

/// `bun test --isolate`: the next file starts from the environment.
pub(crate) fn undo_start(state: &VmState) {
    let mut is_set_up = IS_SET_UP.lock();
    bun_telemetry::shut_down();
    processor::global().hand_out_pending();
    processor::global().install_exporters(Some(state.owner_key()), Vec::new());
    *is_set_up = false;
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Exporters {
    Add,
    /// But for the functions of other threads.
    Replace,
}

#[optimize(size)]
fn apply(state: &VmState, config: &Config, exporters: Vec<Arc<dyn Exporter>>, how: Exporters) {
    let processor = processor::global();
    bun_telemetry::set_sampler(config.sampler);
    bun_telemetry::set_state(config.state());
    processor.set_config(config.batch);
    let (host_name, os_version) = __bun_os_hostname_and_release();
    processor.set_resource(resource::encode(&ResourceInfo {
        service_name: config.service_name.as_deref(),
        extra: &config.resource_attributes,
        runtime_version: bun_core::Environment::VERSION_STRING,
        pid: std::process::id(),
        command: state.global().bun_vm().main().unwrap_or_default(),
        executable_path: bun_core::self_exe_path().map_or(b"", |path| path.as_bytes()),
        host_name: &host_name.to_utf8(),
        host_arch: match bun_core::Environment::ARCH {
            bun_core::Environment::Architecture::X64 => "amd64",
            bun_core::Environment::Architecture::Arm64 => "arm64",
            bun_core::Environment::Architecture::Wasm => "wasm32",
        },
        os_type: if cfg!(windows) {
            "windows"
        } else {
            bun_core::Environment::OS.npm_name()
        },
        os_version: &os_version.to_utf8(),
    }));
    let replaced = (how == Exporters::Replace).then(|| state.owner_key());
    processor.install_exporters(replaced, exporters);
    bun_telemetry::activate(config.instruments, config.roots);
    state.rearm_timer();
}

/// `process.env` as it is now: a dotenv loader may have run.
#[optimize(size)]
fn read_process_env(global: &JSGlobalObject) -> JsResult<(config::EnvConfig, Option<Vec<u8>>)> {
    let env = engine::process_env(global)?;
    let thrown = Cell::new(None);
    let has_thrown = Cell::new(false);
    let get = |name: &str| {
        if has_thrown.get() || !env.is_object() {
            return None;
        }
        let value = env.get(global, name).and_then(|value| match value {
            Some(value) if value.is_string_literal() => Ok(Some(value.to_utf8(global)?.to_vec())),
            _ => Ok(None),
        });
        value.unwrap_or_else(|error| {
            thrown.set(Some(error));
            has_thrown.set(true);
            None
        })
    };
    let config = config::from_env(&get);
    let sampler_arg = get("OTEL_TRACES_SAMPLER_ARG");
    thrown.take().map_or(Ok((config, sampler_arg)), Err)
}

#[optimize(size)]
pub(crate) fn start<'a>(cx: &mut JsScope<'a>, options: Option<&StartOptions<'a>>) -> JsResult<()> {
    let global = cx.global();
    let (env, env_sampler_arg) = read_process_env(global)?;
    if env.activation == Activation::SdkDisabled {
        static HAS_WARNED: AtomicBool = AtomicBool::new(false);
        if !HAS_WARNED.swap(true, Ordering::Relaxed) {
            warn(format_args!(
                "Bun.otel.start() ignored: OTEL_SDK_DISABLED is set"
            ));
        }
        return Ok(());
    }
    let Some(state) = VmState::get(global) else {
        return Ok(());
    };
    let mut config = env.config;
    let mut functions = Vec::new();
    let mut how = Exporters::Add;
    if let Some(options) = options {
        read_options(global, options, env_sampler_arg.as_deref(), &mut config)?;
        if options.endpoint.is_some() || options.exporters.is_some() {
            how = Exporters::Replace;
            read_exporters(state, options, &mut config, &mut functions)?;
        } else if options.headers.is_some() {
            return Err(global
                .throw_invalid_arguments(format_args!("options.headers needs options.endpoint")));
        }
    }

    let mut is_set_up = IS_SET_UP.lock();
    let is_first = !*is_set_up;
    if is_first {
        for warning in &env.warnings {
            warn(format_args!("{warning}"));
        }
    }
    if how == Exporters::Add && !is_first {
        config.exporters.clear();
    }
    let mut exporters = match exporter::build(global.bun_vm(), &config.exporters) {
        Ok(exporters) => exporters,
        Err(invalid) => {
            drop(is_set_up);
            return Err(global.throw_invalid_arguments(format_args!("{invalid}")));
        }
    };
    if !is_first {
        // With the resource they were recorded under.
        processor::global().hand_out_pending();
    }
    if how == Exporters::Replace {
        JsExporter::retire_all(state);
    }
    exporters.extend((functions.iter()).map(|f| Arc::clone(&f.shared) as Arc<dyn Exporter>));
    state.did_call_start(functions);
    apply(state, &config, exporters, how);
    *is_set_up = true;
    drop(is_set_up);
    JsExporter::release_retired(state);
    state.register_with_api()
}

#[optimize(size)]
fn read_options(
    global: &JSGlobalObject,
    options: &StartOptions<'_>,
    env_sampler_arg: Option<&[u8]>,
    config: &mut Config,
) -> JsResult<()> {
    if let Some(attributes) = options.resource_attributes {
        values::for_each_attribute(global, attributes.to_js(), |key, value| {
            let value = match *value {
                Value::Str(s) => ResourceValue::Str(lossy(s)),
                Value::Int(i) => ResourceValue::Int(i),
                Value::Double(d) => ResourceValue::Double(d),
                Value::Bool(b) => ResourceValue::Bool(b),
                Value::Array(_) | Value::Empty => return,
            };
            if key == b"service.name" {
                config.service_name = Some(value.to_string());
            } else {
                config.resource_attributes.push((lossy(key), value));
            }
        })?;
    }
    if let Some(name) = options.service_name {
        config.service_name = Some(lossy(name));
    }
    let (sampler, arg) = (options.sampler.to_js(), options.sampler_arg.to_js());
    if !sampler.is_undefined_or_null() {
        config.sampler = read_sampler(global, sampler, arg, env_sampler_arg)?;
    } else if !arg.is_undefined_or_null() {
        return Err(global
            .throw_invalid_arguments(format_args!("options.samplerArg needs options.sampler")));
    }
    if let Some(instrumentations) = options.instrumentations {
        read_instrumentations(global, instrumentations.to_js(), config)?;
    }
    fn set<T>(target: &mut T, value: Option<T>) {
        if let Some(value) = value {
            *target = value;
        }
    }
    if let Some(batch) = &options.batch {
        set(&mut config.batch.scheduled_delay_ms, batch.delay_ms);
        set(&mut config.batch.export_timeout_ms, batch.timeout_ms);
        set(&mut config.batch.max_queue_size, batch.max_queue_size);
        set(
            &mut config.batch.max_export_batch_size,
            batch.max_export_batch_size,
        );
    }
    if let Some(limits) = &options.limits {
        set(&mut config.limits.attributes, limits.attribute_count_limit);
        set(&mut config.limits.events, limits.event_count_limit);
        set(&mut config.limits.links, limits.link_count_limit);
        set(
            &mut config.limits.attribute_value_length,
            limits.attribute_value_length_limit,
        );
    }
    set(
        &mut config.capture_db_statement,
        options.capture_db_statement,
    );
    if let Some(propagators) = &options.propagators {
        config.propagate_trace_context = propagators.contains(&Propagator::Tracecontext);
        config.propagate_baggage = propagators.contains(&Propagator::Baggage);
    }
    Ok(())
}

#[optimize(size)]
fn read_exporters(
    state: &VmState,
    options: &StartOptions<'_>,
    config: &mut Config,
    functions: &mut Vec<OwnedJsExporter>,
) -> JsResult<()> {
    let global = state.global();
    let defaults = config.otlp_defaults.clone();
    let otlp = |url: &[u8], mut headers, own: Option<JsLocal<'_, JSObject>>| -> JsResult<_> {
        if let Some(own) = own {
            config::merge_headers(&mut headers, read_headers(global, own.to_js())?);
        }
        Ok(OtlpExporterConfig {
            url: config::normalize_traces_url(&lossy(url)),
            headers,
            ..defaults
        })
    };
    config.exporters.clear();
    if let Some(url) = options.endpoint {
        (config.exporters).push(ExporterConfig::Otlp(otlp(
            url,
            defaults.headers.clone(),
            options.headers,
        )?));
    } else if options.headers.is_some() {
        return Err(
            global.throw_invalid_arguments(format_args!("options.headers needs options.endpoint"))
        );
    }
    let Some(list) = options.exporters else {
        return Ok(());
    };
    // Not the headers of the environment: a list may name several vendors, and they are the credentials for one.
    let mut list = JSArrayIterator::init(list.to_js(), global)?;
    while let Some(item) = list.next()? {
        if item.is_string_literal() {
            match &*item.to_utf8(global)? {
                b"console" => config.add_console(),
                url => (config.exporters).push(ExporterConfig::Otlp(otlp(url, Vec::new(), None)?)),
            }
            continue;
        }
        ExporterOptions::from_js(global, item, |exporter| {
            let mut given = [
                (exporter.export_objects, JsFormat::Objects),
                (exporter.export_protobuf, JsFormat::Protobuf),
                (exporter.export_json, JsFormat::Json),
            ]
            .into_iter()
            .filter_map(|(function, format)| Some((function?, format)));
            match (given.next(), given.next(), exporter.url.as_deref()) {
                (Some((function, format)), None, None) => {
                    functions.push(JsExporter::create(state, function.to_js(), item, format));
                }
                (None, _, Some(url)) => {
                    let mut otlp = otlp(url, Vec::new(), exporter.headers)?;
                    match exporter.compression {
                        Some(ExporterCompression::Gzip) => otlp.compression = Compression::Gzip,
                        Some(ExporterCompression::None) => otlp.compression = Compression::None,
                        None => {}
                    }
                    otlp.timeout_ms = exporter.timeout_ms.unwrap_or(otlp.timeout_ms);
                    config.exporters.push(ExporterConfig::Otlp(otlp));
                }
                _ => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "an exporter needs exactly one of url, export(), exportProtobuf() and exportJSON()"
                    )));
                }
            }
            Ok(())
        })?;
    }
    Ok(())
}

/// In the forms that `fetch()` takes.
#[optimize(size)]
fn read_headers(global: &JSGlobalObject, init: JSValue) -> JsResult<Vec<(String, String)>> {
    let Some(headers) = HeadersRef::create_from_js(global, init)? else {
        return Ok(Vec::new());
    };
    let (count, len) = headers.count().unwrap_or_default();
    let mut names = vec![StringPointer::default(); count as usize];
    let mut values = names.clone();
    let mut text = vec![0u8; len as usize];
    headers.copy_to(&mut names, &mut values, &mut text);
    let text = |p: StringPointer| lossy(&text[p.offset as usize..][..p.length as usize]);
    let pairs = names.into_iter().zip(values);
    Ok(pairs
        .map(|(name, value)| (text(name), text(value)))
        .collect())
}

#[optimize(size)]
fn read_sampler(
    global: &JSGlobalObject,
    sampler: JSValue,
    arg: JSValue,
    env_arg: Option<&[u8]>,
) -> JsResult<Sampler> {
    let ratio = |name: &'static [u8], value: f64| {
        if (0.0..=1.0).contains(&value) {
            return Ok(value);
        }
        let range = bun_core::fmt::OutOfRangeOptions {
            min: 0,
            max: 1,
            field_name: name,
            ..Default::default()
        };
        Err(global.throw_range_error(value, range))
    };
    if let Some(number) = sampler.get_number() {
        let threshold = Sampler::ratio_threshold(ratio(b"options.sampler", number)?);
        return Ok(Sampler::ParentBased(RootSampler::TraceIdRatio(threshold)));
    }
    if !sampler.is_string_literal() {
        return Err(global.throw_invalid_arguments(format_args!(
            "options.sampler must be a ratio (number) or the name of a sampler (string)"
        )));
    }
    let arg = match arg.get_number() {
        Some(number) => Some(ratio(b"options.samplerArg", number)?),
        None if arg.is_undefined_or_null() => Sampler::parse_ratio_arg(env_arg).unwrap_or(None),
        None => {
            return Err(global.throw_invalid_argument_type_value(
                "options.samplerArg",
                "number",
                arg,
            ));
        }
    };
    let name = sampler.to_utf8(global)?;
    Sampler::from_env(&name, arg).ok_or_else(|| {
        global.throw_invalid_arguments(format_args!(
            "unknown sampler {:?}",
            bstr::BStr::new(&*name)
        ))
    })
}

#[optimize(size)]
fn read_instrumentations(
    global: &JSGlobalObject,
    given: JSValue,
    config: &mut Config,
) -> JsResult<()> {
    let instrument = |name: &[u8]| {
        Instrument::from_name(name).ok_or_else(|| {
            let name = bstr::BStr::new(name);
            global.throw_invalid_arguments(format_args!("unknown instrumentation {name:?}"))
        })
    };
    if given.is_array() {
        config.instruments = InstrumentSet::of(Instrument::User);
        let mut names = JSArrayIterator::init(given, global)?;
        while let Some(name) = names.next()? {
            config
                .instruments
                .insert(instrument(&name.to_utf8(global)?)?);
        }
        return Ok(());
    }
    engine::for_each_attribute(global, given, |name, mode| {
        let i = instrument(name)?;
        if mode.is_undefined() {
            return Ok(());
        }
        if mode == JSValue::FALSE {
            config.instruments.remove(i);
            return Ok(());
        }
        config.instruments.insert(i);
        if mode == JSValue::TRUE {
            return Ok(());
        }
        let text = (mode.is_string_literal().then(|| mode.to_utf8(global))).transpose()?;
        match text.as_deref() {
            Some(b"always") => config.roots.insert(i),
            Some(b"nested") => config.roots.remove(i),
            _ => {
                return Err(global.throw_invalid_arguments(format_args!(
                    "options.instrumentations.{} must be a boolean, \"always\" or \"nested\"",
                    i.name()
                )));
            }
        }
        Ok(())
    })
}

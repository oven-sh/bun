//! `contentTracing`: a file in the format of Chromium's traces.

use bun_jsc::virtual_machine::VirtualMachine;
use bun_web::renderer::Tracing;
use bun_web::trace;

use crate::contents::process as page_processes;
use crate::generated_bindgen::electron::ElectronContentTracing;
use crate::prelude::*;
use crate::text::{random_uuid, split, split_once};
use crate::value::Value;
use crate::webview::wire;
use crate::{files, paths, process, task};

const USER_TIMING: &str = "blink.user_timing";
const LOADING: &str = "loading";
const INPUT: &str = "input";
const SAMPLES: &str = "disabled-by-default-v8.cpu_profiler";
const ALL: [&str; 4] = [USER_TIMING, SAMPLES, INPUT, LOADING];

unsafe extern "C" {
    safe fn Bun__stopCPUProfiler(
        vm: &bun_jsc::VM,
        json: Option<&mut bun_core::String>,
        text: Option<&mut bun_core::String>,
    );
}

struct Recording {
    categories: Vec<&'static str>,
    room: usize,
}

state!(fn recording() -> RefCell<Option<Recording>>);

fn matches(pattern: &str, name: &str) -> bool {
    match split_once(pattern, "*") {
        Some((start, end)) => {
            name.len() >= start.len() + end.len() && name.starts_with(start) && name.ends_with(end)
        }
        None => pattern == name,
    }
}

fn categories(options: &Value) -> Vec<&'static str> {
    let texts = |name: &str| options[name].items().iter().map(Value::text);
    let filter = || split(options["categoryFilter"].text(), ",").map(str::trim);
    let included: Vec<_> = texts("included_categories")
        .chain(filter().filter(|it| !it.is_empty() && !it.starts_with('-')))
        .collect();
    let excluded: Vec<_> = texts("excluded_categories")
        .chain(filter().filter_map(|it| it.strip_prefix('-')))
        .collect();
    let is_optional = |it: &str| it.starts_with("disabled-by-default-");
    let is_wanted = |name: &&str| {
        let mut patterns = (included.iter()).filter(|it| is_optional(it) == is_optional(name));
        let is_by_default = !is_optional(name) && patterns.clone().next().is_none();
        patterns.any(|it| matches(it, name))
            || (is_by_default && !excluded.iter().any(|it| matches(it, name)))
    };
    ALL.into_iter().filter(is_wanted).collect()
}

fn samples(on_thread: &Value) -> Vec<Value> {
    let mut json = bun_core::String::EMPTY;
    Bun__stopCPUProfiler(VirtualMachine::get().jsc_vm(), Some(&mut json), None);
    #[cfg(windows)]
    crate::win32::set_fine_clock(false);
    let profile = Value::parse(json.to_utf8().slice()).unwrap_or_default();
    let nodes = profile["nodes"].items();
    let mut parents = vec![None; nodes.len() + 1];
    for node in nodes {
        for child in node["children"].items() {
            if let Some(parent) = parents.get_mut(child.number() as usize) {
                *parent = Some(node["id"].number());
            }
        }
    }
    let describe = |it: &Value| {
        let parent = parents.get(it["id"].number() as usize).copied().flatten();
        it.pick(&["id", "callFrame"]).with("parent", parent)
    };
    let tree = record! { "nodes": nodes.iter().map(describe).collect::<Value>(), "samples": &profile["samples"] };
    let event = |name: &str, time: &str, data: Value| {
        record! { "name": name, "cat": SAMPLES, "ph": "P", "id": "0x1", "ts": &profile[time], "args": record! { "data": data } }
            .and(on_thread)
    };
    vec![
        event("Profile", "startTime", profile.pick(&["startTime"])),
        event(
            "ProfileChunk",
            "endTime",
            record! { "cpuProfile": tree, "timeDeltas": &profile["timeDeltas"] },
        ),
    ]
}

pub(crate) fn in_progress() -> Option<Tracing> {
    (recording().borrow().as_ref()).map(|it| Tracing {
        categories: it.categories.iter().map(|it| (*it).to_owned()).collect(),
        room: it.room.try_into().unwrap_or(u32::MAX),
    })
}

/// In a page process.
pub(crate) fn join(it: &Tracing) {
    let is_wanted = |name: &&str| it.categories.iter().any(|it| it == name);
    Recording::start(
        ALL.into_iter().filter(is_wanted).collect(),
        it.room as usize,
    );
}

pub(crate) fn finish_for_app() -> String {
    Value::List(
        recording()
            .take()
            .map(Recording::finish)
            .unwrap_or_default(),
    )
    .to_json()
}

impl Recording {
    fn start(categories: Vec<&'static str>, room: usize) {
        if recording().borrow().is_none() {
            if categories.contains(&SAMPLES) {
                #[cfg(windows)]
                crate::win32::set_fine_clock(true);
                bun_jsc::bun_cpu_profiler::start_cpu_profiler(VirtualMachine::get().jsc_vm());
            }
            trace::restart(room);
            recording().replace(Some(Recording { categories, room }));
        }
    }

    fn finish(self) -> Vec<Value> {
        let on = |thread: u64| record! { "pid": process::id(), "tid": thread as f64 };
        let main = on(trace::this_thread());
        let name = |of: &str, name: &str| {
            record! { "name": of, "cat": "__metadata", "ph": "M", "ts": 0, "args": record! { "name": name } }
                .and(&main)
        };
        let mut all = vec![
            name("process_name", "Renderer"),
            name("thread_name", "CrRendererMain"),
        ];
        for (it, id) in trace::restart(0).into_iter().zip(1..) {
            let category = match it.kind {
                "mark" | "measure" => USER_TIMING,
                "event" | "first-input" => INPUT,
                _ => LOADING,
            };
            if !self.categories.contains(&category) {
                continue;
            }
            let event = |phase: &str, time: f64| {
                let args = record! { "entryType": it.kind };
                record! { "name": &*it.name, "cat": category, "ph": phase, "ts": (time * 1e3).round(), "args": args }
                    .and(&on(it.thread))
            };
            if it.kind == "measure" || it.duration > 0. {
                let id = format!("0x{id:x}");
                all.push(event("b", it.start).with("id", &*id));
                all.push(event("e", it.start + it.duration).with("id", id));
            } else {
                all.push(event("I", it.start).with("s", "t"));
            }
        }
        if self.categories.contains(&SAMPLES) {
            all.extend(samples(&main));
        }
        all
    }
}

impl ElectronContentTracing {
    pub(crate) fn get_categories(_: Cx<'_, '_>) -> JsResult<JSValue> {
        resolved(js(&ALL.into_iter().map(Value::from).collect::<Value>())?)
    }

    pub(crate) fn get_trace_buffer_usage(_: Cx<'_, '_>) -> JsResult<JSValue> {
        let (count, room) = (
            trace::count(),
            recording().borrow().as_ref().map(|it| it.room),
        );
        let share = room.map_or(0., |it| count as f64 / it as f64);
        resolved(object!({ "value": count as f64, "percentage": share }))
    }

    pub(crate) fn start_recording<'a>(_: Cx<'a, '_>, options: JsLocal<'a>) -> JsResult<JSValue> {
        let (options, vm) = (wire::data_from_js(options.to_js())?, VirtualMachine::get());
        if recording().borrow().is_some() {
            return resolved(JSValue::UNDEFINED);
        }
        let mut categories = categories(&options);
        let for_exit = vm.cpu_profiler_config.take();
        categories.retain(|it| *it != SAMPLES || for_exit.is_none());
        vm.cpu_profiler_config.set(for_exit);
        let room = options["trace_buffer_size_in_events"].as_number();
        let room = room
            .filter(|it| *it >= 1.)
            .map_or(1 << 20, |it| it as usize);
        Recording::start(categories, room);
        page_processes::statics_changed()?;
        resolved(JSValue::UNDEFINED)
    }

    pub(crate) fn stop_recording(_: Cx<'_, '_>, path: Option<&[u8]>) -> JsResult<JSValue> {
        let (events, path) = (recording().take().map(Recording::finish), path.map(string));
        Ok(task::promise(async move {
            let mut all = events.ok_or_else(|| {
                error(format_args!(
                    "Failed to stop tracing (was a trace in progress?)"
                ))
            })?;
            for (pid, events) in page_processes::finish_traces().await {
                let events = Value::parse(events.as_bytes()).unwrap_or_default();
                let events = events.into_items().into_iter().filter(Value::is_object);
                all.extend(events.map(|it| it.with("pid", pid)));
            }
            let path = match path.filter(|it| !it.is_empty()) {
                Some(path) => path,
                None => files::join(&[&paths::temporary()?, &format!("trace-{}", random_uuid())]),
            };
            let all = record! { "traceEvents": Value::List(all), "metadata": Value::empty() };
            files::or_throw(files::write(&path, all.to_json().as_bytes(), 0o600))?;
            js(path)
        }))
    }
}

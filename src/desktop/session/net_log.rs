//! `netLog`: a file that the viewer of Chromium's can read.

use bun_sys::{Fd, File, O};
use bun_web::net::NetError;
use bun_web::net::embedder::{About, Answered};
use bun_web::time::wall_now;

use super::load::latin1;
use crate::generated_bindgen::session::ElectronNetLog;
use crate::prelude::*;
use crate::value::Value;
use crate::webview::wire;

const START: &str = r#"{"constants":{"logFormatVersion":1,"timeTickOffset":"0","clientInfo":{"name":"Bun"},"logEventTypes":{"REQUEST_ALIVE":2,"URL_REQUEST_START_JOB":136,"HTTP_TRANSACTION_READ_RESPONSE_HEADERS":245},"logEventPhase":{"PHASE_NONE":0,"PHASE_BEGIN":1,"PHASE_END":2},"logSourceType":{"NONE":0,"URL_REQUEST":1},"loadFlag":{},"loadState":{},"certStatusFlag":{},"addressFamily":{},"netError":"#;

struct Log {
    file: File,
    room: f64,
    has_secrets: bool,
    count: u32,
}

state!(fn log() -> RefCell<Option<Log>>);

pub(super) fn is_on() -> bool {
    log().borrow().is_some()
}

pub(super) fn add(about: &About, report: &Answered) {
    let Some(log) = &mut *log().borrow_mut() else {
        return;
    };
    let now = wall_now() * 1e3;
    let [start, end] = [now - report.duration, now].map(|it| (it as u64).to_string());
    let source = record! { "id": f64::from(log.count + 1), "type": 1, "start_time": &*start };
    let url = match log.has_secrets {
        true => string(about.url.href()),
        false => string(about.url.without_credentials().href()),
    };
    let asked = record! { "url": url, "method": string(&about.method) };
    let mut events = vec![(2, 1, &start, asked.clone()), (136, 1, &start, asked)];
    let mut result = record! { "answered_by": string(report.by.as_bytes()) };
    match &report.outcome {
        Err(error) => result.set("net_error", *error as i32),
        Ok((status, headers)) => {
            let line = |(name, value): (&[u8], &[u8])| {
                let name = latin1(name);
                let is_secret = ["set-cookie", "www-authenticate", "proxy-authenticate"]
                    .contains(&&*name.to_ascii_lowercase());
                match is_secret && !log.has_secrets {
                    true => format!("{name}: [{} bytes were stripped]", value.len()),
                    false => format!("{name}: {}", latin1(value)),
                }
            };
            let lines =
                core::iter::once(format!("HTTP/1.1 {status}")).chain(headers.iter().map(line));
            let lines: Value = lines.map(Value::from).collect();
            events.push((245, 0, &end, record! { "headers": lines }));
        }
    }
    events.extend([(136, 2, &end, result.clone()), (2, 2, &end, result)]);
    let mut text = String::new();
    for (kind, phase, time, params) in events {
        if log.count != 0 || !text.is_empty() {
            text.push_str(",\n");
        }
        let event = record! { "params": params, "phase": phase, "source": &source, "time": &**time, "type": kind };
        text.push_str(&event.to_json());
    }
    log.room -= text.len() as f64;
    if log.room >= 0. && log.file.write_all(text.as_bytes()).is_ok() {
        log.count += 1;
    }
}

impl ElectronNetLog {
    pub(crate) fn get_currently_logging() -> bool {
        is_on()
    }

    pub(crate) fn start_logging<'a>(
        _: Cx<'a, '_>,
        path: &[u8],
        options: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let options = wire::data_from_js(options.to_js())?;
        let (mode, room) = (&options["captureMode"], &options["maxFileSize"]);
        let modes = ["default", "includeSensitive", "everything"];
        let complaint = if path.is_empty() {
            "The first parameter must be a valid string"
        } else if !mode.is_nothing() && !modes.contains(&mode.text()) {
            "Invalid value for captureMode"
        } else if !room.is_nothing() && !matches!(room, Value::Number(_)) {
            "Invalid value for maxFileSize"
        } else if is_on() {
            "There is already a net log running"
        } else {
            ""
        };
        if !complaint.is_empty() {
            return Err(type_error(format_args!("{complaint}")));
        }
        let errors = (NetError::ALL.iter()).map(|it| (it.code().into(), (*it as i32).into()));
        let start = format!(
            "{START}{}}},\n\"events\":[\n",
            Value::Record(errors.collect()).to_json()
        );
        let how = O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC;
        let file = File::openat(Fd::cwd(), path, how, 0o600);
        let Ok(file) = file.and_then(|it| it.write_all(start.as_bytes()).map(|()| it)) else {
            let failure = Deferred::new();
            failure.settle(Err(error(format_args!("Failed to create file"))))?;
            return Ok(failure.promise());
        };
        log().replace(Some(Log {
            file,
            room: room.as_number().unwrap_or(f64::INFINITY),
            has_secrets: modes[1..].contains(&mode.text()),
            count: 0,
        }));
        super::update_reports();
        resolved(JSValue::UNDEFINED)
    }

    pub(crate) fn stop_logging(_: Cx<'_, '_>) -> JsResult<JSValue> {
        let log = log().take();
        let log = log.ok_or_else(|| error(format_args!("No net log in progress")))?;
        let _ = log.file.write_all(b"]}\n");
        super::update_reports();
        resolved(JSValue::UNDEFINED)
    }
}

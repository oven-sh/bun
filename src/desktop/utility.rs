//! `utilityProcess`, and `process.parentPort` in such a process.

use crate::generated_bindgen::ipc::{
    ElectronParentPort, ElectronUtilityProcesses, ForkOptions, js_ElectronParentPort,
    js_ElectronUtilityProcess as fields,
};
use crate::ports::Carrier;
use crate::prelude::*;
use crate::realm::{self, Module};
use crate::value::Value;
use crate::webview::wire;
use crate::{app, command_line, crash_reporter, files, process};

const MARKER: &str = "BUN_DESKTOP_UTILITY_PROCESS";

#[derive(Default)]
struct State {
    running: RefCell<Vec<Root<UtilityProcess>>>,
    parent: RefCell<Option<Root<Carrier>>>,
    /// The array of the events that wait for `start()`.
    waiting: StrongCell,
}

state!(fn state() -> State);

pub(crate) struct UtilityProcess {
    name: String,
    creation_time: Cell<f64>,
    is_spawned: Cell<bool>,
}

fn on(emitter: JSValue, event: &str, listener: JSValue) -> JsResult<()> {
    invoke(emitter, "on", &[js(event)?, listener]).map(drop)
}

pub(crate) fn metrics(id: JSValue, name: &str, creation_time: f64) -> JsResult<JSValue> {
    Ok(object!({
        "pid": id,
        "type": "Utility",
        "name": name,
        "serviceName": "node.mojom.NodeService",
        "cpu": object!({ "percentCPUUsage": 0, "idleWakeupsPerSecond": 0 }),
        "creationTime": creation_time,
        "memory": object!({ "workingSetSize": 0, "peakWorkingSetSize": 0 }),
    }))
}

pub(crate) fn add_metrics_to(all: JSValue) -> JsResult<()> {
    let at = |index| state().running.borrow().get(index).map(Root::get);
    ((0..).map_while(at)).try_for_each(|it| {
        all.push(
            global(),
            metrics(get(it.child(), "pid")?, &it.name, it.creation_time.get())?,
        )
    })
}

fn stdio(given: Option<JSValue>) -> JsResult<JSValue> {
    let given = given.map_or_else(|| js("inherit"), Ok)?;
    let all = if given.is_array() {
        array(&elements(given)?)?
    } else {
        array(&[js("ignore")?, given, given])?
    };
    if text_of(all.get_index(global(), 0)?)? != "ignore" {
        return Err(error(format_args!(
            "stdin value other than ignore is not supported."
        )));
    }
    all.push(global(), js("ipc")?)?;
    Ok(all)
}

impl UtilityProcess {
    fn fork(
        module: &str,
        arguments: Vec<String>,
        options: &ForkOptions<'_>,
    ) -> JsResult<&'static UtilityProcess> {
        let name = string(
            options
                .service_name
                .as_deref()
                .unwrap_or(b"Node Utility Process"),
        );
        // The entry point of an executable loads this module first, and then only goes on in the main process.
        let in_executable = bun_web::compiled::path_of(files::to_url(module).as_bytes());
        let about = object!({
            "serviceName": &*name,
            "resourcesPath": get(process::object(), "resourcesPath")?,
            "userAgent": app::user_agent()?,
            "inExecutable": in_executable.as_deref(),
            "locale": app::locale()?,
            "crashReporter": &crash_reporter::for_utility_process(),
            "switches": &(command_line::all().into_iter()).map(|it| list![it.0, it.1]).collect::<Value>(),
        });
        let given = options
            .env
            .map_or_else(|| get(process::object(), "env"), |it| Ok(it.to_js()))?;
        let environment = process::copy_of_environment(given, &[MARKER, "BUN_BE_BUN"])?;
        environment.put(
            global(),
            MARKER.as_bytes(),
            js(&*about.json_stringify_fast(global())?.to_utf8())?,
        );
        let mut command = Vec::new();
        if in_executable.is_none() {
            environment.put(global(), b"BUN_BE_BUN", js("1")?);
            command.extend([
                "--preload=bun:desktop/electron".into(),
                "--no-env-file".into(),
            ]);
            command.extend(options.exec_argv.iter().flatten().map(|it| string(it)));
        }
        command.push(module.into());
        command.extend(arguments);
        let how = object!({
            "cwd": options.cwd.to_js(),
            "env": environment,
            "stdio": stdio(options.stdio.map(JsLocal::to_js))?,
            "serialization": "advanced",
            "windowsHide": true,
        });
        let spawn = [js(process::executable())?, js(command)?, how];
        let child = invoke(
            realm::require(global(), Module::ChildProcess)?,
            "spawn",
            &spawn,
        )?;

        let it = fields::create(
            heap(),
            UtilityProcess {
                name,
                creation_time: 0.0.into(),
                is_spawned: false.into(),
            },
        );
        fields::set_child(it, child);
        let send = function(child, |child, packet| {
            match get(child, "connected")?.to_boolean() {
                true => invoke(child, "send", packet),
                false => Ok(JSValue::UNDEFINED),
            }
        })?;
        let carrier = Carrier::create(
            send,
            0,
            listener(it, |it, given| emit(it.to_js(), "message", &given[..1]))?,
        );
        fields::set_carrier(it, Some(carrier));
        on(
            child,
            "message",
            listener(carrier, |it, given| it.accept(argument(given, 0)))?,
        )?;
        on(child, "spawn", listener(it, |it, _| it.spawned())?)?;
        on(
            child,
            "exit",
            listener(it, |it, given| {
                it.exited(argument(given, 0), argument(given, 1))
            })?,
        )?;
        let failed = listener(it, |it, _| match get(it.child(), "pid")?.is_undefined() {
            true => it.exited(1.into(), JSValue::NULL),
            false => Ok(()),
        })?;
        on(child, "error", failed)?;
        Ok(it)
    }

    fn child(&self) -> JSValue {
        fields::child(self).unwrap_or_default()
    }

    fn spawned(&self) -> JsResult<()> {
        self.is_spawned.set(true);
        self.creation_time
            .set(bun_core::time::milli_timestamp() as f64);
        state().running.borrow_mut().push(Root::new(self));
        emit(self.to_js(), "spawn", &[])
    }

    fn exited(&self, code: JSValue, signal: JSValue) -> JsResult<()> {
        let signal = if code.is_number() {
            None
        } else {
            Some(text_of(signal)?)
        };
        let number =
            |name: &str| bun_core::SignalCode::from_name(name.as_bytes()).map_or(0, |it| it as i32);
        let code = signal.as_deref().map_or_else(|| code.to_int32(), number);
        self.is_spawned.set(false);
        state()
            .running
            .borrow_mut()
            .retain(|it| !same(it.get(), self));
        fields::carrier(self).map(Carrier::close).transpose()?;
        emit(self.to_js(), "exit", &[code.into()])?;
        if code == 0 {
            return Ok(());
        }
        let reason = match signal.as_deref() {
            None => "abnormal-exit",
            Some("SIGTERM" | "SIGKILL" | "SIGINT") => "killed",
            Some(_) => "crashed",
        };
        let details = object!({
            "type": "Utility",
            "reason": reason,
            "exitCode": code,
            "serviceName": "node.mojom.NodeService",
            "name": &*self.name,
        });
        announce(app::object(), "child-process-gone", &[details])
    }

    pub(crate) fn get_pid(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        if self.is_spawned.get() {
            get(self.child(), "pid")
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }

    pub(crate) fn get_stdout(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        get(self.child(), "stdout")
    }

    pub(crate) fn get_stderr(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        get(self.child(), "stderr")
    }

    pub(crate) fn post_message<'a>(
        &self,
        _: Cx<'a, '_>,
        message: JsLocal<'a>,
        transfer: JsLocal<'a>,
    ) -> JsResult<()> {
        fields::carrier(self).map_or(Ok(()), |it| it.post(0, message.to_js(), transfer.to_js()))
    }

    pub(crate) fn kill(&self, _: Cx<'_, '_>) -> JsResult<bool> {
        invoke(self.child(), "kill", &[]).map(JSValue::to_boolean)
    }
}

impl ElectronUtilityProcesses {
    pub(crate) fn fork<'a>(
        _: Cx<'a, '_>,
        module: Option<bun_core::Utf8Bytes<'static>>,
        arguments: JsLocal<'a>,
        options: JsLocal<'a>,
    ) -> JsResult<&'static UtilityProcess> {
        let Some(module) = module.map(|it| string(&it)).filter(|it| !it.is_empty()) else {
            return Err(error(format_args!("Missing UtilityProcess entry script.")));
        };
        if !app::is_ready() {
            return Err(error(format_args!(
                "utilityProcess cannot be created before app is ready."
            )));
        }
        let (arguments, options) = (arguments.to_js(), options.to_js());
        let options = if arguments.is_object() && !arguments.is_array() {
            arguments
        } else {
            options
        };
        let options = if options.is_object() {
            options
        } else {
            object!({})
        };
        ForkOptions::from_js(global(), options, |it| {
            UtilityProcess::fork(&module, texts_of(arguments)?, &it)
        })
    }
}

fn parent_port() -> JSValue {
    js_ElectronParentPort::CLASS.constructor(heap())
}

notices_listeners!(ElectronParentPort, parent_port(), |name: &str| {
    if name == "message" {
        ElectronParentPort::start();
    }
    JsResult::Ok(())
});

impl ElectronParentPort {
    pub(crate) fn start() {
        later::soon(|_| {
            let Some(waiting) = state().waiting.get() else {
                return Ok(());
            };
            state().waiting.clear();
            let mut events = waiting.array_iterator(global())?;
            while let Some(event) = events.next()? {
                emit(parent_port(), "message", &[event])?;
            }
            Ok(())
        });
    }

    pub(crate) fn pause(_: Cx<'_, '_>) -> JsResult<()> {
        if !state().waiting.is_some() {
            state().waiting.set(keep(array(&[])?));
        }
        Ok(())
    }

    pub(crate) fn post_message<'a>(_: Cx<'a, '_>, message: JsLocal<'a>) -> JsResult<()> {
        let parent = state().parent.borrow().as_ref().map(Root::get);
        parent.map_or(Ok(()), |it| it.post(0, message.to_js(), array(&[])?))
    }
}

fn received(given: &[JSValue]) -> JsResult<()> {
    let event = object!({ "data": argument(given, 0), "ports": argument(given, 1) });
    match state().waiting.get() {
        Some(waiting) => waiting.push(global(), event),
        None => emit(parent_port(), "message", &[event]),
    }
}

pub(crate) fn is_this_process() -> bool {
    state().parent.borrow().is_some()
}

/// False if this is no utility process.
pub(crate) fn enter() -> JsResult<bool> {
    let Some(about) = process::variable(MARKER)? else {
        return Ok(false);
    };
    let (process, about) = (process::object(), files::parse_json(about.as_bytes())?);
    for name in [MARKER, "BUN_BE_BUN"] {
        get(process, "env")?.delete_property(global(), name)?;
    }
    let send = get(process, "send")?.bind(global(), process, &bun_core::String::EMPTY, 1., &[])?;
    let parent = Carrier::create(send, 1, procedure(received)?);
    state().parent.replace(Some(Root::new(parent)));
    state().waiting.set(keep(array(&[])?));
    on(
        process,
        "message",
        listener(parent, |it, given| it.accept(argument(given, 0)))?,
    )?;
    on(
        process,
        "disconnect",
        procedure(|_| process::exit(JSValue::UNDEFINED))?,
    )?;
    process.put(global(), b"send", JSValue::UNDEFINED);
    assign(process, "title", get(about, "serviceName")?)?;
    process.put(global(), b"type", js("utility")?);
    process.put(global(), b"parentPort", parent_port());
    process.put(global(), b"resourcesPath", get(about, "resourcesPath")?);
    crate::modules::add_methods_to_process()?;
    let in_executable = get(about, "inExecutable")?;
    if in_executable.is_string() {
        invoke(get(process, "argv")?, "splice", &[1.into(), 1.into()])?;
        let run = function(in_executable, |path, _| {
            crate::renderer::run_compiled(global(), text_of(path)?.as_bytes())
        })?;
        global().queue_microtask(run, &[]);
    }
    let about = wire::data_from_js(about)?;
    for it in about["switches"].items() {
        command_line::set(it[0].text(), it[1].text());
    }
    command_line::set("lang", about["locale"].text());
    crash_reporter::begin_in_utility_process(&about["crashReporter"]);
    app::set_user_agent(about["userAgent"].display());
    Ok(true)
}

use core::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::Rc;

use bun_engine_platform::clock::wall_seconds;
use bun_engine_text::{StringImpl, StringRef};
use bun_engine_vm::{
    Cx, Gc, GlobalObject, JsResult, Message as _, MessageLevel, MessageType, ProxyObject, Strong,
    Value,
};

use crate::Controller;
use crate::call_stack::{AsyncTrace, CallStack};
use crate::protocol::{Json, Object, Outcome, Request, object};
use crate::remote::{Detail, settle};

struct Arguments {
    realm: Strong<Gc<GlobalObject>>,
    values: Vec<Strong<Value>>,
}

/// `Console.ConsoleMessage`
struct Message {
    source: &'static str,
    kind: MessageType,
    level: MessageLevel,
    text: StringRef,
    arguments: Option<Arguments>,
    stack: Option<(CallStack, Option<AsyncTrace>)>,
    timestamp: f64,
    repeat_count: Cell<u32>,
}

impl Message {
    fn new(source: &'static str, kind: MessageType, level: MessageLevel, text: StringRef) -> Self {
        Message {
            source,
            kind,
            level,
            text,
            arguments: None,
            stack: None,
            timestamp: wall_seconds(),
            repeat_count: Cell::new(1),
        }
    }

    /// Objects may have changed in between.
    fn repeats(&self, cx: &Cx, earlier: &Message) -> bool {
        use MessageType::{Clear, EndGroup, StartGroup, StartGroupCollapsed};
        let is_same_primitive = |(a, b): (&Strong<Value>, &Strong<Value>)| {
            let (a, b) = (a.get(cx), b.get(cx));
            !a.is_object() && settle(cx, a.strict_equals(cx, b)).unwrap_or(false)
        };
        (self.source, self.kind, self.level) == (earlier.source, earlier.kind, earlier.level)
            && !matches!(
                self.kind,
                Clear | StartGroup | StartGroupCollapsed | EndGroup
            )
            && self.text == earlier.text
            && match (&self.arguments, &earlier.arguments) {
                (Some(a), Some(b)) => {
                    a.values.len() == b.values.len()
                        && a.values.iter().zip(&b.values).all(is_same_primitive)
                }
                (a, b) => a.is_none() && b.is_none(),
            }
            && match (&self.stack, &earlier.stack) {
                (Some(a), Some(b)) => a.0.has_same_frames(&b.0),
                (a, b) => a.is_none() && b.is_none(),
            }
    }
}

fn name_of_kind(kind: MessageType) -> &'static str {
    match kind {
        MessageType::Log => "log",
        MessageType::Dir => "dir",
        MessageType::DirXml => "dirxml",
        MessageType::Table => "table",
        MessageType::Trace => "trace",
        MessageType::StartGroup => "startGroup",
        MessageType::StartGroupCollapsed => "startGroupCollapsed",
        MessageType::EndGroup => "endGroup",
        MessageType::Clear => "clear",
        MessageType::Assert => "assert",
        MessageType::Timing => "timing",
        MessageType::Profile => "profile",
        MessageType::ProfileEnd => "profileEnd",
        MessageType::Image => "image",
    }
}

fn name_of_level(level: MessageLevel) -> &'static str {
    match level {
        MessageLevel::Log => "log",
        MessageLevel::Warning => "warning",
        MessageLevel::Error => "error",
        MessageLevel::Debug => "debug",
        MessageLevel::Info => "info",
    }
}

const CHANNEL_SOURCES: [&str; 17] = [
    "xml",
    "javascript",
    "network",
    "console-api",
    "storage",
    "rendering",
    "css",
    "accessibility",
    "security",
    "content-blocker",
    "media",
    "mediasource",
    "webrtc",
    "itp-debug",
    "private-click-measurement",
    "payment-request",
    "other",
];

#[derive(Default)]
pub(crate) struct Console {
    is_enabled: Cell<bool>,
    ignores_clear: Cell<bool>,
    is_sending: Cell<bool>,
    /// The last ones, for a frontend that comes later.
    messages: RefCell<VecDeque<Rc<Message>>>,
    expired_count: Cell<usize>,
    profiles: RefCell<Vec<StringRef>>,
    breakpoints_were_active: Cell<bool>,
}

impl Console {
    pub(crate) fn disable(&self) {
        self.is_enabled.set(false);
    }

    pub(crate) fn discard_messages(&self) {
        self.messages.take();
        self.expired_count.set(0);
    }

    fn keep(&self, message: Rc<Message>) {
        const MAX_MESSAGES: usize = 100;
        const EXPIRING_AT_ONCE: usize = 10;
        let mut messages = self.messages.borrow_mut();
        messages.push_back(message);
        if messages.len() >= MAX_MESSAGES {
            messages.drain(..EXPIRING_AT_ONCE);
            self.expired_count.update(|count| count + EXPIRING_AT_ONCE);
        }
    }
}

fn console_group() -> StringRef {
    StringRef::from_literal("console")
}

fn abbreviated(title: &StringImpl) -> StringRef {
    const MAX_LENGTH: usize = 10_000;
    if title.len() <= MAX_LENGTH {
        return StringRef::retain(title);
    }
    format_args!("{}...", title.text().slice(0..MAX_LENGTH)).into_string()
}

impl Controller {
    fn wrap_arguments(
        &self,
        cx: &mut Cx,
        message: &Message,
        arguments: &Arguments,
        detail: Detail,
    ) -> JsResult<Vec<Object>> {
        let cx = cx.in_realm(arguments.realm.get(cx));
        let (remote, group) = (self.remote(cx), console_group());
        let is_table = message.kind == MessageType::Table && detail == Detail::Preview;
        let count = if is_table { 2 } else { usize::MAX };
        let mut wrapped = Vec::new();
        for (index, value) in arguments.values.iter().take(count).enumerate() {
            let value = value.get(cx);
            wrapped.push(match index {
                0 if is_table => remote.wrap(cx, value, &group, Detail::Table)?,
                0 => remote.wrap_with_text(cx, value, &group, detail, Some(&message.text))?,
                _ => remote.wrap(cx, value, &group, detail)?,
            });
        }
        Ok(wrapped)
    }

    fn send_message(&self, cx: &mut Cx, message: &Message, detail: Detail) {
        let mut parameters = None;
        if let Some(arguments) = (message.arguments.as_ref()).filter(|it| !it.values.is_empty()) {
            parameters = self.quietly(cx, |cx| {
                let wrapped = self.wrap_arguments(cx, message, arguments, detail);
                settle(cx, wrapped)
            });
            if parameters.is_none() {
                return;
            }
        }
        let stack = message.stack.as_ref();
        let frame = stack.and_then(|it| it.0.first_script_frame());
        let message = object! {
            "source": message.source,
            "level": name_of_level(message.level),
            "text": &message.text,
            "type": name_of_kind(message.kind),
            "line": frame.map_or(0, |it| it.position.line),
            "column": frame.map_or(0, |it| it.position.column),
            "url": frame.map_or_default(|it| it.url.clone()),
            "repeatCount": message.repeat_count.get(),
            "timestamp": message.timestamp,
            "parameters" => parameters,
            "stackTrace" => stack.map(|(stack, parent)| stack.to_json(parent.as_ref())),
        };
        self.notify("Console.messageAdded", object! { "message": message });
    }

    fn add_message(&self, cx: &mut Cx, message: Message) {
        let console = &self.console;
        if message.kind == MessageType::Clear && !console.ignores_clear.get() {
            self.clear_messages(cx, "console-api");
        }
        let last = console.messages.borrow().back().cloned();
        if let Some(last) = last.filter(|last| message.repeats(cx, last)) {
            last.repeat_count.update(|count| count.saturating_add(1));
            if console.is_enabled.get() {
                let params =
                    object! { "count": last.repeat_count.get(), "timestamp": wall_seconds() };
                self.notify("Console.messageRepeatCountUpdated", params);
            }
            return;
        }
        if console.is_enabled.get() {
            // A getter that a preview calls may log.
            let was_sending = console.is_sending.replace(true);
            self.send_message(cx, &message, Detail::preview_if(!was_sending));
            console.is_sending.set(was_sending);
        }
        console.keep(Rc::new(message));
    }

    fn clear_messages(&self, cx: &Cx, reason: &'static str) {
        self.console.discard_messages();
        self.registries.release_group(cx, &console_group());
        if self.console.is_enabled.get() {
            self.notify("Console.messagesCleared", object! { "reason": reason });
        }
    }

    fn enable_console(&self, cx: &mut Cx) {
        if self.console.is_enabled.replace(true) {
            return;
        }
        let expired = self.console.expired_count.get();
        if expired != 0 {
            let text = format_args!("{expired} console messages are not shown.").into_string();
            let message = Message::new("other", MessageType::Log, MessageLevel::Warning, text);
            self.send_message(cx, &message, Detail::None);
        }
        let messages = self.console.messages.borrow().clone();
        for message in messages {
            self.send_message(cx, &message, Detail::None);
        }
    }

    pub(crate) fn log_for_breakpoint(&self, cx: &mut Cx, text: StringRef) {
        let mut message = Message::new("javascript", MessageType::Log, MessageLevel::Log, text);
        let stack = CallStack::capture(cx, 0, CallStack::MAX_FRAMES);
        message.stack = Some((stack, self.debugger.async_calls.current_trace()));
        self.add_message(cx, message);
    }

    /// From a function of `console`, in whichever realm.
    pub fn console_message(
        &self,
        cx: &mut Cx,
        kind: MessageType,
        level: MessageLevel,
        arguments: &[Value],
    ) -> JsResult<()> {
        let _this = self.downgrade().upgrade();
        let text = match arguments.first() {
            Some(first) if first.is::<ProxyObject>() => {
                Some(StringRef::from_literal("[object Proxy]"))
            }
            Some(first) => self.quietly(cx, |cx| {
                let text = first.to_string_ref(cx);
                settle(cx, text)
            }),
            None => None,
        };
        let shown = text.clone().unwrap_or_default();
        let mut message = Message::new("console-api", kind, level, shown);
        message.arguments = Some(Arguments {
            realm: Strong::new(cx, cx.global()),
            values: arguments.iter().map(|&it| Strong::new(cx, it)).collect(),
        });
        if kind != MessageType::EndGroup {
            let stack = CallStack::capture_for_console(cx);
            message.stack = Some((stack, self.debugger.async_calls.current_trace()));
        }
        self.add_message(cx, message);
        if kind == MessageType::Assert {
            self.did_fail_assertion(cx, text);
        }
        cx.check_traps()
    }

    fn warn(&self, cx: &mut Cx, kind: MessageType, text: StringRef) {
        let message = Message::new("console-api", kind, MessageLevel::Warning, text);
        self.add_message(cx, message);
    }

    /// Several may go without a title.
    pub fn console_profile(&self, cx: &mut Cx, title: &StringImpl) {
        let console = &self.console;
        let Some(cx) = (self.in_inspected_realm(cx)).filter(|_| console.is_enabled.get()) else {
            return;
        };
        if !title.is_empty() && console.profiles.borrow().iter().any(|it| **it == *title) {
            let title = abbreviated(title);
            let text = format_args!("Profile \"{title}\" already exists").into_string();
            return self.warn(cx, MessageType::Profile, text);
        }
        if console.profiles.borrow().is_empty() {
            (console.breakpoints_were_active).set(self.debugger.breakpoints_are_active());
        }
        console.profiles.borrow_mut().push(StringRef::retain(title));
        self.set_breakpoints_active(cx, false);
        self.start_tracking_scripts(cx, true);
    }

    /// Without a title, the last one.
    pub fn console_profile_end(&self, cx: &mut Cx, title: &StringImpl) {
        let console = &self.console;
        let Some(cx) = (self.in_inspected_realm(cx)).filter(|_| console.is_enabled.get()) else {
            return;
        };
        let matches = |it: &StringRef| title.is_empty() || **it == *title;
        let Some(index) = console.profiles.borrow().iter().rposition(matches) else {
            let text = match title.is_empty() {
                true => StringRef::from_literal("No profiles exist"),
                false => {
                    let title = abbreviated(title);
                    format_args!("Profile \"{title}\" does not exist").into_string()
                }
            };
            return self.warn(cx, MessageType::ProfileEnd, text);
        };
        console.profiles.borrow_mut().remove(index);
        if console.profiles.borrow().is_empty() {
            self.stop_tracking_scripts(cx);
            self.set_breakpoints_active(cx, console.breakpoints_were_active.get());
        }
    }

    pub(crate) fn dispatch_console(
        &self,
        cx: &mut Cx,
        method: &str,
        request: &Request<'_>,
    ) -> Outcome<Option<Object>> {
        let params = &request.params;
        match method {
            "enable" => self.enable_console(cx),
            "disable" => self.console.disable(),
            "clearMessages" => self.clear_messages(cx, "frontend"),
            "setConsoleClearAPIEnabled" => {
                let is_enabled: bool = params.required("enable");
                params.check()?;
                self.console.ignores_clear.set(!is_enabled);
            }
            "getLoggingChannels" => return Ok(Some(object! { "channels": Vec::<Json>::new() })),
            "setLoggingChannelLevel" => {
                let source: StringRef = params.required("source");
                let level: StringRef = params.required("level");
                params.check()?;
                let is_among =
                    |it: &StringRef, all: &[&str]| all.iter().any(|name| it.text().eq_ascii(name));
                if !is_among(&source, &CHANNEL_SOURCES) {
                    return Err(format_args!("Unknown source: {source}").into());
                }
                if !is_among(&level, &["off", "basic", "verbose"]) {
                    return Err(format_args!("Unknown level: {level}").into());
                }
                return Err("Not supported".into());
            }
            _ => return Err(params.no_such_method()),
        }
        Ok(Some(object! {}))
    }
}

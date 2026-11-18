//! What the app has to do with the realms of a document.

use std::rc::Rc;

use bun_jsc::bindgen::Result as CallbackResult;
use bun_jsc::from_js_host_call_generic;
use bun_web::channel::{Endpoint, LooseBitmap, Message, Transferred};
use bun_web::compiled::{self, Form};
use bun_web::exec::block_pages;
use bun_web::host::{ChosenFile, Host, Relation, Relative, Reply, Thrown};
use bun_web::renderer::{
    self, Command, Done, Executed, NewDocument, PreloadScript, Preloads, Renderer, Source, Task,
};
use bun_web::{trust, wire};

use super::page::Page;
use super::place::{self, Place};
use super::{Contents, Numbers as _, link};
use crate::ipc::Sender;
use crate::prelude::*;
use crate::realm::{self, Realm};
use crate::renderer::preload::Preload;
use crate::renderer::{Document, Links, Nearby, describe, disposed, failed_to_execute, ports_in};
use crate::{app, files, ports, process, task};

const PATIENCE: f64 = 5000.;

struct Rehearsed;

impl renderer::Link for Rehearsed {
    fn tell(&self, page: u32, command: Command) {
        (wire::rehearse(command).into_iter())
            .for_each(|it| task::report(crate::renderer::obey(page, it)));
    }

    fn request(&self, page: u32, task: Task, reply: Reply<Option<Done>>) {
        let Some(task) = wire::rehearse(task) else {
            return reply(global(), None);
        };
        let reply = |global: &Realm, it: Option<_>| reply(global, it.and_then(wire::rehearse));
        crate::renderer::perform(page, task, Box::new(reply));
    }
}

fn page_in(value: JSValue) -> &'static Page {
    cast(value).expect("it was captured")
}

static NEARBY: Nearby = Nearby {
    send: |_, _, task| {
        let ports = Some(task[3]).filter(|it| it.is_object());
        page_in(task[0]).deliver(task[1], task[2], ports)
    },
    invoke: |_, _, task| page_in(task[0]).invoke(task[1], task[2], task[3], task[4]),
    send_and_wait: |page, channel, values| {
        let (sender, event) = (page_in(page).sender(), page_in(page).sender().event(true));
        sender.dispatch(Some("ipc-message-sync"), event, channel, values)?;
        if event.answer().is_none() && sender.is_listened_to(channel)? {
            let done = Rc::new(Deferred::new());
            let (answered, given_up) = (Rc::clone(&done), Rc::clone(&done));
            event.on_answer(procedure(move |_| answered.resolve(JSValue::UNDEFINED))?);
            // All pages wait, so an answer that depends on one of them never comes.
            let _timer = later::after(PATIENCE, move |_| given_up.resolve(JSValue::UNDEFINED));
            block_pages(global(), task::settled(done.promise()));
        }
        event.answer().map_or_else(|| Err(unanswered(channel)?), Ok)
    },
    wrap_ports: ports::wrap_all,
};

fn unanswered(channel: JSValue) -> JsResult<bun_jsc::JsError> {
    let channel = text_of(channel)?;
    Ok(error(format_args!(
        "event.returnValue of '{channel}' was not set"
    )))
}

/// Returns what the page is told.
fn complain(channel: JSValue, thrown: JSValue) -> JsResult<String> {
    let channel = text_of(channel)?;
    let message = js(format!("Error occurred in handler for '{channel}':"))?;
    invoke(
        get(global().to_js_value(), "console")?,
        "error",
        &[message, thrown],
    )?;
    let reason = catch(text_of(thrown))?.unwrap_or_default();
    Ok(format!(
        "Error invoking remote method '{channel}': {reason}"
    ))
}

/// To a preload with a promise, or to a page with a ticket.
fn reply(
    to: JSValue,
    pending: JSValue,
    channel: JSValue,
    result: Result<JSValue, JSValue>,
) -> JsResult<()> {
    if let Some(preload) = cast::<Preload>(to) {
        let result = match result {
            Ok(_) if preload.is_disposed() => return Ok(()),
            Ok(value) => catch(preload.copy(value))?,
            failure => failure,
        };
        match result {
            Ok(value) => preload.reply(pending, Ok(value)),
            Err(thrown) => preload.reply(pending, Err(js(complain(channel, thrown)?)?)),
        }
        return Ok(());
    }
    let result = match result {
        Ok(_) if page_in(to).is_disposed() => return Ok(()),
        Ok(value) => catch(realm::pack(global(), value))?.map(Message::from),
        Err(thrown) => Err(thrown),
    };
    let result = match result {
        Ok(message) => Ok(message),
        Err(thrown) => Err(complain(channel, thrown)?),
    };
    page_in(to).tell_renderer(|it| it.reply(pending.as_u32(), result))
}

/// An array, whatever the page has sent.
fn values_in(message: &Message) -> JsResult<JSValue> {
    let values = catch(realm::unpack(global(), &message.value))?;
    (values.ok().filter(|it| it.is_array())).map_or_else(|| array(&[]), Ok)
}

pub(super) fn compiled_preload(file: &str) -> Option<Vec<u8>> {
    compiled::path_of(files::to_url(file).as_bytes(), Form::Preload)
}

fn source_of(file: &str, place: &Place) -> JsResult<Source> {
    if !files::is_absolute(file) {
        return Err(error(format_args!(
            "Preload script must have absolute path: {file}"
        )));
    }
    let path = compiled_preload(file).filter(|_| place.runs_program());
    Ok(match path {
        Some(path) => Source::Compiled(path),
        None => Source::Text(string(&files::read_with_node(file)?)),
    })
}

impl Contents {
    pub(super) fn preloads(&self) -> Vec<String> {
        let mut files = Vec::new();
        if !self.is_frame() || self.preferences.integrates_node_in_frames {
            files = self.session.preloads_of_frames();
            files.extend(self.preferences.preload.clone());
        }
        files
    }
}

impl Page {
    fn sender(&self) -> Sender {
        let owner = self.owner();
        Sender::with_ids(owner.to_js(), self.handle(), self.id, owner.id)
    }

    fn deliver(&self, channel: JSValue, values: JSValue, ports: Option<JSValue>) -> JsResult<()> {
        let sender = self.sender();
        if invoke(sender.contents, "isDestroyed", &[])?.to_boolean() {
            return Ok(());
        }
        sender.send(channel, values, ports)
    }

    fn invoke(
        &self,
        channel: JSValue,
        values: JSValue,
        to: JSValue,
        pending: JSValue,
    ) -> JsResult<()> {
        fn settled<'a>(
            _: Cx<'a, '_>,
            [to, more]: [JsLocal<'a>; 2],
            is_rejected: u64,
            arguments: &'a [JsLocal<'a>],
        ) -> CallbackResult<'a, JSValue> {
            let [pending, channel] = [0, 1].map(|it| more.to_js().get_index(global(), it));
            let value = argument(JsLocal::to_js_slice(arguments), 0);
            let result = if is_rejected == 0 {
                Ok(value)
            } else {
                Err(value)
            };
            reply(to.to_js(), pending?, channel?, result)?;
            Ok(JSValue::UNDEFINED)
        }
        match catch(self.sender().invoke(channel, values))? {
            Ok(result) if result.is_object() => {
                let more = array(&[pending, channel])?;
                let reaction = |is_rejected| {
                    heap()
                        .create_callback(settled, [to, more], is_rejected)
                        .to_js()
                };
                react(global(), result, reaction(0), reaction(1))
            }
            result => reply(to, pending, channel, result),
        }
    }

    pub(super) fn got_message(&self, channel: &str, it: Message, has_ports: bool) -> JsResult<()> {
        let values = values_in(&it)?;
        let ports = has_ports.then(|| ports::wrap_all(ports_in(it.transferred)));
        self.deliver(js(channel)?, values, ports.transpose()?)
    }

    pub(super) fn got_invocation(&self, channel: &str, it: &Message, ticket: u32) -> JsResult<()> {
        self.invoke(js(channel)?, values_in(it)?, self.to_js(), js(ticket)?)
    }

    pub(super) fn got_message_to_answer(
        &self,
        channel: &str,
        it: &Message,
        reply: impl FnOnce(Result<Message, String>) + 'static,
    ) -> JsResult<()> {
        let (sender, event, channel) = (self.sender(), self.sender().event(true), js(channel)?);
        let give = move |answer: JsResult<JSValue>| {
            let packed = answer.and_then(|it| realm::pack(global(), it));
            match catch(packed)? {
                Ok(value) => reply(Ok(value.into())),
                Err(thrown) => reply(Err(message_of(thrown)?)),
            }
            Ok(())
        };
        let kind = Some("ipc-message-sync");
        if let Err(thrown) = sender.dispatch(kind, event, channel, values_in(it)?) {
            return give(Err(thrown));
        }
        if let Some(answer) = event.answer() {
            return give(Ok(answer));
        }
        if !sender.is_listened_to(channel)? {
            return give(Err(unanswered(channel)?));
        }
        let (give, channel) = (Rc::new(Cell::new(Some(give))), keep(channel));
        let give_up = Rc::clone(&give);
        let timer = Cell::new(Some(later::after(PATIENCE, move |_| {
            (give_up.take()).map_or(Ok(()), |it| it(Err(unanswered(channel.get())?)))
        })));
        event.on_answer(procedure(move |given| {
            timer.take();
            give.take().map_or(Ok(()), |it| it(Ok(argument(given, 0))))
        })?);
        Ok(())
    }

    pub(super) fn send(
        &self,
        channel: JSValue,
        values: JSValue,
        ports: Vec<Endpoint>,
    ) -> JsResult<()> {
        if let Some(document) = self.document() {
            return document.send(channel, values, ports);
        }
        if !self.has_preload.get() || !self.is_started() {
            return Ok(());
        }
        let message = Message {
            transferred: ports.into_iter().map(Transferred::Port).collect(),
            ..realm::pack(global(), values)?.into()
        };
        let channel = text_of(channel)?;
        self.tell_renderer(|it| it.send(channel, message))
    }

    pub(super) fn preload_failed(&self, file: String, it: Thrown) -> JsResult<()> {
        crate::dialog::print_error(&format!(
            "Unable to load preload script: {file} {}",
            it.description
        ));
        let failure = global().create_error_instance(format_args!("{}", it.message));
        if let Some(stack) = it.stack {
            assign(failure, "stack", js(stack)?)?;
        }
        announce(self.owner().to_js(), "preload-error", &[js(file)?, failure])
    }

    /// `None` if the page is gone.
    pub(super) fn relative(&self, of: u32, it: Relation) -> JsResult<Option<Option<Relative>>> {
        let is_familiar = |it: &&Page| !it.is_disposed() && it.is_kin_of(self);
        let mut pages = core::iter::once(self.itself()).chain(super::alive().map(Contents::page));
        let Some(page) = pages.find(|it| it.id == of).filter(is_familiar) else {
            return Ok(None);
        };
        let contents = page.contents();
        let in_frame = |it: Option<&JSValue>| it.and_then(|it| cast(*it)).map(Contents::page);
        let find = |is_it: &dyn Fn(&Page) -> bool| {
            let all = page.owner().page().with_descendants()?;
            JsResult::Ok(all.iter().map(Root::get).find(|it| is_it(it)))
        };
        let found = match it {
            Relation::Top => Some(page.owner().page()),
            Relation::Parent => page.parent(),
            Relation::Opener => {
                (contents.opened_by().map(Contents::page)).or_else(|| page.opener())
            }
            Relation::FirstChild => {
                with_elements(page.frames_if_any()?, |all| Ok(in_frame(all.first())))?
            }
            Relation::NextSibling => match page.parent() {
                Some(parent) => with_elements(parent.frames_if_any()?, |all| {
                    let mut from_own = all.iter().skip_while(|it| **it != contents.to_js());
                    Ok(in_frame(from_own.nth(1)))
                })?,
                None => None,
            },
            Relation::Name(name) => contents.choose(&name)?.map(Contents::page),
            Relation::Selected(id) => contents.related_page(id),
            Relation::Token(token) => find(&|it| it.token() == token.as_bytes())?,
            Relation::Page(id) => find(&|it| it.id == id)?,
        };
        Ok(Some(found.filter(is_familiar).map(|it| Relative {
            page: it.id,
            token: string(it.token()),
        })))
    }

    pub(super) fn insert_css(&self, css: String, is_of_user: bool) -> JsResult<JSValue> {
        let this = Root::new(self);
        Ok(task::promise(async move {
            let key = (this.get()).ask_later(|it, reply| it.insert_sheet(css, is_of_user, reply));
            js(key.await?.to_string())
        }))
    }

    pub(super) fn remove_inserted_css(&self, key: JSValue) -> JsResult<()> {
        let key = key.to_number(global())? as u32;
        self.tell(|it| it.remove_sheet(key))
    }

    pub(super) fn write_heap_snapshot(&self, file: String) -> JsResult<JSValue> {
        let (send, taken) = task::oneshot();
        self.tell_renderer(|it| it.take_heap_snapshot(move |_, it| send.send(it)))?;
        Ok(task::promise(async move {
            let write = |it: String| files::write(&file, it.as_bytes(), 0o600).is_ok();
            match taken.await.flatten().is_some_and(write) {
                true => Ok(JSValue::UNDEFINED),
                false => Err(error(format_args!("Failed to take heap snapshot"))),
            }
        }))
    }

    /// Where the page is.
    pub(super) fn decode_image(
        &self,
        bytes: Vec<u8>,
    ) -> JsResult<impl Future<Output = Option<LooseBitmap>> + use<>> {
        let (send, from_afar) = task::oneshot();
        let mut left = Some(bytes);
        self.tell_renderer(|it| {
            it.decode_image(left.take().unwrap_or_default(), |_, it| send.send(it));
        })?;
        Ok(async {
            match left {
                Some(bytes) => LooseBitmap::decode(bytes).await,
                None => from_afar.await.flatten(),
            }
        })
    }

    /// A promise.
    pub(super) fn execute(&self, world: u32, code: JSValue, is_by_user: bool) -> JSValue {
        if is_by_user {
            (self.owner().context.last_input).set(bun_web::time::monotonic_now());
            (self.process().iter()).for_each(|it| it.witness.note_activation());
        }
        if self.document().is_some() || !self.is_started() {
            return Document::execute(self.id, world, code, is_by_user);
        }
        let (send, executed) = task::oneshot();
        let begin = || {
            let code = code.to_bun_string(global())?;
            let code = match code.is_utf16() {
                true => code.utf16().to_vec(),
                false => string(&code.to_utf8()).encode_utf16().collect(),
            };
            self.tell_renderer(|it| it.execute(world, code, is_by_user, |_, it| send.send(it)))
        };
        let begun = catch(begin()).map(|it| it.map_err(keep));
        task::busy_promise(async move {
            begun?.map_err(|it| task::throw(&it))?;
            match executed.await.flatten().ok_or_else(disposed)? {
                Executed::Fulfilled(it) => Ok(it.open(global())?.0),
                Executed::Rejected(it) => Err(global().throw_value(it.open(global())?.0)),
                Executed::Threw => Err(failed_to_execute()),
            }
        })
    }

    pub(crate) fn is_in_other_process(&self) -> bool {
        self.process().is_some()
    }

    pub(crate) fn inspect(&self, session: u32, how: String) -> JsResult<()> {
        self.tell_renderer(|it| it.inspect(session, how))
    }

    pub(crate) fn stop_inspecting(&self, session: u32) -> JsResult<()> {
        self.tell_renderer(|it| it.stop_inspecting(session))
    }

    pub(crate) fn ask_inspector(
        &self,
        session: u32,
        method: &str,
        params: String,
        files: Vec<ChosenFile>,
    ) -> JsResult<impl Future<Output = Option<Result<String, String>>> + use<>> {
        let (send, result) = task::oneshot();
        self.tell_renderer(|it| {
            it.ask_inspector(session, method.into(), params, files, |_, it| send.send(it));
        })?;
        Ok(async { result.await.flatten() })
    }

    fn describe(&self) -> bun_web::page::About {
        let loaded = self.loaded().unwrap_or_default();
        loaded.describe(self.url(), self.inherited_base_url())
    }

    pub(super) fn document_changed(&self) -> JsResult<()> {
        self.client.renew_twin();
        self.document().map_or(Ok(()), Document::changed)?;
        self.tell_renderer(Renderer::document_changed)?;
        self.tell(|it| it.renew(self.describe()))
    }

    fn preloads(&self) -> JsResult<Option<Box<Preloads>>> {
        let (contents, preferences) = (self.contents(), &*self.contents().preferences);
        let files = contents.preloads();
        let is_in_app = self.place() == Place::App;
        let integrates_node = is_in_app && preferences.integrates_node;
        if files.is_empty() && !(integrates_node && self.parent().is_none()) {
            return Ok(None);
        }
        let read = |file: String| {
            let source = match catch(source_of(&file, &self.place()))? {
                Ok(source) => source,
                Err(thrown) => Source::Unreadable(describe(thrown)?),
            };
            Ok(PreloadScript { file, source })
        };
        let url = self.url();
        Ok(Some(Box::new(Preloads {
            scripts: files.into_iter().map(read).collect::<JsResult<_>>()?,
            process: self.owner().id,
            is_main_frame: self.parent().is_none(),
            is_sandboxed: preferences.is_sandboxed
                || !(is_in_app || place::moves_node_for_testing()),
            integrates_node,
            document_path: match url.starts_with("file:") {
                true => files::from_url(&url),
                false => files::join(&[app::path()?, "index.html"]),
            },
            additional_arguments: texts_of(get(contents.preferences(), "additionalArguments")?)?,
            environment: None,
        })))
    }

    /// Makes the realm and the empty document, and runs the preload scripts.
    pub(super) fn start(&self) -> JsResult<()> {
        let (contents, opener) = (self.contents(), self.opener());
        let mut preloads = None;
        if opener.is_none() {
            self.has_relatives.set(trust::relates_frames());
            preloads = self.preloads()?;
        }
        self.has_preload.set(preloads.is_some());
        let document = NewDocument {
            context: contents.id,
            surface: match contents.guest() {
                Some(_) => 0,
                None => contents.surface,
            },
            has_relatives: self.has_relatives.get(),
            isolates_context: contents.preferences.isolates_context || !self.place().is_trusted(),
            about: self.describe(),
            opener: opener.map(|it| it.id),
        };
        if let Some(process) = contents.process_for(self, preloads.is_some())? {
            if let Some(it) = preloads.as_mut() {
                it.environment = Some(match self.place().is_trusted() {
                    true => process::variables()?,
                    false => Vec::new(),
                });
            }
            return self.start_in(process, document, preloads);
        }
        let hosts = [link::of_window(self), link::of_preload(self)];
        // SAFETY: the window and the document hold them.
        let [of_window, of_preload] = hosts.map(|it| unsafe { Host::of(it) });
        let links = Links {
            client: Rc::clone(&self.client),
            of_window,
            of_preload,
            needed: hosts,
            nearby: (!wire::is_rehearsed()).then_some(&NEARBY),
            owner: self.to_js(),
        };
        let document = Document::open(self.id, document, preloads.as_deref(), links)?;
        match wire::is_rehearsed() {
            true => self.started(None, Some(Renderer::new(Rc::new(Rehearsed), self.id))),
            false => self.started(Some(document), None),
        }
        preloads.map_or(Ok(()), |it| document.preload(*it))
    }

    fn start_in(
        &self,
        process: Rc<super::process::Process>,
        document: NewDocument,
        preloads: Option<Box<Preloads>>,
    ) -> JsResult<()> {
        use bun_ui::protocol::PageCommand;
        let surface = document.surface;
        let metrics = (ui()?.surface_metrics)(surface).get().ok();
        if surface != 0 {
            bun_ui::queue::forget_frame(surface);
            process.command(PageCommand::Grant(surface));
        }
        if let Some(it) = &self.contents().embedded {
            process.command(PageCommand::Lend(it.image));
        }
        process.admit(self, preloads.is_some());
        let how = renderer::Start {
            client: self.client.seed(),
            document,
            extent: metrics.map(|it| bun_web::input::Extent {
                size: [it.bounds.width, it.bounds.height].map(f64::from),
                scale: it.scale.into(),
            }),
            preloads,
            facts: link::facts(self),
            conditions: process.conditions_for(self.id),
            is_online: crate::session::online::is_known_to_be_online(),
        };
        self.started_in(process);
        self.tell_renderer(|it| it.start(how.into()))
    }

    pub(super) fn foretell(&self) -> JsResult<()> {
        match self.is_far() {
            true => self.tell_renderer(|it| it.foretell(link::facts(self).into())),
            false => Ok(()),
        }
    }

    pub(super) fn tell_renderer(&self, command: impl FnOnce(&Renderer)) -> JsResult<()> {
        (self.renderer.get()).map_or(Ok(()), |it| {
            from_js_host_call_generic(global(), || command(it))
        })
    }
}

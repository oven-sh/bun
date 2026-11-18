//! In a process that has nothing but pages.

use std::rc::Rc;

use bun_collections::HashMap;
use bun_jsc::from_js_host_call_generic;
use bun_ui::protocol::Lane;
use bun_ui::queue::{self, Heard};
use bun_ui::surfaces;
use bun_web::client::{Client, ScriptLocation, Scripts};
use bun_web::convert::resolve_blob_url;
use bun_web::dom;
use bun_web::host::{
    Answer, Browser, Connection, Environment, Host, Inspected, Level, Link, Notice, Question,
    Relation, Relative, Reply, ToFrame, Wish,
};
use bun_web::input::Input;
use bun_web::js_link::can_call_host;
use bun_web::page::{Change, Order, Query};
use bun_web::referrer::ReferrerPolicy;
use bun_web::remote::{self, Flags, HOST, Head, Kind};
use bun_web::renderer::{Command, Conditions, Facts, Start, Statics};
use bun_web::storage::areas;
use bun_web::url::Url;
use bun_web::wire::Message;

use super::{Document, Links, obey, perform};
use crate::contents::inspection::with_news;
use crate::devtools::agent;
use crate::generated_bindgen::electron::DesktopProcess;
use crate::prelude::*;
use crate::{modules, process};

#[derive(Default)]
struct State {
    expected: RefCell<HashMap<u32, Reply<Option<Answer>>>>,
    /// How many questions are on the stack.
    waits: Cell<u32>,
    is_held: Cell<bool>,
    is_online: Cell<Option<bool>>,
    facts: RefCell<HashMap<u32, Facts>>,
    /// And the page that it is for.
    environment: RefCell<Option<(u32, Box<Environment>)>>,
    newest_conditions: Cell<u32>,
}

state!(fn state() -> State);

fn head_of(message: &[u8]) -> Head {
    Head::of(message).expect("the host makes sense")
}

fn open<T: Message>(message: &[u8]) -> T {
    remote::open(HOST, message).expect("the host makes sense")
}

fn is_reply(head: Head) -> bool {
    matches!(head.kind, Kind::Answer | Kind::Nothing)
}

struct ToHost {
    page: u32,
    voice: Flags,
    client: Rc<Client>,
    has_been_opened: Cell<bool>,
}

fn add_blob(wish: &mut Wish) {
    wish.blob = (Url::parse(wish.url.as_bytes()).filter(|it| it.scheme() == b"blob"))
        .and_then(|it| resolve_blob_url(&it));
}

impl ToHost {
    fn head(&self, kind: Kind, ticket: u32) -> Head {
        Head::new(kind, self.page, ticket).with(self.voice)
    }

    fn answer_here(&self, question: &mut Question) -> Option<Answer> {
        let client = &self.client;
        match question {
            Question::AllowsForm { url } => {
                return Some(Answer::AllowsForm(Url::parse(url.as_bytes()).map(|url| {
                    let verdict = client.policies().csp.check_form_action(&url, None);
                    client.enforce(verdict, JSValue::UNDEFINED)
                })));
            }
            Question::AncestorOrigins {} => {
                let all = client.ancestors();
                let all = all.iter().map(|it| string(it.as_bytes()));
                return Some(Answer::AncestorOrigins(all.collect()));
            }
            Question::Browser {} => {
                return Some(Answer::Browser(Browser {
                    user_agent: string(&client.user_agent()),
                    version: modules::CHROME.to_owned(),
                }));
            }
            Question::Origin {} => {
                return Some(Answer::Origin(Some(string(client.origin().as_bytes()))));
            }
            Question::OriginKey {} => {
                return Some(Answer::OriginKey(Some(string(&client.origin().key()))));
            }
            Question::SetReferrerPolicy { policy } => {
                client.set_referrer_policy(ReferrerPolicy::from_header(policy.as_bytes()));
            }
            Question::Stop {} => client.abort_fetches(),
            Question::Navigate { wish }
            | Question::NavigateWindow { wish, .. }
            | Question::Open { wish, .. }
            | Question::ChooseWindow {
                wish: Some(wish), ..
            } => add_blob(wish),
            Question::Frame {
                message: ToFrame::Navigate { url, blob, .. },
                ..
            } => *blob = Url::parse(url.as_bytes()).and_then(|it| resolve_blob_url(&it)),
            _ => {}
        }
        None
    }
}

/// The document that the app has sent to take the place of an empty one, which it cannot start any more.
struct Arrival {
    context: u32,
    page: Cell<u32>,
    is_over: Cell<bool>,
}

impl Arrival {
    fn at(context: u32) -> Arrival {
        Arrival {
            context,
            page: 0.into(),
            is_over: false.into(),
        }
    }

    fn includes(&self, head: Head, message: &[u8]) -> bool {
        match head.kind {
            _ if self.is_over.get() => false,
            Kind::Change if head.about == self.context => {
                if let Change::Shows { page, .. } = open(message) {
                    self.page.set(page);
                }
                true
            }
            Kind::Command if head.about == self.page.get() => !self.is_over.replace(true),
            _ => false,
        }
    }
}

impl ToHost {
    fn recall(&self, question: &Question) -> Option<Answer> {
        Some(match question {
            Question::IsInitial {} if self.has_been_opened.get() => Answer::IsInitial(false),
            Question::Connection {} => Answer::Connection(match state().is_online.get()? {
                true => Connection::Online,
                false => Connection::Offline,
            }),
            Question::Environment {} if self.voice.is_empty() => {
                let known = state().environment.borrow();
                Answer::Environment(known.as_ref().filter(|it| it.0 == self.page)?.1.clone())
            }
            _ => return self.look_up(question, state().facts.borrow_mut().get_mut(&self.page)?),
        })
    }

    fn look_up(&self, question: &Question, facts: &mut Facts) -> Option<Answer> {
        Some(match question {
            Question::Relative { of, relation }
                if *of == self.page
                    && facts.is_at_top
                    && self.voice.contains(Flags::OF_PRELOAD) =>
            {
                let found = match relation {
                    Relation::Top => Some(Relative {
                        page: *of,
                        token: string(&self.client.token),
                    }),
                    Relation::Parent => None,
                    _ => return None,
                };
                Answer::Relative(Some(found))
            }
            _ if !self.voice.is_empty() => return None,
            Question::HasSpellChecker {} => Answer::HasSpellChecker(facts.has_spell_checker),
            Question::LoadsImages {} => Answer::LoadsImages(Some(facts.loads_images)),
            Question::RunsScripts {} => Answer::RunsScripts(Some(facts.runs_scripts)),
            Question::Tab {} => Answer::Tab(facts.tab),
            _ => {
                let it = facts.origins.as_mut()?;
                match question {
                    Question::Activation {} => Answer::Activation(it.activation.clone()),
                    Question::Arrival {} => Answer::Arrival(it.arrival.clone()),
                    Question::HistoryEntries {} => Answer::HistoryEntries(Some(it.history.take()?)),
                    Question::InboundTransition {} => {
                        Answer::InboundTransition(it.inbound_transition)
                    }
                    Question::IsInitial {} => Answer::IsInitial(false),
                    Question::Refresh {} => Answer::Refresh(it.refresh.clone()),
                    Question::RestoresScroll {} => Answer::RestoresScroll(it.restores_scroll),
                    _ => return None,
                }
            }
        })
    }

    fn remember(&self, answer: &Answer) {
        match answer {
            Answer::IsInitial(is) if self.voice.is_empty() => self.has_been_opened.set(!is),
            Answer::Connection(it) => state().is_online.set(Some(*it == Connection::Online)),
            _ => {}
        }
    }
}

impl Link for ToHost {
    fn tell(&self, notice: Notice) {
        let lane = match notice {
            Notice::IpcSend { .. } | Notice::IpcInvoke { .. } => Lane::Elsewhere,
            _ => Lane::Scripts,
        };
        remote::send(HOST, lane, self.head(Kind::Notice, 0), notice);
    }

    fn ask(&self, mut question: Question) -> Option<Answer> {
        if self.voice.is_empty()
            && let Some(answer) = self.answer_here(&mut question)
        {
            return Some(answer);
        }
        if let Some(answer) = self.recall(&question) {
            return Some(answer);
        }
        let mut head = self.head(Kind::Question, 0);
        if question.is_answered_without_scripts() {
            head = head.with(Flags::HARMLESS);
        }
        if !question.is_waited_for() {
            remote::send(HOST, Lane::Scripts, head, question);
            return None;
        }
        let can_run = can_call_host(global()) && !global().has_exception();
        if !can_run {
            head = head.with(Flags::DEAF);
        }
        let arrival = match question {
            Question::StartWindow { context } => Some(Arrival::at(context)),
            _ => None,
        };
        let (ticket, answer) = (remote::next_ticket(), Rc::new(Cell::new(None)));
        head.ticket = ticket;
        if !remote::send(HOST, Lane::Elsewhere, head, question) {
            return None;
        }
        let (slot, is_done) = (Rc::clone(&answer), || Rc::strong_count(&answer) == 1);
        let reply: Reply<_> = Box::new(move |_, it| slot.set(it));
        state().expected.borrow_mut().insert(ticket, reply);
        let accepts = |message: &[u8]| {
            let head = head_of(message);
            (is_reply(head) && head.ticket == ticket)
                || (can_run
                    && (head.within == ticket
                        || head.flags.contains(Flags::HARMLESS)
                        || (arrival.as_ref()).is_some_and(|it| it.includes(head, message))))
        };
        state().waits.update(|it| it + 1);
        queue::wait_for_process(global(), HOST, None, &is_done, &accepts);
        state().waits.update(|it| it - 1);
        state().expected.borrow_mut().remove(&ticket);
        (answer.take()).inspect(|it| self.remember(it))
    }

    fn request(&self, question: Question, reply: Reply<Option<Answer>>) {
        let ticket = remote::next_ticket();
        let head = self.head(Kind::Question, ticket);
        match remote::send(HOST, Lane::Elsewhere, head, question) {
            true => drop(state().expected.borrow_mut().insert(ticket, reply)),
            false => reply(global(), None),
        }
    }

    fn inspect(&self, it: Inspected<'_>) {
        if with_news(it, &|news| agent::far::tell(self.page, news)).is_err() {
            global().clear_exception_except_termination();
        }
    }

    fn for_blank_frame(&self) -> Box<dyn Link> {
        Box::new(ToHost {
            page: self.page,
            voice: Flags::OF_BLANK_FRAME,
            client: Rc::clone(&self.client),
            has_been_opened: false.into(),
        })
    }
}

struct InPage(u32);

impl Scripts for InPage {
    fn log_error(&self, message: &[u8]) {
        let url = Document::of(self.0).map(|it| string(it.client.url().href()));
        let notice = Notice::Console {
            level: Level::Error,
            message: string(message),
            line: 0,
            url: url.unwrap_or_default(),
        };
        let head = Head::new(Kind::Notice, self.0, 0);
        remote::send(HOST, Lane::Scripts, head, notice);
    }

    fn location(&self) -> ScriptLocation {
        ScriptLocation::now(global())
    }

    fn is_inspected(&self) -> bool {
        false
    }
}

fn give(page: u32, order: Order) -> JsResult<()> {
    if let Order::OnlineChanged { is_online } = order {
        state().is_online.set(Some(is_online));
    }
    if let Order::KeepEntries { .. } | Order::PopState { .. } | Order::SetUrl { .. } = order {
        forget_history(page);
    }
    let uses_up = order.makes_read_environment();
    let result = from_js_host_call_generic(global(), || dom::obey(page, order));
    if uses_up {
        state().environment.take();
    }
    result
}

fn forget_history(page: u32) {
    let mut all = state().facts.borrow_mut();
    if let Some(it) = all.get_mut(&page).and_then(|it| it.origins.as_mut()) {
        it.history = None;
    }
}

fn prepare(page: u32, it: Conditions) {
    let is_newest = it.number > state().newest_conditions.get();
    state().newest_conditions.update(|now| now.max(it.number));
    (state().environment).replace(is_newest.then_some((page, it.environment)));
}

fn start(page: u32, how: Start) -> JsResult<()> {
    state().is_online.set(how.is_online);
    state().facts.borrow_mut().insert(page, how.facts);
    how.conditions.into_iter().for_each(|it| prepare(page, it));
    let client = Client::from_seed(*how.client);
    client.set_scripts(Rc::new(InPage(page)));
    let link = |voice| {
        let client = Rc::clone(&client);
        Host::new(ToHost {
            page,
            voice,
            client,
            has_been_opened: false.into(),
        })
    };
    let links = Links {
        of_window: link(Flags::empty()),
        of_preload: link(Flags::OF_PRELOAD),
        needed: [JSValue::UNDEFINED; 2],
        nearby: None,
        owner: JSValue::UNDEFINED,
        client,
    };
    let surface = how.document.surface;
    if surface != 0 {
        queue::forget_frame(surface);
        surfaces::ignore(surface);
        surfaces::listen_with(surface, move |it| {
            give(page, Order::Input { input: it.into() })
        });
    }
    let document = Document::open(page, how.document, how.preloads.as_deref(), links)?;
    if let Some(extent) = how.extent {
        let is_quiet = true;
        let input = Input::Resize { extent, is_quiet };
        give(page, Order::Input { input })?;
    }
    state().environment.take();
    how.preloads.map_or(Ok(()), |it| document.preload(*it))
}

fn begin(statics: &Statics) -> JsResult<()> {
    statics.adopt();
    statics.tracing.iter().for_each(crate::tracing::join);
    let path = js(&*statics.resources_path)?;
    process::object().put(global(), b"resourcesPath", path);
    let now = (statics.is_accessibility_active, statics.has_screen_reader);
    if now
        == (
            surfaces::is_accessibility_active(),
            surfaces::has_screen_reader(),
        )
    {
        return Ok(());
    }
    surfaces::accessibility_changed(now.0, now.1)
}

fn handle(head: Head, message: &[u8]) -> JsResult<()> {
    let reply = |kind| Head::new(kind, head.about, head.ticket);
    let result = match head.kind {
        Kind::Begin => begin(&open(message)),
        Kind::Order => give(head.about, open(message)),
        Kind::Change => {
            from_js_host_call_generic(global(), || dom::change_context(head.about, open(message)))
        }
        Kind::Command => match open(message) {
            Command::Start { how } => start(head.about, *how),
            Command::Foretell { facts } => {
                state().facts.borrow_mut().insert(head.about, *facts);
                Ok(())
            }
            Command::Prepare { conditions } => {
                prepare(head.about, conditions);
                Ok(())
            }
            command => {
                if let Command::DocumentChanged {} | Command::Dispose {} = command {
                    state().facts.borrow_mut().remove(&head.about);
                }
                obey(head.about, command)
            }
        },
        Kind::Query => {
            let query = open(message);
            if let Query::WillTraverse { .. } = query {
                forget_history(head.about);
            }
            let outcome = dom::answer(head.about, query);
            remote::reply(HOST, Lane::Elsewhere, reply(Kind::Outcome), outcome);
            return from_js_host_call_generic(global(), || {});
        }
        Kind::Task => {
            let head = reply(Kind::Done);
            let reply = move |_: &_, done| remote::reply(HOST, Lane::Elsewhere, head, done);
            perform(head.about, open(message), Box::new(reply));
            return Ok(());
        }
        Kind::Answer | Kind::Nothing => {
            let expected = state().expected.borrow_mut().remove(&head.ticket);
            let answer = (head.kind == Kind::Answer).then(|| open(message));
            return from_js_host_call_generic(global(), || {
                expected.map_or((), |it| it(global(), answer))
            });
        }
        Kind::Area => from_js_host_call_generic(global(), || areas::changed(&open(message))),
        Kind::Release => {
            state().is_held.set(false);
            Ok(())
        }
        Kind::Turn => Ok(()),
        _ => unreachable!("it goes to another thread"),
    };
    if head.ticket != 0 {
        remote::send_head(HOST, Lane::Elsewhere, reply(Kind::Nothing));
    }
    result
}

fn hear(_: u32, heard: Heard) -> JsResult<()> {
    let Heard::Message(message) = heard else {
        return Ok(());
    };
    let head = head_of(&message);
    let holds = head.flags.contains(Flags::HELD)
        && state().waits.get() == 0
        && !state().is_held.replace(true);
    let result = handle(head, &message);
    if holds {
        bun_ui::report(global(), result)?;
        let accepts = |message: &[u8]| {
            let head = head_of(message);
            head.flags.contains(Flags::HELD) || head.kind == Kind::Release
        };
        queue::wait_for_process(global(), HOST, None, &|| !state().is_held.get(), &accepts);
        return Ok(());
    }
    result
}

#[unsafe(no_mangle)]
fn __bun_desktop_enter_page_process() {
    let enter = || {
        DesktopProcess::get_system_version();
        process::executable();
        remote::become_page_process(bun_ui::renderer(global())?);
        modules::of_page_process()?;
        queue::listen_to_processes(hear);
        bun_ui::hold();
        Ok(())
    };
    crate::task::report(enter());
}

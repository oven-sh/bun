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
use bun_web::host::{Answer, Host, Level, Link, Notice, Question, Reply, ToFrame, Wish};
use bun_web::input::Input;
use bun_web::js_link::can_call_host;
use bun_web::page::Order;
use bun_web::referrer::ReferrerPolicy;
use bun_web::remote::{self, Flags, HOST, Head, Kind};
use bun_web::renderer::{Command, Start, Statics};
use bun_web::url::Url;
use bun_web::wire::Message;

use super::{Document, Links, obey, perform};
use crate::prelude::*;
use crate::{command_line, modules, process};

#[derive(Default)]
struct State {
    expected: RefCell<HashMap<u32, Reply<Option<Answer>>>>,
    /// How many questions are on the stack.
    waits: Cell<u32>,
    is_held: Cell<bool>,
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
        let can_run = can_call_host(global()) && !global().has_exception();
        if !can_run && !question.is_answered_without_scripts() {
            return None;
        }
        if !question.is_waited_for() {
            remote::send(HOST, Lane::Scripts, self.head(Kind::Question, 0), question);
            return None;
        }
        let (ticket, answer) = (remote::next_ticket(), Rc::new(Cell::new(None)));
        let head = self.head(Kind::Question, ticket);
        if !remote::send(HOST, Lane::Elsewhere, head, question) {
            return None;
        }
        let (slot, is_done) = (Rc::clone(&answer), || Rc::strong_count(&answer) == 1);
        let reply: Reply<_> = Box::new(move |_, it| slot.set(it));
        state().expected.borrow_mut().insert(ticket, reply);
        let accepts = |message: &[u8]| {
            let head = head_of(message);
            (is_reply(head) && head.ticket == ticket)
                || (can_run && (head.within == ticket || head.flags.contains(Flags::HARMLESS)))
        };
        state().waits.update(|it| it + 1);
        queue::wait_for_process(global(), HOST, None, &is_done, &accepts);
        state().waits.update(|it| it - 1);
        state().expected.borrow_mut().remove(&ticket);
        answer.take()
    }

    fn request(&self, question: Question, reply: Reply<Option<Answer>>) {
        let ticket = remote::next_ticket();
        let head = self.head(Kind::Question, ticket);
        match remote::send(HOST, Lane::Elsewhere, head, question) {
            true => drop(state().expected.borrow_mut().insert(ticket, reply)),
            false => reply(global(), None),
        }
    }

    fn for_blank_frame(&self) -> Box<dyn Link> {
        Box::new(ToHost {
            page: self.page,
            voice: Flags::OF_BLANK_FRAME,
            client: Rc::clone(&self.client),
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
    from_js_host_call_generic(global(), || dom::obey(page, order))
}

fn start(page: u32, how: Start) -> JsResult<()> {
    let client = Client::from_seed(*how.client);
    client.set_scripts(Rc::new(InPage(page)));
    let link = |voice| {
        let client = Rc::clone(&client);
        Host::new(ToHost {
            page,
            voice,
            client,
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
    how.preloads.map_or(Ok(()), |it| document.preload(*it))
}

fn begin(statics: &Statics) -> JsResult<()> {
    statics.adopt();
    (statics.switches.iter()).for_each(|it| command_line::set(&it.0, &it.1));
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
            command => obey(head.about, command),
        },
        Kind::Query => {
            let outcome = dom::answer(head.about, open(message));
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
        Kind::Release => {
            state().is_held.set(false);
            Ok(())
        }
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
        remote::become_page_process(bun_ui::renderer(global())?);
        modules::of_page_process()?;
        queue::listen_to_processes(hear);
        bun_ui::hold();
        Ok(())
    };
    crate::task::report(enter());
}

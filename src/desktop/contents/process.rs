//! A process that has pages. Nothing that it says is taken on trust.

use std::collections::VecDeque;
use std::rc::{Rc, Weak};
use std::time::{Duration, Instant};

use bun_collections::HashMap;
use bun_core::{CStringList, CodeGenerationFromStrings};
use bun_jsc::{Strong, from_js_host_call_generic};
use bun_ui::protocol::{LENT_IMAGE, Lane, PAGE_PROCESS_MARKER, PageCommand};
use bun_ui::queue::{self, Heard};
use bun_web::client::{Twin, Update};
use bun_web::host::{Host, Question, Reply};
use bun_web::input::Input;
use bun_web::page::{self, Change, News, Order, Outcome, Query};
use bun_web::remote::{self, Flags, Head, Kind, Peer};
use bun_web::renderer::{self, Command, Done, Statics, Task};
use bun_web::wire::{self, Malformed, Message};

use super::page::Page;
use super::{alive, link};
use crate::prelude::*;
use crate::{command_line, files, process};

const PATIENCE: Duration = Duration::from_secs(1);
/// Their windows may still be around.
const MOST_DISPOSED: usize = 256;

enum Expected {
    Outcome(Reply<Option<Outcome>>),
    Done(Reply<Option<Done>>),
    Nothing,
}

impl Expected {
    fn give_up(self) {
        match self {
            Expected::Outcome(reply) => reply(global(), None),
            Expected::Done(reply) => reply(global(), None),
            Expected::Nothing => {}
        }
    }
}

struct Hosted {
    of_window: Host,
    of_blank_frames: Host,
    of_preload: Option<Host>,
    _needed: [Strong; 2],
}

pub(super) struct Process {
    peer: Peer,
    pub(super) pid: u32,
    pub(super) creation_time: f64,
    /// Of the first document with one.
    pub(super) site: RefCell<Option<String>>,
    /// The ticket of the question that is being answered, or 0.
    serving: Cell<u32>,
    is_holding: Cell<bool>,
    has_held: Cell<bool>,
    /// What has been waited for in vain.
    overdue: RefCell<Vec<u32>>,
    last_sent: Cell<u32>,
    expected: RefCell<HashMap<u32, Expected>>,
    pages: RefCell<HashMap<u32, Rc<Hosted>>>,
    disposed: RefCell<VecDeque<u32>>,
    is_gone: Cell<bool>,
    was_killed_for: Cell<Option<&'static str>>,
}

#[derive(Default)]
struct All {
    by_peer: RefCell<HashMap<Peer, (Weak<Process>, u32)>>,
    spare: RefCell<Option<Rc<Process>>>,
}

state!(fn all() -> All);

pub(super) fn are_wanted() -> bool {
    state!(fn known() -> core::cell::OnceCell<bool>);
    *known().get_or_init(|| {
        let is_set = |name| process::variable(name).is_ok_and(|it| it.is_some());
        cfg!(unix)
            && global().bun_vm().standalone_module_graph.is_none()
            && !is_set("BUN_BE_BUN")
            && is_set("BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING")
            && is_set("BUN_DESKTOP_PAGE_PROCESSES")
    })
}

fn arguments() -> CStringList {
    unsafe extern "Rust" {
        safe fn __bun_desktop_path_of_library() -> &'static [u8];
    }
    let executable = process::executable();
    let library = files::absolute(&string(__bun_desktop_path_of_library()));
    let restriction: Option<&[u8]> = match bun_core::code_generation_from_strings() {
        CodeGenerationFromStrings::Allowed => None,
        CodeGenerationFromStrings::DisallowedLikeNode => {
            Some(b"--disallow-code-generation-from-strings")
        }
        CodeGenerationFromStrings::Strict => {
            Some(b"--disallow-code-generation-from-strings=strict")
        }
    };
    let fixed = [
        executable.as_bytes(),
        PAGE_PROCESS_MARKER.to_bytes(),
        library.as_bytes(),
    ];
    let all = fixed.into_iter().chain(restriction).map(|it| [it]);
    CStringList::from_parts(all.collect::<Vec<_>>().into_iter())
}

/// Without what may be a secret.
fn environment() -> JsResult<CStringList> {
    let is_needed = |name: &str| {
        let prefixes = [
            "LC_",
            "BUN_JSC_",
            "BUN_DEBUG_",
            "BUN_DESKTOP_LOG",
            "BUN_FEATURE_FLAG_",
            "BUN_GARBAGE_COLLECTOR_",
            "BUN_GC_",
            "MIMALLOC_",
        ];
        prefixes.iter().any(|it| name.starts_with(it))
            || matches!(
                name,
                "TZ" | "LANG"
                    | "LANGUAGE"
                    | "LD_LIBRARY_PATH"
                    | "ASAN_OPTIONS"
                    | "LSAN_OPTIONS"
                    | "UBSAN_OPTIONS"
                    | "BUN_ENABLE_CRASH_REPORTING"
            )
    };
    let mut all = process::variables()?;
    all.retain(|it| is_needed(&it.0));
    let entries = (all.iter()).map(|it| [it.0.as_bytes(), b"=", it.1.as_bytes()]);
    Ok(CStringList::from_parts(entries))
}

fn statics() -> JsResult<Statics> {
    let resources = get(process::object(), "resourcesPath")?;
    Ok(Statics::new(
        command_line::all(),
        super::text_if_any(resources)?.unwrap_or_default(),
    ))
}

fn running() -> Vec<Rc<Process>> {
    let all = all().by_peer.borrow();
    all.values().filter_map(|it| it.0.upgrade()).collect()
}

pub(crate) fn statics_changed() -> JsResult<()> {
    running().iter().try_for_each(|it| it.begin())
}

/// With the creation times.
pub(crate) fn ids() -> Vec<(u32, f64)> {
    running()
        .iter()
        .map(|it| (it.pid, it.creation_time))
        .collect()
}

/// So that it starts while something else is done.
pub(super) fn prepare() -> JsResult<()> {
    if are_wanted() && all().spare.borrow().is_none() {
        all().spare.replace(Some(Process::spawn()?));
    }
    Ok(())
}

pub(super) fn take() -> JsResult<Rc<Process>> {
    match all().spare.take().filter(|it| !it.is_gone()) {
        Some(spare) => spare.begin().map(|()| spare),
        None => Process::spawn(),
    }
}

#[cfg(unix)]
mod system {
    use bun_core::CStringList;
    use bun_spawn_sys::posix_spawn::posix_spawn::wait4;
    use bun_spawn_sys::spawn_process::{PosixSpawnOptions, PosixStdio, spawn_process_posix};
    use bun_sys::{Fd, File};

    /// It has `socket`, which this closes, as its descriptor 3.
    pub(super) fn spawn(
        command: &CStringList,
        variables: &CStringList,
        socket: i32,
    ) -> Option<u32> {
        let socket = File::from_fd(Fd::from_native(socket));
        let options = PosixSpawnOptions {
            stdin: PosixStdio::Ignore,
            stdout: PosixStdio::Inherit,
            stderr: PosixStdio::Inherit,
            extra_fds: Box::new([PosixStdio::Pipe(socket.fd())]),
            cwd: b"/"[..].into(),
            ..PosixSpawnOptions::default()
        };
        let child = spawn_process_posix(&options, command.as_list(), Some(variables.as_list()));
        Some(child.ok()?.ok()?.pid as u32)
    }

    pub(super) fn kill(pid: u32) {
        bun_spawn_sys::ffi::kill(pid as i32, libc::SIGKILL);
    }

    pub(super) fn reap(pid: u32) -> i32 {
        wait4(pid as i32, 0, None).map_or(0, |it| it.status as i32)
    }

    pub(super) fn reason_for(status: i32) -> &'static str {
        match libc::WIFSIGNALED(status).then(|| libc::WTERMSIG(status)) {
            Some(libc::SIGINT | libc::SIGKILL | libc::SIGTERM) => "killed",
            Some(_) => "crashed",
            None if status == 0 => "clean-exit",
            None => "abnormal-exit",
        }
    }
}

#[cfg(not(unix))]
mod system {
    use bun_core::CStringList;

    pub(super) fn spawn(_: &CStringList, _: &CStringList, _: i32) -> Option<u32> {
        None
    }

    pub(super) fn kill(_: u32) {}

    pub(super) fn reap(_: u32) -> i32 {
        0
    }

    pub(super) fn reason_for(_: i32) -> &'static str {
        "crashed"
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        self.command(PageCommand::Close);
        self.give_up();
    }
}

impl Process {
    fn spawn() -> JsResult<Rc<Process>> {
        let opened = answer((ui()?.open_page_process)())?;
        let (arguments, environment) = (arguments(), environment()?);
        let Some(pid) = system::spawn(&arguments, &environment, opened.socket) else {
            (ui()?.tell_page_process)(opened.id, PageCommand::Close);
            return Err(error(format_args!(
                "Could not start a process for the page"
            )));
        };
        let this = Rc::new(Process {
            peer: opened.id,
            pid,
            creation_time: bun_core::time::milli_timestamp() as f64,
            site: None.into(),
            serving: 0.into(),
            is_holding: false.into(),
            has_held: false.into(),
            overdue: Default::default(),
            last_sent: 0.into(),
            expected: Default::default(),
            pages: Default::default(),
            disposed: Default::default(),
            is_gone: false.into(),
            was_killed_for: None.into(),
        });
        queue::listen_to_processes(hear);
        (all().by_peer.borrow_mut()).insert(this.peer, (Rc::downgrade(&this), this.pid));
        this.begin()?;
        Ok(this)
    }

    fn begin(&self) -> JsResult<()> {
        let head = Head::new(Kind::Begin, 0, 0).with(Flags::HARMLESS);
        self.send(Lane::Scripts, head, statics()?);
        Ok(())
    }

    pub(super) fn command(&self, command: PageCommand) {
        if let Some(ui) = bun_ui::loaded() {
            (ui.tell_page_process)(self.peer, command);
        }
    }

    pub(super) fn is_gone(&self) -> bool {
        self.is_gone.get()
    }

    pub(super) fn is_late(&self) -> bool {
        !self.overdue.borrow().is_empty()
    }

    pub(super) fn kill(&self, reason: &'static str) {
        if !self.is_gone() {
            self.was_killed_for.set(Some(reason));
            system::kill(self.pid);
        }
    }

    pub(super) fn admit(self: &Rc<Self>, page: &Page, has_preload: bool) {
        let needed = [link::of_window(page), link::of_preload(page)];
        // SAFETY: they are kept together.
        let [of_window, of_preload] = needed.map(|it| unsafe { Host::of(it) });
        let hosted = Hosted {
            of_blank_frames: Host::of_blank_frame_in(&of_window),
            of_window,
            of_preload: has_preload.then_some(of_preload),
            _needed: needed.map(keep),
        };
        self.pages.borrow_mut().insert(page.id, hosted.into());
        bun_web::outside::serve::admit(self.peer, &page.client);
        (page.client).set_twin(Rc::new(OfPage(Rc::downgrade(self), page.id)));
    }

    pub(super) fn dismiss(&self, page: u32) {
        let mut disposed = self.disposed.borrow_mut();
        disposed.push_back(page);
        if disposed.len() > MOST_DISPOSED {
            (disposed.pop_front().iter()).for_each(|it| drop(self.pages.borrow_mut().remove(it)));
        }
    }

    /// No script that is not their doing runs between what `steps` tell the pages.
    pub(super) fn hold<T>(&self, steps: impl FnOnce() -> T) -> T {
        if self.serving.get() != 0 || self.is_holding.replace(true) {
            return steps();
        }
        let result = steps();
        self.is_holding.set(false);
        if self.has_held.take() {
            remote::send_head(self.peer, Lane::Scripts, Head::new(Kind::Release, 0, 0));
        }
        result
    }

    fn send<T: Message>(&self, lane: Lane, mut head: Head, message: T) -> bool {
        head.within = self.serving.get();
        if self.is_holding.get() && head.within == 0 {
            head = head.with(Flags::HELD);
            self.has_held.set(true);
        }
        !self.is_gone() && remote::send(self.peer, lane, head, message)
    }

    fn send_expecting<T: Message>(&self, lane: Lane, head: Head, message: T, expected: Expected) {
        let ticket = remote::next_ticket();
        if self.send(lane, Head { ticket, ..head }, message) {
            self.expected.borrow_mut().insert(ticket, expected);
            self.last_sent.set(ticket);
        } else {
            expected.give_up();
        }
    }

    /// A page that waits for an answer does it at once, as if it were called.
    fn order<T: Message>(&self, lane: Lane, head: Head, message: T) {
        if self.serving.get() == 0 {
            self.send(lane, head, message);
        } else {
            self.send_expecting(lane, head, message, Expected::Nothing);
            self.wait();
        }
    }

    /// For the reply to what was sent last.
    pub(super) fn wait(&self) {
        let ticket = self.last_sent.get();
        let is_done = || !self.expected.borrow().contains_key(&ticket);
        let deadline = Instant::now() + PATIENCE;
        if !is_done()
            && (self.is_late()
                || !queue::wait_for_process(global(), self.peer, Some(deadline), &is_done, &|_| {
                    true
                }))
        {
            self.overdue.borrow_mut().push(ticket);
        }
    }

    fn give_up(&self) {
        self.is_gone.set(true);
        self.pages.take();
        let mut expected = self.expected.take();
        let tickets = expected.keys().copied().collect::<Vec<_>>();
        (tickets.iter().filter_map(|it| expected.remove(it))).for_each(Expected::give_up);
    }

    fn take_expected(&self, ticket: u32) -> wire::Result<Expected> {
        self.overdue.borrow_mut().retain(|it| *it != ticket);
        self.expected.borrow_mut().remove(&ticket).ok_or(Malformed)
    }

    fn answer(&self, head: Head, host: Option<&Host>, question: Question) {
        let (peer, reply) = (self.peer, Head::new(Kind::Answer, head.about, head.ticket));
        match host.map(Host::link) {
            Some(link) if question.is_request() => {
                let reply = move |_: &_, it| remote::reply(peer, Lane::Scripts, reply, it);
                link.request(question, Box::new(reply));
            }
            link => {
                let before = self.serving.replace(head.ticket);
                let answer = link.and_then(|it| it.ask(question));
                self.serving.set(before);
                if head.ticket != 0 {
                    remote::reply(peer, Lane::Scripts, reply, answer);
                }
            }
        }
    }

    fn accept(&self, message: Vec<u8>) -> wire::Result<()> {
        let head = Head::of(&message)?;
        match head.kind {
            Kind::Notice | Kind::Question => {
                let hosted = self.pages.borrow().get(&head.about).cloned();
                let host = hosted.as_ref().and_then(|it| match head.flags {
                    flags if flags.contains(Flags::OF_PRELOAD) => it.of_preload.as_ref(),
                    flags if flags.contains(Flags::OF_BLANK_FRAME) => Some(&it.of_blank_frames),
                    _ => Some(&it.of_window),
                });
                if head.kind == Kind::Question {
                    self.answer(head, host, remote::open(self.peer, &message)?);
                } else {
                    let notice = remote::open(self.peer, &message)?;
                    if let Some(host) = host {
                        host.link().tell(notice);
                    }
                }
            }
            Kind::Nothing => self.take_expected(head.ticket)?.give_up(),
            Kind::Outcome | Kind::Done => match (head.kind, self.take_expected(head.ticket)?) {
                (Kind::Outcome, Expected::Outcome(reply)) => {
                    reply(global(), Some(remote::open(self.peer, &message)?));
                }
                (Kind::Done, Expected::Done(reply)) => {
                    reply(global(), Some(remote::open(self.peer, &message)?));
                }
                _ => return Err(Malformed),
            },
            _ => return remote::accept(self.peer, head, message),
        }
        Ok(())
    }

    fn has_ended(&self, status: i32) -> JsResult<()> {
        let (reason, code) = (self.was_killed_for.get())
            .map_or_else(|| (system::reason_for(status), status), |it| (it, 2));
        let hit = alive().filter(|it| !it.is_frame() && it.page().is_in(self));
        let hit = hit.map(Root::new).collect::<Vec<_>>();
        hit.iter().try_for_each(|it| it.get().crash(reason, code))
    }
}

fn hear(from: Peer, heard: Heard) -> JsResult<()> {
    let known = all().by_peer.borrow().get(&from).cloned();
    let Some((process, pid)) = known else {
        return Ok(());
    };
    let process = process.upgrade();
    match heard {
        Heard::Message(message) => {
            let Some(process) = process.filter(|it| !it.is_gone()) else {
                return Ok(());
            };
            process.command(PageCommand::Handled(message.len()));
            if from_js_host_call_generic(global(), || process.accept(message))?.is_err() {
                process.kill("killed");
                process.give_up();
            }
        }
        Heard::End { has_misbehaved } => {
            all().by_peer.borrow_mut().remove(&from);
            if has_misbehaved || process.is_none() {
                system::kill(pid);
            }
            remote::forget(from);
            let process = process.inspect(|it| it.give_up());
            crate::task::spawn(async move {
                let status = bun_web::exec::blocking(move || system::reap(pid)).await;
                let status = status.unwrap_or_default();
                crate::task::report(process.map_or(Ok(()), |it| it.has_ended(status)));
            });
        }
    }
    Ok(())
}

impl page::Link for Process {
    fn tell(&self, page: u32, mut order: Order) {
        let mut lane = Lane::Scripts;
        match &mut order {
            Order::Input {
                input: Input::Resize {
                    is_quiet: false, ..
                },
            } => lane = Lane::NewSize,
            Order::Frame {
                news: News::Painted(image),
                ..
            } if *image != 0 => {
                self.command(PageCommand::Lend(*image));
                *image |= LENT_IMAGE;
            }
            _ => {}
        }
        self.order(lane, Head::new(Kind::Order, page, 0), order);
    }

    fn request(&self, page: u32, query: Query, reply: Reply<Option<Outcome>>) {
        let flags = match query.is_harmless() {
            true => Flags::HARMLESS,
            false => Flags::empty(),
        };
        let head = Head::new(Kind::Query, page, 0).with(flags);
        self.send_expecting(Lane::Scripts, head, query, Expected::Outcome(reply));
    }

    fn change(&self, context: u32, mut change: Change) {
        if let Change::Created { image, .. } = &mut change
            && *image != 0
        {
            self.command(PageCommand::Lend(*image));
            *image |= LENT_IMAGE;
        }
        self.send(Lane::Scripts, Head::new(Kind::Change, context, 0), change);
    }
}

impl renderer::Link for Process {
    fn tell(&self, page: u32, command: Command) {
        let head = Head::new(Kind::Command, page, 0);
        match command {
            Command::Start { .. } => self.order(Lane::Scripts, head, command),
            Command::Reply { .. } => {
                remote::send(self.peer, Lane::Scripts, head, command);
            }
            command => drop(self.send(Lane::Scripts, head, command)),
        }
    }

    fn request(&self, page: u32, task: Task, reply: Reply<Option<Done>>) {
        let head = Head::new(Kind::Task, page, 0);
        self.send_expecting(Lane::Scripts, head, task, Expected::Done(reply));
    }
}

struct OfPage(Weak<Process>, u32);

impl Twin for OfPage {
    fn update(&self, update: Update) {
        if let Some(process) = self.0.upgrade() {
            renderer::Link::tell(&*process, self.1, Command::UpdateClient { update });
        }
    }
}

//! A process that has pages. Nothing that it says is taken on trust.

use std::collections::VecDeque;
use std::rc::{Rc, Weak};
use std::time::{Duration, Instant};

use bun_core::{CStringList, CodeGenerationFromStrings};
use bun_jsc::{Strong, from_js_host_call_generic};
use bun_sys::File;
use bun_ui::protocol::{
    COMPILED_PAGE_PROCESS_MARKER, GPU_PROCESS_MARKER, LENT_IMAGE, Lane, Launch,
    PAGE_PROCESS_MARKER, PageCommand,
};
use bun_ui::queue::{self, Heard};
use bun_web::HashMap;
use bun_web::client::{Twin, Update};
use bun_web::host::{Answer, Host, Question, Reply};
use bun_web::input::{Action, Input};
use bun_web::outside::serve;
use bun_web::page::{self, Change, News, Order, Outcome, Query};
use bun_web::remote::{self, Flags, Head, Kind, Peer, clerk};
use bun_web::renderer::{self, Command, Conditions, Done, Renderer, Statics, Task};
use bun_web::service::Lodging;
use bun_web::wire::{self, Malformed, Message};

use super::page::Page;
use super::place::{self, Place};
use super::witness::Witness;
use super::{alive, link};
use crate::prelude::*;
use crate::{command_line, crash_reporter, files, process, task};

const MOST_EXPECTED: usize = 1 << 16;
/// From then on, windows of a site share one.
const MANY_PROCESSES: usize = 32;
const MOST_PROCESSES: usize = 256;
const KEPT_FOR_APP: usize = 64;
/// Their windows may still be around.
const MOST_DISPOSED: usize = 256;

enum Expected {
    Outcome(Reply<Option<Outcome>>),
    Done(Reply<Option<Done>>),
    Turn(Rc<Postponed>, Option<later::Timer>),
    Nothing,
}

type Postponed = RefCell<Vec<Box<dyn FnOnce() -> JsResult<()>>>>;

impl Expected {
    fn give_up(self) {
        match self {
            Expected::Outcome(reply) => reply(global(), None),
            Expected::Done(reply) => reply(global(), None),
            Expected::Turn(all, _deadline) => {
                (all.take().into_iter()).for_each(|it| post(Priority::Host, it));
            }
            Expected::Nothing => {}
        }
    }
}

/// How long the app may be kept waiting.
struct Patience {
    left: Cell<Duration>,
    at: Cell<Instant>,
    deadline: Cell<Option<Instant>>,
}

impl Patience {
    const FREE: Duration = Duration::from_millis(10);
    const MOST: Duration = Duration::from_secs(1);

    fn spend(&self, wait: impl FnOnce(Instant)) {
        if let Some(of_outer_wait) = self.deadline.get() {
            return wait(of_outer_wait);
        }
        let start = Instant::now();
        let left = Patience::MOST.min(self.left.get() + (start - self.at.get()) / 10);
        let deadline = start + Patience::FREE + left;
        self.deadline.set(Some(deadline));
        wait(deadline);
        self.deadline.take();
        self.at.set(Instant::now());
        (self.left).set(left.min(deadline.saturating_duration_since(self.at.get())));
    }
}

/// Input that has yet to be handled.
struct Probe {
    ticket: u32,
    page: u32,
    is_overdue: bool,
    _timer: later::Timer,
}

struct Hosted {
    of_window: Host,
    of_blank_frames: Host,
    of_preload: Host,
    has_preload: Cell<bool>,
    _needed: [Strong; 2],
}

pub(super) struct Process {
    peer: Peer,
    pub(super) pid: u32,
    pub(super) creation_time: f64,
    pub(super) place: RefCell<Place>,
    /// How many groups of windows.
    users: Cell<u32>,
    has_had_preload: Cell<bool>,
    /// The ticket of the question that is being answered, or 0.
    serving: Cell<u32>,
    is_deaf: Cell<bool>,
    last_conditions: Cell<u32>,
    may_use_gpu: Cell<bool>,
    pub(super) witness: Witness,
    probed_at: Cell<Instant>,
    probe: RefCell<Option<Probe>>,
    patience: Patience,
    is_holding: Cell<bool>,
    postponed: RefCell<Weak<Postponed>>,
    has_held: Cell<bool>,
    /// What has been waited for in vain.
    overdue: RefCell<Vec<u32>>,
    /// And whether it is harmless.
    last_sent: Cell<(u32, bool)>,
    expected: RefCell<HashMap<u32, Expected>>,
    pages: RefCell<HashMap<u32, Rc<Hosted>>>,
    disposed: RefCell<VecDeque<u32>>,
    is_gone: Cell<bool>,
    was_killed_for: Cell<Option<&'static str>>,
    /// What it writes about its crash.
    report: RefCell<Option<File>>,
}

#[derive(Default)]
struct All {
    by_peer: RefCell<HashMap<Peer, (Weak<Process>, u32)>>,
    /// One for each role at most.
    spares: RefCell<Vec<Rc<Process>>>,
    /// That of the window whose question is being answered.
    asking: Cell<Option<Peer>>,
}

state!(fn all() -> All);

fn is_like_browser(place: &Place) -> bool {
    place::trusts_by_origin() || !place.is_trusted()
}

fn path_of_library() -> String {
    unsafe extern "Rust" {
        safe fn __bun_desktop_path_of_library() -> &'static [u8];
    }
    files::absolute(&string(__bun_desktop_path_of_library()))
}

fn may_log() -> bool {
    super::logs_to_stderr() || place::is_for_testing()
}

fn arguments(place: &Place) -> CStringList {
    let (executable, library) = (process::executable(), path_of_library());
    let restriction: Option<&[u8]> = match bun_core::code_generation_from_strings() {
        _ if !place.is_trusted() || place.runs_program() => None,
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
        match place.runs_program() {
            true => COMPILED_PAGE_PROCESS_MARKER.to_bytes(),
            false => PAGE_PROCESS_MARKER.to_bytes(),
        },
        library.as_bytes(),
    ];
    let exemption = command_line::switch("no-sandbox").map(|_| &b"--no-sandbox"[..]);
    let all = (fixed.into_iter().chain(restriction).chain(exemption)).map(|it| [it]);
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
                    | "BUN_DESKTOP_PAGE_PROCESSES"
                    | "BUN_ENABLE_CRASH_REPORTING"
            )
    };
    let mut all = process::variables()?;
    all.retain(|it| is_needed(&it.0));
    let entries = (all.iter()).map(|it| [it.0.as_bytes(), b"=", it.1.as_bytes()]);
    Ok(CStringList::from_parts(entries))
}

fn launch_of_gpu_process(owner: u32) -> JsResult<Launch> {
    const FOR_DRIVERS: [&str; 14] = [
        "AMD_",
        "ASAN_OPTIONS",
        "BUN_DESKTOP_",
        "BUN_ENABLE_CRASH_REPORTING",
        "BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING",
        "DRI_PRIME",
        "GALLIUM_",
        "LD_LIBRARY_PATH",
        "LIBGL_",
        "LP_",
        "LSAN_OPTIONS",
        "MESA_",
        "__EGL_",
        "__NV_",
    ];
    let mut variables = process::variables()?;
    variables.retain(|it| FOR_DRIVERS.iter().any(|prefix| it.0.starts_with(prefix)));
    let without_files = ["MESA_SHADER_CACHE_DISABLE=true", "__GL_SHADER_DISK_CACHE=0"];
    let variables = variables.iter().map(|it| format!("{}={}", it.0, it.1));
    let exemption = command_line::switch("no-sandbox").map(|_| "--no-sandbox".into());
    let fixed = [
        process::executable(),
        string(GPU_PROCESS_MARKER.to_bytes()),
        path_of_library(),
    ];
    Ok(Launch {
        arguments: fixed.into_iter().chain(exemption).map(Into::into).collect(),
        environment: (without_files.into_iter().map(Into::into))
            .chain(variables.map(Into::into))
            .collect(),
        may_log: may_log(),
        owner,
    })
}

fn statics(place: &Place) -> JsResult<Statics> {
    let resources = get(process::object(), "resourcesPath")?;
    let mut all = Statics::new(
        super::text_if_any(resources)?.unwrap_or_default(),
        is_like_browser(place),
    );
    all.is_headless = is_headless()?;
    all.tracing = crate::tracing::in_progress();
    Ok(all)
}

pub(super) fn too_many() -> bun_jsc::JsError {
    error(format_args!("There are too many processes for pages"))
}

fn running() -> Vec<Rc<Process>> {
    let all = all().by_peer.borrow();
    all.values().filter_map(|it| it.0.upgrade()).collect()
}

pub(crate) fn statics_changed() -> JsResult<()> {
    running().iter().try_for_each(|it| it.begin())
}

pub(crate) fn render_trusted_pages() {
    let is_meant = |it: &Rc<Process>| it.place.borrow().is_trusted() && it.users.get() > 0;
    for it in running().into_iter().filter(is_meant) {
        Renderer::new(Rc::clone(&it) as _, 0).render(|_, ()| {});
        it.wait();
    }
}

/// By the ids of the processes that answer in time.
pub(crate) async fn finish_traces() -> Vec<(u32, String)> {
    const PATIENCE: u64 = 3000;
    let ask = |process: Rc<Process>| {
        let (pid, (send, events)) = (process.pid, task::oneshot());
        Renderer::new(process, 0).finish_trace(move |_, it| send.send(it));
        (pid, events)
    };
    let (asked, mut all) = (Vec::from_iter(running().into_iter().map(ask)), Vec::new());
    let collect = async {
        for (pid, events) in asked {
            all.extend(events.await.map(|it| (pid, it)));
        }
    };
    task::within(PATIENCE, collect).await;
    all
}

/// With the creation times.
pub(crate) fn ids() -> Vec<(u32, f64)> {
    running()
        .iter()
        .map(|it| (it.pid, it.creation_time))
        .collect()
}

fn take_spare(place: &Place) -> Option<Rc<Process>> {
    let mut spares = all().spares.borrow_mut();
    let found = (spares.iter()).position(|it| it.place.borrow().can_become(place))?;
    Some(spares.swap_remove(found)).filter(|it| !it.is_gone())
}

fn find_shared(place: &Place, is_for_frame: bool) -> Option<Rc<Process>> {
    let all = running();
    let shares = place.can_be_shared() && (is_for_frame || all.len() >= MANY_PROCESSES);
    all.into_iter().find(|it| {
        shares
            && *it.place.borrow() == *place
            && !(it.is_gone() || it.is_late() || it.has_had_preload.get())
    })
}

/// So that it starts while something else is done.
pub(super) fn prepare(place: &Place, is_for_frame: bool) -> JsResult<()> {
    const MILLISECONDS_TO_BE_USED: f64 = 10_000.;
    let Place::Apart { role, .. } = *place else {
        return Ok(());
    };
    if running().len() >= MANY_PROCESSES || find_shared(place, is_for_frame).is_some() {
        return Ok(());
    }
    let spare = match take_spare(place) {
        Some(it) => it,
        None => {
            let site = "".into();
            let new = Process::spawn(Place::Apart { role, site })?;
            let peer = new.peer;
            let dismiss = move |_: &_| {
                let unused = Vec::from_iter(
                    (all().spares.borrow_mut()).extract_if(.., |it| it.peer == peer),
                );
                drop(unused);
                Ok(())
            };
            later::after(MILLISECONDS_TO_BE_USED, dismiss).detach();
            new
        }
    };
    all().spares.borrow_mut().push(spare);
    Ok(())
}

pub(super) fn take(place: Place, may_share: bool, is_for_frame: bool) -> JsResult<Rc<Process>> {
    take_for(
        find_shared(&place, is_for_frame).filter(|_| may_share),
        place,
    )
}

fn take_for(shared: Option<Rc<Process>>, place: Place) -> JsResult<Rc<Process>> {
    let process = match shared.or_else(|| take_spare(&place)) {
        Some(known) => known.begin().map(|()| known)?,
        None => Process::spawn(place.clone())?,
    };
    process.settle(place);
    Ok(process.share())
}

struct Lease(Rc<Process>);

impl Drop for Lease {
    fn drop(&mut self) {
        self.0.release();
    }
}

pub(crate) fn keep_alive(peer: Peer) -> Option<Box<dyn core::any::Any>> {
    let process = all().by_peer.borrow().get(&peer)?.0.upgrade()?;
    Some(Box::new(Lease(process.share())))
}

pub(super) fn lease(place: Place) -> JsResult<Lodging> {
    let is_like_in_browser = is_like_browser(&place);
    let process = match find_shared(&place, true) {
        Some(known) => known.share(),
        None => take_for(None, place)?,
    };
    Ok(Lodging {
        peer: process.peer,
        pid: process.pid,
        is_like_in_browser,
        lease: Box::new(Lease(process)),
    })
}

#[cfg(unix)]
mod system {
    use bun_core::CStringList;
    use bun_spawn_sys::posix_spawn::posix_spawn::wait4;
    use bun_spawn_sys::spawn_process::{PosixSpawnOptions, PosixStdio, spawn_process_posix};
    use bun_sys::{Fd, File};
    use bun_ui::protocol::{EXIT_WITHOUT_SANDBOX, SOCKET_TO_PARENT};

    const _: () = assert!(SOCKET_TO_PARENT == libc::STDERR_FILENO + 1);

    /// It has `socket`, which this closes, as the first descriptor after the standard ones.
    pub(super) fn spawn(
        command: &CStringList,
        variables: &CStringList,
        socket: i32,
        may_log: bool,
    ) -> Option<u32> {
        let socket = File::from_fd(Fd::from_native(socket));
        bun_ui::can_start_programs().then_some(())?;
        let options = PosixSpawnOptions {
            stdin: PosixStdio::Ignore,
            stdout: PosixStdio::Ignore,
            stderr: match may_log {
                true => PosixStdio::Inherit,
                false => PosixStdio::Ignore,
            },
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
            None if libc::WEXITSTATUS(status) == EXIT_WITHOUT_SANDBOX => "launch-failed",
            None => "abnormal-exit",
        }
    }
}

#[cfg(not(unix))]
mod system {
    use bun_core::CStringList;

    pub(super) fn spawn(_: &CStringList, _: &CStringList, _: i32, _: bool) -> Option<u32> {
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
    fn spawn(place: Place) -> JsResult<Rc<Process>> {
        let kept = if place.is_trusted() { 0 } else { KEPT_FOR_APP };
        if all().by_peer.borrow().len() + kept >= MOST_PROCESSES {
            return Err(too_many());
        }
        let (arguments, environment) = (arguments(&place), environment()?);
        let opened = answer((ui()?.open_page_process)(place.is_trusted()))?;
        let Some(pid) = system::spawn(&arguments, &environment, opened.socket, may_log()) else {
            (ui()?.tell_page_process)(opened.id, PageCommand::Close);
            return Err(error(format_args!(
                "Could not start a process for the page"
            )));
        };
        let this = Rc::new(Process {
            peer: opened.id,
            pid,
            creation_time: bun_core::time::milli_timestamp() as f64,
            place: place.into(),
            users: 0.into(),
            has_had_preload: false.into(),
            serving: 0.into(),
            is_deaf: false.into(),
            last_conditions: 0.into(),
            may_use_gpu: false.into(),
            witness: Witness::new(),
            probed_at: Instant::now().into(),
            probe: None.into(),
            patience: Patience {
                left: Patience::MOST.into(),
                at: Instant::now().into(),
                deadline: None.into(),
            },
            is_holding: false.into(),
            postponed: Default::default(),
            has_held: false.into(),
            overdue: Default::default(),
            last_sent: (0, false).into(),
            expected: Default::default(),
            pages: Default::default(),
            disposed: Default::default(),
            is_gone: false.into(),
            was_killed_for: None.into(),
            report: None.into(),
        });
        clerk::employ(this.peer, ui()?);
        queue::listen_to_processes(hear);
        (all().by_peer.borrow_mut()).insert(this.peer, (Rc::downgrade(&this), this.pid));
        this.begin()?;
        Ok(this)
    }

    fn begin(&self) -> JsResult<()> {
        let head = Head::new(Kind::Begin, 0, 0).with(Flags::HARMLESS);
        let mut statics = statics(&self.place.borrow())?;
        if self.report.borrow().is_none()
            && let Some([ours, theirs]) = crash_reporter::file_for_page_process()
        {
            remote::give_file_for_report(self.peer, theirs);
            self.report.replace(Some(ours));
            statics.has_file_for_report = true;
        }
        self.send(Lane::Scripts, head, statics);
        Ok(())
    }

    pub(super) fn settle(&self, place: Place) {
        remote::revoke_files(self.peer);
        self.place.replace(place);
    }

    pub(super) fn share(self: Rc<Self>) -> Rc<Self> {
        self.users.update(|it| it + 1);
        self
    }

    pub(super) fn is_shared(&self) -> bool {
        self.users.get() > 1
    }

    pub(super) fn release(self: &Rc<Self>) {
        const MILLISECONDS_TO_FINISH: f64 = 500.;
        self.users.update(|it| it - 1);
        let this = Rc::clone(self);
        let close = move |_: &_| {
            if this.users.get() == 0 && !this.is_gone() {
                this.command(PageCommand::Close);
                this.give_up();
            }
            Ok(())
        };
        later::after(MILLISECONDS_TO_FINISH, close).detach();
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

    /// The app hears of it before this returns.
    pub(super) fn end(&self) -> JsResult<()> {
        self.kill("killed");
        self.give_up();
        self.has_ended(0)
    }

    pub(super) fn admit(self: &Rc<Self>, page: &Page, has_preload: bool) {
        let needed = [link::of_window(page), link::of_preload(page)];
        // SAFETY: they are kept together.
        let [of_window, of_preload] = needed.map(|it| unsafe { Host::of(it) });
        let hosted = Hosted {
            of_blank_frames: Host::of_blank_frame_in(&of_window),
            of_window,
            of_preload,
            has_preload: has_preload.into(),
            _needed: needed.map(keep),
        };
        self.pages.borrow_mut().insert(page.id, hosted.into());
        self.has_had_preload.update(|it| it || has_preload);
        let place = self.place.borrow();
        if is_like_browser(&place) {
            page.client.treat_like_in_browser();
        }
        if let Place::Apart { site, .. } = &*place
            && place.is_trusted()
            && place.can_be_shared()
            && page.contents().session.is_persistent()
        {
            self.command(PageCommand::StoreFontsFor((&**site).into()));
        }
        if cfg!(target_os = "linux") && page.has_webgl() && !self.may_use_gpu.replace(true) {
            let allow = |it| self.command(PageCommand::AllowGpu(it));
            task::report(launch_of_gpu_process(page.owner().id).map(allow));
        }
        serve::admit(self.peer, &page.client, page.owner().id);
        (page.client).set_twin(Rc::new(OfPage(Rc::downgrade(self), page.id)));
    }

    pub(super) fn conditions_for(&self, page: u32) -> Option<Conditions> {
        let hosted = self.pages.borrow().get(&page).cloned()?;
        match hosted.of_window.link().ask(Question::Environment {})? {
            Answer::Environment(environment) => Some(Conditions {
                environment,
                number: {
                    self.last_conditions.update(|it| it + 1);
                    self.last_conditions.get()
                },
            }),
            _ => None,
        }
    }

    pub(super) fn dismiss(self: &Rc<Self>, page: &Page) {
        const MILLISECONDS_FOR_LAST_WORDS: f64 = 5000.;
        let (this, client, page) = (Rc::downgrade(self), page.client.id, page.id);
        let revoke = move |_: &_| {
            if let Some(this) = this.upgrade() {
                serve::dismiss(this.peer, client);
                (this.pages.borrow().get(&page).iter()).for_each(|it| it.has_preload.set(false));
            }
            Ok(())
        };
        later::after(MILLISECONDS_FOR_LAST_WORDS, revoke).detach();
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
        if self.expected.borrow().len() >= MOST_EXPECTED {
            self.kill("killed");
            expected.give_up();
        } else if self.send(lane, Head { ticket, ..head }, message) {
            self.expected.borrow_mut().insert(ticket, expected);
            (self.last_sent).set((ticket, head.flags.contains(Flags::HARMLESS)));
        } else {
            expected.give_up();
        }
    }

    /// A page that waits for an answer does it at once, as if it were called.
    fn order<T: Message>(&self, lane: Lane, head: Head, message: T) {
        if self.serving.get() == 0 || self.is_deaf.get() || self.is_late() {
            self.send(lane, head, message);
        } else {
            self.send_expecting(lane, head, message, Expected::Nothing);
            self.wait();
        }
    }

    fn postpone(&self, work: Box<dyn FnOnce() -> JsResult<()>>) {
        const MILLISECONDS_TO_RETURN: f64 = 1000.;
        let known = self.postponed.borrow().upgrade();
        if let Some(all) = known {
            all.borrow_mut().push(work);
            if all.borrow().len() >= MOST_EXPECTED {
                self.kill("killed");
            }
            return;
        }
        let (all, ticket) = (Rc::new(RefCell::new(vec![work])), remote::next_ticket());
        self.postponed.replace(Rc::downgrade(&all));
        if self.is_gone() {
            return Expected::Turn(all, None).give_up();
        }
        remote::send_head(self.peer, Lane::Scripts, Head::new(Kind::Turn, 0, ticket));
        let peer = self.peer;
        let deadline = later::after(MILLISECONDS_TO_RETURN, move |_| {
            let this = (self::all().by_peer.borrow().get(&peer)).and_then(|it| it.0.upgrade());
            let replace = |it: Rc<Process>| {
                let mut expected = it.expected.borrow_mut();
                Some(core::mem::replace(
                    expected.get_mut(&ticket)?,
                    Expected::Nothing,
                ))
            };
            this.and_then(replace)
                .into_iter()
                .for_each(Expected::give_up);
            Ok(())
        });
        (self.expected.borrow_mut()).insert(ticket, Expected::Turn(all, Some(deadline)));
    }

    fn is_due_for_probe(&self) -> bool {
        self.serving.get() == 0
            && self.probe.borrow().is_none()
            && self.probed_at.get().elapsed() >= Duration::from_secs(1)
    }

    fn probe_with(&self, lane: Lane, page: u32, input: Order) {
        let head = Head::new(Kind::Order, page, 0);
        self.send_expecting(lane, head, input, Expected::Nothing);
        self.probed_at.set(Instant::now());
        self.probe.replace(Some(Probe {
            ticket: self.last_sent.get().0,
            page,
            is_overdue: false,
            _timer: self.check_probe_later(),
        }));
    }

    fn check_probe_later(&self) -> later::Timer {
        const MILLISECONDS_UNTIL_UNRESPONSIVE: f64 = 15_000.;
        let peer = self.peer;
        later::after(MILLISECONDS_UNTIL_UNRESPONSIVE, move |_| {
            let this = (all().by_peer.borrow().get(&peer)).and_then(|it| it.0.upgrade());
            this.map_or(Ok(()), |it| it.check_probe())
        })
    }

    fn check_probe(&self) -> JsResult<()> {
        let mut probe = self.probe.borrow_mut();
        let Some(it) = probe.as_mut() else {
            return Ok(());
        };
        if self.serving.get() != 0 {
            it._timer = self.check_probe_later();
            return Ok(());
        }
        it.is_overdue = true;
        let page = it.page;
        drop(probe);
        announce_to_owner_of(page, "unresponsive")
    }

    /// For the reply to what was sent last. What the scripts that it runs ask for is done meanwhile.
    pub(super) fn wait(&self) {
        let (ticket, is_harmless) = self.last_sent.get();
        let is_done = || !self.expected.borrow().contains_key(&ticket);
        if is_done() || self.is_deaf.get() {
            return;
        }
        let accepts = |message: &[u8]| {
            !is_harmless
                || Head::of(message).is_ok_and(|it| match it.kind {
                    Kind::Outcome | Kind::Nothing => it.ticket == ticket,
                    Kind::Question | Kind::Call => it.flags.contains(Flags::HARMLESS),
                    _ => false,
                })
        };
        if !self.is_late() {
            self.patience.spend(|deadline| {
                queue::wait_for_process(global(), self.peer, Some(deadline), &is_done, &accepts);
            });
        }
        if !is_done() {
            self.overdue.borrow_mut().push(ticket);
        }
    }

    fn give_up(&self) {
        self.is_gone.set(true);
        self.probe.take();
        self.pages.take();
        let mut expected = self.expected.take();
        let tickets = expected.keys().copied().collect::<Vec<_>>();
        (tickets.iter().filter_map(|it| expected.remove(it))).for_each(Expected::give_up);
    }

    fn take_expected(&self, ticket: u32) -> wire::Result<Expected> {
        self.overdue.borrow_mut().retain(|it| *it != ticket);
        let probe = self.probe.borrow_mut().take_if(|it| it.ticket == ticket);
        if let Some(Probe { page, .. }) = probe.filter(|it| it.is_overdue) {
            later::soon(move |_| announce_to_owner_of(page, "responsive"));
        }
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
                let was_deaf = self.is_deaf.replace(head.flags.contains(Flags::DEAF));
                let answer = link.and_then(|it| it.ask(question));
                self.serving.set(before);
                self.is_deaf.set(was_deaf);
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
                    flags if flags.contains(Flags::OF_PRELOAD) => {
                        it.has_preload.get().then_some(&it.of_preload)
                    }
                    flags if flags.contains(Flags::OF_BLANK_FRAME) => Some(&it.of_blank_frames),
                    _ => Some(&it.of_window),
                });
                if head.kind == Kind::Question {
                    let mut question: Question = remote::open(self.peer, &message)?;
                    if head.flags.contains(Flags::HARMLESS)
                        != question.is_answered_without_scripts()
                    {
                        return Err(Malformed);
                    }
                    let is_of_preload = matches!(question, Question::ActivatedByPreload {});
                    let host = host.filter(|_| {
                        (!is_of_preload || head.flags.contains(Flags::OF_PRELOAD))
                            && self.witness.admits(&mut question)
                    });
                    let is_of_window = !head.flags.contains(Flags::OF_PRELOAD);
                    let before = all().asking.replace(is_of_window.then_some(self.peer));
                    self.answer(head, host, question);
                    all().asking.set(before);
                } else {
                    let mut notice = remote::open(self.peer, &message)?;
                    if let Some(host) = host.filter(|_| self.witness.believes(&mut notice)) {
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
        let hit = alive().filter(|it| (!it.is_frame() || it.is_apart()) && it.page().is_in(self));
        let hit = hit.map(Root::new).collect::<Vec<_>>();
        (hit.iter().map(Root::get).filter(|it| !it.is_destroyed()))
            .try_for_each(|it| it.lose_page(reason, code))
    }
}

/// Once the script that has asked for it has returned, which it has yet to do if it is in another process.
pub(super) fn after_script(priority: Priority, work: impl FnOnce() -> JsResult<()> + 'static) {
    let of = |peer| all().by_peer.borrow().get(&peer)?.0.upgrade();
    match all().asking.get().and_then(of) {
        Some(process) => process.postpone(Box::new(work)),
        None => post(priority, work),
    }
}

fn announce_to_owner_of(page: u32, event: &str) -> JsResult<()> {
    let Some(owner) = (alive().find(|it| it.page().id == page)).map(|it| it.owner()) else {
        return Ok(());
    };
    announce(owner.to_js(), event, &[])?;
    let window = owner
        .window()
        .filter(|_| owner.kind.get() == super::Kind::Window);
    window.map_or(Ok(()), |it| announce(it.to_js(), event, &[]))
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
        Heard::End => {
            all().by_peer.borrow_mut().remove(&from);
            system::kill(pid);
            remote::forget(from);
            let process = process.inspect(|it| it.give_up());
            crate::task::spawn(async move {
                let status = bun_web::exec::blocking(move || system::reap(pid)).await;
                let status = status.unwrap_or_default();
                let report = |it: &Rc<Process>| Some((it.report.take()?, it.place.borrow().site()));
                if let Some((report, site)) = process.as_ref().and_then(report) {
                    crash_reporter::keep_report_in(report, site).await;
                }
                crate::task::report(process.map_or(Ok(()), |it| it.has_ended(status)));
            });
        }
    }
    Ok(())
}

impl page::Link for Process {
    fn tell(&self, page: u32, mut order: Order) {
        let mut lane = Lane::Scripts;
        self.witness.note(&mut order);
        match &mut order {
            Order::Input {
                input:
                    input @ (Input::Mouse(_)
                    | Input::Key(_)
                    | Input::Text { .. }
                    | Input::Wheel { .. }
                    | Input::Touch { .. }),
            } => {
                lane = match input {
                    Input::Mouse(it) if it.action == Action::Move => Lane::Motion,
                    Input::Wheel { .. } => Lane::Motion,
                    _ => Lane::Input,
                };
                if self.is_due_for_probe() {
                    return self.probe_with(lane, page, order);
                }
            }
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
        if order.makes_read_environment()
            && let Some(conditions) = self.conditions_for(page)
        {
            renderer::Link::tell(self, page, Command::Prepare { conditions });
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
        if let Change::Created {
            image, embedder, ..
        } = &mut change
            && *image != 0
        {
            if embedder.is_some() {
                self.command(PageCommand::Lend(*image));
            }
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

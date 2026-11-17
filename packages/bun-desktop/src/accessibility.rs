//! What assistive technologies are told. The documents send their trees, and this answers for them.

#[cfg_attr(
    not(target_os = "macos"),
    expect(dead_code, unused_imports, reason = "tests ask some of it")
)]
pub mod cocoa;
pub mod forest;
#[cfg(not(target_os = "macos"))]
mod hypertext;
mod math;
pub mod search;
pub mod tables;
pub mod text;

use std::cell::{Cell, RefCell};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub use forest::{Event, Forest, Id};

use crate::abi::accessibility::{self as abi, Action, TREE_OF_IMAGE};
use crate::host::{self, thread};
use crate::protocol::{Input, SystemEvent};
use crate::window::{self, WindowState};
use crate::{bridge, surface};

static IS_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Default)]
struct Clients {
    /// One has said that it listens.
    are_announced: bool,
    include_screen_reader: bool,
    /// The application wants it, whether or not one listens.
    are_assumed: bool,
    last_use: Option<Instant>,
}

impl Clients {
    /// Whether there are trees, and whether pages have to reckon with a screen reader.
    fn needs(self) -> [bool; 2] {
        let reads = self.include_screen_reader || self.are_assumed;
        [
            reads || self.are_announced || self.last_use.is_some(),
            reads,
        ]
    }
}

thread_local! {
    static FOREST: RefCell<Forest> = RefCell::default();
    static CLIENTS: Cell<Clients> = Cell::default();
    static IS_POSTING: Cell<bool> = const { Cell::new(false) };
    static RECORDED: RefCell<Option<Vec<String>>> = const { RefCell::new(None) };
}

pub fn is_active() -> bool {
    IS_ACTIVE.load(Ordering::Relaxed)
}

fn change_clients(change: impl FnOnce(&mut Clients)) {
    let mut clients = CLIENTS.get();
    change(&mut clients);
    let (old, new) = (CLIENTS.replace(clients).needs(), clients.needs());
    if old == new {
        return;
    }
    if old[0] != new[0] {
        IS_ACTIVE.store(new[0], Ordering::Relaxed);
        post(FOREST.with_borrow_mut(Forest::clear));
        windows_changed();
    }
    bridge::emit_system(SystemEvent::AccessibilityChanged {
        is_active: new[0],
        has_screen_reader: new[1],
    });
}

pub fn set_clients(are_announced: bool, include_screen_reader: bool) {
    change_clients(|it| {
        (it.are_announced, it.include_screen_reader) = (are_announced, include_screen_reader)
    });
}

pub fn assume_clients(are_assumed: bool) {
    change_clients(|it| it.are_assumed = are_assumed);
}

/// Something has asked a question.
pub fn note_use() {
    if !IS_POSTING.get() {
        change_clients(|it| it.last_use = Some(Instant::now()));
    }
}

fn forget_idle_clients() {
    const IDLE: Duration = Duration::from_secs(30);
    change_clients(|it| it.last_use = it.last_use.filter(|it| it.elapsed() < IDLE));
}

pub fn read<R>(read: impl FnOnce(&Forest) -> R) -> R {
    FOREST.with_borrow(read)
}

/// The first question does not go without an answer.
pub fn wait_for_trees(window: u32) {
    const PATIENCE: Duration = Duration::from_millis(400);
    let is_complete = || read(|forest| forest.has_all_roots(window));
    if !is_active()
        || IS_POSTING.get()
        || is_complete()
        || !FOREST.with_borrow_mut(|it| it.note_waiting(window))
    {
        return;
    }
    if !thread::exists() {
        return host::deliver_events(Duration::ZERO);
    }
    let deadline = Instant::now() + PATIENCE;
    while !thread::is_answering() && !is_complete() && thread::wait_for_jobs(deadline) {
        thread::run_jobs();
    }
}

fn post(events: Vec<Event>) {
    if events.is_empty() {
        return;
    }
    RECORDED.with_borrow_mut(|recorded| {
        if let Some(recorded) = recorded {
            read(|forest| {
                recorded.extend(
                    cocoa::notifications(forest, &events)
                        .iter()
                        .map(|it| it.describe(forest)),
                )
            });
        }
    });
    if let Ok(platform) = host::platform() {
        IS_POSTING.set(true);
        platform.accessibility_changed(&events);
        IS_POSTING.set(false);
    }
}

/// # Safety
/// The contract of `abi::Renderer`.
pub unsafe fn submit(tree: u32, update: &abi::Update) {
    // SAFETY: the caller's contract.
    let update = unsafe { forest::Update::copy(update) };
    thread::post(move || {
        forget_idle_clients();
        if is_active() {
            windows_changed();
            post(FOREST.with_borrow_mut(|forest| forest.apply(tree, update)));
        }
    });
}

/// Which surfaces it has, where they are, or which one has the focus.
pub fn window_changed(state: &WindowState) {
    if !is_active() {
        return;
    }
    let (surfaces, mut roots) = (surface::in_window(state), Vec::new());
    for surface in &surfaces {
        let Ok(it) = surface.try_borrow() else { return };
        let tree = if it.image == 0 {
            it.id
        } else {
            it.image | TREE_OF_IMAGE
        };
        roots.extend(it.is_visible.then_some(forest::Root {
            surface: it.id,
            tree,
            rect: it.rect,
        }));
    }
    let is_active = state.is_active.get() || RECORDED.with_borrow(Option::is_some);
    post(FOREST.with_borrow_mut(|forest| {
        forest.set_roots(state.id, roots, state.focused_surface.get(), is_active)
    }));
}

pub fn windows_changed() {
    if is_active() {
        window::ids()
            .into_iter()
            .filter_map(|it| window::state(it).ok())
            .for_each(|it| window_changed(&it));
    }
}

pub fn window_closed(window: u32) {
    if is_active() {
        post(FOREST.with_borrow_mut(|forest| forest.remove_window(window)));
    }
}

pub fn surface_destroyed(surface: u32) {
    if is_active() {
        post(FOREST.with_borrow_mut(|forest| forest.remove_tree(surface)));
    }
}

pub fn image_closed(image: u32) {
    surface_destroyed(image | TREE_OF_IMAGE);
}

/// It tells how the caret is about to move.
pub fn key_pressed(code: &str, modifiers: u8) {
    if is_active() {
        FOREST.with_borrow_mut(|forest| {
            forest.last_key = Some((code.to_owned(), modifiers, Instant::now()))
        });
    }
}

pub fn perform(node: Id, action: Action, numbers: [u32; 4], text: &str) {
    let takes_focus = !matches!(action, Action::Blur | Action::ScrollIntoView);
    if takes_focus
        && let Some((window, surface)) =
            read(|forest| forest.place_of(node.tree)).map(|it| (it.0, it.1.surface))
        && let Ok(state) = window::state(window)
    {
        crate::input::focus(&state, Some(surface));
    }
    bridge::emit_input(
        node.tree,
        Input::Perform {
            node: node.node,
            action,
            numbers,
            text: text.into(),
            takes_focus,
        },
    );
}

/// From the anchor to the focus.
pub fn select_text([anchor, focus]: [text::Position; 2]) {
    let anchor = if anchor.node.tree == focus.node.tree {
        anchor
    } else {
        focus
    };
    perform(
        focus.node,
        Action::SelectText,
        [
            anchor.node.node,
            anchor.offset as u32,
            focus.node.node,
            focus.offset as u32,
        ],
        "",
    );
}

/// `listen`, `stop`, `notifications`, or what `cocoa::inspect` knows.
pub fn inspect(question: &str) -> String {
    match question.split_once(' ').unwrap_or((question, "")) {
        ("listen", _) => {
            RECORDED.set(Some(Vec::new()));
            set_clients(true, true);
            String::new()
        }
        ("stop", _) => {
            set_clients(false, false);
            RECORDED.set(None);
            String::new()
        }
        ("notifications", _) => RECORDED.with_borrow_mut(|it| {
            it.as_mut()
                .map(std::mem::take)
                .unwrap_or_default()
                .join("\n")
        }),
        (verb, rest) => cocoa::inspect(verb, rest).unwrap_or_else(|| "?".to_owned()),
    }
}

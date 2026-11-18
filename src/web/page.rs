//! All that a host says to the pages that it has. The other way round is in [`crate::host`].

use core::sync::atomic::{AtomicU32, Ordering};
use std::rc::Rc;

use bun_jsc::JSGlobalObject;

use crate::channel::Message;
use crate::host::{ContextMenu, HistoryEntry, Position, Rect, Reply, Wish};
use crate::input::Input;
use crate::wire::messages;
use crate::{dom, wire};

/// Without the extension.
pub fn file_of_frame(page: u32) -> String {
    format!("{page}~frame")
}

pub fn printed_from(page: u32) -> String {
    format!("https://{page}.page.print.invalid/")
}

wire! {
    /// What the response says about a document.
    #[derive(Clone, Default)]
    pub struct About {
        pub url: String,
        pub base_url: Option<String>,
        pub encoding: Option<String>,
        pub content_type: Option<String>,
        pub last_modified: Option<String>,
        pub language: Option<String>,
        /// The `Link` header
        pub links: Vec<u8>,
    }

    #[derive(Clone, Copy)]
    pub enum Swap {
        Push,
        Replace,
        Reload,
        Traverse,
    }

    #[derive(Clone)]
    pub enum Purpose {
        Print,
        Archive,
        /// The folders for the resources and for the pages in frames. See [`file_of_frame`].
        Save { resources: String, frames: String },
    }

    pub struct Resource {
        /// The one that refers to it.
        pub page: u32,
        pub url: String,
        pub destination: String,
        pub name: String,
    }

    #[derive(Default)]
    pub struct Snapshot {
        pub markup: String,
        pub resources: Vec<Resource>,
        /// The markup of the pages in frames, by their ids. See [`printed_from`].
        pub frames: Vec<(u32, String)>,
    }

    #[derive(Clone, Copy)]
    pub struct Search {
        pub is_forward: bool,
        pub goes_on: bool,
        pub matches_case: bool,
    }

    #[derive(Default)]
    pub struct Found {
        pub matches: u32,
        pub active: u32,
        pub area: Rect,
    }

    #[derive(Default)]
    pub enum Focused {
        #[default]
        Itself,
        /// One below it.
        Page(u32),
        /// A frame of the web engine, in that page.
        Guest { page: u32, frame: u32 },
    }

    /// For the element that has a frame.
    pub enum News {
        Loading,
        Navigating,
        Finished { fires_load: bool },
        Measure,
        UseWebEngine(String),
        ShowImage(String),
        Focus,
        /// With the number of frames in it.
        Loaded(u32),
        Painted(u32),
        Scroll([f64; 2]),
        Fullscreen(bool),
        Tab { is_backward: bool },
        Tooltip(String),
        /// `path` has the indices of the frames that lead to the sender.
        Message { path: Vec<u32>, origin: String, message: Message },
        /// Of a popup.
        Closed,
        Activated,
        Reveal([f64; 4]),
        Fit([f64; 2]),
    }

    /// Of a browsing context.
    #[derive(Clone)]
    pub enum Change {
        /// `frame` is what `embedder` calls it. It is in the group of `related`.
        Created { embedder: Option<u32>, parent: Option<u32>, frame: u32, image: u32, opener: Option<u32>, related: Option<u32> },
        /// `origin` is the same for the same origin, even an opaque one. `None` if it is in another process.
        Shows { page: u32, origin: Option<String>, is_initial: bool },
        /// For where its document is not.
        Children(Vec<u32>),
        /// `is_public` if it is a property of the window of the parent.
        Renamed { name: String, is_public: bool },
        OpenedBy(Option<u32>),
        Crashed,
        Closed,
        Discarded,
    }
}

impl wire::Message for Change {
    fn most_bytes(_: u16) -> usize {
        wire::SMALL
    }
}

pub trait Link {
    fn tell(&self, page: u32, order: Order);
    /// `reply` is called at most once.
    fn request(&self, page: u32, query: Query, reply: Reply<Option<Outcome>>);
    fn change(&self, context: u32, change: Change);
}

struct Here;

impl Link for Here {
    fn tell(&self, page: u32, order: Order) {
        dom::obey(page, order);
    }

    fn request(&self, page: u32, query: Query, reply: Reply<Option<Outcome>>) {
        reply(bun_ui::main_global(), dom::answer(page, query));
    }

    fn change(&self, context: u32, change: Change) {
        dom::change_context(context, change);
    }
}

struct Rehearsed;

impl Link for Rehearsed {
    fn tell(&self, page: u32, order: Order) {
        (wire::rehearse(order).into_iter()).for_each(|it| Here.tell(page, it));
    }

    fn request(&self, page: u32, query: Query, reply: Reply<Option<Outcome>>) {
        let outcome = wire::rehearse(query).and_then(|it| wire::rehearse(dom::answer(page, it)?));
        reply(bun_ui::main_global(), outcome);
    }

    fn change(&self, context: u32, change: Change) {
        (wire::rehearse(change).into_iter()).for_each(|it| Here.change(context, it));
    }
}

/// To the pages of this thread, which answer at once.
pub fn here() -> Rc<dyn Link> {
    match wire::is_rehearsed() {
        true => Rc::new(Rehearsed),
        false => Rc::new(Here),
    }
}

pub fn next_id() -> u32 {
    static LAST: AtomicU32 = AtomicU32::new(0);
    LAST.fetch_add(1, Ordering::Relaxed) + 1
}

#[derive(Clone)]
struct Address(Rc<dyn Link>, u32);

impl Address {
    fn tell(&self, order: Order) {
        self.0.tell(self.1, order);
    }

    fn request(&self, query: Query, reply: Reply<Option<Outcome>>) {
        self.0.request(self.1, query, reply);
    }
}

#[derive(Clone)]
pub struct Controls(Address);

impl Controls {
    pub fn new(link: Rc<dyn Link>, page: u32) -> Controls {
        Controls(Address(link, page))
    }
}

impl Order {
    pub fn makes_read_environment(&self) -> bool {
        matches!(
            self,
            Order::EnvironmentChanged {}
                | Order::FollowContainer { .. }
                | Order::Input {
                    input: Input::Resize { .. } | Input::Focus { .. } | Input::Blur { .. }
                }
        )
    }
}

impl Query {
    /// It runs no script of the page.
    pub fn is_harmless(&self) -> bool {
        matches!(
            self,
            Query::Find { .. }
                | Query::FocusedFrame {}
                | Query::HitInfo { .. }
                | Query::InsertSheet { .. }
                | Query::SelectionText {}
                | Query::Snapshot { .. }
        )
    }
}

messages! {
    impl Controls;
    tell Order {
        AbortNavigation = abort_navigation();
        /// As if the user had pressed something.
        Activate = activate();
        AdjustSelection = adjust_selection(start: i32, end: i32);
        ConsumeActivation = consume_activation();
        DictionaryChanged = dictionary_changed();
        Edit = edit(command: String);
        EndHtml = end_html(is_complete: bool);
        EnvironmentChanged = environment_changed();
        ExitFullscreen = exit_fullscreen();
        FireAtNotification = fire_at_notification(id: u32, event: String);
        /// In size, and if the element has the focus.
        FollowContainer = follow_container(takes_focus: bool);
        #[size = large]
        Frame = tell_frame(frame: u32, news: News);
        #[size = large]
        Input = input(input: Input);
        #[size = large]
        InsertText = insert_text(text: String);
        KeepEntries = keep_entries(keys: Vec<String>);
        #[size = large]
        LoadHtml = load_html(source: String, goes_on: bool);
        #[size = large]
        LoadXml = load_xml(source: String, content_type: String);
        /// `None` if the service has exited.
        #[size = large]
        Media = media(connection: u32, line: Option<Vec<u8>>);
        /// From a window in another process.
        #[size = large]
        Message = deliver(sender: u32, origin: String, token: String, message: Message);
        Moved = moved(position: Position);
        /// For another page.
        #[size = large]
        Navigate = navigate(wish: Box<Wish>, is_by_other_origin: bool);
        OnlineChanged = online_changed(is_online: bool);
        PopState = pop_state(url: String, key: Option<String>);
        PrintingChanged = printing_changed(is_over: bool);
        RemoveSheet = remove_sheet(key: u32);
        /// Another document for the same window.
        Renew = renew(about: About);
        ScrollVertically = scroll_vertically(top: f64);
        SetEncoding = set_encoding(name: String);
        SetUrl = set_url(url: String);
        /// Without a `load` event.
        StayEmpty = stay_empty();
        Stop = stop();
        StopFinding = stop_finding(keeps_selection: bool);
    }
    ask Query -> Outcome {}
    request {
        /// False if the document does not want more.
        #[size = large]
        AppendHtml = append_html(source: String) -> bool;
        /// True if the page wants to stay.
        BeforeUnload = before_unload() -> bool;
        Dispose = dispose() -> ();
        Find = find(text: String, search: Search) -> Found;
        FocusedFrame = focused_frame() -> Focused;
        #[size = large]
        HitInfo = hit_info(x: f64, y: f64) -> Option<Box<ContextMenu>>;
        #[size = large]
        InsertSheet = insert_sheet(css: String, is_of_user: bool) -> u32;
        /// What it looks like now can be captured afterwards.
        Render = render() -> ();
        #[size = large]
        SelectionText = selection_text() -> String;
        /// With its frames.
        #[size = large]
        Snapshot = snapshot(purpose: Purpose) -> Snapshot;
        /// `to` is `None` if the next document is of another origin. The result is what has been captured, or 0.
        #[size = large]
        WillSwap = will_swap(how: Swap, to: Option<Box<HistoryEntry>>) -> u32;
        /// False if the page stays where it is. It says `proceed(ticket)` when it is ready to go.
        WillTraverse = will_traverse(key: String, is_by_user: bool, ticket: u32) -> bool;
    }
}

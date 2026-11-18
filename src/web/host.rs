//! All that a page or a worker says to what hosts it. A message has no JS values, so the host can be on another thread or in
//! another process.

use bun_jsc::{JSGlobalObject, JSValue};

use crate::channel::{LooseBitmap, Message};
use crate::input::Input;
use crate::js_link::JsLink;
use crate::net::body::Blob;
use crate::permissions_policy::Feature;
use crate::remote;
use crate::wire;
use crate::wire::messages;

wire! {
    #[derive(Clone, Copy, PartialEq, Default)]
    pub struct Rect {
        pub x: f64,
        pub y: f64,
        pub width: f64,
        pub height: f64,
    }

    #[derive(Clone, Copy)]
    pub struct Display {
        pub bounds: Rect,
        pub work_area: Rect,
        pub color_depth: u32,
    }

    /// Lengths are in device-independent pixels.
    #[derive(Clone)]
    pub struct Environment {
        pub is_dark: bool,
        pub reduces_motion: bool,
        pub increases_contrast: bool,
        pub forces_colors: bool,
        pub reduces_transparency: bool,
        /// Behind selected text, as 0xRRGGBBAA
        pub light_highlight: u32,
        pub dark_highlight: u32,
        pub palette: Option<Palette>,
        pub touch_points: u32,
        pub display: Option<Display>,
        pub zoom: f64,
        pub is_active: bool,
        /// What scripts are told.
        pub is_visible: bool,
        pub is_drawn: bool,
        pub is_fullscreen: bool,
        pub is_transparent: bool,
        pub overlays_scrollbars: bool,
        pub titlebar_area: Option<Rect>,
        pub window_bounds: Option<Rect>,
        pub languages: Vec<String>,
        pub fonts: Option<std::sync::Arc<FontSettings>>,
        pub fixes_text_areas: bool,
        pub reports_paints: bool,
        pub reports_preferred_size: bool,
        /// If it is in another process.
        pub container: Option<Container>,
    }

    /// The element of a frame.
    #[derive(Clone, Default)]
    pub struct Container {
        pub origin: String,
        pub looks: Looks,
        pub forbids_scrolling: bool,
        pub is_object: bool,
        pub margins: [Option<String>; 2],
    }

    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub struct Looks {
        pub color_scheme: u32,
        pub is_inert: bool,
    }

    /// Of the viewport of a frame.
    #[derive(Clone, Copy, Default, PartialEq)]
    pub struct Position {
        /// In the viewport at the top.
        pub origin: [f64; 2],
        /// What is not clipped, in itself.
        pub shown: Option<[f64; 4]>,
    }

    /// As in `SystemSettings`.
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct Palette {
        pub colors: [u32; 8],
        pub is_for_contrast: bool,
    }

    #[derive(Clone, PartialEq)]
    pub struct FontSettings {
        pub size: f32,
        pub monospace_size: f32,
        pub minimum_size: f32,
        pub standard: Option<String>,
        /// What stands for a generic family.
        pub generic: Vec<(String, String)>,
    }
}

impl Default for Environment {
    fn default() -> Self {
        Environment {
            is_dark: false,
            reduces_motion: false,
            increases_contrast: false,
            forces_colors: false,
            reduces_transparency: false,
            light_highlight: 0xb3d7ffff,
            dark_highlight: 0x3f638bff,
            palette: None,
            touch_points: 0,
            display: None,
            zoom: 1.0,
            is_active: true,
            is_visible: true,
            is_drawn: true,
            is_fullscreen: false,
            is_transparent: false,
            overlays_scrollbars: cfg!(target_os = "macos"),
            titlebar_area: None,
            window_bounds: None,
            languages: Vec::new(),
            fonts: None,
            fixes_text_areas: false,
            reports_paints: false,
            reports_preferred_size: false,
            container: None,
        }
    }
}

wire! {
    #[derive(Clone)]
    pub struct Browser {
        pub user_agent: String,
        /// Of the Chromium that the user agent names.
        pub version: String,
    }
}

impl Default for Browser {
    fn default() -> Self {
        Browser {
            user_agent: bun_core::Global::user_agent.into(),
            version: String::new(),
        }
    }
}

keywords! {
    pub enum DialogKind {
        Alert = b"alert",
        Confirm = b"confirm",
        Prompt = b"prompt",
    }
}

keywords! {
    pub enum Level {
        Debug = b"debug",
        Info = b"info",
        Warning = b"warning",
        Error = b"error",
    }
}

wire! {
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub enum ConsoleAudience {
        #[default]
        Nobody,
        /// An inspector may come later.
        Posterity,
        App,
        AppAndPosterity,
        /// And the app.
        Inspector,
    }
}

keywords! {
    #[derive(Default)]
    pub enum Permission {
        #[default]
        Denied = b"denied",
        Granted = b"granted",
        Prompt = b"prompt",
    }
}

wire! {
    #[derive(Default)]
    pub enum DialogAnswer {
        #[default]
        Dismissed,
        Accepted,
        Text(String),
        Unsupported,
    }

    #[derive(Default, PartialEq, Eq)]
    pub enum Connection {
        #[default]
        Online,
        Offline,
    }

    pub struct EditFlags {
        pub can_undo: bool,
        pub can_redo: bool,
        pub can_cut: bool,
        pub can_copy: bool,
        pub can_paste: bool,
        pub can_edit_richly: bool,
    }

    pub struct ContextMenu {
        pub x: f64,
        pub y: f64,
        pub page_url: String,
        pub link_url: String,
        pub link_text: String,
        pub src_url: String,
        pub media_type: MediaType,
        pub alt_text: String,
        pub title_text: String,
        pub selection_text: String,
        pub is_editable: bool,
        pub input_field_type: String,
        pub form_control_type: String,
        pub edit_flags: EditFlags,
        pub misspelled_word: String,
        pub suggestions: Vec<String>,
    }

    pub struct FileChoice {
        pub is_multiple: bool,
        pub is_directory: bool,
        pub accept: Vec<String>,
    }

    #[derive(Clone)]
    pub struct Keystroke {
        pub is_down: bool,
        pub key: String,
        pub code: String,
        /// 0 leaves it to be derived.
        pub key_code: u32,
        pub location: u32,
        pub modifiers: u32,
        pub repeats: bool,
        pub is_composing: bool,
    }

    #[derive(Clone)]
    pub struct StateOfControl {
        pub control: String,
        pub state: String,
    }

    #[derive(Clone)]
    pub struct HistoryEntry {
        pub key: String,
        pub id: String,
        pub url: String,
        pub state: Option<Serialized>,
        pub navigation_state: Option<Serialized>,
        pub scroll: Option<[f64; 2]>,
        pub restores_scroll: bool,
        pub controls: std::sync::Arc<[StateOfControl]>,
        pub is_of_document: bool,
    }
}

impl HistoryEntry {
    /// One of the document, without names.
    pub fn of(url: String) -> HistoryEntry {
        HistoryEntry {
            key: String::new(),
            id: String::new(),
            url,
            state: None,
            navigation_state: None,
            scroll: None,
            restores_scroll: true,
            controls: Default::default(),
            is_of_document: true,
        }
    }
}

wire! {
    #[derive(Default)]
    pub struct HistoryEntries {
        pub entries: Vec<HistoryEntry>,
        pub index: u32,
    }
}

keywords! {
    pub enum HistoryChange {
        Push = b"push",
        Replace = b"replace",
        Update = b"update",
    }
}

wire! {
    /// What the document came with.
    #[derive(Clone, Default)]
    pub struct Arrival {
        pub loads_at_top: bool,
        pub has_text_activation: bool,
        pub text_directives: String,
    }

    /// How the document was reached.
    #[derive(Clone, Default)]
    pub struct Activation {
        pub kind: String,
        pub from: Option<HistoryEntry>,
        pub entry: Option<HistoryEntry>,
    }
}

wire! {
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub enum Source {
        #[default]
        Other,
        Form,
        Link,
        Script,
    }

    #[derive(Clone)]
    pub struct Post {
        pub content_type: String,
        pub body: std::sync::Arc<[u8]>,
    }

    /// To go somewhere else.
    #[derive(Clone, Default)]
    pub struct Wish {
        pub url: String,
        pub source: Source,
        pub replaces: bool,
        pub is_by_user: bool,
        pub has_activation: bool,
        pub has_text_activation: bool,
        pub may_unload: bool,
        pub download: Option<String>,
        pub srcdoc: Option<String>,
        /// What a `javascript:` URL has come to.
        pub markup: Option<String>,
        pub referrer_policy: Option<String>,
        pub navigation_state: Option<Serialized>,
        pub post: Option<Post>,
        /// The page that has asked for it, if it is another one.
        pub initiator: Option<u32>,
        /// What the element of the frame hears if a `javascript:` URL comes to nothing.
        pub fires_load_otherwise: Option<bool>,
        /// What a `blob:` URL stands for, in a process that the host has no part in.
        pub blob: Option<Blob>,
    }

    /// About a wish for another window.
    #[derive(Clone, Copy, Default)]
    pub enum Verdict {
        #[default]
        Refused,
        Granted,
        /// It is for the page in that window to go on, with all that the wish has.
        UpToPage,
        /// With nothing that is private to another origin.
        UpToForeignPage,
    }

    #[derive(Default)]
    pub enum Chosen {
        #[default]
        Nothing,
        Context { id: u32, verdict: Verdict },
    }

    #[derive(Default)]
    pub enum Opened {
        #[default]
        Nothing,
        /// A page in this process.
        Page(u32),
        Context(u32),
        /// It goes by the number that the page has given it.
        Popup,
    }

    #[derive(Default)]
    pub enum Traversal {
        #[default]
        Begun,
        Aborted,
        Forbidden,
        Impossible,
    }

    /// What matters of the element that has a frame.
    #[derive(Clone, Default)]
    pub struct Owner {
        pub kind: String,
        pub name: String,
        pub src: Option<String>,
        pub has_srcdoc: bool,
        pub sandbox: Option<String>,
        pub allow: Option<String>,
        pub allows_fullscreen: bool,
        pub csp: Option<String>,
        /// `window[index]` has it.
        pub is_indexed: bool,
        pub forbids_scrolling: bool,
        pub margins: [Option<String>; 2],
    }

    #[derive(Clone, Copy, Default, PartialEq)]
    pub struct Whereabouts {
        /// In the viewport that it is in.
        pub area: [f64; 4],
        /// In the viewport at the top.
        pub origin: [f64; 2],
        pub scale: f64,
    }

    /// For a frame that is not in the web engine.
    pub enum ToFrame {
        OwnerChanged(Box<Owner>),
        SetInitialUrl(String),
        Navigate { url: String, srcdoc: Option<String>, referrer_policy: String, blob: Option<Blob> },
        Place { size: [f64; 2], scale: f64, is_visible: bool },
        Stop,
        Remove,
        /// From here on, for a document in another process.
        Input(Input),
        Looks(Looks),
        Moved(Position),
        ExitFullscreen,
    }

    /// For the element of a frame, which is in another process.
    #[derive(Clone, Copy)]
    pub enum ToContainer {
        Focus,
        Scroll([f64; 2]),
        Reveal([f64; 4]),
        Tab { is_backward: bool },
        Fit([f64; 2]),
    }

    /// For a frame or a popup in the web engine.
    pub enum ToGuest {
        Navigate(Vec<(String, String)>),
        Attribute { name: String, value: Option<String> },
        Location { path: Vec<u32>, url: String, replaces: bool },
        Post { path: Vec<u32>, message: Message, target_origin: String },
        Place { size: [f64; 2], is_visible: bool, color_scheme: String, zoom: f64, whereabouts: Whereabouts },
        Moved(Whereabouts),
        Input(Input),
        Edit(String),
        ExitFullscreen,
        Focus,
        Close,
        Remove,
    }

    pub enum Relation {
        Top,
        Parent,
        Opener,
        FirstChild,
        NextSibling,
        Name(String),
        Token(String),
        /// In the same tree.
        Page(u32),
        /// In a frame that the page has found.
        Selected(u32),
    }

    pub struct Relative {
        pub page: u32,
        pub token: String,
    }

    pub struct Thrown {
        pub message: String,
        pub stack: Option<String>,
        /// For the terminal.
        pub description: String,
    }

    #[derive(Default)]
    pub struct Clipped {
        /// Types and texts.
        pub texts: Vec<(String, String)>,
        pub files: Vec<ChosenFile>,
        pub png: Option<Vec<u8>>,
    }
}

/// The path of a file that the user or the app has chosen, or only a name until it is dropped.
#[derive(Clone)]
pub struct ChosenFile(pub String);

impl wire::Wire for ChosenFile {
    fn write(self, to: &mut wire::Writer) {
        if let Some(peer) = to.peer()
            && bun_paths::is_absolute(self.0.as_bytes())
        {
            remote::grant(peer, self.0.as_bytes());
        }
        self.0.write(to);
    }

    fn read(from: &mut wire::Reader<'_>) -> wire::Result<ChosenFile> {
        let (path, peer) = (String::read(from)?, from.peer());
        match peer.is_none_or(|it| remote::is_granted(it, path.as_bytes())) {
            true => Ok(ChosenFile(path)),
            false => Ok(ChosenFile(String::new())),
        }
    }
}

/// A structured clone.
#[derive(Clone)]
pub struct Serialized(pub std::sync::Arc<[u8]>);

impl wire::Wire for Serialized {
    fn write(self, to: &mut wire::Writer) {
        to.put_bytes(&self.0);
    }

    fn read(from: &mut wire::Reader<'_>) -> wire::Result<Serialized> {
        let (bytes, is_trusted) = (from.take_bytes()?, from.peer() == Some(remote::HOST));
        match is_trusted || crate::channel::is_fit_for_storage(bytes) {
            true => Ok(Serialized(bytes.into())),
            false => Ok(Serialized(crate::channel::STORED_NULL.into())),
        }
    }
}

pub type Reply<T> = Box<dyn FnOnce(&JSGlobalObject, T)>;

keywords! {
    pub enum MediaType {
        None = b"none",
        Image = b"image",
        Video = b"video",
        Audio = b"audio",
        Canvas = b"canvas",
    }
}

wire! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Stage {
        Parsed,
        Loaded,
        Stopped,
    }
}

/// The messages arrive in the order in which they were sent.
pub trait Link {
    fn tell(&self, notice: Notice);
    /// Blocks.
    fn ask(&self, question: Question) -> Option<Answer>;
    /// `reply` is called on this thread, at most once.
    fn request(&self, question: Question, reply: Reply<Option<Answer>>);

    /// For an empty document in the realm of the page, which the host does not know.
    fn for_blank_frame(&self) -> Box<dyn Link> {
        Box::new(Nobody)
    }

    /// For the part of the inspector that is where the page is.
    fn inspect(&self, _: Logged<'_>) {}
}

/// A message of the console, or an `exception` with the text and what was thrown.
#[derive(Clone, Copy)]
pub struct Logged<'a> {
    /// The global object that the values are of.
    pub realm: JSValue,
    pub kind: &'a str,
    /// In milliseconds since 1970
    pub time: f64,
    /// The function, the URL, the script, the line and the column of each frame, or `undefined`.
    pub stack: JSValue,
    pub values: &'a [JSValue],
}

struct Nobody;

impl Link for Nobody {
    fn tell(&self, _: Notice) {}

    fn ask(&self, _: Question) -> Option<Answer> {
        None
    }

    fn request(&self, _: Question, reply: Reply<Option<Answer>>) {
        reply(bun_ui::main_global(), None);
    }
}

struct Rehearsed(Box<dyn Link>);

impl Link for Rehearsed {
    fn tell(&self, notice: Notice) {
        (wire::rehearse(notice).into_iter()).for_each(|it| self.0.tell(it));
    }

    fn ask(&self, question: Question) -> Option<Answer> {
        wire::rehearse(self.0.ask(wire::rehearse(question)?)?)
    }

    fn request(&self, question: Question, reply: Reply<Option<Answer>>) {
        let Some(question) = wire::rehearse(question) else {
            return reply(
                bun_jsc::virtual_machine::VirtualMachine::get().global(),
                None,
            );
        };
        let reply =
            |global: &JSGlobalObject, it: Option<_>| reply(global, it.and_then(wire::rehearse));
        self.0.request(question, Box::new(reply));
    }

    fn for_blank_frame(&self) -> Box<dyn Link> {
        Box::new(Rehearsed(self.0.for_blank_frame()))
    }

    fn inspect(&self, it: Logged<'_>) {
        self.0.inspect(it);
    }
}

pub struct Host(Box<dyn Link>);

impl Host {
    pub fn new(link: impl Link + 'static) -> Host {
        match wire::is_rehearsed() {
            true => Host(Box::new(Rehearsed(Box::new(link)))),
            false => Host(Box::new(link)),
        }
    }

    pub fn nobody() -> Host {
        Host(Box::new(Nobody))
    }

    pub fn of_blank_frame_in(page: &Host) -> Host {
        Host(page.0.for_blank_frame())
    }

    pub fn link(&self) -> &dyn Link {
        &*self.0
    }

    /// # Safety
    /// What owns the result keeps `host` alive.
    pub unsafe fn of(host: JSValue) -> Host {
        // SAFETY: up to the caller.
        Host::new(unsafe { JsLink::new(host) })
    }
}

messages! {
    impl Host;
    tell Notice {
        #[size = large]
        Console = console(level: Level, message: String, line: u32, url: String);
        Crashed = crashed();
        #[size = large]
        ContextMenu = context_menu(menu: Box<ContextMenu>);
        CloseNotification = close_notification(id: u32);
        Container = tell_container(message: ToContainer);
        CursorChanged = cursor_changed(cursor: String);
        FirstPaint = first_paint();
        FocusWindow = focus_window();
        /// For the service that has the speakers. `None` ends the connection.
        #[size = large]
        Media = media(connection: u32, commands: Option<Vec<u8>>);
        #[size = large]
        Inspected = inspected(session: u32, method: String, params: String);
        IconsChanged = icons_changed(urls: Vec<String>);
        MoveWindow = move_window(bounds: Rect);
        ShowNotification = show_notification(id: u32, title: String, body: String, is_silent: bool);
        Painted = painted();
        /// To a window in another process.
        #[size = large]
        Post = post(context: u32, message: Message, target_origin: String);
        PreferredSizeChanged = preferred_size_changed(width: f64, height: f64);
        Ping = ping(url: String, target: String);
        TargetUrlChanged = target_url_changed(url: String);
        ThemeColorChanged = theme_color_changed(color: Option<u32>);
        #[size = large]
        IpcSend = ipc_send(channel: String, message: Message, has_ports: bool);
        #[size = large]
        IpcInvoke = ipc_invoke(channel: String, message: Message, ticket: u32);
        #[size = large]
        Uncaught = uncaught(message: String, url: String, line: u32, column: u32, stack: String, is_rejection: bool);
    }
    ask Question -> Answer {
        Activated = activated() -> ();
        ActivatedByPreload = activated_by_preload() -> ();
        #[size = large]
        PreloadFailed = preload_failed(file: String, error: Thrown) -> ();
        /// One that is in the same process. `None` if `of` is gone.
        Relative = relative(of: u32, relation: Relation) -> Option<Option<Relative>>;
        /// The factor and the level.
        Zoom = zoom() -> [f64; 2];
        /// Returns why not.
        SetZoom = set_zoom(value: f64, is_level: bool) -> Option<String>;
        ActivationConsumed = activation_consumed() -> ();
        BaseUrlChanged = base_url_changed(url: String) -> ();
        #[size = large]
        ChooseWindow = choose_window(target: String, wish: Option<Box<Wish>>, becomes_opener: bool) -> Chosen;
        CloseWindow = close_window(context: u32) -> ();
        /// The page chooses the number, which means something only to the two of them.
        CreateFrame = create_frame(frame: u32, owner: Box<Owner>) -> ();
        CreateGuest = create_guest(frame: u32, scale: f64) -> ();
        Disown = disown() -> ();
        FocusOther = focus_other(context: u32) -> ();
        #[size = large]
        Frame = tell_frame(frame: u32, message: ToFrame) -> ();
        #[size = large]
        Guest = tell_guest(frame: u32, message: ToGuest) -> ();
        #[size = large]
        Navigate = navigate(wish: Box<Wish>) -> ();
        #[size = large]
        NavigateWindow = navigate_window(context: u32, wish: Box<Wish>) -> Verdict;
        #[size = large]
        Open = open(wish: Box<Wish>, target: String, features: String, popup: u32) -> Opened;
        Proceed = proceed(ticket: u32) -> ();
        SecurityPolicyAdded = security_policy_added(policy: String, is_own: bool) -> ();
        /// The empty document of a window that nothing has looked at yet.
        StartWindow = start_window(context: u32) -> ();
        #[size = large]
        Activation = activation() -> Option<Box<Activation>>;
        AllowsForm = allows_form(url: String) -> Option<bool>;
        AncestorOrigins = ancestor_origins() -> Vec<String>;
        Arrival = arrival() -> Arrival;
        CanPrint = can_print() -> bool;
        CancelNavigation = cancel_navigation() -> ();
        Close = close() -> ();
        HasWebEngine = has_web_engine() -> bool;
        #[size = large]
        HistoryChanged = history_changed(entry: HistoryEntry, change: HistoryChange) -> ();
        #[size = large]
        HistoryEntries = history_entries() -> Option<HistoryEntries>;
        HistoryLength = history_length() -> Option<u32>;
        IsActive = is_active() -> Option<bool>;
        IsClosed = is_closed() -> bool;
        IsInitial = is_initial() -> bool;
        IsBeingLeft = is_being_left() -> bool;
        IsOfApp = is_of_app(url: String) -> bool;
        IsSandboxed = is_sandboxed(missing_flag: String) -> bool;
        LoadsImages = loads_images() -> Option<bool>;
        Locale = locale() -> Option<String>;
        MayUnload = may_unload() -> Option<bool>;
        Name = name() -> Option<String>;
        Opened = opened() -> ();
        Origin = origin() -> Option<String>;
        Reload = reload() -> ();
        RestoresScroll = restores_scroll() -> bool;
        RunsScripts = runs_scripts() -> Option<bool>;
        SetName = set_name(name: String) -> ();
        Stop = stop() -> ();
        Traverse = traverse(delta: i32) -> bool;
        Browser = browser() -> Browser;
        Connection = connection() -> Connection;
        ConsoleAudience = console_audience() -> ConsoleAudience;
        #[size = large]
        Dialog = dialog(kind: DialogKind, message: String, initial: String) -> DialogAnswer;
        Environment = environment() -> Box<Environment>;
        InboundTransition = inbound_transition() -> u32;
        AllowsFeature = allows_feature(feature: Feature) -> Option<bool>;
        ChecksSpelling = checks_spelling() -> bool;
        CountFrames = count_frames(added: i32) -> u32;
        HasSpellChecker = has_spell_checker() -> bool;
        IsLocalFrame = is_local_frame(url: String) -> bool;
        OriginKey = origin_key() -> Option<String>;
        PaintedInFrame = painted_in_frame(scale: f64) -> ();
        SetFullscreen = set_fullscreen(is_on: bool) -> ();
        UnhandledKey = unhandled_key(key: Keystroke) -> ();
        Loaded = loaded(stage: Stage) -> ();
        Refresh = refresh() -> Option<String>;
        IsPopup = is_popup() -> bool;
        IsTabFocused = is_tab_focused() -> bool;
        Languages = languages() -> Vec<String>;
        SetReferrerPolicy = set_referrer_policy(policy: String) -> ();
        SetTitle = set_title(title: String) -> ();
        PermissionState = permission_state(name: String, media_type: Option<String>) -> Permission;
        StorageDirectory = storage_directory() -> Option<String>;
        Tab = tab() -> u32;
        #[size = large]
        ReadClipboard = read_clipboard(is_selection: bool) -> Clipped;
        #[size = large]
        WriteClipboard = write_clipboard(texts: Vec<(String, String)>, is_selection: bool) -> ();
    }
    request {
        PickFiles = pick_files(choice: FileChoice) -> Option<Vec<ChosenFile>>;
        #[size = large]
        CheckSpelling = check_spelling(text: Vec<u16>) -> Vec<[u32; 2]>;
        GuessSpelling = guess_spelling(word: String) -> Vec<String>;
        #[size = large]
        IpcSendSync = ipc_send_sync(channel: String, message: Message) -> Option<Result<Message, String>>;
        Microphone = microphone() -> Permission;
        Permission = permission(name: String) -> String;
        #[size = large]
        Print = print(markup_of_empty_frame: Option<String>) -> ();
        SystemVersion = system_version() -> String;
        TraverseTo = traverse_to(key: String) -> Traversal;
        #[size = large]
        WriteImage = write_image_to_clipboard(texts: Vec<(String, String)>, image: LooseBitmap) -> ();
    }
}

impl Rect {
    /// Where a window that a page moves ends up.
    pub fn moved_into(self, area: Rect) -> Rect {
        let (width, height) = (self.width.min(area.width), self.height.min(area.height));
        Rect {
            x: self.x.min(area.x + area.width - width).max(area.x),
            y: self.y.min(area.y + area.height - height).max(area.y),
            width,
            height,
        }
    }
}

impl Question {
    /// By a page in another process. What has no answer may have effects that the page counts on.
    pub fn is_waited_for(&self) -> bool {
        !matches!(
            self,
            Question::Activated {}
                | Question::ActivationConsumed {}
                | Question::BaseUrlChanged { .. }
                | Question::FocusOther { .. }
                | Question::Frame {
                    message: ToFrame::OwnerChanged(_)
                        | ToFrame::Place { .. }
                        | ToFrame::Input(_)
                        | ToFrame::Looks(_)
                        | ToFrame::Moved(_)
                        | ToFrame::ExitFullscreen,
                    ..
                }
                | Question::Guest { .. }
                | Question::PaintedInFrame { .. }
                | Question::PreloadFailed { .. }
                | Question::Reload {}
                | Question::SecurityPolicyAdded { .. }
                | Question::SetReferrerPolicy { .. }
                | Question::SetTitle { .. }
                | Question::UnhandledKey { .. }
                | Question::WriteClipboard { .. }
        )
    }

    /// If not now, then as soon as there is room on the stack.
    pub(crate) fn has_to_arrive(&self) -> bool {
        matches!(
            self,
            Question::CreateGuest { .. }
                | Question::Disown {}
                | Question::Guest { .. }
                | Question::HistoryChanged { .. }
                | Question::Loaded { .. }
                | Question::Opened {}
                | Question::SetFullscreen { is_on: false }
                | Question::SetName { .. }
        ) || matches!(self, Question::Frame { .. } if !self.is_answered_without_scripts())
    }

    /// What a page may do does not depend on the room that it has left on the stack.
    pub fn is_answered_without_scripts(&self) -> bool {
        matches!(
            self,
            Question::Activated {}
                | Question::ActivationConsumed {}
                | Question::AllowsFeature { .. }
                | Question::BaseUrlChanged { .. }
                | Question::AllowsForm { .. }
                | Question::AncestorOrigins {}
                | Question::CanPrint {}
                | Question::CountFrames { .. }
                | Question::IsActive {}
                | Question::IsClosed {}
                | Question::IsInitial {}
                | Question::IsSandboxed { .. }
                | Question::IsTabFocused {}
                | Question::LoadsImages {}
                | Question::Origin {}
                | Question::OriginKey {}
                | Question::RunsScripts {}
                | Question::SecurityPolicyAdded { .. }
                | Question::Frame {
                    message: ToFrame::OwnerChanged(_),
                    ..
                }
                | Question::SetReferrerPolicy { .. }
                | Question::Tab {}
        )
    }
}

const _: () = {
    const fn can_be_sent<T: Send>() {}
    can_be_sent::<(Notice, Question, Answer)>();
};

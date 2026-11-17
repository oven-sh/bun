//! All that a page or a worker says to what hosts it. A message has no JS values, so the host can be on another thread or in
//! another process.

use bun_jsc::{JSGlobalObject, JSValue};

use crate::js_link::JsLink;

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
    pub display: Option<Display>,
    pub zoom: f64,
    pub is_active: bool,
    pub is_visible: bool,
    pub is_fullscreen: bool,
    pub is_transparent: bool,
    pub overlays_scrollbars: bool,
    pub titlebar_area: Option<Rect>,
    pub window_bounds: Option<Rect>,
    pub languages: Vec<String>,
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
            display: None,
            zoom: 1.0,
            is_active: true,
            is_visible: true,
            is_fullscreen: false,
            is_transparent: false,
            overlays_scrollbars: cfg!(target_os = "macos"),
            titlebar_area: None,
            window_bounds: None,
            languages: Vec::new(),
        }
    }
}

#[derive(Clone)]
pub struct Browser {
    pub user_agent: String,
    /// Of the Chromium that the user agent names.
    pub version: String,
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

#[derive(Default, PartialEq, Eq)]
pub enum ConsoleAudience {
    #[default]
    Nobody,
    App,
    /// And the app.
    Inspector,
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
    pub media_type: &'static str,
    pub alt_text: String,
    pub title_text: String,
    pub selection_text: String,
    pub is_editable: bool,
    pub input_field_type: &'static str,
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
    pub location: u32,
    pub modifiers: u32,
    pub repeats: bool,
    pub is_composing: bool,
}

/// A structured clone.
#[derive(Clone)]
pub struct Serialized(pub std::sync::Arc<[u8]>);

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

#[derive(Default)]
pub struct HistoryEntries {
    pub entries: Vec<HistoryEntry>,
    pub index: u32,
}

keywords! {
    pub enum HistoryChange {
        Push = b"push",
        Replace = b"replace",
        Update = b"update",
    }
}

/// What the document came with.
#[derive(Default)]
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

pub type Reply<T> = Box<dyn FnOnce(&JSGlobalObject, T)>;

/// The messages arrive in the order in which they were sent.
pub trait Link {
    fn tell(&self, notice: Notice);
    /// Blocks.
    fn ask(&self, question: Question) -> Option<Answer>;
    /// `reply` is called on this thread, at most once.
    fn request(&self, question: Question, reply: Reply<Option<Answer>>);
}

pub struct Host(Box<dyn Link>);

impl Host {
    pub fn new(link: impl Link + 'static) -> Host {
        Host(Box::new(link))
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

macro_rules! messages {
    (
        tell { $($Notice:ident = $tell:ident ($($n:ident: $N:ty),*);)* }
        ask { $($Asked:ident = $ask:ident ($($a:ident: $A:ty),*) -> $AskedFor:ty;)* }
        request { $($Requested:ident = $request:ident ($($r:ident: $R:ty),*) -> $RequestedFor:ty;)* }
    ) => {
        pub enum Notice {
            $($Notice { $($n: $N),* },)*
        }

        pub enum Question {
            $($Asked { $($a: $A),* },)*
            $($Requested { $($r: $R),* },)*
        }

        pub enum Answer {
            $($Asked($AskedFor),)*
            $($Requested($RequestedFor),)*
        }

        impl Host {
            $(pub fn $tell(&self, $($n: $N),*) {
                self.0.tell(Notice::$Notice { $($n),* });
            })*

            $(pub fn $ask(&self, $($a: $A),*) -> $AskedFor {
                match self.0.ask(Question::$Asked { $($a),* }) {
                    Some(Answer::$Asked(answer)) => answer,
                    _ => Default::default(),
                }
            })*

            $(pub fn $request(&self, $($r: $R,)* reply: impl FnOnce(&JSGlobalObject, $RequestedFor) + 'static) {
                let reply = move |global: &JSGlobalObject, answer| match answer {
                    Some(Answer::$Requested(answer)) => reply(global, answer),
                    _ => reply(global, Default::default()),
                };
                self.0.request(Question::$Requested { $($r),* }, Box::new(reply));
            })*
        }
    };
}

messages! {
    tell {
        Console = console(level: Level, message: String, line: u32, url: String);
        Crashed = crashed();
        ContextMenu = context_menu(menu: Box<ContextMenu>);
        CloseNotification = close_notification(id: u32);
        FirstPaint = first_paint();
        FocusWindow = focus_window();
        IconsChanged = icons_changed(urls: Vec<String>);
        MoveWindow = move_window(bounds: Rect);
        ShowNotification = show_notification(id: u32, title: String, body: String, is_silent: bool);
        Ping = ping(url: String, target: String);
        TargetUrlChanged = target_url_changed(url: String);
        ThemeColorChanged = theme_color_changed(color: String);
        Uncaught = uncaught(message: String, url: String, line: u32, column: u32, stack: String, is_rejection: bool);
    }
    ask {
        AddSecurityPolicy = add_security_policy(policy: String) -> ();
        Activation = activation() -> Option<Box<Activation>>;
        AllowsForm = allows_form(url: String) -> Option<bool>;
        AncestorOrigins = ancestor_origins() -> Vec<String>;
        Arrival = arrival() -> Arrival;
        CanPrint = can_print() -> bool;
        CancelNavigation = cancel_navigation() -> ();
        Close = close() -> ();
        HasWebEngine = has_web_engine() -> bool;
        HistoryChanged = history_changed(entry: HistoryEntry, change: HistoryChange) -> ();
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
        Dialog = dialog(kind: DialogKind, message: String, initial: String) -> DialogAnswer;
        Environment = environment() -> Box<Environment>;
        InboundTransition = inbound_transition() -> u32;
        AllowsFeature = allows_feature(feature: &'static str) -> Option<bool>;
        BeforeInput = before_input(key: Keystroke) -> bool;
        ChecksSpelling = checks_spelling() -> bool;
        CountFrames = count_frames(added: i32) -> u32;
        HasSpellChecker = has_spell_checker() -> bool;
        IsLocalFrame = is_local_frame(url: String) -> bool;
        OriginKey = origin_key() -> Option<String>;
        PaintedInFrame = painted_in_frame(scale: f64) -> ();
        SetFullscreen = set_fullscreen(is_on: bool) -> ();
        UnhandledKey = unhandled_key(key: Keystroke) -> ();
        Loaded = loaded(stage: &'static str) -> ();
        Refresh = refresh() -> Option<String>;
        IsPopup = is_popup() -> bool;
        Languages = languages() -> Vec<String>;
        SetReferrerPolicy = set_referrer_policy(policy: String) -> ();
        SetTitle = set_title(title: String) -> ();
        PermissionState = permission_state(name: String, media_type: Option<String>) -> Permission;
        StorageDirectory = storage_directory() -> Option<String>;
        Tab = tab() -> u32;
    }
    request {
        PickFiles = pick_files(choice: FileChoice) -> Option<Vec<String>>;
        Microphone = microphone() -> Permission;
        Permission = permission(name: String) -> String;
        Print = print(base_url: String, markup: String) -> ();
        SystemVersion = system_version() -> String;
    }
}

impl Question {
    /// What a page may do does not depend on the room that it has left on the stack.
    pub(crate) fn is_answered_without_scripts(&self) -> bool {
        matches!(
            self,
            Question::AllowsFeature { .. }
                | Question::AllowsForm { .. }
                | Question::AncestorOrigins {}
                | Question::CanPrint {}
                | Question::CountFrames { .. }
                | Question::IsActive {}
                | Question::IsClosed {}
                | Question::IsInitial {}
                | Question::IsSandboxed { .. }
                | Question::LoadsImages {}
                | Question::Origin {}
                | Question::OriginKey {}
                | Question::RunsScripts {}
                | Question::SetReferrerPolicy { .. }
                | Question::Tab {}
        )
    }
}

const _: () = {
    const fn can_be_sent<T: Send>() {}
    can_be_sent::<(Notice, Question, Answer)>();
};

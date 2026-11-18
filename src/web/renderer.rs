//! What a host tells the half of it that is where the page is, and has the realms of the document.

use std::rc::Rc;

use bun_jsc::JSGlobalObject;

use crate::channel::{LooseBitmap, Message};
use crate::client::{Seed, Update};
use crate::host::{Activation, Arrival, ChosenFile, Environment, HistoryEntries, Reply, Thrown};
use crate::input::Extent;
use crate::page::About;
use crate::scheme::Privileges;
use crate::trust::Trust;
use crate::wire::{self, messages};
use crate::{Bytes, compiled, scheme, trust};

crate::wire! {
    pub enum Source {
        Compiled(Vec<u8>),
        Text(String),
        Unreadable(Thrown),
    }

    pub struct PreloadScript {
        pub file: String,
        pub source: Source,
    }

    pub struct Preloads {
        pub scripts: Vec<PreloadScript>,
        pub process: u32,
        pub is_main_frame: bool,
        pub is_sandboxed: bool,
        pub integrates_node: bool,
        pub document_path: String,
        pub additional_arguments: Vec<String>,
        /// Of the host, if it is another process.
        pub environment: Option<Vec<(String, String)>>,
    }

    pub struct NewDocument {
        pub context: u32,
        pub surface: u32,
        pub has_relatives: bool,
        pub isolates_context: bool,
        pub about: About,
        /// The page that lends its realm.
        pub opener: Option<u32>,
    }

    /// What a page in another process need not ask for while it has the same document.
    pub struct Facts {
        pub has_spell_checker: bool,
        pub is_at_top: bool,
        pub loads_images: bool,
        pub runs_scripts: bool,
        pub tab: u32,
        /// Not for the empty document at the beginning.
        pub origins: Option<Origins>,
    }

    pub struct Origins {
        pub activation: Option<Box<Activation>>,
        pub arrival: Arrival,
        /// Until the page hears of a change.
        pub history: Option<HistoryEntries>,
        pub inbound_transition: u32,
        pub refresh: Option<String>,
        pub restores_scroll: bool,
    }

    /// For the order that follows.
    pub struct Conditions {
        pub environment: Box<Environment>,
        /// What a page is waiting for overtakes what has been sent before.
        pub number: u32,
    }

    pub struct Start {
        pub client: Box<Seed>,
        pub document: NewDocument,
        /// Of the surface.
        pub extent: Option<Extent>,
        pub preloads: Option<Box<Preloads>>,
        pub facts: Facts,
        pub conditions: Option<Conditions>,
        pub is_online: Option<bool>,
    }

    pub enum Executed {
        Fulfilled(Message),
        Rejected(Message),
        Threw,
    }

    /// What holds for all pages.
    pub struct Statics {
        trust: Trust,
        has_sandbox_for_the_rest: bool,
        schemes: Vec<(Bytes, u8)>,
        compiled: compiled::Settings,
        pub resources_path: String,
        pub is_accessibility_active: bool,
        pub has_screen_reader: bool,
        pub is_headless: bool,
        pub tracing: Option<Tracing>,
    }

    pub struct Tracing {
        pub categories: Vec<String>,
        pub room: u32,
    }
}

impl wire::Message for Statics {
    fn most_bytes(_: u16) -> usize {
        wire::LARGE
    }
}

impl Statics {
    /// With `is_like_browser` pages run the scripts that they like.
    pub fn new(resources_path: String, is_like_browser: bool) -> Statics {
        let (trust, compiled) = match is_like_browser {
            true => (Trust::in_everything(), Default::default()),
            false => (trust::current(), compiled::settings()),
        };
        Statics {
            trust,
            has_sandbox_for_the_rest: trust::has_sandbox_for_the_rest(),
            schemes: (scheme::registered().into_iter())
                .map(|it| (it.0, it.1.bits()))
                .collect(),
            compiled,
            resources_path,
            is_accessibility_active: bun_ui::surfaces::is_accessibility_active(),
            has_screen_reader: bun_ui::surfaces::has_screen_reader(),
            is_headless: false,
            tracing: None,
        }
    }

    pub fn adopt(&self) {
        bun_ui::set_app_headless(self.is_headless);
        trust::replace(self.trust.clone());
        trust::set_sandbox_for_the_rest(self.has_sandbox_for_the_rest);
        compiled::replace(self.compiled.clone());
        (self.schemes.iter())
            .for_each(|it| scheme::register(&it.0, Privileges::from_bits_retain(it.1)));
    }
}

pub trait Link {
    fn tell(&self, page: u32, command: Command);
    /// `reply` is called at most once.
    fn request(&self, page: u32, task: Task, reply: Reply<Option<Done>>);
}

struct Address(Rc<dyn Link>, u32);

impl Address {
    fn tell(&self, command: Command) {
        self.0.tell(self.1, command);
    }

    fn request(&self, task: Task, reply: Reply<Option<Done>>) {
        self.0.request(self.1, task, reply);
    }
}

pub struct Renderer(Address);

impl Renderer {
    pub fn new(link: Rc<dyn Link>, page: u32) -> Renderer {
        Renderer(Address(link, page))
    }
}

messages! {
    impl Renderer;
    tell Command {
        /// Makes the realm and the empty document, and runs the preload scripts.
        #[size = large]
        Start = start(how: Box<Start>);
        DocumentChanged = document_changed();
        #[size = large]
        Foretell = foretell(facts: Box<Facts>);
        #[size = large]
        Prepare = prepare(conditions: Conditions);
        Dispose = dispose();
        #[size = large]
        UpdateClient = update_client(update: Update);
        #[size = large]
        Send = send(channel: String, message: Message);
        #[size = large]
        Reply = reply(ticket: u32, result: Result<Message, String>);
        #[size = large]
        Inspect = inspect(session: u32, how: String);
        StopInspecting = stop_inspecting(session: u32);
    }
    ask Task -> Done {}
    request {
        #[size = large]
        Execute = execute(world: u32, code: Vec<u16>, is_by_user: bool) -> Option<Executed>;
        #[size = large]
        AskInspector = ask_inspector(session: u32, method: String, params: String, files: Vec<ChosenFile>)
            -> Option<Result<String, String>>;
        #[size = large]
        DecodeImage = decode_image(bytes: Vec<u8>) -> Option<LooseBitmap>;
        Render = render() -> ();
        /// A list in JSON.
        #[size = large]
        FinishTrace = finish_trace() -> String;
        #[size = large]
        TakeHeapSnapshot = take_heap_snapshot() -> Option<String>;
    }
}

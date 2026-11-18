//! What a host tells the half of it that is where the page is, and has the realms of the document.

use std::rc::Rc;

use bun_jsc::JSGlobalObject;

use crate::channel::Message;
use crate::client::{Seed, Update};
use crate::host::{Reply, Thrown};
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

    pub struct Start {
        pub client: Box<Seed>,
        pub document: NewDocument,
        /// Of the surface.
        pub extent: Option<Extent>,
        pub preloads: Option<Box<Preloads>>,
    }

    pub enum Executed {
        Fulfilled(Message),
        Rejected(Message),
        Threw,
    }

    /// What holds for all pages.
    pub struct Statics {
        trust: Trust,
        schemes: Vec<(Bytes, u8)>,
        compiled: compiled::Settings,
        pub switches: Vec<(String, String)>,
        pub resources_path: String,
        pub is_accessibility_active: bool,
        pub has_screen_reader: bool,
    }
}

impl wire::Message for Statics {
    fn most_bytes(_: u16) -> usize {
        wire::LARGE
    }
}

impl Statics {
    pub fn new(switches: Vec<(String, String)>, resources_path: String) -> Statics {
        Statics {
            trust: trust::current(),
            schemes: (scheme::registered().into_iter())
                .map(|it| (it.0, it.1.bits()))
                .collect(),
            compiled: compiled::settings(),
            switches,
            resources_path,
            is_accessibility_active: bun_ui::surfaces::is_accessibility_active(),
            has_screen_reader: bun_ui::surfaces::has_screen_reader(),
        }
    }

    pub fn adopt(&self) {
        trust::replace(self.trust.clone());
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
        Dispose = dispose();
        #[size = large]
        UpdateClient = update_client(update: Update);
        #[size = large]
        Send = send(channel: String, message: Message);
        #[size = large]
        Reply = reply(ticket: u32, result: Result<Message, String>);
    }
    ask Task -> Done {}
    request {
        #[size = large]
        Execute = execute(world: u32, code: Vec<u16>, is_by_user: bool) -> Option<Executed>;
    }
}

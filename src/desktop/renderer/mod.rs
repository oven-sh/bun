//! The realms of a document, in the process that has the page. What is here knows the app by messages.

pub(crate) mod far;
pub(crate) mod preload;

use std::rc::Rc;

use bun_collections::HashMap;
use bun_jsc::{JSMap, Strong, from_js_host_call, from_js_host_call_generic};
use bun_web::channel::{Endpoint, LooseBitmap, Message, Serialized, Transferred};
use bun_web::client::Client;
use bun_web::compiled::PRELOAD_PARAMETERS;
use bun_web::dom::{self, Opening};
use bun_web::exec::{Settled, settled, with_realm};
use bun_web::host::{Host, Reply, Thrown};
use bun_web::page::Order;
use bun_web::realm::Realm as OfTheWeb;
use bun_web::renderer::{Command, Done, Executed, NewDocument, Preloads, Source, Task};

use self::preload::Preload;
use crate::devtools::agent;
use crate::generated_bindgen::renderer::js_RendererDocument as fields;
use crate::prelude::*;
use crate::realm::{self, Realm};
use crate::webview::wire;
use crate::{files, process, task};

const OF_PRELOAD: u32 = 999;

/// `WebGlobalObject::NodeGlobals`
#[derive(Clone, Copy)]
#[repr(u8)]
enum NodeGlobals {
    None,
    OfPreload,
    OfNodeIntegration,
}

unsafe extern "C" {
    safe fn Bun__DesktopRealm__createWindow(
        global: &Realm,
        client: u32,
        is_secure: bool,
        is_isolated: bool,
        runs_program: bool,
        node: NodeGlobals,
        window: JSValue,
        page: Option<&Realm>,
    ) -> Option<&'static Realm>;
    safe fn Bun__DesktopRealm__setUpMembers(realm: &Realm);
    safe fn Bun__DesktopRealm__run(realm: &Realm);
    safe fn Bun__DesktopRealm__members(realm: &Realm) -> JSValue;
    safe fn Bun__DesktopRealm__inject(
        realm: &Realm,
        source: JSValue,
        window: JSValue,
        awaits: bool,
    ) -> JSValue;
    safe fn Bun__DesktopRealm__documentChanged(realm: &Realm);
    safe fn Bun__DesktopRealm__dispose(realm: &Realm, is_reachable: bool);
    safe fn Bun__WebRealm__runCompiled(
        realm: &Realm,
        path: &bun_core::String,
        is_synchronous: bool,
    ) -> JSValue;
    safe fn Bun__DOM__reportException(realm: &Realm, value: JSValue, exception: JSValue);
    safe fn Bun__IsolatedWorld__carry(from: &Realm, to: &Realm, value: JSValue) -> JSValue;
    safe fn Bun__RealmBridge__keep(object: JSValue) -> JSValue;
    safe fn Bun__RealmBridge__clone(
        global: &Realm,
        value: JSValue,
        transfer: JSValue,
        to: &Realm,
    ) -> JSValue;
}

fn clone(value: JSValue, transfer: JSValue, to: &Realm) -> JsResult<JSValue> {
    from_js_host_call(global(), || {
        Bun__RealmBridge__clone(global(), value, transfer, to)
    })
}

/// The namespace of the module.
pub(crate) fn run_compiled(realm: &Realm, path: &[u8]) -> JsResult<JSValue> {
    let path = bun_core::String::clone_utf8(path);
    from_js_host_call(realm, || Bun__WebRealm__runCompiled(realm, &path, true))
}

/// What the app gets for a value of a page.
pub(crate) fn handle_of(value: JSValue) -> JSValue {
    match value.is_object() {
        true => Bun__RealmBridge__keep(value),
        false => value,
    }
}

/// The values that it takes and gives are those of `realm`. The page keeps it alive.
#[derive(Clone, Copy)]
pub(crate) struct World {
    pub(crate) realm: &'static Realm,
    pub(crate) window: JSValue,
    /// The realm is that of the opener.
    is_borrowed: bool,
}

impl World {
    fn of(realm: &'static Realm) -> World {
        World {
            realm,
            window: OfTheWeb::of(realm).map_or(JSValue::UNDEFINED, OfTheWeb::global_this),
            is_borrowed: false,
        }
    }

    fn inject(self, source: JSValue, awaits: bool) -> JsResult<JSValue> {
        let window = field(self.is_borrowed.then_some(self.window));
        from_js_host_call(self.realm, || {
            Bun__DesktopRealm__inject(self.realm, source, window, awaits)
        })
    }

    pub(crate) fn evaluate(self, source: JSValue) -> JsResult<JSValue> {
        self.inject(source, false)
    }

    pub(crate) fn carry(self, value: JSValue, to: World) -> JsResult<JSValue> {
        match value.is_object() {
            true => from_js_host_call(self.realm, || {
                Bun__IsolatedWorld__carry(self.realm, to.realm, value)
            }),
            false => Ok(value),
        }
    }
}

type Step = fn(&Realm, u64, &[JSValue]) -> JsResult<()>;

/// For an app on this thread, which gets copies in its realm. What comes first is [`Links::owner`].
pub(crate) struct Nearby {
    /// With the channel, the values and the ports.
    pub(crate) send: Step,
    /// With the channel, the values, and two more for [`Preload::reply`].
    pub(crate) invoke: Step,
    pub(crate) send_and_wait: fn(JSValue, JSValue, JSValue) -> JsResult<JSValue>,
    pub(crate) wrap_ports: fn(Vec<Endpoint>) -> JsResult<JSValue>,
}

pub(crate) struct Links {
    pub(crate) client: Rc<Client>,
    pub(crate) of_window: Host,
    pub(crate) of_preload: Host,
    /// What has to be alive for them.
    pub(crate) needed: [JSValue; 2],
    pub(crate) nearby: Option<&'static Nearby>,
    pub(crate) owner: JSValue,
}

pub(crate) struct State {
    id: u32,
    client: Rc<Client>,
    host: Host,
    nearby: Option<&'static Nearby>,
    isolates_context: bool,
    opener: Option<u32>,
}

pub(crate) struct Document(Box<State>, #[expect(dead_code)] HasFields);

impl core::ops::Deref for Document {
    type Target = State;

    fn deref(&self) -> &State {
        &self.0
    }
}

state!(fn documents() -> RefCell<HashMap<u32, Root<Document>>>);

fn field(value: Option<JSValue>) -> JSValue {
    value.unwrap_or(JSValue::UNDEFINED)
}

fn object_in(value: Option<JSValue>) -> Option<JSValue> {
    value.filter(|it| it.is_object())
}

pub(crate) fn describe(thrown: JSValue) -> JsResult<Thrown> {
    let stack = thrown
        .is_object()
        .then(|| get(thrown, "stack"))
        .transpose()?;
    Ok(Thrown {
        message: message_of(thrown)?,
        stack: stack.filter(|it| it.is_string()).map(text_of).transpose()?,
        description: process::inspect(thrown)?,
    })
}

pub(crate) fn failed_to_execute() -> bun_jsc::JsError {
    error(format_args!(
        "Script failed to execute, this normally means an error was thrown. Check the renderer console for the error."
    ))
}

pub(crate) fn ports_in(all: Vec<Transferred>) -> Vec<Endpoint> {
    let port = |it| match it {
        Transferred::Port(it) => Some(it),
        _ => None,
    };
    all.into_iter().filter_map(port).collect()
}

/// All but [`Command::Start`].
pub(crate) fn obey(page: u32, command: Command) -> JsResult<()> {
    let Some(it) = Document::of(page) else {
        return Ok(());
    };
    match command {
        Command::Start { .. } | Command::Foretell { .. } | Command::Prepare { .. } => Ok(()),
        Command::DocumentChanged {} => it.changed(),
        Command::Dispose {} => {
            agent::far::forget(page);
            it.dispose()
        }
        Command::UpdateClient { update } => {
            it.client.apply(update);
            Ok(())
        }
        Command::Send { channel, message } => {
            fields::preload(it).map_or(Ok(()), |it| it.accept(&channel, message))
        }
        Command::Reply { ticket, result } => {
            fields::preload(it).map_or(Ok(()), |it| it.accept_reply(ticket, result))
        }
        Command::Inspect { session, how } => agent::far::begin(page, session, &how),
        Command::StopInspecting { session } => {
            agent::far::end(session);
            Ok(())
        }
    }
}

fn pack(outcome: Result<Strong, Strong>) -> JsResult<Executed> {
    let pack = |it| Serialized::new(global(), it, &[], &[]).map(Message::from);
    Ok(match outcome {
        Ok(value) => match catch(pack(value.get()))? {
            Ok(message) => Executed::Fulfilled(message),
            Err(thrown) => Executed::Rejected(pack(thrown)?),
        },
        Err(thrown) => match catch(pack(thrown.get()))? {
            Ok(message) => Executed::Rejected(message),
            Err(thrown) => Executed::Rejected(pack(thrown)?),
        },
    })
}

pub(crate) fn perform(page: u32, task: Task, reply: Reply<Option<Done>>) {
    let (world, code, is_by_user) = match task {
        Task::Execute {
            world,
            code,
            is_by_user,
        } => (world, code, is_by_user),
        Task::AskInspector {
            session,
            method,
            params,
            files: _,
        } => {
            return task::spawn(async move {
                let result = agent::far::run(session, &method, &params).await;
                reply(global(), Some(Done::AskInspector(Some(result))));
            });
        }
        Task::DecodeImage { bytes } => {
            return task::spawn(async move {
                let image = LooseBitmap::decode(bytes).await;
                reply(global(), Some(Done::DecodeImage(image)));
            });
        }
        Task::Render {} => {
            render_pages();
            return reply(global(), Some(Done::Render(())));
        }
        Task::FinishTrace {} => {
            let events = crate::tracing::finish_for_app();
            return reply(global(), Some(Done::FinishTrace(events)));
        }
        Task::TakeHeapSnapshot {} => {
            let snapshot = Some(crate::process::heap_snapshot());
            return reply(global(), Some(Done::TakeHeapSnapshot(snapshot)));
        }
    };
    let begin = || {
        let code = bun_jsc::bun_string_jsc::owned_utf16_into_js(global(), code)?;
        (Document::of(page).ok_or_else(disposed)?).begin(world, code, is_by_user)
    };
    let begun = catch(begin());
    task::spawn(async move {
        let executed = match begun {
            Ok(Ok(Some(settled))) => catch(pack(settled.await)).ok().and_then(Result::ok),
            Ok(Ok(None)) => Some(Executed::Threw),
            _ => None,
        };
        reply(global(), Some(Done::Execute(executed)));
    });
}

impl Document {
    /// Until it is disposed.
    pub(crate) fn of(page: u32) -> Option<&'static Document> {
        documents().borrow().get(&page).map(Root::get)
    }

    pub(crate) fn origin(&self) -> String {
        string(self.client.origin().as_bytes())
    }

    /// `undefined` if there is no document.
    pub(crate) fn inspect(&self, method: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
        let Some(controller) = object_in(fields::controller(self)) else {
            return Ok(JSValue::UNDEFINED);
        };
        if object_in(fields::inspected(self)).is_none() {
            let methods = realm::methods_of(Bun__RealmBridge__keep(controller))?;
            fields::set_inspected(self, methods);
        }
        invoke(field(fields::inspected(self)), method, arguments)
    }

    fn worlds(&self) -> JSValue {
        if object_in(fields::worlds(self)).is_none() {
            fields::set_worlds(self, JSMap::create(global()));
        }
        field(fields::worlds(self))
    }

    fn owner(&self) -> JSValue {
        field(fields::owner(self))
    }

    fn adopt_port(&self, port: Endpoint) -> JsResult<JSValue> {
        let main = self.world_with_id(0)?;
        main.carry(dom::adopt_port(main.realm, port), self.world_of_preload()?)
    }

    fn release_port(&self, port: JSValue) -> JsResult<Option<Endpoint>> {
        let main = self.world_with_id(0)?;
        let port = self.world_of_preload()?.carry(port, main)?;
        Ok(dom::release_port(main.realm, port))
    }

    fn isolated_worlds(&self) -> JsResult<Vec<u32>> {
        let ids = elements(wire::items_of(self.worlds())?)?
            .into_iter()
            .step_by(2);
        let ids = ids.map(|it| it.as_number() as u32);
        Ok(ids.filter(|it| *it > OF_PRELOAD).collect())
    }

    fn known_realm(&self, id: u32) -> JsResult<Option<&'static Realm>> {
        let Some(worlds) = object_in(fields::worlds(self)) else {
            return Ok(None);
        };
        Ok(object_in(Some(map_in(worlds).get(global(), js(id)?)?)).map(realm::of))
    }

    fn for_each_realm(&self, mut step: impl FnMut(&Realm)) -> JsResult<()> {
        let Some(worlds) = object_in(fields::worlds(self)) else {
            return Ok(());
        };
        with_elements(wire::items_of(worlds)?, |all| {
            (all.iter().skip(1).step_by(2)).for_each(|it| step(realm::of(*it)));
            Ok(())
        })
    }

    /// By the ids of `executeJavaScriptInIsolatedWorld()`. 0 is the one of the page.
    pub(crate) fn world_with_id(&self, id: u32) -> JsResult<World> {
        self.find_or_create_world(id, NodeGlobals::None)
    }

    fn world_of_preload(&self) -> JsResult<World> {
        self.world_with_id(if self.isolates_context { OF_PRELOAD } else { 0 })
    }

    /// `window` is the object to take over.
    fn create_realm(
        &self,
        id: u32,
        node: NodeGlobals,
        is_for_preload: bool,
        window: JSValue,
        page: Option<&Realm>,
    ) -> JsResult<&'static Realm> {
        let is_isolated = page.is_none() && self.client.is_cross_origin_isolated();
        let (client, is_secure) = (self.client.id.0, self.client.is_secure());
        let runs_program = is_for_preload || self.client.runs_program();
        let realm = from_js_host_call_generic(global(), || {
            Bun__DesktopRealm__createWindow(
                global(),
                client,
                is_secure,
                is_isolated,
                runs_program,
                node,
                window,
                page,
            )
        })?
        .expect("an exception or a realm");
        map_in(self.worlds()).set(global(), js(id)?, realm.to_js_value())?;
        Ok(realm)
    }

    fn find_or_create_world(&self, id: u32, node: NodeGlobals) -> JsResult<World> {
        if let Some(known) = self.known_realm(id)? {
            return Ok(World::of(known));
        }
        match (self.opener, self.known_realm(0)?) {
            (Some(opener), _) => Ok(World {
                realm: (Document::of(opener)
                    .ok_or_else(disposed)?
                    .world_with_id(0)?)
                .realm,
                window: dom::window_of(field(fields::controller(self))),
                is_borrowed: true,
            }),
            (None, Some(main)) => self
                .create_realm(id, node, id == OF_PRELOAD, JSValue::UNDEFINED, Some(main))
                .map(World::of),
            _ => Err(disposed()),
        }
    }

    /// `None` if it has thrown.
    fn begin(&self, world: u32, code: JSValue, is_by_user: bool) -> JsResult<Option<Settled>> {
        if is_by_user {
            from_js_host_call_generic(global(), || dom::obey(self.id, Order::Activate {}))?;
        }
        let world = self.world_with_id(world)?;
        Ok(match catch(world.inject(code, true))? {
            Ok(promise) => Some(with_realm(world.realm, |cx| {
                settled(cx, JsLocal::new(&cx.heap, promise))
            })),
            Err(thrown) => {
                Bun__DOM__reportException(world.realm, thrown, JSValue::ZERO);
                None
            }
        })
    }

    /// A promise.
    pub(crate) fn execute(page: u32, world: u32, code: JSValue, is_by_user: bool) -> JSValue {
        let begin = || {
            (Document::of(page)
                .ok_or_else(disposed)?
                .begin(world, code, is_by_user)?)
            .ok_or_else(failed_to_execute)
        };
        let begun = catch(begin()).map(|it| it.map_err(keep));
        task::promise(async move {
            match begun?.map_err(|it| task::throw(&it))?.await {
                Ok(value) => clone(value.get(), JSValue::UNDEFINED, global()),
                Err(thrown) => {
                    Err(global().throw_value(clone(thrown.get(), JSValue::UNDEFINED, global())?))
                }
            }
        })
    }

    /// Makes the realm and the empty document.
    pub(crate) fn open(
        id: u32,
        how: NewDocument,
        preloads: Option<&Preloads>,
        links: Links,
    ) -> JsResult<&'static Document> {
        let state = State {
            id,
            client: links.client,
            host: links.of_preload,
            nearby: links.nearby,
            isolates_context: how.isolates_context,
            opener: how.opener,
        };
        let this = fields::create(heap(), Document(state.into(), HasFields::default()));
        fields::set_needed(this, links.needed[1]);
        fields::set_owner(this, links.owner);
        documents().borrow_mut().insert(id, Root::new(this));
        let mut opening = Opening {
            page: id,
            context: how.context,
            surface: how.surface,
            has_relatives: how.has_relatives,
            about: how.about,
            ..Opening::new(links.of_window, links.needed[0])
        };
        if let Some(opener) = how.opener {
            let opened = from_js_host_call_generic(global(), || {
                dom::open_page_beside(opener, opening, this.client.id)
            })?;
            fields::set_controller(this, opened.ok_or_else(disposed)?);
            return Ok(this);
        }
        let node = match preloads {
            Some(it) if it.integrates_node && !how.isolates_context => {
                NodeGlobals::OfNodeIntegration
            }
            _ => NodeGlobals::None,
        };
        let window = dom::window_to_take_over(how.context);
        let is_for_preload = preloads.is_some() && !how.isolates_context;
        let realm = this.create_realm(0, node, is_for_preload, window, None)?;
        let (main, links) = (World::of(realm), core::mem::take(&mut opening.about.links));
        let controller = from_js_host_call(global(), || {
            Bun__DesktopRealm__setUpMembers(realm);
            dom::open_page(realm, opening, Some(main.window))
        })?;
        Bun__DesktopRealm__run(realm);
        fields::set_controller(this, controller);
        dom::follow_response(id, &links);
        Ok(this)
    }

    pub(crate) fn preload(&self, mut how: Preloads) -> JsResult<()> {
        let world = match (self.isolates_context, how.integrates_node) {
            (false, _) => self.world_with_id(0)?,
            (_, true) => self.find_or_create_world(OF_PRELOAD, NodeGlobals::OfNodeIntegration)?,
            _ => self.find_or_create_world(OF_PRELOAD, NodeGlobals::OfPreload)?,
        };
        let scripts = core::mem::take(&mut how.scripts);
        let members = Bun__DesktopRealm__members(world.realm);
        let preload = Preload::create(self, world.window, members, how)?;
        fields::set_preload(self, Some(preload));
        for it in scripts {
            let failure = match it.source {
                Source::Unreadable(thrown) => thrown,
                source => match catch(run_preload(preload, world, &it.file, source))? {
                    Ok(()) => continue,
                    Err(thrown) => describe(thrown)?,
                },
            };
            from_js_host_call_generic(global(), || self.host.preload_failed(it.file, failure))?;
        }
        preload.loaded()
    }

    /// `values` is an array of the realm of the app.
    pub(crate) fn send(
        &self,
        channel: JSValue,
        values: JSValue,
        ports: Vec<Endpoint>,
    ) -> JsResult<()> {
        fields::preload(self).map_or(Ok(()), |it| it.send(channel, values, ports))
    }

    pub(crate) fn changed(&self) -> JsResult<()> {
        self.for_each_realm(Bun__DesktopRealm__documentChanged)
    }

    pub(crate) fn dispose(&self) -> JsResult<()> {
        let this = documents().borrow_mut().remove(&self.id);
        fields::preload(self).into_iter().for_each(Preload::dispose);
        fields::set_preload(self, None);
        self.client.dispose();
        let left = dom::leave_relatives(field(fields::controller(self)));
        let needed = self.known_realm(0)?.filter(|_| left.is_needed);
        self.for_each_realm(|it| match needed {
            Some(needed) if core::ptr::eq(needed, it) => {
                OfTheWeb::of(it).map_or((), OfTheWeb::stop)
            }
            _ => Bun__DesktopRealm__dispose(it, left.is_reachable),
        })?;
        for clear in [
            fields::set_worlds,
            fields::set_controller,
            fields::set_inspected,
        ] {
            clear(self, JSValue::UNDEFINED);
        }
        (left.released.into_iter()).for_each(|it| Bun__DesktopRealm__dispose(realm::of(it), false));
        drop(this);
        Ok(())
    }
}

pub(crate) fn disposed() -> bun_jsc::JsError {
    error(format_args!(
        "Render frame was disposed before WebFrameMain could be accessed"
    ))
}

fn run_preload(preload: &Preload, world: World, file: &str, source: Source) -> JsResult<()> {
    let realm = world.realm;
    let function = match source {
        Source::Compiled(path) => field(run_compiled(realm, &path)?.get(realm, "default")?),
        Source::Text(text) => {
            let source = js(format!(
                "(function({PRELOAD_PARAMETERS}){{{text}
}})"
            ))?;
            let url = files::to_url(file);
            (OfTheWeb::of(realm).ok_or_else(disposed)?).evaluate(
                source,
                url.as_bytes(),
                url.as_bytes(),
            )?
        }
        Source::Unreadable(_) => return Ok(()),
    };
    preload.run(function, file)
}

//! The realms of a document.

use bun_jsc::{JSMap, from_js_host_call, from_js_host_call_generic};
use bun_web::channel::Endpoint;
use bun_web::convert::path_of_file;
use bun_web::exec::{block_pages, settled, with_realm};
use bun_web::realm::Realm as OfTheWeb;
use bun_web::{compiled, dom, trust};

use super::page::Page;
use super::{Methods, Numbers as _, bind, field, hooks, lazily, object_in, text_if_any};
use crate::generated_bindgen::contents::js_ElectronPage as fields;
use crate::preload::{self, Preload};
use crate::prelude::*;
use crate::realm::{self, Realm};
use crate::webview::wire;
use crate::{app, files, process, task};

const OF_PRELOAD: u32 = 999;
const PARAMETERS: &str =
    "require,process,Buffer,global,setImmediate,clearImmediate,exports,module,__filename,__dirname";

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
        node: NodeGlobals,
        window: JSValue,
        page: Option<&Realm>,
    ) -> Option<&'static Realm>;
    safe fn Bun__DesktopRealm__setUpPage(
        global: &Realm,
        realm: &Realm,
        host: JSValue,
        base_url: JSValue,
        agent: JSValue,
    ) -> JSValue;
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

pub(super) fn release(realm: JSValue) {
    Bun__DesktopRealm__dispose(realm::of(realm), false);
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

    /// For the app.
    pub(super) fn handle_of_window(self) -> JSValue {
        Bun__RealmBridge__keep(self.window)
    }
}

const FOR_PRELOAD: Methods<Page> = &[
    ("window", |it, given| {
        Ok(it.world_with_id(argument(given, 0).as_u32())?.window)
    }),
    ("adoptPort", |it, given| {
        let main = it.world_with_id(0)?;
        let port = Endpoint::unpark(argument(given, 0).as_number());
        main.carry(dom::adopt_port(main.realm, port), it.world_of_preload()?)
    }),
    ("releasePort", |it, given| {
        let main = it.world_with_id(0)?;
        let port = (it.world_of_preload()?).carry(argument(given, 0), main)?;
        super::or_undefined(dom::release_port(main.realm, port).map(Endpoint::park))
    }),
    ("pathForFile", |it, given| {
        let file = (it.world_of_preload()?).carry(argument(given, 0), it.world_with_id(0)?)?;
        js(text_if_any(if file.is_object() {
            path_of_file(global(), file)
        } else {
            JSValue::UNDEFINED
        })?
        .unwrap_or_default())
    }),
    ("block", |_, given| {
        Ok(block_pages(global(), task::settled(argument(given, 0)))
            .and_then(Result::ok)
            .map_or(JSValue::UNDEFINED, |it| it.get()))
    }),
    ("executeJavaScript", |it, given| {
        let is_by_user = argument(given, 2).to_boolean();
        Ok(it.execute(argument(given, 0).as_u32(), argument(given, 1), is_by_user))
    }),
    ("insertCSS", |it, given| it.ask("insertCSS", given)),
    ("removeInsertedCSS", |it, given| {
        it.ask("removeInsertedCSS", given)
    }),
    ("insertText", |it, given| it.ask("insertText", given)),
];

impl Page {
    fn worlds(&self) -> JsResult<JSValue> {
        lazily(
            fields::worlds(self),
            || Ok(JSMap::create(global())),
            |it| fields::set_worlds(self, it),
        )
    }

    pub(super) fn known_realm(&self, id: u32) -> JsResult<Option<&'static Realm>> {
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
        self.world_with_id(if self.contents().preferences.isolates_context {
            OF_PRELOAD
        } else {
            0
        })
    }

    /// `window` is the object to take over.
    fn create_realm(
        &self,
        id: u32,
        node: NodeGlobals,
        window: JSValue,
        page: Option<&Realm>,
    ) -> JsResult<&'static Realm> {
        let is_isolated = page.is_none() && self.client.is_cross_origin_isolated();
        let (client, is_secure) = (self.client.id.0, self.client.is_secure());
        let realm = from_js_host_call_generic(global(), || {
            Bun__DesktopRealm__createWindow(
                global(),
                client,
                is_secure,
                is_isolated,
                node,
                window,
                page,
            )
        })?
        .expect("an exception or a realm");
        map_in(self.worlds()?).set(global(), js(id)?, realm.to_js_value())?;
        Ok(realm)
    }

    fn find_or_create_world(&self, id: u32, node: NodeGlobals) -> JsResult<World> {
        if let Some(known) = self.known_realm(id)? {
            return Ok(World::of(known));
        }
        match (self.opener(), self.known_realm(0)?) {
            (Some(opener), _) if !self.is_disposed() => Ok(World {
                realm: opener.world_with_id(0)?.realm,
                window: realm::peek(self.window()?),
                is_borrowed: true,
            }),
            (None, Some(main)) => self
                .create_realm(id, node, JSValue::UNDEFINED, Some(main))
                .map(World::of),
            _ => Err(disposed()),
        }
    }

    /// A promise.
    pub(super) fn execute(&self, world: u32, code: JSValue, is_by_user: bool) -> JSValue {
        let start = || {
            if self.is_disposed() || !self.is_started() {
                return Err(disposed());
            }
            if is_by_user {
                let main = self.world_with_id(0)?;
                dom::activate(main.realm, main.window);
            }
            let world = self.world_with_id(world)?;
            match catch(world.inject(code, true))? {
                Ok(promise) => Ok(with_realm(world.realm, |cx| {
                    settled(cx, JsLocal::new(&cx.heap, promise))
                })),
                Err(thrown) => {
                    Bun__DOM__reportException(world.realm, thrown, JSValue::ZERO);
                    Err(error(format_args!(
                        "Script failed to execute, this normally means an error was thrown. Check the renderer console for the error."
                    )))
                }
            }
        };
        let started = catch(start()).map(|it| it.map_err(keep));
        task::promise(async move {
            match started?.map_err(|it| task::throw(&it))?.await {
                Ok(value) => clone(value.get(), JSValue::UNDEFINED, global()),
                Err(thrown) => {
                    Err(global().throw_value(clone(thrown.get(), JSValue::UNDEFINED, global())?))
                }
            }
        })
    }

    pub(super) fn document_changed(&self) -> JsResult<()> {
        let url = js(self.url())?;
        let about = hooks::about_document(self, object!({ "url": url }))?;
        self.for_each_realm(Bun__DesktopRealm__documentChanged)?;
        if self.known_realm(0)?.is_some() {
            self.tell("aboutChanged", &[about])?;
        }
        self.tell(
            "renew",
            &[url, super::or_undefined(self.inherited_base_url())?],
        )?;
        self.apply_policy(true)?;
        self.follow_links();
        Ok(())
    }

    fn follow_links(&self) {
        if let Some(loaded) = self.loaded() {
            self.client
                .follow_links(&loaded.headers.get_or_empty(b"link"));
        }
    }

    pub(super) fn apply_policy(&self, is_for_new_document: bool) -> JsResult<()> {
        if let Some(realm) = self.known_realm(0)? {
            dom::apply_policy(realm, is_for_new_document);
        }
        if self.client.policies().csp.restricts_style_attributes() {
            self.tell("checkStyleAttributes", &[])?;
        }
        Ok(())
    }

    /// Makes the realm and the empty document, and runs the preload scripts.
    pub(super) fn start(&self) -> JsResult<()> {
        let (contents, preferences) = (self.contents(), &*self.contents().preferences);
        if let Some(create_page) = object_in(fields::create_page(self)) {
            let controller = controls_of(call(create_page, &[hooks::of_document(self)?])?)?;
            fields::set_controller(self, controller);
            let of_opener = self.opener().map_or(Ok(JSValue::UNDEFINED), Page::window);
            let document = realm::peek(invoke(controller, "currentDocument", &[])?);
            let of_opener = get(realm::peek(of_opener?), "document")?;
            dom::lend_client(document, self.client.id, of_opener);
            return Ok(());
        }
        let joined = trust::trusts_any_frame()
            .then(|| contents.join(self))
            .transpose()?;
        joined.iter().for_each(|it| self.set_agent(&it.0));
        let (agent, window) = joined.unzip();
        let mut preloads = Vec::new();
        if self.parent().is_none() || preferences.integrates_node_in_frames {
            preloads = contents.session.preloads_of_frames();
            preloads.extend(preferences.preload.clone());
        }
        let has_preload =
            !preloads.is_empty() || (preferences.integrates_node && self.parent().is_none());
        let of_preload = match (preferences.integrates_node, preferences.isolates_context) {
            (true, _) => NodeGlobals::OfNodeIntegration,
            (_, true) => NodeGlobals::OfPreload,
            _ => NodeGlobals::None,
        };

        let host = hooks::of_document(self)?;
        let node = if has_preload && !preferences.isolates_context {
            of_preload
        } else {
            NodeGlobals::None
        };
        let realm = self.create_realm(0, node, field(window.flatten()), None)?;
        let shared = match agent.as_ref().and_then(|it| it.root()) {
            Some(root) => invoke(root.controller, "shared", &[])?,
            None => JSValue::UNDEFINED,
        };
        let base_url = super::or_undefined(self.inherited_base_url())?;
        let page = from_js_host_call(global(), || {
            Bun__DesktopRealm__setUpPage(global(), realm, host, base_url, shared)
        })?;
        let controller = controls_of(page)?;
        let main = World::of(realm);
        agent.map_or(Ok(()), |it| contents.joined(&it, main, controller))?;
        fields::set_controller(self, controller);
        self.apply_policy(false)?;
        self.follow_links();
        if !has_preload {
            return Ok(());
        }
        let world = if preferences.isolates_context {
            self.find_or_create_world(OF_PRELOAD, of_preload)?
        } else {
            main
        };
        let preload = self.create_preload(world)?;
        fields::set_preload(self, Some(preload));
        for file in preloads {
            if let Err(thrown) = catch(run_preload(preload, world, &file))? {
                crate::dialog::print_error(&format!(
                    "Unable to load preload script: {file} {}",
                    process::inspect(thrown)?
                ));
                let failure =
                    global().create_error_instance(format_args!("{}", message_of(thrown)?));
                if thrown.is_object() {
                    assign(failure, "stack", get(thrown, "stack")?)?;
                }
                announce(self.owner().to_js(), "preload-error", &[js(file)?, failure])?;
            }
        }
        preload.loaded()
    }

    fn create_preload(&self, world: World) -> JsResult<&'static Preload> {
        let (preferences, url) = (&self.contents().preferences, self.url());
        Preload::create(&preload::Init {
            global: world.window,
            members: Bun__DesktopRealm__members(world.realm),
            host: bind(object!({}), self, FOR_PRELOAD)?,
            page: self.to_js(),
            contents: self.owner().to_js(),
            is_isolated: preferences.isolates_context,
            is_sandboxed: preferences.is_sandboxed,
            integrates_node: preferences.integrates_node,
            document_path: match url.starts_with("file:") {
                true => files::from_url(&url),
                false => files::join(&[app::path()?, "index.html"]),
            },
            additional_arguments: texts_of(get(
                self.contents().preferences(),
                "additionalArguments",
            )?)?,
        })
    }

    pub(super) fn send(&self, channel: JSValue, values: JSValue, ports: JSValue) -> JsResult<()> {
        fields::preload(self).map_or(Ok(()), |it| it.send(channel, values, ports))
    }

    pub(super) fn dispose_worlds(&self) -> JsResult<()> {
        let agent = self.agent();
        let (root, is_reachable) = (
            agent.as_ref().and_then(|it| it.root()),
            agent.as_ref().is_some_and(|it| it.has_other_pages()),
        );
        // Other documents use the modules of the first one.
        self.for_each_realm(|it| match root {
            Some(root) if root.realm == it.to_js_value() => {
                OfTheWeb::of(it).map_or((), OfTheWeb::stop)
            }
            _ => Bun__DesktopRealm__dispose(it, is_reachable),
        })?;
        fields::set_worlds(self, JSValue::UNDEFINED);
        agent.map_or(Ok(()), |it| it.leave())
    }

    /// A structured clone in the realm of the page.
    pub(super) fn clone_to_main_world(&self, value: JSValue) -> JsResult<JSValue> {
        clone(value, JSValue::UNDEFINED, self.world_with_id(0)?.realm)
    }
}

fn disposed() -> bun_jsc::JsError {
    error(format_args!(
        "Render frame was disposed before WebFrameMain could be accessed"
    ))
}

fn run_preload(preload: &Preload, world: World, file: &str) -> JsResult<()> {
    if !files::is_absolute(file) {
        return Err(error(format_args!(
            "Preload script must have absolute path: {file}"
        )));
    }
    let url = files::to_url(file);
    let realm = world.realm;
    let function = match compiled::path_of(url.as_bytes()) {
        Some(path) => field(run_compiled(realm, &path)?.get(realm, "default")?),
        None => {
            let text = string(&files::read_with_node(file)?);
            let source = js(format!(
                "(function({PARAMETERS}){{{text}
}})"
            ))?;
            (OfTheWeb::of(realm).ok_or_else(disposed)?).evaluate(
                source,
                url.as_bytes(),
                url.as_bytes(),
            )?
        }
    };
    preload.run(function, file)
}

fn controls_of(handle: JSValue) -> JsResult<JSValue> {
    let controls = crate::realm::methods_of(handle)?;
    let window = invoke(controls, "currentWindow", &[])?;
    controls.put(global(), b"window", window);
    Ok(controls)
}

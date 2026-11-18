//! `session`: what the pages of a partition share.

mod certificate;
pub(crate) mod cookies;
pub(crate) mod download;
mod embedder;
pub(crate) mod load;
mod mirror;
pub(crate) mod net;
mod net_log;
pub(crate) mod online;
pub(crate) mod parts;
pub(crate) mod protocol;
mod service_workers;
pub(crate) mod socket;
pub(crate) mod updates;

use std::rc::Rc;
use std::sync::Arc;

use bun_core::Utf8Bytes;
use bun_ui::protocol::{Request, SystemRequest};
use bun_web::net::NetError;
use bun_web::net::proxy::{Config, to_answer};
use bun_web::net::session::Session as Network;
use bun_web::storage::{Kinds, Origins};
use bun_web::url::Url;

use self::load::rejection;
pub(crate) use self::mirror::readable;
use self::mirror::{Mirror, Setting};
use crate::generated_bindgen::session::{
    ElectronSessions, js_ElectronCookies, js_ElectronExtensions, js_ElectronNetLog,
    js_ElectronProtocol, js_ElectronServiceWorkers, js_ElectronSession as fields,
    js_ElectronWebRequest,
};
use crate::prelude::*;
use crate::realm::{self, Module};
use crate::text::{contains, encode_path, origin_of, split};
use crate::value::Value;
use crate::webview::{engine, wire};
use crate::{app, command_line, files, paths, process, task, utility};

type Texts = Vec<Utf8Bytes<'static>>;
type Values<'a, 'b> = &'b [JsLocal<'a>];

pub(crate) struct Session {
    key: String,
    storage_path: Option<String>,
    network: Arc<Network>,
    mirror: Box<Mirror>,
    own_workers: Box<service_workers::Own>,
    schemes: protocol::Schemes,
    zoom_levels: parts::ZoomLevels,
    user_agent: RefCell<Option<String>>,
    languages: RefCell<Option<String>>,
    trusted_servers: RefCell<Option<String>>,
    download_path: RefCell<Option<String>>,
    preloads: RefCell<Vec<Value>>,
    checks_spelling: Cell<bool>,
    spelling_languages: RefCell<Vec<String>>,
}

#[derive(Default)]
struct State {
    /// None is ever let go of.
    all: RefCell<Vec<Root<Session>>>,
    last_preload: Cell<u32>,
    reports_answers: Cell<bool>,
}

state!(fn state() -> State);

fn all() -> Vec<&'static Session> {
    state().all.borrow().iter().map(Root::get).collect()
}

fn proxy_of_switches() -> Config {
    let bytes = |it: String| it.into_bytes().into();
    if command_line::switch("no-proxy-server").is_some() {
        Config::Direct
    } else if let Some(url) = command_line::value("proxy-pac-url") {
        Config::Script {
            url: bytes(url),
            is_optional: false,
        }
    } else if command_line::switch("proxy-auto-detect").is_some() {
        Config::AutoDetect
    } else if let Some(rules) = command_line::value("proxy-server") {
        Config::Fixed {
            rules: bytes(rules),
            bypass: bytes(command_line::switch("proxy-bypass-list").unwrap_or_default()),
        }
    } else {
        Config::System
    }
}

fn open(
    key: String,
    directory: impl FnOnce() -> JsResult<Option<String>>,
) -> JsResult<&'static Session> {
    if let Some(known) = all().into_iter().find(|it| it.key == key) {
        return Ok(known);
    }
    if !app::is_ready() && !utility::is_this_process() {
        return Err(type_error(format_args!(
            "Session can only be received when app is ready"
        )));
    }
    create(key, directory()?)
}

fn create(key: String, storage_path: Option<String>) -> JsResult<&'static Session> {
    let directory = storage_path.as_ref().map(String::as_bytes);
    let session = fields::create(
        heap(),
        Session {
            key,
            network: Network::new(directory, |id| Rc::new(embedder::ForNetwork(id))),
            storage_path,
            mirror: Default::default(),
            own_workers: Default::default(),
            schemes: Default::default(),
            zoom_levels: Default::default(),
            user_agent: Default::default(),
            languages: Default::default(),
            trusted_servers: Default::default(),
            download_path: Default::default(),
            preloads: Default::default(),
            checks_spelling: HAS_SPELL_CHECKER.into(),
            spelling_languages: Default::default(),
        },
    );
    if state().all.borrow().is_empty() {
        process::at_exit(|| all().into_iter().for_each(Session::flush_storage_data));
    }
    state().all.borrow_mut().push(Root::new(session));
    fields::set_handlers(session, bun_jsc::JSMap::create(global()));
    session.configure();
    session.network.set_proxy(proxy_of_switches());
    emit(app::object(), "session-created", &[session.to_js()])?;
    Ok(session)
}

pub(crate) fn from_partition(partition: &str) -> JsResult<&'static Session> {
    let partition = if partition == "persist:" {
        ""
    } else {
        partition
    };
    open(partition.to_owned(), || {
        if utility::is_this_process() {
            return Ok(None);
        }
        let Some(name) = partition.strip_prefix("persist:") else {
            return partition
                .is_empty()
                .then(|| paths::path("sessionData"))
                .transpose();
        };
        let name = encode_path(&name.to_ascii_lowercase());
        let harmless = |it| if matches!(it, "." | "..") { "_" } else { it };
        let name = split(&name, "/").map(harmless).collect::<Vec<_>>();
        Ok(Some(files::join(&[
            &paths::path("sessionData")?,
            "Partitions",
            &name.join("/"),
        ])))
    })
}

pub(crate) fn default() -> JsResult<&'static Session> {
    from_partition("")
}

pub(crate) fn report_answers() {
    state().reports_answers.set(true);
    update_reports();
}

fn update_reports() {
    let is_wanted = state().reports_answers.get() || net_log::is_on();
    for session in all() {
        session.network.settings.write().reports_answers = is_wanted;
    }
}

impl ElectronSessions {
    pub(crate) fn from_partition(_: Cx<'_, '_>, partition: &[u8]) -> JsResult<&'static Session> {
        from_partition(&string(partition))
    }

    pub(crate) fn from_path(_: Cx<'_, '_>, path: &[u8]) -> JsResult<&'static Session> {
        let path = string(path);
        if !files::is_absolute(&path) {
            return Err(type_error(format_args!(
                "An absolute path was not provided"
            )));
        }
        open(format!("path:{path}"), || Ok(Some(path)))
    }

    pub(crate) fn get_default_session(_: Cx<'_, '_>) -> JsResult<&'static Session> {
        default()
    }
}

fn from_js(values: Values<'_, '_>) -> JsResult<Value> {
    engine::list_from_js(JsLocal::to_js_slice(values))
}

macro_rules! handlers {
    ($($method:ident: $name:literal),* $(,)?) => {$(
        pub(crate) fn $method<'a>(
            &self,
            _: Cx<'a, '_>,
            handler: JsLocal<'a>,
            options: JsLocal<'a>,
        ) -> JsResult<()> {
            let handler = handler.to_js();
            if !handler.is_callable() && !handler.is_null() {
                return Err(type_error(format_args!("Must pass null or function")));
            }
            self.handle_with($name, Some(handler).filter(|it| it.is_callable()), options.to_js())
        }
    )*};
}

macro_rules! settings_of_engine {
    ($($method:ident: $name:literal),* $(,)?) => {$(
        pub(crate) fn $method<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
            Ok(self.remember_call($name, from_js(values)?))
        }
    )*};
}

macro_rules! actions {
    ($($method:ident: $name:literal),* $(,)?) => {$(
        pub(crate) fn $method<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<JSValue> {
            Ok(self.itself().act($name, from_js(values)?))
        }
    )*};
}

impl Session {
    fn with_id(id: u32) -> &'static Session {
        let all = state().all.borrow();
        let found = all.iter().map(Root::get).find(|it| it.network.id() == id);
        found.expect("it is never let go of")
    }

    fn itself(&self) -> &'static Session {
        Session::with_id(self.network.id())
    }

    pub(crate) fn of(contents: JSValue) -> JsResult<&'static Session> {
        cast(get(contents, "session")?)
            .ok_or_else(|| error(format_args!("Object has been destroyed")))
    }

    pub(crate) fn network(&self) -> Arc<Network> {
        Arc::clone(&self.network)
    }

    pub(crate) fn preloads_of_frames(&self) -> Vec<String> {
        self.of_preloads_of_frames("filePath")
    }

    /// `key` is the name of a setter or of an event, a scheme with its colon, or an origin.
    pub(crate) fn handler(&self, key: &str) -> JsResult<Option<JSValue>> {
        let found = map_in(fields::handlers(self).unwrap_or_default()).get(global(), js(key)?)?;
        Ok(Some(found).filter(|it| it.is_callable()))
    }

    fn set_handler(&self, key: &str, handler: Option<JSValue>) -> JsResult<()> {
        let handlers = map_in(fields::handlers(self).unwrap_or_default());
        match handler {
            Some(handler) => handlers.set(global(), js(key)?, handler),
            None => handlers.remove(global(), js(key)?).map(drop),
        }
    }

    pub(crate) fn handle_with(
        &self,
        name: &'static str,
        handler: Option<JSValue>,
        options: JSValue,
    ) -> JsResult<()> {
        self.set_handler(name, handler)?;
        if name == certificate::VERIFY {
            self.network.settings.write().verifies_certificates = handler.is_some();
            self.configure();
        }
        let options = wire::data_from_js(options)?;
        drop(self.remember(
            name,
            Setting::Handler {
                name,
                is_set: handler.is_some(),
                options,
            },
        ));
        Ok(())
    }

    fn configure(&self) {
        let either = |names: [&str; 2]| {
            names
                .into_iter()
                .find_map(command_line::switch)
                .unwrap_or_default()
        };
        let trusted = self.trusted_servers.borrow().clone();
        let mut settings = self.network.settings.write();
        settings.host_resolver_rules = command_line::switch("host-resolver-rules")
            .unwrap_or_default()
            .as_bytes()
            .into();
        settings.ignores_certificate_errors =
            command_line::switch("ignore-certificate-errors").is_some();
        settings.disables_http2 = command_line::switch("disable-http2").is_some();
        settings.reports_answers = state().reports_answers.get() || net_log::is_on();
        settings.trusted_servers = trusted
            .unwrap_or_else(|| either(["auth-server-allowlist", "auth-server-whitelist"]))
            .as_bytes()
            .into();
        settings.delegates = either([
            "auth-negotiate-delegate-allowlist",
            "auth-negotiate-delegate-whitelist",
        ])
        .as_bytes()
        .into();
        drop(settings);
        self.network.renew_pool();
    }

    pub(crate) fn accept_language(&self) -> JsResult<String> {
        self.languages
            .borrow()
            .clone()
            .map_or_else(|| app::locale().map(str::to_owned), Ok)
    }

    pub(crate) fn user_agent(&self) -> JsResult<String> {
        self.user_agent
            .borrow()
            .clone()
            .map_or_else(app::user_agent, Ok)
    }

    fn download_path(&self) -> JsResult<String> {
        self.download_path
            .borrow()
            .clone()
            .map_or_else(|| paths::path("downloads"), Ok)
    }

    /// Of `only`, or else of all origins but `except`.
    async fn clear(&self, kinds: &Value, only: Option<&[Value]>, except: &[Value]) {
        let includes = |names: &[&str]| {
            !kinds.is_list()
                || kinds.items().iter().any(|it| {
                    names
                        .iter()
                        .any(|name| it.text().eq_ignore_ascii_case(name))
                })
        };
        let listed: Vec<String> = only
            .unwrap_or(except)
            .iter()
            .map(|it| origin_of(it.text()))
            .collect();
        if includes(&["cookies"]) {
            let urls: Vec<Url> = listed
                .iter()
                .filter_map(|it| Url::parse(it.as_bytes()))
                .collect();
            self.network.clear_cookies(&urls, only.is_some(), None);
        }
        let stored: [(Kinds, &[&str]); 4] = [
            (Kinds::AREAS, &["localstorage"]),
            (Kinds::DATABASES, &["indexdb", "indexeddb"]),
            (Kinds::CACHES, &["cachestorage", "serviceworkers"]),
            (Kinds::FILES, &["filesystem", "filesystems"]),
        ];
        let origins = Origins {
            listed: listed.iter().map(|it| it.as_bytes().into()).collect(),
            are_meant: only.is_some(),
        };
        if includes(&["serviceworkers"]) {
            self.network.clear_service_workers(origins.clone());
        }
        let kinds = stored
            .into_iter()
            .filter(|it| includes(it.1))
            .map(|it| it.0)
            .collect();
        Arc::clone(&self.network.storage)
            .clear(kinds, origins)
            .await;
    }

    async fn act_here(&self, name: &str, options: &Value) -> Value {
        match name {
            "clearAuthCache" => self.network.clear_logins(),
            "clearCache" => Arc::clone(&self.network.cache).clear().await,
            "clearData" => {
                let (kinds, origins) = (&options["dataTypes"], &options["origins"]);
                self.clear(
                    kinds,
                    origins.is_list().then(|| origins.items()),
                    options["excludeOrigins"].items(),
                )
                .await;
                if !kinds.is_list() || kinds.items().iter().any(|it| it.is("cache")) {
                    Arc::clone(&self.network.cache).clear().await;
                }
            }
            "clearStorageData" => {
                let origin = Some(&options["origin"]).filter(|it| it.is_truthy());
                self.clear(&options["storages"], origin.map(core::slice::from_ref), &[])
                    .await;
            }
            "closeAllConnections" => self.network.disconnect(NetError::ConnectionClosed, true),
            "forceReloadProxyConfig" => self.network.reload_proxy(),
            "getCacheSize" => return (Arc::clone(&self.network.cache).size().await as f64).into(),
            _ => {}
        }
        Value::Undefined
    }

    /// Here, and in the web engine if it runs or has stored something.
    fn act(&'static self, name: &'static str, arguments: Value) -> JSValue {
        task::busy_promise(async move {
            if arguments[0]["origins"].is_list() && arguments[0]["excludeOrigins"].is_list() {
                return Err(type_error(format_args!(
                    "Cannot provide both 'origins' and 'excludeOrigins'"
                )));
            }
            let here = self.act_here(name, &arguments[0]).await;
            let is_about_files = matches!(
                name,
                "clearCache" | "clearCodeCaches" | "clearData" | "clearStorageData"
            );
            let has_files = || {
                JsResult::Ok(
                    self.directory_of_engine()?
                        .is_some_and(|it| files::exists(&it))
                        && engine::is_available()?,
                )
            };
            if !self.mirror.is_linked() && !(is_about_files && has_files()?) {
                return js(&here);
            }
            match self.perform(name, arguments).await? {
                Value::Number(size) => js(size + here.number()),
                _ => js(&here),
            }
        })
    }

    handlers!(
        set_bluetooth_pairing_handler: "setBluetoothPairingHandler",
        set_certificate_verify_proc: "setCertificateVerifyProc",
        set_device_permission_handler: "setDevicePermissionHandler",
        set_display_media_request_handler: "setDisplayMediaRequestHandler",
        set_permission_check_handler: "setPermissionCheckHandler",
        set_permission_request_handler: "setPermissionRequestHandler",
        set_usb_protected_classes_handler: "setUSBProtectedClassesHandler",
    );

    settings_of_engine!(
        disable_network_emulation: "disableNetworkEmulation",
        enable_network_emulation: "enableNetworkEmulation",
        set_spell_checker_dictionary_download_url: "setSpellCheckerDictionaryDownloadURL",
        set_ssl_config: "setSSLConfig",
    );

    actions!(
        clear_auth_cache: "clearAuthCache",
        clear_cache: "clearCache",
        clear_code_caches: "clearCodeCaches",
        clear_data: "clearData",
        clear_host_resolver_cache: "clearHostResolverCache",
        clear_shared_dictionary_cache: "clearSharedDictionaryCache",
        clear_shared_dictionary_cache_for_isolation_key: "clearSharedDictionaryCacheForIsolationKey",
        clear_storage_data: "clearStorageData",
        close_all_connections: "closeAllConnections",
        force_reload_proxy_config: "forceReloadProxyConfig",
        get_cache_size: "getCacheSize",
    );

    pub(crate) fn nothing(&self) {}

    pub(crate) fn set_code_cache_path(&self, _: Cx<'_, '_>, path: &[u8]) -> JsResult<()> {
        match files::is_absolute(&string(path)) {
            true => Ok(()),
            false => Err(type_error(format_args!(
                "Absolute path must be provided to store code cache."
            ))),
        }
    }

    pub(crate) fn nothing_to_list(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        resolved(array(&[])?)
    }

    pub(crate) fn get_cookies(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(js_ElectronCookies::create(heap(), cookies::Cookies(self.itself())).to_js())
    }

    pub(crate) fn get_protocol(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(js_ElectronProtocol::create(heap(), protocol::Protocol(self.itself())).to_js())
    }

    pub(crate) fn get_web_request(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(js_ElectronWebRequest::create(heap(), parts::WebRequest(self.itself())).to_js())
    }

    pub(crate) fn get_service_workers(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(js_ElectronServiceWorkers::create(heap(), parts::ServiceWorkers(self.itself())).to_js())
    }

    pub(crate) fn get_extensions(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(js_ElectronExtensions::create(heap(), parts::Extensions(self.itself())).to_js())
    }

    pub(crate) fn get_net_log(&self, heap: &JsHeap<'_>) -> JSValue {
        js_ElectronNetLog::CLASS.constructor(heap)
    }

    pub(crate) fn get_storage_path(&self) -> Option<&str> {
        self.storage_path.as_deref()
    }

    pub(crate) fn is_persistent(&self) -> bool {
        self.storage_path.is_some()
    }

    pub(crate) fn fetch<'a>(
        &self,
        _: Cx<'a, '_>,
        input: JsLocal<'a>,
        init: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        self.itself().fetch_for_script(input.to_js(), init.to_js())
    }

    pub(crate) fn get_user_agent(&self, _: Cx<'_, '_>) -> JsResult<String> {
        self.user_agent()
    }

    pub(crate) fn set_user_agent(&self, user_agent: &[u8], languages: Option<&[u8]>) {
        let (user_agent, languages) = (string(user_agent), languages.map(string));
        let arguments = [Some(&user_agent), languages.as_ref()]
            .into_iter()
            .flatten()
            .map(|it| Value::from(&**it));
        self.remember_call("setUserAgent", arguments.collect());
        self.user_agent.replace(Some(user_agent));
        self.languages.replace(languages);
        crate::contents::update_agents();
    }

    pub(crate) fn change_proxy(&self, config: JSValue) -> JsResult<JSValue> {
        let config = wire::data_from_js(config)?;
        let [url, rules, bypass] =
            ["pacScript", "proxyRules", "proxyBypassRules"].map(|it| config[it].text().as_bytes());
        self.network.set_proxy(match config["mode"].as_text() {
            Some("direct") => Config::Direct,
            Some("system") => Config::System,
            Some("auto_detect") => Config::AutoDetect,
            Some("pac_script") if url.is_empty() => Config::AutoDetect,
            Some("pac_script") | None if !url.is_empty() => Config::Script { url: url.into(), is_optional: false },
            Some("fixed_servers") | None => Config::Fixed { rules: rules.into(), bypass: bypass.into() },
            _ => {
                return Err(error(format_args!(
                    "Invalid mode, must be one of direct, auto_detect, pac_script, fixed_servers or system"
                )));
            }
        });
        let applied = self.remember(
            "setProxy",
            Setting::Call {
                method: "setProxy",
                arguments: list![config],
            },
        );
        Ok(task::promise(async {
            if let Some(applied) = applied {
                applied.await;
            }
            Ok(JSValue::UNDEFINED)
        }))
    }

    pub(crate) fn set_proxy<'a>(
        &self,
        _: Cx<'a, '_>,
        config: JsLocal<'a, JSObject>,
    ) -> JsResult<JSValue> {
        self.change_proxy(config.to_js())
    }

    pub(crate) fn resolve_proxy(&self, _: Cx<'_, '_>, url: &[u8]) -> JsResult<JSValue> {
        let (network, Some(url)) = (Arc::clone(&self.network), Url::parse(url)) else {
            return resolved("DIRECT");
        };
        Ok(task::busy_promise(async move {
            js(string(&to_answer(
                &network.resolve_proxy(&url).await.map_err(rejection)?,
            )))
        }))
    }

    pub(crate) fn resolve_host<'a>(
        &self,
        _: Cx<'a, '_>,
        host: &[u8],
        options: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let family = match wire::data_from_js(options.to_js())?["queryType"].text() {
            "A" => 4,
            "AAAA" => 6,
            _ => 0,
        };
        let host = string(host);
        let url = if contains(&host, ":") {
            format!("http://[{host}]")
        } else {
            format!("http://{host}")
        };
        let mapped = Url::parse(url.as_bytes())
            .and_then(|url| Some(self.network.map_host(&url).ok()?.unwrap_or(url)));
        let name = string(
            mapped
                .ok_or_else(|| rejection(NetError::NameNotResolved))?
                .hostname(),
        );
        let arguments = [
            js(name.trim_matches(['[', ']']))?,
            object!({ "all": true, "family": family }),
        ];
        let found = task::outcome(invoke(
            get(realm::require(global(), Module::Dns)?, "promises")?,
            "lookup",
            &arguments,
        ));
        Ok(task::promise(async {
            let found = wire::data_from_js(
                found
                    .await
                    .map_err(|_| rejection(NetError::NameNotResolved))?
                    .get(),
            )?;
            let describe = |it: &Value| {
                it.pick(&["address"])
                    .with("family", format!("ipv{}", it["family"].int()))
            };
            js(&record! { "endpoints": found.items().iter().map(describe).collect::<Value>() })
        }))
    }

    pub(crate) fn allow_ntlm_credentials_for_domains(
        &self,
        _: Cx<'_, '_>,
        domains: &[u8],
    ) -> JsResult<()> {
        self.trusted_servers.replace(Some(string(domains)));
        self.configure();
        self.remember_call("allowNTLMCredentialsForDomains", list![string(domains)]);
        Ok(())
    }

    pub(crate) fn set_download_path(&self, path: &[u8]) {
        self.download_path.replace(Some(string(path)));
        self.remember_call("setDownloadPath", list![string(path)]);
    }

    pub(crate) fn set_web_engine_hosts(&self, hosts: Texts) {
        self.network.settings.write().web_engine_hosts =
            hosts.into_iter().map(|it| (*it).into()).collect();
    }

    pub(crate) fn get_blob_data(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        Err(error(format_args!("Could not get blob data handle")))
    }

    pub(crate) fn flush_storage_data(&self) {
        self.network.flush_cookies();
        self.network.storage.flush();
    }

    fn has_preload(&self, id: &str) -> bool {
        self.preloads.borrow().iter().any(|it| it["id"].is(id))
    }

    fn remove_preload(&self, id: &str) {
        self.preloads.borrow_mut().retain(|it| !it["id"].is(id));
        self.forget(&format!("preload {id}"));
        self.tell_engine("unregisterPreloadScript", list![id]);
    }

    fn add_preload(&self, mut script: Value) -> JsResult<String> {
        if !matches!(script["type"].text(), "frame" | "service-worker") {
            return Err(type_error(format_args!(
                "The type of a preload script must be 'frame' or 'service-worker'"
            )));
        }
        let path = script["filePath"].display();
        if !files::is_absolute(&path) {
            return Err(error(format_args!(
                "Preload script must have absolute path: {path}"
            )));
        }
        if script["id"].is_nothing() {
            state().last_preload.update(|it| it + 1);
            script.set("id", format!("preload-{}", state().last_preload.get()));
        }
        let id = script["id"].display();
        if self.has_preload(&id) {
            return Err(error(format_args!(
                "Cannot register preload script with existing ID '{id}'"
            )));
        }
        self.preloads.borrow_mut().push(script.clone());
        drop(self.remember(&format!("preload {id}"), Setting::Preload(script)));
        Ok(id)
    }

    pub(crate) fn register_preload_script<'a>(
        &self,
        _: Cx<'a, '_>,
        script: JsLocal<'a, JSObject>,
    ) -> JsResult<String> {
        self.add_preload(wire::data_from_js(script.to_js())?)
    }

    pub(crate) fn unregister_preload_script(&self, _: Cx<'_, '_>, id: &[u8]) -> JsResult<()> {
        let id = string(id);
        if !self.has_preload(&id) {
            return Err(error(format_args!(
                "Cannot unregister preload script with non-existing ID '{id}'"
            )));
        }
        self.remove_preload(&id);
        Ok(())
    }

    pub(crate) fn get_preload_scripts(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(&Value::List(self.preloads.borrow().clone()))
    }

    fn of_preloads_of_frames(&self, member: &str) -> Vec<String> {
        self.preloads
            .borrow()
            .iter()
            .filter(|it| it["type"].is("frame"))
            .map(|it| it[member].display())
            .collect()
    }

    pub(crate) fn set_preloads(&self, _: Cx<'_, '_>, preloads: Texts) -> JsResult<()> {
        self.of_preloads_of_frames("id")
            .iter()
            .for_each(|it| self.remove_preload(it));
        preloads.into_iter().try_for_each(|it| {
            self.add_preload(record! { "type": "frame", "filePath": string(&it) })
                .map(drop)
        })
    }

    pub(crate) fn get_preloads(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(self.of_preloads_of_frames("filePath"))
    }

    pub(crate) fn get_available_spell_checker_languages(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        array(&[])
    }

    pub(crate) fn get_spell_checker_enabled(&self) -> bool {
        self.checks_spelling.get()
    }

    pub(crate) fn set_spell_checker_enabled(&self, is_enabled: bool) {
        self.checks_spelling.set(is_enabled);
        self.remember_call("setSpellCheckerEnabled", list![is_enabled]);
    }

    pub(crate) fn add_word_to_spell_checker_dictionary(
        &self,
        _: Cx<'_, '_>,
        word: &[u8],
    ) -> JsResult<bool> {
        if HAS_SPELL_CHECKER {
            let request = Request::System(SystemRequest::LearnSpelling(Text::lossy(word)));
            bun_ui::queue::promise_of(global(), request, |_, _| {
                crate::contents::dictionary_changed().map(|()| JSValue::UNDEFINED)
            })?;
        }
        Ok(HAS_SPELL_CHECKER)
    }

    pub(crate) fn remove_word_from_spell_checker_dictionary(&self) -> bool {
        false
    }

    pub(crate) fn set_spell_checker_languages(&self, languages: Texts) {
        let languages: Vec<String> = languages.into_iter().map(|it| string(&it)).collect();
        self.remember_call(
            "setSpellCheckerLanguages",
            list![
                languages
                    .iter()
                    .map(|it| Value::from(&**it))
                    .collect::<Value>()
            ],
        );
        self.spelling_languages.replace(languages);
    }

    pub(crate) fn get_spell_checker_languages(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(self.spelling_languages.borrow().clone())
    }
}

//! <https://html.spec.whatwg.org/#integration-with-the-javascript-module-system>

use bun_alloc::WTFStringImplStruct as Impl;
use bun_collections::HashMap;
use bun_core::StringView;
use bun_jsc::bun_string_jsc::StringJsc;
use bun_jsc::{
    JSPromise, JSPropertyIterator, JSPropertyIteratorOptions, JsResult, bun_string_jsc,
    from_js_host_call, to_js_host_call,
};
use bun_web::client::{Script, ScriptType};
use bun_web::compiled;
use bun_web::csp::Metadata;
use bun_web::exec::Shared;
use bun_web::import_map::{Given, ImportMap, Unresolved};
use bun_web::net::body::Blob;
use bun_web::request::Credentials;
use bun_web::streams::promise_for;

use bun_web::runtime;

use super::*;
use crate::api::cssom::create_module_sheet;
use crate::api::network::base_url;
use crate::api::realm::realm_of;

unsafe extern "C" {
    safe fn Bun__WebRealm__evaluate(
        realm: &JSGlobalObject,
        source: &Impl,
        url: &bun_core::String,
        base: &bun_core::String,
        line: u32,
        column: u32,
    ) -> JSValue;
    safe fn Bun__WebRealm__moduleSource(
        realm: &JSGlobalObject,
        source: &Impl,
        url: &bun_core::String,
        base: &bun_core::String,
        is_json: bool,
        line: u32,
        column: u32,
    ) -> JSValue;
    safe fn Bun__WebRealm__loadModule(realm: &JSGlobalObject, key: &bun_core::String) -> JSValue;
    safe fn Bun__WebRealm__evaluateModule(
        realm: &JSGlobalObject,
        key: &bun_core::String,
    ) -> JSValue;
    safe fn Bun__WebRealm__runCompiled(
        realm: &JSGlobalObject,
        path: &bun_core::String,
        is_synchronous: bool,
    ) -> JSValue;
}

const NOT_FETCHED: &str = "Failed to fetch dynamically imported module: ";

/// <https://html.spec.whatwg.org/#script-fetch-options>
#[derive(Clone, Default, PartialEq)]
pub(super) struct Fetching {
    pub(super) nonce: Bytes,
    pub(super) credentials: Option<Credentials>,
    pub(super) referrer_policy: ReferrerPolicy,
    pub(super) integrity: Option<Bytes>,
    pub(super) is_parser_inserted: bool,
    pub(super) is_for_link: bool,
    pub(super) blocks_rendering: bool,
    pub(super) referrer: Option<Url>,
}

pub(super) struct Inline {
    pub(super) source: DomString,
    pub(super) url: Bytes,
    pub(super) base: Bytes,
    pub(super) position: (u32, u32),
}

#[derive(Clone)]
struct Fetched {
    url: Url,
    source: SharedBytes,
    referrer_policy: ReferrerPolicy,
}

#[derive(Default)]
struct Entry {
    fetching: Fetching,
    /// Where it was redirected to, or what an inline module is in.
    base: Option<Url>,
    is_inline: bool,
    inline_source: Option<Strong>,
    blob: Option<Blob>,
}

enum Load {
    Running(Shared<Option<Fetched>>),
    /// The engine has it.
    Done,
}

#[derive(Default)]
struct Modules {
    import_map: ImportMap,
    entries: HashMap<Bytes, Entry>,
    /// With their base URL.
    classic_scripts: Vec<(Bytes, Fetching)>,
    /// Where scripts came from. The base URL of a document can be anything.
    fetched: HashMap<Bytes, ()>,
    loads: HashMap<(Bytes, ScriptType), Load>,
    inline_count: u32,
}

fn modules(heap: &JsHeap<'_>) -> Rc<RefCell<Modules>> {
    realm_of(heap).extra()
}

fn view(text: &[u8]) -> StringView<'_> {
    StringView::from_bytes(text)
}

pub(super) fn evaluate_classic<'a>(
    cx: Cx<'_, 'a>,
    source: &DomString,
    url: &[u8],
    base: &[u8],
    (line, column): (u32, u32),
) -> Result<'a, JSValue> {
    let global = cx.global();
    Ok(from_js_host_call(global, || {
        Bun__WebRealm__evaluate(
            global,
            source.as_impl(),
            &view(url),
            &view(base),
            line,
            column,
        )
    })?)
}

pub(super) fn run_compiled<'a>(
    cx: Cx<'_, 'a>,
    path: &[u8],
    is_classic: bool,
) -> Result<'a, JSValue> {
    let global = cx.global();
    Ok(from_js_host_call(global, || {
        Bun__WebRealm__runCompiled(global, &view(path), is_classic)
    })?)
}

/// No URL begins like that.
const CLASSIC: &str = "classic script ";

/// What stands for `base` if a classic script has something to hand on to what it imports.
pub(super) fn key_of_classic_script(
    heap: &JsHeap<'_>,
    base: &[u8],
    fetching: &Fetching,
) -> Option<String> {
    if fetching.nonce.is_empty()
        && fetching.credentials.is_none()
        && fetching.referrer_policy == ReferrerPolicy::Empty
    {
        return None;
    }
    let (modules, script) = (
        modules(heap),
        (
            Bytes::from(base),
            Fetching {
                integrity: None,
                ..fetching.clone()
            },
        ),
    );
    let known = &mut modules.borrow_mut().classic_scripts;
    let at = known
        .iter()
        .rposition(|it| *it == script)
        .unwrap_or_else(|| {
            known.push(script);
            known.len() - 1
        });
    Some(format!("{CLASSIC}{at}"))
}

pub(super) fn script_was_fetched(heap: &JsHeap<'_>, key: &[u8]) {
    modules(heap).borrow_mut().fetched.insert(key.into(), ());
}

fn compiled_path(heap: &JsHeap<'_>, url: &Url, fetching: &Fetching) -> Option<Vec<u8>> {
    let metadata = Metadata {
        nonce: fetching.nonce.clone(),
        integrity: fetching.integrity.clone().unwrap_or_default(),
        is_parser_inserted: fetching.is_parser_inserted,
        is_prefetch: false,
    };
    client_of(heap)?.compiled_path(url, Destination::Script, &metadata)
}

impl Modules {
    fn classic_script(&self, key: &[u8]) -> Option<&(Bytes, Fetching)> {
        self.classic_scripts.get(
            core::str::from_utf8(key.strip_prefix(CLASSIC.as_bytes())?)
                .ok()?
                .parse::<usize>()
                .ok()?,
        )
    }

    fn url_of(&self, key: &[u8]) -> Option<Url> {
        self.entries
            .get(key)
            .and_then(|it| it.base.clone())
            .or_else(|| Url::parse(self.classic_script(key).map_or(key, |it| &it.0)))
    }

    #[optimize(size)]
    fn resolve<'a>(
        &mut self,
        heap: &JsHeap<'a>,
        specifier: &[u8],
        referrer: Option<&[u8]>,
    ) -> Result<'a, Url> {
        let base = referrer
            .and_then(|it| self.url_of(it))
            .or_else(|| base_url(heap));
        let specifier_text = bstr::BStr::new(specifier);
        match base.ok_or(Unresolved::Bare).and_then(|it| self.import_map.resolve(specifier, &it)) {
            Ok(url) => Ok(url),
            Err(Unresolved::Blocked) => Err(heap.type_error(format_args!("Failed to resolve module specifier \"{specifier_text}\": blocked by the import map"))),
            Err(Unresolved::Bare) => Err(heap.type_error(format_args!(
                "Failed to resolve module specifier \"{specifier_text}\". Relative references must start with either \"/\", \"./\", or \"../\"."
            ))),
        }
    }

    #[optimize(size)]
    fn key_for<'a>(
        &mut self,
        heap: &JsHeap<'a>,
        specifier: &[u8],
        referrer: Option<&[u8]>,
    ) -> Result<'a, Vec<u8>> {
        if self
            .entries
            .get(specifier)
            .is_some_and(|it| it.is_inline || referrer.is_none())
        {
            return Ok(specifier.to_vec());
        }
        let url = self.resolve(heap, specifier, referrer)?;
        let importer = referrer.and_then(|it| self.entries.get(it));
        let inherited = referrer
            .and_then(|it| Some(&self.classic_script(it)?.1))
            .or_else(|| importer.map(|it| &it.fetching));
        let path = match referrer.is_some_and(compiled::is_path) {
            true => compiled::path_of(url.href()),
            false => compiled_path(
                heap,
                &url,
                &Fetching {
                    integrity: None,
                    ..inherited.cloned().unwrap_or_default()
                },
            ),
        };
        if let Some(path) = path {
            return Ok(path);
        }
        if !self.entries.contains_key(url.href()) {
            let referrer = referrer
                .filter(|it| self.fetched.contains_key(*it))
                .and_then(|it| self.url_of(it));
            let fetching = Fetching {
                integrity: None,
                is_for_link: false,
                referrer,
                ..inherited.cloned().unwrap_or_default()
            };
            let blob = if url.scheme() == b"blob" {
                resolve_blob_url(&url)
            } else {
                None
            };
            self.entries.insert(
                url.href().into(),
                Entry {
                    fetching,
                    blob,
                    ..Default::default()
                },
            );
        }
        Ok(url.href().to_vec())
    }

    #[optimize(size)]
    fn request_for(&mut self, client: &Client, url: &Url, kind: ScriptType) -> Request {
        let entry = self.entries.entry(url.href().into()).or_default();
        let initiator = if entry.fetching.is_for_link {
            InitiatorType::Other
        } else {
            InitiatorType::Script
        };
        let mut request = new_request(
            client,
            url.clone(),
            kind.destination(),
            Some(Cors::Anonymous),
            initiator,
        );
        let fetching = entry.fetching.clone();
        request.blob = entry.blob.take().or(request.blob);
        request.credentials = fetching.credentials.unwrap_or(request.credentials);
        request.referrer = fetching.referrer.or(request.referrer);
        (request.referrer_policy, request.blocks_rendering) =
            (fetching.referrer_policy, fetching.blocks_rendering);
        request.metadata.integrity = fetching
            .integrity
            .or_else(|| self.import_map.integrity_of(url).cloned())
            .unwrap_or_default();
        (request.metadata.nonce, request.metadata.is_parser_inserted) =
            (fetching.nonce, fetching.is_parser_inserted);
        request
    }
}

/// <https://html.spec.whatwg.org/#fetch-a-single-module-script>
#[optimize(size)]
fn load(heap: &JsHeap<'_>, key: &[u8], kind: ScriptType) -> Option<Shared<Option<Fetched>>> {
    let modules = modules(heap);
    if let Some(Load::Running(running)) = modules.borrow().loads.get(&(key.into(), kind)) {
        return Some(running.clone());
    }
    let (client, url) = (client_of(heap)?, Url::parse(key)?);
    let request = modules.borrow_mut().request_for(&client, &url, kind);
    let running = Shared::spawn(async move {
        Some(match client.fetch_module(request, kind).await.ok()? {
            Script::FromApp(source) => Fetched {
                url,
                source: source.into(),
                referrer_policy: ReferrerPolicy::Empty,
            },
            Script::Loaded(loaded) => Fetched {
                referrer_policy: loaded.head.referrer_policy(),
                url: loaded.head.url,
                source: loaded.bytes,
            },
        })
    });
    modules
        .borrow_mut()
        .loads
        .insert((key.into(), kind), Load::Running(running.clone()));
    Some(running)
}

fn not_fetched<'a>(heap: &JsHeap<'a>, key: &[u8]) -> bindgen::Error<'a> {
    heap.type_error(format_args!("{NOT_FETCHED}{}", bstr::BStr::new(key)))
}

#[optimize(size)]
fn hand_over<'a>(
    cx: Cx<'_, 'a>,
    key: Bytes,
    kind: ScriptType,
    fetched: Option<Fetched>,
) -> Result<'a, JSValue> {
    let modules = modules(&cx.heap);
    let Some(Fetched {
        url,
        source,
        referrer_policy,
    }) = fetched
    else {
        modules.borrow_mut().loads.remove(&(key.clone(), kind));
        return Err(not_fetched(&cx.heap, &key));
    };
    if let Some(entry) = modules.borrow_mut().entries.get_mut(&key) {
        entry.base = (url.href() != &*key).then(|| url.clone());
        entry.fetching.referrer_policy = referrer_policy.or(entry.fetching.referrer_policy);
    }
    if kind == ScriptType::JavaScriptModule {
        script_was_fetched(&cx.heap, &key);
    }
    modules.borrow_mut().loads.insert((key, kind), Load::Done);
    if kind == ScriptType::CssModule {
        let doc = crate::api::interim::current_document(cx)?;
        return Ok(create_module_sheet(&cx.heap, doc, &source, url.href()).to_js());
    }
    let source = utf8_text(&source);
    if kind == ScriptType::TextModule {
        return Ok(source.to_js(&cx.heap).to_js());
    }
    Ok(Bun__WebRealm__moduleSource(
        cx.global(),
        source.as_impl(),
        &view(url.href()),
        &view(url.href()),
        kind == ScriptType::JsonModule,
        0,
        0,
    ))
}

#[optimize(size)]
fn fetch<'a>(cx: Cx<'_, 'a>, key: Bytes, kind: &[u8]) -> Result<'a, JSValue> {
    let modules = modules(&cx.heap);
    if let Some(source) = modules
        .borrow_mut()
        .entries
        .get_mut(&key)
        .and_then(|it| it.inline_source.take())
    {
        return Ok(JSPromise::resolved_promise_value(cx.global(), source.get()));
    }
    let known = ScriptType::of_module(kind)
        .filter(|it| *it != ScriptType::CssModule || cx.heap.is_window());
    let kind = known.ok_or_else(|| {
        cx.heap.type_error(format_args!(
            "\"{}\" is not a valid module type.",
            bstr::BStr::new(kind)
        ))
    })?;
    let loading = load(&cx.heap, &key, kind).ok_or_else(|| not_fetched(&cx.heap, &key))?;
    Ok(promise_for(cx, loading, move |cx, fetched| {
        hand_over(cx, key, kind, fetched).map(|it| JsLocal::new(&cx.heap, it))
    })
    .to_js())
}

fn in_realm(
    global: &JSGlobalObject,
    steps: impl for<'a> FnOnce(Cx<'_, 'a>) -> Result<'a, JSValue>,
) -> JSValue {
    to_js_host_call(global, || {
        exec::with_realm(global, |cx| -> JsResult<_> {
            steps(cx).map_err(|it| it.into_js_error(cx.global()))
        })
    })
}

/// `referrer` is a string if there is one.
#[unsafe(no_mangle)]
#[optimize(size)]
extern "C" fn Bun__Modules__resolve(
    global: &JSGlobalObject,
    specifier: JSValue,
    referrer: JSValue,
    is_for_loader: bool,
) -> JSValue {
    in_realm(global, |cx| {
        let referrer = referrer
            .is_string()
            .then(|| referrer.to_utf8(global))
            .transpose()?;
        let (modules, specifier) = (modules(&cx.heap), specifier.to_utf8(global)?);
        let resolved = if is_for_loader {
            modules
                .borrow_mut()
                .key_for(&cx.heap, &specifier, referrer.as_deref())?
        } else {
            modules
                .borrow_mut()
                .resolve(&cx.heap, &specifier, referrer.as_deref())?
                .href()
                .to_vec()
        };
        Ok(bun_string_jsc::owned_utf8_into_js(global, resolved)?)
    })
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Modules__fetch(
    global: &JSGlobalObject,
    key: JSValue,
    kind: &bun_core::String,
) -> JSValue {
    in_realm(global, |cx| {
        fetch(cx, (*key.to_utf8(global)?).into(), &kind.to_utf8())
    })
}

#[unsafe(no_mangle)]
#[optimize(size)]
extern "C" fn Bun__Modules__urlOf(global: &JSGlobalObject, key: JSValue) -> JSValue {
    in_realm(global, |cx| {
        let (key, modules) = (key.to_utf8(global)?, modules(&cx.heap));
        let url = modules.borrow().url_of(&key);
        Ok(bun_string_jsc::create_utf8_for_js(
            global,
            url.as_ref().map_or(&key, Url::href),
        )?)
    })
}

pub(super) enum Module {
    Loaded(Bytes),
    Compiled(Vec<u8>),
    /// With what is reported when it is its turn.
    Broken(Strong),
    OfProgram(Url),
    InlineOfProgram(DomString),
}

fn import<'a>(cx: Cx<'_, 'a>, url: &[u8]) -> Result<'a, JSValue> {
    unsafe extern "C" {
        safe fn Bun__DesktopRealm__import(
            global: &JSGlobalObject,
            url: &bun_core::String,
        ) -> JSValue;
    }
    let (global, url) = (cx.global(), bun_core::String::clone_utf8(url));
    Ok(from_js_host_call(global, || {
        Bun__DesktopRealm__import(global, &url)
    })?)
}

fn import_source<'a>(cx: Cx<'_, 'a>, source: &DomString) -> Result<'a, JSValue> {
    fn reclaim<'a>(
        cx: Cx<'_, 'a>,
        [url, _]: [JsLocal<'a>; 2],
        _: u64,
        _: &[JsLocal<'a>],
    ) -> Result<'a, JSValue> {
        runtime::reclaim_module(&url.to_js().to_utf8(cx.global())?);
        Ok(JSValue::UNDEFINED)
    }
    let url = runtime::lend_module(cx.global(), source.to_utf8().into_owned().into_bytes());
    let imported = import(cx, &url)?;
    let url = bun_string_jsc::create_utf8_for_js(cx.global(), &url)?;
    let reclaim = cx
        .heap
        .create_callback(reclaim, [url, JSValue::UNDEFINED], 0);
    JsLocal::new(&cx.heap, imported)
        .as_promise()
        .into_iter()
        .for_each(|it| it.react(&cx.heap, Some(reclaim), Some(reclaim)));
    Ok(imported)
}

impl Module {
    #[optimize(size)]
    fn evaluate<'a>(self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let global = cx.global();
        match self {
            Module::Loaded(key) => Ok(from_js_host_call(global, || {
                Bun__WebRealm__evaluateModule(global, &view(&key))
            })?),
            Module::OfProgram(url) => import(cx, url.href()),
            Module::InlineOfProgram(source) => import_source(cx, &source),
            Module::Compiled(path) => run_compiled(cx, &path, false),
            Module::Broken(error) => Err(bindgen::Error::from_value(JsLocal::new(
                &cx.heap,
                error.get(),
            ))),
        }
    }

    /// <https://html.spec.whatwg.org/#run-a-module-script>
    #[optimize(size)]
    pub(super) fn run(self, cx: Cx<'_, '_>) {
        fn report<'a>(
            cx: Cx<'_, 'a>,
            _: [JsLocal<'a>; 2],
            _: u64,
            reason: &[JsLocal<'a>],
        ) -> Result<'a, JSValue> {
            report_error(cx, bindgen::Error::from_value(reason[0]), b"");
            Ok(JSValue::UNDEFINED)
        }
        let evaluated = match self.evaluate(cx) {
            Ok(evaluated) => evaluated,
            Err(error) => {
                let Ok(error) = cx.catch(error) else { return };
                JSPromise::rejected_promise(cx.global(), error).to_js()
            }
        };
        let report = cx.heap.create_callback(report, [JSValue::UNDEFINED; 2], 0);
        if let Some(it) = JsLocal::new(&cx.heap, evaluated).as_promise() {
            it.react(&cx.heap, None, Some(report));
        }
    }
}

fn was_not_fetched(cx: Cx<'_, '_>, error: JSValue) -> bool {
    let message = error
        .is_any_error()
        .then(|| error.get_own(cx.global(), &view(b"message")).ok()?)
        .flatten()
        .filter(|it| it.is_string());
    message
        .and_then(|it| it.to_utf8(cx.global()).ok())
        .is_some_and(|it| strings::has_prefix(&it, NOT_FETCHED.as_bytes()))
}

/// With what it imports. `None` if some of that could not be fetched.
#[optimize(size)]
fn load_graph(cx: Cx<'_, '_>, key: Bytes) -> impl Future<Output = Option<Module>> + use<> {
    let realm = exec::Realm::of(cx);
    let global = cx.global();
    let promise = from_js_host_call(global, || Bun__WebRealm__loadModule(global, &view(&key)))
        .map_err(|it| exec::caught(cx, it.into()))
        .ok();
    let loading = promise.map(|it| exec::settled(cx, JsLocal::new(&cx.heap, it)));
    async move {
        match loading?.await {
            Ok(_) => Some(Module::Loaded(key)),
            Err(error) => (!realm.enter(|cx| was_not_fetched(cx, error.get())))
                .then_some(Module::Broken(error)),
        }
    }
}

/// <https://html.spec.whatwg.org/#fetch-a-module-script-tree>
#[optimize(size)]
pub(super) fn prepare(cx: Cx<'_, '_>, url: &Url, fetching: Fetching) -> Receiver<Option<Module>> {
    if let Some(path) = compiled_path(&cx.heap, url, &fetching) {
        return start(&cx.heap, async { Some(Module::Compiled(path)) });
    }
    let modules = modules(&cx.heap);
    if !modules
        .borrow()
        .loads
        .contains_key(&(url.href().into(), ScriptType::JavaScriptModule))
    {
        modules
            .borrow_mut()
            .entries
            .entry(url.href().into())
            .or_default()
            .fetching = fetching;
    }
    let loading = load_graph(cx, url.href().into());
    start(&cx.heap, loading)
}

/// <https://html.spec.whatwg.org/#fetch-an-inline-module-script-graph>
pub(super) fn prepare_inline(
    cx: Cx<'_, '_>,
    Inline {
        source,
        url,
        base,
        position: (line, column),
    }: Inline,
    fetching: Fetching,
) -> Receiver<Option<Module>> {
    let modules = modules(&cx.heap);
    let key = Bytes::from(format!("inline-module:{}", modules.borrow().inline_count).as_bytes());
    modules.borrow_mut().inline_count += 1;
    let source = Bun__WebRealm__moduleSource(
        cx.global(),
        source.as_impl(),
        &view(&url),
        &view(&key),
        false,
        line,
        column,
    );
    let inline_source = Some(Strong::create(source, cx.global()));
    modules.borrow_mut().entries.insert(
        key.clone(),
        Entry {
            fetching,
            base: Url::parse(&base),
            is_inline: true,
            inline_source,
            blob: None,
        },
    );
    let loading = load_graph(cx, key);
    start(&cx.heap, loading)
}

/// Without what it imports. Whether it has arrived.
#[optimize(size)]
pub(super) fn preload(
    heap: &JsHeap<'_>,
    url: &Url,
    kind: ScriptType,
    fetching: Fetching,
) -> impl Future<Output = bool> + use<> {
    let (modules, id) = (modules(heap), (Bytes::from(url.href()), kind));
    let is_there = compiled_path(heap, url, &fetching).is_some()
        || matches!(modules.borrow().loads.get(&id), Some(Load::Done));
    let loading = (!is_there).then(|| {
        modules
            .borrow_mut()
            .entries
            .entry(id.0.clone())
            .or_insert_with(|| Entry {
                fetching,
                ..Default::default()
            });
        load(heap, &id.0, kind)
    });
    async move {
        let has_arrived = match loading {
            Some(Some(loading)) => loading.await.is_some(),
            other => other.is_none(),
        };
        if !has_arrived {
            modules.borrow_mut().loads.remove(&id);
        }
        has_arrived
    }
}

#[optimize(size)]
fn members<'a, T>(
    cx: Cx<'_, 'a>,
    object: JSValue,
    mut convert: impl FnMut(Cx<'_, 'a>, JSValue) -> Result<'a, T>,
) -> Result<'a, Vec<(Vec<u8>, T)>> {
    let record = object
        .get_object()
        .filter(|_| !object.is_array())
        .ok_or_else(|| {
            cx.heap.type_error(format_args!(
                "An import map and its parts have to be objects."
            ))
        })?;
    let (mut all, iterator) = (
        Vec::new(),
        JSPropertyIterator::init(
            cx.global(),
            record,
            JSPropertyIteratorOptions::new(false, true),
        )?,
    );
    while let Some((name, value)) = iterator.next()? {
        all.push((name.to_owned_slice(), value));
    }
    drop(iterator);
    all.into_iter()
        .map(|(name, value)| Ok((name, convert(cx, value)?)))
        .collect()
}

fn addresses<'a>(cx: Cx<'_, 'a>, object: JSValue) -> Result<'a, Given> {
    members(cx, object, |cx, it| {
        Ok(it
            .is_string()
            .then(|| it.to_utf8(cx.global()))
            .transpose()?
            .map(|it| it.to_vec()))
    })
}

/// <https://html.spec.whatwg.org/#register-an-import-map>
#[optimize(size)]
pub(super) fn add_import_map<'a>(cx: Cx<'_, 'a>, source: &DomString, base: &Url) -> Result<'a> {
    let map = bun_core::String::clone_utf8(source.to_utf8().as_bytes())
        .to_js_by_parse_json(cx.global())?;
    let parts = members(cx, map, |_, it| Ok(it))?;
    let part = |name: &[u8]| parts.iter().find(|it| it.0 == name).map(|it| it.1);
    let imports = part(b"imports")
        .map(|it| addresses(cx, it))
        .transpose()?
        .unwrap_or_default();
    let scopes = part(b"scopes")
        .map(|it| members(cx, it, addresses))
        .transpose()?
        .unwrap_or_default();
    let integrity = part(b"integrity")
        .map(|it| addresses(cx, it))
        .transpose()?
        .unwrap_or_default();
    map.ensure_still_alive();
    modules(&cx.heap)
        .borrow_mut()
        .import_map
        .add(&imports, &scopes, &integrity, base);
    Ok(())
}

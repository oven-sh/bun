//! The scripts of workers and of worklets.

use bun_web::client::{Script, ScriptType};
use bun_web::compiled::{self, Form};
use bun_web::realm::Scope;
use bun_web::request::Credentials;
use bun_web::streams::promise_for;

use super::modules::{Fetching, Inline, Module};
use super::*;
use crate::api::events::{is_parse_error_of, run_script};
use crate::api::network::parse_url;
use crate::api::realm::realm_of;
use crate::api::trusted::Trusted;

#[derive(Default)]
struct IsModule(Cell<bool>);

pub(crate) struct WorkerScript(Kind);

enum Kind {
    Classic(SharedBytes),
    CompiledClassic(Vec<u8>),
    Module(Module),
}

/// <https://html.spec.whatwg.org/#fetch-a-module-worker-script-tree>. Without `source`, it was compiled. `None` if the worker cannot start.
pub(crate) fn prepare_worker_script(
    cx: Cx<'_, '_>,
    source: Option<SharedBytes>,
    is_module: bool,
    credentials: Credentials,
) -> impl Future<Output = Option<WorkerScript>> + use<> {
    realm_of(&cx.heap).extra::<IsModule>().0.set(is_module);
    let url = realm_of(&cx.heap).client().map(|it| it.url());
    let preparing = source
        .as_ref()
        .filter(|_| is_module)
        .zip(url.as_ref())
        .map(|(source, url)| {
            let inline = Inline {
                source: utf8_text(source),
                url: url.href().into(),
                base: url.href().into(),
                position: (0, 0),
            };
            modules::prepare_inline(
                cx,
                inline,
                Fetching {
                    credentials: Some(credentials),
                    ..Default::default()
                },
            )
        });
    async move {
        Some(WorkerScript(match (preparing, source) {
            (Some(preparing), _) => Kind::Module(
                preparing
                    .await
                    .flatten()
                    .filter(|it| !matches!(it, Module::Broken(_)))?,
            ),
            (None, Some(source)) => Kind::Classic(source),
            (None, None) => match compiled::path_of(
                url?.href(),
                if is_module {
                    Form::Module
                } else {
                    Form::Classic
                },
            )? {
                path if compiled::is_classic_script(&path) => Kind::CompiledClassic(path),
                path => Kind::Module(Module::Compiled(path)),
            },
        }))
    }
}

fn run_compiled<'a>(cx: Cx<'_, 'a>, path: &[u8], url: &[u8]) -> Result<'a> {
    modules::will_run_compiled(&cx.heap, path, url, &Default::default());
    match modules::run_compiled_classic(cx, path)? {
        Some(text) => modules::evaluate_classic(cx, &text, url, url, (0, 0)).map(drop),
        None => Ok(()),
    }
}

/// False if it has to run for the worker to start, and does not.
pub(crate) fn run_worker_script(cx: Cx<'_, '_>, script: WorkerScript, scope: Scope) -> bool {
    let Some(client) = client_of(&cx.heap) else {
        return false;
    };
    client.worker_has_started();
    let run = |cx: Cx<'_, '_>, evaluate: &dyn for<'a> Fn(Cx<'_, 'a>, &[u8]) -> Result<'a>| {
        let (url, mut has_run) = (client.url(), true);
        run_script(cx, |cx| {
            if let Err(error) = evaluate(cx, url.href())
                && let Ok(error) = cx.catch(error)
            {
                has_run = scope == Scope::DedicatedWorker
                    || !is_parse_error_of(cx.global(), error, url.href());
                if has_run {
                    report_to_realm(cx, error, None, url.href());
                }
                has_run &= scope != Scope::ServiceWorker;
            }
        });
        has_run
    };
    match script.0 {
        Kind::Module(module) => {
            module.run(cx) == bun_jsc::js_promise::Status::Fulfilled
                || scope != Scope::ServiceWorker
        }
        Kind::Classic(source) => run(cx, &|cx, url| {
            modules::evaluate_classic(cx, &utf8_text(&source), url, url, (0, 0)).map(drop)
        }),
        Kind::CompiledClassic(path) => run(cx, &|cx, url| run_compiled(cx, &path, url)),
    }
}

#[optimize(size)]
fn import_script<'a>(cx: Cx<'_, 'a>, url: &Url) -> Result<'a> {
    let failed = |cx: Cx<'_, 'a>, verb| {
        cx.heap.dom_exception(
            DomError::NetworkError,
            format_args!(
                "The script at '{}' failed to {verb}.",
                bstr::BStr::new(url.href())
            ),
        )
    };
    if let Some(path) = client_of(&cx.heap).and_then(|it| {
        it.compiled_path(url, Form::Classic, Destination::Script, &Default::default())
    }) {
        return run_compiled(cx, &path, url.href());
    }
    let fetching = realm_of(&cx.heap).client().map(|client| {
        let request = new_request(
            &client,
            url.clone(),
            Destination::Script,
            None,
            InitiatorType::Script,
        );
        async move { client.fetch_script(request, ScriptType::Classic).await }
    });
    let Some(Ok(Script::Loaded(loaded))) = fetching.and_then(|it| exec::park_until(it, None))
    else {
        return Err(failed(cx, "load"));
    };
    let (source, own) = (utf8_text(&loaded.bytes), loaded.head.url.href());
    if !loaded.head.is_cors_cross_origin() {
        modules::script_was_fetched(&cx.heap, own);
    }
    match modules::evaluate_classic(
        cx,
        &source,
        own,
        if loaded.head.is_cors_cross_origin() {
            b"about:blank"
        } else {
            own
        },
        (0, 0),
    ) {
        Err(error) if loaded.head.is_cors_cross_origin() => {
            Err(cx.catch(error).map_or_else(|it| it, |_| failed(cx, "run")))
        }
        result => result.map(drop),
    }
}

impl ImportingScope {
    /// <https://html.spec.whatwg.org/#import-scripts-into-worker-global-scope>
    #[optimize(size)]
    pub(crate) fn import_scripts<'a>(&'a self, cx: Cx<'_, 'a>, urls: &[JsLocal<'a>]) -> Result<'a> {
        let given = urls
            .iter()
            .map(|it| {
                Trusted::ScriptUrl.string_in_realm_of(
                    cx,
                    &**self,
                    *it,
                    "WorkerGlobalScope importScripts",
                )
            })
            .collect::<Result<'a, Vec<_>>>()?;
        if realm_of(&cx.heap).extra::<IsModule>().0.get() {
            return Err(cx.heap.type_error(format_args!(
                "Module scripts don't support importScripts()."
            )));
        }
        let parsed = given
            .iter()
            .map(|it| parse_url(&cx.heap, it))
            .collect::<Option<Vec<_>>>();
        let parsed = parsed
            .ok_or_else(|| dom_error(&cx.heap, DomError::SyntaxError, "The URL is invalid."))?;
        parsed.iter().try_for_each(|it| import_script(cx, it))
    }
}

/// A promise of its text.
#[optimize(size)]
pub(crate) fn fetch_audio_worklet<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    url: &DomString,
    credentials: Credentials,
) -> JSValue {
    let fetching = doc
        .client(&cx.heap)
        .zip(Url::parse(url.to_utf8().as_bytes()))
        .map(|(client, url)| {
            let mut request = new_request(
                &client,
                url,
                Destination::AudioWorklet,
                Some(Cors::Anonymous),
                InitiatorType::Script,
            );
            request.credentials = credentials;
            async move {
                client
                    .fetch_script(request, ScriptType::JavaScriptModule)
                    .await
                    .ok()
            }
        });
    let fetching = promise_for(cx, async { fetching?.await }, |cx, script| {
        let script = script.ok_or_else(|| {
            dom_error(
                &cx.heap,
                DomError::AbortError,
                "The module could not be loaded.",
            )
        })?;
        Ok(utf8_text(&script.into_source()).to_js(&cx.heap).as_value())
    });
    fetching.to_js()
}

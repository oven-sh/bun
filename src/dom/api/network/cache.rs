//! <https://w3c.github.io/ServiceWorker/#cache-objects>

use std::sync::Arc;

use bun_jsc::bindgen::JsList;
use bun_web::exec::{self, Either};
use bun_web::headers::split;
use bun_web::net::fetch::Controller;
use bun_web::net::response::{Head, ResponseType, is_ok_status};
use bun_web::request::{InitiatorType, Navigation};
use bun_web::storage::caches::{
    CacheId, CachedRequest, CachedResponse, Caches, PutError, QueryOptions,
};
use bun_web::storage::key::{self, Token};

use super::body::Content;
use super::fetch::follow;
use super::headers::Guard;
use super::request::{Options, Parts};
use super::response::About;
use super::*;
use crate::api::realm::promise_for;

fn caches<'a>(heap: &JsHeap<'a>) -> Result<'a, Caches> {
    let client = last_client_of(heap).filter(|it| !it.origin().is_opaque());
    let client = client.ok_or_else(|| {
        dom_error(
            heap,
            DomError::SecurityError,
            "Cache storage is disabled in this context.",
        )
    })?;
    Ok(Caches {
        storage: Arc::clone(&client.session.storage),
        bucket: client.bucket().into(),
    })
}

fn broken<'a>(heap: &JsHeap<'a>) -> Error<'a> {
    dom_error(
        heap,
        DomError::UnknownError,
        "Internal error of the backing store.",
    )
}

#[optimize(size)]
fn later<'a, T: 'static, E: 'static>(
    cx: Cx<'_, 'a>,
    asking: impl Future<Output = core::result::Result<T, E>> + 'static,
    convert: impl for<'b> FnOnce(&JsHeap<'b>, T) -> Result<'b, JSValue> + 'static,
) -> Result<'a, JSValue> {
    Ok(promise_for(cx, asking, |cx, result| {
        convert(&cx.heap, result.map_err(|_| broken(&cx.heap))?)
    }))
}

fn boolean<'a>(_: &JsHeap<'a>, value: bool) -> Result<'a, JSValue> {
    Ok(value.into())
}

fn frozen<'a, T>(
    heap: &JsHeap<'a>,
    items: Vec<T>,
    convert: fn(&JsHeap<'a>, T) -> JSValue,
) -> Result<'a, JSValue> {
    Ok(heap
        .freeze_array(
            heap.create_array(items, |heap, it| Ok(JsLocal::new(heap, convert(heap, it))))?,
        )?
        .to_js())
}

pub(crate) fn encode_cache_name(name: &DomString) -> Vec<u8> {
    let mut encoded = Vec::new();
    key::push_string(&mut encoded, name.units().collect::<Vec<_>>().into_iter());
    encoded
}

fn describe<'a>(heap: &JsHeap<'a>, request: &DomRequestInfo<'a>) -> Result<'a, CachedRequest> {
    Ok(match request {
        DomRequestInfo::Request(it) => {
            let navigation = it.options.navigation as u8;
            CachedRequest {
                url: it.options.url.href().into(),
                method: it.options.method.clone(),
                headers: it.headers.list().clone(),
                navigation,
            }
        }
        DomRequestInfo::Url(url) => CachedRequest {
            url: request::parse(heap, &DomString::from(*url))?.href().into(),
            method: b"GET"[..].into(),
            headers: HeaderList::default(),
            navigation: 0,
        },
    })
}

fn storable<'a>(heap: &JsHeap<'a>, request: &DomRequestInfo<'a>) -> Result<'a, CachedRequest> {
    Some(describe(heap, request)?)
        .filter(|it| it.url.starts_with(b"http") && *it.method == *b"GET")
        .ok_or_else(|| type_error(heap, "Only GET requests of HTTP(S) can be stored."))
}

struct Query {
    request: Option<CachedRequest>,
    options: QueryOptions,
}

/// `None` if nothing can match.
fn query<'a>(
    heap: &JsHeap<'a>,
    request: Option<&DomRequestInfo<'a>>,
    options: &CacheQueryOptions,
) -> Result<'a, Option<Query>> {
    let request = request.map(|it| describe(heap, it)).transpose()?;
    let can_match =
        options.ignore_method || request.as_ref().is_none_or(|it| *it.method == *b"GET");
    Ok(can_match.then_some(Query {
        request,
        options: QueryOptions {
            ignores_search: options.ignore_search,
            ignores_vary: options.ignore_vary,
        },
    }))
}

async fn unless_none<T: Default, E>(
    asking: Option<impl Future<Output = core::result::Result<T, E>>>,
) -> core::result::Result<T, E> {
    match asking {
        Some(asking) => asking.await,
        None => Ok(T::default()),
    }
}

fn restore_request(heap: &JsHeap<'_>, it: CachedRequest) -> JSValue {
    let Some(mut options) = Url::parse(&it.url).map(Options::new) else {
        return JSValue::UNDEFINED;
    };
    options.navigation = [Navigation::Reload, Navigation::History]
        .into_iter()
        .find(|kind| *kind as u8 == it.navigation)
        .unwrap_or(Navigation::Other);
    Request::new(heap, options, it.headers, Guard::Immutable, Content::Null).to_js()
}

fn restore_response(heap: &JsHeap<'_>, it: CachedResponse) -> JSValue {
    let kinds: [&'static [u8]; 5] = [b"basic", b"cors", b"error", b"opaque", b"opaqueredirect"];
    let kind = kinds
        .into_iter()
        .find(|kind| **kind == *it.kind)
        .unwrap_or(b"default");
    if let Some((kind, url)) = ResponseType::parse(kind)
        .filter(|it| it.as_bytes().starts_with(b"opaque"))
        .zip(Url::parse(&it.url))
    {
        let head = Head {
            status: it.status,
            status_text: it.status_text,
            redirects: it.is_redirected.into(),
            includes_credentials: !it.omits_credentials,
            ..Head::new(kind, url, it.headers)
        };
        let response = Response::new(
            heap,
            About::of(&head),
            HeaderList::default(),
            Guard::Immutable,
            Default::default(),
        );
        it.body.into_iter().for_each(|it| response.hide(it));
        return response.to_js();
    }
    let about = About {
        kind,
        url: it.url,
        is_redirected: it.is_redirected,
        status: it.status,
        status_text: it.status_text,
        internal: None,
    };
    Response::new(
        heap,
        about,
        it.headers,
        Guard::Immutable,
        it.body.map(Into::into).unwrap_or_default(),
    )
    .to_js()
}

fn first<'a>(
    heap: &JsHeap<'a>,
    found: impl IntoIterator<Item = CachedResponse>,
) -> Result<'a, JSValue> {
    Ok(found
        .into_iter()
        .next()
        .map_or(JSValue::UNDEFINED, |it| restore_response(heap, it)))
}

/// Without its body.
#[optimize(size)]
fn to_store(
    about: About,
    headers: HeaderList,
) -> core::result::Result<CachedResponse, &'static str> {
    if about.status == 206 {
        return Err("Partial response (status code 206) is unsupported");
    }
    if split(&headers.get_or_empty(b"vary"), b',').any(|it| it.trim_ascii() == b"*") {
        return Err("Vary header contains *");
    }
    let About {
        kind,
        url,
        is_redirected,
        status,
        status_text,
        internal,
    } = about;
    if let Some(it) = internal.filter(|it| it.is_cors_cross_origin()) {
        let (url, mut headers) = (it.url.without_fragment().into(), it.headers.clone());
        headers.delete(b"vary");
        headers.delete(b"set-cookie");
        return Ok(CachedResponse {
            kind: kind.into(),
            url,
            is_redirected: it.redirects > 0,
            omits_credentials: !it.includes_credentials,
            status: it.status,
            status_text: it.status_text.clone(),
            headers,
            body: None,
        });
    }
    Ok(CachedResponse {
        kind: kind.into(),
        url,
        is_redirected,
        omits_credentials: false,
        status,
        status_text,
        headers,
        body: None,
    })
}

#[optimize(size)]
fn stored<'a>(
    heap: &JsHeap<'a>,
    result: &core::result::Result<(), PutError>,
) -> Result<'a, JSValue> {
    match result {
        Ok(()) => Ok(JSValue::UNDEFINED),
        Err(PutError::Duplicate) => Err(dom_error(
            heap,
            DomError::InvalidStateError,
            "Duplicate requests.",
        )),
        Err(PutError::Sql(_)) => Err(broken(heap)),
    }
}

pub(crate) struct Cache(CacheId);

impl Cache {
    pub(crate) fn find<'a>(
        &self,
        cx: Cx<'_, 'a>,
        request: DomRequestInfo<'a>,
        options: &CacheQueryOptions,
    ) -> Result<'a, JSValue> {
        let (query, caches) = (query(&cx.heap, Some(&request), options)?, caches(&cx.heap)?);
        later(
            cx,
            unless_none(query.map(|it| caches.responses(self.0, it.request, it.options, 1))),
            first,
        )
    }

    pub(crate) fn match_all<'a>(
        &self,
        cx: Cx<'_, 'a>,
        request: Option<DomRequestInfo<'a>>,
        options: &CacheQueryOptions,
    ) -> Result<'a, JSValue> {
        let (query, caches) = (
            query(&cx.heap, request.as_ref(), options)?,
            caches(&cx.heap)?,
        );
        later(
            cx,
            unless_none(
                query.map(|it| caches.responses(self.0, it.request, it.options, usize::MAX)),
            ),
            |heap, found| frozen(heap, found, restore_response),
        )
    }

    #[optimize(size)]
    fn fetch_all<'a>(
        &self,
        cx: Cx<'_, 'a>,
        requests: &[DomRequestInfo<'a>],
    ) -> Result<'a, JSValue> {
        let keys = requests
            .iter()
            .map(|it| storable(&cx.heap, it))
            .collect::<Result<'a, Vec<_>>>()?;
        let (caches, id, controller) = (caches(&cx.heap)?, self.0, Controller::default());
        let client = client_of(&cx.heap).ok_or_else(|| body::failure(cx, None))?;
        let (mut fetching, mut followed) = (Vec::with_capacity(keys.len()), Vec::new());
        for (request, key) in requests.iter().zip(keys) {
            let Parts {
                options,
                headers,
                signal,
                ..
            } = Parts::of(cx, request)?;
            if let Some(signal) = signal.filter(|it| it.is_aborted()) {
                return Err(Error::from_value(JsLocal::new(
                    &cx.heap,
                    signal.reason(&cx.heap),
                )));
            }
            followed.extend(signal.map(|it| follow(cx, it, &controller)));
            let request =
                options.into_request(&client, headers.list().clone(), InitiatorType::Fetch);
            let (client, controller) = (Rc::clone(&client), controller.clone());
            fetching.push(async move {
                let loaded = client
                    .fetch_whole(request, &controller)
                    .await
                    .map_err(|_| "Failed to fetch")?;
                let about = Some(About::of(&loaded.head))
                    .filter(|it| is_ok_status(it.status))
                    .ok_or("Request failed")?;
                Ok((
                    key,
                    CachedResponse {
                        body: Some(loaded.bytes.to_vec()),
                        ..to_store(about, loaded.head.exposed_headers())?
                    },
                ))
            });
        }
        let storing = async move {
            match exec::try_all(fetching).await {
                Ok(entries) => Either::First(caches.put(id, entries).await),
                Err(problem) => Either::Second(problem),
            }
        };
        Ok(promise_for(cx, storing, move |cx, result| match result {
            Either::First(result) => stored(&cx.heap, &result),
            Either::Second(problem) => Err(followed
                .iter()
                .find_map(|it| it.reason(&cx.heap))
                .unwrap_or_else(|| type_error(&cx.heap, problem))),
        }))
    }

    pub(crate) fn add<'a>(
        &self,
        cx: Cx<'_, 'a>,
        request: DomRequestInfo<'a>,
    ) -> Result<'a, JSValue> {
        self.fetch_all(cx, core::slice::from_ref(&request))
    }

    pub(crate) fn add_all<'a>(
        &self,
        cx: Cx<'_, 'a>,
        requests: JsList<'a, DomRequestInfo<'a>>,
    ) -> Result<'a, JSValue> {
        self.fetch_all(cx, &requests.iter().collect::<Vec<_>>())
    }

    #[optimize(size)]
    pub(crate) fn put<'a>(
        &self,
        cx: Cx<'_, 'a>,
        request: DomRequestInfo<'a>,
        response: &'a Response,
    ) -> Result<'a, JSValue> {
        let (key, caches, id) = (storable(&cx.heap, &request)?, caches(&cx.heap)?, self.0);
        let head = to_store(response.about.clone(), response.headers.list().clone())
            .map_err(|it| type_error(&cx.heap, it))?;
        let (has_body, reading, hidden) = (
            response.has_body(),
            response.read_all(cx)?,
            response.read_hidden(),
        );
        let storing = async move {
            let bytes = reading.await?.into_vec();
            let body = match hidden {
                Some(hidden) => Some(hidden.await.ok_or(body::ReadError::Network(None))?.to_vec()),
                None => has_body.then_some(bytes),
            };
            Ok(caches
                .put(id, vec![(key, CachedResponse { body, ..head })])
                .await)
        };
        Ok(promise_for(
            cx,
            storing,
            |cx, result: core::result::Result<_, body::ReadError>| {
                let result = result.map_err(|it| it.into_error(cx))?;
                stored(&cx.heap, &result)
            },
        ))
    }

    pub(crate) fn delete<'a>(
        &self,
        cx: Cx<'_, 'a>,
        request: DomRequestInfo<'a>,
        options: &CacheQueryOptions,
    ) -> Result<'a, JSValue> {
        let (query, caches) = (query(&cx.heap, Some(&request), options)?, caches(&cx.heap)?);
        later(
            cx,
            unless_none(query.and_then(|it| Some(caches.remove(self.0, it.request?, it.options)))),
            boolean,
        )
    }

    pub(crate) fn keys<'a>(
        &self,
        cx: Cx<'_, 'a>,
        request: Option<DomRequestInfo<'a>>,
        options: &CacheQueryOptions,
    ) -> Result<'a, JSValue> {
        let (query, caches) = (
            query(&cx.heap, request.as_ref(), options)?,
            caches(&cx.heap)?,
        );
        later(
            cx,
            unless_none(query.map(|it| caches.requests(self.0, it.request, it.options))),
            |heap, found| frozen(heap, found, restore_request),
        )
    }
}

pub(crate) struct CacheStorage;

impl CacheStorage {
    pub(crate) fn find<'a>(
        &self,
        cx: Cx<'_, 'a>,
        request: DomRequestInfo<'a>,
        options: &MultiCacheQueryOptions,
    ) -> Result<'a, JSValue> {
        let &MultiCacheQueryOptions {
            ignore_method,
            ignore_search,
            ignore_vary,
            cache_name,
        } = options;
        let (query, caches) = (
            query(
                &cx.heap,
                Some(&request),
                &CacheQueryOptions {
                    ignore_method,
                    ignore_search,
                    ignore_vary,
                },
            )?,
            caches(&cx.heap)?,
        );
        let name = cache_name.map(|it| encode_cache_name(&it.into()));
        later(
            cx,
            unless_none(
                query.and_then(|it| Some(caches.first_response(name, it.request?, it.options))),
            ),
            first,
        )
    }

    pub(crate) fn has<'a>(&self, cx: Cx<'_, 'a>, name: &DomString) -> Result<'a, JSValue> {
        let asking = caches(&cx.heap)?.has(encode_cache_name(name));
        later(cx, asking, boolean)
    }

    pub(crate) fn open<'a>(&self, cx: Cx<'_, 'a>, name: &DomString) -> Result<'a, JSValue> {
        let asking = caches(&cx.heap)?.open(encode_cache_name(name));
        later(cx, asking, |heap, id| {
            Ok(js_Cache::create(heap, Cache(id)).to_js())
        })
    }

    pub(crate) fn delete<'a>(&self, cx: Cx<'_, 'a>, name: &DomString) -> Result<'a, JSValue> {
        let asking = caches(&cx.heap)?.delete(encode_cache_name(name));
        later(cx, asking, boolean)
    }

    #[optimize(size)]
    pub(crate) fn keys<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let asking = caches(&cx.heap)?.names();
        later(cx, asking, |heap, names| {
            let decode = |name: &Bytes| match key::read_token(&mut &**name) {
                Some(Token::String(units)) => DomString::from_utf16(&units).to_js(heap).to_js(),
                _ => JSValue::UNDEFINED,
            };
            Ok(heap
                .create_array(&names, |heap, it| Ok(JsLocal::new(heap, decode(it))))?
                .to_js())
        })
    }
}

impl crate::generated_bindgen::window::WindowOrWorkerGlobalScope {
    pub(crate) fn get_caches<'a>(&'a self, heap: &JsHeap<'a>) -> &'a CacheStorage {
        let realm = self.realm(heap);
        CacheStorage::of_realm(realm).unwrap_or_else(|| {
            let made = js_CacheStorage::create(realm, CacheStorage);
            made.set_of_realm(realm);
            made
        })
    }
}

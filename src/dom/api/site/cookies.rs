//! <https://cookiestore.spec.whatwg.org/>

use core::fmt::Write as _;

use bun_core::strings::contains_char;
use bun_web::net::cookies::{Change, Cookie, SameSite};

use super::*;

const LONGEST_ATTRIBUTE: usize = 1024;

bun_ui::state!(fn stores() -> Addressees);

fn trimmed(text: &[u8]) -> &str {
    crate::values::text(text).trim_matches(['\t', ' '])
}

fn describe<'a>(heap: &JsHeap<'a>, cookie: &Cookie, is_removed: bool) -> JsLocal<'a> {
    let string = |it: &[u8]| text(it).to_js(heap).to_js();
    let same_site = match cookie.same_site {
        SameSite::None => "none",
        SameSite::Strict => "strict",
        SameSite::Lax | SameSite::Unspecified => "lax",
    };
    let item = heap.create_empty_object();
    for (name, value) in [
        (
            "domain",
            if cookie.is_host_only {
                JSValue::NULL
            } else {
                string(&cookie.domain)
            },
        ),
        (
            "expires",
            cookie
                .expires
                .map_or(JSValue::NULL, |it| JSValue::js_number(it * 1000.0)),
        ),
        ("name", string(&cookie.name)),
        ("partitioned", cookie.partition.is_some().into()),
        ("path", string(&cookie.path)),
        ("sameSite", string(same_site.as_bytes())),
        ("secure", cookie.is_secure.into()),
        (
            "value",
            if is_removed {
                JSValue::UNDEFINED
            } else {
                string(&cookie.value)
            },
        ),
    ] {
        item.to_js().put(global_of(heap), name.as_bytes(), value);
    }
    item.as_value()
}

fn tell(client: &Client, change: &Change) {
    let change = change.clone();
    stores().queue_task(client.id.0, move |cx, store| {
        let Some(store) = CookieStore::from_js(&cx.heap, store.to_js()) else {
            return;
        };
        let (is_removed, event) = (
            change.cause.removes(),
            js_CookieChangeEvent::create(
                &cx.heap,
                Event::base(atom!("change"), Default::default(), Trusted::Yes),
            ),
        );
        let item = describe(&cx.heap, &change.cookie, is_removed).to_js();
        match event.set_lists(
            &cx.heap,
            (!is_removed).then_some(item),
            is_removed.then_some(item),
        ) {
            Ok(()) => drop(dispatch(cx, store, event)),
            Err(error) => report_exception(cx, error),
        }
    });
}

impl WindowOfSite {
    pub(crate) fn get_cookie_store<'a>(&'a self, cx: Cx<'_, 'a>) -> &'a CookieStore {
        if let Some(store) = CookieStore::of_realm(self.realm(&cx.heap)) {
            return store;
        }
        let store = one_per_realm!(self.realm(&cx.heap), CookieStore, js_CookieStore);
        if let Some(client) = client_of(self.realm(&cx.heap)) {
            bun_web::exec::with_realm(global_of(self.realm(&cx.heap)), |cx| {
                stores().add(cx, client.id.0, store.to_js())
            });
            client.watch_cookies(tell);
        }
        store
    }
}

struct Wanted<'s> {
    name: &'s [u8],
    value: &'s [u8],
    domain: Option<&'s [u8]>,
    path: &'s [u8],
    same_site: CookieSameSite,
    is_partitioned: bool,
    /// In seconds.
    max_age: Option<f64>,
}

impl CookieStore {
    fn client<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, Rc<Client>> {
        client_with_origin(heap, self.realm(heap), "CookieStore")
    }

    fn query<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Option<&[u8]>,
        url: Option<&DomString>,
    ) -> Result<'a, Vec<Cookie>> {
        let client = self.client(&cx.heap)?;
        if let Some(url) = url {
            let url = parse_url(&cx.heap, url)
                .and_then(|it| bun_web::url::Url::parse(it.to_utf8().as_bytes()));
            if url.is_none_or(|it| it.without_fragment() != client.url().without_fragment()) {
                return Err(cx
                    .heap
                    .type_error(format_args!("URL must match the document URL")));
            }
        }
        let (mut cookies, name) = (client.cookies(), name.map(trimmed));
        cookies.retain(|it| name.is_none_or(|name| *it.name == *name.as_bytes()));
        Ok(cookies)
    }

    fn first<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Option<&[u8]>,
        url: Option<&DomString>,
    ) -> Result<'a, JSValue> {
        let found = self
            .query(cx, name, url)?
            .first()
            .map_or(JSValue::NULL, |it| describe(&cx.heap, it, false).to_js());
        Ok(cx.promise_resolve(found)?.to_js())
    }

    fn all<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Option<&[u8]>,
        url: Option<&DomString>,
    ) -> Result<'a, JSValue> {
        let found = self.query(cx, name, url)?;
        let found = cx
            .heap
            .create_array(&found, |heap, it| Ok(describe(heap, it, false)))?
            .to_js();
        Ok(cx.promise_resolve(found)?.to_js())
    }

    fn store<'a>(&'a self, cx: Cx<'_, 'a>, wanted: &Wanted<'_>) -> Result<'a, JSValue> {
        let client = self.client(&cx.heap)?;
        let (name, value, domain, path) = (
            trimmed(wanted.name),
            trimmed(wanted.value),
            wanted.domain.map(crate::values::text),
            crate::values::text(wanted.path),
        );
        let is_valid = ![name, value, domain.unwrap_or_default(), path]
            .iter()
            .any(|it| contains_char(it.as_bytes(), b';'))
            && !contains_char(name.as_bytes(), b'=')
            && domain.is_none_or(|it| {
                !it.is_empty() && !it.starts_with('.') && it.len() <= LONGEST_ATTRIBUTE
            })
            && (path.is_empty() || path.starts_with('/'))
            && path.len() <= LONGEST_ATTRIBUTE;
        let same_site = match wanted.same_site {
            CookieSameSite::Strict => "strict",
            CookieSameSite::Lax => "lax",
            CookieSameSite::None => "none",
        };
        let mut header = format!("{name}={value};secure;samesite={same_site}");
        if !path.is_empty() {
            let _ = write!(header, ";path={path}");
        }
        if let Some(domain) = domain {
            let _ = write!(header, ";domain={domain}");
        }
        if let Some(seconds) = wanted.max_age {
            let _ = write!(header, ";max-age={seconds}");
        }
        if wanted.is_partitioned {
            header.push_str(";partitioned");
        }
        if !is_valid || !client.set_cookie(header.as_bytes()) {
            return Err(cx.heap.type_error(format_args!("The cookie was refused.")));
        }
        Ok(cx.promise_resolve(JSValue::UNDEFINED)?.to_js())
    }

    pub(crate) fn get<'a>(&'a self, cx: Cx<'_, 'a>, name: &[u8]) -> Result<'a, JSValue> {
        self.first(cx, Some(name), None)
    }

    pub(crate) fn get_with<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        options: &CookieStoreGetOptions<'a>,
    ) -> Result<'a, JSValue> {
        if options.name.is_none() && options.url.is_none() {
            self.client(&cx.heap)?;
            return Err(cx
                .heap
                .type_error(format_args!("CookieStoreGetOptions must not be empty")));
        }
        self.first(cx, options.name, options.url.as_ref())
    }

    pub(crate) fn get_all<'a>(&'a self, cx: Cx<'_, 'a>, name: &[u8]) -> Result<'a, JSValue> {
        self.all(cx, Some(name), None)
    }

    pub(crate) fn get_all_with<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        options: &CookieStoreGetOptions<'a>,
    ) -> Result<'a, JSValue> {
        self.all(cx, options.name, options.url.as_ref())
    }

    pub(crate) fn set<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: &[u8],
        value: &[u8],
    ) -> Result<'a, JSValue> {
        self.store(
            cx,
            &Wanted {
                name,
                value,
                domain: None,
                path: b"/",
                same_site: CookieSameSite::Strict,
                is_partitioned: false,
                max_age: None,
            },
        )
    }

    pub(crate) fn set_with<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        it: &CookieInit<'a>,
    ) -> Result<'a, JSValue> {
        if it.expires.is_some() && it.max_age.is_some() {
            return Err(cx
                .heap
                .type_error(format_args!("expires and maxAge do not go together.")));
        }
        let max_age = it
            .expires
            .map(|it| ((it - bun_core::time::milli_timestamp() as f64) / 1000.0).ceil() + 0.0)
            .or_else(|| it.max_age.map(|it| it as f64));
        self.store(
            cx,
            &Wanted {
                name: it.name,
                value: it.value,
                domain: it.domain,
                path: it.path,
                same_site: it.same_site,
                is_partitioned: it.partitioned,
                max_age,
            },
        )
    }

    pub(crate) fn delete<'a>(&'a self, cx: Cx<'_, 'a>, name: &[u8]) -> Result<'a, JSValue> {
        self.remove(cx, name, None, b"/", false)
    }

    pub(crate) fn delete_with<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        it: &CookieStoreDeleteOptions<'a>,
    ) -> Result<'a, JSValue> {
        self.remove(cx, it.name, it.domain, it.path, it.partitioned)
    }

    fn remove<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: &[u8],
        domain: Option<&[u8]>,
        path: &[u8],
        is_partitioned: bool,
    ) -> Result<'a, JSValue> {
        let value: &[u8] = if trimmed(name).is_empty() {
            b"deleted"
        } else {
            b""
        };
        self.store(
            cx,
            &Wanted {
                name,
                value,
                domain,
                path,
                same_site: CookieSameSite::Strict,
                is_partitioned,
                max_age: Some(0.0),
            },
        )
    }
}

impl CookieChangeEvent {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &CookieChangeEventInit<'a>,
    ) -> Result<'a, &'a Self> {
        let this = structure.create(&cx.heap, Event::base(name, event_init!(init), Trusted::No));
        let [changed, deleted] = [init.changed, init.deleted]
            .map(|it| it.iter().map(JsLocal::to_js).collect::<Vec<_>>());
        this.set_lists(&cx.heap, changed, deleted)?;
        Ok(this)
    }

    fn set_lists<'a, L: IntoIterator<Item = JSValue, IntoIter: ExactSizeIterator>>(
        &'a self,
        heap: &JsHeap<'a>,
        changed: L,
        deleted: L,
    ) -> Result<'a> {
        js_CookieChangeEvent::set_changed(self, frozen(heap, changed)?);
        js_CookieChangeEvent::set_deleted(self, frozen(heap, deleted)?);
        Ok(())
    }
}

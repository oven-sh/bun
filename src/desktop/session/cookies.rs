use bun_web::net::cookies::{
    Cause, Change, Cookie, SameSite, default_path, domain_for, domain_matches,
};
use bun_web::origin::{Site, is_potentially_trustworthy};
use bun_web::time::wall_now;
use bun_web::url::Url;

use super::Session;
use crate::generated_bindgen::session::{CookieDetails, CookieFilter};
use crate::prelude::*;
use crate::value::Value;

fn without_dot(domain: &[u8]) -> &[u8] {
    domain.strip_prefix(b".").unwrap_or(domain)
}

pub(super) fn describe(it: &Cookie) -> Value {
    let mut described = record! {
        "name": string(&it.name),
        "value": string(&it.value),
        "domain": format!("{}{}", if it.is_host_only { "" } else { "." }, string(&it.domain)),
        "hostOnly": it.is_host_only,
        "path": string(&it.path),
        "secure": it.is_secure,
        "httpOnly": it.is_http_only,
        "session": it.expires.is_none(),
    };
    if let Some(it) = it.expires {
        described.set("expirationDate", it);
    }
    described.set("sameSite", string(it.same_site.as_bytes()));
    if let Some(it) = it.partition.as_ref() {
        described.set("partition", string(it.as_bytes()));
    }
    described
}

fn from_description(it: &Value) -> Cookie {
    let bytes = |name: &str| it[name].text().as_bytes();
    Cookie {
        name: bytes("name").into(),
        value: bytes("value").into(),
        domain: without_dot(bytes("domain")).into(),
        is_host_only: it["hostOnly"].is_truthy(),
        path: bytes("path").into(),
        is_secure: it["secure"].is_truthy(),
        is_http_only: it["httpOnly"].is_truthy(),
        expires: it["expirationDate"].as_number(),
        same_site: SameSite::parse(bytes("sameSite")).unwrap_or(SameSite::Unspecified),
        partition: Url::parse(bytes("partition")).map(|it| Site::of(&it)),
        created: 0.,
    }
}

impl Session {
    pub(crate) fn all_cookies(&self) -> Value {
        self.network
            .with_cookies(|jar| jar.all().iter().map(describe).collect())
    }

    pub(crate) fn set_cookie(&self, details: &CookieDetails<'_>) -> JsResult<()> {
        let url =
            (details.url).ok_or_else(|| error(format_args!("Missing required option 'url'")))?;
        let found = Url::parse(url)
            .and_then(|url| Some((domain_for(&url, details.domain.unwrap_or_default())?, url)));
        let ((domain, is_host_only), url) =
            found.ok_or_else(|| error(format_args!("Failed to get cookie domain")))?;
        let same_site = (details
            .same_site
            .map_or(Some(SameSite::Lax), SameSite::parse))
        .ok_or_else(|| {
            error(format_args!(
                "Failed to convert '{}' to an appropriate cookie same site value",
                string(details.same_site.unwrap_or_default())
            ))
        })?;
        let cookie = Cookie {
            name: details.name.unwrap_or_default().into(),
            value: details.value.unwrap_or_default().into(),
            domain,
            is_host_only,
            path: details
                .path
                .filter(|it| !it.is_empty())
                .unwrap_or_else(|| default_path(&url))
                .into(),
            is_secure: details
                .secure
                .unwrap_or_else(|| same_site == SameSite::None && is_potentially_trustworthy(&url)),
            is_http_only: details.http_only,
            expires: details.expiration_date,
            same_site,
            partition: None,
            created: wall_now(),
        };
        cookie
            .validate(&url)
            .map_err(|it| error(format_args!("Failed to set cookie - {it}")))?;
        self.network.with_cookies(|jar| jar.store(cookie));
        Ok(())
    }

    pub(crate) fn remove_all_cookies(&self) {
        self.network
            .with_cookies(|jar| jar.remove_if(Cause::Explicit, |_| true));
    }

    /// From the web engine.
    pub(crate) fn receive_cookie(
        &self,
        cookie: &Value,
        cause: &str,
        is_removed: bool,
    ) -> JsResult<()> {
        let cookie = from_description(cookie);
        let known = self
            .network
            .with_cookies(|jar| jar.all().iter().find(|it| cookie.replaces(it)).cloned());
        let is_news = match (is_removed, known) {
            (true, known) => {
                !cause.ends_with("overwrite") && known.is_some_and(|it| it.value == cookie.value)
            }
            (false, known) => {
                known.is_none_or(|it| describe(&it).to_json() != describe(&cookie).to_json())
            }
        };
        if is_news {
            self.mirror.is_receiving.set(true);
            self.network.with_cookies(|jar| match is_removed {
                true => jar.remove_if(
                    Cause::parse(cause.as_bytes()).unwrap_or(Cause::Explicit),
                    |it| cookie.replaces(it),
                ),
                false => jar.store(cookie),
            });
            self.mirror.is_receiving.set(false);
        }
        Ok(())
    }

    pub(super) fn cookie_changed(&'static self, change: &Change) -> JsResult<()> {
        let (cookie, cause) = (describe(&change.cookie), change.cause);
        self.mirror_cookie(&cookie, cause.removes())?;
        later::soon(move |_| {
            let arguments = [
                js(&cookie)?,
                js(string(cause.as_bytes()))?,
                cause.removes().into(),
            ];
            announce(get(self.to_js(), "cookies")?, "changed", &arguments)
        });
        Ok(())
    }
}

pub(crate) struct Cookies(pub(super) &'static Session);

impl Cookies {
    pub(crate) fn get<'a>(&self, _: Cx<'a, '_>, filter: &CookieFilter<'a>) -> JsResult<JSValue> {
        let url = filter.url.filter(|it| !it.is_empty()).map(Url::parse);
        let passes = |it: &&Cookie| {
            (url.as_ref()).is_none_or(|url| url.as_ref().is_some_and(|url| it.applies_to(url)))
                && filter
                    .domain
                    .is_none_or(|domain| domain_matches(&it.domain, without_dot(domain)))
                && filter.name.is_none_or(|name| *it.name == *name)
                && filter.path.is_none_or(|path| *it.path == *path)
                && filter.secure.is_none_or(|flag| it.is_secure == flag)
                && filter
                    .session
                    .is_none_or(|flag| it.expires.is_none() == flag)
                && filter.http_only.is_none_or(|flag| it.is_http_only == flag)
        };
        let found: Value = self
            .0
            .network
            .with_cookies(|jar| jar.all().iter().filter(passes).map(describe).collect());
        resolved(&found)
    }

    pub(crate) fn set<'a>(&self, _: Cx<'a, '_>, details: &CookieDetails<'a>) -> JsResult<JSValue> {
        self.0.set_cookie(details)?;
        resolved(JSValue::UNDEFINED)
    }

    pub(crate) fn remove(&self, _: Cx<'_, '_>, url: &[u8], name: &[u8]) -> JsResult<JSValue> {
        let url = Url::parse(url);
        self.0.network.with_cookies(|jar| {
            jar.remove_if(Cause::Explicit, |it| {
                *it.name == *name && url.as_ref().is_some_and(|url| it.applies_to(url))
            })
        });
        resolved(JSValue::UNDEFINED)
    }

    pub(crate) fn flush_store(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        self.0.network.flush_cookies();
        resolved(JSValue::UNDEFINED)
    }
}

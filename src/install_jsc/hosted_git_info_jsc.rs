//! JSC bridges for `bun_install::hosted_git_info`.

use bun_core::String as BunString;
use bun_jsc::bindgen::{self, JsHeap};
use bun_jsc::bun_string_jsc;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc};

/// Extension trait providing `.to_js()` on `HostedGitInfo`.
trait HostedGitInfoJsc {
    fn to_js(&self, go: &JSGlobalObject) -> JsResult<JSValue>;
}

impl HostedGitInfoJsc for bun_install::hosted_git_info::HostedGitInfo {
    fn to_js(&self, go: &JSGlobalObject) -> JsResult<JSValue> {
        let obj = JSValue::create_empty_object(go, 6);
        obj.put(
            go,
            b"type",
            BunString::static_(self.host_provider.type_str()).to_js(go)?,
        );
        obj.put(
            go,
            b"domain",
            bun_string_jsc::create_utf8_for_js(go, self.host_provider.domain())?,
        );
        obj.put(
            go,
            b"project",
            bun_string_jsc::create_utf8_for_js(go, self.project())?,
        );
        obj.put(
            go,
            b"user",
            if let Some(user) = self.user() {
                bun_string_jsc::create_utf8_for_js(go, user)?
            } else {
                JSValue::NULL
            },
        );
        obj.put(
            go,
            b"committish",
            if let Some(committish) = self.committish() {
                bun_string_jsc::create_utf8_for_js(go, committish)?
            } else {
                JSValue::NULL
            },
        );
        obj.put(
            go,
            b"default",
            BunString::from_bytes(<&'static str>::from(self.default_representation).as_bytes())
                .to_js(go)?,
        );

        Ok(obj)
    }
}

pub(crate) fn parse_url<'a>(heap: &JsHeap<'a>, url: &BunString) -> bindgen::Result<'a, BunString> {
    use bun_install::hosted_git_info as hgi;

    let as_utf8 = url.to_utf8();
    let parsed = match hgi::parse_url(as_utf8.slice()) {
        Ok(p) => p,
        Err(err) => {
            return Err(heap.error(format_args!(
                "Invalid Git URL: {}",
                bstr::BStr::new(<&'static str>::from(err))
            )));
        }
    };

    Ok(parsed.url.href())
}

pub(crate) fn from_url<'a>(heap: &JsHeap<'a>, url: &BunString) -> bindgen::Result<'a, JSValue> {
    use bun_install::hosted_git_info::HostedGitInfo;
    // TODO(markovejnovic): The original hosted-git-info actually takes another argument that
    //                      allows you to inject options. Seems untested so we didn't implement
    //                      it.

    let as_utf8 = url.to_utf8();
    let parsed = match HostedGitInfo::from_url(as_utf8.slice()) {
        Ok(Some(p)) => p,
        Ok(None) => return Ok(JSValue::NULL),
        Err(err) => {
            return Err(heap.error(format_args!(
                "Invalid Git URL: {}",
                bstr::BStr::new(<&'static str>::from(err))
            )));
        }
    };

    // SAFETY: the object is new and plain, and its properties are defined and not set.
    Ok(parsed.to_js(unsafe { heap.global() })?)
}

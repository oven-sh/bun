//! JSC bridges for `src/install/hosted_git_info.zig`. Aliased back so call
//! sites and `$newZigFunction("hosted_git_info.zig", …)` are unchanged.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue};

/// Extension trait providing `.to_js()` on `HostedGitInfo` (Zig: `hostedGitInfoToJS`).
// TODO(b2-blocked): bun_jsc::JsResult
pub trait HostedGitInfoJsc {
    fn to_js(&self, go: &JSGlobalObject) -> Result<JSValue, JSValue>;
}

// TODO(b2-blocked): bun_install::hosted_git_info
// TODO(b2-blocked): bun_install::hosted_git_info::HostedGitInfo
// TODO(b2-blocked): bun_string::String::from_bytes
// TODO(b2-blocked): bun_jsc::StringJsc (to_js on bun_string::String)
// TODO(b2-blocked): bun_jsc::JSValue::create_empty_object
// TODO(b2-blocked): bun_jsc::JSValue::put
#[cfg(any())]
impl HostedGitInfoJsc for bun_install::hosted_git_info::HostedGitInfo {
    fn to_js(&self, go: &JSGlobalObject) -> bun_jsc::JsResult<JSValue> {
        use bun_string::{String as BunString, ZigString};
        let obj = JSValue::create_empty_object(go, 6);
        obj.put(
            go,
            ZigString::static_(b"type"),
            BunString::from_bytes(self.host_provider.type_str()).to_js(go)?,
        );
        obj.put(
            go,
            ZigString::static_(b"domain"),
            BunString::from_bytes(self.host_provider.domain()).to_js(go)?,
        );
        obj.put(
            go,
            ZigString::static_(b"project"),
            BunString::from_bytes(&self.project).to_js(go)?,
        );
        obj.put(
            go,
            ZigString::static_(b"user"),
            if let Some(user) = &self.user {
                BunString::from_bytes(user).to_js(go)?
            } else {
                JSValue::NULL
            },
        );
        obj.put(
            go,
            ZigString::static_(b"committish"),
            if let Some(committish) = &self.committish {
                BunString::from_bytes(committish).to_js(go)?
            } else {
                JSValue::NULL
            },
        );
        obj.put(
            go,
            ZigString::static_(b"default"),
            BunString::from_bytes(
                <&'static str>::from(self.default_representation).as_bytes(),
            )
            .to_js(go)?,
        );

        Ok(obj)
    }
}

// TODO(b2-blocked): bun_jsc::host_fn (proc-macro)
// TODO(b2-blocked): bun_jsc::JsResult
// TODO(b2-blocked): bun_jsc::CallFrame::arguments_count
// TODO(b2-blocked): bun_jsc::CallFrame::argument
// TODO(b2-blocked): bun_jsc::JSGlobalObject::throw
// TODO(b2-blocked): bun_jsc::JSValue::is_string
// TODO(b2-blocked): bun_jsc::JSValue::to_bun_string
// TODO(b2-blocked): bun_install::hosted_git_info::parse_url
#[cfg(any())]
#[bun_jsc::host_fn]
pub fn js_parse_url(go: &JSGlobalObject, callframe: &CallFrame) -> bun_jsc::JsResult<JSValue> {
    use bun_install::hosted_git_info as hgi;
    if callframe.arguments_count() != 1 {
        return go.throw(format_args!(
            "hostedGitInfo.prototype.parseUrl takes exactly 1 argument"
        ));
    }

    let arg0 = callframe.argument(0);
    if !arg0.is_string() {
        return go.throw(format_args!(concat!(
            "hostedGitInfo.prototype.parseUrl takes a string as its ",
            "first argument",
        )));
    }

    // TODO(markovejnovic): This feels like there's too much going on all
    // to give us a slice. Maybe there's a better way to code this up.
    let npa_str = arg0.to_bun_string(go)?;
    let mut as_utf8 = npa_str.to_utf8();
    // TODO(port): `ZigString.Slice.mut()` returns a mutable byte slice; verify
    // `Utf8Slice::as_mut_bytes()` (or equivalent) exists in `bun_string`.
    let parsed = match hgi::parse_url(as_utf8.as_mut_bytes()) {
        Ok(p) => p,
        Err(err) => {
            return go.throw(format_args!("Invalid Git URL: {}", err.name()));
        }
    };

    parsed.url.href().to_js(go)
}

// TODO(b2-blocked): bun_install::hosted_git_info::HostedGitInfo::from_url
#[cfg(any())]
#[bun_jsc::host_fn]
pub fn js_from_url(go: &JSGlobalObject, callframe: &CallFrame) -> bun_jsc::JsResult<JSValue> {
    use bun_install::hosted_git_info::HostedGitInfo;
    // TODO(markovejnovic): The original hosted-git-info actually takes another argument that
    //                      allows you to inject options. Seems untested so we didn't implement
    //                      it.
    if callframe.arguments_count() != 1 {
        return go.throw(format_args!(
            "hostedGitInfo.prototype.fromUrl takes exactly 1 argument"
        ));
    }

    let arg0 = callframe.argument(0);
    if !arg0.is_string() {
        return go.throw(format_args!(
            "hostedGitInfo.prototype.fromUrl takes a string as its first argument"
        ));
    }

    // TODO(markovejnovic): This feels like there's too much going on all to give us a slice.
    // Maybe there's a better way to code this up.
    let npa_str = arg0.to_bun_string(go)?;
    let mut as_utf8 = npa_str.to_utf8();
    let parsed = match HostedGitInfo::from_url(as_utf8.as_mut_bytes()) {
        Ok(Some(p)) => p,
        Ok(None) => return Ok(JSValue::NULL),
        Err(err) => {
            return go.throw(format_args!("Invalid Git URL: {}", err.name()));
        }
    };

    parsed.to_js(go)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install_jsc/hosted_git_info_jsc.zig (109 lines)
//   confidence: medium
//   todos:      1
//   notes:      hostedGitInfoToJS ported as HostedGitInfoJsc extension trait; Utf8Slice mut-bytes accessor name unverified
// ──────────────────────────────────────────────────────────────────────────

//! JSC bridges for `src/install/hosted_git_info.zig`. Aliased back so call
//! sites and `$newZigFunction("hosted_git_info.zig", …)` are unchanged.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc};

/// Extension trait providing `.to_js()` on `HostedGitInfo` (Zig: `hostedGitInfoToJS`).
pub trait HostedGitInfoJsc {
    fn to_js(&self, go: &JSGlobalObject) -> JsResult<JSValue>;
}

impl HostedGitInfoJsc for bun_install::hosted_git_info::HostedGitInfo {
    fn to_js(&self, go: &JSGlobalObject) -> JsResult<JSValue> {
        use bun_core::String as BunString;
        let obj = JSValue::create_empty_object(go, 6);
        obj.put(
            go,
            b"type",
            BunString::from_bytes(self.host_provider.type_str().as_bytes()).to_js(go)?,
        );
        obj.put(
            go,
            b"domain",
            BunString::from_bytes(self.host_provider.domain()).to_js(go)?,
        );
        obj.put(
            go,
            b"project",
            BunString::from_bytes(self.project()).to_js(go)?,
        );
        obj.put(
            go,
            b"user",
            if let Some(user) = self.user() {
                BunString::from_bytes(user).to_js(go)?
            } else {
                JSValue::NULL
            },
        );
        obj.put(
            go,
            b"committish",
            if let Some(committish) = self.committish() {
                BunString::from_bytes(committish).to_js(go)?
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

// TODO(port): proc-macro — `#[bun_jsc::host_fn]` will wrap these into the
// `JSHostFn` ABI for `$newZigFunction`. Bodies are plain `JSHostFnZig`-shaped fns.
pub fn js_parse_url(go: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    use bun_install::hosted_git_info as hgi;
    if callframe.arguments_count() != 1 {
        return Err(go.throw(format_args!(
            "hostedGitInfo.prototype.parseUrl takes exactly 1 argument"
        )));
    }

    let arg0 = callframe.argument(0);
    if !arg0.is_string() {
        return Err(go.throw(format_args!(concat!(
            "hostedGitInfo.prototype.parseUrl takes a string as its ",
            "first argument",
        ))));
    }

    // TODO(markovejnovic): This feels like there's too much going on all
    // to give us a slice. Maybe there's a better way to code this up.
    let npa_str = arg0.to_bun_string(go)?;
    // PORT NOTE: Zig used `ZigString.Slice.mut()` to get a mutable view; the Rust
    // `ZigStringSlice` is read-only, so own a mutable copy via `into_vec()`.
    let mut as_utf8 = npa_str.to_utf8().into_vec();
    let mut parsed = match hgi::parse_url(as_utf8.as_mut_slice()) {
        Ok(p) => p,
        Err(err) => {
            return Err(go.throw(format_args!(
                "Invalid Git URL: {}",
                bstr::BStr::new(<&'static str>::from(err))
            )));
        }
    };

    // `parsed.url` is `Box<WhatwgUrl>` (C++-owned WTF::URL); `href()` yields a
    // `bun_core::String`. `defer parsed.url.deinit()` deleted — Box Drop frees.
    parsed.url.href().to_js(go)
}

pub fn js_from_url(go: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    use bun_install::hosted_git_info::HostedGitInfo;
    // TODO(markovejnovic): The original hosted-git-info actually takes another argument that
    //                      allows you to inject options. Seems untested so we didn't implement
    //                      it.
    if callframe.arguments_count() != 1 {
        return Err(go.throw(format_args!(
            "hostedGitInfo.prototype.fromUrl takes exactly 1 argument"
        )));
    }

    let arg0 = callframe.argument(0);
    if !arg0.is_string() {
        return Err(go.throw(format_args!(
            "hostedGitInfo.prototype.fromUrl takes a string as its first argument"
        )));
    }

    // TODO(markovejnovic): This feels like there's too much going on all to give us a slice.
    // Maybe there's a better way to code this up.
    let npa_str = arg0.to_bun_string(go)?;
    // PORT NOTE: Zig used `ZigString.Slice.mut()`; own a mutable copy.
    let mut as_utf8 = npa_str.to_utf8().into_vec();
    let parsed = match HostedGitInfo::from_url(as_utf8.as_mut_slice()) {
        Ok(Some(p)) => p,
        Ok(None) => return Ok(JSValue::NULL),
        Err(err) => {
            return Err(go.throw(format_args!(
                "Invalid Git URL: {}",
                bstr::BStr::new(<&'static str>::from(err))
            )));
        }
    };

    parsed.to_js(go)
}

// ported from: src/install_jsc/hosted_git_info_jsc.zig

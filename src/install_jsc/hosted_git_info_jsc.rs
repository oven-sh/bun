//! JSC bridges for `bun_install::hosted_git_info`.

use bun_core::String as BunString;
use bun_jsc::bindgen::{self, JsHeap};

use crate::generated_bindgen::hosted_git_info_jsc::HostedGitInfo;

pub(crate) fn parse_url<'a>(heap: &JsHeap<'a>, url: &[u8]) -> bindgen::Result<'a, BunString> {
    use bun_install::hosted_git_info as hgi;

    let parsed = match hgi::parse_url(url) {
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

pub(crate) fn from_url<'a>(
    heap: &JsHeap<'a>,
    url: &[u8],
) -> bindgen::Result<'a, Option<HostedGitInfo>> {
    // TODO(markovejnovic): The original hosted-git-info actually takes another argument that
    //                      allows you to inject options. Seems untested so we didn't implement
    //                      it.

    let parsed = match bun_install::hosted_git_info::HostedGitInfo::from_url(url) {
        Ok(Some(p)) => p,
        Ok(None) => return Ok(None),
        Err(err) => {
            return Err(heap.error(format_args!(
                "Invalid Git URL: {}",
                bstr::BStr::new(<&'static str>::from(err))
            )));
        }
    };

    Ok(Some(HostedGitInfo {
        r#type: BunString::static_(parsed.host_provider.type_str()),
        domain: BunString::clone_utf8(parsed.host_provider.domain()),
        project: BunString::clone_utf8(parsed.project()),
        user: parsed.user().map(BunString::clone_utf8),
        committish: parsed.committish().map(BunString::clone_utf8),
        default_representation: BunString::static_(<&'static str>::from(
            parsed.default_representation,
        )),
    }))
}

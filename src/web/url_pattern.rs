//! <https://urlpattern.spec.whatwg.org/#other-specs>

use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_yarr::{Compiled, Text, flags};

use crate::Bytes;
use crate::net::record::{RecordReader, RecordWriter};
use crate::url::Url;

const COMPONENTS: usize = 8;
const FIRST_WITH_CASE: usize = 5;

/// Without groups of regular expressions. It belongs to no thread.
pub struct UrlPattern {
    sources: [Bytes; COMPONENTS],
    ignores_case: bool,
    /// `None` matches everything.
    compiled: [Option<Compiled>; COMPONENTS],
}

impl UrlPattern {
    pub fn from_js(global: &JSGlobalObject, value: JSValue, base: &Url) -> JsResult<UrlPattern> {
        unsafe extern "C" {
            safe fn Bun__DesktopRealm__describeURLPattern(
                realm: &JSGlobalObject,
                value: JSValue,
                base: &bun_core::String,
                sources: &mut [bun_core::String; COMPONENTS],
                ignores_case: &mut bool,
            ) -> bool;
        }
        let base = bun_core::String::clone_utf8(base.href());
        let (mut sources, mut ignores_case) = ([bun_core::String::EMPTY; COMPONENTS], false);
        bun_jsc::call_false_is_throw(global, || {
            Bun__DesktopRealm__describeURLPattern(
                global,
                value,
                &base,
                &mut sources,
                &mut ignores_case,
            )
        })?;
        UrlPattern::compile(sources.map(|it| (*it.to_utf8()).into()), ignores_case)
            .ok_or_else(|| global.throw_type_error(format_args!("The URL pattern is too large.")))
    }

    fn compile(sources: [Bytes; COMPONENTS], ignores_case: bool) -> Option<UrlPattern> {
        let mut compiled = [const { None }; COMPONENTS];
        for (at, source) in sources.iter().enumerate() {
            let case = match ignores_case && at >= FIRST_WITH_CASE {
                true => flags::IGNORE_CASE,
                false => 0,
            };
            if **source != *b"^(.*)$" {
                let made = Compiled::new(Text::Latin1(source), flags::UNICODE_SETS | case);
                compiled[at] = Some(made.ok()?);
            }
        }
        Some(UrlPattern {
            sources,
            ignores_case,
            compiled,
        })
    }

    /// Not if it takes more than `steps`, which it uses up.
    pub fn matches(&self, url: &Url, steps: &mut usize) -> bool {
        let port = url.port().map(|it| it.to_string()).unwrap_or_default();
        let components = [
            url.scheme(),
            url.username(),
            url.password(),
            url.hostname(),
            port.as_bytes(),
            url.path(),
            url.search().get(1..).unwrap_or_default(),
            url.fragment().unwrap_or_default(),
        ];
        self.compiled.iter().zip(components).all(|(it, text)| {
            it.as_ref().is_none_or(|it| {
                let mut offsets = vec![0; it.offsets_len()];
                it.exec_within(Text::Latin1(text), 0, &mut offsets, Some(steps))
            })
        })
    }

    pub(crate) fn write(&self, out: &mut RecordWriter) {
        out.count(self.ignores_case.into());
        self.sources.iter().for_each(|it| out.bytes(it));
    }

    pub(crate) fn read(it: &mut RecordReader<'_>) -> Option<UrlPattern> {
        let ignores_case = it.count()? == 1;
        let mut sources: [Bytes; COMPONENTS] = Default::default();
        for source in &mut sources {
            *source = it.bytes()?.into();
        }
        UrlPattern::compile(sources, ignores_case)
    }
}

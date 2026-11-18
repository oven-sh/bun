//! What `URL.h` does not read in place.

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_engine_text::{StringImpl, StringRef, Text};
use bun_url_whatwg::form::{self, Pair};
use bun_url_whatwg::{OnError, PathStyle, Punycode, Scheme, Url};

use super::abi::{RawText, or_abort, slice};

/// No input stands for the base itself.
#[unsafe(no_mangle)]
extern "C" fn engine_url_parse(
    result: &mut Url,
    input: Option<&StringImpl>,
    base: Option<&Url>,
    punycode: Punycode,
) {
    *result = match input {
        Some(input) => Url::parse_or_keep(input, base, punycode),
        None => Url::parse(Text::EMPTY, base, punycode).unwrap_or_default(),
    };
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_can_parse(input: RawText<'_>, base: &Url, punycode: Punycode) -> bool {
    Url::can_parse(input.text(), Some(base), punycode)
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_from_file_path(result: &mut Url, path: RawText<'_>) {
    *result = Url::from_file_path(path.text(), PathStyle::NATIVE).unwrap_or_default();
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_file_path(url: &Url) -> Option<StringRef> {
    or_abort(url.file_path(PathStyle::NATIVE))
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_decoded_username(url: &Url) -> Option<StringRef> {
    or_abort(url.decoded_username())
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_decoded_password(url: &Url) -> Option<StringRef> {
    or_abort(url.decoded_password())
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_scheme_and_host(url: &Url) -> StringRef {
    or_abort(url.scheme_and_host())
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_origin(url: &Url) -> StringRef {
    or_abort(url.origin())
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_string_for_message(url: &Url) -> StringRef {
    url.string_for_message()
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_set_protocol(url: &mut Url, value: RawText<'_>) {
    _ = url.set_protocol(value.text());
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_set_username(url: &mut Url, value: RawText<'_>) -> bool {
    url.set_username(value.text()).is_ok()
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_set_password(url: &mut Url, value: RawText<'_>) -> bool {
    url.set_password(value.text()).is_ok()
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_remove_credentials(url: &mut Url) {
    or_abort(url.remove_credentials());
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_set_hostname(
    url: &mut Url,
    value: RawText<'_>,
    punycode: Punycode,
) -> bool {
    url.set_hostname(value.text(), punycode).is_ok()
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_set_host(url: &mut Url, value: RawText<'_>, punycode: Punycode) {
    _ = url.set_host(value.text(), punycode);
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_set_port(url: &mut Url, value: RawText<'_>) {
    _ = url.set_port(value.text());
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_set_pathname(url: &mut Url, value: RawText<'_>) -> bool {
    url.set_pathname(value.text()).is_ok()
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_set_query(url: &mut Url, value: RawText<'_>) -> bool {
    url.set_query(value.non_null()).is_ok()
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_set_fragment(url: &mut Url, value: RawText<'_>) -> bool {
    url.set_fragment(value.non_null()).is_ok()
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_set_search(url: &mut Url, value: RawText<'_>) {
    _ = url.set_search(value.text());
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_set_hash(url: &mut Url, value: RawText<'_>) {
    _ = url.set_hash(value.text());
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_domain_to_ascii(domain: RawText<'_>) -> Option<StringRef> {
    bun_url_whatwg::domain_to_ascii(domain.text()).ok()
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_domain_to_unicode(domain: RawText<'_>) -> Option<StringRef> {
    bun_url_whatwg::domain_to_unicode(domain.text()).ok()
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_name_to_ascii(name: RawText<'_>, on_error: OnError) -> Option<StringRef> {
    bun_url_whatwg::name_to_ascii(name.text(), on_error).ok()
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_name_to_unicode(name: RawText<'_>) -> Option<StringRef> {
    bun_url_whatwg::name_to_unicode(name.text()).ok()
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_is_special_scheme(scheme: RawText<'_>) -> bool {
    Scheme::named(scheme.text()).is_special()
}

#[unsafe(no_mangle)]
extern "C" fn engine_url_is_default_port(port: u16, scheme: RawText<'_>) -> bool {
    Scheme::named(scheme.text()).default_port() == Some(port)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_url_parse_form(
    input: RawText<'_>,
    limit: usize,
    context: *mut c_void,
    reserve: unsafe extern "C" fn(*mut c_void, usize) -> Option<NonNull<Pair>>,
) -> bool {
    let Ok(pairs) = form::parse(input.text(), limit) else {
        return false;
    };
    if pairs.is_empty() {
        return true;
    }
    // SAFETY: the function goes with the context.
    let Some(target) = (unsafe { reserve(context, pairs.len()) }) else {
        return false;
    };
    for (index, pair) in pairs.into_iter().enumerate() {
        // SAFETY: room for so many pairs, whose strings are null.
        unsafe { target.add(index).write(pair) };
    }
    true
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_url_serialize_form(
    pairs: *const [Option<&StringImpl>; 2],
    count: usize,
) -> Option<StringRef> {
    fn text(string: Option<&StringImpl>) -> Text<'_> {
        string.map_or(Text::EMPTY, StringImpl::text)
    }
    // SAFETY: a span.
    let pairs = unsafe { slice(pairs, count) };
    let pairs = pairs.iter().map(|&[name, value]| (text(name), text(value)));
    form::serialize(pairs).ok()
}

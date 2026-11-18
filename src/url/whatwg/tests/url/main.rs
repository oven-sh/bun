mod domains;
mod file_paths;
mod form;
mod records;
mod scan;
mod setters;
mod wpt;

use bun_engine_standalone as _;
use bun_engine_text::StringRef;
use bun_url_whatwg::{Punycode, Url};

/// Latin-1 if it can be.
fn string(text: &str) -> StringRef {
    StringRef::try_narrowed(StringRef::from_str(text).text()).unwrap()
}

fn url(href: &str) -> Url {
    Url::parse(&string(href), None, Punycode::Checked).unwrap()
}

fn ascii(bytes: &[u8]) -> &str {
    assert!(bytes.is_ascii());
    core::str::from_utf8(bytes).unwrap()
}

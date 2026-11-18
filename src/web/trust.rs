//! In the process of the app, the scripts of a document can do what the app can. These are the ones that may run there.

use core::sync::atomic::{AtomicBool, Ordering};

use bun_core::strings;
use bun_threading::RwLock;

use crate::origin::Origin;
use crate::pattern::glob_matches;
use crate::remote::is_page_process;
use crate::url::{Url, percent_decode};
use crate::{Bytes, compiled};

crate::wire! {
    /// The lists hold globs.
    #[derive(Clone)]
    pub struct Trust {
        pub origins: Vec<Bytes>,
        pub except: Vec<Bytes>,
        /// These are in `except` too.
        pub except_when_loaded: Vec<Bytes>,
        pub in_frames: Vec<Bytes>,
        pub in_all_frames: bool,
        pub injected_scripts: bool,
    }
}

static HAS_SANDBOX_FOR_THE_REST: AtomicBool = AtomicBool::new(false);

pub fn set_sandbox_for_the_rest(is_on: bool) {
    HAS_SANDBOX_FOR_THE_REST.store(is_on, Ordering::Relaxed);
}

/// What is not trusted is shown by this engine too, in other processes.
pub fn has_sandbox_for_the_rest() -> bool {
    HAS_SANDBOX_FOR_THE_REST.load(Ordering::Relaxed)
}

static TRUST: RwLock<Trust> = RwLock::new(Trust {
    origins: Vec::new(),
    except: Vec::new(),
    except_when_loaded: Vec::new(),
    in_frames: Vec::new(),
    in_all_frames: false,
    injected_scripts: false,
});

pub fn extend(more: Trust) {
    let mut trust = TRUST.write();
    trust.origins.extend(more.origins);
    trust.except.extend(more.except);
    trust.except.extend(more.except_when_loaded.iter().cloned());
    trust.except_when_loaded.extend(more.except_when_loaded);
    trust.in_frames.extend(more.in_frames);
    trust.in_all_frames |= more.in_all_frames;
    trust.injected_scripts |= more.injected_scripts;
}

pub(crate) fn current() -> Trust {
    TRUST.read().clone()
}

pub(crate) fn replace(trust: Trust) {
    *TRUST.write() = trust;
}

fn any_matches(globs: &[Bytes], text: &[u8]) -> bool {
    globs.iter().any(|it| glob_matches(it, text))
}

/// As it is, and as a server may take it.
fn spellings(url: &Url) -> [Url; 2] {
    if url.host().is_empty() {
        return [url.clone(), url.clone()];
    }
    let (plain, mut path, mut is_parameter) = (url.without_credentials(), Vec::new(), false);
    for byte in percent_decode(&strings::replace_owned(url.path(), b"%u00", b"%")) {
        is_parameter = byte == b';' || (is_parameter && byte != b'/');
        let byte = if byte == b'\\' { b'/' } else { byte };
        if !is_parameter && !(byte == b'/' && path.ends_with(b"/")) {
            path.push(byte);
        }
    }
    let canonical = plain.with_path(&path);
    [plain, canonical]
}

/// What follows `directory` in `path`.
pub(crate) fn below<'a>(directory: &[u8], path: &'a [u8]) -> Option<&'a [u8]> {
    let is_separator = |it: &u8| *it == b'/' || (cfg!(windows) && *it == b'\\');
    let directory = &directory[..directory.len()
        - directory
            .iter()
            .rev()
            .take_while(|it| is_separator(it))
            .count()];
    let (start, rest) = path.split_at_checked(directory.len())?;
    let is_same = if cfg!(windows) {
        start.eq_ignore_ascii_case(directory)
    } else {
        start == directory
    };
    (is_same && rest.first().is_none_or(is_separator)).then_some(rest)
}

impl Trust {
    pub(crate) fn in_everything() -> Trust {
        Trust {
            origins: vec![b"*"[..].into()],
            except: Vec::new(),
            except_when_loaded: Vec::new(),
            in_frames: Vec::new(),
            in_all_frames: true,
            injected_scripts: true,
        }
    }

    fn is_excepted(&self, url: &Url) -> bool {
        !self.except.is_empty()
            && spellings(url)
                .iter()
                .any(|it| any_matches(&self.except, it.href()))
    }

    fn is_trusted(&self, url: &Url, app_path: &[u8]) -> bool {
        match url.scheme() {
            b"blob" => false,
            _ if self.is_excepted(url) => false,
            b"file" => {
                (url.file_path())
                    .is_some_and(|it| below(app_path, &it).is_some() || compiled::has_file(&it))
                    || (is_page_process() && any_matches(&self.origins, b"file://"))
            }
            _ => match Origin::of(url) {
                Origin::Opaque(_) => any_matches(&self.origins, url.protocol()),
                Origin::Tuple(origin) => any_matches(&self.origins, &origin),
            },
        }
    }
}

pub fn is_excepted(url: &Url) -> bool {
    TRUST.read().is_excepted(url)
}

/// Whether a trusted document has to be left if its URL changes to this.
pub fn ends_trusted_document(url: &Url) -> bool {
    let trust = TRUST.read();
    trust.is_excepted(url) && !any_matches(&trust.except_when_loaded, url.href())
}

pub fn is_trusted_origin(origin: &[u8]) -> bool {
    any_matches(&TRUST.read().origins, origin)
}

pub fn is_trusted(url: &Url, app_path: &[u8]) -> bool {
    TRUST.read().is_trusted(url, app_path)
}

/// What a page has made up is not trusted because the page is.
pub fn is_trusted_in_frame(url: &Url, app_path: &[u8]) -> bool {
    let trust = TRUST.read();
    if !trust.in_all_frames {
        let specificity = |globs: &[Bytes], url: &Url| {
            globs
                .iter()
                .filter(|it| glob_matches(it, url.href()))
                .map(|it| it.len())
                .max()
        };
        return any_matches(&trust.origins, Origin::of(url).as_bytes())
            && spellings(url)
                .iter()
                .all(|it| specificity(&trust.in_frames, it) > specificity(&trust.except, it));
    }
    match url.scheme() {
        b"javascript" => true,
        b"about" | b"blob" | b"data" => {
            url.href() == b"about:blank" || any_matches(&trust.origins, url.protocol())
        }
        _ => trust.is_trusted(url, app_path),
    }
}

/// They know each other, as in a browser.
pub fn relates_windows() -> bool {
    has_sandbox_for_the_rest() || TRUST.read().in_all_frames
}

pub fn relates_frames() -> bool {
    relates_windows() || !TRUST.read().in_frames.is_empty()
}

pub fn trusts_injected_scripts() -> bool {
    TRUST.read().injected_scripts
}

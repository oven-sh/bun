//! https://fetch.spec.whatwg.org/#scheme-fetch

use bun_core::strings;
use bun_http_types::{ETag, MimeType};
use bun_simdutf_sys::simdutf;
use bun_sys::{Fd, File, O};
use bun_threading::RwLock;

use super::body::{Blob, Data, SharedBytes};
use super::error::{NetError, Result};
use super::response::Answer;
use crate::exec::blocking;
use crate::headers::{HeaderList, digits, trim_tabs_and_spaces};
use crate::mime::Mime;
use crate::url::{Url, percent_decode};
use crate::{Bytes, compiled};

/// https://fetch.spec.whatwg.org/#data-url-processor
pub fn process_data_url(url: &Url) -> Option<(Vec<u8>, Vec<u8>)> {
    let (mime, body) = strings::split_once_char(&url.without_fragment()["data:".len()..], b',')?;
    let (mut mime, mut body) = (mime.trim_ascii(), percent_decode(body));
    let before_base64 = mime
        .len()
        .checked_sub(6)
        .filter(|at| mime[*at..].eq_ignore_ascii_case(b"base64"));
    if let Some(bare) =
        before_base64.and_then(|at| strings::trim_right(&mime[..at], b" ").strip_suffix(b";"))
    {
        let mut decoded = vec![0; bun_base64::decode_len(&body) + 3];
        let result = simdutf::base64::decode(&body, &mut decoded, false);
        result.is_successful().then_some(())?;
        decoded.truncate(result.count);
        (mime, body) = (bare, decoded);
    }
    let parsed = if mime.starts_with(b";") {
        Mime::parse(&[b"text/plain", mime].concat())
    } else {
        Mime::parse(mime)
    };
    Some((
        parsed.map_or_else(
            || b"text/plain;charset=US-ASCII".to_vec(),
            |it| it.serialize(),
        ),
        body,
    ))
}

pub(super) fn fetch_data(url: &Url) -> Result<Answer> {
    let (mime, body) = process_data_url(url).ok_or(NetError::InvalidUrl)?;
    Ok(Answer::new(
        200,
        b"OK",
        [("content-type", mime)].into_iter().collect(),
        body.into(),
    ))
}

/// https://fetch.spec.whatwg.org/#simple-range-header-value
fn parse_range(value: &[u8], size: u64) -> Option<core::ops::Range<u64>> {
    let value = trim_tabs_and_spaces(value.strip_prefix(b"bytes")?).strip_prefix(b"=")?;
    let (first, last) = strings::split_once_char(value, b'-')?;
    let range = match (
        trim_tabs_and_spaces(first),
        strings::trim_left(last, b"\t "),
    ) {
        (b"", last) => size.saturating_sub(digits(last)?)..size,
        (first, b"") => digits(first)?..size,
        (first, last) => digits(first)?..digits(last)?.saturating_add(1).min(size),
    };
    (!range.is_empty()).then_some(range)
}

fn answer_with(data: &Data, mut headers: HeaderList, range: Option<&[u8]>) -> Result<Answer> {
    let size = data.len();
    let Some(range) = range else {
        headers.append(b"content-length", size.to_string().as_bytes());
        return Ok(Answer::new(200, b"OK", headers, data.open()));
    };
    let range = parse_range(range, size).ok_or(NetError::RequestRangeNotSatisfiable)?;
    headers.append(
        b"content-length",
        (range.end - range.start).to_string().as_bytes(),
    );
    headers.append(
        b"content-range",
        format!("bytes {}-{}/{size}", range.start, range.end - 1).as_bytes(),
    );
    Ok(Answer::new(
        206,
        b"Partial Content",
        headers,
        data.slice(range).open(),
    ))
}

pub(super) fn fetch_blob(blob: Option<Blob>, method: &[u8], asked: &HeaderList) -> Result<Answer> {
    let blob = blob
        .filter(|_| method == b"GET")
        .ok_or(NetError::FileNotFound)?;
    answer_with(
        &blob.data,
        [("content-type", &blob.mime)].into_iter().collect(),
        asked.get(b"range").as_deref(),
    )
}

pub fn mime_of_file(path: &[u8]) -> Vec<u8> {
    let Some(extension) = bun_paths::extension(path).get(1..) else {
        return b"text/plain".to_vec();
    };
    let mime = MimeType::by_extension(extension);
    strings::split_once_char(&mime.value, b';')
        .map_or(&*mime.value, |it| it.0)
        .to_vec()
}

/// To ask another computer for a file is to log in there, so documents only ask those that the app has asked.
pub fn may_ask_for_file(url: &Url, is_app: bool) -> bool {
    static ASKED: RwLock<Vec<Bytes>> = RwLock::new(Vec::new());
    let host = url.hostname();
    if !cfg!(windows) || ASKED.read().iter().any(|it| **it == *host) {
        return true;
    }
    if host.is_empty() {
        return is_app || url.file_path().is_some();
    }
    if is_app {
        ASKED.write().push(host.into());
    }
    is_app
}

const READ_AT_ONCE: u64 = 1 << 20;

pub(super) async fn fetch_file(url: &Url, asked: &HeaderList) -> Result<Answer> {
    let path = url.file_path().ok_or(NetError::FileNotFound)?;
    if let Some(bytes) = compiled::embedded_file(&path) {
        let headers = [
            ("content-type", &*mime_of_file(&path)),
            ("accept-ranges", b"bytes"),
        ];
        let (data, range) = (Data::Bytes(SharedBytes::new(bytes)), asked.get(b"range"));
        return answer_with(&data, headers.into_iter().collect(), range.as_deref());
    }
    let name = path.clone();
    let open = move || {
        // A FIFO would wait for a writer. On Windows the flag asks for overlapped reads.
        let at_once = if cfg!(windows) { 0 } else { O::NONBLOCK };
        let file = File::openat(Fd::cwd(), &name, O::RDONLY | O::CLOEXEC | at_once, 0)?;
        let stat = file.stat()?;
        if !bun_sys::S::ISREG(stat.st_mode as _) {
            return Err(NetError::FileNotFound);
        }
        Ok((
            stat,
            if stat.st_size as u64 <= READ_AT_ONCE {
                Some(file.read_to_end()?)
            } else {
                None
            },
        ))
    };
    let (stat, bytes) = blocking(open).await.ok_or(NetError::Failed)??;
    let mut date = [0; 32];
    let modified = ETag::wtf::write_http_date(
        &mut date,
        bun_sys::stat_mtime(&stat).sec.max(0) as u64 * 1000,
    );
    let headers = [
        ("content-type", &*mime_of_file(&path)),
        ("last-modified", modified),
        ("accept-ranges", b"bytes"),
    ]
    .into_iter()
    .collect();
    let data = bytes.map_or_else(
        || Data::File {
            path: path.into(),
            range: 0..stat.st_size as u64,
            modified: None,
        },
        |it| Data::Bytes(it.into()),
    );
    answer_with(&data, headers, asked.get(b"range").as_deref())
}

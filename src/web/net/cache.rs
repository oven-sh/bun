//! https://httpwg.org/specs/rfc9111.html, for one user. A response is a file.

use core::task::{Context, Poll, ready};
use std::rc::Rc;
use std::sync::Arc;

use bun_collections::{ArrayHashMap, HashMap};
use bun_core::{ZBox, strings};
use bun_sha_hmac::sha::evp::SHA256;
use bun_sys::{Dir, Fd, File, O};
use bun_threading::Guarded;

use super::body::{Body, Chunk, Read, SharedBytes, Source};
use super::error::{NetError, Result};
use super::record::{RecordReader, RecordWriter};
use super::response::{Answer, Cached};
use crate::Bytes;
use crate::exec::{self, LocalFuture, blocking};
use crate::headers::{HeaderList, digits, split};
use crate::origin::Origin;
use crate::request::CacheMode;
use crate::time::{parse_date, wall_now};
use crate::url::Url;

const MAX_BODY: usize = 16 << 20;
const MAX_ON_DISK: u64 = 256 << 20;
const MAX_IN_MEMORY: usize = 32 << 20;
const FORMAT: &[u8] = b"http cache 1";

#[derive(Clone)]
struct Entry {
    key: Bytes,
    status: u16,
    status_text: Bytes,
    headers: HeaderList,
    /// The headers of the request that the response varies by, as digests.
    varies: Vec<(Bytes, Option<Bytes>)>,
    requested_at: f64,
    received_at: f64,
    body: SharedBytes,
}

fn digest_of(headers: &HeaderList, name: &[u8]) -> Option<Bytes> {
    let mut digest = [0; 32];
    SHA256::hash(&headers.get(name)?, &mut digest);
    Some(digest.into())
}

struct CacheControl(Vec<u8>);

impl CacheControl {
    fn of(headers: &HeaderList) -> CacheControl {
        CacheControl(headers.get_or_empty(b"cache-control").to_ascii_lowercase())
    }

    fn get(&self, name: &[u8]) -> Option<&[u8]> {
        let mut directives =
            split(&self.0, b',').map(|it| strings::split_once_char(it, b'=').unwrap_or((it, b"")));
        directives
            .find(|it| it.0 == name)
            .map(|it| strings::trim(it.1, b"\""))
    }

    fn has(&self, name: &[u8]) -> bool {
        self.get(name).is_some()
    }

    fn seconds(&self, name: &[u8]) -> f64 {
        self.get(name).and_then(digits).unwrap_or(0) as f64
    }
}

impl Entry {
    fn date(&self, name: &[u8]) -> Option<f64> {
        parse_date(
            &self
                .headers
                .get(name)
                .filter(|it| it.first().is_some_and(u8::is_ascii_alphabetic))?,
        )
    }

    /// For how many more seconds it is fresh.
    fn freshness(&self, control: &CacheControl) -> f64 {
        if control.has(b"no-cache") || *self.headers.get_or_empty(b"pragma") == *b"no-cache" {
            return f64::NEG_INFINITY;
        }
        let date = self.date(b"date").unwrap_or(self.received_at);
        let is_cached_by_default = matches!(self.status, 200 | 203 | 204 | 404 | 405 | 414 | 501)
            || control.has(b"public");
        let lifetime = if control.has(b"max-age") {
            control.seconds(b"max-age")
        } else if self.headers.contains(b"expires") {
            self.date(b"expires").map_or(0.0, |it| it - date)
        } else if matches!(self.status, 300 | 301 | 308 | 410) {
            f64::INFINITY
        } else if is_cached_by_default && !control.has(b"must-revalidate") {
            self.date(b"last-modified")
                .map_or(0.0, |it| (date - it) / 10.0)
        } else {
            0.0
        };
        let age = split(&self.headers.get_or_empty(b"age"), b',')
            .next()
            .and_then(digits)
            .unwrap_or(0) as f64;
        let initial_age = (self.received_at - date).max(age + self.received_at - self.requested_at);
        lifetime - initial_age - (wall_now() - self.received_at)
    }

    fn answer(&self, cached: Cached) -> Answer {
        Answer {
            cached,
            ..Answer::new(
                self.status,
                &self.status_text,
                self.headers.clone(),
                Chunk::Shared(self.body.clone()).into(),
            )
        }
    }

    fn serialize(&self) -> Vec<u8> {
        let mut record = RecordWriter::default();
        for it in [FORMAT, &self.key, &self.status_text] {
            record.bytes(it);
        }
        for it in [f64::from(self.status), self.requested_at, self.received_at] {
            record.number(it);
        }
        record.count(self.headers.iter().count());
        for (name, value) in self.headers.iter() {
            record.bytes(name);
            record.bytes(value);
        }
        record.count(self.varies.len());
        for (name, value) in &self.varies {
            record.bytes(name);
            record.count(usize::from(value.is_some()));
            record.bytes(value.as_deref().unwrap_or_default());
        }
        record.count(self.body.len());
        record.0
    }

    fn parse(file: &SharedBytes) -> Option<Entry> {
        let mut record = RecordReader(file);
        (record.bytes()? == FORMAT).then_some(())?;
        let (key, status_text) = (record.bytes()?.into(), record.bytes()?.into());
        let (status, requested_at, received_at) =
            (record.number()? as u16, record.number()?, record.number()?);
        let headers = record
            .list(|it| Some((it.bytes()?, it.bytes()?)))?
            .into_iter()
            .collect();
        let varies = record.list(|it| {
            let (name, is_sent, value) = (it.bytes()?, it.count()? > 0, it.bytes()?);
            Some((name.into(), is_sent.then(|| value.into())))
        })?;
        let body = file.slice(file.len() - record.bytes()?.len()..file.len());
        record.0.is_empty().then_some(Entry {
            key,
            status,
            status_text,
            headers,
            varies,
            requested_at,
            received_at,
            body,
        })
    }
}

#[derive(Default)]
struct State {
    /// The oldest first. If there is a directory, what is being written to it.
    entries: ArrayHashMap<u64, Entry>,
    size: usize,
    /// The files that may be there, once that has been looked up.
    files: Option<HashMap<u64, ()>>,
    written_since_trim: Option<u64>,
}

pub struct HttpCache {
    directory: Option<Bytes>,
    state: Guarded<State>,
    /// Held while files change.
    disk: Guarded<()>,
}

fn name_of(hash: u64) -> ZBox {
    ZBox::from_bytes(format!("{hash:016x}").as_bytes())
}

struct Stored {
    hash: Option<u64>,
    name: ZBox,
    size: u64,
    modified: i64,
}

fn list(directory: &Dir) -> Vec<Stored> {
    let (mut found, mut entries) = (Vec::new(), bun_sys::dir_iterator::iterate(directory.fd()));
    while let Ok(Some(entry)) = entries.next() {
        let name = ZBox::from_bytes(entry.name.slice_u8());
        if let Ok(stat) = bun_sys::fstatat(directory.fd(), &name) {
            let hash = bun_core::fmt::parse_unsigned(name.as_bytes(), 16).ok();
            found.push(Stored {
                hash,
                name,
                size: stat.st_size as u64,
                modified: bun_sys::stat_mtime(&stat).sec,
            });
        }
    }
    found
}

pub(super) type Connect = Rc<dyn Fn(HeaderList) -> LocalFuture<'static, Result<Answer>>>;

impl HttpCache {
    pub(super) fn new(directory: Option<&[u8]>) -> HttpCache {
        HttpCache {
            directory: directory.map(|it| [it, b"/Cache"].concat().into()),
            state: Guarded::default(),
            disk: Guarded::new(()),
        }
    }

    fn open(&self) -> Option<Dir> {
        Dir::open(self.directory.as_deref()?).ok()
    }

    fn read_file(&self, hash: u64) -> Option<Entry> {
        let directory = self.open()?;
        if self.state.lock().files.is_none() {
            let _disk = self.disk.lock();
            let found = list(&directory);
            let mut state = self.state.lock();
            let files = state.files.get_or_insert_default();
            found
                .iter()
                .filter_map(|it| it.hash)
                .for_each(|it| _ = files.insert(it, ()));
        }
        Entry::parse(
            &File::read_from(directory.fd(), name_of(hash).as_bytes())
                .ok()?
                .into(),
        )
    }

    async fn read(self: &Arc<Self>, key: &[u8]) -> Option<Entry> {
        let hash = bun_wyhash::hash(key);
        let found = {
            let state = self.state.lock();
            let may_have_file = self.directory.is_some()
                && state.files.as_ref().is_none_or(|it| it.contains_key(&hash));
            state.entries.get(&hash).cloned().ok_or(may_have_file)
        };
        let cache = Arc::clone(self);
        let found = match found {
            Ok(entry) => entry,
            Err(true) => blocking(move || cache.read_file(hash)).await??,
            Err(false) => return None,
        };
        (*found.key == *key).then_some(found)
    }

    fn trim(&self, directory: &Dir) {
        let (mut files, mut size) = (list(directory), 0);
        bun_collections::index_sort::sort_slice_by_key(&mut files, |it| {
            core::cmp::Reverse(it.modified)
        });
        for file in files {
            size += file.size;
            if size > MAX_ON_DISK || file.hash.is_none() {
                let _ = bun_sys::unlinkat(directory.fd(), &file.name);
            }
        }
    }

    fn write_file(&self, hash: u64) -> Option<()> {
        let _disk = self.disk.lock();
        let entry = self.state.lock().entries.get(&hash).cloned()?;
        bun_sys::mkdir_recursive_at_mode(Fd::cwd(), self.directory.as_deref()?, 0o700).ok()?;
        let directory = self.open()?;
        let written = self
            .state
            .lock()
            .written_since_trim
            .map(|it| it + entry.body.len() as u64)
            .filter(|it| *it < MAX_ON_DISK / 8);
        self.state.lock().written_since_trim = written.or(Some(0));
        if written.is_none() {
            self.trim(&directory);
        }
        let partial = bun_core::zstr!("~");
        let file = File::openat(
            directory.fd(),
            partial.as_bytes(),
            O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC,
            0o600,
        )
        .ok()?;
        let result = file
            .write_all(&entry.serialize())
            .and_then(|()| file.write_all(&entry.body));
        drop(file);
        let result = result.and_then(|()| {
            bun_sys::renameat(directory.fd(), partial, directory.fd(), &name_of(hash))
        });
        let mut state = self.state.lock();
        if state
            .entries
            .get(&hash)
            .is_some_and(|it| it.received_at == entry.received_at)
        {
            state.forget(hash);
        }
        state.files.as_mut().map(|it| it.insert(hash, ()));
        result.ok()
    }

    fn write(self: &Arc<Self>, entry: Entry) {
        let hash = bun_wyhash::hash(&entry.key);
        let mut state = self.state.lock();
        state.forget(hash);
        state.size += entry.body.len();
        state.entries.insert(hash, entry);
        if self.directory.is_some() {
            let cache = Arc::clone(self);
            blocking(move || cache.write_file(hash));
        } else {
            while state.size > MAX_IN_MEMORY {
                let oldest = state.entries.keys()[0];
                state.forget(oldest);
            }
        }
    }

    async fn remove(self: &Arc<Self>, key: &[u8]) {
        let hash = bun_wyhash::hash(key);
        let may_have_file = {
            let mut state = self.state.lock();
            state.forget(hash);
            self.directory.is_some()
                && state
                    .files
                    .as_mut()
                    .is_none_or(|it| it.remove(&hash).is_some())
        };
        if may_have_file {
            let cache = Arc::clone(self);
            blocking(move || {
                let _disk = cache.disk.lock();
                bun_sys::unlinkat(cache.open()?.fd(), &name_of(hash)).ok()
            })
            .await;
        }
    }

    pub async fn size(self: Arc<Self>) -> u64 {
        if self.directory.is_none() {
            return self.state.lock().size as u64;
        }
        let measure = move || {
            let unwritten = self.state.lock().size as u64;
            unwritten
                + self
                    .open()
                    .map_or(0, |it| list(&it).iter().map(|it| it.size).sum())
        };
        blocking(measure).await.unwrap_or(0)
    }

    pub async fn clear(self: Arc<Self>) {
        blocking(move || {
            let _disk = self.disk.lock();
            *self.state.lock() = State::default();
            Dir::cwd().delete_tree(self.directory.as_deref()?).ok()
        })
        .await;
    }

    /// Stores the body when whoever asked has read all of it.
    async fn keep(
        self: &Arc<Self>,
        key: Bytes,
        asked: &HeaderList,
        requested_at: f64,
        mut answer: Answer,
    ) -> Answer {
        let control = CacheControl::of(&answer.headers);
        let vary = answer.headers.get_or_empty(b"vary");
        let mut entry = Entry {
            key,
            status: answer.status,
            status_text: answer.status_text.clone(),
            headers: answer.headers.clone(),
            varies: split(&vary, b',')
                .filter(|it| !it.is_empty())
                .map(|it| (it.into(), digest_of(asked, it)))
                .collect(),
            requested_at,
            received_at: wall_now(),
            body: Vec::new().into(),
        };
        entry.headers.delete(b"set-cookie");
        let is_useful = entry.headers.contains(b"etag")
            || entry.headers.contains(b"last-modified")
            || entry.freshness(&control) + control.seconds(b"stale-while-revalidate") > 0.0;
        let is_too_long = digits(&entry.headers.get_or_empty(b"content-length"))
            .is_some_and(|it| it > MAX_BODY as u64);
        let varies_by_all = entry.varies.iter().any(|it| *it.0 == *b"*");
        if !is_useful
            || is_too_long
            || varies_by_all
            || control.has(b"no-store")
            || matches!(entry.status, 206 | 304)
        {
            self.remove(&entry.key).await;
        } else if matches!(entry.status, 204 | 300..=399) {
            self.write(entry);
        } else {
            let source = core::mem::take(&mut answer.body);
            answer.body = Body::new(Copying {
                source,
                copy: Vec::new(),
                entry: Some(entry),
                cache: Arc::clone(self),
            });
        }
        answer
    }

    async fn validate(
        self: &Arc<Self>,
        mut entry: Entry,
        asked: &HeaderList,
        send: &Connect,
    ) -> Result<Answer> {
        let (mut conditional, requested_at) = (asked.clone(), wall_now());
        for (validator, condition) in [
            (&b"etag"[..], &b"if-none-match"[..]),
            (b"last-modified", b"if-modified-since"),
        ] {
            if let Some(value) = entry.headers.get(validator) {
                conditional.set(condition, &value);
            }
        }
        let answer = send(conditional).await?;
        if answer.status != 304 {
            return Ok(self.keep(entry.key, asked, requested_at, answer).await);
        }
        for (name, value) in answer.headers.sorted_and_combined() {
            match &*name {
                b"content-encoding" | b"content-length" | b"content-location" | b"content-md5"
                | b"content-range" | b"content-type" => {}
                b"etag" | b"transfer-encoding" | b"connection" | b"keep-alive" | b"set-cookie" => {}
                _ => entry.headers.set(&name, &value),
            }
        }
        (entry.requested_at, entry.received_at) = (requested_at, wall_now());
        let mut updated = Answer {
            protocol: answer.protocol,
            ..entry.answer(Cached::Validated)
        };
        answer
            .headers
            .values(b"set-cookie")
            .for_each(|it| updated.headers.append(b"set-cookie", it));
        self.write(entry);
        Ok(updated)
    }

    pub(super) async fn exchange(
        self: &Arc<Self>,
        partition: &[u8],
        url: &Url,
        method: &[u8],
        mut headers: HeaderList,
        mut mode: CacheMode,
        send: Connect,
    ) -> Result<Answer> {
        let key_of = |url: &Url| Bytes::from([partition, b"\n", url.without_fragment()].concat());
        let key = key_of(url);
        if method != b"GET" {
            let answer = send(headers).await?;
            if !matches!(method, b"HEAD" | b"OPTIONS") && answer.status < 400 {
                self.remove(&key).await;
                for name in [&b"location"[..], b"content-location"] {
                    let target = answer.headers.get(name).and_then(|it| url.join(&it));
                    if let Some(target) = target.filter(|it| Origin::of(url).is_origin_of(it)) {
                        self.remove(&key_of(&target)).await;
                    }
                }
            }
            return Ok(answer);
        }
        let is_condition = |name: &[u8]| {
            name.get(..3)
                .is_some_and(|it| it.eq_ignore_ascii_case(b"if-"))
        };
        if mode == CacheMode::Default && headers.iter().any(|it| is_condition(it.0)) {
            mode = CacheMode::NoStore;
        }
        let asked = CacheControl::of(&headers);
        if mode == CacheMode::NoCache {
            headers.set_if_absent(b"cache-control", b"max-age=0");
        }
        if matches!(mode, CacheMode::NoStore | CacheMode::Reload) {
            headers.set_if_absent(b"pragma", b"no-cache");
            headers.set_if_absent(b"cache-control", b"no-cache");
        }
        if mode == CacheMode::NoStore || asked.has(b"no-store") || headers.contains(b"range") {
            return send(headers).await;
        }
        let stored = if mode == CacheMode::Reload || asked.has(b"no-cache") {
            None
        } else {
            self.read(&key).await
        };
        let Some(entry) = stored.filter(|it| {
            it.varies
                .iter()
                .all(|it| digest_of(&headers, &it.0) == it.1)
        }) else {
            if mode == CacheMode::OnlyIfCached {
                return Err(NetError::CacheMiss);
            }
            let requested_at = wall_now();
            let answer = send(headers.clone()).await?;
            return Ok(self.keep(key, &headers, requested_at, answer).await);
        };
        if matches!(mode, CacheMode::ForceCache | CacheMode::OnlyIfCached) {
            return Ok(entry.answer(Cached::Local));
        }
        let control = CacheControl::of(&entry.headers);
        let must_validate = mode == CacheMode::NoCache || asked.get(b"max-age") == Some(b"0");
        let left = if must_validate {
            f64::NEG_INFINITY
        } else {
            entry.freshness(&control)
        };
        if left + control.seconds(b"stale-while-revalidate") <= 0.0 {
            return self.validate(entry, &headers, &send).await;
        }
        let answer = entry.answer(Cached::Local);
        if left <= 0.0 {
            let cache = Arc::clone(self);
            exec::spawn_background(async move {
                if let Ok(fresh) = cache.validate(entry, &headers, &send).await {
                    let _ = fresh.body.read_to_end().await;
                }
            });
        }
        Ok(answer)
    }
}

impl State {
    fn forget(&mut self, hash: u64) {
        if let Some(index) = self.entries.get_index(&hash) {
            self.size -= self.entries.values()[index].body.len();
            self.entries.ordered_remove(&hash);
        }
    }
}

struct Copying {
    source: Body,
    copy: Vec<u8>,
    entry: Option<Entry>,
    cache: Arc<HttpCache>,
}

impl Source for Copying {
    fn poll_read(&mut self, cx: &mut Context<'_>) -> Poll<Read> {
        let read = ready!(self.source.poll_read(cx));
        match &read {
            Ok(Some(chunk))
                if self.entry.is_some() && self.copy.len() + chunk.len() <= MAX_BODY =>
            {
                self.copy.extend_from_slice(chunk)
            }
            Ok(None) => {
                if let Some(entry) = self.entry.take() {
                    self.cache.write(Entry {
                        body: core::mem::take(&mut self.copy).into(),
                        ..entry
                    });
                }
            }
            _ => (self.entry, self.copy) = (None, Vec::new()),
        }
        Poll::Ready(read)
    }

    fn expect_read_to_end(&mut self, budget: &'static super::body::Budget, read: &mut Vec<u8>) {
        (self.copy).truncate(self.copy.len().saturating_sub(read.len()));
        self.source.expect_read_to_end(budget, read);
    }

    fn gathered(&self) -> u64 {
        self.source.gathered()
    }
}

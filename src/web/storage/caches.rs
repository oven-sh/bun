//! What <https://w3c.github.io/ServiceWorker/#cache-objects> store.

use std::sync::Arc;

use bun_core::strings;

use super::sql::{self, Connection, SqlError, Value::*};
use super::{Shelf, Storage};
use crate::Bytes;
use crate::headers::{HeaderList, split};
use crate::net::record::{RecordReader, RecordWriter};
use crate::remote::petition;

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct CacheId(pub i64);

pub struct CachedRequest {
    pub url: Bytes,
    pub method: Bytes,
    pub headers: HeaderList,
    /// 1 for a reload, 2 for a traversal of the history.
    pub navigation: u8,
}

pub struct CachedResponse {
    pub kind: Bytes,
    pub url: Bytes,
    pub is_redirected: bool,
    pub omits_credentials: bool,
    pub status: u16,
    pub status_text: Bytes,
    pub headers: HeaderList,
    pub body: Option<Vec<u8>>,
}

crate::wire!(impl CacheId(_));
crate::wire!(impl CachedRequest { url, method, headers, navigation });
crate::wire!(impl CachedResponse { kind, url, is_redirected, omits_credentials, status, status_text, headers, body });
crate::wire!(impl QueryOptions { ignores_search, ignores_vary });
crate::wire!(impl enum PutError { Duplicate, Sql(SqlError), });

#[derive(Clone, Copy, Default)]
pub struct QueryOptions {
    pub ignores_search: bool,
    pub ignores_vary: bool,
}

pub enum PutError {
    Duplicate,
    Sql(SqlError),
}

impl From<SqlError> for PutError {
    fn from(error: SqlError) -> PutError {
        PutError::Sql(error)
    }
}

impl CachedRequest {
    fn serialize(&self) -> Vec<u8> {
        let mut out = RecordWriter::default();
        out.bytes(&self.url);
        out.bytes(&self.method);
        self.headers.write(&mut out);
        out.0.push(self.navigation);
        out.0
    }

    fn parse(bytes: &[u8]) -> Option<CachedRequest> {
        let mut it = RecordReader(bytes);
        Some(CachedRequest {
            url: it.bytes()?.into(),
            method: it.bytes()?.into(),
            headers: HeaderList::read(&mut it)?,
            navigation: it.0.first().copied().unwrap_or(0),
        })
    }

    /// Without the fragment, and where the query starts.
    fn compared_url(&self) -> (&[u8], usize) {
        let url = strings::split_once_char(&self.url, b'#').map_or(&*self.url, |it| it.0);
        (
            url,
            strings::index_of_char_usize(url, b'?').unwrap_or(url.len()),
        )
    }
}

impl CachedResponse {
    fn serialize_head(&self) -> Vec<u8> {
        let mut out = RecordWriter::default();
        out.bytes(&self.kind);
        out.bytes(&self.url);
        out.count(usize::from(self.is_redirected) + 2 * usize::from(self.omits_credentials));
        out.count(self.status.into());
        out.bytes(&self.status_text);
        self.headers.write(&mut out);
        out.0
    }

    fn parse_head(bytes: &[u8]) -> Option<CachedResponse> {
        let mut it = RecordReader(bytes);
        let (kind, url, flags) = (it.bytes()?.into(), it.bytes()?.into(), it.count()?);
        Some(CachedResponse {
            kind,
            url,
            is_redirected: flags & 1 != 0,
            omits_credentials: flags & 2 != 0,
            status: it.count()? as u16,
            status_text: it.bytes()?.into(),
            headers: HeaderList::read(&mut it)?,
            body: None,
        })
    }
}

struct Entry {
    row: i64,
    request: CachedRequest,
    response: CachedResponse,
}

impl Entry {
    fn varies_from(&self, asked: &CachedRequest) -> bool {
        let vary = self.response.headers.get_or_empty(b"vary");
        split(&vary, b',')
            .map(<[u8]>::trim_ascii)
            .any(|name| name == b"*" || asked.headers.get(name) != self.request.headers.get(name))
    }
}

/// <https://w3c.github.io/ServiceWorker/#query-cache-algorithm>
fn query(
    sql: &mut Connection,
    cache: CacheId,
    asked: Option<&CachedRequest>,
    options: QueryOptions,
) -> sql::Result<Vec<Entry>> {
    let read = |it: &sql::Row<'_>| {
        Some(Entry {
            row: it.integer(0),
            request: CachedRequest::parse(it.bytes(1))?,
            response: CachedResponse::parse_head(it.bytes(2))?,
        })
    };
    let found = match asked.map(CachedRequest::compared_url) {
        None => sql.all("SELECT rowid, request, response FROM cached WHERE cache = ? ORDER BY rowid", &[Integer(cache.0)], read),
        Some((url, search)) if options.ignores_search => sql.all(
            "SELECT rowid, request, response FROM cached WHERE cache = ?1 AND (url = ?2 OR (url >= ?2 || '?' AND url < ?2 || '@')) ORDER BY rowid",
            &[Integer(cache.0), Text(&url[..search])],
            read,
        ),
        Some((url, _)) => sql.all("SELECT rowid, request, response FROM cached WHERE cache = ? AND url = ? ORDER BY rowid", &[Integer(cache.0), Text(url)], read),
    };
    Ok(found?
        .into_iter()
        .flatten()
        .filter(|it| options.ignores_vary || !asked.is_some_and(|asked| it.varies_from(asked)))
        .collect())
}

fn remove(sql: &mut Connection, entries: &[Entry]) -> sql::Result {
    entries
        .iter()
        .try_for_each(|it| sql.run("DELETE FROM cached WHERE rowid = ?", &[Integer(it.row)]))
}

fn with_body(sql: &mut Connection, entry: Entry) -> sql::Result<CachedResponse> {
    let body = sql.one(
        "SELECT body FROM cached WHERE rowid = ?",
        &[Integer(entry.row)],
        |it| (!it.is_null(0)).then(|| it.bytes(0).to_vec()),
    )?;
    Ok(CachedResponse {
        body: body.flatten(),
        ..entry.response
    })
}

fn find(sql: &mut Connection, bucket: &[u8], name: &[u8]) -> sql::Result<Option<CacheId>> {
    sql.one(
        "SELECT id FROM cache_names WHERE bucket = ? AND name = ?",
        &[Text(bucket), Blob(name)],
        |it| CacheId(it.integer(0)),
    )
}

/// Of one bucket. What is asked for is done in that order. Names are encoded like keys.
pub struct Caches {
    pub storage: Arc<Storage>,
    pub bucket: Bytes,
}

macro_rules! later {
    ($result:ty) => { impl Future<Output = Result<$result, SqlError>> + use<> };
}

impl Caches {
    fn shelf(&self) -> Option<Shelf> {
        self.storage.far_shelf(&self.bucket)
    }

    pub fn names(&self) -> later!(Vec<Bytes>) {
        in_host_or_here!(
            self.shelf(),
            |it| SqlError::unless(petition::cache_names(it)),
            {
                let bucket = self.bucket.clone();
                self.storage.write(move |sql| sql.all("SELECT name FROM cache_names WHERE bucket = ? AND name IS NOT NULL ORDER BY id", &[Text(&bucket)], |it| it.bytes(0).into()))
            }
        )
    }

    pub fn has(&self, name: Vec<u8>) -> later!(bool) {
        in_host_or_here!(
            self.shelf(),
            |it| SqlError::unless(petition::has_cache(it, name)),
            {
                let bucket = self.bucket.clone();
                self.storage
                    .write(move |sql| Ok(find(sql, &bucket, &name)?.is_some()))
            }
        )
    }

    pub fn open(&self, name: Vec<u8>) -> later!(CacheId) {
        in_host_or_here!(
            self.shelf(),
            |it| SqlError::unless(petition::open_cache(it, name)),
            {
                let bucket = self.bucket.clone();
                self.storage
                    .write(move |sql| match find(sql, &bucket, &name)? {
                        Some(known) => Ok(known),
                        None => Ok(sql
                            .one(
                                "INSERT INTO cache_names (bucket, name) VALUES (?, ?) RETURNING id",
                                &[Text(&bucket), Blob(&name)],
                                |it| CacheId(it.integer(0)),
                            )?
                            .expect("a row")),
                    })
            }
        )
    }

    /// Whoever has it open can go on using it.
    pub fn delete(&self, name: Vec<u8>) -> later!(bool) {
        in_host_or_here!(
            self.shelf(),
            |it| SqlError::unless(petition::delete_cache(it, name)),
            {
                let bucket = self.bucket.clone();
                self.storage.write(move |sql| Ok(sql.one("UPDATE cache_names SET name = NULL WHERE bucket = ? AND name = ? RETURNING id", &[Text(&bucket), Blob(&name)], |_| ())?.is_some()))
            }
        )
    }

    /// In the cache of that name, or in all.
    pub fn first_response(
        &self,
        name: Option<Vec<u8>>,
        asked: CachedRequest,
        options: QueryOptions,
    ) -> later!(Option<CachedResponse>) {
        in_host_or_here!(
            self.shelf(),
            |it| SqlError::unless(petition::first_response(it, name, asked, options)),
            {
                let bucket = self.bucket.clone();
                self.storage.write(move |sql| {
                let values = [Text(&bucket), name.as_deref().map_or(Null, Blob)];
                for cache in sql.all("SELECT id FROM cache_names WHERE bucket = ?1 AND name = ifnull(?2, name) ORDER BY id", &values, |it| CacheId(it.integer(0)))? {
                    if let Some(found) = query(sql, cache, Some(&asked), options)?.into_iter().next() {
                        return with_body(sql, found).map(Some);
                    }
                }
                Ok(None)
            })
            }
        )
    }

    pub fn requests(
        &self,
        cache: CacheId,
        asked: Option<CachedRequest>,
        options: QueryOptions,
    ) -> later!(Vec<CachedRequest>) {
        in_host_or_here!(
            self.shelf(),
            |it| SqlError::unless(petition::requests(it, cache, asked, options)),
            {
                self.storage.write(move |sql| {
                    Ok(query(sql, cache, asked.as_ref(), options)?
                        .into_iter()
                        .map(|it| it.request)
                        .collect())
                })
            }
        )
    }

    pub fn responses(
        &self,
        cache: CacheId,
        asked: Option<CachedRequest>,
        options: QueryOptions,
        limit: usize,
    ) -> later!(Vec<CachedResponse>) {
        in_host_or_here!(
            self.shelf(),
            |it| SqlError::unless(petition::responses(it, cache, asked, options, limit)),
            {
                self.storage.write(move |sql| {
                    query(sql, cache, asked.as_ref(), options)?
                        .into_iter()
                        .take(limit)
                        .map(|it| with_body(sql, it))
                        .collect()
                })
            }
        )
    }

    pub fn remove(
        &self,
        cache: CacheId,
        asked: CachedRequest,
        options: QueryOptions,
    ) -> later!(bool) {
        in_host_or_here!(
            self.shelf(),
            |it| SqlError::unless(petition::remove_cached(it, cache, asked, options)),
            {
                self.storage.write(move |sql| {
                    let found = query(sql, cache, Some(&asked), options)?;
                    sql.atomically(|sql| remove(sql, &found))
                        .map(|()| !found.is_empty())
                })
            }
        )
    }

    /// <https://w3c.github.io/ServiceWorker/#batch-cache-operations-algorithm>
    pub fn put(
        &self,
        cache: CacheId,
        entries: Vec<(CachedRequest, CachedResponse)>,
    ) -> impl Future<Output = Result<(), PutError>> + use<> {
        in_host_or_here!(
            self.shelf(),
            |it| SqlError::unless(petition::put_cached(it, cache, entries)),
            {
                let store = move |sql: &mut Connection| {
                    let mut first = i64::MAX;
                    for (request, response) in &entries {
                        let replaced = query(sql, cache, Some(request), QueryOptions::default())?;
                        if replaced.iter().any(|it| it.row >= first) {
                            return Err(PutError::Duplicate);
                        }
                        let (about, head) = (request.serialize(), response.serialize_head());
                        let values = [
                            Integer(cache.0),
                            Text(request.compared_url().0),
                            Blob(&about),
                            Blob(&head),
                            response.body.as_deref().map_or(Null, Blob),
                        ];
                        sql.each(
                            "INSERT INTO cached VALUES (?, ?, ?, ?, ?) RETURNING rowid",
                            &values,
                            |it| first = first.min(it.integer(0)),
                        )?;
                        remove(sql, &replaced)?;
                    }
                    Ok(())
                };
                self.storage.write(move |sql| sql.atomically(store))
            }
        )
    }
}

//! What the pages of a session store. <https://storage.spec.whatwg.org/>

pub mod caches;
pub mod files;
mod import;
pub mod indexed;
pub mod key;
mod large;
mod sql;
mod upgrade;

use core::sync::atomic::{AtomicBool, Ordering};
use core::time::Duration;
use std::sync::{Arc, OnceLock, Weak};

use bun_core::{ZBox, strings};
use bun_sys::{Fd, File, O};
use bun_threading::Guarded;

use self::indexed::Database;
use self::key::Key;
pub use self::sql::SqlError;
use self::sql::{Connection, Value::*};
use crate::Bytes;
use crate::exec::{LocalFuture, Thread, sleep, spawn_background};
use crate::net::cookies::Cookie;
use crate::serial::Serial;

pub const QUOTA: u64 = 1 << 36;
const DELAY_OF_AREA_CHANGES: Duration = Duration::from_millis(500);

crate::wire! {
    /// Some origins, or all others.
    pub struct Origins {
        pub listed: Vec<Bytes>,
        pub are_meant: bool,
    }
}

impl Origins {
    pub fn include(&self, bucket: &[u8]) -> bool {
        let origin = strings::split_once_char(bucket, b'^').map_or(bucket, |it| it.0);
        self.listed.iter().any(|it| **it == *origin) == self.are_meant
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy)]
    pub struct Kinds: u8 {
        const AREAS = 1;
        const DATABASES = 2;
        const CACHES = 4;
        const FILES = 8;
    }
}

crate::wire! {
    /// Of `localStorage`. The strings are UTF-16LE.
    pub enum AreaChange {
        Set { key: Bytes, value: Bytes },
        Remove { key: Bytes },
        Clear,
    }
}

crate::wire! {
    pub struct Usage {
        pub of_databases: f64,
        pub of_caches: f64,
        pub of_files: f64,
    }
}

struct Connections {
    writer: Guarded<Connection>,
    /// It does not wait for the writer. There is none for what is only in memory.
    reader: Option<Guarded<Connection>>,
}

impl Connections {
    fn writer(file: &ZBox) -> sql::Result<Guarded<Connection>> {
        let mut writer = Connection::open(file, Connection::READ_WRITE)?;
        writer.execute(
            c"PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS cookies (id TEXT PRIMARY KEY, cookie BLOB);
            CREATE TABLE IF NOT EXISTS local_storage (origin TEXT, key BLOB, value BLOB, PRIMARY KEY (origin, key));
            CREATE TABLE IF NOT EXISTS databases (bucket TEXT, name BLOB, version INTEGER, stores BLOB, PRIMARY KEY (bucket, name));
            CREATE TABLE IF NOT EXISTS tables (id INTEGER PRIMARY KEY, bucket TEXT, name BLOB, next_key REAL);
            CREATE TABLE IF NOT EXISTS records (tab INTEGER, key BLOB, value BLOB, PRIMARY KEY (tab, key));
            CREATE INDEX IF NOT EXISTS large_records ON records (tab, key, value) WHERE typeof(value) = 'text';
            CREATE TABLE IF NOT EXISTS cache_names (id INTEGER PRIMARY KEY AUTOINCREMENT, bucket TEXT, name BLOB);
            CREATE TABLE IF NOT EXISTS cached (cache INTEGER, url TEXT, request BLOB, response BLOB, body BLOB);
            CREATE INDEX IF NOT EXISTS cached_by_url ON cached (cache, url);
            DELETE FROM cached WHERE cache IN (SELECT id FROM cache_names WHERE name IS NULL);
            DELETE FROM cache_names WHERE name IS NULL;",
        )?;
        let _ = upgrade::upgrade(&mut writer);
        Ok(Guarded::new(writer))
    }

    fn of_directory(directory: &[u8]) -> Option<Connections> {
        let file = |suffix: &str| {
            ZBox::from_bytes([directory, b"/Web Storage.sqlite", suffix.as_bytes()].concat())
        };
        let open = || {
            drop(File::open(
                &file(""),
                O::WRONLY | O::CREAT | O::CLOEXEC,
                0o600,
            ));
            Connections::writer(&file(""))
        };
        bun_sys::mkdir_recursive_at_mode(Fd::cwd(), directory, 0o700).ok()?;
        let writer = match open() {
            Err(error) if error.is_damage() => {
                _ = ["-wal", "-shm"].map(|it| bun_sys::unlink(&file(it)));
                bun_sys::rename(&file(""), &file(".damaged")).ok()?;
                open()
            }
            opened => opened,
        };
        let mut reader = Connection::open(&file(""), Connection::READ_ONLY).ok()?;
        reader.execute(c"PRAGMA busy_timeout = 5000").ok()?;
        Some(Connections {
            writer: writer.ok()?,
            reader: Some(Guarded::new(reader)),
        })
    }
}

fn durably<R>(
    sql: &mut Connection,
    is_strict: bool,
    steps: impl FnOnce(&mut Connection) -> R,
) -> R {
    if !is_strict {
        return steps(sql);
    }
    let _ = sql.execute(c"PRAGMA synchronous = FULL");
    let result = steps(sql);
    let _ = sql.execute(c"PRAGMA synchronous = NORMAL");
    result
}

pub struct Storage {
    directory: Option<Bytes>,
    main: Thread,
    connections: OnceLock<sql::Result<Connections>>,
    writes: Arc<Serial>,
    databases: Guarded<Vec<Weak<Database>>>,
    area_changes: Guarded<Vec<(Bytes, AreaChange)>>,
    has_imported_areas: AtomicBool,
    has_looked_for_unused_values: AtomicBool,
    persisted: Guarded<Vec<Bytes>>,
    areas_cleared: OnceLock<fn(&Storage, &Origins)>,
    files: files::Files,
}

impl Storage {
    /// On the main thread. Without a directory, nothing outlasts the program.
    pub fn new(directory: Option<&[u8]>) -> Arc<Storage> {
        Arc::new(Storage {
            directory: directory.map(Bytes::from),
            main: Thread::current(),
            connections: OnceLock::new(),
            writes: Arc::default(),
            databases: Guarded::default(),
            area_changes: Guarded::default(),
            has_imported_areas: AtomicBool::new(false),
            has_looked_for_unused_values: AtomicBool::new(false),
            persisted: Guarded::default(),
            areas_cleared: OnceLock::new(),
            files: files::Files::default(),
        })
    }

    /// For what has no session: it is flushed when the program ends.
    pub fn of_program(directory: Option<&[u8]>) -> Arc<Storage> {
        static OF_PROGRAM: OnceLock<Arc<Storage>> = OnceLock::new();
        static IN_MEMORY: OnceLock<Arc<Storage>> = OnceLock::new();
        if directory.is_none() {
            return Arc::clone(IN_MEMORY.get_or_init(|| Storage::new(None)));
        }
        extern "C" fn flush() {
            OF_PROGRAM.get().into_iter().for_each(Storage::flush);
        }
        bun_core::add_exit_callback(flush);
        Arc::clone(OF_PROGRAM.get_or_init(|| Storage::new(directory)))
    }

    fn connections(&self) -> sql::Result<&Connections> {
        let in_memory = || {
            Ok(Connections {
                writer: Connections::writer(&ZBox::from_bytes(b":memory:"))?,
                reader: None,
            })
        };
        let open = || {
            self.directory
                .as_deref()
                .and_then(Connections::of_directory)
                .map_or_else(in_memory, Ok)
        };
        self.connections
            .get_or_init(open)
            .as_ref()
            .map_err(|it| *it)
    }

    /// On this thread.
    fn read<T, E: From<SqlError>>(
        &self,
        steps: impl FnOnce(&mut Connection) -> Result<T, E>,
    ) -> Result<T, E> {
        let connections = self.connections()?;
        steps(
            &mut connections
                .reader
                .as_ref()
                .unwrap_or(&connections.writer)
                .lock(),
        )
    }

    fn write_now<T, E: From<SqlError>>(
        &self,
        steps: impl FnOnce(&mut Connection) -> Result<T, E>,
    ) -> Result<T, E> {
        steps(&mut self.connections()?.writer.lock())
    }

    /// On another thread, after what has been asked for before. It is done whether or not somebody waits.
    fn write<T, E, F>(
        self: &Arc<Self>,
        steps: F,
    ) -> impl Future<Output = Result<T, E>> + use<T, E, F>
    where
        T: Send + 'static,
        E: From<SqlError> + Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, E> + Send + 'static,
    {
        let this = Arc::clone(self);
        let result = self.writes.run(move || this.write_now(steps));
        async { result.await.expect("it has run") }
    }

    /// Of what another program has left in the directory. It is tried again the next time if it fails.
    fn import_once<T>(
        &self,
        kind: i64,
        read: impl FnOnce(&[u8]) -> Option<T>,
        keep: impl FnOnce(&mut Connection, T) -> sql::Result,
    ) {
        let Some(directory) = &self.directory else {
            return;
        };
        let _ = self.write_now(|sql| {
            let done = sql
                .one("PRAGMA user_version", &[], |it| it.integer(0))?
                .unwrap_or_default();
            let Some(found) = (done & kind == 0).then(|| read(directory)).flatten() else {
                return Ok(());
            };
            sql.atomically(|sql| keep(sql, found))?;
            sql.execute(
                [
                    c"PRAGMA user_version = 1",
                    c"PRAGMA user_version = 2",
                    c"PRAGMA user_version = 3",
                ][((done | kind) & 3) as usize - 1],
            )
        });
    }

    pub fn import_cookies(&self, decrypt: &dyn Fn(&[u8]) -> Option<Vec<u8>>) -> Vec<Cookie> {
        let mut cookies = Vec::new();
        self.import_once(
            1,
            |it| import::cookies(it, decrypt).map(|it| cookies = it),
            |_, ()| Ok(()),
        );
        cookies.extend(
            self.write_now(|sql| import::cookies_in_database(sql, decrypt))
                .unwrap_or_default(),
        );
        cookies
    }

    fn import_areas(&self) {
        if !self.has_imported_areas.swap(true, Ordering::Relaxed) {
            self.import_once(2, import::local_storage, |sql, items| {
                items.iter().try_for_each(|[origin, key, value]| {
                    sql.run(
                        "INSERT OR IGNORE INTO local_storage VALUES (?, ?, ?)",
                        &[Text(origin), Blob(key), Blob(value)],
                    )
                })
            });
        }
    }

    /// Who keeps it in memory from then on hears by `cleared`, on the main thread, when that is out of date.
    pub fn read_area(
        &self,
        origin: &[u8],
        cleared: fn(&Storage, &Origins),
        mut item: impl FnMut(&[u8], &[u8]),
    ) {
        self.areas_cleared.get_or_init(|| cleared);
        self.import_areas();
        let _ = self.read(|sql| {
            sql.each(
                "SELECT key, value FROM local_storage WHERE origin = ?",
                &[Text(origin)],
                |it| item(it.bytes(0), it.bytes(1)),
            )
        });
    }

    pub fn is_persistent(&self) -> bool {
        self.directory.is_some()
    }

    /// Nothing is ever evicted, so this is only what scripts are told.
    pub fn is_persisted(&self, bucket: &[u8]) -> bool {
        self.persisted.lock().iter().any(|it| **it == *bucket)
    }

    pub fn persist(&self, bucket: &[u8]) {
        if !self.is_persisted(bucket) {
            self.persisted.lock().push(bucket.into());
        }
    }

    pub fn change_area(self: &Arc<Self>, origin: &[u8], change: AreaChange) {
        let mut changes = self.area_changes.lock();
        if changes.is_empty() {
            let this = Arc::clone(self);
            spawn_background(async move {
                sleep(DELAY_OF_AREA_CHANGES).await;
                this.store_area_changes();
            });
        }
        if let (
            AreaChange::Set { key, .. },
            Some((last_origin, AreaChange::Set { key: last_key, .. })),
        ) = (&change, changes.last())
            && (key, origin) == (last_key, last_origin)
        {
            changes.pop();
        }
        changes.push((origin.into(), change));
    }

    fn store_area_changes(self: &Arc<Self>) {
        let changes = core::mem::take(&mut *self.area_changes.lock());
        if changes.is_empty() {
            return;
        }
        drop(self.write(move |sql| {
            sql.atomically(|sql| {
                changes
                    .iter()
                    .try_for_each(|(origin, change)| match change {
                        AreaChange::Set { key, value } => sql.run(
                            "INSERT OR REPLACE INTO local_storage VALUES (?, ?, ?)",
                            &[Text(origin), Blob(key), Blob(value)],
                        ),
                        AreaChange::Remove { key } => sql.run(
                            "DELETE FROM local_storage WHERE origin = ? AND key = ?",
                            &[Text(origin), Blob(key)],
                        ),
                        AreaChange::Clear => sql.run(
                            "DELETE FROM local_storage WHERE origin = ?",
                            &[Text(origin)],
                        ),
                    })
            })
        }));
    }

    pub fn database(self: &Arc<Self>, bucket: &[u8], name: Key) -> Arc<Database> {
        let mut databases = self.databases.lock();
        databases.retain(|it| it.strong_count() > 0);
        databases
            .iter()
            .filter_map(Weak::upgrade)
            .find(|it| *it.bucket == *bucket && it.name == name)
            .unwrap_or_else(|| {
                let database = Arc::new(Database::new(Arc::clone(self), bucket, name));
                databases.push(Arc::downgrade(&database));
                database
            })
    }

    /// Their names and versions.
    pub async fn databases(self: Arc<Self>, bucket: Vec<u8>) -> sql::Result<Vec<(Key, u64)>> {
        self.write(move |sql| {
            sql.all(
                "SELECT name, version FROM databases WHERE bucket = ?",
                &[Text(&bucket)],
                |it| (it.bytes(0).into(), it.integer(1) as u64),
            )
        })
        .await
    }

    pub async fn usage(self: Arc<Self>, bucket: Vec<u8>) -> sql::Result<Usage> {
        let this = Arc::clone(&self);
        let measure = move |sql: &mut Connection| {
            let mut sum = |query| {
                sql.one(query, &[Text(&bucket)], |it| it.real(0))
                    .map(Option::unwrap_or_default)
            };
            Ok(Usage {
                of_databases: sum(
                    "SELECT total(length(key) + iif(typeof(value) = 'text', CAST(value AS INTEGER), length(value))) FROM records JOIN tables ON id = tab WHERE bucket = ?",
                )? + sum(
                    "SELECT total(length(name) + length(stores)) FROM databases WHERE bucket = ?",
                )?,
                of_caches: sum(
                    "SELECT total(length(request) + length(response) + ifnull(length(body), 0)) FROM cached JOIN cache_names ON id = cache WHERE bucket = ?",
                )?,
                of_files: this.size_of_files(&bucket) as f64,
            })
        };
        self.write(measure).await
    }

    fn clear_buckets(
        self: &Arc<Self>,
        origins: Arc<Origins>,
        buckets: &'static str,
        deletions: &'static [&'static str],
    ) -> LocalFuture<'static, sql::Result> {
        Box::pin(self.write(move |sql| {
            let all = sql.all(buckets, &[], |it| Bytes::from(it.bytes(0)))?;
            sql.atomically(|sql| {
                all.iter()
                    .filter(|it| origins.include(it))
                    .try_for_each(|it| {
                        deletions
                            .iter()
                            .try_for_each(|deletion| sql.run(deletion, &[Text(it)]))
                    })
            })
        }))
    }

    pub async fn clear(self: Arc<Self>, kinds: Kinds, origins: Origins) {
        let (this, origins) = (Arc::clone(&self), Arc::new(origins));
        let clear = move || async move {
            let of = |kind: Kinds| kinds.contains(kind).then(|| Arc::clone(&origins));
            let (areas, databases) = (
                of(Kinds::AREAS).map(|it| this.clear_areas(it)),
                of(Kinds::DATABASES).map(|it| this.clear_databases(it)),
            );
            let (caches, files) = (
                of(Kinds::CACHES).map(|it| this.clear_caches(it)),
                of(Kinds::FILES).map(|it| this.clear_files(it)),
            );
            for cleared in [areas, databases, caches].into_iter().flatten() {
                let _ = cleared.await;
            }
            if let Some(cleared) = files {
                cleared.await;
            }
        };
        self.main.call(clear).await;
    }

    fn clear_areas(self: &Arc<Self>, origins: Arc<Origins>) -> LocalFuture<'static, sql::Result> {
        self.import_areas();
        self.store_area_changes();
        if let Some(cleared) = self.areas_cleared.get() {
            cleared(self, &origins);
        }
        self.clear_buckets(
            origins,
            "SELECT DISTINCT origin FROM local_storage",
            &["DELETE FROM local_storage WHERE origin = ?"],
        )
    }

    fn clear_databases(
        self: &Arc<Self>,
        origins: Arc<Origins>,
    ) -> LocalFuture<'static, sql::Result> {
        let open: Vec<_> = self
            .databases
            .lock()
            .iter()
            .filter_map(Weak::upgrade)
            .collect();
        open.iter()
            .filter(|it| origins.include(&it.bucket))
            .for_each(|it| it.forget());
        let cleared = self.clear_buckets(
            origins,
            "SELECT DISTINCT bucket FROM databases",
            &[
                "DELETE FROM records WHERE tab IN (SELECT id FROM tables WHERE bucket = ?)",
                "DELETE FROM tables WHERE bucket = ?",
                "DELETE FROM databases WHERE bucket = ?",
            ],
        );
        let this = Arc::clone(self);
        let removed = self.write(move |sql| Ok(_ = this.remove_unused_large_values(sql)));
        Box::pin(async { cleared.await.and(removed.await) })
    }

    fn clear_caches(self: &Arc<Self>, origins: Arc<Origins>) -> LocalFuture<'static, sql::Result> {
        self.clear_buckets(
            origins,
            "SELECT DISTINCT bucket FROM cache_names",
            &[
                "DELETE FROM cached WHERE cache IN (SELECT id FROM cache_names WHERE bucket = ?)",
                "DELETE FROM cache_names WHERE bucket = ?",
            ],
        )
    }

    /// Returns when all is written.
    pub fn flush(self: &Arc<Self>) {
        self.store_area_changes();
        self.writes.finish();
    }
}

unsafe extern "Rust" {
    #[link_name = "__bun_dom_copy_session_storage"]
    pub safe fn copy_session_storage(from_tab: u32, to_tab: u32, bucket: &[u8]);
    #[link_name = "__bun_dom_drop_session_storage"]
    pub safe fn drop_session_storage(tab: u32);
}

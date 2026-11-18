//! What service workers are installed with.

use std::sync::Arc;

use bun_core::ZBox;
use bun_sys::{File, FileLockMode, O};

use super::Storage;
use super::sql::{self, SqlError, Value::*};
use crate::Bytes;

const MOST_BYTES_IN_BUCKET: i64 = 256 << 20;

impl Storage {
    fn write_scripts<T: Send + 'static, F>(
        self: &Arc<Self>,
        steps: F,
    ) -> impl Future<Output = sql::Result<T>> + use<T, F>
    where
        F: FnOnce(&mut sql::Connection) -> sql::Result<T> + Send + 'static,
    {
        let this = Arc::clone(self);
        self.write(move |sql| {
            let is_makeshift = this.directory.is_some() && this.connections()?.reader.is_none();
            if is_makeshift {
                Err(SqlError::IO)
            } else {
                steps(sql)
            }
        })
    }

    pub(crate) async fn keep_scripts(
        self: Arc<Self>,
        row: i64,
        bucket: Bytes,
        make: impl FnOnce() -> Vec<u8> + Send + 'static,
    ) -> sql::Result {
        let keep = move |sql: &mut sql::Connection| {
            let (scripts, query) = (
                make(),
                "SELECT total(length(value)) FROM scripts WHERE bucket = ?",
            );
            let used = sql.one(query, &[Text(&bucket)], |it| it.integer(0))?;
            if used.unwrap_or_default() + scripts.len() as i64 > MOST_BYTES_IN_BUCKET {
                return Err(SqlError::FULL);
            }
            sql.run(
                "INSERT INTO scripts VALUES (?, ?, ?)",
                &[Integer(row), Text(&bucket), Blob(&scripts)],
            )
        };
        self.write_scripts(keep).await
    }

    pub(crate) async fn read_scripts<T: Send + 'static>(
        self: Arc<Self>,
        row: i64,
        bucket: Bytes,
        parse: impl Fn(&[u8]) -> Option<T> + Send + 'static,
    ) -> sql::Result<Option<T>> {
        let read = move |sql: &mut sql::Connection| {
            let query = "SELECT value FROM scripts WHERE id = ? AND bucket = ?";
            Ok(sql
                .one(query, &[Integer(row), Text(&bucket)], |it| {
                    parse(it.bytes(0))
                })?
                .flatten())
        };
        self.write_scripts(read).await
    }

    /// Unless `first` fails.
    pub(crate) fn delete_scripts(
        self: &Arc<Self>,
        rows: Vec<i64>,
        first: impl FnOnce() -> Option<()> + Send + 'static,
    ) {
        drop(self.write_scripts(move |sql| {
            first().ok_or(SqlError::IO)?;
            (rows.into_iter())
                .try_for_each(|it| sql.run("DELETE FROM scripts WHERE id = ?", &[Integer(it)]))
        }));
    }

    /// Unless another process uses the directory, which may need them. `rows` are sorted.
    pub(crate) fn delete_scripts_but(self: &Arc<Self>, rows: Vec<i64>) {
        let this = Arc::clone(self);
        drop(self.write_scripts(move |sql| {
            let Some(directory) = &this.directory else {
                return Ok(());
            };
            let path = ZBox::from_bytes([directory, &b"/Service Workers.lock"[..]].concat());
            let lock = |how, or_not_at_all| {
                let file = File::open(&path, O::RDWR | O::CREAT | O::CLOEXEC, 0o600).ok()?;
                (bun_sys::flock(file.fd(), how, or_not_at_all).ok()?).then_some(file)
            };
            let deleted = lock(FileLockMode::Exclusive, true).map_or(Ok(()), |_alone| {
                let all = sql.all("SELECT id FROM scripts", &[], |it| it.integer(0))?;
                (all.into_iter().filter(|it| rows.binary_search(it).is_err()))
                    .try_for_each(|it| sql.run("DELETE FROM scripts WHERE id = ?", &[Integer(it)]))
            });
            // Until the process ends.
            _ = lock(FileLockMode::Shared, false).map(File::into_raw);
            deleted
        }));
    }
}

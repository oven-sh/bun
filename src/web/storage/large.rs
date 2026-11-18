//! Large values of records are files. What the record has in their place is text: the name of the file, which starts with its length.

use std::sync::Arc;

use bun_core::ZBox;
use bun_sys::{Dir, E, Fd, O};

use super::Storage;
use super::sql::{self, Connection, SqlError};
use crate::Bytes;
use crate::exec::blocking;
use crate::headers::digits;
use crate::net::body::prefault;

pub(super) const LARGE: usize = 256 << 10;

impl From<bun_sys::Error> for SqlError {
    fn from(error: bun_sys::Error) -> SqlError {
        match error.get_errno() {
            E::ENOSPC => SqlError::FULL,
            #[cfg(unix)]
            E::EDQUOT => SqlError::FULL,
            _ => SqlError::IO,
        }
    }
}

fn length_of(name: &[u8]) -> Option<usize> {
    let (length, rest) = bun_core::strings::split_once_char(name, b'-')?;
    rest.iter().all(u8::is_ascii_hexdigit).then_some(())?;
    Some(digits(length)? as usize)
}

impl Storage {
    fn directory_of_large_values(&self) -> Option<Vec<u8>> {
        self.connections().ok()?.reader.as_ref()?;
        Some([self.directory.as_deref()?, b"/Web Storage.values"].concat())
    }

    /// In the transaction that refers to it. `None` if there are no files.
    pub(super) fn write_large_value(&self, value: &[u8]) -> sql::Result<Option<Bytes>> {
        let Some(directory) = self.directory_of_large_values() else {
            return Ok(None);
        };
        let name = format!("{}-{:016x}", value.len(), crate::random());
        let write = || {
            bun_sys::mkdir_recursive_at_mode(Fd::cwd(), &directory, 0o700)?;
            let flags = O::WRONLY | O::CREAT | O::EXCL | O::CLOEXEC;
            let file = Dir::open(&directory)?.open_file(name.as_bytes(), flags, 0o600)?;
            file.write_all(value)
        };
        write()?;
        Ok(Some(name.as_bytes().into()))
    }

    pub(super) fn sync_large_values(&self, names: &[Bytes]) -> sql::Result {
        let Some(directory) = self.directory_of_large_values() else {
            return Ok(());
        };
        let directory = Dir::open(&directory)?;
        let sync = |name: &Bytes| {
            let file = directory.open_file(name, O::WRONLY | O::CLOEXEC, 0)?;
            bun_sys::fsync(file.fd())
        };
        let result = names.iter().map(sync).fold(Ok(()), Result::and);
        let _ = bun_sys::fsync(directory.fd());
        Ok(result?)
    }

    pub(super) fn read_large_value(&self, name: &[u8], to: &mut Vec<u8>) -> sql::Result {
        let mut read = || {
            let length = length_of(name)?;
            let directory = Dir::open(&self.directory_of_large_values()?).ok()?;
            let file = directory.open_file(name, O::RDONLY | O::CLOEXEC, 0).ok()?;
            (file.get_end_pos().ok()? == length).then_some(())?;
            to.try_reserve(length).ok()?;
            prefault(&mut to.spare_capacity_mut()[..length]);
            // SAFETY: `pread_all` only writes, and returns how much.
            let read = unsafe {
                bun_core::vec::fill_spare(to, 0, |room| {
                    let read = file.pread_all(&mut room[..length], 0).unwrap_or_default();
                    (read, read)
                })
            };
            (read == length).then_some(())
        };
        read().ok_or(SqlError::IO)
    }

    fn open_large_values(&self) -> sql::Result<Option<Dir>> {
        match self.directory_of_large_values().map(|it| Dir::open(&it)) {
            Some(Err(error)) if error.get_errno() == E::ENOENT => Ok(None),
            opened => Ok(opened.transpose()?),
        }
    }

    /// Once it is on the disk that nothing refers to them.
    fn remove_large_values(&self, sql: &mut Connection, names: &[Bytes]) -> sql::Result {
        if names.is_empty() {
            return Ok(());
        }
        let Some(directory) = self.open_large_values()? else {
            return Ok(());
        };
        sql.execute(c"PRAGMA wal_checkpoint(PASSIVE)")?;
        for name in names.iter().filter(|it| length_of(it).is_some()) {
            let _ = bun_sys::unlinkat(directory.fd(), &ZBox::from_bytes(name));
        }
        Ok(())
    }

    /// After a commit.
    pub(super) fn replace_large_values(self: &Arc<Self>, old: Vec<Bytes>, new: Vec<Bytes>) {
        if old.is_empty() && new.is_empty() {
            return;
        }
        let this = Arc::clone(self);
        blocking(move || {
            let _ = this.sync_large_values(&new);
            let storage = Arc::clone(&this);
            drop(storage.write(move |sql| this.remove_large_values(sql, &old)));
        });
    }

    pub(super) fn remove_unused_large_values(&self, sql: &mut Connection) -> sql::Result {
        let Some(directory) = self.open_large_values()? else {
            return Ok(());
        };
        // No other program is about to refer to one meanwhile.
        let unused = sql.atomically(|sql| {
            let mut used = bun_collections::StringSet::new();
            sql.each(
                "SELECT value FROM records WHERE typeof(value) = 'text'",
                &[],
                |it| bun_core::handle_oom(used.insert(it.bytes(0))),
            )?;
            let mut entries = bun_sys::dir_iterator::iterate(directory.fd());
            let mut unused = Vec::<Bytes>::new();
            while let Ok(Some(entry)) = entries.next() {
                if !used.contains(entry.name.slice_u8()) {
                    unused.push(entry.name.slice_u8().into());
                }
            }
            sql::Result::Ok(unused)
        });
        self.remove_large_values(sql, &unused?)
    }
}

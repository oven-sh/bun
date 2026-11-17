//! Reads the cookies and the `localStorage` that Electron has left in the directory of a session.

use std::collections::BTreeMap;

use bun_core::{ZBox, strings};
use bun_sys::{Dir, File};

use super::sql::{self, Connection, Value::Text};
use crate::net::cookies::{Cookie, SameSite};
use crate::origin::Site;
use crate::url::Url;

struct Reader<'r>(&'r [u8]);

impl<'r> Reader<'r> {
    fn number(&mut self) -> Option<usize> {
        let len = 1 + self.0.iter().take(9).position(|it| *it < 128)?;
        Some(
            self.bytes(len)?
                .iter()
                .rfold(0, |all, it| all << 7 | usize::from(it & 127)),
        )
    }

    fn bytes(&mut self, len: usize) -> Option<&'r [u8]> {
        self.0.split_off(..len)
    }

    fn prefixed(&mut self) -> Option<&'r [u8]> {
        let len = self.number()?;
        self.bytes(len)
    }

    fn little_endian(&mut self, len: usize) -> Option<usize> {
        Some(
            self.bytes(len)?
                .iter()
                .rfold(0, |all, it| all << 8 | usize::from(*it)),
        )
    }
}

/// <https://github.com/google/snappy/blob/main/format_description.txt>
fn unsnappy(data: &[u8]) -> Option<Vec<u8>> {
    let mut input = Reader(data);
    let (len, mut output) = (input.number()?, Vec::new());
    while let Some(tag) = input.little_endian(1) {
        let (kind, short) = (tag & 3, tag >> 2);
        if kind == 0 {
            let literal = if short < 60 {
                short
            } else {
                input.little_endian(short - 59)?
            };
            output.extend_from_slice(input.bytes(literal + 1)?);
            continue;
        }
        let low = input.little_endian(1 << (kind - 1))?;
        let (offset, count) = if kind == 1 {
            (low + (tag >> 5 << 8), (short & 7) + 4)
        } else {
            (low, short + 1)
        };
        let start = output.len().checked_sub(offset).filter(|_| offset > 0)?;
        (start..start + count).for_each(|at| output.push(output[at]));
    }
    (output.len() == len).then_some(output)
}

/// By key: the sequence number, and the value unless it was deleted.
#[derive(Default)]
struct Newest(BTreeMap<Vec<u8>, (usize, Option<Vec<u8>>)>);

impl Newest {
    fn put(&mut self, key: &[u8], sequence: usize, value: Option<&[u8]>) {
        if self.0.get(key).is_none_or(|it| it.0 <= sequence) {
            self.0
                .insert(key.to_vec(), (sequence, value.map(<[u8]>::to_vec)));
        }
    }

    /// <https://github.com/google/leveldb/blob/main/doc/table_format.md>
    fn read_table(&mut self, file: &[u8]) -> Option<()> {
        let each_entry =
            |mut handle: Reader<'_>, visit: &mut dyn FnMut(&[u8], &[u8]) -> Option<()>| {
                let (offset, size) = (handle.number()?, handle.number()?);
                let (stored, rest) = file.get(offset..)?.split_at_checked(size)?;
                let uncompressed = if *rest.first()? == 1 {
                    Some(unsnappy(stored)?)
                } else {
                    None
                };
                let (block, restarts) = uncompressed
                    .as_deref()
                    .unwrap_or(stored)
                    .split_last_chunk()?;
                let (mut entries, mut key) = (
                    Reader(
                        &block[..block
                            .len()
                            .checked_sub(4 * u32::from_le_bytes(*restarts) as usize)?],
                    ),
                    Vec::new(),
                );
                while !entries.0.is_empty() {
                    let (shared, rest, len) =
                        (entries.number()?, entries.number()?, entries.number()?);
                    key.truncate(shared);
                    key.extend_from_slice(entries.bytes(rest)?);
                    visit(&key, entries.bytes(len)?)?;
                }
                Some(())
            };
        let mut footer = Reader(file.last_chunk::<48>()?);
        _ = (footer.number()?, footer.number()?);
        each_entry(footer, &mut |_, handle| {
            each_entry(Reader(handle), &mut |key, value| {
                let (key, tag) = key.split_last_chunk()?;
                self.put(
                    key,
                    (u64::from_le_bytes(*tag) >> 8) as usize,
                    (tag[0] == 1).then_some(value),
                );
                Some(())
            })
        })
    }

    /// <https://github.com/google/leveldb/blob/main/doc/log_format.md>
    fn read_log(&mut self, file: &[u8]) -> Option<()> {
        const FULL: usize = 1;
        const FIRST: usize = 2;
        const LAST: usize = 4;
        let mut record = Vec::new();
        for mut block in file.chunks(32768).map(Reader) {
            while let (Some(_), Some(len), Some(kind @ FULL..)) = (
                block.bytes(4),
                block.little_endian(2),
                block.little_endian(1),
            ) {
                let Some(part) = block.bytes(len) else {
                    return Some(());
                };
                if kind <= FIRST {
                    record.clear();
                }
                record.extend_from_slice(part);
                if kind == FULL || kind == LAST {
                    let mut batch = Reader(&record);
                    let (first, count) = (batch.little_endian(8)?, batch.little_endian(4)?);
                    for sequence in first..first.checked_add(count)? {
                        let is_value = batch.number()? == 1;
                        self.put(
                            batch.prefixed()?,
                            sequence,
                            if is_value {
                                Some(batch.prefixed()?)
                            } else {
                                None
                            },
                        );
                    }
                }
            }
        }
        Some(())
    }
}

/// The origin, the key and the value.
pub(super) fn local_storage(directory: &[u8]) -> Option<Vec<[Vec<u8>; 3]>> {
    let Ok(database) = Dir::open(&[directory, b"/Local Storage/leveldb"].concat()) else {
        return Some(Vec::new());
    };
    let (mut newest, mut files) = (Newest::default(), bun_sys::iterate_dir(database.fd()));
    while let Some(file) = files.next().ok()? {
        let read = match bun_paths::extension(file.name.slice_u8()) {
            b".log" => Newest::read_log,
            b".ldb" | b".sst" => Newest::read_table,
            _ => continue,
        };
        read(
            &mut newest,
            &File::read_from(database.fd(), file.name.slice_u8()).ok()?,
        )?;
    }
    let as_utf16 = |text: &[u8]| match text {
        [0, utf16 @ ..] => utf16.to_vec(),
        latin1 => latin1.iter().skip(1).flat_map(|it| [*it, 0]).collect(),
    };
    let items = newest.0.iter().filter_map(|(key, (_, value))| {
        let (origin, key) = strings::split_once_char(key.strip_prefix(b"_")?, 0)?;
        // `^` is in the keys of frames within other sites.
        (!strings::contains_char(origin, b'^')).then_some(())?;
        Some([
            strings::trim_suffix(origin, b"/").to_vec(),
            as_utf16(key),
            as_utf16(value.as_ref()?),
        ])
    });
    Some(items.collect())
}

type Decrypt<'d> = &'d dyn Fn(&[u8]) -> Option<Vec<u8>>;

/// The columns are the name, the domain, the path, whether it is secure and HTTP-only, the expiration, and `SameSite`.
fn cookie_of(row: &sql::Row<'_>, value: &[u8], partition: Option<Site>) -> Cookie {
    Cookie {
        name: row.bytes(0).into(),
        value: value.into(),
        domain: strings::trim_prefix(row.bytes(1), b".").into(),
        is_host_only: !row.bytes(1).starts_with(b"."),
        path: row.bytes(2).into(),
        is_secure: row.integer(3) != 0,
        is_http_only: row.integer(4) != 0,
        expires: (!row.is_null(5)).then(|| row.real(5)),
        same_site: SameSite::parse(row.bytes(6)).unwrap_or(SameSite::Unspecified),
        partition,
        created: 0.0,
    }
}

pub(super) fn cookies(directory: &[u8], decrypt: Decrypt<'_>) -> Option<Vec<Cookie>> {
    const LEN_OF_HASH: usize = 32;
    let Some(file) = [&b"/Network/Cookies"[..], b"/Cookies"]
        .map(|it| [directory, it].concat())
        .into_iter()
        .find(|it| bun_sys::exists(it))
    else {
        return Some(Vec::new());
    };
    let escaped = [("%", "%25"), ("?", "%3f"), ("#", "%23")]
        .iter()
        .fold(file, |it, (from, to)| {
            strings::replace_owned(&it, from.as_bytes(), to.as_bytes())
        });
    let mut sql = Connection::open(
        &ZBox::from_bytes([b"file:", &*escaped, b"?immutable=1"].concat()),
        Connection::READ_ONLY | Connection::URI,
    )
    .ok()?;
    let starts_with_hash = sql
        .one(
            "SELECT value + 0 FROM meta WHERE key = 'version'",
            &[],
            |it| it.integer(0) >= 24,
        )
        .ok()??;
    let read = |row: &sql::Row<'_>| match row.bytes(8) {
        [] => Some(cookie_of(row, row.bytes(7), None)),
        encrypted => Some(cookie_of(
            row,
            decrypt(encrypted)?.get(if starts_with_hash { LEN_OF_HASH } else { 0 }..)?,
            None,
        )),
    };
    let query = "SELECT name, host_key, path, is_secure, is_httponly, expires_utc / 1e6 - 11644473600,
        CASE samesite WHEN 0 THEN 'no_restriction' WHEN 1 THEN 'lax' WHEN 2 THEN 'strict' END, value, encrypted_value
        FROM cookies WHERE is_persistent AND top_frame_site_key = '' ORDER BY creation_utc";
    sql.all(query, &[], read).ok()?.into_iter().collect()
}

/// Where they were kept before there was a file for them.
pub(super) fn cookies_in_database(
    sql: &mut Connection,
    decrypt: Decrypt<'_>,
) -> sql::Result<Vec<Cookie>> {
    let query = "SELECT ?1->>'name', ?1->>'domain', ?1->>'path', ?1->>'secure', ?1->>'httpOnly', ?1->>'expirationDate', ?1->>'sameSite', ?1->>'value', ?1->>'partition'";
    let read = |row: &sql::Row<'_>| {
        cookie_of(
            row,
            row.bytes(7),
            Url::parse(row.bytes(8)).map(|it| Site::of(&it)),
        )
    };
    let stored = sql.all("DELETE FROM cookies RETURNING cookie", &[], |it| {
        decrypt(it.bytes(0))
    })?;
    Ok(stored
        .iter()
        .flatten()
        .filter_map(|it| sql.one(query, &[Text(it)], read).ok()?)
        .collect())
}

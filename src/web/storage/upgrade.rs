//! Converts the tables of the first format of the file.

use bun_core::strings;

use super::indexed::{IndexSchema, Schema, StoreSchema, Table};
use super::key::{self, Key};
use super::sql::{self, Connection, Value::*};

fn key_of_text(text: &[u8]) -> Key {
    let mut out = Vec::new();
    key::push_string(&mut out, strings::wtf8_to_utf16(text).into_iter());
    out.into()
}

/// The same tokens, in UTF-16LE code units.
fn convert_key(old: &[u8]) -> Vec<u8> {
    let units: Vec<u16> = old
        .as_chunks()
        .0
        .iter()
        .map(|it| u16::from_le_bytes(*it))
        .collect();
    let (mut rest, mut out) = (&units[..], Vec::new());
    while let Some(kind) = rest.split_off_first() {
        let len = match kind {
            0x10 | 0x20 => 4,
            0x30 | 0x40 => rest.iter().take_while(|it| **it != 0).count() + 1,
            _ => 0,
        };
        let Some(body) = rest.split_off(..len) else {
            break;
        };
        match kind {
            0x30 => {
                let (mut escaped, mut text) = (body[..len - 1].iter(), Vec::new());
                while let Some(unit) = escaped.next() {
                    text.push(if *unit == 1 {
                        escaped.next().map_or(0, |it| it - 1)
                    } else {
                        *unit
                    });
                }
                key::push_string(&mut out, text.into_iter());
            }
            0x40 => key::push_binary(
                &mut out,
                &body[..len - 1]
                    .iter()
                    .map(|it| (it - 1) as u8)
                    .collect::<Vec<_>>(),
            ),
            _ => {
                out.push(*kind as u8);
                out.extend(body.iter().flat_map(|it| it.to_be_bytes()));
            }
        }
    }
    out
}

/// `json` is a string, an array of strings or `null`.
fn convert_key_path(sql: &mut Connection, json: &[u8]) -> sql::Result<Option<Key>> {
    let paths = sql.all(
        "SELECT atom FROM json_each(?) WHERE atom IS NOT NULL",
        &[Text(json)],
        |it| key_of_text(it.bytes(0)),
    )?;
    if !json.starts_with(b"[") {
        return Ok(paths.into_iter().next());
    }
    let mut out = Vec::new();
    key::begin_array(&mut out);
    paths.iter().for_each(|it| out.extend_from_slice(it));
    key::end_array(&mut out);
    Ok(Some(out.into()))
}

fn convert_database(
    sql: &mut Connection,
    bucket: &[u8],
    name: &[u8],
    version: i64,
    stores: &[u8],
) -> sql::Result {
    let (name, mut schema) = (
        key_of_text(name),
        Schema {
            version: version as u64,
            stores: Vec::new(),
        },
    );
    let query = "SELECT key, value->>'table', value->'keyPath', value->>'autoIncrement', value->>'nextKey', value->'indexes' FROM json_each(?)";
    let read = |it: &sql::Row<'_>| {
        (
            key_of_text(it.bytes(0)),
            it.integer(1),
            it.bytes(2).to_vec(),
            it.integer(3) == 1,
            it.real(4),
            it.bytes(5).to_vec(),
        )
    };
    for (store, table, key_path, auto_increments, next_key, old_indexes) in
        sql.all(query, &[Text(stores)], read)?
    {
        let query = "SELECT key, value->>'table', value->'keyPath', value->>'unique', value->>'multiEntry' FROM json_each(?)";
        let read = |it: &sql::Row<'_>| {
            (
                key_of_text(it.bytes(0)),
                it.integer(1),
                it.bytes(2).to_vec(),
                it.integer(3) == 1,
                it.integer(4) == 1,
            )
        };
        let mut indexes = Vec::new();
        for (name, table, key_path, is_unique, is_multi_entry) in
            sql.all(query, &[Text(&old_indexes)], read)?
        {
            indexes.extend(
                convert_key_path(sql, &key_path)?.map(|key_path| IndexSchema {
                    table: Table(table),
                    name,
                    key_path,
                    is_unique,
                    is_multi_entry,
                }),
            );
        }
        sql.run(
            "INSERT OR REPLACE INTO tables VALUES (?, ?, ?, ?)",
            &[Integer(table), Text(bucket), Blob(&name), Real(next_key)],
        )?;
        schema.stores.push(StoreSchema {
            table: Table(table),
            name: store,
            key_path: convert_key_path(sql, &key_path)?,
            auto_increments,
            indexes,
        });
    }
    for Table(table) in schema.tables() {
        sql.run(
            "INSERT OR IGNORE INTO tables VALUES (?, ?, ?, 1)",
            &[Integer(table), Text(bucket), Blob(&name)],
        )?;
        for (row, key) in sql.all(
            "SELECT rowid, key FROM idb_rows WHERE tab = ?",
            &[Integer(table)],
            |it| (it.integer(0), convert_key(it.bytes(1))),
        )? {
            sql.run(
                "INSERT OR REPLACE INTO records SELECT tab, ?, value FROM idb_rows WHERE rowid = ?",
                &[Blob(&key), Integer(row)],
            )?;
        }
    }
    sql.run(
        "INSERT OR IGNORE INTO databases VALUES (?, ?, ?, ?)",
        &[
            Text(bucket),
            Blob(&name),
            Integer(version),
            Blob(&schema.serialize_stores()),
        ],
    )
}

/// What was in the caches is not kept.
pub(super) fn upgrade(sql: &mut Connection) -> sql::Result {
    if sql
        .one(
            "SELECT 1 FROM sqlite_schema WHERE name = 'idb'",
            &[],
            |_| (),
        )?
        .is_none()
    {
        return Ok(());
    }
    sql.atomically(|sql| {
        let query = r#"SELECT origin, iif(name LIKE '"%', name->>'$', name), meta->>'version', meta->'stores' FROM idb WHERE json_valid(meta)"#;
        for (bucket, name, version, stores) in sql.all(query, &[], |it| (it.bytes(0).to_vec(), it.bytes(1).to_vec(), it.integer(2), it.bytes(3).to_vec()))? {
            convert_database(sql, &bucket, &name, version, &stores)?;
        }
        sql.execute(c"DROP TABLE idb; DROP TABLE idb_tables; DROP TABLE idb_rows; DROP TABLE caches; DROP TABLE cache_entries")
    })
}

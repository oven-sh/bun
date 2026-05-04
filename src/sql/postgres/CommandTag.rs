use bun_str::strings;

bun_output::declare_scope!(Postgres, visible);

// TODO(port): lifetime — `Other` borrows from the input `tag` slice passed to `init`.
pub enum CommandTag<'a> {
    // For an INSERT command, the tag is INSERT oid rows, where rows is the
    // number of rows inserted. oid used to be the object ID of the inserted
    // row if rows was 1 and the target table had OIDs, but OIDs system
    // columns are not supported anymore; therefore oid is always 0.
    Insert(u64),
    // For a DELETE command, the tag is DELETE rows where rows is the number
    // of rows deleted.
    Delete(u64),
    // For an UPDATE command, the tag is UPDATE rows where rows is the
    // number of rows updated.
    Update(u64),
    // For a MERGE command, the tag is MERGE rows where rows is the number
    // of rows inserted, updated, or deleted.
    Merge(u64),
    // For a SELECT or CREATE TABLE AS command, the tag is SELECT rows where
    // rows is the number of rows retrieved.
    Select(u64),
    // For a MOVE command, the tag is MOVE rows where rows is the number of
    // rows the cursor's position has been changed by.
    Move(u64),
    // For a FETCH command, the tag is FETCH rows where rows is the number
    // of rows that have been retrieved from the cursor.
    Fetch(u64),
    // For a COPY command, the tag is COPY rows where rows is the number of
    // rows copied. (Note: the row count appears only in PostgreSQL 8.2 and
    // later.)
    Copy(u64),

    Other(&'a [u8]),
}

// (deleted) toJSTag / toJSNumber re-exports from sql_jsc — provided as
// extension-trait methods in the `bun_sql_jsc` crate, not aliased here.

#[derive(Clone, Copy, PartialEq, Eq)]
enum KnownCommand {
    Insert,
    Delete,
    Update,
    Merge,
    Select,
    Move,
    Fetch,
    Copy,
}

impl KnownCommand {
    // Zig: bun.ComptimeEnumMap(KnownCommand) — phf over @tagName bytes.
    pub static MAP: phf::Map<&'static [u8], KnownCommand> = phf::phf_map! {
        b"INSERT" => KnownCommand::Insert,
        b"DELETE" => KnownCommand::Delete,
        b"UPDATE" => KnownCommand::Update,
        b"MERGE"  => KnownCommand::Merge,
        b"SELECT" => KnownCommand::Select,
        b"MOVE"   => KnownCommand::Move,
        b"FETCH"  => KnownCommand::Fetch,
        b"COPY"   => KnownCommand::Copy,
    };
}

impl<'a> CommandTag<'a> {
    pub fn init(tag: &'a [u8]) -> CommandTag<'a> {
        let Some(first_space_index) = strings::index_of_char(tag, b' ') else {
            return CommandTag::Other(tag);
        };
        let first_space_index = first_space_index as usize;
        let Some(&cmd) = KnownCommand::MAP.get(&tag[0..first_space_index]) else {
            return CommandTag::Other(tag);
        };

        let number: u64 = 'brk: {
            match cmd {
                KnownCommand::Insert => {
                    let mut remaining = &tag[(first_space_index + 1).min(tag.len())..];
                    let Some(second_space) = strings::index_of_char(remaining, b' ') else {
                        return CommandTag::Other(tag);
                    };
                    let second_space = second_space as usize;
                    remaining = &remaining[(second_space + 1).min(remaining.len())..];
                    match parse_int_u64(remaining) {
                        Ok(n) => break 'brk n,
                        Err(err) => {
                            bun_output::scoped_log!(
                                Postgres,
                                "CommandTag failed to parse number: {}",
                                err.name()
                            );
                            return CommandTag::Other(tag);
                        }
                    }
                }
                _ => {
                    let after_tag = &tag[(first_space_index + 1).min(tag.len())..];
                    match parse_int_u64(after_tag) {
                        Ok(n) => break 'brk n,
                        Err(err) => {
                            bun_output::scoped_log!(
                                Postgres,
                                "CommandTag failed to parse number: {}",
                                err.name()
                            );
                            return CommandTag::Other(tag);
                        }
                    }
                }
            }
        };

        match cmd {
            KnownCommand::Insert => CommandTag::Insert(number),
            KnownCommand::Delete => CommandTag::Delete(number),
            KnownCommand::Update => CommandTag::Update(number),
            KnownCommand::Merge => CommandTag::Merge(number),
            KnownCommand::Select => CommandTag::Select(number),
            KnownCommand::Move => CommandTag::Move(number),
            KnownCommand::Fetch => CommandTag::Fetch(number),
            KnownCommand::Copy => CommandTag::Copy(number),
        }
    }
}

// TODO(port): std.fmt.parseInt(u64, s, 0) auto-detects radix (0x/0o/0b prefixes)
// and accepts a leading '+' and '_' digit separators. Postgres command tags are
// always plain base-10 in practice; revisit if needed.
#[inline]
fn parse_int_u64(s: &[u8]) -> Result<u64, bun_core::Error> {
    // Hand-rolled ASCII-digit parse — `s` is postgres wire data; do NOT
    // round-trip through `core::str::from_utf8` (PORTING.md §Strings).
    // Mirrors std.fmt.parseInt's error set: error{InvalidCharacter, Overflow}
    // so the scoped_log @errorName output matches Zig.
    if s.is_empty() {
        return Err(bun_core::err!("InvalidCharacter"));
    }
    let mut acc: u64 = 0;
    for &b in s {
        if !b.is_ascii_digit() {
            return Err(bun_core::err!("InvalidCharacter"));
        }
        acc = acc
            .checked_mul(10)
            .and_then(|a| a.checked_add((b - b'0') as u64))
            .ok_or(bun_core::err!("Overflow"))?;
    }
    Ok(acc)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/CommandTag.zig (85 lines)
//   confidence: medium
//   todos:      2
//   notes:      Other(&'a [u8]) borrows input; phf assoc-static syntax needs Phase B review; parse_int_u64 is base-10-only (radix-0 TODO)
// ──────────────────────────────────────────────────────────────────────────

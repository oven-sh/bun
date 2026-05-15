use bun_core::strings;

bun_core::declare_scope!(Postgres, visible);

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
    // Zig: bun.ComptimeEnumMap(KnownCommand) — comptime perfect hash over
    // @tagName bytes. 8 keys is too small for `phf` to pay for itself (its
    // SipHash + double indirect dominate); a length-gated byte compare is
    // branch-predictable and lets LLVM lower each arm to a single wide
    // integer compare. Within every length bucket the first byte is already
    // unique, so each `==` short-circuits on the first word anyway.
    #[inline]
    fn from_bytes(bytes: &[u8]) -> Option<KnownCommand> {
        match bytes.len() {
            4 => {
                if bytes == b"COPY" {
                    Some(KnownCommand::Copy)
                } else if bytes == b"MOVE" {
                    Some(KnownCommand::Move)
                } else {
                    None
                }
            }
            5 => {
                if bytes == b"FETCH" {
                    Some(KnownCommand::Fetch)
                } else if bytes == b"MERGE" {
                    Some(KnownCommand::Merge)
                } else {
                    None
                }
            }
            6 => {
                if bytes == b"SELECT" {
                    Some(KnownCommand::Select)
                } else if bytes == b"INSERT" {
                    Some(KnownCommand::Insert)
                } else if bytes == b"UPDATE" {
                    Some(KnownCommand::Update)
                } else if bytes == b"DELETE" {
                    Some(KnownCommand::Delete)
                } else {
                    None
                }
            }
            _ => None,
        }
    }
}

impl<'a> CommandTag<'a> {
    pub fn init(tag: &'a [u8]) -> CommandTag<'a> {
        let Some(first_space_index) = strings::index_of_char(tag, b' ') else {
            return CommandTag::Other(tag);
        };
        let first_space_index = first_space_index as usize;
        let Some(cmd) = KnownCommand::from_bytes(&tag[0..first_space_index]) else {
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
                    // Postgres wire is pure base-10 ASCII so radix-0/`_`/sign
                    // widening is unreachable; @errorName parity via .name().
                    match bun_core::fmt::parse_int::<u64>(remaining, 0) {
                        Ok(n) => break 'brk n,
                        Err(err) => {
                            bun_core::scoped_log!(
                                Postgres,
                                "CommandTag failed to parse number: {}",
                                bstr::BStr::new(err.name())
                            );
                            return CommandTag::Other(tag);
                        }
                    }
                }
                _ => {
                    let after_tag = &tag[(first_space_index + 1).min(tag.len())..];
                    match bun_core::fmt::parse_int::<u64>(after_tag, 0) {
                        Ok(n) => break 'brk n,
                        Err(err) => {
                            bun_core::scoped_log!(
                                Postgres,
                                "CommandTag failed to parse number: {}",
                                bstr::BStr::new(err.name())
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

// ported from: src/sql/postgres/CommandTag.zig

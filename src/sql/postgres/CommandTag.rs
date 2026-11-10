use bun_core::strings;

bun_core::declare_scope!(Postgres, visible);

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

bun_core::comptime_string_map! {
    static KNOWN_COMMANDS: KnownCommand = {
        b"COPY" => KnownCommand::Copy,
        b"MOVE" => KnownCommand::Move,
        b"FETCH" => KnownCommand::Fetch,
        b"MERGE" => KnownCommand::Merge,
        b"SELECT" => KnownCommand::Select,
        b"INSERT" => KnownCommand::Insert,
        b"UPDATE" => KnownCommand::Update,
        b"DELETE" => KnownCommand::Delete,
    };
}

impl KnownCommand {
    #[inline]
    fn from_bytes(bytes: &[u8]) -> Option<KnownCommand> {
        KNOWN_COMMANDS.get(bytes).copied()
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
                    let mut remaining = &tag[first_space_index + 1..];
                    let Some(second_space) = strings::index_of_char(remaining, b' ') else {
                        return CommandTag::Other(tag);
                    };
                    let second_space = second_space as usize;
                    remaining = &remaining[second_space + 1..];
                    // Postgres wire is pure base-10 ASCII so radix-0/`_`/sign
                    // widening is unreachable.
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
                    let after_tag = &tag[first_space_index + 1..];
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

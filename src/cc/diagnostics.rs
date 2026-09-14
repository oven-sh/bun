//! Turns the compiler's errors and warnings into messages of the caller's log.

use std::borrow::Cow;
use std::rc::Rc;

use bun_ast::{Data, Kind, Log, Msg, Range, Source};

use crate::lexer::Lexer;
use crate::pp::FileTable;
use crate::token::{Loc, TokenSource};

/// The file table entry `loc` is in: the path it was read by and its contents.
fn file_at(files: &FileTable, loc: Loc) -> Option<(Rc<str>, Rc<[u8]>)> {
    let named = files.files.get(loc.file as usize)?;
    let read = files.files.get(named.read_as as usize)?;
    Some((Rc::clone(&read.name), Rc::clone(&read.contents)))
}

/// `text` about `range` of the file `name`. A message outlives what it is about, so it has
/// its own copy of the name; the contents are only read here, for the line to quote.
fn data_in(name: &str, contents: &[u8], range: Range, text: String) -> Data {
    let source = Source::init_path_string(name, contents);
    let mut data = bun_ast::range_data(Some(&source), range, text.into_bytes());
    if let Some(location) = &mut data.location {
        location.file = Cow::Owned(name.as_bytes().to_vec());
    }
    data
}

/// The token at `loc`, so that the whole of it is underlined.
fn range_at(contents: &Rc<[u8]>, loc: Loc) -> Range {
    let start = loc.offset as usize;
    let mut lexer = Lexer::at(Rc::clone(contents), loc.file, start);
    let len = match lexer.next_token() {
        Ok(_) => lexer.position().saturating_sub(start),
        Err(_) => 0,
    };
    Range {
        loc: bun_ast::Loc {
            start: i32::try_from(start).unwrap_or(i32::MAX),
        },
        len: i32::try_from(len).unwrap_or(0),
    }
}

fn data_at(files: &FileTable, loc: Loc, text: String) -> Data {
    // Of a location nobody set the message is about the unit as a whole.
    let located = if loc.is_set() {
        file_at(files, loc)
    } else {
        None
    };
    match located {
        Some((name, contents)) => data_in(&name, &contents, range_at(&contents, loc), text),
        None => match files.files.first() {
            Some(unit) => data_in(&unit.name, b"", Range::NONE, text),
            None => bun_ast::range_data(None, Range::NONE, text.into_bytes()),
        },
    }
}

/// `text` at `loc`, with `note` and a note for each `#include` between `loc` and the file being
/// compiled.
pub(crate) fn message(
    files: &FileTable,
    kind: Kind,
    loc: Loc,
    text: String,
    note: Option<(Loc, String)>,
) -> Msg {
    let data = data_at(files, loc, text);
    let mut notes = Vec::new();
    if let Some((note_loc, note)) = note {
        notes.push(data_at(files, note_loc, note));
    }
    let mut file = loc.file;
    while loc.is_set()
        && let Some(included_at) = files.files.get(file as usize).and_then(|f| f.included_at)
        && notes.len() <= crate::pp::MAX_INCLUDE_DEPTH
    {
        notes.push(data_at(files, included_at, "included from here".to_owned()));
        file = included_at.file;
    }
    Msg {
        kind,
        data,
        notes: notes.into_boxed_slice(),
        ..Default::default()
    }
}

/// `text` about the file `name`, for what has no place in it (what the linker finds).
pub(crate) fn message_in_file(kind: Kind, name: &str, text: String) -> Msg {
    Msg {
        kind,
        data: data_in(name, b"", Range::NONE, text),
        ..Default::default()
    }
}

pub(crate) fn add(log: &mut Log, msg: Msg) {
    match msg.kind {
        Kind::Err => log.errors += 1,
        Kind::Warn => log.warnings += 1,
        _ => {}
    }
    log.add_msg(msg);
}

//! JSON-RPC 2.0 as the Language Server Protocol frames it: `Content-Length: <bytes>`, an empty line, the message.

use bun_core::strings;
use bun_lint::linter::write_json;
use bun_lint::options::Json;
use bun_threading::Guarded;

/// The codes of errors that are used here.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum ErrorCode {
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    ServerNotInitialized = -32002,
    /// The document has changed since the request was made.
    ContentModified = -32801,
    RequestCancelled = -32800,
}

/// What the client has sent.
pub(crate) enum Frame {
    Message(Vec<u8>),
    /// A header without a length. What follows it is read as the next header.
    Malformed,
    /// There is nothing more to read.
    End,
}

/// [`Process::read`](super::Process::read)
pub(crate) type Read<'r> = &'r (dyn Fn(&mut [u8]) -> usize + Sync);

pub(crate) struct Reader<'r> {
    read: Read<'r>,
    /// What is read and not yet returned.
    buffer: Vec<u8>,
}

/// `Content-Length` of a header, without the empty line.
fn length_in(header: &[u8]) -> Option<usize> {
    strings::split(header, b"\r\n").find_map(|line| {
        let (name, value) = strings::split_once_char(line, b':')?;
        (name.trim_ascii().eq_ignore_ascii_case(b"content-length"))
            .then(|| bun_core::fmt::parse_decimal(value.trim_ascii()))?
    })
}

impl<'r> Reader<'r> {
    pub(crate) fn new(read: Read<'r>) -> Reader<'r> {
        Reader {
            read,
            buffer: Vec::new(),
        }
    }

    /// Reads some more. `false`: there is no more.
    fn fill(&mut self) -> bool {
        let had = self.buffer.len();
        self.buffer.resize(had + (64 << 10), 0);
        let count = (self.read)(&mut self.buffer[had..]).min(64 << 10);
        self.buffer.truncate(had + count);
        count > 0
    }

    pub(crate) fn next(&mut self) -> Frame {
        const END: &[u8] = b"\r\n\r\n";
        // Where the end of the header has been looked for already.
        let mut searched = 0;
        let header = loop {
            if let Some(at) = strings::index_of(&self.buffer[searched..], END) {
                break searched + at;
            }
            searched = self.buffer.len().saturating_sub(END.len() - 1);
            if !self.fill() {
                return Frame::End;
            }
        };
        let length = length_in(&self.buffer[..header]);
        self.buffer.drain(..header + END.len());
        let Some(length) = length else {
            return Frame::Malformed;
        };
        while self.buffer.len() < length {
            if !self.fill() {
                return Frame::End;
            }
        }
        let rest = self.buffer.split_off(length);
        Frame::Message(std::mem::replace(&mut self.buffer, rest))
    }
}

/// What a message is.
pub(crate) enum Incoming {
    Request {
        id: Json,
        method: Vec<u8>,
        params: Json,
    },
    Notification {
        method: Vec<u8>,
        params: Json,
    },
    /// The answer to a request of the server.
    Response,
    /// Not JSON.
    Unreadable,
    /// JSON, and no message. `id`: `null` if it has none.
    Invalid {
        id: Json,
    },
}

fn take(entries: &mut Vec<(Vec<u8>, Json)>, key: &[u8]) -> Option<Json> {
    let at = entries.iter().position(|it| it.0 == key)?;
    Some(entries.swap_remove(at).1)
}

impl Incoming {
    pub(crate) fn parse(message: &[u8]) -> Incoming {
        let Some(parsed) = bun_lint::json::parse(message) else {
            return Incoming::Unreadable;
        };
        let Some(mut entries) = parsed.into_object() else {
            return Incoming::Invalid { id: Json::Null };
        };
        let id =
            take(&mut entries, b"id").filter(|it| matches!(it, Json::Number(_) | Json::String(_)));
        let params = take(&mut entries, b"params").unwrap_or(Json::Null);
        // `Some(None)`: a method that is not a string.
        let method = take(&mut entries, b"method").map(Json::into_string);
        match (method, id) {
            (Some(Some(method)), Some(id)) => Incoming::Request { id, method, params },
            (Some(Some(method)), None) => Incoming::Notification { method, params },
            (None, Some(_)) => Incoming::Response,
            (_, id) => Incoming::Invalid {
                id: id.unwrap_or(Json::Null),
            },
        }
    }
}

pub(crate) fn text(bytes: &[u8]) -> Json {
    Json::String(bytes.to_vec())
}

pub(crate) fn number(value: u32) -> Json {
    Json::Number(f64::from(value))
}

pub(crate) fn object<const N: usize>(entries: [(&str, Json); N]) -> Json {
    let entries = entries.into_iter();
    Json::Object(
        entries
            .map(|(key, value)| (key.as_bytes().to_vec(), value))
            .collect(),
    )
}

/// `value.a.b` for `path` = `["a", "b"]`.
pub(crate) fn dig<'j>(value: &'j Json, path: &[&str]) -> Option<&'j Json> {
    path.iter()
        .try_fold(value, |value, key| value.get(key.as_bytes()))
}

/// Writes messages, one at a time.
pub(crate) struct Writer<'w> {
    write: &'w (dyn Fn(&[u8]) + Sync),
    turn: Guarded<()>,
}

impl<'w> Writer<'w> {
    pub(crate) fn new(write: &'w (dyn Fn(&[u8]) + Sync)) -> Writer<'w> {
        Writer {
            write,
            turn: Guarded::new(()),
        }
    }

    fn send(&self, mut entries: Vec<(Vec<u8>, Json)>) {
        entries.insert(0, (b"jsonrpc".to_vec(), text(b"2.0")));
        let mut body = Vec::new();
        write_json(&mut body, &Json::Object(entries));
        let mut frame = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
        frame.append(&mut body);
        let _turn = self.turn.lock();
        (self.write)(&frame);
    }

    pub(crate) fn notify(&self, method: &str, params: Json) {
        self.send(vec![
            (b"method".to_vec(), text(method.as_bytes())),
            (b"params".to_vec(), params),
        ]);
    }

    pub(crate) fn request(&self, id: &[u8], method: &str, params: Json) {
        self.send(vec![
            (b"id".to_vec(), text(id)),
            (b"method".to_vec(), text(method.as_bytes())),
            (b"params".to_vec(), params),
        ]);
    }

    pub(crate) fn reply(&self, id: Json, result: Json) {
        self.send(vec![(b"id".to_vec(), id), (b"result".to_vec(), result)]);
    }

    pub(crate) fn fail(&self, id: Json, code: ErrorCode, message: &str) {
        let error = object([
            ("code", Json::Number(f64::from(code as i32))),
            ("message", text(message.as_bytes())),
        ]);
        self.send(vec![(b"id".to_vec(), id), (b"error".to_vec(), error)]);
    }
}

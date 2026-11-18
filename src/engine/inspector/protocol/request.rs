use core::cell::RefCell;
use core::fmt::Display;

use bun_engine_text::{StringRef, Text};
use bun_engine_vm::Message;

use super::{Json, Object, object};

#[derive(Clone, Copy)]
pub(crate) enum ErrorCode {
    Parse = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    Server = -32000,
}

/// The last sums up those before it.
pub(crate) struct Error(Vec<(ErrorCode, StringRef)>);

pub(crate) type Outcome<T = Object> = Result<T, Error>;

impl Error {
    pub(crate) fn new(code: ErrorCode, message: impl Message) -> Error {
        Error(vec![(code, message.into_string())])
    }

    fn to_json(&self) -> Object {
        let describe =
            |(code, message): &(_, StringRef)| object! { "code": *code as i32, "message": message };
        let mut error = self.0.last().map_or_default(describe);
        error.add("data", self.0.iter().map(describe).collect::<Vec<_>>());
        error
    }
}

impl<T: Message> From<T> for Error {
    fn from(message: T) -> Error {
        Error::new(ErrorCode::Server, message)
    }
}

pub(crate) fn response(id: Option<i32>, outcome: Outcome) -> Object {
    let id = id.map_or(Json::Null, Json::from);
    match outcome {
        Ok(result) => object! { "result": result, "id": id },
        Err(error) => object! { "error": error.to_json(), "id": id },
    }
}

pub(crate) fn event(method: &'static str, params: Option<Object>) -> Object {
    object! { "method": method, "params" => params }
}

pub(crate) struct Request<'a> {
    pub(crate) id: i32,
    pub(crate) domain: Text<'a>,
    pub(crate) method: Text<'a>,
    pub(crate) params: Params<'a>,
}

impl<'a> Request<'a> {
    /// An error comes with the id of the request, if that is known.
    pub(crate) fn new(message: Option<&'a Json>) -> Result<Request<'a>, (Option<i32>, Error)> {
        let invalid = |id, message| (id, Error::new(ErrorCode::InvalidRequest, message));
        let Some(message) = message else {
            let error = Error::new(ErrorCode::Parse, "Message must be in JSON format");
            return Err((None, error));
        };
        let message = (message.as_object())
            .ok_or_else(|| invalid(None, "Message must be a JSONified object"))?;
        let id = (message.get("id")).ok_or_else(|| invalid(None, "'id' property was not found"))?;
        let id = (id.as_integer())
            .ok_or_else(|| invalid(None, "The type of 'id' property must be integer"))?;
        let name = (message.get("method"))
            .ok_or_else(|| invalid(Some(id), "'method' property wasn't found"))?;
        let name = (name.as_string())
            .ok_or_else(|| invalid(Some(id), "The type of 'method' property must be string"))?;
        let (name, dot) = (name.text(), u16::from(b'.'));
        let at = name.find_unit(dot, 0).filter(|&at| {
            at != 0 && at + 1 != name.len() && !name.slice_from(at + 1).contains_unit(dot)
        });
        let at = at.ok_or_else(|| {
            let message =
                "The 'method' property was formatted incorrectly. It should be 'Domain.method'";
            invalid(Some(id), message)
        })?;
        Ok(Request {
            id,
            domain: name.slice(0..at),
            method: name.slice_from(at + 1),
            params: Params {
                method: name,
                values: message.get("params").and_then(Json::as_object),
                complaints: RefCell::default(),
            },
        })
    }
}

/// What is missing or of the wrong type is noted for `check`, and reads as if it were empty.
pub(crate) struct Params<'a> {
    method: Text<'a>,
    values: Option<&'a Object>,
    complaints: RefCell<Vec<(ErrorCode, StringRef)>>,
}

pub(crate) trait Param<'a>: Sized {
    const TYPE: &'static str;

    fn from_json(value: &'a Json) -> Option<Self>;
}

macro_rules! params {
    ($($type:ty, $name:literal, |$value:ident| $convert:expr;)*) => {$(
        impl<'a> Param<'a> for $type {
            const TYPE: &'static str = $name;

            fn from_json($value: &'a Json) -> Option<Self> {
                $convert
            }
        }
    )*};
}

params! {
    bool, "Boolean", |value| value.as_boolean();
    i32, "Integer", |value| value.as_integer();
    StringRef, "String", |value| value.as_string().cloned();
    &'a [Json], "Array", |value| value.as_array();
    &'a Object, "Object", |value| value.as_object();
}

impl<'a> Params<'a> {
    fn complain(&self, message: impl Display) {
        let message = format_args!("{message}").into_string();
        (self.complaints.borrow_mut()).push((ErrorCode::InvalidParams, message));
    }

    pub(crate) fn optional<T: Param<'a>>(&self, name: &str) -> Option<T> {
        let value = T::from_json(self.values?.get(name)?);
        if value.is_none() {
            let expected = T::TYPE;
            self.complain(format_args!(
                "Parameter '{name}' has wrong type. It must be '{expected}'."
            ));
        }
        value
    }

    pub(crate) fn flag(&self, name: &str) -> bool {
        self.optional(name).unwrap_or(false)
    }

    /// `None` makes `check` fail.
    fn find<T: Param<'a>>(&self, name: &str) -> Option<T> {
        let expected = T::TYPE;
        match self.values.map(|values| values.get(name)) {
            None => self.complain(format_args!(
                "'params' object must contain required parameter '{name}' with type '{expected}'."
            )),
            Some(None) => self.complain(format_args!(
                "Parameter '{name}' with type '{expected}' was not found."
            )),
            Some(Some(_)) => return self.optional(name),
        }
        None
    }

    pub(crate) fn required<T: Param<'a> + Default>(&self, name: &str) -> T {
        self.find(name).unwrap_or_default()
    }

    pub(crate) fn required_object(&self, name: &str) -> &'a Object {
        self.find(name).unwrap_or(const { &Object::EMPTY })
    }

    /// After all have been read.
    pub(crate) fn check(&self) -> Outcome<()> {
        if self.complaints.borrow().is_empty() {
            return Ok(());
        }
        let method = self.method;
        self.complain(format_args!(
            "Some arguments of method '{method}' can't be processed"
        ));
        Err(Error(self.complaints.take()))
    }

    pub(crate) fn no_such_method(&self) -> Error {
        let method = self.method;
        Error::new(
            ErrorCode::MethodNotFound,
            format_args!("'{method}' was not found"),
        )
    }
}

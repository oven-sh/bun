use std::fmt::{self, Debug, Display};

/// What was being done, from the outside in. `{:#}` prints all of it.
pub struct Error(Vec<String>);

pub type Result<T, E = Error> = std::result::Result<T, E>;

impl Error {
    pub fn new(message: impl Display) -> Error {
        Error(vec![message.to_string()])
    }
}

impl Display for Error {
    fn fmt(&self, to: &mut fmt::Formatter) -> fmt::Result {
        to.write_str(&if to.alternate() {
            self.0.join(": ")
        } else {
            self.0[0].clone()
        })
    }
}

impl Debug for Error {
    fn fmt(&self, to: &mut fmt::Formatter) -> fmt::Result {
        write!(to, "{self:#}")
    }
}

impl<E: std::error::Error> From<E> for Error {
    fn from(error: E) -> Error {
        Error::new(error)
    }
}

pub trait Context<T>: Sized {
    fn with_context<C: Display>(self, context: impl FnOnce() -> C) -> Result<T>;

    fn context(self, context: impl Display) -> Result<T> {
        self.with_context(|| context)
    }
}

impl<T> Context<T> for Option<T> {
    fn with_context<C: Display>(self, context: impl FnOnce() -> C) -> Result<T> {
        self.ok_or_else(|| Error::new(context()))
    }
}

impl<T, E: Display> Context<T> for Result<T, E> {
    fn with_context<C: Display>(self, context: impl FnOnce() -> C) -> Result<T> {
        self.map_err(|error| Error(vec![context().to_string(), format!("{error:#}")]))
    }
}

macro_rules! failure {
    ($($format:tt)+) => { $crate::error::Error::new(format_args!($($format)+)) };
}

macro_rules! bail {
    ($($format:tt)+) => { return Err($crate::error::failure!($($format)+)) };
}

macro_rules! ensure {
    ($condition:expr, $($format:tt)+) => {
        if !$condition {
            $crate::error::bail!($($format)+);
        }
    };
}

pub(crate) use {bail, ensure, failure};

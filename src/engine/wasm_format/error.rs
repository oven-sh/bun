//! Why a module is rejected.

use core::fmt;

use crate::index::CodeIndex;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ErrorKind {
    /// In a function, and for most errors inside a long constant expression, the offset is from its start.
    Parse {
        offset: usize,
    },
    Validation,
    /// About the module as a whole.
    Module,
}

/// `Display` gives the message of the `CompileError`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Error(Box<Details>);

#[derive(Clone, PartialEq, Eq, Debug)]
struct Details {
    kind: ErrorKind,
    reason: String,
    function: Option<CodeIndex>,
    missing: Option<Missing>,
}

/// What the validator leaves to the decoder, which knows where it is, and the other way round.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Missing {
    OffsetAfterInstruction,
    OffsetAfterOpcode,
    OffsetOfLastByte,
    /// In front of the reason.
    OpcodeName,
    /// In front of the reason.
    SecondOpcodeNumber,
    /// For an error in the immediates.
    InstructionStart,
    /// Whether the operands of the instruction at this offset have an error that comes first.
    OperandCheck(usize),
}

impl Error {
    #[cold]
    #[inline(never)]
    pub(crate) fn new(kind: ErrorKind, reason: fmt::Arguments<'_>) -> Self {
        Self(Box::new(Details {
            kind,
            reason: reason.to_string(),
            function: None,
            missing: None,
        }))
    }

    #[cold]
    pub(crate) fn parse(offset: usize, reason: fmt::Arguments<'_>) -> Self {
        Self::new(ErrorKind::Parse { offset }, reason)
    }

    #[cold]
    pub(crate) fn validation(reason: fmt::Arguments<'_>) -> Self {
        Self::new(ErrorKind::Validation, reason)
    }

    /// In the options that a module is compiled with.
    pub fn duplicate_builtin_sets() -> Self {
        let reason = format_args!("the list of builtin set names contains duplicates");
        Self::new(ErrorKind::Module, reason)
    }

    pub(crate) fn lacking(mut self, missing: Missing) -> Self {
        self.0.missing = Some(missing);
        self
    }

    pub(crate) fn take_missing(&mut self) -> Option<Missing> {
        self.0.missing.take()
    }

    pub(crate) fn set_offset(&mut self, offset: usize) {
        self.0.kind = ErrorKind::Parse { offset };
    }

    pub(crate) fn prefix_reason(&mut self, prefix: &str) {
        self.0.reason.insert_str(0, prefix);
    }

    pub(crate) fn in_function(mut self, function: CodeIndex) -> Self {
        self.0.function = Some(function);
        self
    }

    pub fn kind(&self) -> ErrorKind {
        self.0.kind
    }

    pub fn reason(&self) -> &str {
        &self.0.reason
    }

    pub fn function(&self) -> Option<CodeIndex> {
        self.0.function
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0.kind {
            ErrorKind::Parse { offset } => {
                write!(f, "WebAssembly.Module doesn't parse at byte {offset}: ")?;
            }
            ErrorKind::Validation => f.write_str("WebAssembly.Module doesn't validate: ")?,
            ErrorKind::Module => {}
        }
        f.write_str(&self.0.reason)?;
        match self.0.function {
            Some(function) => write!(f, ", in function at index {function}"),
            None => Ok(()),
        }
    }
}

/// A name in a message.
#[derive(Clone, Copy)]
pub(crate) struct Quoted<'a>(pub(crate) &'a str);

impl fmt::Display for Quoted<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        const MAX_LENGTH: usize = 4096;
        if self.0.len() <= MAX_LENGTH {
            return f.write_str(self.0);
        }
        write!(
            f,
            "{}...",
            &self.0[..self.0.floor_char_boundary(MAX_LENGTH)]
        )
    }
}

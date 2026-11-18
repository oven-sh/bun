use core::fmt::{Arguments, Write};

use bun_engine_text::{StringBuilder, StringRef};

use crate::{Cx, ErrorInstance, ErrorType, Exception, Gc, JsResult, Thrown, Value, Vm, errors};

/// The text of an error.
pub trait Message {
    fn into_string(self) -> StringRef;
}

impl Message for &'static str {
    fn into_string(self) -> StringRef {
        StringRef::from_literal(self)
    }
}

impl Message for StringRef {
    fn into_string(self) -> StringRef {
        self
    }
}

impl Message for StringBuilder {
    fn into_string(self) -> StringRef {
        self.finish().unwrap_or_default()
    }
}

/// A lone surrogate does not survive formatting. Use a `StringBuilder` where that matters.
impl Message for Arguments<'_> {
    fn into_string(self) -> StringRef {
        let mut builder = StringBuilder::new();
        let _ = builder.write_fmt(self);
        builder.into_string()
    }
}

impl Cx {
    #[cold]
    pub fn throw_exception(&self, exception: Gc<Exception>) -> Thrown {
        if self.has_pending_termination_exception() {
            return Thrown::new();
        }
        if self.is_async_context_tracked()
            && exception.async_context().is_none()
            && !self.is_termination_exception(exception)
        {
            exception.set_async_context(Some(self.current_async_context()));
        }
        self.set_exception(exception);
        Thrown::new()
    }

    #[cold]
    #[inline(never)]
    pub fn throw(&self, value: Value) -> Thrown {
        let exception = value.downcast::<Exception>().unwrap_or_else(|| {
            if !self.has_debugger() && self.is_sure_to_catch(value) {
                Exception::create_without_stack(self, value)
            } else {
                Exception::create(self, value)
            }
        });
        self.throw_exception(exception)
    }

    #[cold]
    #[inline(never)]
    fn throw_error_string(&self, error_type: ErrorType, message: StringRef) -> Thrown {
        self.throw(ErrorInstance::new(self, error_type, Some(message)).into())
    }

    #[cold]
    pub fn throw_error(&self, error_type: ErrorType, message: impl Message) -> Thrown {
        self.throw_error_string(error_type, message.into_string())
    }

    #[cold]
    pub fn throw_type_error(&self, message: impl Message) -> Thrown {
        self.throw_error(ErrorType::TypeError, message)
    }

    #[cold]
    pub fn throw_range_error(&self, message: impl Message) -> Thrown {
        self.throw_error(ErrorType::RangeError, message)
    }

    #[cold]
    pub fn throw_syntax_error(&self, message: impl Message) -> Thrown {
        self.throw_error(ErrorType::SyntaxError, message)
    }

    #[cold]
    pub fn throw_reference_error(&self, message: impl Message) -> Thrown {
        self.throw_error(ErrorType::ReferenceError, message)
    }

    #[cold]
    pub fn throw_out_of_memory(&self) -> Thrown {
        self.throw_out_of_memory_with(errors::OUT_OF_MEMORY)
    }

    /// The whole message.
    #[cold]
    #[inline(never)]
    pub fn throw_out_of_memory_with(&self, message: &'static str) -> Thrown {
        self.throw(ErrorInstance::out_of_memory(self, message.into_string()).into())
    }

    #[cold]
    #[inline(never)]
    pub fn throw_stack_overflow(&self) -> Thrown {
        let was_handling_error = self.replace_is_handling_error(true);
        let thrown = self.throw(ErrorInstance::stack_overflow(self).into());
        self.replace_is_handling_error(was_handling_error);
        thrown
    }

    /// For an internal method that fails: throws a TypeError or returns false.
    #[cold]
    pub fn reject(&self, should_throw: bool, message: &'static str) -> JsResult<bool> {
        if should_throw {
            return Err(self.throw_type_error(message));
        }
        Ok(false)
    }

    /// Takes the pending exception, unless it is the one that ends execution.
    pub fn catch(&self, thrown: Thrown) -> JsResult<Gc<Exception>> {
        if self.has_pending_termination_exception() {
            return Err(thrown);
        }
        Ok(self.clear_exception().expect("a pending exception"))
    }

    /// The same, for the value.
    pub fn catch_value(&self, thrown: Thrown) -> JsResult<Value> {
        self.catch(thrown).map(|exception| exception.value())
    }

    /// For a caller that cannot report anything. Termination is raised again at the next opportunity.
    pub fn discard_unless_termination(&self, _: Thrown) {
        self.retract_exception();
    }
}

impl Vm {
    /// The same, for code that is about to do again what has thrown.
    pub fn retract_exception(&self) {
        if self.has_pending_termination_exception() {
            self.traps().request_termination();
        }
        self.clear_exception();
    }
}

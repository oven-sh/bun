use core::fmt;
use std::sync::OnceLock;

use bun_engine_asm::Code;
use bun_engine_exec_memory::{CodeHandle, OutOfExecutableMemory, Owner, Priority, link};
use bun_engine_vm::FastHashMap;
use bun_threading::Guarded;
use smallvec::SmallVec;

use crate::{Convention, Layout, NativeType, stubs};

/// There is one for all that are alike, in all threads, and so is its code. They stay until the process ends.
pub struct Signature {
    arguments: Box<[NativeType]>,
    result: NativeType,
    invoker: OnceLock<CodeHandle>,
    call_entry: OnceLock<CodeHandle>,
    callback_body: OnceLock<CodeHandle>,
}

/// By the arguments, followed by the result.
static SIGNATURES: Guarded<Option<FastHashMap<Box<[NativeType]>, &'static Signature>>> =
    Guarded::new(None);

pub(crate) fn link_stub(
    code: &Code,
    owner: Option<Owner>,
    name: impl FnOnce() -> String,
) -> Result<CodeHandle, OutOfExecutableMemory> {
    let handle = link(code, Priority::Required, |_| unreachable!())?;
    if let Some(owner) = owner {
        handle.set_owner(owner);
    }
    handle.describe(name);
    Ok(handle)
}

impl Signature {
    pub const MAX_ARGUMENTS: usize = 32;

    /// `None` if there are too many arguments, or a type cannot be where it is.
    pub fn new(arguments: &[NativeType], result: NativeType) -> Option<&'static Signature> {
        if arguments.len() > Self::MAX_ARGUMENTS
            || !result.can_be_result()
            || !arguments.iter().all(|it| it.can_be_argument())
        {
            return None;
        }
        let mut key = SmallVec::<[NativeType; 16]>::from_slice(arguments);
        key.push(result);
        let mut signatures = SIGNATURES.lock();
        let entry = signatures.get_or_insert_default().entry_ref(key.as_slice());
        Some(entry.or_insert_with(|| {
            Box::leak(Box::new(Signature {
                arguments: arguments.into(),
                result,
                invoker: OnceLock::new(),
                call_entry: OnceLock::new(),
                callback_body: OnceLock::new(),
            }))
        }))
    }

    pub fn arguments(&self) -> &[NativeType] {
        &self.arguments
    }

    pub fn result(&self) -> NativeType {
        self.result
    }

    pub fn layout(&self) -> Layout {
        Convention::HOST.layout(&self.arguments)
    }

    #[inline]
    fn stub(
        &self,
        stub: &OnceLock<CodeHandle>,
        owner: Option<Owner>,
        name: &str,
        generate: fn(&Convention, &[NativeType], NativeType) -> Code,
    ) -> Result<usize, OutOfExecutableMemory> {
        if let Some(code) = stub.get() {
            return Ok(code.start());
        }
        let code = generate(&Convention::HOST, &self.arguments, self.result);
        let code = link_stub(&code, owner, || format!("FFI {name} {self}"))?;
        Ok(stub.get_or_init(|| code).start())
    }

    /// The address of a [`stubs::Invoker`].
    #[inline]
    pub fn invoker(&self) -> Result<usize, OutOfExecutableMemory> {
        self.stub(&self.invoker, Some(Owner::NATIVE), "invoke", stubs::invoker)
    }

    pub(crate) fn call_entry(&self) -> Result<usize, OutOfExecutableMemory> {
        self.stub(&self.call_entry, None, "call", stubs::call_entry)
    }

    pub(crate) fn callback_body(&self) -> Result<usize, OutOfExecutableMemory> {
        let (stub, owner) = (&self.callback_body, Some(Owner::NATIVE));
        self.stub(stub, owner, "callback", stubs::callback_body)
    }
}

impl fmt::Display for Signature {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}(", self.result.name())?;
        for (index, argument) in self.arguments.iter().enumerate() {
            let separator = if index == 0 { "" } else { "," };
            write!(formatter, "{separator}{}", argument.name())?;
        }
        formatter.write_str(")")
    }
}

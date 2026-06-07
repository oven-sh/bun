use core::marker::PhantomData;

use crate::postgres::any_postgres_error::AnyPostgresError;
use crate::postgres::protocol::new_writer::{NewWriter, WriterContext};

// `writeFn` is bound at type-construction time, not passed per-call. Stable
// Rust cannot take a fn as a const generic, so we model it as a ZST type
// parameter `F: WriteFn<Container>` — callers supply a unit struct that impls
// the trait. This keeps `write(this, context)` 2-arg.
// TODO(refactor): check call sites and consider flattening this to a trait directly on
// `Container` (a provided `write` method) instead of a zero-sized generic struct.
pub trait WriteFn<Container> {
    fn call<Ctx: WriterContext>(
        this: &mut Container,
        writer: NewWriter<Ctx>,
    ) -> Result<(), AnyPostgresError>;
}

pub struct WriteWrap<Container, F>(PhantomData<(Container, F)>);

impl<Container, F: WriteFn<Container>> WriteWrap<Container, F> {
    pub fn write<Ctx: WriterContext>(
        this: &mut Container,
        context: Ctx,
    ) -> Result<(), AnyPostgresError> {
        F::call(this, NewWriter { wrapped: context })?;
        Ok(())
    }
}

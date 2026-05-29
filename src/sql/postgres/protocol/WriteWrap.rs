use core::marker::PhantomData;

use crate::postgres::any_postgres_error::AnyPostgresError;
use crate::postgres::protocol::new_writer::{NewWriter, WriterContext};

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
        // Zig passed `Context` (the type) as an explicit arg; in Rust the generic `<Ctx>`
        // IS that arg (see PORTING.md §Comptime reflection — `@TypeOf` is dropped).
        F::call(this, NewWriter { wrapped: context })?;
        Ok(())
    }
}

// ported from: src/sql/postgres/protocol/WriteWrap.zig

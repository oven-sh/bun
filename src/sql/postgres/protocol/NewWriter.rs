use crate::postgres::any_postgres_error::AnyPostgresError;
use crate::postgres::types::int_types::{PostgresInt32, PostgresInt64, int32};

/// Trait expressing the structural requirements `NewWriter` places on its
/// wrapped context.
pub trait WriterContext: Copy {
    fn offset(self) -> usize;
    fn write(self, bytes: &[u8]) -> Result<(), AnyPostgresError>;
    fn pwrite(self, bytes: &[u8], offset: usize) -> Result<(), AnyPostgresError>;
}

#[derive(Copy, Clone)]
pub struct NewWriter<C: WriterContext> {
    pub wrapped: C,
}

#[derive(Copy, Clone)]
pub struct LengthWriter<C: WriterContext> {
    pub(crate) index: usize,
    pub(crate) context: NewWriter<C>,
}

impl<C: WriterContext> LengthWriter<C> {
    pub fn write(self) -> Result<(), AnyPostgresError> {
        self.context
            .pwrite(&int32(self.context.offset() - self.index), self.index)
    }

    pub fn write_excluding_self(self) -> Result<(), AnyPostgresError> {
        self.context.pwrite(
            &int32(self.context.offset().saturating_sub(self.index + 4)),
            self.index,
        )
    }
}

impl<C: WriterContext> NewWriter<C> {
    #[inline]
    pub fn write(self, data: &[u8]) -> Result<(), AnyPostgresError> {
        C::write(self.wrapped, data)
    }

    #[inline]
    pub fn length(self) -> Result<LengthWriter<C>, AnyPostgresError> {
        let i = self.offset();
        self.int4(0)?;
        Ok(LengthWriter {
            index: i,
            context: self,
        })
    }

    #[inline]
    pub(crate) fn offset(self) -> usize {
        C::offset(self.wrapped)
    }

    #[inline]
    pub(crate) fn pwrite(self, data: &[u8], i: usize) -> Result<(), AnyPostgresError> {
        C::pwrite(self.wrapped, data, i)
    }

    pub fn int4(self, value: PostgresInt32) -> Result<(), AnyPostgresError> {
        self.write(&value.to_be_bytes())
    }

    pub fn int8(self, value: PostgresInt64) -> Result<(), AnyPostgresError> {
        self.write(&value.to_be_bytes())
    }

    pub fn f64(self, value: f64) -> Result<(), AnyPostgresError> {
        self.write(&value.to_bits().to_be_bytes())
    }

    pub fn short<T>(self, value: T) -> Result<(), AnyPostgresError>
    where
        T: TryInto<u16>,
    {
        let v: u16 = value
            .try_into()
            .map_err(|_| AnyPostgresError::TooManyParameters)?;
        self.write(&v.to_be_bytes())
    }

    pub fn string(self, value: &[u8]) -> Result<(), AnyPostgresError> {
        self.write(value)?;
        if value.is_empty() || value[value.len() - 1] != 0 {
            self.write(&[0u8])?;
        }
        Ok(())
    }

    // Named `bun_string` (not `string`) to avoid colliding with `string(&[u8])` above.
    pub fn bun_string(self, value: &bun_core::String) -> Result<(), AnyPostgresError> {
        if value.is_empty() {
            self.write(&[0u8])?;
            return Ok(());
        }

        let sliced = value.to_utf8();
        let slice = sliced.slice();

        self.write(slice)?;
        if slice.is_empty() || slice[slice.len() - 1] != 0 {
            self.write(&[0u8])?;
        }
        Ok(())
    }
}

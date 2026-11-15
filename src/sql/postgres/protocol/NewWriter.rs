use crate::postgres::any_postgres_error::AnyPostgresError;
use crate::postgres::types::int_types::{PostgresInt32, PostgresInt64, int32};

pub struct NewWriter<'a> {
    buffer: &'a mut Vec<u8>,
}

#[derive(Copy, Clone)]
pub struct LengthWriter {
    pub(crate) index: usize,
}

impl LengthWriter {
    #[inline]
    pub fn write(self, writer: &mut NewWriter<'_>) -> Result<(), AnyPostgresError> {
        writer.pwrite(&int32(writer.offset() - self.index)?, self.index)
    }

    #[inline]
    pub fn write_excluding_self(self, writer: &mut NewWriter<'_>) -> Result<(), AnyPostgresError> {
        writer.pwrite(
            &int32(writer.offset().saturating_sub(self.index + 4))?,
            self.index,
        )
    }
}

#[derive(Copy, Clone)]
pub struct FormatCodes {
    index: usize,
}

impl FormatCodes {
    #[inline]
    pub fn set_binary(
        self,
        slot: usize,
        writer: &mut NewWriter<'_>,
    ) -> Result<(), AnyPostgresError> {
        writer.pwrite(&1u16.to_be_bytes(), self.index + slot * 2)
    }
}

impl<'a> NewWriter<'a> {
    #[inline]
    pub fn new(buffer: &'a mut Vec<u8>) -> Self {
        Self { buffer }
    }

    #[inline]
    pub fn write(&mut self, data: &[u8]) -> Result<(), AnyPostgresError> {
        self.buffer.extend_from_slice(data);
        Ok(())
    }

    #[inline]
    pub fn length(&mut self) -> Result<LengthWriter, AnyPostgresError> {
        let i = self.offset();
        self.int4(0)?;
        Ok(LengthWriter { index: i })
    }

    pub fn format_codes(&mut self, count: u16) -> Result<FormatCodes, AnyPostgresError> {
        const TEXT: [u8; 64] = [0; 64];
        let index = self.offset();
        let mut remaining = usize::from(count) * 2;
        while remaining > 0 {
            let n = remaining.min(TEXT.len());
            self.write(&TEXT[..n])?;
            remaining -= n;
        }
        Ok(FormatCodes { index })
    }

    #[inline]
    pub fn offset(&self) -> usize {
        self.buffer.len()
    }

    #[inline]
    pub fn truncate(&mut self, offset: usize) {
        self.buffer.truncate(offset);
    }

    #[inline]
    pub(crate) fn pwrite(&mut self, data: &[u8], i: usize) -> Result<(), AnyPostgresError> {
        self.buffer[i..][..data.len()].copy_from_slice(data);
        Ok(())
    }

    #[inline]
    pub fn int4(&mut self, value: PostgresInt32) -> Result<(), AnyPostgresError> {
        self.write(&value.to_be_bytes())
    }

    #[inline]
    pub fn int8(&mut self, value: PostgresInt64) -> Result<(), AnyPostgresError> {
        self.write(&value.to_be_bytes())
    }

    #[inline]
    pub fn f64(&mut self, value: f64) -> Result<(), AnyPostgresError> {
        self.write(&value.to_bits().to_be_bytes())
    }

    pub fn short<T>(&mut self, value: T) -> Result<(), AnyPostgresError>
    where
        T: TryInto<u16>,
    {
        let v: u16 = value
            .try_into()
            .map_err(|_| AnyPostgresError::TooManyParameters)?;
        self.write(&v.to_be_bytes())
    }

    #[inline]
    pub fn string(&mut self, value: &[u8]) -> Result<(), AnyPostgresError> {
        self.write(value)?;
        self.write(&[0u8])
    }
}

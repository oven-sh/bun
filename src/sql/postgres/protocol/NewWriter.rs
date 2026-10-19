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
            .pwrite(&int32(self.context.offset() - self.index)?, self.index)
    }

    pub fn write_excluding_self(self) -> Result<(), AnyPostgresError> {
        self.context.pwrite(
            &int32(self.context.offset().saturating_sub(self.index + 4))?,
            self.index,
        )
    }
}

#[derive(Copy, Clone)]
pub struct FormatCodes<C: WriterContext> {
    index: usize,
    context: NewWriter<C>,
}

impl<C: WriterContext> FormatCodes<C> {
    pub fn set_binary(self, slot: usize) -> Result<(), AnyPostgresError> {
        self.context
            .pwrite(&1u16.to_be_bytes(), self.index + slot * 2)
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

    pub fn format_codes(self, count: u16) -> Result<FormatCodes<C>, AnyPostgresError> {
        const TEXT: [u8; 64] = [0; 64];
        let index = self.offset();
        let mut remaining = usize::from(count) * 2;
        while remaining > 0 {
            let n = remaining.min(TEXT.len());
            self.write(&TEXT[..n])?;
            remaining -= n;
        }
        Ok(FormatCodes {
            index,
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
        self.write(&[0u8])
    }
}

#[cfg(test)]
mod tests {
    use core::cell::{Cell, RefCell};

    use super::*;
    use crate::postgres::postgres_protocol::write_query;
    use crate::postgres::protocol::parse::Parse;

    const LIMIT: usize = i32::MAX as usize;
    const TOO_LONG: Result<(), AnyPostgresError> = Err(AnyPostgresError::InvalidMessageLength);

    /// Counts what is written and keeps what is patched. It stores no other
    /// byte, so a message at the limit costs no memory.
    #[derive(Clone, Copy)]
    struct Counter<'a> {
        offset: &'a Cell<usize>,
        patched: &'a RefCell<Vec<(usize, Vec<u8>)>>,
    }

    impl WriterContext for Counter<'_> {
        fn offset(self) -> usize {
            self.offset.get()
        }

        fn write(self, bytes: &[u8]) -> Result<(), AnyPostgresError> {
            self.offset.set(self.offset.get() + bytes.len());
            Ok(())
        }

        fn pwrite(self, bytes: &[u8], offset: usize) -> Result<(), AnyPostgresError> {
            self.patched.borrow_mut().push((offset, bytes.to_vec()));
            Ok(())
        }
    }

    #[test]
    fn a_message_of_i32_max_bytes_is_the_longest() {
        let (offset, patched) = (Cell::new(7), RefCell::new(Vec::new()));
        let writer = NewWriter {
            wrapped: Counter {
                offset: &offset,
                patched: &patched,
            },
        };
        let length = writer.length().unwrap();

        offset.set(7 + LIMIT);
        assert_eq!(length.write(), Ok(()));
        assert_eq!(*patched.borrow(), [(7, vec![0x7f, 0xff, 0xff, 0xff])]);

        offset.set(7 + LIMIT + 1);
        assert_eq!(length.write(), TOO_LONG);
        assert_eq!(patched.borrow().len(), 1);
    }

    #[test]
    fn a_parameter_of_i32_max_bytes_is_the_longest() {
        let (offset, patched) = (Cell::new(7), RefCell::new(Vec::new()));
        let writer = NewWriter {
            wrapped: Counter {
                offset: &offset,
                patched: &patched,
            },
        };
        let length = writer.length().unwrap();

        offset.set(7 + 4 + LIMIT);
        assert_eq!(length.write_excluding_self(), Ok(()));
        assert_eq!(*patched.borrow(), [(7, vec![0x7f, 0xff, 0xff, 0xff])]);

        offset.set(7 + 4 + LIMIT + 1);
        assert_eq!(length.write_excluding_self(), TOO_LONG);
        assert_eq!(patched.borrow().len(), 1);
    }

    #[test]
    fn a_query_text_that_does_not_fit_in_one_message_is_not_written() {
        // Zeroed and never read: `Counter` only takes the length.
        let text = vec![0u8; LIMIT];
        let (offset, patched) = (Cell::new(0), RefCell::new(Vec::new()));
        let mut writer = NewWriter {
            wrapped: Counter {
                offset: &offset,
                patched: &patched,
            },
        };

        // Query: Int32 length, the text, NUL.
        assert_eq!(write_query(&text[..LIMIT - 5], &mut writer), Ok(()));
        assert_eq!(offset.replace(0), 1 + LIMIT);
        assert_eq!(write_query(&text[..LIMIT - 4], &mut writer), TOO_LONG);
        assert_eq!(offset.get(), 0);

        // Parse: Int32 length, NUL for no name, the text, NUL, Int16 for no parameter types.
        let mut parse = |query| {
            Parse {
                name: b"",
                query,
                params: &[],
            }
            .write_internal(&mut writer)
        };
        assert_eq!(parse(&text[..LIMIT - 8]), Ok(()));
        assert_eq!(offset.replace(0), 1 + LIMIT);
        assert_eq!(parse(&text[..LIMIT - 7]), TOO_LONG);
        assert_eq!(offset.get(), 0);
    }
}

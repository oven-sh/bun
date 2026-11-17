use super::{Cursor, Lenient, MessageParser, ParseError, State, Step, Stop, fail, is_blank};
use crate::byte_sets::{CONTENT, QUOTED_TEXT, TOKEN};

/// For the names and values of one chunk together.
pub(super) const MAX_EXTENSIONS_LEN: u64 = 16 * 1024;

/// What the next byte belongs to.
#[derive(Clone, Copy)]
pub(super) enum ChunkPart {
    DataCr,
    DataLf,
    SizeStart,
    Size,
    AfterSize,
    ExtensionStart,
    ExtensionName,
    ExtensionValue,
    QuotedValue,
    EscapedByte,
    AfterQuotedValue,
    SizeLf,
}

impl MessageParser {
    /// The end of the last chunk and the size line of the next.
    #[inline(always)]
    pub(super) fn parse_chunk_head(&mut self, input: &[u8], mut part: ChunkPart) -> Step<()> {
        use ChunkPart::*;

        let mut cursor = Cursor::new(input, self.consumed);
        let mut step = self.parse_chunk_parts(&mut cursor, &mut part);
        if let (Err(Stop::Short), ExtensionName | ExtensionValue | QuotedValue | EscapedByte) =
            (&step, part)
        {
            step = self.count_marked(&mut cursor, 0).and(step);
        }
        self.consumed = cursor.pos;
        self.state = State::Chunks(part);
        step
    }

    #[inline(always)]
    fn parse_chunk_parts(&mut self, cursor: &mut Cursor<'_>, part: &mut ChunkPart) -> Step<()> {
        use ChunkPart::*;

        run_parts!(match *part {
            DataCr => match cursor.peek()? {
                b'\r' => {
                    cursor.bump();
                    DataLf
                }
                b'\n' => {
                    self.skip_lone_lf(cursor, ParseError::NoCrAfterChunkData)?;
                    SizeStart
                }
                _ => DataLf,
            },
            DataLf => {
                let error = ParseError::NoLfAfterChunkData;
                self.expect_lf(cursor, Lenient::OPTIONAL_CRLF_AFTER_CHUNK, error)?;
                SizeStart
            }
            SizeStart => {
                let Some(digit) = hex_digit(cursor.peek()?) else {
                    return fail(ParseError::ChunkSizeByte);
                };
                cursor.bump();
                self.remaining = digit;
                self.extensions_len = 0;
                Size
            }
            Size => {
                while let Some(digit) = hex_digit(cursor.peek()?) {
                    cursor.bump();
                    let Some(size) = self.remaining.checked_mul(16) else {
                        return fail(ParseError::ChunkSizeOverflow);
                    };
                    self.remaining = size | digit;
                }
                AfterSize
            }
            AfterSize => match cursor.peek()? {
                b'\r' => {
                    cursor.bump();
                    SizeLf
                }
                // It stands for the CR: https://github.com/nodejs/llhttp/blob/v9.4.4/src/llhttp/http.ts#L969-L975
                b'\n' => {
                    self.skip_lone_lf(cursor, ParseError::NoCrAfterChunkSize)?;
                    SizeLf
                }
                b';' => {
                    cursor.bump();
                    ExtensionStart
                }
                byte if is_blank(byte) => {
                    cursor.bump();
                    let error = ParseError::ChunkSizeByte;
                    self.tolerate(Lenient::SPACES_AFTER_CHUNK_SIZE, error)?;
                    AfterSize
                }
                _ => return fail(ParseError::ChunkSizeByte),
            },
            ExtensionStart => match cursor.peek()? {
                b'\r' | b' ' => return cursor.fail_after(ParseError::ExtensionStartByte),
                _ => {
                    cursor.set_mark();
                    ExtensionName
                }
            },
            ExtensionName => match cursor.skip(&TOKEN)? {
                b'=' => {
                    self.count_marked(cursor, 1)?;
                    cursor.set_mark();
                    ExtensionValue
                }
                byte => self.end_extension(
                    cursor,
                    byte,
                    ParseError::NoCrAfterExtensionName,
                    ParseError::ExtensionNameByte,
                )?,
            },
            ExtensionValue => match cursor.skip(&TOKEN)? {
                b'"' => {
                    cursor.bump();
                    QuotedValue
                }
                byte => self.end_extension(
                    cursor,
                    byte,
                    ParseError::NoCrAfterExtensionValue,
                    ParseError::ExtensionValueByte,
                )?,
            },
            QuotedValue => match cursor.skip(&QUOTED_TEXT)? {
                b'"' => {
                    cursor.bump();
                    self.count_marked(cursor, 0)?;
                    AfterQuotedValue
                }
                b'\\' => {
                    cursor.bump();
                    EscapedByte
                }
                _ => {
                    self.count_marked(cursor, 1)?;
                    return fail(ParseError::QuotedExtensionByte);
                }
            },
            EscapedByte => {
                if !CONTENT.contains(cursor.peek()?) {
                    self.count_marked(cursor, 1)?;
                    return fail(ParseError::EscapedExtensionByte);
                }
                cursor.bump();
                QuotedValue
            }
            AfterQuotedValue => match cursor.peek()? {
                b';' => {
                    cursor.bump();
                    ExtensionStart
                }
                b'\r' => {
                    cursor.bump();
                    SizeLf
                }
                b'\n' => {
                    let error = ParseError::NoCrAfterExtensionValue;
                    self.tolerate(Lenient::OPTIONAL_CR_BEFORE_LF, error)?;
                    SizeLf
                }
                _ => return fail(ParseError::AfterQuotedExtension),
            },
            SizeLf => {
                let error = ParseError::NoLfAfterChunkSize;
                return self.expect_lf(cursor, Lenient::OPTIONAL_LF_AFTER_CR, error);
            }
        })
    }

    /// `byte` follows a name or an unquoted value.
    #[inline(always)]
    fn end_extension(
        &mut self,
        cursor: &mut Cursor<'_>,
        byte: u8,
        no_cr: ParseError,
        invalid_byte: ParseError,
    ) -> Step<ChunkPart> {
        if byte == b'\n' {
            self.count_marked(cursor, 0)?;
            self.tolerate(Lenient::OPTIONAL_CR_BEFORE_LF, no_cr)?;
            return Ok(ChunkPart::SizeLf);
        }
        self.count_marked(cursor, 1)?;
        match byte {
            b';' => Ok(ChunkPart::ExtensionStart),
            b'\r' => Ok(ChunkPart::SizeLf),
            _ => fail(invalid_byte),
        }
    }

    /// Counts what is marked as a part of the extensions, then skips the `skipped` bytes that end it.
    #[inline(always)]
    fn count_marked(&mut self, cursor: &mut Cursor<'_>, skipped: usize) -> Step<()> {
        self.extensions_len += cursor.marked_len();
        cursor.pos += skipped;
        if self.extensions_len > MAX_EXTENSIONS_LEN {
            return fail(ParseError::ExtensionsTooLong);
        }
        Ok(())
    }
}

#[inline(always)]
fn hex_digit(byte: u8) -> Option<u64> {
    bun_core::fmt::hex_digit_value(byte).map(u64::from)
}

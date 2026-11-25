use super::head::split_run;
use super::{Body, RequestError, RequestParser};
use crate::byte_sets::ABOVE_SPACE;

impl RequestParser {
    pub(super) fn start_chunk(&mut self) {
        (self.body, self.remaining, self.has_size_digit) = (Body::ChunkSize, 0, false);
    }

    /// Takes the next data from `input`. It is empty at the end of the body.
    pub(super) fn next_chunk<'a, const IS_NODE: bool>(
        &mut self,
        input: &mut &'a [u8],
        max_trailers_len: usize,
    ) -> Option<&'a [u8]> {
        if self.body == Body::AfterTrailers {
            self.body = Body::None;
        }
        while let [byte, rest @ ..] = *input {
            match self.body {
                Body::ChunkSize | Body::ChunkExtension | Body::ChunkSizeLf => {
                    *input = self.read_size_line(input);
                    if self.body != Body::ChunkData || self.remaining != 2 {
                        continue;
                    }
                    if !IS_NODE {
                        self.body = Body::LastCr;
                        return Some(&[]);
                    }
                    self.body = Body::Trailers;
                }
                Body::ChunkData => {
                    let data = self.read_data(input);
                    if !data.is_empty() {
                        return Some(data);
                    }
                }
                Body::Trailers => {
                    *input = rest;
                    self.trailers.push(*byte);
                    if self.trailers.len() > max_trailers_len {
                        self.body = Body::Failed(RequestError::TrailersTooLarge);
                    } else if let b"\r\n" | [.., b'\r', b'\n', b'\r', b'\n'] = &*self.trailers {
                        self.body = Body::AfterTrailers;
                        return Some(&[]);
                    } else if *byte == b'\n' && !self.trailers.ends_with(b"\r\n") {
                        self.body = Body::Failed(RequestError::InvalidChunkedEncoding);
                    }
                }
                Body::LastCr | Body::LastLf => {
                    *input = rest;
                    self.body = match (self.body, byte) {
                        (Body::LastCr, b'\r') => Body::LastLf,
                        (Body::LastLf, b'\n') => Body::None,
                        _ => Body::Failed(RequestError::InvalidChunkedEncoding),
                    };
                }
                Body::None
                | Body::Content
                | Body::Tunnel
                | Body::AfterTrailers
                | Body::Failed(_) => break,
            }
        }
        None
    }

    fn read_size_line<'a>(&mut self, mut input: &'a [u8]) -> &'a [u8] {
        const INVALID: Body = Body::Failed(RequestError::InvalidChunkedEncoding);

        if self.body == Body::ChunkSize {
            if !self.has_size_digit {
                self.extension_len = 0;
            }
            while let [byte, rest @ ..] = input
                && let Some(digit) = char::from(*byte).to_digit(16)
            {
                if self.remaining >> 54 != 0 {
                    self.body = INVALID;
                    return input;
                }
                self.remaining = (self.remaining << 4) | u64::from(digit);
                self.has_size_digit = true;
                input = rest;
            }
            if let [b';', ..] = input {
                self.body = Body::ChunkExtension;
            }
        }
        if self.body == Body::ChunkExtension {
            let extension;
            (extension, input) = split_run(input, &ABOVE_SPACE);
            self.extension_len += extension.len();
        }
        if self.body != Body::ChunkSizeLf {
            (self.body, input) = match input {
                [] => return input,
                [b'\r', rest @ ..] => (Body::ChunkSizeLf, rest),
                _ => (INVALID, input),
            };
        }
        match (self.body, input) {
            (_, []) => input,
            (Body::ChunkSizeLf, [b'\n', rest @ ..]) if self.has_size_digit => {
                self.body = Body::ChunkData;
                self.remaining += 2;
                rest
            }
            _ => {
                self.body = INVALID;
                input
            }
        }
    }

    /// Data is not delivered if what `input` has of the line end after it is wrong.
    fn read_data<'a>(&mut self, input: &mut &'a [u8]) -> &'a [u8] {
        let split = |bytes: &'a [u8], len: u64| {
            let len = usize::try_from(len).unwrap_or(usize::MAX);
            bytes.split_at_checked(len).unwrap_or((bytes, &[]))
        };
        let (chunk, rest) = split(input, self.remaining);
        let (data, line_end) = split(chunk, self.remaining.saturating_sub(2));
        let expected: &[u8] = if self.remaining == 1 { b"\n" } else { b"\r\n" };
        if !expected.starts_with(line_end) {
            self.body = Body::Failed(RequestError::ChunkTerminatorExpected);
            return &[];
        }
        *input = rest;
        self.remaining -= chunk.len() as u64;
        if self.remaining == 0 {
            self.start_chunk();
        }
        data
    }
}

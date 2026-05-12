//! Implements prompt, alert, and confirm Web API

use crate::webcore::jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_collections::VecExt as _;
use bun_core::Output;
use bun_jsc::ZigStringJsc as _;
use bun_jsc::zig_string::ZigString;

/// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-alert
#[bun_jsc::host_fn(export = "WebCore__alert")]
fn alert(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<1>();
    let arguments = arguments.slice();
    let output = Output::writer();
    let has_message = !arguments.is_empty();

    // 2. If the method was invoked with no arguments, then let message be the empty string; otherwise, let message be the method's first argument.
    if has_message {
        // PERF(port): was stack-fallback (2048 bytes) — profile in Phase B
        let message = arguments[0].to_slice(global)?;

        if !message.slice().is_empty() {
            // 3. Set message to the result of normalizing newlines given message.
            // *  We skip step 3 because they are already done in most terminals by default.

            // 4. Set message to the result of optionally truncating message.
            // *  We just don't do this because it's not necessary.

            // 5. Show message to the user, treating U+000A LF as a line break.
            if output.write_all(message.slice()).is_err() {
                // 1. If we cannot show simple dialogs for this, then return.
                return Ok(JSValue::UNDEFINED);
            }
        }
    }

    if output
        .write_all(if has_message {
            b" [Enter] " as &[u8]
        } else {
            b"Alert [Enter] "
        })
        .is_err()
    {
        // 1. If we cannot show simple dialogs for this, then return.
        return Ok(JSValue::UNDEFINED);
    }

    // 6. Invoke WebDriver BiDi user prompt opened with this, "alert", and message.
    // *  Not pertinent to use their complex system in a server context.
    Output::flush();

    // 7. Optionally, pause while waiting for the user to acknowledge the message.
    // Zig: `std.fs.File.stdin().readerStreaming(&[1]u8)` — unbuffered byte reader.
    let mut reader = Output::stdin_reader();
    loop {
        let Ok(byte) = reader.take_byte() else { break };
        if byte == b'\n' {
            break;
        }
    }

    // 8. Invoke WebDriver BiDi user prompt closed with this and true.
    // *  Again, not necessary in a server context.

    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn(export = "WebCore__confirm")]
fn confirm(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<1>();
    let arguments = arguments.slice();
    let output = Output::writer();
    let has_message = !arguments.is_empty();

    if has_message {
        // PERF(port): was stack-fallback (1024 bytes) — profile in Phase B
        // 2. Set message to the result of normalizing newlines given message.
        // *  Not pertinent to a server runtime so we will just let the terminal handle this.

        // 3. Set message to the result of optionally truncating message.
        // *  Not necessary so we won't do it.
        let message = arguments[0].to_slice(global)?;

        if output.write_all(message.slice()).is_err() {
            // 1. If we cannot show simple dialogs for this, then return false.
            return Ok(JSValue::FALSE);
        }
    }

    // 4. Show message to the user, treating U+000A LF as a line break,
    //    and ask the user to respond with a positive or negative
    //    response.
    if output
        .write_all(if has_message {
            b" [y/N] " as &[u8]
        } else {
            b"Confirm [y/N] "
        })
        .is_err()
    {
        // 1. If we cannot show simple dialogs for this, then return false.
        return Ok(JSValue::FALSE);
    }

    // 5. Invoke WebDriver BiDi user prompt opened with this, "confirm", and message.
    // *  Not relevant in a server context.
    Output::flush();

    // 6. Pause until the user responds either positively or negatively.
    // Zig: `std.fs.File.stdin().readerStreaming(&[1024]u8)` — byte reader.
    let mut reader = Output::stdin_reader();

    let Ok(first_byte) = reader.take_byte() else {
        return Ok(JSValue::FALSE);
    };

    // 7. Invoke WebDriver BiDi user prompt closed with this, and true if
    //    the user responded positively or false otherwise.
    // *  Not relevant in a server context.

    match first_byte {
        b'\n' => return Ok(JSValue::FALSE),
        b'\r' => {
            let Ok(next_byte) = reader.take_byte() else {
                // They may have said yes, but the stdin is invalid.
                return Ok(JSValue::FALSE);
            };
            if next_byte == b'\n' {
                return Ok(JSValue::FALSE);
            }
        }
        b'y' | b'Y' => {
            let Ok(next_byte) = reader.take_byte() else {
                // They may have said yes, but the stdin is invalid.

                return Ok(JSValue::FALSE);
            };

            if next_byte == b'\n' {
                // 8. If the user responded positively, return true;
                //    otherwise, the user responded negatively: return false.
                return Ok(JSValue::TRUE);
            } else if next_byte == b'\r' {
                // Check Windows style
                let Ok(second_byte) = reader.take_byte() else {
                    return Ok(JSValue::FALSE);
                };
                if second_byte == b'\n' {
                    return Ok(JSValue::TRUE);
                }
            }
        }
        _ => {}
    }

    while let Ok(b) = reader.take_byte() {
        if b == b'\n' || b == b'\r' {
            break;
        }
    }

    // 8. If the user responded positively, return true; otherwise, the user
    //    responded negatively: return false.
    Ok(JSValue::FALSE)
}

pub mod prompt {
    use super::*;

    /// Error set for the read-until-delimiter helpers below.
    #[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
    pub enum ReadError {
        #[error("StreamTooLong")]
        StreamTooLong,
        #[error("Io")]
        Io,
    }

    /// `reader: anytype` in the Zig — the only method called is `readByte()`.
    /// Bound on a small trait exposing `read_byte() -> Result<u8, _>`; the only
    /// concrete impl is the process-global `BufferedStdin`.
    pub trait ReadByte {
        type Error;
        fn read_byte(&mut self) -> Result<u8, Self::Error>;
    }

    impl ReadByte for bun_core::output::BufferedStdin {
        type Error = bun_core::Error;
        #[inline]
        fn read_byte(&mut self) -> Result<u8, Self::Error> {
            bun_core::output::BufferedStdin::read_byte(self)
        }
    }

    /// Adapted from `std.io.Reader.readUntilDelimiterArrayList` to only append
    /// and assume capacity.
    pub fn read_until_delimiter_array_list_append_assume_capacity<R: ReadByte>(
        reader: &mut R,
        array_list: &mut Vec<u8>,
        delimiter: u8,
        max_size: usize,
    ) -> Result<(), ReadError> {
        loop {
            if array_list.len() == max_size {
                return Err(ReadError::StreamTooLong);
            }

            let byte: u8 = reader.read_byte().map_err(|_| ReadError::Io)?;

            if byte == delimiter {
                return Ok(());
            }

            // PERF(port): was assume_capacity
            array_list.push(byte);
        }
    }

    /// Adapted from `std.io.Reader.readUntilDelimiterArrayList` to always append
    /// and not resize.
    fn read_until_delimiter_array_list_infinity<R: ReadByte>(
        reader: &mut R,
        array_list: &mut Vec<u8>,
        delimiter: u8,
    ) -> Result<(), ReadError> {
        loop {
            let byte: u8 = reader.read_byte().map_err(|_| ReadError::Io)?;

            if byte == delimiter {
                return Ok(());
            }

            array_list.push(byte);
        }
    }

    /// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-prompt
    #[bun_jsc::host_fn(export = "WebCore__prompt")]
    pub fn call(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments = frame.arguments_old::<3>();
        let arguments = arguments.slice();
        // PERF(port): was stack-fallback (2048 bytes) — profile in Phase B
        let output = Output::writer();
        let has_message = !arguments.is_empty();
        let has_default = arguments.len() >= 2;
        // 4. Set default to the result of optionally truncating default.
        // *  We don't really need to do this.
        let default = if has_default {
            arguments[1]
        } else {
            JSValue::NULL
        };

        if has_message {
            // 2. Set message to the result of normalizing newlines given message.
            // *  Not pertinent to a server runtime so we will just let the terminal handle this.

            // 3. Set message to the result of optionally truncating message.
            // *  Not necessary so we won't do it.
            let message = arguments[0].to_slice(global)?;

            if output.write_all(message.slice()).is_err() {
                // 1. If we cannot show simple dialogs for this, then return null.
                return Ok(JSValue::NULL);
            }
        }

        // 4. Set default to the result of optionally truncating default.

        // 5. Show message to the user, treating U+000A LF as a line break,
        //    and ask the user to either respond with a string value or
        //    abort. The response must be defaulted to the value given by
        //    default.
        if output
            .write_all(if has_message {
                b" " as &[u8]
            } else {
                b"Prompt "
            })
            .is_err()
        {
            // 1. If we cannot show simple dialogs for this, then return false.
            return Ok(JSValue::FALSE);
        }

        if has_default {
            let default_string = arguments[1].to_slice(global)?;

            if output
                .print(format_args!(
                    "[{}] ",
                    bstr::BStr::new(default_string.slice())
                ))
                .is_err()
            {
                // 1. If we cannot show simple dialogs for this, then return false.
                return Ok(JSValue::FALSE);
            }
        }

        // 6. Invoke WebDriver BiDi user prompt opened with this, "prompt" and message.
        // *  Not relevant in a server context.
        Output::flush();

        // unset `ENABLE_VIRTUAL_TERMINAL_INPUT` on windows. This prevents backspace from
        // deleting the entire line
        #[cfg(windows)]
        let _restore =
            bun_sys::windows::StdinModeGuard::set(bun_sys::windows::UpdateStdioModeFlagsOpts {
                unset: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT,
                ..Default::default()
            });

        // 7. Pause while waiting for the user's response.
        // `bun.Output.buffered_stdin.reader()` — process-global 4 KiB buffered stdin.
        // SAFETY: process-global static; prompt() runs single-threaded on the JS
        // main thread, so the exclusive borrow is sound for this scope.
        let reader: &mut bun_core::output::BufferedStdin =
            unsafe { &mut *Output::buffered_stdin_reader() };
        let mut second_byte: Option<u8> = None;
        let Ok(first_byte) = reader.read_byte() else {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return Ok(JSValue::NULL);
        };

        if first_byte == b'\n' {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return Ok(default);
        } else if first_byte == b'\r' {
            let Ok(second) = reader.read_byte() else {
                return Ok(JSValue::NULL);
            };
            second_byte = Some(second);
            if second == b'\n' {
                return Ok(default);
            }
        }

        // PERF(port): was stack-fallback allocator backing this Vec
        let mut input: Vec<u8> = Vec::with_capacity(2048);
        // Note: Zig returned `.null` on OOM here; Rust `Vec::with_capacity` aborts on OOM.

        // PERF(port): was assume_capacity
        input.push(first_byte);
        if let Some(second) = second_byte {
            // PERF(port): was assume_capacity
            input.push(second);
        }

        // All of this code basically just first tries to load the input into a
        // buffer of size 2048. If that is too small, then increase the buffer
        // size to 4096. If that is too small, then just dynamically allocate
        // the rest.
        if let Err(e) = read_until_delimiter_array_list_append_assume_capacity(
            &mut *reader,
            &mut input,
            b'\n',
            2048,
        ) {
            if !matches!(e, ReadError::StreamTooLong) {
                // 8. Let result be null if the user aborts, or otherwise the string
                //    that the user responded with.
                return Ok(JSValue::NULL);
            }

            input.ensure_total_capacity(4096);
            // Note: Zig returned `.null` on OOM here; Rust `reserve` aborts on OOM.

            if let Err(e2) = read_until_delimiter_array_list_append_assume_capacity(
                &mut *reader,
                &mut input,
                b'\n',
                4096,
            ) {
                if !matches!(e2, ReadError::StreamTooLong) {
                    // 8. Let result be null if the user aborts, or otherwise the string
                    //    that the user responded with.
                    return Ok(JSValue::NULL);
                }

                if read_until_delimiter_array_list_infinity(&mut *reader, &mut input, b'\n')
                    .is_err()
                {
                    // 8. Let result be null if the user aborts, or otherwise the string
                    //    that the user responded with.
                    return Ok(JSValue::NULL);
                }
            }
        }

        if !input.is_empty() && input[input.len() - 1] == b'\r' {
            input.truncate(input.len() - 1);
        }

        if cfg!(debug_assertions) {
            debug_assert!(!input.is_empty());
            debug_assert!(input[input.len() - 1] != b'\r');
        }

        // 8. Let result be null if the user aborts, or otherwise the string
        //    that the user responded with.
        let mut result = ZigString::init(&input);
        result.mark_utf8();

        // 9. Invoke WebDriver BiDi user prompt closed with this, false if
        //    result is null or true otherwise, and result.
        // *  Too complex for server context.

        // 9. Return result.
        Ok(result.to_js(global))
    }
}

//! Implements prompt, alert, and confirm Web API

use crate::webcore::jsc::{JSValue, JsResult};
use bun_core::EncodedSlice;
use bun_core::Output;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::bindgen::{JsLocal, JsScope};

/// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-alert
pub(crate) fn alert(message: Option<&[u8]>) {
    let output = Output::writer();

    // 2. If the method was invoked with no arguments, then let message be the empty string; otherwise, let message be the method's first argument.
    if let Some(message) = message {
        if !message.is_empty() {
            // 3. Set message to the result of normalizing newlines given message.
            // *  We skip step 3 because they are already done in most terminals by default.

            // 4. Set message to the result of optionally truncating message.
            // *  We just don't do this because it's not necessary.

            // 5. Show message to the user, treating U+000A LF as a line break.
            if output.write_all(message).is_err() {
                // 1. If we cannot show simple dialogs for this, then return.
                return;
            }
        }
    }

    if output
        .write_all(if message.is_some() {
            b" [Enter] " as &[u8]
        } else {
            b"Alert [Enter] "
        })
        .is_err()
    {
        // 1. If we cannot show simple dialogs for this, then return.
        return;
    }

    // 6. Invoke WebDriver BiDi user prompt opened with this, "alert", and message.
    // *  Not pertinent to use their complex system in a server context.
    Output::flush();

    // 7. Optionally, pause while waiting for the user to acknowledge the message.
    Output::stdin_reader().skip_line();

    // 8. Invoke WebDriver BiDi user prompt closed with this and true.
    // *  Again, not necessary in a server context.
}

pub(crate) fn confirm(message: Option<&[u8]>) -> bool {
    let output = Output::writer();

    if let Some(message) = message {
        // 2. Set message to the result of normalizing newlines given message.
        // *  Not pertinent to a server runtime so we will just let the terminal handle this.

        // 3. Set message to the result of optionally truncating message.
        // *  Not necessary so we won't do it.
        if output.write_all(message).is_err() {
            // 1. If we cannot show simple dialogs for this, then return false.
            return false;
        }
    }

    // 4. Show message to the user, treating U+000A LF as a line break,
    //    and ask the user to respond with a positive or negative
    //    response.
    if output
        .write_all(if message.is_some() {
            b" [y/N] " as &[u8]
        } else {
            b"Confirm [y/N] "
        })
        .is_err()
    {
        // 1. If we cannot show simple dialogs for this, then return false.
        return false;
    }

    // 5. Invoke WebDriver BiDi user prompt opened with this, "confirm", and message.
    // *  Not relevant in a server context.
    Output::flush();

    // 6. Pause until the user responds either positively or negatively.
    // 7. Invoke WebDriver BiDi user prompt closed with this, and true if
    //    the user responded positively or false otherwise.
    // *  Not relevant in a server context.
    // 8. If the user responded positively, return true; otherwise, the user
    //    responded negatively: return false.
    Output::stdin_reader().read_yes()
}

/// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-prompt
pub(crate) fn prompt<'a>(
    cx: &mut JsScope<'a>,
    message: Option<&[u8]>,
    default_value: Option<JsLocal<'a>>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let output = Output::writer();
    // 4. Set default to the result of optionally truncating default.
    // *  We don't really need to do this.
    let default = default_value.map(JsLocal::to_js);

    if let Some(message) = message {
        // 2. Set message to the result of normalizing newlines given message.
        // *  Not pertinent to a server runtime so we will just let the terminal handle this.

        // 3. Set message to the result of optionally truncating message.
        // *  Not necessary so we won't do it.
        if output.write_all(message).is_err() {
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
        .write_all(if message.is_some() {
            b" " as &[u8]
        } else {
            b"Prompt "
        })
        .is_err()
    {
        // 1. If we cannot show simple dialogs for this, then return false.
        return Ok(JSValue::FALSE);
    }

    if let Some(default) = default {
        let default_string = default.to_utf8(global)?;

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
    let mut input: Vec<u8> = Vec::new();
    if Output::stdin_reader()
        .read_line(&mut input, usize::MAX)
        .is_err()
    {
        // 8. Let result be null if the user aborts, or otherwise the string
        //    that the user responded with.
        return Ok(JSValue::NULL);
    }

    if input.last() == Some(&b'\r') {
        input.pop();
    }

    if input.is_empty() {
        return Ok(default.unwrap_or(JSValue::NULL));
    }

    // 8. Let result be null if the user aborts, or otherwise the string
    //    that the user responded with.
    let result = EncodedSlice::utf8(&input);

    // 9. Invoke WebDriver BiDi user prompt closed with this, false if
    //    result is null or true otherwise, and result.
    // *  Too complex for server context.

    // 9. Return result.
    Ok(result.to_js(global))
}

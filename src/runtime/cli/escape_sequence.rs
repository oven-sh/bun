//! After `ESC [` or `ESC O` a key is bytes 0x20..=0x3F and then one final byte 0x40..=0x7E.

/// No key or mouse report a caller binds has more bytes before its final byte.
pub(crate) const MAX_PARAMS: usize = 16;

/// What follows an ESC byte.
pub(crate) enum Escape<'a> {
    /// `ESC [` or `ESC O`, then `params`, then `final_byte`.
    Sequence {
        introducer: u8,
        params: &'a [u8],
        final_byte: u8,
    },
    /// A sequence that was read to its end, but that no caller can bind.
    Unknown,
    /// A byte that starts no sequence: the Esc key and then that key, or Alt with it.
    Other(u8),
    /// A byte that no sequence contains cut one short. It is the next key.
    Interrupted(u8),
    /// The input ended.
    Eof,
}

/// Reads what follows an ESC byte. The ESC is already read.
pub(crate) fn read_escape(
    mut next_byte: impl FnMut() -> Option<u8>,
    params: &mut [u8; MAX_PARAMS],
) -> Escape<'_> {
    let introducer = match next_byte() {
        Some(byte @ (b'[' | b'O')) => byte,
        Some(byte) => return Escape::Other(byte),
        None => return Escape::Eof,
    };
    let mut len = 0;
    let mut too_long = false;
    loop {
        let Some(byte) = next_byte() else {
            return Escape::Eof;
        };
        match byte {
            // The Linux console sends F1..F5 as `ESC [ [ A`..`ESC [ [ E`.
            b'[' if introducer == b'[' && len == 0 => {
                return match next_byte() {
                    Some(0x20..=0x7e) => Escape::Unknown,
                    Some(byte) => Escape::Interrupted(byte),
                    None => Escape::Eof,
                };
            }
            // rxvt ends its shifted keys with `$`: `ESC [ 3 $` is Shift+Delete.
            b'$' if len > 0 && !too_long && params[..len].iter().all(u8::is_ascii_digit) => {
                return Escape::Sequence {
                    introducer,
                    params: &params[..len],
                    final_byte: byte,
                };
            }
            0x20..=0x3f => match params.get_mut(len) {
                Some(slot) => {
                    *slot = byte;
                    len += 1;
                }
                None => too_long = true,
            },
            0x40..=0x7e if too_long => return Escape::Unknown,
            0x40..=0x7e => {
                return Escape::Sequence {
                    introducer,
                    params: &params[..len],
                    final_byte: byte,
                };
            }
            _ => return Escape::Interrupted(byte),
        }
    }
}

/// The final byte (`A`..=`D`) of an arrow key, alone or with modifier keys (`ESC [ 1 ; 2 A`).
pub(crate) fn arrow(params: &[u8], final_byte: u8) -> Option<u8> {
    let params_of_an_arrow = match params {
        [] => true,
        [b'1', b';', modifiers @ ..] => {
            !modifiers.is_empty() && modifiers.iter().all(u8::is_ascii_digit)
        }
        _ => false,
    };
    (params_of_an_arrow && matches!(final_byte, b'A'..=b'D')).then_some(final_byte)
}

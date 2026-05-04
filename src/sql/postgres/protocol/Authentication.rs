use crate::shared::Data;
use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;

bun_output::declare_scope!(Postgres, hidden);

pub enum Authentication {
    Ok,
    ClearTextPassword,
    MD5Password {
        salt: [u8; 4],
    },
    KerberosV5,
    SCMCredential,
    GSS,
    GSSContinue {
        data: Data,
    },
    SSPI,
    SASL,
    SASLContinue(SASLContinue),
    SASLFinal {
        data: Data,
    },
    Unknown,
}

pub struct SASLContinue {
    pub data: Data,
    // TODO(port): r/s/i are sub-slices borrowed from `data.slice()` (self-referential).
    // Stored as raw fat pointers in Phase A; revisit ownership in Phase B.
    pub r: *const [u8],
    pub s: *const [u8],
    pub i: *const [u8],
}

impl SASLContinue {
    pub fn iteration_count(&self) -> Result<u32, bun_core::Error> {
        // SAFETY: `i` points into `self.data`'s buffer, which is alive for `'self`.
        let i = unsafe { &*self.i };
        // TODO(port): std.fmt.parseInt(u32, _, 0) auto-detects radix from prefix (0x/0o/0b);
        // Phase B should provide bun_str::strings::parse_int with the same semantics.
        let s = core::str::from_utf8(i).map_err(|_| bun_core::err!("InvalidCharacter"))?;
        s.parse::<u32>().map_err(|_| bun_core::err!("InvalidCharacter"))
    }
}

impl Drop for Authentication {
    fn drop(&mut self) {
        match self {
            Authentication::MD5Password { .. } => {}
            Authentication::SASL => {}
            Authentication::SASLContinue(v) => {
                v.data.zdeinit();
            }
            Authentication::SASLFinal { data } => {
                data.zdeinit();
            }
            _ => {}
        }
    }
}

impl Authentication {
    // PORT NOTE: reshaped from out-param `fn(this: *@This(), ...) !void` to `-> Result<Self, _>`.
    pub fn decode_internal<Container>(
        reader: &mut NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        let message_length = reader.length()?;

        match reader.int4()? {
            0 => {
                if message_length != 8 {
                    return Err(bun_core::err!("InvalidMessageLength"));
                }
                Ok(Authentication::Ok)
            }
            2 => {
                if message_length != 8 {
                    return Err(bun_core::err!("InvalidMessageLength"));
                }
                Ok(Authentication::KerberosV5)
            }
            3 => {
                if message_length != 8 {
                    return Err(bun_core::err!("InvalidMessageLength"));
                }
                Ok(Authentication::ClearTextPassword)
            }
            5 => {
                if message_length != 12 {
                    return Err(bun_core::err!("InvalidMessageLength"));
                }
                let salt_data = reader.bytes(4)?;
                // `defer salt_data.deinit()` — handled by Drop on `Data` at scope exit.
                let salt: [u8; 4] = salt_data.slice()[0..4]
                    .try_into()
                    .expect("unreachable");
                Ok(Authentication::MD5Password { salt })
            }
            7 => {
                if message_length != 8 {
                    return Err(bun_core::err!("InvalidMessageLength"));
                }
                Ok(Authentication::GSS)
            }

            8 => {
                if message_length < 9 {
                    return Err(bun_core::err!("InvalidMessageLength"));
                }
                let bytes = reader.read(message_length - 8)?;
                Ok(Authentication::GSSContinue { data: bytes })
            }
            9 => {
                if message_length != 8 {
                    return Err(bun_core::err!("InvalidMessageLength"));
                }
                Ok(Authentication::SSPI)
            }

            10 => {
                if message_length < 9 {
                    return Err(bun_core::err!("InvalidMessageLength"));
                }
                reader.skip(message_length - 8)?;
                Ok(Authentication::SASL)
            }

            11 => {
                if message_length < 9 {
                    return Err(bun_core::err!("InvalidMessageLength"));
                }
                let bytes = reader.bytes(message_length - 8)?;
                // errdefer { bytes.deinit(); } — `Data: Drop` frees on `?` early-return.

                let mut r: Option<*const [u8]> = None;
                let mut i: Option<*const [u8]> = None;
                let mut s: Option<*const [u8]> = None;

                {
                    // PORT NOTE: reshaped for borrowck — iterate over a raw view so the
                    // resulting sub-slice raw pointers don't hold a borrow on `bytes`.
                    let slice: *const [u8] = bytes.slice();
                    // SAFETY: `slice` points into `bytes`, alive for this scope.
                    let mut iter = bun_str::strings::split(unsafe { &*slice }, b",");
                    while let Some(item) = iter.next() {
                        if item.len() > 2 {
                            let key = item[0];
                            let after_equals: *const [u8] = &item[2..];
                            if key == b'r' {
                                r = Some(after_equals);
                            } else if key == b's' {
                                s = Some(after_equals);
                            } else if key == b'i' {
                                i = Some(after_equals);
                            }
                        }
                    }
                }

                if r.is_none() {
                    bun_output::scoped_log!(Postgres, "Missing r");
                }

                if s.is_none() {
                    bun_output::scoped_log!(Postgres, "Missing s");
                }

                if i.is_none() {
                    bun_output::scoped_log!(Postgres, "Missing i");
                }

                let r = r.ok_or(bun_core::err!("InvalidMessage"))?;
                let s = s.ok_or(bun_core::err!("InvalidMessage"))?;
                let i = i.ok_or(bun_core::err!("InvalidMessage"))?;

                Ok(Authentication::SASLContinue(SASLContinue {
                    data: bytes,
                    r,
                    s,
                    i,
                }))
            }

            12 => {
                if message_length < 9 {
                    return Err(bun_core::err!("InvalidMessageLength"));
                }
                let remaining: usize = (message_length - 8) as usize;

                let bytes = reader.read(remaining)?;
                Ok(Authentication::SASLFinal { data: bytes })
            }

            _ => Ok(Authentication::Unknown),
        }
    }

    // TODO(port): `pub const decode = DecoderWrap(Authentication, decodeInternal).decode;`
    // DecoderWrap is a comptime type-generator that wraps `decode_internal` into a `decode`
    // entry point. Phase B should express this via a trait impl on `Authentication` rather
    // than a const fn alias.
    pub fn decode<Container>(reader: &mut NewReader<Container>) -> Result<Self, bun_core::Error> {
        DecoderWrap::<Authentication>::decode(reader)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/Authentication.zig (180 lines)
//   confidence: medium
//   todos:      3
//   notes:      SASLContinue r/s/i are self-referential into `data`; stored as *const [u8]. DecoderWrap alias needs trait-based rewrite in Phase B.
// ──────────────────────────────────────────────────────────────────────────

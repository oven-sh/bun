use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;
use crate::shared::Data;
use bun_ptr::RawSlice;

bun_core::declare_scope!(Postgres, hidden);

pub enum Authentication {
    Ok,
    ClearTextPassword,
    MD5Password { salt: [u8; 4] },
    KerberosV5,
    SCMCredential,
    GSS,
    GSSContinue { data: Data },
    SSPI,
    SASL,
    SASLContinue(SASLContinue),
    SASLFinal { data: Data },
    Unknown,
}

pub struct SASLContinue {
    pub data: Data,
    // r/s/i are sub-slices borrowed from `data.slice()` (self-referential).
    // `RawSlice` encapsulates the back-reference invariant: the backing `data`
    // buffer outlives every `SASLContinue` (it is a sibling field), so the safe
    // `.slice()` projection is sound for `'_` of any `&SASLContinue`.
    pub r: RawSlice<u8>,
    pub s: RawSlice<u8>,
    pub i: RawSlice<u8>,
}

impl SASLContinue {
    pub fn iteration_count(&self) -> Result<u32, bun_core::Error> {
        bun_core::fmt::parse_int(self.i.slice(), 10).map_err(|_| bun_core::err!("InvalidCharacter"))
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
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
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
                let salt: [u8; 4] = salt_data.slice()[0..4].try_into().expect("unreachable");
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
                let bytes = reader.read((message_length - 8) as usize)?;
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
                reader.skip((message_length - 8) as usize)?;
                Ok(Authentication::SASL)
            }

            11 => {
                if message_length < 9 {
                    return Err(bun_core::err!("InvalidMessageLength"));
                }
                let bytes = reader.bytes((message_length - 8) as usize)?;
                // errdefer { bytes.deinit(); } — `Data: Drop` frees on `?` early-return.

                let mut r: Option<RawSlice<u8>> = None;
                let mut i: Option<RawSlice<u8>> = None;
                let mut s: Option<RawSlice<u8>> = None;

                {
                    // `RawSlice::new` erases the borrowck lifetime so the captured
                    // sub-slices don't keep `bytes` borrowed past this block (they
                    // remain valid because `bytes` is moved into the result below).
                    let mut iter = bun_core::split(bytes.slice(), b",");
                    while let Some(item) = iter.next() {
                        if item.len() > 2 {
                            let key = item[0];
                            let after_equals = RawSlice::new(&item[2..]);
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
                    bun_core::scoped_log!(Postgres, "Missing r");
                }

                if s.is_none() {
                    bun_core::scoped_log!(Postgres, "Missing s");
                }

                if i.is_none() {
                    bun_core::scoped_log!(Postgres, "Missing i");
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

    // Zig `DecoderWrap(@This(), ...)` — see src/sql/postgres/protocol/DecoderWrap.rs
    pub fn decode<Container: super::new_reader::ReaderContext>(
        context: Container,
    ) -> Result<Self, bun_core::Error> {
        Self::decode_internal(&mut NewReader { wrapped: context })
    }
}

// ported from: src/sql/postgres/protocol/Authentication.zig

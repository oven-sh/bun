use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

bun_core::declare_scope!(Postgres, hidden);

pub enum Authentication<'a> {
    Ok,
    ClearTextPassword,
    MD5Password { salt: [u8; 4] },
    KerberosV5,
    GSS,
    GSSContinue { data: &'a [u8] },
    SSPI,
    SASL(SASLMechanisms),
    SASLContinue(SASLContinue<'a>),
    SASLFinal { data: &'a [u8] },
    Unknown,
}

#[derive(Copy, Clone, Default)]
pub struct SASLMechanisms {
    pub scram_sha_256: bool,
    pub scram_sha_256_plus: bool,
}

pub struct SASLContinue<'a> {
    pub r: &'a [u8],
    pub s: &'a [u8],
    pub i: &'a [u8],
}

impl SASLContinue<'_> {
    pub fn iteration_count(&self) -> crate::Result<u32> {
        bun_core::fmt::parse_int(self.i, 10).map_err(|_| crate::Error::InvalidCharacter)
    }
}

impl<'a> Authentication<'a> {
    pub fn decode_internal(reader: &NewReader<'a>) -> Result<Self, AnyPostgresError> {
        let message_length = reader.length()?;

        match reader.int4()? {
            0 => {
                if message_length != 8 {
                    return Err(AnyPostgresError::InvalidMessageLength);
                }
                Ok(Authentication::Ok)
            }
            2 => {
                if message_length != 8 {
                    return Err(AnyPostgresError::InvalidMessageLength);
                }
                Ok(Authentication::KerberosV5)
            }
            3 => {
                if message_length != 8 {
                    return Err(AnyPostgresError::InvalidMessageLength);
                }
                Ok(Authentication::ClearTextPassword)
            }
            5 => {
                if message_length != 12 {
                    return Err(AnyPostgresError::InvalidMessageLength);
                }
                let salt_data = reader.bytes(4)?;
                let salt: [u8; 4] = salt_data[0..4].try_into().expect("unreachable");
                Ok(Authentication::MD5Password { salt })
            }
            7 => {
                if message_length != 8 {
                    return Err(AnyPostgresError::InvalidMessageLength);
                }
                Ok(Authentication::GSS)
            }

            8 => {
                if message_length < 9 {
                    return Err(AnyPostgresError::InvalidMessageLength);
                }
                let bytes = reader.read((message_length - 8) as usize)?;
                Ok(Authentication::GSSContinue { data: bytes })
            }
            9 => {
                if message_length != 8 {
                    return Err(AnyPostgresError::InvalidMessageLength);
                }
                Ok(Authentication::SSPI)
            }

            10 => {
                if message_length < 9 {
                    return Err(AnyPostgresError::InvalidMessageLength);
                }
                // A NUL-terminated name per mechanism, then one more NUL.
                let names = reader.bytes((message_length - 8) as usize)?;
                let mut mechanisms = SASLMechanisms::default();
                for name in bun_core::split(names, b"\0") {
                    match name {
                        b"SCRAM-SHA-256" => mechanisms.scram_sha_256 = true,
                        b"SCRAM-SHA-256-PLUS" => mechanisms.scram_sha_256_plus = true,
                        _ => {}
                    }
                }
                Ok(Authentication::SASL(mechanisms))
            }

            11 => {
                if message_length < 9 {
                    return Err(AnyPostgresError::InvalidMessageLength);
                }
                let bytes = reader.bytes((message_length - 8) as usize)?;

                let (mut r, mut s, mut i) = (None, None, None);
                for item in bun_core::split(bytes, b",") {
                    // RFC 5802 §5.1: a mandatory extension, and this client knows none.
                    if item.starts_with(b"m=") {
                        return Err(AnyPostgresError::InvalidMessage);
                    }
                    if item.len() > 2 {
                        let after_equals = Some(&item[2..]);
                        match item[0] {
                            b'r' => r = after_equals,
                            b's' => s = after_equals,
                            b'i' => i = after_equals,
                            _ => {}
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

                let r = r.ok_or(AnyPostgresError::InvalidMessage)?;
                let s = s.ok_or(AnyPostgresError::InvalidMessage)?;
                let i = i.ok_or(AnyPostgresError::InvalidMessage)?;

                Ok(Authentication::SASLContinue(SASLContinue { r, s, i }))
            }

            12 => {
                if message_length < 9 {
                    return Err(AnyPostgresError::InvalidMessageLength);
                }
                let remaining: usize = (message_length - 8) as usize;

                let bytes = reader.read(remaining)?;
                Ok(Authentication::SASLFinal { data: bytes })
            }

            _ => Ok(Authentication::Unknown),
        }
    }
}

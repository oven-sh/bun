use crate::mysql::protocol::auth::{self, Nonce};
use crate::mysql::protocol::new_writer::{NewWriter, WriterContext};

// MySQL authentication methods
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AuthMethod {
    MysqlNativePassword,
    CachingSha2Password,
    Sha256Password,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Transport {
    Tcp,
    UnixSocket,
    Tls,
}

pub enum AuthResponse<'a> {
    Scramble(&'a [u8]),
    Password(&'a [u8]),
    /// The server answers with its RSA key, `EncryptedPassword` answers that.
    PublicKeyRequest(u8),
}

impl AuthResponse<'_> {
    pub(crate) fn len(&self) -> usize {
        match self {
            AuthResponse::Scramble(scramble) => scramble.len(),
            AuthResponse::Password(password) => password.len() + 1,
            AuthResponse::PublicKeyRequest(_) => 1,
        }
    }

    pub fn write<C: WriterContext>(&self, writer: NewWriter<C>) -> crate::Result<()> {
        match *self {
            AuthResponse::Scramble(scramble) => writer.write(scramble)?,
            AuthResponse::Password(password) => {
                writer.write(password)?;
                writer.int1(0)?;
            }
            AuthResponse::PublicKeyRequest(request) => writer.int1(request)?,
        }
        Ok(())
    }
}

impl AuthMethod {
    pub fn first_response<'a>(
        self,
        password: &'a [u8],
        nonce: &Nonce,
        transport: Transport,
        buf: &'a mut [u8; 32],
    ) -> AuthResponse<'a> {
        if self == AuthMethod::Sha256Password {
            return self.full_authentication(password, transport);
        }
        if password.is_empty() {
            return AuthResponse::Scramble(&[]);
        }
        if self == AuthMethod::MysqlNativePassword {
            let scramble = auth::mysql_native_password::scramble(password, nonce);
            buf[..scramble.len()].copy_from_slice(&scramble);
            return AuthResponse::Scramble(&buf[..scramble.len()]);
        }
        *buf = auth::caching_sha2_password::scramble(password, nonce);
        AuthResponse::Scramble(&buf[..])
    }

    /// The server has no cached hash to check a scramble against: it needs the password.
    pub fn full_authentication(self, password: &[u8], transport: Transport) -> AuthResponse<'_> {
        if password.is_empty() || self.reads_password_in_clear(transport) {
            return AuthResponse::Password(password);
        }
        AuthResponse::PublicKeyRequest(if self == AuthMethod::Sha256Password {
            0x01
        } else {
            0x02
        })
    }

    /// The server decides by the transport how it reads the next packet; the client has to agree.
    fn reads_password_in_clear(self, transport: Transport) -> bool {
        match self {
            AuthMethod::MysqlNativePassword => false,
            AuthMethod::CachingSha2Password => transport != Transport::Tcp,
            AuthMethod::Sha256Password => transport == Transport::Tls,
        }
    }

    pub fn name(self) -> &'static [u8] {
        match self {
            AuthMethod::MysqlNativePassword => b"mysql_native_password",
            AuthMethod::CachingSha2Password => b"caching_sha2_password",
            AuthMethod::Sha256Password => b"sha256_password",
        }
    }

    pub fn from_string(s: &[u8]) -> Option<AuthMethod> {
        MAP.get(s).copied()
    }
}

bun_core::comptime_string_map! {
    /// Keys are exactly the wire-protocol plugin names.
    static MAP: AuthMethod = {
        b"mysql_native_password" => AuthMethod::MysqlNativePassword,
        b"caching_sha2_password" => AuthMethod::CachingSha2Password,
        b"sha256_password" => AuthMethod::Sha256Password,
    };
}

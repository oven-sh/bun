use crate::mysql::protocol::auth;

// MySQL authentication methods
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AuthMethod {
    MysqlNativePassword,
    CachingSha2Password,
    Sha256Password,
}

impl AuthMethod {
    pub fn scramble<'a>(
        self,
        password: &[u8],
        auth_data: &[u8],
        buf: &'a mut [u8; 32],
    ) -> Result<&'a mut [u8], bun_core::Error> {
        // TODO(port): narrow error set
        if password.is_empty() {
            return Ok(&mut []);
        }

        let len = self.scramble_length();

        match self {
            AuthMethod::MysqlNativePassword => {
                buf[..len].copy_from_slice(&auth::mysql_native_password::scramble(password, auth_data)?);
            }
            AuthMethod::CachingSha2Password => {
                buf[..len].copy_from_slice(&auth::caching_sha2_password::scramble(password, auth_data)?);
            }
            AuthMethod::Sha256Password => {
                buf[..len].copy_from_slice(&auth::caching_sha2_password::scramble(password, auth_data)?);
            }
        }

        Ok(&mut buf[..len])
    }

    pub fn scramble_length(self) -> usize {
        match self {
            AuthMethod::MysqlNativePassword => 20,
            AuthMethod::CachingSha2Password => 32,
            AuthMethod::Sha256Password => 32,
        }
    }

    pub fn from_string(s: &[u8]) -> Option<AuthMethod> {
        MAP.get(s).copied()
    }
}

// bun.ComptimeEnumMap(AuthMethod) — keys are exactly the Zig @tagName variant names
static MAP: phf::Map<&'static [u8], AuthMethod> = phf::phf_map! {
    b"mysql_native_password" => AuthMethod::MysqlNativePassword,
    b"caching_sha2_password" => AuthMethod::CachingSha2Password,
    b"sha256_password" => AuthMethod::Sha256Password,
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/AuthMethod.zig (37 lines)
//   confidence: high
//   todos:      1
//   notes:      auth::* scramble fns assumed to return fixed-size arrays; borrowck may need reshaping for buf double-borrow in scramble()
// ──────────────────────────────────────────────────────────────────────────

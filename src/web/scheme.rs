//! The schemes that the app has registered.

use bun_threading::RwLock;

use crate::Bytes;

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub struct Privileges: u8 {
        const STANDARD = 1;
        const SECURE = 1 << 1;
        const BYPASS_CSP = 1 << 2;
        const ALLOW_SERVICE_WORKERS = 1 << 3;
        const SUPPORT_FETCH_API = 1 << 4;
        const CORS_ENABLED = 1 << 5;
        const STREAM = 1 << 6;
        const CODE_CACHE = 1 << 7;
    }
}

static SCHEMES: RwLock<Vec<(Bytes, Privileges)>> = RwLock::new(Vec::new());

pub fn register(scheme: &[u8], privileges: Privileges) {
    let mut schemes = SCHEMES.write();
    schemes.retain(|it| *it.0 != *scheme);
    schemes.push((scheme.into(), privileges));
}

pub fn registered() -> Vec<(Bytes, Privileges)> {
    SCHEMES.read().clone()
}

pub fn privileges_of(scheme: &[u8]) -> Privileges {
    SCHEMES
        .read()
        .iter()
        .find(|it| *it.0 == *scheme)
        .map_or_else(Privileges::empty, |it| it.1)
}

pub fn is_standard(scheme: &[u8]) -> bool {
    privileges_of(scheme).contains(Privileges::STANDARD)
}

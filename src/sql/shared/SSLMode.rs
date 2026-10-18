/// `normalizeSSLMode` in src/js/internal/sql/options.ts maps what each driver accepts to these.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SSLMode {
    Disable = 0,
    Prefer = 1,
    Require = 2,
    VerifyCa = 3,
    VerifyFull = 4,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SSLMode {
    Disable = 0,
    Prefer = 1,
    Require = 2,
    VerifyCa = 3,
    VerifyFull = 4,
}

// ported from: src/sql/mysql/SSLMode.zig

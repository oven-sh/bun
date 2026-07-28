// Hand-ported subset of `analytics::*` needed by lib.rs (OperatingSystem,
// Architecture, Platform). The full encode/decode machinery and the rest of
// the schema (EventKind, EventListHeader, …) are unused at runtime today and
// will be filled in by the peechy regen.
pub mod analytics {
    // Closed enum: the schema decoder is the only producer of unknown
    // discriminants and it is not yet implemented.
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum OperatingSystem {
        None = 0,
        /// linux
        Linux,
        /// macos
        Macos,
        /// windows
        Windows,
        /// wsl
        Wsl,
        /// android
        Android,
        /// freebsd
        Freebsd,
    }

    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum Architecture {
        None = 0,
        /// x64
        X64,
        /// arm
        Arm,
    }

    #[derive(Copy, Clone)]
    pub struct Platform {
        /// os
        pub os: OperatingSystem,
        /// arch
        pub arch: Architecture,
        /// version
        pub version: &'static [u8],
    }
}

//! The text of `os.version()`.

const FIRST_BUILD_OF_WINDOWS_11: u32 = 22000;

/// `name` is `ProductName` in the registry, which Windows 11 did not change.
pub(crate) fn describe(mut name: Vec<u8>, major: u32, build: u32, service_pack: &[u8]) -> Vec<u8> {
    if major == 10 && build >= FIRST_BUILD_OF_WINDOWS_11 && name.starts_with(b"Windows 10") {
        name["Windows 1".len()] = b'1';
    }
    if !name.is_empty() && !service_pack.is_empty() {
        name.push(b' ');
    }
    name.extend_from_slice(service_pack);
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_version_that_runs() {
        for (name, major, build, service_pack, expected) in [
            ("Windows 10 Pro", 10, 17763, "", "Windows 10 Pro"),
            ("Windows 10 Pro", 10, 21999, "", "Windows 10 Pro"),
            ("Windows 10 Pro", 10, 22000, "", "Windows 11 Pro"),
            ("Windows 10", 10, 26300, "", "Windows 11"),
            ("Windows 10 Pro", 11, 26300, "", "Windows 10 Pro"),
            ("Windows 1", 10, 26300, "", "Windows 1"),
            ("Windows Server 2025", 10, 26100, "", "Windows Server 2025"),
            ("Windows 7", 6, 7601, "SP 1", "Windows 7 SP 1"),
            ("", 6, 7601, "SP 1", "SP 1"),
            ("", 10, 26300, "", ""),
        ] {
            let found = describe(name.into(), major, build, service_pack.as_bytes());
            assert_eq!(found, expected.as_bytes());
        }
    }
}

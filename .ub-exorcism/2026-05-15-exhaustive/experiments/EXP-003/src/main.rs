// EXP-003: Meta::has_install_script enum read directly from lockfile disk bytes (PUB-INSTALL-1)
// Mirror of src/install/lockfile/Package/Meta.rs:38-46 in Bun.

#[repr(u8)]
#[allow(dead_code)]
enum HasInstallScript {
    Old = 0,
    False = 1,
    True = 2,
}

fn read_from_lockfile_bytes(bytes: &[u8]) -> HasInstallScript {
    // mmap-backed lockfile bytes flow into this read; attacker controls bytes.
    unsafe { std::ptr::read(bytes.as_ptr() as *const HasInstallScript) }
}

fn main() {
    let attacker_bytes = [0x2au8; 1]; // 0x2a is outside 0..=2
    let v = read_from_lockfile_bytes(&attacker_bytes);
    let _tag = v as u8; // UB: invalid enum tag
}

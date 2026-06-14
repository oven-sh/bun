#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
enum Origin {
    Local = 0,
    Npm = 1,
    Tarball = 2,
}

fn read_from_lockfile_bytes(bytes: &[u8]) -> Origin {
    // Mirrors Package::load_fields copying attacker-controlled lockfile bytes
    // into the Meta column, then later reading Meta::origin as a repr(u8) enum.
    unsafe { core::ptr::read(bytes.as_ptr().cast::<Origin>()) }
}

fn main() {
    let attacker_bytes = [0x2a_u8; 1];
    let origin = read_from_lockfile_bytes(&attacker_bytes);
    let _ = origin == Origin::Npm;
}

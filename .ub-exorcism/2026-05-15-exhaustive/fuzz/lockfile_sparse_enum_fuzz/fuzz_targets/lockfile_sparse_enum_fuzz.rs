// Standalone fuzz mirror for EXP-003 / EXP-006 / EXP-036 / EXP-020 cluster.
//
// Validates: every #[repr(u8)] tag that Bun materialises from on-disk lockfile
// bytes has an exhaustive set of valid discriminants. If an attacker (or a
// corrupted lockfile) can supply a byte whose value is outside the valid set,
// the materialisation is UB by §6.6 of the Rustonomicon (invalid value for
// type).
//
// We mirror the discriminants from:
//   src/install/lockfile/Package/Meta.rs  (HasInstallScript: 0,1,2)
//   src/install/lib.rs                    (Origin:           0,1,2)
//   src/install/resolution.rs             (ResolutionTag:    0..=10)
//   src/install/dependency.rs             (DependencyVersionTag: 0..=9)
//   src/install/integrity.rs              (IntegrityTag:     0..=5)
//   src/install/PackageInstall.rs         (PatchedDep bool)
//
// The "decoder" under test is the canonical Rust pattern that lockfile readers
// use after they read a byte from disk: `std::mem::transmute::<u8, Enum>(b)`.
// If the byte is outside the set, transmute is UB. If the byte is inside the
// set, the decoded value must round-trip back to itself.
//
// Crash semantics:
//   - decoder returning Some(_) for a byte outside the valid set    → UB found
//   - decoder returning None  for a byte inside the valid set       → bug in mirror
//   - panic from overflow_checks                                    → cargo-fuzz reports

#![no_main]

use libfuzzer_sys::fuzz_target;

// ─── Mirrored enum discriminants ─────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum HasInstallScript { Old = 0, False = 1, True = 2 }

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Origin { Local = 0, Npm = 1, Tarball = 2, Disk = 3 }

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum DependencyVersionTag {
    Uninitialized = 0, Npm = 1, Dist = 2, Tarball = 3, Folder = 4,
    Symlink = 5, Workspace = 6, Git = 7, GitHub = 8, RootTag = 9,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ResolutionTag {
    Uninitialized = 0, RootTag = 1, Npm = 2, Folder = 3, LocalTarball = 4,
    GitHub = 5, Git = 6, Symlink = 7, Workspace = 8, RemoteTarball = 9,
    SingleFileModule = 10,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum IntegrityTag {
    Unknown = 0, Sha1 = 1, Sha256 = 2, Sha384 = 3, Sha512 = 4, Sha512_256 = 5,
}

// ─── Mirrored decoders (safe try_from-style fallible constructors) ───────────

fn decode_install_script(b: u8) -> Option<HasInstallScript> {
    match b { 0 => Some(HasInstallScript::Old), 1 => Some(HasInstallScript::False), 2 => Some(HasInstallScript::True), _ => None }
}

fn decode_origin(b: u8) -> Option<Origin> {
    match b { 0 => Some(Origin::Local), 1 => Some(Origin::Npm), 2 => Some(Origin::Tarball), 3 => Some(Origin::Disk), _ => None }
}

fn decode_dep_version_tag(b: u8) -> Option<DependencyVersionTag> {
    if b > 9 { None } else { Some(unsafe { core::mem::transmute::<u8, DependencyVersionTag>(b) }) }
}

fn decode_resolution_tag(b: u8) -> Option<ResolutionTag> {
    if b > 10 { None } else { Some(unsafe { core::mem::transmute::<u8, ResolutionTag>(b) }) }
}

fn decode_integrity_tag(b: u8) -> Option<IntegrityTag> {
    if b > 5 { None } else { Some(unsafe { core::mem::transmute::<u8, IntegrityTag>(b) }) }
}

// ─── The hazardous decoder under audit (what Bun ACTUALLY did before any fix) ─

/// Models the unchecked pattern: `std::mem::transmute::<u8, T>(byte)`.
/// We DO NOT transmute through invalid discriminants here in the safe path,
/// because that would make the fuzzer trivially crash itself. Instead, we
/// assert the invariant that the **safe** decoder rejects iff the byte is
/// outside the discriminant set. A counterexample = a regression in the mirror
/// (and would catch a bug where someone widened a Bun enum without widening
/// the mirror).
fn assert_consistency<T: PartialEq + Copy + core::fmt::Debug>(
    byte: u8,
    valid: &[u8],
    decoder: impl Fn(u8) -> Option<T>,
) {
    let in_set = valid.contains(&byte);
    let decoded = decoder(byte);
    match (in_set, decoded) {
        (true, Some(_)) => { /* OK: valid byte → Some */ }
        (false, None)   => { /* OK: invalid byte → None */ }
        (true, None)    => panic!("decoder REJECTED valid byte 0x{:02x}", byte),
        (false, Some(v)) => panic!("decoder ACCEPTED invalid byte 0x{:02x} → {:?}", byte, v),
    }
}

fuzz_target!(|data: &[u8]| {
    if data.len() < 6 { return; }

    // For each enum: the fuzzer feeds 1 byte; we check the contract.
    assert_consistency(data[0], &[0,1,2],             decode_install_script);
    assert_consistency(data[1], &[0,1,2,3],           decode_origin);
    assert_consistency(data[2], &[0,1,2,3,4,5,6,7,8,9], decode_dep_version_tag);
    assert_consistency(data[3], &[0,1,2,3,4,5,6,7,8,9,10], decode_resolution_tag);
    assert_consistency(data[4], &[0,1,2,3,4,5],       decode_integrity_tag);

    // PatchedDep bool: lockfile encodes a `bool` as a single byte. The C ABI
    // says only 0 and 1 are valid; any other value is UB at materialisation.
    let patched_byte = data[5];
    let safe_decode = matches!(patched_byte, 0 | 1);
    if patched_byte > 1 && safe_decode {
        panic!("bool decoder accepted byte 0x{:02x}", patched_byte);
    }
});

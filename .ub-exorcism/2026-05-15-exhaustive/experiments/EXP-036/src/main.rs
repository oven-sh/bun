//! EXP-036: Mirrors `src/install/lockfile.rs::PatchedDep` (declares
//! `pub patchfile_hash_is_null: bool`) read via `Buffers::read_array<T: Copy>`
//! in `src/install/lockfile/bun.lockb.rs:590`, which uses
//! `bun_core::ffi::slice(stream.buffer.as_ptr().add(start_pos).cast::<T>(), n)`
//! followed by `.to_vec()` over attacker-controlled bytes from `bun.lockb`.
//!
//! Rust's `bool` validity is `{0, 1}`; bytes `2..=255` at the
//! `patchfile_hash_is_null` offset are immediate validity UB on read.
//!
//! Expected Miri signal: `constructing invalid value at [0].patchfile_hash_is_null,
//! encountered 0xff, but expected a boolean`.

#[derive(Copy, Clone)]
#[repr(C)]
struct PatchedDep {
    // Matches the validity-bearing field at lockfile.rs:3375.
    patchfile_hash_is_null: bool,
    // The real struct has additional fields; padding here approximates
    // the on-disk layout without introducing further validity-bearing
    // niches that would mask the witness.
    _padding: [u8; 7],
}

fn read_array<T: Copy>(bytes: &[u8], n: usize) -> Vec<T> {
    // Mirrors `Buffers::read_array` shape: cast the disk buffer pointer to
    // `*const T`, materialize a `&[T]` view, then `.to_vec()`.
    let view: &[T] = unsafe {
        core::slice::from_raw_parts(bytes.as_ptr().cast::<T>(), n)
    };
    view.to_vec()
}

fn main() {
    // Crafted "lockfile" buffer: bool byte = 0xff (invalid).
    let tampered: [u8; 8] = [0xff, 0, 0, 0, 0, 0, 0, 0];

    let v: Vec<PatchedDep> = read_array(&tampered, 1);

    // Field read is UB-adjacent; in practice the materialization itself
    // is sufficient, but exercise the field too to make the witness robust
    // against differences in when validity is checked.
    let flag = v[0].patchfile_hash_is_null;
    // Print to defeat dead-code elimination.
    println!("flag = {}", flag);
}

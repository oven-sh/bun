// EXP-034: install/migration.rs:1492-1493 set_len-over-cursor — same shape as
// EXP-005 (yarn.rs Dependency uninit slice), but in the npm package-lock.json
// migration path.
//
// Mirrors src/install/migration.rs:1487-1518:
//
//     // SAFETY: res_cursor elements written above into reserved capacity
//     unsafe {
//         this.buffers.resolutions.set_len(res_cursor);
//         this.buffers.dependencies.set_len(res_cursor);
//     }
//
// The populate loop above (`'dep_loop`) contains multiple `continue 'dep_loop`
// shortcuts. If any path bumps `deps_cursor` (or the resolution cursor)
// independently of the other, `set_len(res_cursor)` covers slots that were
// never actually written. We then read a field with a validity invariant
// (`DependencyVersionTag` is `#[repr(u8)]` with only 10 valid tags out of 256),
// and Miri's validity check fires.
//
// We reproduce this with a `Dependency`-equivalent struct that owns:
//   * `NonZeroU32` ids (matching the lockfile `Semver.String` handles)
//   * a `DependencyVersionTag`-shaped `#[repr(u8)]` enum (10/256 valid)
//
// Expected Miri output: "constructing invalid value at .version_tag, encountered
// 0xXX, but expected a valid enum tag" or "reading uninitialized memory".

use std::num::NonZeroU32;

// Mirror of `bun_install_types::DependencyVersionTag` — `#[repr(u8)]` with
// only variants 0..=9 valid. Reading any other byte through this type is
// validity UB.
#[repr(u8)]
#[allow(dead_code)]
#[derive(Clone, Copy)]
enum DependencyVersionTag {
    Uninitialized = 0,
    Npm = 1,
    DistTag = 2,
    Tarball = 3,
    Folder = 4,
    Symlink = 5,
    Workspace = 6,
    Git = 7,
    Github = 8,
    Catalog = 9,
}

// Dependency-shape: NonZeroU32 ids plus the validity-bearing tag, matching
// the lockfile `Dependency` struct layout that migration.rs writes into.
#[allow(dead_code)]
struct Dependency {
    name_id: NonZeroU32,
    version_id: NonZeroU32,
    version_tag: DependencyVersionTag,
}

/// Mirror of the migration.rs populate-and-set_len shape. We "write" only
/// some slots (simulating a `continue 'dep_loop` that bumped deps_cursor
/// without writing into this row) and then `set_len` to the higher cursor.
fn migrate_set_len_shape() -> Vec<Dependency> {
    let cap = 4;
    let mut deps: Vec<Dependency> = Vec::with_capacity(cap);

    // Simulate the populate loop:
    //   - row 0: skipped by `continue 'dep_loop` before write (uninit)
    //   - rows 1..4: also skipped (this is the EXP-005-shape: every slot uninit)
    //
    // The bug is that `set_len(res_cursor)` is reached even when not every
    // index 0..res_cursor was written. We force the maximally bad shape:
    // no writes at all, then `set_len(cap)`.

    // SAFETY (matching the unsound site): res_cursor elements written above
    // into reserved capacity — IN THE REAL CODE THIS IS A LIE on
    // continue-loop shortcuts.
    unsafe {
        deps.set_len(cap);
    }
    deps
}

fn main() {
    let deps = migrate_set_len_shape();

    // Mirror the debug_assertions block that iterates the buffer and reads
    // the Behavior / tag field. The release path also reads `dep.version.tag`
    // a few lines later when computing resolution graph edges — so this UB
    // is reachable in release too.
    //
    // The validity invariant of DependencyVersionTag fires here: any non-0..=9
    // byte is an invalid enum tag, and uninit memory is also forbidden.
    let tag_byte: u8 = unsafe {
        // Match the implicit read the debug-assert loop performs via
        // `dep.version.tag`. We read through the struct field, exactly as
        // the production code would.
        let dep0 = &deps[0];
        // Reading the enum field materialises a `DependencyVersionTag`,
        // which is the validity-UB step.
        let tag: DependencyVersionTag = std::ptr::read(&dep0.version_tag);
        tag as u8
    };

    // Use the byte so the read isn't dead-code-eliminated.
    println!("first dep tag byte = {tag_byte}");

    // Leak the Vec to avoid running Drop over uninit slots (would also UB).
    std::mem::forget(deps);
}

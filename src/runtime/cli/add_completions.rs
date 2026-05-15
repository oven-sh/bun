// GENERATED: re-run `bun misctools/generate-add-completions.ts` with .rs output
// (source src/cli/add_completions.zig is auto-generated; do not hand-port the
// compressed_data blob, FirstLetter/Index tables, or init/getPackages — update the generator.)

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum FirstLetter {
    A = b'a',
    B = b'b',
    C = b'c',
    D = b'd',
    E = b'e',
    F = b'f',
    G = b'g',
    H = b'h',
    I = b'i',
    J = b'j',
    K = b'k',
    L = b'l',
    M = b'm',
    N = b'n',
    O = b'o',
    P = b'p',
    Q = b'q',
    R = b'r',
    S = b's',
    T = b't',
    U = b'u',
    V = b'v',
    W = b'w',
    X = b'x',
    Y = b'y',
    Z = b'z',
}

/// Largest per-letter package list length (Zig: `pub const biggest_list`).
pub const BIGGEST_LIST: usize = 1034;

/// Decompress the package-name table. The compressed blob and Index table are
/// emitted by the generator; until that runs for Rust, this is a no-op.
pub fn init() {}

/// Returns the slice of package names beginning with `letter`.
pub fn get_packages(_letter: FirstLetter) -> &'static [&'static [u8]] {
    // Populated by the generator (see file header). Empty until generated.
    &[]
}

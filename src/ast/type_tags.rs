//! What the whole-program analysis of `bun build --compile --aot` found, as the bundler passes it on.

pub struct ProgramFacts {
    /// The program, compiled from its types as far as the code generator of the engine: it runs in the place of the entry point.
    pub typed: Option<Box<[u8]>>,
    /// The paths of the entry points that `typed` has an entry function for, in the order of those.
    pub entry_points: Box<[Box<[u8]>]>,
}

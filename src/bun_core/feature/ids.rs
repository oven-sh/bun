// The features. The first is feature 1, which is bit 0 where a set of them is a number. `bun_core_macros` compiles this file
// too, and Bun's build reads it (scripts/build/rust/features.ts).
pub(crate) const NAMES: [&str; 3] = ["check", "lint", "fmt"];

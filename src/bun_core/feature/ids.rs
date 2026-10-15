// The features. The first is feature 1. `bun_core_macros` compiles this file too, and Bun's build reads it
// (scripts/build/rust/features.ts).
pub(crate) const NAMES: [&str; 5] = ["check", "lint", "fmt", "semver", "csrf"];

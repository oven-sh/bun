#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
// `Transpiler` is implemented in
// `bun_bundler::transpiler` because it shares the bundler's
// resolver/options/cache plumbing. This crate re-exports it under the
// `bun_transpiler` name so install/CLI tiers don't have to depend on
// `bun_bundler` directly.
pub use bun_bundler::Error;
pub use bun_bundler::transpiler::Transpiler;

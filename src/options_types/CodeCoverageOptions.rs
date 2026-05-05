//! `bun test --coverage` option struct, extracted from `cli/test_command.zig`
//! so `options_types/Context.zig` (and `cli/cli.zig` `TestOptions`) can hold
//! it without depending on `cli/`.

// move-in: TYPE_ONLY from bun_sourcemap_jsc::CodeCoverage (`sourcemap_jsc/CodeCoverage.zig` `Fraction`).
// Lifted here so the option struct (and CLI tier) needn't depend on tier-6 sourcemap_jsc.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Fraction {
    pub functions: f64,
    pub lines: f64,
    /// This metric is less accurate right now
    pub stmts: f64,
    pub failing: bool,
}

impl Default for Fraction {
    fn default() -> Self {
        Self { functions: 0.9, lines: 0.9, stmts: 0.75, failing: false }
    }
}

pub struct CodeCoverageOptions {
    pub skip_test_files: bool,
    pub reporters: Reporters,
    // TODO(port): lifetime — CLI may populate this from argv; no deinit in Zig so treated as 'static
    pub reports_directory: &'static [u8],
    pub fractions: Fraction,
    pub ignore_sourcemap: bool,
    pub enabled: bool,
    pub fail_on_low_coverage: bool,
    // TODO(port): lifetime — CLI may populate this from argv; no deinit in Zig so treated as 'static
    pub ignore_patterns: &'static [&'static [u8]],
}

impl Default for CodeCoverageOptions {
    fn default() -> Self {
        Self {
            // TODO(port): Zig `!bun.Environment.allow_assert` (allow_assert = isDebug || is_canary || isTest);
            // mapped to `!cfg!(debug_assertions)` — Phase B may want a `bun_core::Environment::ALLOW_ASSERT` const.
            skip_test_files: !cfg!(debug_assertions),
            reporters: Reporters { text: true, lcov: false },
            reports_directory: b"coverage",
            fractions: Fraction::default(),
            ignore_sourcemap: false,
            enabled: false,
            fail_on_low_coverage: false,
            ignore_patterns: &[],
        }
    }
}

pub enum Reporter {
    Text,
    Lcov,
}

pub struct Reporters {
    pub text: bool,
    pub lcov: bool,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/options_types/CodeCoverageOptions.zig (26 lines)
//   confidence: high
//   todos:      3
//   notes:      slice fields use &'static (no deinit in Zig); allow_assert mapped to debug_assertions
// ──────────────────────────────────────────────────────────────────────────

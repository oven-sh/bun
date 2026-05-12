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
        Self {
            functions: 0.9,
            lines: 0.9,
            stmts: 0.75,
            failing: false,
        }
    }
}

#[derive(Clone)]
pub struct CodeCoverageOptions {
    pub skip_test_files: bool,
    pub reporters: Reporters,
    /// Zig: `[]const u8 = "coverage"` — process-lifetime in Zig (default_allocator-backed
    /// when populated from argv/bunfig); owned `Box` here so bunfig parsing can write a
    /// heap value without leaking.
    pub reports_directory: Box<[u8]>,
    pub fractions: Fraction,
    pub ignore_sourcemap: bool,
    pub enabled: bool,
    pub fail_on_low_coverage: bool,
    /// Zig: `[]const []const u8 = &.{}` — populated from CLI/bunfig.
    pub ignore_patterns: Vec<Box<[u8]>>,
}

impl Default for CodeCoverageOptions {
    fn default() -> Self {
        Self {
            // TODO(port): Zig `!bun.Environment.allow_assert` (allow_assert = isDebug || is_canary || isTest);
            // mapped to `!cfg!(debug_assertions)` — Phase B may want a `bun_core::Environment::ALLOW_ASSERT` const.
            skip_test_files: !cfg!(debug_assertions),
            reporters: Reporters {
                text: true,
                lcov: false,
            },
            reports_directory: Box::from(b"coverage" as &[u8]),
            fractions: Fraction::default(),
            ignore_sourcemap: false,
            enabled: false,
            fail_on_low_coverage: false,
            ignore_patterns: Vec::new(),
        }
    }
}

pub enum Reporter {
    Text,
    Lcov,
}

#[derive(Clone, Copy)]
pub struct Reporters {
    pub text: bool,
    pub lcov: bool,
}

// ported from: src/options_types/CodeCoverageOptions.zig

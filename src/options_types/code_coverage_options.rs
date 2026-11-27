//! `bun test --coverage` option struct, kept in `options_types/`
//! so `Context` (and the CLI `TestOptions`) can hold
//! it without depending on `cli/`.

/// From 0 to 1, or minus how many may be left uncovered. `None` is not checked.
#[derive(Copy, Clone, Default)]
pub struct Thresholds {
    pub functions: Option<f64>,
    pub lines: Option<f64>,
    pub statements: Option<f64>,
    pub branches: Option<f64>,
    pub per_file: bool,
}

#[derive(Clone)]
pub struct CodeCoverageOptions {
    pub skip_test_files: bool,
    pub reporters: Reporters,
    /// Defaults to `"coverage"`; owned `Box` so bunfig parsing can write a
    /// heap value without leaking.
    pub reports_directory: Box<[u8]>,
    pub thresholds: Thresholds,
    pub thresholds_by_pattern: Vec<(Box<[u8]>, Thresholds)>,
    pub unknown_thresholds: Vec<Box<[u8]>>,
    pub ignore_sourcemap: bool,
    pub enabled: bool,
    /// The files to report, loaded or not. Empty: those that are loaded.
    pub include_patterns: Vec<Box<[u8]>>,
    /// Populated from CLI/bunfig.
    pub ignore_patterns: Vec<Box<[u8]>>,
}

impl Default for CodeCoverageOptions {
    fn default() -> Self {
        Self {
            skip_test_files: !bun_core::env::ALLOW_ASSERT,
            reporters: Reporters {
                text: true,
                ..Reporters::default()
            },
            reports_directory: Box::from(b"coverage" as &[u8]),
            thresholds: Thresholds::default(),
            thresholds_by_pattern: Vec::new(),
            unknown_thresholds: Vec::new(),
            ignore_sourcemap: false,
            enabled: false,
            include_patterns: Vec::new(),
            ignore_patterns: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Default)]
pub struct Reporters {
    pub text: bool,
    pub lcov: bool,
    pub json: bool,
    pub json_summary: bool,
}

impl Reporters {
    /// False if there is none of that name.
    pub fn add(&mut self, name: &[u8]) -> bool {
        match name {
            b"text" => self.text = true,
            b"lcov" => self.lcov = true,
            b"json" => self.json = true,
            b"json-summary" => self.json_summary = true,
            _ => return false,
        }
        true
    }
}

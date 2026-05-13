use bun_io::Write as _;

use crate::cli::Command;
use crate::cli::test::changed_files_filter as ChangedFilesFilter;
use crate::cli::test::parallel_runner as ParallelRunner;
use crate::cli::test::scanner::{self, Scanner};
use bun_collections::{ArrayHashMap, BoundedArray, StringHashMap};
use bun_core::{self as bun, Global, Output, env_var, fmt as bun_fmt};
use bun_core::{err_generic, pretty_error, pretty_errorln};
use bun_dotenv as DotEnv;
use bun_http::HTTPThread;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc};
// `set_time_zone` / `delete_module_registry_entry` take the JSC-side
// `ZigString` (repr(C)-identical to `bun_core::ZigString`, but with the
// JSGlobalObject FFI methods); import that one so the call sites type-check.
use bun_core::ZigStringSlice;
use bun_core::immutable::Appender as _;
use bun_core::{PathString, strings};
use bun_js_parser as js_ast;
use bun_jsc::zig_string::ZigString;
use bun_options_types::code_coverage_options::{CodeCoverageOptions, Reporter, Reporters};
use bun_paths::resolve_path;
use bun_paths::string_paths::without_leading_path_separator;
use bun_paths::{self as bun_path, PathBuffer};
use bun_resolver::fs::FileSystem;
use bun_sys::{self, Fd, File};
use bun_uws as uws;

// Debug log scope for test-runner entrypoint loading (Zig: bun.jsc.Jest.bun_test.debug.group).
bun_output::declare_scope!(bun_test, hidden);

// ─── coverage façade ────────────────────────────────────────────────────────
// Thin adapter over `bun_sourcemap_jsc::code_coverage` that preserves the
// Zig-shaped call paths used in `print_code_coverage` below
// (`CodeCoverageReport::Text::writeFormat(..., enable_ansi_colors)` took a
// runtime bool in Zig; the Rust port lifted it to a const generic, so the
// adapter dispatches). Drop once the body is normalised to call
// `code_coverage::{text,lcov}` directly with `<ENABLE_ANSI_COLORS>`.
mod coverage {
    pub use bun_sourcemap_jsc::code_coverage::{
        ByteRangeMapping, ByteRangeMappingHashMap, Fraction, Report as CodeCoverageReport,
        lcov as Lcov,
    };

    /// `std.sort.pdq(..., isLessThan)` adapter — Rust `sort_by` wants `Ordering`.
    #[inline]
    pub fn is_less_than_cmp(
        a: &&mut ByteRangeMapping,
        b: &&mut ByteRangeMapping,
    ) -> core::cmp::Ordering {
        bun_core::order(a.source_url.slice(), b.source_url.slice())
    }

    #[allow(non_snake_case)]
    pub mod Text {
        use super::*;
        use bun_sourcemap_jsc::code_coverage::text;

        /// Runtime-bool → const-generic dispatch for `text::write_format`.
        #[inline]
        pub fn write_format(
            report: &CodeCoverageReport,
            max_filename_length: usize,
            fraction: &mut Fraction,
            base_path: &[u8],
            writer: &mut impl bun_io::Write,
            enable_ansi_colors: bool,
        ) -> bun_io::Result<()> {
            if enable_ansi_colors {
                text::write_format::<true>(report, max_filename_length, fraction, base_path, writer)
            } else {
                text::write_format::<false>(
                    report,
                    max_filename_length,
                    fraction,
                    base_path,
                    writer,
                )
            }
        }

        /// Runtime-bool → const-generic dispatch for `text::write_format_with_values`.
        #[inline]
        pub fn write_format_with_values(
            filename: &[u8],
            max_filename_length: usize,
            vals: Fraction,
            failing: Fraction,
            failed: bool,
            writer: &mut impl bun_io::Write,
            indent_name: bool,
            enable_ansi_colors: bool,
        ) -> bun_io::Result<()> {
            if enable_ansi_colors {
                text::write_format_with_values::<true>(
                    filename,
                    max_filename_length,
                    vals,
                    failing,
                    failed,
                    writer,
                    indent_name,
                )
            } else {
                text::write_format_with_values::<false>(
                    filename,
                    max_filename_length,
                    vals,
                    failing,
                    failed,
                    writer,
                    indent_name,
                )
            }
        }
    }
}
use coverage::{ByteRangeMapping, CodeCoverageReport, Fraction};

// ─── un-gate: map Phase-A draft paths onto the now-real test_runner crate ────
// The Phase-A body was written against `bun_jsc::jest::{bun_test, Snapshots,
// TestRunner}` before `crate::test_runner` existed. Those types now live under
// `crate::test_runner::*`; the façade below adapts the body's nested-path
// usage (`bun_test::Execution::Result`, `bun_test::BasicResult`, …) without a
// 2k-line body rewrite.
use crate::test_runner::bun_test as bun_test_mod;
use crate::test_runner::jest::{self, FileColumns as _, FileId, Summary, TestRunner};
use crate::test_runner::snapshot::{self, InlineSnapshotToWrite, Snapshots};

/// Re-export for `bunfig.rs` (`crate::test_command::CoverageReporters { .. }`).
pub use bun_options_types::code_coverage_options::Reporters as CoverageReporters;

#[allow(non_snake_case)]
mod bun_test {
    //! Façade over `crate::test_runner` that preserves the Zig-shaped paths
    //! the body uses (`bun_test::Execution::Result`, `bun_test::BasicResult`,
    //! `bun_test::DescribeScope`, …). Drop once the body is normalised.
    /// Zig nests `FirstLast` under `BunTestRoot`; the Rust port hoisted it to
    /// module scope. Alias here so `bun_test::FirstLast` paths in
    /// the body resolve without a 2k-line rewrite. Phase B may collapse the
    /// alias back into an inherent associated type once the body is normalised.
    pub use crate::test_runner::bun_test::FirstLast as BunTestRootFirstLast;
    /// `add_result()` queue payload — Zig spells it `bun_test.ResultMsg.start`;
    /// Rust port collapsed it into `RefDataValue`.
    pub use crate::test_runner::bun_test::RefDataValue as ResultMsg;
    pub use crate::test_runner::bun_test::*;
    pub use crate::test_runner::execution::{
        Basic as BasicResult, ExpectAssertions, PendingIs as PendingMode,
    };
    #[allow(non_snake_case)]
    pub mod Execution {
        pub use crate::test_runner::execution::*;
    }
}

// TODO(port): module-level static `var path_buf: bun.PathBuffer = undefined;` — these are
// process-wide mutable buffers. PORTING.md §Global mutable state: single-thread
// CLI scratch → RacyCell. Currently unused (Zig parity placeholders).
#[allow(dead_code)]
static PATH_BUF: bun_core::RacyCell<PathBuffer> = bun_core::RacyCell::new(PathBuffer::ZEROED);
#[allow(dead_code)]
static PATH_BUF2: bun_core::RacyCell<PathBuffer> = bun_core::RacyCell::new(PathBuffer::ZEROED);

pub fn escape_xml(str_: &[u8], writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let mut last: usize = 0;
    let mut i: usize = 0;
    let len = str_.len();
    while i < len {
        let c = str_[i];
        match c {
            b'&' | b'<' | b'>' | b'"' | b'\'' => {
                if i > last {
                    writer.write_all(&str_[last..i])?;
                }
                writer.write_all(bun_core::strings::xml_escape_entity(c).unwrap())?;
                last = i + 1;
            }
            0..=0x1f => {
                // Escape all control characters
                write!(writer, "&#{};", c)?;
            }
            _ => {}
        }
        i += 1;
    }
    if len > last {
        writer.write_all(&str_[last..])?;
    }
    Ok(())
}

fn fmt_status_text_line(
    status: bun_test::Execution::Result,
    emoji_or_color: bool,
) -> Output::PrettyBuf {
    // emoji and color might be split into two different options in the future
    // some terminals support color, but not emoji.
    // For now, they are the same.
    match emoji_or_color {
        true => match status.basic_result() {
            bun_test::BasicResult::Pending => Output::pretty_fmt::<true>("<r><d>…<r>"),
            bun_test::BasicResult::Pass => Output::pretty_fmt::<true>("<r><green>✓<r>"),
            bun_test::BasicResult::Fail => Output::pretty_fmt::<true>("<r><red>✗<r>"),
            bun_test::BasicResult::Skip => Output::pretty_fmt::<true>("<r><yellow>»<d>"),
            bun_test::BasicResult::Todo => Output::pretty_fmt::<true>("<r><magenta>✎<r>"),
        },
        false => match status.basic_result() {
            bun_test::BasicResult::Pending => Output::pretty_fmt::<false>("<r><d>(pending)<r>"),
            bun_test::BasicResult::Pass => Output::pretty_fmt::<false>("<r><green>(pass)<r>"),
            bun_test::BasicResult::Fail => Output::pretty_fmt::<false>("<r><red>(fail)<r>"),
            bun_test::BasicResult::Skip => Output::pretty_fmt::<false>("<r><yellow>(skip)<d>"),
            bun_test::BasicResult::Todo => Output::pretty_fmt::<false>("<r><magenta>(todo)<r>"),
        },
    }
}

pub fn write_test_status_line(
    status: bun_test::Execution::Result,
    writer: &mut impl bun_io::Write,
) {
    // PORT NOTE: was `comptime status` in Zig; `Execution::Result` lacks
    // `ConstParamTy`, so this is a runtime arg.
    // PERF(port): was comptime monomorphization — profile in Phase B.
    if Output::enable_ansi_colors_stderr() {
        let _ = writer.write_all(&fmt_status_text_line(status, true));
    } else {
        let _ = writer.write_all(&fmt_status_text_line(status, false));
    }
}

// `Output::error_writer()` / `Output::writer()` already return an unbounded
// `&mut io::Writer`; the previous local `err_w`/`out_w` wrappers were no-op
// reborrows. Call sites use the `Output` accessors directly.

// Remaining TODOs:
// - Add stdout/stderr to the JUnit report
// - Add timestamp field to the JUnit report
pub struct JunitReporter {
    pub contents: Vec<u8>,
    pub total_metrics: Metrics,
    pub testcases_metrics: Metrics,
    pub offset_of_testsuites_value: usize,
    pub offset_of_testsuite_value: usize,
    pub current_file: Box<[u8]>,
    pub properties_list_to_repeat_in_every_test_suite: Option<Box<[u8]>>,

    pub suite_stack: Vec<SuiteInfo>,
    pub current_depth: u32,

    pub hostname_value: Option<Box<[u8]>>,
}

impl Default for JunitReporter {
    fn default() -> Self {
        Self {
            contents: Vec::new(),
            total_metrics: Metrics::default(),
            testcases_metrics: Metrics::default(),
            offset_of_testsuites_value: 0,
            offset_of_testsuite_value: 0,
            current_file: Box::default(),
            properties_list_to_repeat_in_every_test_suite: None,
            suite_stack: Vec::new(),
            current_depth: 0,
            hostname_value: None,
        }
    }
}

pub struct SuiteInfo {
    pub name: Box<[u8]>,
    pub offset_of_attributes: usize,
    pub metrics: Metrics,
    pub is_file_suite: bool,
    pub line_number: u32,
}

impl Default for SuiteInfo {
    fn default() -> Self {
        Self {
            name: Box::default(),
            offset_of_attributes: 0,
            metrics: Metrics::default(),
            is_file_suite: false,
            line_number: 0,
        }
    }
}

// PORT NOTE: SuiteInfo::deinit only freed `name` when !is_file_suite. With Box<[u8]> the
// drop is unconditional but harmless (file-suite case stored a borrowed slice in Zig — we
// dupe it now in begin_test_suite_with_line). // TODO(port): revisit ownership of file name.

#[derive(Default, Clone, Copy)]
pub struct Metrics {
    pub test_cases: u32,
    pub assertions: u32,
    pub failures: u32,
    pub skipped: u32,
    pub elapsed_time: u64,
}

impl Metrics {
    pub fn add(&mut self, other: &Metrics) {
        self.test_cases += other.test_cases;
        self.assertions += other.assertions;
        self.failures += other.failures;
        self.skipped += other.skipped;
    }
}

impl JunitReporter {
    pub fn get_hostname(&mut self) -> Option<&[u8]> {
        if self.hostname_value.is_none() {
            #[cfg(windows)]
            {
                return None;
            }

            #[cfg(not(windows))]
            {
                const HOST_NAME_MAX: usize = 256;
                let mut name_buffer = [0u8; HOST_NAME_MAX];
                if bun_sys::posix::gethostname(&mut name_buffer).is_err() {
                    self.hostname_value = Some(Box::default());
                    return None;
                }
                let hostname = bun_core::slice_to_nul(&name_buffer);

                let mut arraylist_writer: Vec<u8> = Vec::new();
                if escape_xml(hostname, &mut arraylist_writer).is_err() {
                    self.hostname_value = Some(Box::default());
                    return None;
                }
                self.hostname_value = Some(arraylist_writer.into_boxed_slice());
            }
        }

        if let Some(hostname) = &self.hostname_value {
            if !hostname.is_empty() {
                return Some(hostname);
            }
        }
        None
    }

    pub fn init() -> Box<JunitReporter> {
        Box::new(JunitReporter::default())
    }

    // PORT NOTE: `pub const new = bun.TrivialNew(JunitReporter);` → Box::new

    fn generate_properties_list(&mut self) -> Result<(), bun_core::Error> {
        struct PropertiesList<'a> {
            ci: &'a [u8],
            commit: &'a [u8],
        }
        // PERF(port): was arena bulk-free + stack-fallback alloc — profile in Phase B

        let ci_buf: Vec<u8>;
        let ci: &[u8] = 'brk: {
            if let Some(github_run_id) = env_var::GITHUB_RUN_ID.get() {
                if let Some(github_server_url) = env_var::GITHUB_SERVER_URL.get() {
                    if let Some(github_repository) = env_var::GITHUB_REPOSITORY.get() {
                        if !github_run_id.is_empty()
                            && !github_server_url.is_empty()
                            && !github_repository.is_empty()
                        {
                            let mut v = Vec::new();
                            // PORT NOTE: std::io::Write removed; bun_io::Write (top-level) provides write_fmt.
                            let _ = write!(
                                &mut v,
                                "{}/{}/actions/runs/{}",
                                bstr::BStr::new(github_server_url),
                                bstr::BStr::new(github_repository),
                                bstr::BStr::new(github_run_id)
                            );
                            ci_buf = v;
                            break 'brk &ci_buf[..];
                        }
                    }
                }
            }

            if let Some(ci_job_url) = env_var::CI_JOB_URL.get() {
                if !ci_job_url.is_empty() {
                    break 'brk ci_job_url;
                }
            }

            break 'brk b"";
        };

        let commit: &[u8] = 'brk: {
            if let Some(github_sha) = env_var::GITHUB_SHA.get() {
                if !github_sha.is_empty() {
                    break 'brk github_sha;
                }
            }

            if let Some(sha) = env_var::CI_COMMIT_SHA.get() {
                if !sha.is_empty() {
                    break 'brk sha;
                }
            }

            if let Some(git_sha) = env_var::GIT_SHA.get() {
                if !git_sha.is_empty() {
                    break 'brk git_sha;
                }
            }

            break 'brk b"";
        };

        let properties = PropertiesList { ci, commit };

        if properties.ci.is_empty() && properties.commit.is_empty() {
            self.properties_list_to_repeat_in_every_test_suite = Some(Box::default());
            return Ok(());
        }

        let mut buffer: Vec<u8> = Vec::new();
        let writer = &mut buffer;

        writer.write_all(b"    <properties>\n")?;

        if !properties.ci.is_empty() {
            writer.write_all(b"      <property name=\"ci\" value=\"")?;
            escape_xml(properties.ci, writer)?;
            writer.write_all(b"\" />\n")?;
        }
        if !properties.commit.is_empty() {
            writer.write_all(b"      <property name=\"commit\" value=\"")?;
            escape_xml(properties.commit, writer)?;
            writer.write_all(b"\" />\n")?;
        }

        writer.write_all(b"    </properties>\n")?;

        self.properties_list_to_repeat_in_every_test_suite = Some(buffer.into_boxed_slice());
        Ok(())
    }

    fn get_indent(depth: u32) -> &'static [u8] {
        const SPACES: &[u8] =
            b"                                                                                ";
        const INDENT_SIZE: u32 = 2;
        let total_spaces = (depth + 1) * INDENT_SIZE;
        &SPACES[0..(total_spaces as usize).min(SPACES.len())]
    }

    pub fn begin_test_suite(&mut self, name: &[u8]) -> Result<(), bun_core::Error> {
        self.begin_test_suite_with_line(name, 0, true)
    }

    pub fn begin_test_suite_with_line(
        &mut self,
        name: &[u8],
        line_number: u32,
        is_file_suite: bool,
    ) -> Result<(), bun_core::Error> {
        if self.contents.is_empty() {
            self.contents
                .extend_from_slice(b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
            self.contents
                .extend_from_slice(b"<testsuites name=\"bun test\" ");
            self.offset_of_testsuites_value = self.contents.len();
            self.contents.extend_from_slice(b">\n");
        }

        let indent = Self::get_indent(self.current_depth);
        self.contents.extend_from_slice(indent);
        self.contents.extend_from_slice(b"<testsuite name=\"");
        escape_xml(name, &mut self.contents)?;
        self.contents.extend_from_slice(b"\"");

        if is_file_suite {
            self.contents.extend_from_slice(b" file=\"");
            escape_xml(name, &mut self.contents)?;
            self.contents.extend_from_slice(b"\"");
        } else if !self.current_file.is_empty() {
            self.contents.extend_from_slice(b" file=\"");
            // PORT NOTE: reshaped for borrowck — clone current_file slice before mutable borrow of contents
            let cf = self.current_file.clone();
            escape_xml(&cf, &mut self.contents)?;
            self.contents.extend_from_slice(b"\"");
        }

        if line_number > 0 {
            // PORT NOTE: std::io::Write removed; bun_io::Write (top-level) provides write_fmt.
            let _ = write!(&mut self.contents, " line=\"{}\"", line_number);
        }

        self.contents.extend_from_slice(b" ");
        let offset_of_attributes = self.contents.len();
        self.contents.extend_from_slice(b">\n");

        if is_file_suite {
            if self.properties_list_to_repeat_in_every_test_suite.is_none() {
                self.generate_properties_list()?;
            }

            if let Some(properties_list) = &self.properties_list_to_repeat_in_every_test_suite {
                if !properties_list.is_empty() {
                    self.contents.extend_from_slice(properties_list);
                }
            }
        }

        self.suite_stack.push(SuiteInfo {
            name: Box::<[u8]>::from(name),
            // TODO(port): Zig stored borrowed `name` for file suites; we dupe always.
            offset_of_attributes,
            metrics: Metrics::default(),
            is_file_suite,
            line_number,
        });

        self.current_depth += 1;
        if is_file_suite {
            self.current_file = Box::<[u8]>::from(name);
        }
        Ok(())
    }

    pub fn end_test_suite(&mut self) -> Result<(), bun_core::Error> {
        if self.suite_stack.is_empty() {
            return Ok(());
        }

        self.current_depth -= 1;
        let suite_info = self.suite_stack.swap_remove(self.suite_stack.len() - 1);

        // PERF(port): was arena bulk-free + stack-fallback alloc — profile in Phase B

        let elapsed_time_ms = suite_info.metrics.elapsed_time;
        let elapsed_time_ms_f64: f64 = elapsed_time_ms as f64;
        let elapsed_time_seconds = elapsed_time_ms_f64 / bun::time::MS_PER_S as f64;

        // PORT NOTE: reshaped for borrowck — get hostname first
        let hostname = self.get_hostname().map(|h| h.to_vec()).unwrap_or_default();

        // Insert the summary attributes
        let mut summary = Vec::new();
        {
            // PORT NOTE: std::io::Write removed; bun_io::Write (top-level) provides write_fmt.
            let _ = write!(
                &mut summary,
                "tests=\"{}\" assertions=\"{}\" failures=\"{}\" skipped=\"{}\" time=\"{}\" hostname=\"{}\"",
                suite_info.metrics.test_cases,
                suite_info.metrics.assertions,
                suite_info.metrics.failures,
                suite_info.metrics.skipped,
                elapsed_time_seconds,
                bstr::BStr::new(&hostname),
            );
        }

        self.contents.splice(
            suite_info.offset_of_attributes..suite_info.offset_of_attributes,
            summary.iter().copied(),
        );

        let indent = Self::get_indent(self.current_depth);
        self.contents.extend_from_slice(indent);
        self.contents.extend_from_slice(b"</testsuite>\n");

        if !self.suite_stack.is_empty() {
            let last = self.suite_stack.len() - 1;
            self.suite_stack[last].metrics.add(&suite_info.metrics);
        } else {
            self.total_metrics.add(&suite_info.metrics);
        }
        Ok(())
    }

    pub fn write_test_case(
        &mut self,
        status: bun_test::Execution::Result,
        file: &[u8],
        name: &[u8],
        class_name: &[u8],
        assertions: u32,
        elapsed_ns: u64,
        line_number: u32,
    ) -> Result<(), bun_core::Error> {
        // PORT NOTE: std::io::Write removed; bun_io::Write (top-level) provides write_fmt.
        let elapsed_ns_f64: f64 = elapsed_ns as f64;
        let elapsed_ms = elapsed_ns_f64 / bun::time::NS_PER_MS as f64;

        if !self.suite_stack.is_empty() {
            let last = self.suite_stack.len() - 1;
            let current_suite = &mut self.suite_stack[last];
            current_suite.metrics.elapsed_time = current_suite
                .metrics
                .elapsed_time
                .saturating_add(elapsed_ms as u64);
            current_suite.metrics.test_cases += 1;
            current_suite.metrics.assertions += assertions;
        }

        let indent = Self::get_indent(self.current_depth);
        self.contents.extend_from_slice(indent);
        self.contents.extend_from_slice(b"<testcase");
        self.contents.extend_from_slice(b" name=\"");
        escape_xml(name, &mut self.contents)?;
        self.contents.extend_from_slice(b"\" classname=\"");
        escape_xml(class_name, &mut self.contents)?;
        self.contents.extend_from_slice(b"\"");

        let elapsed_seconds = elapsed_ms / bun::time::MS_PER_S as f64;
        let _ = write!(
            &mut self.contents,
            " time=\"{}\"",
            bun_fmt::trimmed_precision::<6>(elapsed_seconds)
        );

        self.contents.extend_from_slice(b" file=\"");
        escape_xml(file, &mut self.contents)?;
        self.contents.extend_from_slice(b"\"");

        if line_number > 0 {
            let _ = write!(&mut self.contents, " line=\"{}\"", line_number);
        }

        let _ = write!(&mut self.contents, " assertions=\"{}\"", assertions);

        use bun_test::Execution::Result as R;
        match status {
            R::Pass => {
                self.contents.extend_from_slice(b" />\n");
            }
            R::Fail => {
                if !self.suite_stack.is_empty() {
                    let last = self.suite_stack.len() - 1;
                    self.suite_stack[last].metrics.failures += 1;
                }
                // TODO: add the failure message
                // if (failure_message) |msg| {
                //     try this.contents.appendSlice(bun.default_allocator, " message=\"");
                //     try escapeXml(msg, this.contents.writer(bun.default_allocator));
                //     try this.contents.appendSlice(bun.default_allocator, "\"");
                // }
                self.contents.extend_from_slice(b">\n");
                self.contents.extend_from_slice(indent);
                self.contents
                    .extend_from_slice(b"  <failure type=\"AssertionError\" />\n");
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"</testcase>\n");
            }
            R::FailBecauseFailingTestPassed => {
                if !self.suite_stack.is_empty() {
                    let last = self.suite_stack.len() - 1;
                    self.suite_stack[last].metrics.failures += 1;
                }
                self.contents.extend_from_slice(b">\n");
                self.contents.extend_from_slice(indent);
                let _ = write!(
                    &mut self.contents,
                    "  <failure message=\"test marked with .failing() did not throw\" type=\"AssertionError\"/>\n"
                );
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"</testcase>\n");
            }
            R::FailBecauseExpectedAssertionCount => {
                if !self.suite_stack.is_empty() {
                    let last = self.suite_stack.len() - 1;
                    self.suite_stack[last].metrics.failures += 1;
                }
                self.contents.extend_from_slice(b">\n");
                self.contents.extend_from_slice(indent);
                let _ = write!(
                    &mut self.contents,
                    "  <failure message=\"Expected more assertions, but only received {}\" type=\"AssertionError\"/>\n",
                    assertions
                );
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"</testcase>\n");
            }
            R::FailBecauseTodoPassed => {
                if !self.suite_stack.is_empty() {
                    let last = self.suite_stack.len() - 1;
                    self.suite_stack[last].metrics.failures += 1;
                }
                self.contents.extend_from_slice(b">\n");
                self.contents.extend_from_slice(indent);
                let _ = write!(
                    &mut self.contents,
                    "  <failure message=\"TODO passed\" type=\"AssertionError\"/>\n"
                );
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"</testcase>\n");
            }
            R::FailBecauseExpectedHasAssertions => {
                if !self.suite_stack.is_empty() {
                    let last = self.suite_stack.len() - 1;
                    self.suite_stack[last].metrics.failures += 1;
                }
                self.contents.extend_from_slice(b">\n");
                self.contents.extend_from_slice(indent);
                let _ = write!(
                    &mut self.contents,
                    "  <failure message=\"Expected to have assertions, but none were run\" type=\"AssertionError\"/>\n"
                );
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"</testcase>\n");
            }
            R::SkippedBecauseLabel | R::Skip => {
                if !self.suite_stack.is_empty() {
                    let last = self.suite_stack.len() - 1;
                    self.suite_stack[last].metrics.skipped += 1;
                }
                self.contents.extend_from_slice(b">\n");
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"  <skipped />\n");
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"</testcase>\n");
            }
            R::Todo => {
                if !self.suite_stack.is_empty() {
                    let last = self.suite_stack.len() - 1;
                    self.suite_stack[last].metrics.skipped += 1;
                }
                self.contents.extend_from_slice(b">\n");
                self.contents.extend_from_slice(indent);
                self.contents
                    .extend_from_slice(b"  <skipped message=\"TODO\" />\n");
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"</testcase>\n");
            }
            R::FailBecauseTimeout
            | R::FailBecauseTimeoutWithDoneCallback
            | R::FailBecauseHookTimeout
            | R::FailBecauseHookTimeoutWithDoneCallback => {
                if !self.suite_stack.is_empty() {
                    let last = self.suite_stack.len() - 1;
                    self.suite_stack[last].metrics.failures += 1;
                }
                self.contents.extend_from_slice(b">\n");
                self.contents.extend_from_slice(indent);
                self.contents
                    .extend_from_slice(b"  <failure type=\"TimeoutError\" />\n");
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"</testcase>\n");
            }
            R::Pending => unreachable!(),
        }
        Ok(())
    }

    pub fn write_to_file(&mut self, path: &[u8]) -> Result<(), bun_core::Error> {
        if self.contents.is_empty() {
            return Ok(());
        }

        while !self.suite_stack.is_empty() {
            self.end_test_suite()?;
        }

        {
            // PERF(port): was arena bulk-free + stack-fallback alloc — profile in Phase B
            let metrics = self.total_metrics;
            let elapsed_time = (bun::time::nano_timestamp() - bun::start_time()) as f64
                / bun::time::NS_PER_S as f64;
            let mut summary = Vec::new();
            {
                // PORT NOTE: std::io::Write removed; bun_io::Write (top-level) provides write_fmt.
                let _ = write!(
                    &mut summary,
                    "tests=\"{}\" assertions=\"{}\" failures=\"{}\" skipped=\"{}\" time=\"{}\"",
                    metrics.test_cases,
                    metrics.assertions,
                    metrics.failures,
                    metrics.skipped,
                    elapsed_time,
                );
            }
            self.contents.splice(
                self.offset_of_testsuites_value..self.offset_of_testsuites_value,
                summary.iter().copied(),
            );
            self.contents.extend_from_slice(b"</testsuites>\n");
        }

        let mut junit_path_buf = PathBuffer::uninit();

        junit_path_buf[..path.len()].copy_from_slice(path);
        junit_path_buf[path.len()] = 0;

        // SAFETY: junit_path_buf[path.len()] == 0 written above
        let zpath = bun_core::ZStr::from_buf(&junit_path_buf[..], path.len());
        match File::openat(
            Fd::cwd(),
            zpath,
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
            0o664,
        ) {
            bun_sys::Result::Err(err) => {
                Output::err(
                    bun_core::err!("JUnitReportFailed"),
                    "Failed to write JUnit report to {}\n{}",
                    (bstr::BStr::new(path), err),
                );
            }
            bun_sys::Result::Ok(fd) => {
                let _close_fd = bun_sys::CloseOnDrop::file(&fd);
                match File::write_all(&fd, &self.contents) {
                    bun_sys::Result::Ok(()) => {}
                    bun_sys::Result::Err(err) => {
                        Output::err(
                            bun_core::err!("JUnitReportFailed"),
                            "Failed to write JUnit report to {}\n{}",
                            (bstr::BStr::new(path), err),
                        );
                    }
                }
            }
        }
        Ok(())
    }
}

pub struct CommandLineReporter {
    // TODO(port): `TestRunner<'a>` borrows `TestOptions`/regex from the CLI
    // ctx; the reporter is held in a `Box` local to `TestCommand::exec` which
    // never returns before process exit, so `'static` is sound here. Revisit
    // if the reporter ever becomes scoped.
    pub jest: TestRunner<'static>,
    pub last_dot: u32,
    pub prev_file: u64,
    pub repeat_count: u32,
    /// Interior-mut: written from `BunTestRoot::on_before_print` via `&CommandLineReporter`
    /// (Zig stores `?*CommandLineReporter` and freely mutates; Rust holds `&'a CommandLineReporter`).
    pub last_printed_dot: core::cell::Cell<bool>,

    /// When running as a `--parallel` worker, this is the coordinator-assigned
    /// index of the file currently being executed. While set, per-test output
    /// is sent over the IPC pipe instead of to stderr; the coordinator owns
    /// the terminal.
    pub worker_ipc_file_idx: Option<u32>,

    pub failures_to_repeat_buf: Vec<u8>,
    pub skips_to_repeat_buf: Vec<u8>,
    pub todos_to_repeat_buf: Vec<u8>,

    pub reporters: ReportersConfig,
}

#[derive(Default)]
pub struct ReportersConfig {
    pub dots: bool,
    pub only_failures: bool,
    pub junit: Option<Box<JunitReporter>>,
}

// TODO(port): DotColorMap (std.EnumMap<TestRunner.Test.Status, &str>) and `dots` const
// initialization — port once Output::RESET / ED / color_map are available in bun_core.
// type DotColorMap = enum_map::EnumMap<TestRunner::Test::Status, Option<&'static [u8]>>;

impl CommandLineReporter {
    // TODO(port): Zig `TestRunner.Callback` was a vtable struct; not yet
    // ported. These hooks are no-ops in the Zig source too — keep the
    // signature shape but take `&mut Self` until the callback type lands.
    pub fn handle_update_count(_: &mut Self, _: u32, _: u32) {}

    pub fn handle_test_start(_: &mut Self, _: /* TestRunner.Test.ID */ u32) {}

    fn print_test_line<const DIM: bool>(
        status: bun_test::Execution::Result,
        sequence: &mut bun_test::Execution::ExecutionSequence,
        test_entry: &mut bun_test::ExecutionEntry,
        elapsed_ns: u64,
        writer: &mut impl bun_io::Write,
    ) {
        // PERF(port): was comptime monomorphization on `status` — profile in Phase B
        let initial_retry_count = test_entry.retry_count;
        let attempts = (initial_retry_count - sequence.remaining_retry_count) + 1;
        let initial_repeat_count = test_entry.repeat_count;
        let repeats = (initial_repeat_count - sequence.remaining_repeat_count) + 1;
        let mut scopes_stack: BoundedArray<*const bun_test::DescribeScope, 64> =
            BoundedArray::default();
        let mut parent_: Option<*const bun_test::DescribeScope> =
            test_entry.base.parent.map(|p| p.cast_const());

        while let Some(scope) = parent_ {
            if scopes_stack.push(scope).is_err() {
                break;
            }
            // SAFETY: scope is a live DescribeScope pointer kept alive for the test run
            parent_ = unsafe { (*scope).base.parent.map(|p| p.cast_const()) };
        }

        let scopes: &[*const bun_test::DescribeScope] = scopes_stack.as_slice();
        let display_label: &[u8] = test_entry.base.name.as_deref().unwrap_or(b"(unnamed)");

        // Quieter output when claude code is in use.
        if !Output::is_ai_agent() || !status.is_pass(bun_test::PendingMode::PendingIsFail) {
            // PORT NOTE: Zig comptime `color_code`/`line_color_code` literals are inlined at use
            // sites below via `if DIM { ... } else { ... }` to avoid runtime `format!`.

            // PORT NOTE: `switch (Output.enable_ansi_colors_stderr) { inline else => |_| ... }` — the
            // captured bool was unused except for monomorphization; collapsed to runtime.
            match status {
                bun_test::Execution::Result::FailBecauseExpectedAssertionCount => {
                    // not sent to writer so it doesn't get printed twice
                    let expected_count =
                        if let bun_test::ExpectAssertions::Exact(n) = sequence.expect_assertions {
                            n
                        } else {
                            12345
                        };
                    Output::err(
                        bun_core::err!("AssertionError"),
                        "expected <green>{} assertion{}<r>, but test ended with <red>{} assertion{}<r>\n",
                        (
                            expected_count,
                            if expected_count == 1 { "" } else { "s" },
                            sequence.expect_call_count,
                            if sequence.expect_call_count == 1 {
                                ""
                            } else {
                                "s"
                            },
                        ),
                    );
                    Output::flush();
                }
                bun_test::Execution::Result::FailBecauseExpectedHasAssertions => {
                    Output::err(
                        bun_core::err!("AssertionError"),
                        "received <red>0 assertions<r>, but expected <green>at least one assertion<r> to be called\n",
                        (),
                    );
                    Output::flush();
                }
                bun_test::Execution::Result::FailBecauseTimeout
                | bun_test::Execution::Result::FailBecauseHookTimeout
                | bun_test::Execution::Result::FailBecauseTimeoutWithDoneCallback
                | bun_test::Execution::Result::FailBecauseHookTimeoutWithDoneCallback => {
                    if Output::is_github_action() {
                        Output::print_error(format_args!(
                            "::error title=error: Test \"{}\" timed out after {}ms::\n",
                            bun_fmt::github_action_property(display_label),
                            test_entry.timeout
                        ));
                        Output::flush();
                    }
                }
                _ => {}
            }

            if Output::enable_ansi_colors_stderr() {
                for i in 0..scopes.len() {
                    let index = (scopes.len() - 1) - i;
                    let scope = scopes[index];
                    // SAFETY: scope is alive for duration of test run
                    let name: &[u8] = unsafe { (*scope).base.name.as_deref() }.unwrap_or(b"");
                    if name.is_empty() {
                        continue;
                    }
                    let _ = writer.write_all(b" ");

                    let prefix = if DIM {
                        Output::pretty_fmt::<true>("<r><d>")
                    } else {
                        Output::pretty_fmt::<true>("<r>")
                    };
                    let _ = writer.write_all(&prefix);
                    let _ = writer.write_all(name);
                    let _ = writer.write_all(&Output::pretty_fmt::<true>("<d>"));
                    let _ = writer.write_all(b" >");
                }
            } else {
                for i in 0..scopes.len() {
                    let index = (scopes.len() - 1) - i;
                    let scope = scopes[index];
                    // SAFETY: scope is alive for duration of test run
                    let name: &[u8] = unsafe { (*scope).base.name.as_deref() }.unwrap_or(b"");
                    if name.is_empty() {
                        continue;
                    }
                    let _ = writer.write_all(b" ");
                    let _ = writer.write_all(name);
                    let _ = writer.write_all(b" >");
                }
            }

            if Output::enable_ansi_colors_stderr() {
                let label_prefix = if DIM {
                    Output::pretty_fmt::<true>("<r><d> ")
                } else {
                    Output::pretty_fmt::<true>("<r><b> ")
                };
                let _ = writer.write_all(&label_prefix);
                let _ = writer.write_all(display_label);
                let _ = writer.write_all(&Output::pretty_fmt::<true>("<r>"));
            } else {
                let _ = writer.write_all(b" ");
                let _ = writer.write_all(display_label);
            }

            // Print attempt count if test was retried (attempts > 1)
            if attempts > 1 {
                let _ = write!(
                    writer,
                    "{}",
                    Output::pretty_fmt_args(
                        " <d>(attempt {d})<r>",
                        Output::enable_ansi_colors_stderr(),
                        (attempts,)
                    ),
                );
            }

            // Print repeat count if test failed on a repeat (repeats > 1)
            if repeats > 1 {
                let _ = write!(
                    writer,
                    "{}",
                    Output::pretty_fmt_args(
                        " <d>(run {d})<r>",
                        Output::enable_ansi_colors_stderr(),
                        (repeats,)
                    ),
                );
            }

            if elapsed_ns > (bun::time::NS_PER_US * 10) {
                let _ = write!(
                    writer,
                    " {}",
                    Output::ElapsedFormatter {
                        colors: Output::enable_ansi_colors_stderr(),
                        duration_ns: elapsed_ns,
                    }
                );
            }

            let _ = writer.write_all(b"\n");

            let colors = Output::enable_ansi_colors_stderr();
            // PERF(port): was comptime bool dispatch — profile in Phase B
            use bun_test::Execution::Result as R;
            match status {
                R::Pending | R::Pass | R::Skip | R::SkippedBecauseLabel | R::Todo | R::Fail => {}

                R::FailBecauseFailingTestPassed => {
                    let _ = writer.write_all(&Output::pretty_fmt_rt("  <d>^<r> <red>this test is marked as failing but it passed.<r> <d>Remove `.failing` if tested behavior now works<r>\n", colors));
                }
                R::FailBecauseTodoPassed => {
                    let _ = writer.write_all(&Output::pretty_fmt_rt("  <d>^<r> <red>this test is marked as todo but passes.<r> <d>Remove `.todo` if tested behavior now works<r>\n", colors));
                }
                R::FailBecauseExpectedAssertionCount | R::FailBecauseExpectedHasAssertions => {} // printed above
                R::FailBecauseTimeout => {
                    let _ = write!(
                        writer,
                        "{}",
                        Output::pretty_fmt_args(
                            "  <d>^<r> <red>this test timed out after {}ms.<r>\n",
                            colors,
                            (test_entry.timeout,)
                        )
                    );
                }
                R::FailBecauseHookTimeout => {
                    let _ = writer.write_all(&Output::pretty_fmt_rt(
                        "  <d>^<r> <red>a beforeEach/afterEach hook timed out for this test.<r>\n",
                        colors,
                    ));
                }
                R::FailBecauseTimeoutWithDoneCallback => {
                    let _ = write!(
                        writer,
                        "{}",
                        Output::pretty_fmt_args(
                            "  <d>^<r> <red>this test timed out after {}ms, before its done callback was called.<r> <d>If a done callback was not intended, remove the last parameter from the test callback function<r>\n",
                            colors,
                            (test_entry.timeout,)
                        )
                    );
                }
                R::FailBecauseHookTimeoutWithDoneCallback => {
                    let _ = writer.write_all(&Output::pretty_fmt_rt("  <d>^<r> <red>a beforeEach/afterEach hook timed out before its done callback was called.<r> <d>If a done callback was not intended, remove the last parameter from the hook callback function<r>\n", colors));
                }
            }
        }
    }

    fn maybe_print_junit_line(
        status: bun_test::Execution::Result,
        buntest: &mut bun_test::BunTest,
        sequence: &mut bun_test::Execution::ExecutionSequence,
        test_entry: &mut bun_test::ExecutionEntry,
        elapsed_ns: u64,
    ) {
        // PERF(port): was comptime monomorphization on `status` — profile in Phase B
        let Some(cmd_reporter) = buntest.reporter else {
            return;
        };
        // SAFETY: `BunTest.reporter` is `NonNull<CommandLineReporter>` with write
        // provenance from `enter_file`'s `&mut`; single-threaded test runner,
        // exclusive access for the duration of this callback (mirrors Zig
        // `?*CommandLineReporter`).
        let cmd_reporter: &mut CommandLineReporter = unsafe { &mut *cmd_reporter.as_ptr() };
        let Some(junit) = cmd_reporter.reporters.junit.as_mut() else {
            return;
        };

        let mut scopes_stack: BoundedArray<*const bun_test::DescribeScope, 64> =
            BoundedArray::default();
        let mut parent_: Option<*const bun_test::DescribeScope> =
            test_entry.base.parent.map(|p| p.cast_const());
        let assertions = sequence.expect_call_count;
        let line_number = test_entry.base.line_no;

        let file: &[u8] = if let Some(runner) = jest::Jest::runner() {
            runner.files.items_source()[buntest.file_id as usize]
                .path
                .text
        } else {
            b""
        };

        while let Some(scope) = parent_ {
            if scopes_stack.push(scope).is_err() {
                break;
            }
            // SAFETY: scope kept alive for the test run
            parent_ = unsafe { (*scope).base.parent.map(|p| p.cast_const()) };
        }

        let scopes: &[*const bun_test::DescribeScope] = scopes_stack.as_slice();
        let display_label: &[u8] = test_entry.base.name.as_deref().unwrap_or(b"(unnamed)");

        {
            let filename: &[u8] = 'brk: {
                let top = FileSystem::instance().top_level_dir;
                if strings::has_prefix(file, top) {
                    break 'brk without_leading_path_separator(&file[top.len()..]);
                } else {
                    break 'brk file;
                }
            };

            if !strings::eql(&junit.current_file, filename) {
                while !junit.suite_stack.is_empty()
                    && !junit.suite_stack[junit.suite_stack.len() - 1].is_file_suite
                {
                    junit.end_test_suite().expect("oom");
                }

                if !junit.current_file.is_empty() {
                    junit.end_test_suite().expect("oom");
                }

                junit.begin_test_suite(filename).expect("oom");
            }

            // To make the juint reporter generate nested suites, we need to find the needed suites and create/print them.
            // This assumes that the scopes are in the correct order.
            let mut needed_suites: Vec<*const bun_test::DescribeScope> = Vec::new();

            for i in 0..scopes.len() {
                let index = (scopes.len() - 1) - i;
                let scope = scopes[index];
                // SAFETY: scope alive for test run
                if let Some(name) = unsafe { (*scope).base.name.as_deref() } {
                    if !name.is_empty() {
                        needed_suites.push(scope);
                    }
                }
            }

            let mut current_suite_depth: u32 = 0;
            if !junit.suite_stack.is_empty() {
                for suite_info in &junit.suite_stack {
                    if !suite_info.is_file_suite {
                        current_suite_depth += 1;
                    }
                }
            }

            while (current_suite_depth as usize) > needed_suites.len() {
                if !junit.suite_stack.is_empty()
                    && !junit.suite_stack[junit.suite_stack.len() - 1].is_file_suite
                {
                    junit.end_test_suite().expect("oom");
                    current_suite_depth -= 1;
                } else {
                    break;
                }
            }

            let mut suites_to_close: u32 = 0;
            let mut suite_index: usize = 0;
            for suite_info in &junit.suite_stack {
                if suite_info.is_file_suite {
                    continue;
                }

                if suite_index < needed_suites.len() {
                    let needed_scope = needed_suites[suite_index];
                    // SAFETY: needed_scope alive for test run
                    let needed_name =
                        unsafe { (*needed_scope).base.name.as_deref() }.unwrap_or(b"");
                    if !strings::eql(&suite_info.name, needed_name) {
                        suites_to_close = u32::try_from(current_suite_depth).unwrap()
                            - u32::try_from(suite_index).unwrap();
                        break;
                    }
                } else {
                    suites_to_close = u32::try_from(current_suite_depth).unwrap()
                        - u32::try_from(suite_index).unwrap();
                    break;
                }
                suite_index += 1;
            }

            while suites_to_close > 0 {
                if !junit.suite_stack.is_empty()
                    && !junit.suite_stack[junit.suite_stack.len() - 1].is_file_suite
                {
                    junit.end_test_suite().expect("oom");
                    current_suite_depth -= 1;
                    suites_to_close -= 1;
                } else {
                    break;
                }
            }

            let mut describe_suite_index: usize = 0;
            for suite_info in &junit.suite_stack {
                if !suite_info.is_file_suite {
                    describe_suite_index += 1;
                }
            }

            while describe_suite_index < needed_suites.len() {
                let scope = needed_suites[describe_suite_index];
                // SAFETY: scope alive for test run
                let (name, line_no) = unsafe {
                    (
                        (*scope).base.name.as_deref().unwrap_or(b""),
                        (*scope).base.line_no,
                    )
                };
                junit
                    .begin_test_suite_with_line(name, line_no, false)
                    .expect("oom");
                describe_suite_index += 1;
            }

            // PERF(port): was arena bulk-free + stack-fallback alloc — profile in Phase B
            let mut concatenated_describe_scopes: Vec<u8> = Vec::new();

            {
                let initial_length = concatenated_describe_scopes.len();
                for &scope in scopes {
                    // SAFETY: scope alive for test run
                    if let Some(name) = unsafe { (*scope).base.name.as_deref() } {
                        if !name.is_empty() {
                            if initial_length != concatenated_describe_scopes.len() {
                                concatenated_describe_scopes.extend_from_slice(b" &gt; ");
                            }

                            escape_xml(name, &mut concatenated_describe_scopes).expect("oom");
                        }
                    }
                }
            }

            for attempt in sequence.flaky_attempts() {
                junit
                    .write_test_case(
                        attempt.result,
                        filename,
                        display_label,
                        &concatenated_describe_scopes,
                        0,
                        attempt.elapsed_ns,
                        line_number,
                    )
                    .expect("oom");
            }
            junit
                .write_test_case(
                    status,
                    filename,
                    display_label,
                    &concatenated_describe_scopes,
                    assertions,
                    elapsed_ns,
                    line_number,
                )
                .expect("oom");
        }
    }

    #[inline]
    pub fn summary(&mut self) -> &mut Summary {
        &mut self.jest.summary
    }

    pub fn handle_test_completed(
        buntest: &mut bun_test::BunTest,
        sequence: &mut bun_test::Execution::ExecutionSequence,
        test_entry: &mut bun_test::ExecutionEntry,
        elapsed_ns: u64,
    ) {
        let mut output_buf: Vec<u8> = Vec::new();

        let initial_length = output_buf.len();
        let writer = &mut output_buf;

        // PORT NOTE: `switch (sequence.result) { inline else => |result| ... }` — Zig comptime
        // dispatch on enum value. Demoted to runtime match.
        // PERF(port): was comptime monomorphization — profile in Phase B
        let result = sequence.result;
        if result != bun_test::Execution::Result::SkippedBecauseLabel {
            // SAFETY: `BunTest.reporter` is `NonNull<CommandLineReporter>` with write
            // provenance from `enter_file`'s `&mut`; single-threaded; reporter outlives
            // every BunTest. Scoped to this block so the SharedReadOnly tag is dead
            // before `maybe_print_junit_line` derives `&mut` from the same `NonNull`
            // (stacked-borrows hygiene — Zig re-reads `buntest.reporter.?` per site).
            let reporter_ref: Option<&CommandLineReporter> =
                buntest.reporter.map(|p| unsafe { &*p.as_ptr() });
            let basic = result.basic_result();
            let dots_branch = reporter_ref.is_some_and(|r| r.reporters.dots)
                && matches!(
                    basic,
                    bun_test::BasicResult::Pass
                        | bun_test::BasicResult::Skip
                        | bun_test::BasicResult::Todo
                        | bun_test::BasicResult::Pending
                );
            if dots_branch {
                let colors = Output::enable_ansi_colors_stderr();
                // PERF(port): was comptime bool dispatch — profile in Phase B
                match basic {
                    bun_test::BasicResult::Pass => {
                        let _ = writer.write_all(&Output::pretty_fmt_rt("<r><green>.<r>", colors));
                    }
                    bun_test::BasicResult::Skip => {
                        let _ = writer.write_all(&Output::pretty_fmt_rt("<r><yellow>.<d>", colors));
                    }
                    bun_test::BasicResult::Todo => {
                        let _ =
                            writer.write_all(&Output::pretty_fmt_rt("<r><magenta>.<r>", colors));
                    }
                    bun_test::BasicResult::Pending => {
                        let _ = writer.write_all(&Output::pretty_fmt_rt("<r><d>.<r>", colors));
                    }
                    bun_test::BasicResult::Fail => {
                        let _ = writer.write_all(&Output::pretty_fmt_rt("<r><red>.<r>", colors));
                    }
                }
                reporter_ref.unwrap().last_printed_dot.set(true);
            } else if basic != bun_test::BasicResult::Fail
                && reporter_ref.is_some_and(|r| r.reporters.only_failures)
            {
                // when using --only-failures, only print failures
            } else {
                buntest.bun_test_root.on_before_print();

                // TODO(port): write_test_status_line takes comptime status in Zig
                if Output::enable_ansi_colors_stderr() {
                    let _ = writer.write_all(&fmt_status_text_line(result, true));
                } else {
                    let _ = writer.write_all(&fmt_status_text_line(result, false));
                }
                let dim = match basic {
                    bun_test::BasicResult::Todo => {
                        if let Some(runner) = jest::Jest::runner() {
                            !runner.run_todo
                        } else {
                            true
                        }
                    }
                    bun_test::BasicResult::Skip | bun_test::BasicResult::Pending => true,
                    bun_test::BasicResult::Pass | bun_test::BasicResult::Fail => false,
                };
                if dim {
                    Self::print_test_line::<true>(result, sequence, test_entry, elapsed_ns, writer);
                } else {
                    Self::print_test_line::<false>(
                        result, sequence, test_entry, elapsed_ns, writer,
                    );
                }
            }
        }
        // always print junit if needed (creates `&mut CommandLineReporter` from
        // the same `NonNull` — any earlier shared borrow must be dead first).
        Self::maybe_print_junit_line(result, buntest, sequence, test_entry, elapsed_ns);

        let formatted_line = &output_buf[initial_length..];
        // SAFETY: `BunTest.reporter` is `NonNull<CommandLineReporter>`; re-derived
        // here (not held across `maybe_print_junit_line`'s `&mut`) per stacked
        // borrows. Mirrors Zig's per-site `buntest.reporter.?` deref.
        let worker_idx = buntest
            .reporter
            .and_then(|p| unsafe { (*p.as_ptr()).worker_ipc_file_idx });
        if let Some(idx) = worker_idx {
            ParallelRunner::worker_emit_test_done(idx, formatted_line);
        } else {
            let _ = Output::error_writer().write_all(formatted_line);
        }

        let Some(this) = buntest.reporter else {
            return;
        }; // command line reporter is missing! uh oh!
        // SAFETY: `BunTest.reporter` is `NonNull<CommandLineReporter>` with write
        // provenance from `enter_file`'s `&mut`; single-threaded test runner,
        // sole writer for the duration of this completion callback.
        let this: &mut CommandLineReporter = unsafe { &mut *this.as_ptr() };

        if !this.reporters.dots && !this.reporters.only_failures {
            match sequence.result.basic_result() {
                bun_test::BasicResult::Skip => this
                    .skips_to_repeat_buf
                    .extend_from_slice(&output_buf[initial_length..]),
                bun_test::BasicResult::Todo => this
                    .todos_to_repeat_buf
                    .extend_from_slice(&output_buf[initial_length..]),
                bun_test::BasicResult::Fail => this
                    .failures_to_repeat_buf
                    .extend_from_slice(&output_buf[initial_length..]),
                bun_test::BasicResult::Pass | bun_test::BasicResult::Pending => {}
            }
        }

        use bun_test::Execution::Result as R;
        match sequence.result {
            R::Pending => {}
            R::Pass => this.summary().pass += 1,
            R::Skip => this.summary().skip += 1,
            R::Todo => this.summary().todo += 1,
            R::SkippedBecauseLabel => this.summary().skipped_because_label += 1,

            R::Fail
            | R::FailBecauseFailingTestPassed
            | R::FailBecauseTodoPassed
            | R::FailBecauseExpectedHasAssertions
            | R::FailBecauseExpectedAssertionCount
            | R::FailBecauseTimeout
            | R::FailBecauseTimeoutWithDoneCallback
            | R::FailBecauseHookTimeout
            | R::FailBecauseHookTimeoutWithDoneCallback => {
                this.summary().fail += 1;

                if this.summary().fail == this.jest.bail {
                    this.print_summary();
                    pretty_error!(
                        "\nBailed out after {} failure{}<r>\n",
                        this.jest.bail,
                        if this.jest.bail == 1 { "" } else { "s" }
                    );
                    Output::flush();
                    this.write_junit_report_if_needed();
                    Global::exit(1);
                }
            }
        }
        this.summary().expectations = this
            .summary()
            .expectations
            .saturating_add(sequence.expect_call_count);
    }

    pub fn print_summary(&mut self) {
        let summary_ = self.summary();
        let tests = summary_.fail + summary_.pass + summary_.skip + summary_.todo;
        let files = summary_.files;

        pretty_error!(
            "Ran {} test{} across {} file{}. ",
            tests,
            if tests == 1 { "" } else { "s" },
            files,
            if files == 1 { "" } else { "s" }
        );

        Output::print_start_end(bun::start_time(), bun::time::nano_timestamp());
    }

    /// Writes the JUnit reporter output file if a JUnit reporter is active and
    /// an outfile path was configured. This must be called before any early exit
    /// (e.g. bail) so that the report is not lost.
    pub fn write_junit_report_if_needed(&mut self) {
        if let Some(junit) = self.reporters.junit.as_mut() {
            if let Some(outfile) = self.jest.test_options.reporter_outfile.as_deref() {
                if !junit.current_file.is_empty() {
                    let _ = junit.end_test_suite();
                }
                let _ = junit.write_to_file(outfile);
            }
        }
    }

    pub fn generate_code_coverage<
        const REPORTERS_TEXT: bool,
        const REPORTERS_LCOV: bool,
        const ENABLE_ANSI_COLORS: bool,
    >(
        &mut self,
        vm: &mut VirtualMachine,
        opts: &mut CodeCoverageOptions,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): Zig used `comptime reporters: TestCommand.Reporters` (a struct value).
        // Split into two const-generic bools here. Phase B may use a const-param struct.
        if !REPORTERS_TEXT && !REPORTERS_LCOV {
            return Ok(());
        }

        let Some(map) = ByteRangeMapping::map() else {
            return Ok(());
        };
        // SAFETY: thread-local Box pinned for the thread; sole `&mut` for the
        // collection loop below (single-threaded CLI report path).
        let map = unsafe { &mut *map.as_ptr() };
        // PORT NOTE: Zig bitwise-copied each `ByteRangeMapping` out of the map
        // (`entry.*`). The Rust struct owns a `MultiArrayList` and is not
        // `Copy`, so collect mutable borrows into the thread-local map instead
        // — same observable behaviour, no double-free risk.
        let mut byte_ranges: Vec<&mut ByteRangeMapping> = Vec::with_capacity(map.len());
        for entry in map.values_mut() {
            byte_ranges.push(entry);
            // PERF(port): was assume_capacity
        }

        if byte_ranges.is_empty() {
            return Ok(());
        }

        byte_ranges.sort_by(coverage::is_less_than_cmp);

        self.print_code_coverage::<REPORTERS_TEXT, REPORTERS_LCOV, ENABLE_ANSI_COLORS>(
            vm,
            opts,
            &mut byte_ranges,
        )
    }

    /// Write an LCOV-only report to a specific path. Used by `--parallel`
    /// workers to emit a fragment the coordinator merges.
    pub fn write_lcov_only(
        &mut self,
        vm: &mut VirtualMachine,
        opts: &CodeCoverageOptions,
        out_path: &bun_core::ZStr,
    ) -> Result<(), bun_core::Error> {
        let Some(map) = ByteRangeMapping::map() else {
            return Ok(());
        };
        // SAFETY: thread-local Box pinned for the thread; sole `&mut` for the
        // collection loop below (single-threaded CLI report path).
        let map = unsafe { &mut *map.as_ptr() };
        // PORT NOTE: see `generate_code_coverage` — collect borrows, not bitwise copies.
        let mut byte_ranges: Vec<&mut ByteRangeMapping> = Vec::with_capacity(map.len());
        for entry in map.values_mut() {
            byte_ranges.push(entry);
            // PERF(port): was assume_capacity
        }
        if byte_ranges.is_empty() {
            return Ok(());
        }
        byte_ranges.sort_by(coverage::is_less_than_cmp);

        let relative_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
        let file = match File::openat(
            Fd::cwd(),
            out_path,
            bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::TRUNC | bun_sys::O::CLOEXEC,
            0o644,
        ) {
            bun_sys::Result::Err(e) => {
                Output::err(
                    bun_core::err!("lcovCoverageError"),
                    "failed to open coverage fragment {}\n{}",
                    (bstr::BStr::new(out_path.as_bytes()), e),
                );
                return Err(bun_core::err!("OpenFailed"));
            }
            bun_sys::Result::Ok(f) => f,
        };
        let _close_file = bun_sys::CloseOnDrop::file(&file); // close error is non-actionable (Zig parity: discarded)
        // TODO(port): file.writer().adaptToNewApi(buf) — Zig's buffered writer adapter
        // not present on `bun_sys::File`; buffer in a Vec (impl `bun_io::Write`) and
        // write through in one shot below.
        let mut buffered: Vec<u8> = Vec::with_capacity(64 * 1024);
        let writer = &mut buffered;

        for entry in byte_ranges.iter_mut() {
            if !opts.ignore_patterns.is_empty() {
                let rel = resolve_path::relative(relative_dir, entry.source_url.slice());
                let mut skip = false;
                for p in &opts.ignore_patterns {
                    if bun_glob::r#match(p, rel).matches() {
                        skip = true;
                        break;
                    }
                }
                if skip {
                    continue;
                }
            }
            let Some(mut report) =
                CodeCoverageReport::generate(vm.global(), entry, opts.ignore_sourcemap)
            else {
                continue;
            };
            // report dropped at end of iteration
            if coverage::Lcov::write_format(&report, relative_dir, writer).is_err() {
                continue;
            }
            drop(report);
        }
        match file.write_all(&buffered) {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(e) => return Err(bun_core::Error::from(e)),
        }
        Ok(())
    }

    pub fn print_code_coverage<
        const REPORTERS_TEXT: bool,
        const REPORTERS_LCOV: bool,
        const ENABLE_ANSI_COLORS: bool,
    >(
        &mut self,
        vm: &mut VirtualMachine,
        opts: &mut CodeCoverageOptions,
        byte_ranges: &mut [&mut ByteRangeMapping],
    ) -> Result<(), bun_core::Error> {
        // `perf::Ctx` ends its span on Drop — Zig's `defer trace.end()` is the binding itself.
        let _trace = if REPORTERS_TEXT && REPORTERS_LCOV {
            bun::perf::trace("TestCommand.printCodeCoverageLCovAndText")
        } else if REPORTERS_TEXT {
            bun::perf::trace("TestCommand.printCodeCoverageText")
        } else if REPORTERS_LCOV {
            bun::perf::trace("TestCommand.printCodeCoverageLCov")
        } else {
            // TODO(port): @compileError("No reporters enabled") — Phase B can enforce via const assert
            unreachable!("No reporters enabled")
        };

        if !REPORTERS_TEXT && !REPORTERS_LCOV {
            unreachable!("No reporters enabled");
        }

        let relative_dir = bun_resolver::fs::FileSystem::get().top_level_dir;

        // --- Text ---
        let max_filepath_length: usize = if REPORTERS_TEXT {
            'brk: {
                let mut len = b"All files".len();
                for entry in byte_ranges.iter() {
                    let utf8 = entry.source_url.slice();
                    let relative_path = resolve_path::relative(relative_dir, utf8);

                    // Check if this file should be ignored based on coveragePathIgnorePatterns
                    if !opts.ignore_patterns.is_empty() {
                        let mut should_ignore = false;
                        for pattern in &opts.ignore_patterns {
                            if bun_glob::r#match(pattern, relative_path).matches() {
                                should_ignore = true;
                                break;
                            }
                        }

                        if should_ignore {
                            continue;
                        }
                    }

                    len = relative_path.len().max(len);
                }

                break 'brk len;
            }
        } else {
            0
        };

        // `&mut bun_core::io::Writer: bun_io::Write` (impl in `bun_core::io`);
        // `splat_byte_all` / `write_all` resolve via the trait import at top.
        let mut console = Output::error_writer();
        let base_fraction = opts.fractions;
        let mut failing = false;

        if REPORTERS_TEXT {
            if console
                .write_all(&Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><d>"))
                .is_err()
            {
                return Ok(());
            }
            if console
                .splat_byte_all(b'-', max_filepath_length + 2)
                .is_err()
            {
                return Ok(());
            }
            if console
                .write_all(&Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                    "|---------|---------|-------------------<r>\n",
                ))
                .is_err()
            {
                return Ok(());
            }
            if console.write_all(b"File").is_err() {
                return Ok(());
            }
            if console
                .splat_byte_all(b' ', max_filepath_length - b"File".len() + 1)
                .is_err()
            {
                return Ok(());
            }
            // writer.writeAll(Output.prettyFmt(" <d>|<r> % Funcs <d>|<r> % Blocks <d>|<r> % Lines <d>|<r> Uncovered Line #s\n", enable_ansi_colors)) catch return;
            if console
                .write_all(&Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                    " <d>|<r> % Funcs <d>|<r> % Lines <d>|<r> Uncovered Line #s\n",
                ))
                .is_err()
            {
                return Ok(());
            }
            if console
                .write_all(&Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"))
                .is_err()
            {
                return Ok(());
            }
            if console
                .splat_byte_all(b'-', max_filepath_length + 2)
                .is_err()
            {
                return Ok(());
            }
            if console
                .write_all(&Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                    "|---------|---------|-------------------<r>\n",
                ))
                .is_err()
            {
                return Ok(());
            }
        }

        let mut console_buffer: Vec<u8> = Vec::new();
        // TODO(port): std.Io.Writer.Allocating → Vec<u8> + adapter
        let console_writer = &mut console_buffer;

        let mut avg = Fraction {
            functions: 0.0,
            lines: 0.0,
            stmts: 0.0,
            ..Default::default()
        };
        let mut avg_count: f64 = 0.0;
        // --- Text ---

        // --- LCOV ---
        let mut lcov_name_buf = PathBuffer::uninit();
        // TODO(port): the Zig code uses tuple destructuring with comptime branching to make
        // lcov_file/lcov_name/lcov_buffered_writer be `void` when !REPORTERS_LCOV. We use
        // Option here.
        let mut lcov_state: Option<(File, &bun_core::ZStr, /*buffered*/ Vec<u8>)> =
            if REPORTERS_LCOV {
                'brk: {
                    // Ensure the directory exists
                    let mut fs = crate::node::fs::NodeFS::default();
                    let _ = fs.mkdir_recursive(&crate::node::fs::args::Mkdir {
                        path: crate::node::PathLike::EncodedSlice(
                            ZigStringSlice::from_utf8_never_free(&opts.reports_directory),
                        ),
                        always_return_none: true,
                        recursive: true,
                        ..Default::default()
                    });

                    // Write the lcov.info file to a temporary file we atomically rename to the final name after it succeeds
                    let mut base64_bytes = [0u8; 8];
                    let mut shortname_buf = [0u8; 512];
                    bun_core::csprng(&mut base64_bytes);
                    // Spec: `std.fmt.bufPrintZ(..., ".lcov.info.{x}.tmp", .{&base64_bytes})`
                    // — Zig `{x}` on `*[8]u8` prints contiguous lowercase hex.
                    let tmpname = {
                        use std::io::Write as _;
                        let mut cursor = &mut shortname_buf[..];
                        let _ = cursor.write_all(b".lcov.info.");
                        let _ = write!(cursor, "{}", bun_core::fmt::hex_lower(&base64_bytes));
                        let _ = cursor.write_all(b".tmp\0");
                        let s = bun_core::slice_to_nul(&shortname_buf);
                        // NUL written above; `slice_to_nul` returns the prefix before it.
                        bun_core::ZStr::from_buf(&shortname_buf[..], s.len())
                    };
                    let path = resolve_path::join_abs_string_buf_z::<bun_path::platform::Auto>(
                        relative_dir,
                        &mut lcov_name_buf,
                        &[&opts.reports_directory, tmpname.as_bytes()],
                    );
                    let file = File::openat(
                        Fd::cwd(),
                        path,
                        bun_sys::O::CREAT
                            | bun_sys::O::WRONLY
                            | bun_sys::O::TRUNC
                            | bun_sys::O::CLOEXEC,
                        0o644,
                    );

                    match file {
                        bun_sys::Result::Err(err) => {
                            Output::err(
                                bun_core::err!("lcovCoverageError"),
                                "Failed to create lcov file",
                                (),
                            );
                            Output::print_error(format_args!("\n{}", err));
                            Global::exit(1);
                        }
                        bun_sys::Result::Ok(f) => {
                            // TODO(port): Zig used `f.writer().adaptToNewApi(buf)` (64 KB
                            // buffered file writer). `bun_sys::File` has no `writer()` yet;
                            // accumulate in a `Vec<u8>` (impl `bun_io::Write`) and flush to
                            // the fd via `write_all` on success below.
                            let buffered: Vec<u8> = Vec::with_capacity(64 * 1024);
                            break 'brk Some((f, path, buffered));
                        }
                    }
                }
            } else {
                None
            };
        // TODO(port): errdefer lcov cleanup — using scopeguard with disarm on success
        let mut lcov_guard = scopeguard::guard(
            &mut lcov_state,
            |s: &mut Option<(File, &bun_core::ZStr, Vec<u8>)>| {
                if REPORTERS_LCOV {
                    if let Some((file, name, _)) = s.take() {
                        let _ = file.close(); // close error is non-actionable (Zig parity: discarded)
                        let _ = bun_sys::unlink(name);
                    }
                }
            },
        );
        // --- LCOV ---

        for entry in byte_ranges.iter_mut() {
            // Check if this file should be ignored based on coveragePathIgnorePatterns
            if !opts.ignore_patterns.is_empty() {
                let utf8 = entry.source_url.slice();
                let relative_path = resolve_path::relative(relative_dir, utf8);

                let mut should_ignore = false;
                for pattern in &opts.ignore_patterns {
                    if bun_glob::r#match(pattern, relative_path).matches() {
                        should_ignore = true;
                        break;
                    }
                }

                if should_ignore {
                    continue;
                }
            }

            let Some(mut report) =
                CodeCoverageReport::generate(vm.global(), entry, opts.ignore_sourcemap)
            else {
                continue;
            };

            if REPORTERS_TEXT {
                let mut fraction = base_fraction;
                if coverage::Text::write_format(
                    &report,
                    max_filepath_length,
                    &mut fraction,
                    relative_dir,
                    console_writer,
                    ENABLE_ANSI_COLORS,
                )
                .is_err()
                {
                    continue;
                }
                avg.functions += fraction.functions;
                avg.lines += fraction.lines;
                avg.stmts += fraction.stmts;
                avg_count += 1.0;
                if fraction.failing {
                    failing = true;
                }

                console_writer.extend_from_slice(b"\n");
            }

            if REPORTERS_LCOV {
                if let Some((_, _, buffered)) = lcov_guard.as_mut() {
                    if coverage::Lcov::write_format(&report, relative_dir, buffered).is_err() {
                        continue;
                    }
                }
            }

            drop(report);
        }

        if REPORTERS_TEXT {
            {
                if avg_count == 0.0 {
                    avg.functions = 0.0;
                    avg.lines = 0.0;
                    avg.stmts = 0.0;
                } else {
                    avg.functions /= avg_count;
                    avg.lines /= avg_count;
                    avg.stmts /= avg_count;
                }

                let failed = if avg_count > 0.0 {
                    base_fraction
                } else {
                    Fraction {
                        functions: 0.0,
                        lines: 0.0,
                        stmts: 0.0,
                        ..Default::default()
                    }
                };

                coverage::Text::write_format_with_values(
                    b"All files",
                    max_filepath_length,
                    avg,
                    failed,
                    failing,
                    &mut console,
                    false,
                    ENABLE_ANSI_COLORS,
                )?;

                console.write_all(&Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><d> |<r>\n"))?;
            }

            // TODO(port): console_writer.flush() — Vec<u8> has nothing to flush
            console.write_all(&console_buffer)?;
            console.write_all(&Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><d>"))?;
            // Spec uses `catch return` (NOT `try`) — Zig's `errdefer` does not
            // fire on a success-return, so disarm the lcov cleanup guard before
            // the early `Ok(())` (matches Zig: temp file is left for the OS).
            if console
                .splat_byte_all(b'-', max_filepath_length + 2)
                .is_err()
            {
                let _ = scopeguard::ScopeGuard::into_inner(lcov_guard);
                return Ok(());
            }
            if console
                .write_all(&Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                    "|---------|---------|-------------------<r>\n",
                ))
                .is_err()
            {
                let _ = scopeguard::ScopeGuard::into_inner(lcov_guard);
                return Ok(());
            }

            opts.fractions.failing = failing;
            Output::flush();
        }

        if REPORTERS_LCOV {
            // `try lcov_writer.flush()` — keep the errdefer guard armed across the
            // write so an error here still closes + unlinks the temp file.
            if let Some((lcov_file, _, buffered)) = &mut **lcov_guard {
                if let bun_sys::Result::Err(e) = lcov_file.write_all(buffered) {
                    // `lcov_guard` drops on this early return → close + unlink
                    // (mirrors Zig's `errdefer`).
                    return Err(bun_core::Error::from(e));
                }
            }
            // Flush succeeded — disarm the errdefer cleanup.
            let state = scopeguard::ScopeGuard::into_inner(lcov_guard);
            if let Some((lcov_file, lcov_name, _)) = state.take() {
                let _ = lcov_file.close();
                let cwd = Fd::cwd();
                if let Err(err) = bun_sys::move_file_z(
                    cwd,
                    lcov_name,
                    cwd,
                    resolve_path::join_abs_string_z::<bun_path::platform::Auto>(
                        relative_dir,
                        &[&opts.reports_directory, b"lcov.info"],
                    ),
                ) {
                    Output::err(err, "Failed to save lcov.info file", ());
                    Global::exit(1);
                }
            }
        } else {
            let _ = scopeguard::ScopeGuard::into_inner(lcov_guard);
        }
        Ok(())
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn BunTest__shouldGenerateCodeCoverage(test_name_str: bun_core::String) -> bool {
    let zig_slice = test_name_str.to_utf8();
    // In this particular case, we don't actually care about non-ascii latin1 characters.
    // so we skip the ascii check
    let slice: &[u8] = zig_slice.slice();

    // always ignore node_modules.
    if strings::contains(slice, b"/node_modules/") || strings::contains(slice, b"\\node_modules\\")
    {
        return false;
    }

    let ext = bun_path::extension(slice);
    // TODO(port): std.fs.path.extension — using bun_path equivalent
    // SAFETY: `VirtualMachine::get()` returns the process-lifetime VM pointer; only
    // called from the JS thread once a VM exists.
    let loader_by_ext = VirtualMachine::get()
        .as_mut()
        .transpiler
        .options
        .loader(ext);

    // allow file loader just incase they use a custom loader with a non-standard extension
    if !(loader_by_ext.is_javascript_like() || loader_by_ext == bun_ast::Loader::File) {
        return false;
    }

    if let Some(runner) = jest::Jest::runner() {
        if runner.test_options.coverage.skip_test_files {
            let name_without_extension = &slice[0..slice.len() - ext.len()];
            for suffix in scanner::TEST_NAME_SUFFIXES {
                if strings::ends_with(name_without_extension, suffix) {
                    return false;
                }
            }
        }
    }

    true
}

pub struct TestCommand;

impl TestCommand {
    pub const NAME: &'static str = "test";
    // pub use bun_options_types::code_coverage_options::{CodeCoverageOptions, Reporter, Reporters};
    // PORT NOTE: re-exports moved to top-level `use` per crate map.

    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        Output::IS_GITHUB_ACTION.store(
            Output::is_github_action(),
            core::sync::atomic::Ordering::Relaxed,
        );
        // PORT NOTE: Zig `Output.is_github_action = Output.isGithubAction()` — Rust uses an
        // AtomicBool global; `is_github_action()` performs the env-based detection.

        if !ctx.test_options.test_worker {
            // print the version so you know its doing stuff if it takes a sec
            let w = Output::writer();
            let colors = Output::enable_ansi_colors_stdout();
            let _ = w.write_all(&if colors {
                Output::pretty_fmt::<true>(const_format::concatcp!(
                    "<r><b>bun test <r><d>v",
                    Global::package_json_version_with_sha,
                    "<r>"
                ))
            } else {
                Output::pretty_fmt::<false>(const_format::concatcp!(
                    "<r><b>bun test <r><d>v",
                    Global::package_json_version_with_sha,
                    "<r>"
                ))
            });
            if ctx.test_options.parallel > 0 {
                if colors {
                    let _ = write!(
                        w,
                        " \x1b[1;2m{}\u{00d7} PARALLEL\x1b[0m",
                        ctx.test_options.parallel
                    );
                } else {
                    let _ = write!(w, " {}x PARALLEL", ctx.test_options.parallel);
                }
            }
            let _ = w.write_all(b"\n");
            Output::flush();
        }

        // PORT NOTE: Zig used `ctx.allocator.create` with no destroy. `exec()` never
        // returns before process exit, so the heap allocation outlives all observers.
        // `Loader::init` borrows the map; erase to `'static` via raw pointer round-trip
        // (the map is never freed — process-lifetime singleton).
        let env_map: *mut DotEnv::Map = bun_core::heap::into_raw(Box::new(DotEnv::Map::init()));
        // SAFETY: `env_map` is heap-allocated and never freed; valid for process lifetime.
        let mut env_loader: Box<DotEnv::Loader> =
            Box::new(DotEnv::Loader::init(unsafe { &mut *env_map }));
        jsc::initialize(false);
        bun_http::http_thread::init(&Default::default());

        let enable_random = ctx.test_options.randomize;
        let seed: u32 = if enable_random {
            ctx.test_options
                .seed
                .unwrap_or_else(|| bun::fast_random() as u32) // @truncate
        } else {
            0
        }; // seed is limited to u32 so storing it in js doesn't lose precision
        // Persist the chosen seed so --parallel forwards it to every worker;
        // otherwise each worker would draw its own and the printed --seed=N
        // would not reproduce the run.
        if enable_random {
            ctx.test_options.seed = Some(seed);
        }
        // PORT NOTE: Zig threads a `std.Random` vtable; Rust `DefaultPrng` is `Copy`, so
        // pass the prng by value to TestRunner and keep a local copy for shuffling.
        let random_instance: Option<bun::rand::DefaultPrng> = if enable_random {
            Some(bun::rand::DefaultPrng::init(seed as u64))
        } else {
            None
        };

        let mut snapshot_file_buf: Vec<u8> = Vec::new();
        // TODO(port): `Snapshots::ValuesHashMap` is an inherent associated
        // type alias (unstable); spell out the underlying map until that
        // stabilises or the alias is hoisted to module scope.
        let mut snapshot_values: bun_collections::HashMap<u64, Box<[u8]>> =
            bun_collections::HashMap::new();
        let mut snapshot_counts: StringHashMap<usize> = StringHashMap::new();
        let mut inline_snapshots_to_write: ArrayHashMap<FileId, Vec<InlineSnapshotToWrite>> =
            ArrayHashMap::new();
        jsc::virtual_machine::isBunTest.store(true, core::sync::atomic::Ordering::Relaxed);

        // Borrowed-slice views (`&[&[u8]]`) over owned `Vec<Box<[u8]>>` config so the
        // TestRunner / Scanner field types (`Option<&[&[u8]]>`) line up. The owned
        // backing `Vec`s live in `ctx` for the process lifetime, so each element
        // is detached to `&'static [u8]` up front (lets the outer view detach to
        // `&'static [&'static [u8]]` below without a nested-lifetime bitcast).
        let concurrent_test_glob_view: Option<Vec<&'static [u8]>> =
            ctx.test_options.concurrent_test_glob.as_ref().map(|v| {
                v.iter()
                    .map(|b| unsafe { bun_ptr::detach_lifetime::<u8>(b) })
                    .collect()
            });
        let path_ignore_patterns_view: Vec<&'static [u8]> = ctx
            .test_options
            .path_ignore_patterns
            .iter()
            .map(|b| unsafe { bun_ptr::detach_lifetime::<u8>(b) })
            .collect();

        // PORT NOTE: Zig used `ctx.allocator.create` with no destroy. PORTING.md
        // §Forbidden bans leaking; keep an owned `Box` local — `exec()` never
        // returns before process exit, so the heap allocation outlives all
        // raw-pointer observers (e.g. `Jest::RUNNER` below).
        let mut reporter: Box<CommandLineReporter> = Box::new(CommandLineReporter {
            jest: TestRunner {
                default_timeout_ms: ctx.test_options.default_timeout_ms,
                concurrent: ctx.test_options.concurrent,
                randomize: random_instance,
                randomize_seed: if enable_random { Some(seed) } else { None },
                // SAFETY: lifetime-erase to `'static`; backing storage lives in `ctx`
                // (process-lifetime singleton) and `concurrent_test_glob_view` is held
                // in this never-returning frame.
                concurrent_test_glob: concurrent_test_glob_view
                    .as_deref()
                    .map(|s| unsafe { bun_ptr::detach_lifetime(s) }),
                run_todo: ctx.test_options.run_todo,
                only: ctx.test_options.only,
                bail: ctx.test_options.bail,
                max_concurrency: ctx.test_options.max_concurrency,
                // `test_filter_regex` is an erased `*mut RegularExpression` (see
                // options_types::context); cast back to a typed `NonNull` —
                // kept raw so `matches()` can write through it without
                // laundering shared-ref provenance.
                filter_regex: ctx
                    .test_options
                    .test_filter_regex()
                    .map(|p| p.cast::<jsc::RegularExpression>()),
                snapshots: Snapshots {
                    update_snapshots: ctx.test_options.update_snapshots,
                    total: 0,
                    added: 0,
                    passed: 0,
                    failed: 0,
                    // SAFETY: lifetime-erase to `'static`; the backing locals are
                    // declared in this never-returning frame (`exec()` only exits
                    // via process exit), mirroring Zig's stack-address capture.
                    file_buf: unsafe { &mut *(&raw mut snapshot_file_buf) },
                    values: unsafe { &mut *(&raw mut snapshot_values) },
                    counts: unsafe { &mut *(&raw mut snapshot_counts) },
                    _current_file: None,
                    snapshot_dir_path: None,
                    inline_snapshots_to_write: unsafe {
                        &mut *(&raw mut inline_snapshots_to_write)
                    },
                    last_error_snapshot_name: None,
                },
                bun_test_root: bun_test::BunTestRoot::init(),
                // PORT NOTE: Zig zero-init defaults; `TestRunner` cannot derive
                // `Default` because of the `&'a TestOptions` field, so spell the
                // remaining fields out explicitly.
                current_file: jest::CurrentFile::default(),
                files: jest::FileList::default(),
                index: jest::FileMap::default(),
                last_file: 0,
                drainer: Default::default(),
                has_pending_tests: false,
                default_timeout_override: u32::MAX,
                // SAFETY: lifetime-erase to `'static`; `ctx` is the
                // process-lifetime CLI context and `exec()` never returns.
                test_options: unsafe { &*(&raw const ctx.test_options) },
                unhandled_errors_between_tests: 0,
                summary: Summary::default(),
            },
            last_dot: 0,
            prev_file: 0,
            repeat_count: 1,
            last_printed_dot: core::cell::Cell::new(false),
            worker_ipc_file_idx: None,
            failures_to_repeat_buf: Vec::new(),
            skips_to_repeat_buf: Vec::new(),
            todos_to_repeat_buf: Vec::new(),
            reporters: ReportersConfig::default(),
        });
        // PORT NOTE: `defer { if (reporter.reporters.junit) |fr| fr.deinit() }` — handled by Drop.
        reporter.repeat_count = ctx.test_options.repeat_count.max(1);
        // SAFETY: single-threaded CLI startup; `reporter` is a `Box` that lives
        // until `exec()` exits the process, so `&mut reporter.jest` remains
        // valid for the process lifetime.
        unsafe {
            jest::Jest::RUNNER.write(Some(core::ptr::NonNull::from(&mut reporter.jest)));
        }
        // PORT NOTE: `reporter.jest.test_options` is initialised in the struct
        // literal above (lifetime-erased); the post-init assignment is dropped.

        if ctx.test_options.reporters.junit {
            reporter.reporters.junit = Some(JunitReporter::init());
        }
        if ctx.test_options.reporters.dots {
            reporter.reporters.dots = true;
        }
        if ctx.test_options.reporters.only_failures {
            reporter.reporters.only_failures = true;
        } else if Output::is_ai_agent() {
            reporter.reporters.only_failures = true; // only-failures defaults to true for ai agents
        }

        bun_ast::initialize_store();
        // SAFETY: `init` returns the heap-allocated process-lifetime VM; deref once.
        let vm: &mut VirtualMachine = unsafe {
            &mut *VirtualMachine::init(jsc::virtual_machine::InitOptions {
                // Clone (not take): ParallelRunner::run_as_coordinator → build_worker_argv
                // reads ctx.args.{conditions,define,loaders,tsconfig_override,drop,
                // main_fields,extension_order,env_files,feature_flags,preserve_symlinks,
                // allow_addons,disable_default_env_files,jsx} after this point to forward
                // them to workers. Zig spec passes ctx.args by value-copy here.
                transform_options: ctx.args.clone(),
                debugger: core::mem::take(&mut ctx.runtime_options.debugger),
                log: core::ptr::NonNull::new(ctx.log),
                env_loader: core::ptr::NonNull::new(
                    (&raw mut *env_loader).cast::<DotEnv::Loader<'static>>(),
                ),
                // we must store file descriptors because we reuse them for
                // iterating through the directory tree recursively
                //
                // in the future we should investigate if refactoring this to not
                // rely on the dir fd yields a performance improvement
                store_fd: true,
                smol: ctx.runtime_options.smol,
                is_main_thread: true,
                ..Default::default()
            })?
        };
        vm.argv = core::mem::take(&mut ctx.passthrough);
        // Clone (not take): build_worker_argv reads ctx.preloads to forward --preload.
        vm.preload = ctx.preloads.clone();
        vm.transpiler.options.rewrite_jest_for_tests = true;
        bun_http::EXPERIMENTAL_HTTP2_CLIENT_FROM_CLI.store(
            ctx.runtime_options.experimental_http2_fetch,
            core::sync::atomic::Ordering::Relaxed,
        );
        bun_http::EXPERIMENTAL_HTTP3_CLIENT_FROM_CLI.store(
            ctx.runtime_options.experimental_http3_fetch,
            core::sync::atomic::Ordering::Relaxed,
        );
        vm.transpiler.options.env.behavior =
            bun_bundler::options::EnvBehavior::LoadAllWithoutInlining;

        let node_env_entry = env_loader.map.get_or_put_without_value(b"NODE_ENV")?;
        if !node_env_entry.found_existing {
            *node_env_entry.key_ptr = Box::<[u8]>::from(&**node_env_entry.key_ptr);
            *node_env_entry.value_ptr = DotEnv::HashTableValue {
                value: Box::<[u8]>::from(b"test" as &[u8]),
                conditional: false,
            };
        }

        vm.transpiler.configure_defines()?;

        vm.load_extra_env_and_source_code_printer();
        vm.is_main_thread = true;
        VirtualMachine::set_is_main_thread_vm(true);

        if ctx.test_options.isolate {
            vm.test_isolation_enabled = true;
            vm.auto_killer.enabled = true;
        }

        if ctx.test_options.coverage.enabled {
            vm.transpiler.options.code_coverage = true;
            vm.transpiler.options.minify_syntax = false;
            vm.transpiler.options.minify_identifiers = false;
            vm.transpiler.options.minify_whitespace = false;
            vm.transpiler.options.dead_code_elimination = false;
            vm.global().vm().set_control_flow_profiler(true);
        }

        // For tests, we default to UTC time zone
        // unless the user inputs TZ="", in which case we use local time zone
        let mut tz_name: &[u8] =
            // We use the string "Etc/UTC" instead of "UTC" so there is no normalization difference.
            b"Etc/UTC";

        // SAFETY: `vm.transpiler.env` is the process-lifetime DotEnv loader pointer.
        if let Some(tz) = unsafe { (*vm.transpiler.env).get(b"TZ") } {
            tz_name = tz;
        }

        if !tz_name.is_empty() {
            _ = vm.global().set_time_zone(&ZigString::init(tz_name));
        }

        if ctx.test_options.test_worker {
            // Worker mode: skip discovery; files arrive over stdin and
            // results go out over fd 3. Never returns.
            ParallelRunner::run_as_worker(&mut reporter, vm, ctx);
        }

        // Start the debugger before we scan for files
        // But, don't block the main thread waiting if they used --inspect-wait.
        vm.ensure_debugger(false)?;

        let mut scanner = Scanner::init(&mut vm.transpiler, ctx.positionals.len()).expect("oom");
        // SAFETY: lifetime-erase; `path_ignore_patterns_view` lives in this never-returning
        // frame, underlying bytes live in `ctx` (process-lifetime).
        scanner.path_ignore_patterns =
            unsafe { bun_ptr::detach_lifetime(&path_ignore_patterns_view[..]) };
        let has_relative_path = 'hr: {
            for arg in &ctx.positionals {
                if bun_paths::is_absolute(arg)
                    || strings::starts_with(arg, b"./")
                    || strings::starts_with(arg, b"../")
                    || (cfg!(windows)
                        && (strings::starts_with(arg, b".\\")
                            || strings::starts_with(arg, b"..\\")))
                {
                    break 'hr true;
                }
            }
            false
        };
        if has_relative_path {
            // One of the files is a filepath. Instead of treating the
            // arguments as filters, treat them as filepaths
            let file_or_dirnames = &ctx.positionals[1..];
            for arg in file_or_dirnames {
                match scanner.scan(arg) {
                    Ok(()) => {}
                    Err(scanner::ScanError::OutOfMemory) => bun::out_of_memory(),
                    // don't error if multiple are passed; one might fail
                    // but the others may not
                    Err(scanner::ScanError::DoesNotExist) => {
                        if file_or_dirnames.len() == 1 {
                            if Output::is_ai_agent() {
                                pretty_errorln!(
                                    "Test filter <b>{}<r> had no matches in --cwd={}",
                                    bun_fmt::quote(arg),
                                    bun_fmt::quote(FileSystem::instance().top_level_dir)
                                );
                            } else {
                                pretty_errorln!(
                                    "Test filter <b>{}<r> had no matches",
                                    bun_fmt::quote(arg)
                                );
                            }
                            vm.exit_handler.exit_code = 1;
                            vm.is_shutting_down = true;
                            let vm_ptr: *mut VirtualMachine = vm;
                            vm.run_with_api_lock(|| unsafe { (*vm_ptr).global_exit() });
                        }
                    }
                }
            }
        } else {
            // Treat arguments as filters and scan the codebase
            // SAFETY: bytes live in `ctx` (process-lifetime) and this frame
            // never returns; detach the inner lifetime once at construction so
            // POSIX can borrow this Vec directly without a second allocation.
            let filter_names_owned: Vec<&'static [u8]> = if ctx.positionals.is_empty() {
                Vec::new()
            } else {
                ctx.positionals[1..]
                    .iter()
                    .map(|b| unsafe { bun_ptr::detach_lifetime::<u8>(&**b) })
                    .collect()
            };
            #[cfg(windows)]
            let filter_names: &[&[u8]] = &filter_names_owned;

            // PORT NOTE: on Windows the Zig duped+mutated each filter to swap
            // `/`→`\` and stored the dup; on POSIX it borrowed straight from
            // `ctx.positionals`. Rust unifies on a `Vec<&[u8]>` view either
            // way (already built above as `filter_names_owned`); the Windows
            // branch additionally needs an owned backing `Vec<Box<[u8]>>` for
            // the rewritten bytes plus a second view vec over those boxes.
            #[cfg(windows)]
            let filter_names_normalized_storage: Vec<Box<[u8]>> = {
                let mut normalized = Vec::with_capacity(filter_names.len());
                for in_ in filter_names {
                    let mut to_normalize = in_.to_vec();
                    bun_path::resolve_path::posix_to_platform_in_place::<u8>(&mut to_normalize);
                    normalized.push(to_normalize.into_boxed_slice());
                }
                normalized
            };
            #[cfg(windows)]
            let filter_names_normalized: Vec<&'static [u8]> = filter_names_normalized_storage
                .iter()
                // SAFETY: the rewritten bytes are NOT `'static` — they live in
                // `filter_names_normalized_storage`, a local `Vec<Box<[u8]>>`
                // in this frame. Sound only because this frame never returns
                // (every exit path is `global_exit()`), so the storage Vec is
                // never dropped while `scanner.filter_names` is observed.
                .map(|b| unsafe { bun_ptr::detach_lifetime::<u8>(b) })
                .collect();
            #[cfg(not(windows))]
            let filter_names_normalized: &Vec<&'static [u8]> = &filter_names_owned;
            // PORT NOTE: Zig's `defer free` on Windows maps to Drop of the
            // `Vec<Box<[u8]>>` storage above — but Drop never actually runs
            // here (frame never returns); the storage simply outlives use.
            // SAFETY: lifetime-erase the outer borrow; the view vec and (on
            // Windows) its backing storage live in this never-returning frame,
            // and the underlying bytes are either in `ctx` (process-lifetime)
            // or in `filter_names_normalized_storage` above.
            scanner.filter_names =
                unsafe { bun_ptr::detach_lifetime(&filter_names_normalized[..]) };

            // PORT NOTE: Zig used `vm.allocator.dupe` (arena-scoped). PORTING.md
            // §Forbidden bans leaking to satisfy a borrow — own the joined
            // path in a hoisted buffer and borrow from it.
            let dir_to_scan_owned: Vec<u8>;
            let dir_to_scan: &[u8] = 'brk: {
                if !ctx.debug.test_directory.is_empty() {
                    dir_to_scan_owned = resolve_path::join_abs::<bun_path::platform::Auto>(
                        scanner.fs.top_level_dir,
                        &ctx.debug.test_directory,
                    )
                    .into();
                    break 'brk &dir_to_scan_owned;
                }

                break 'brk scanner.fs.top_level_dir;
            };

            match scanner.scan(dir_to_scan) {
                Ok(()) => {}
                Err(scanner::ScanError::OutOfMemory) => bun::out_of_memory(),
                Err(scanner::ScanError::DoesNotExist) => {
                    if Output::is_ai_agent() {
                        pretty_errorln!(
                            "<red>Failed to scan non-existent root directory for tests:<r> {} in --cwd={}",
                            bun_fmt::quote(dir_to_scan),
                            bun_fmt::quote(FileSystem::instance().top_level_dir)
                        );
                    } else {
                        pretty_errorln!(
                            "<red>Failed to scan non-existent root directory for tests:<r> {}",
                            bun_fmt::quote(dir_to_scan)
                        );
                    }
                    vm.exit_handler.exit_code = 1;
                    vm.is_shutting_down = true;
                    let vm_ptr: *mut VirtualMachine = vm;
                    vm.run_with_api_lock(|| unsafe { (*vm_ptr).global_exit() });
                }
            }
        }

        let mut all_test_files = scanner.take_found_test_files().expect("oom");
        // Snapshot the count before `test_files` mutably borrows `all_test_files`
        // so the watcher-enable check below can read it without reborrowing.
        let all_test_files_count = all_test_files.len();
        let search_count = scanner.search_count;
        drop(scanner);

        // When --changed or --shard filters the discovered test files
        // down to zero, the "No tests found!" error path is suppressed
        // and the run exits 0 — an empty shard or an unchanged tree
        // is not a misconfiguration.
        let mut pass_with_no_tests_from_filter = false;
        let mut changed_module_graph_files: Vec<Box<[u8]>> = Vec::new();
        // PORT NOTE: defer free handled by Drop.
        let mut test_files: &mut [PathString] = if let Some(changed_since) =
            &ctx.test_options.changed
        {
            'brk: {
                // If the Scanner found nothing, fall through to the existing
                // "no tests found" error path rather than treating it as a
                // --changed success.
                if all_test_files.is_empty() {
                    break 'brk &mut all_test_files[..];
                }
                // TODO(port): borrowck — all_test_files ownership vs slicing; Phase B reshape

                let result = match ChangedFilesFilter::filter(
                    &ctx,
                    vm,
                    &mut all_test_files[..],
                    changed_since,
                ) {
                    Ok(r) => r,
                    Err(err) => {
                        Output::err(err, "--changed: unable to determine affected tests", ());
                        Global::exit(1);
                    }
                };
                changed_module_graph_files = result.module_graph_files;
                if result.test_files.is_empty() && result.changed_count == 0 {
                    pretty_error!("<r><d>--changed:<r> no changed files, nothing to run\n");
                    pass_with_no_tests_from_filter = true;
                } else if result.test_files.is_empty() {
                    pretty_error!(
                        "<r><d>--changed:<r> {} changed file{}, but no test files are affected\n",
                        result.changed_count,
                        if result.changed_count == 1 { "" } else { "s" }
                    );
                    pass_with_no_tests_from_filter = true;
                } else {
                    pretty_error!(
                        "<r><d>--changed:<r> {} changed file{}, running {}/{} test file{}\n",
                        result.changed_count,
                        if result.changed_count == 1 { "" } else { "s" },
                        result.test_files.len(),
                        result.total_tests,
                        if result.total_tests == 1 { "" } else { "s" }
                    );
                }
                Output::flush();
                break 'brk result.test_files;
            }
        } else {
            &mut all_test_files[..]
        };
        // TODO(port): test_files type — Zig is `[]PathString` slice into all_test_files or
        // result.test_files; ownership in Rust needs reshaping. Using &mut [PathString] here.

        // --shard=M/N: sort the test files for determinism, then keep only
        // every Nth file starting at M-1. This round-robin distribution
        // keeps shards roughly balanced regardless of how many files there
        // are, and is stable across runs and machines as long as the set of
        // test files is the same.
        //
        // Only runs when there are files to shard — if the scanner or
        // --changed already produced an empty list, fall through to the
        // existing "No tests found!" / --changed messaging rather than
        // printing a confusing "running 0/0 test files".
        if let Some(shard) = &ctx.test_options.shard {
            if !test_files.is_empty() {
                test_files.sort_by(|a, b| strings::order(a.slice(), b.slice()));

                let mut write: usize = 0;
                let total = test_files.len();
                for i in 0..total {
                    if i % (shard.count as usize) == (shard.index as usize) - 1 {
                        test_files[write] = test_files[i];
                        write += 1;
                    }
                }

                pretty_error!(
                    "<r><d>--shard={}/{}:<r> running {}/{} test file{}\n",
                    shard.index,
                    shard.count,
                    write,
                    test_files.len(),
                    if test_files.len() == 1 { "" } else { "s" }
                );
                Output::flush();

                if write == 0 {
                    // There were test files, but fewer than the shard count so
                    // this shard got none. That's fine — not a "no tests
                    // found" error.
                    pass_with_no_tests_from_filter = true;
                }
                test_files = &mut test_files[0..write];
            }
        }

        // Normally the watcher is only enabled when there are test files to
        // run; `bun test --watch` with nothing matching should still exit.
        // With --changed we always want to keep watching as long as any test
        // files exist, since "nothing changed yet" is the common starting
        // state and editing a source file should kick off a run.
        if !test_files.is_empty()
            || (ctx.test_options.changed.is_some() && all_test_files_count != 0)
        {
            vm.hot_reload = ctx.debug.hot_reload as u8;

            // Install the --changed trigger collector BEFORE the watcher
            // thread starts so a file edit during runAllTests is still
            // recorded. The addFileByPathSlow seeding stays after
            // runAllTests (separate concern; see O_EVTONLY comment
            // below).
            if ctx.test_options.changed.is_some()
                && vm.hot_reload == jsc::virtual_machine::HOT_RELOAD_WATCH
            {
                ChangedFilesFilter::init_watch_trigger();
            }

            match vm.hot_reload {
                jsc::virtual_machine::HOT_RELOAD_HOT => {
                    jsc::hot_reloader::HotReloader::enable_hot_module_reloading(
                        std::ptr::from_mut::<VirtualMachine>(vm),
                        None,
                    );
                }
                jsc::virtual_machine::HOT_RELOAD_WATCH => {
                    jsc::hot_reloader::WatchReloader::enable_hot_module_reloading(
                        std::ptr::from_mut::<VirtualMachine>(vm),
                        None,
                    );
                }
                _ => {}
            }
        }

        let mut coverage_options: CodeCoverageOptions = ctx.test_options.coverage.clone();
        let mut ran_parallel = false;

        if !test_files.is_empty() {
            // Randomize the order of test files if --randomize flag is set
            if let Some(mut rand) = random_instance {
                // PORT NOTE: `std.Random.shuffle` → Fisher–Yates over `DefaultPrng::next_u64`.
                let n = test_files.len();
                if n > 1 {
                    let mut i = n - 1;
                    while i > 0 {
                        // Unbiased range via 128-bit mul (Lemire); matches Zig `Random.uintLessThan`.
                        let j = ((rand.next_u64() as u128 * (i as u128 + 1)) >> 64) as usize;
                        test_files.swap(i, j);
                        i -= 1;
                    }
                }
            }

            if ctx.test_options.parallel > 0 {
                ran_parallel = ParallelRunner::run_as_coordinator(
                    &mut reporter,
                    vm,
                    test_files,
                    &mut *ctx,
                    &mut coverage_options,
                )?;
            } else {
                Self::run_all_tests(&mut reporter, vm, test_files);
            }
        }

        // With --changed, only a subset of test files (possibly none) runs,
        // so the module loader won't naturally add every source file to the
        // watcher. Seed it from the module graph so editing any local source
        // file — including files only reachable from tests that were
        // filtered out — still triggers a restart under --watch.
        //
        // This must happen AFTER runAllTests: during the run the module
        // loader registers loaded files with a readable fd, which
        // RuntimeTranspilerStore reuses on the next load. On macOS
        // addFileByPathSlow opens with O_EVTONLY (not readable); seeding
        // first would hand that fd to the transpiler. Seeding after means
        // loaded files are already present (indexOf early-returns) and only
        // the never-loaded filtered-out subgraph gets an O_EVTONLY entry,
        // which the transpiler never touches. The test harness syncs on the
        // "Ran N tests" summary (printed after this), so seeding completes
        // before the next file edit.
        if ctx.test_options.changed.is_some() && vm.is_watcher_enabled() {
            // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set by
            // `enable_hot_module_reloading`; non-null because
            // `is_watcher_enabled()` checked it. The `c_void` type is a
            // b2-cycle erasure (see field comment in VirtualMachine.rs); the
            // cast recovers the concrete type.
            let watcher =
                unsafe { &mut *vm.bun_watcher.cast::<jsc::hot_reloader::ImportWatcher>() };
            for path in &changed_module_graph_files {
                let loader = vm.transpiler.options.loader(bun_path::extension(path));
                let _ = watcher.add_file_by_path_slow(path, loader);
            }
        }

        let write_snapshots_success = jest::Jest::runner()
            .unwrap()
            .snapshots
            .write_inline_snapshots()?;
        jest::Jest::runner()
            .unwrap()
            .snapshots
            .write_snapshot_file()?;
        if reporter.summary().pass > 20
            && !Output::is_ai_agent()
            && !reporter.reporters.dots
            && !reporter.reporters.only_failures
        {
            if reporter.summary().skip > 0 {
                pretty_error!("\n<r><d>{} tests skipped:<r>\n", reporter.summary().skip);
                Output::flush();

                let error_writer = Output::error_writer();
                let _ = error_writer.write_all(&reporter.skips_to_repeat_buf);
            }

            if reporter.summary().todo > 0 {
                if reporter.summary().skip > 0 {
                    pretty_error!("\n");
                }

                pretty_error!("\n<r><d>{} tests todo:<r>\n", reporter.summary().todo);
                Output::flush();

                let error_writer = Output::error_writer();
                let _ = error_writer.write_all(&reporter.todos_to_repeat_buf);
            }

            if reporter.summary().fail > 0 {
                if reporter.summary().skip > 0 || reporter.summary().todo > 0 {
                    pretty_error!("\n");
                }

                pretty_error!("\n<r><d>{} tests failed:<r>\n", reporter.summary().fail);
                Output::flush();

                let error_writer = Output::error_writer();
                let _ = error_writer.write_all(&reporter.failures_to_repeat_buf);
            }
        }

        Output::flush();

        let mut failed_to_find_any_tests = false;

        if test_files.is_empty() && !pass_with_no_tests_from_filter {
            failed_to_find_any_tests = true;

            // "bun test" - positionals[0] == "test"
            // Therefore positionals starts at [1].
            if ctx.positionals.len() < 2 {
                if Output::is_ai_agent() {
                    // Be very clear to ai.
                    Output::err_generic(
                        "0 test files matching **{{.test,.spec,_test_,_spec_}}.{{js,ts,jsx,tsx}} in --cwd={}",
                        (bun_fmt::quote(FileSystem::instance().top_level_dir),),
                    );
                } else {
                    // Be friendlier to humans.
                    pretty_errorln!(
                        "<yellow>No tests found!<r>\n\nTests need \".test\", \"_test_\", \".spec\" or \"_spec_\" in the filename <d>(ex: \"MyApp.test.ts\")<r>\n"
                    );
                }
            } else {
                if Output::is_ai_agent() {
                    pretty_errorln!(
                        "<yellow>The following filters did not match any test files in --cwd={}:<r>",
                        bun_fmt::quote(FileSystem::instance().top_level_dir)
                    );
                } else {
                    pretty_errorln!(
                        "<yellow>The following filters did not match any test files:<r>"
                    );
                }
                let mut has_file_like: Option<usize> = None;
                for (i, filter) in ctx.positionals[1..]
                    .iter()
                    .enumerate()
                    .map(|(i, f)| (i + 1, f))
                {
                    pretty_error!(" {}", bstr::BStr::new(filter));

                    if has_file_like.is_none()
                        && (strings::ends_with(filter, b".ts")
                            || strings::ends_with(filter, b".tsx")
                            || strings::ends_with(filter, b".js")
                            || strings::ends_with(filter, b".jsx"))
                    {
                        has_file_like = Some(i);
                    }
                }
                if search_count > 0 {
                    pretty_error!("\n{} files were searched ", search_count);
                    Output::print_start_end(ctx.start_time, bun::time::nano_timestamp());
                }

                pretty_errorln!(
                    "\n\n<blue>note<r><d>:<r> Tests need \".test\", \"_test_\", \".spec\" or \"_spec_\" in the filename <d>(ex: \"MyApp.test.ts\")<r>"
                );

                // print a helpful note
                if let Some(i) = has_file_like {
                    pretty_errorln!(
                        "<blue>note<r><d>:<r> To treat the \"{}\" filter as a path, run \"bun test ./{}\"<r>",
                        bstr::BStr::new(&ctx.positionals[i]),
                        bstr::BStr::new(&ctx.positionals[i]),
                    );
                }
            }
            if !Output::is_ai_agent() {
                pretty_error!(
                    "\nLearn more about bun test: <magenta>https://bun.com/docs/cli/test<r>",
                );
            }
        } else {
            pretty_error!("\n");

            if coverage_options.enabled && !ran_parallel {
                // PORT NOTE: nested `switch ... inline else` over 3 runtime bools → 8-way dispatch.
                // PERF(port): was comptime bool dispatch — profile in Phase B
                match (
                    Output::enable_ansi_colors_stderr(),
                    coverage_options.reporters.text,
                    coverage_options.reporters.lcov,
                ) {
                    (true, true, true) => reporter
                        .generate_code_coverage::<true, true, true>(vm, &mut coverage_options)?,
                    (true, true, false) => reporter
                        .generate_code_coverage::<true, false, true>(vm, &mut coverage_options)?,
                    (true, false, true) => reporter
                        .generate_code_coverage::<false, true, true>(vm, &mut coverage_options)?,
                    (true, false, false) => reporter
                        .generate_code_coverage::<false, false, true>(vm, &mut coverage_options)?,
                    (false, true, true) => reporter
                        .generate_code_coverage::<true, true, false>(vm, &mut coverage_options)?,
                    (false, true, false) => reporter
                        .generate_code_coverage::<true, false, false>(vm, &mut coverage_options)?,
                    (false, false, true) => reporter
                        .generate_code_coverage::<false, true, false>(vm, &mut coverage_options)?,
                    (false, false, false) => reporter
                        .generate_code_coverage::<false, false, false>(vm, &mut coverage_options)?,
                }
                // TODO(port): generic param order is <TEXT, LCOV, COLORS>; verify mapping in Phase B
            }

            // `Summary` is `Copy`; take a value snapshot so the `&mut` from
            // `reporter.summary()` doesn't span the whole printing block and
            // conflict with the `reporter.jest.*` reads below.
            let summary: Summary = *reporter.summary();
            let did_label_filter_out_all_tests = summary.did_label_filter_out_all_tests()
                && reporter.jest.unhandled_errors_between_tests == 0;

            if !did_label_filter_out_all_tests {
                struct DotIndenter {
                    indent: bool,
                }

                impl core::fmt::Display for DotIndenter {
                    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                        if self.indent {
                            f.write_str(" ")?;
                        }
                        Ok(())
                    }
                }

                let indenter = DotIndenter {
                    indent: !ctx.test_options.reporters.dots,
                };
                if !indenter.indent {
                    pretty_error!("\n");
                }

                // Display the random seed if tests were randomized
                if random_instance.is_some() {
                    pretty_error!("{}<r>--seed={}<r>\n", &indenter, seed);
                }

                if summary.pass > 0 {
                    pretty_error!("<r><green>");
                }

                pretty_error!("{}{:5>} pass<r>\n", &indenter, summary.pass);

                if summary.skip > 0 {
                    pretty_error!("{}<r><yellow>{:5>} skip<r>\n", &indenter, summary.skip);
                } else if summary.skipped_because_label > 0 {
                    pretty_error!(
                        "{}<r><d>{:5>} filtered out<r>\n",
                        &indenter,
                        summary.skipped_because_label
                    );
                }

                if summary.todo > 0 {
                    pretty_error!("{}<r><magenta>{:5>} todo<r>\n", &indenter, summary.todo);
                }

                if summary.fail > 0 {
                    pretty_error!("<r><red>");
                } else {
                    pretty_error!("<r><d>");
                }

                pretty_error!("{}{:5>} fail<r>\n", &indenter, summary.fail);
                if reporter.jest.unhandled_errors_between_tests > 0 {
                    pretty_error!(
                        "{}<r><red>{:5>} error{}<r>\n",
                        &indenter,
                        reporter.jest.unhandled_errors_between_tests,
                        if reporter.jest.unhandled_errors_between_tests > 1 {
                            "s"
                        } else {
                            ""
                        }
                    );
                }

                let mut print_expect_calls = summary.expectations > 0;
                if reporter.jest.snapshots.total > 0 {
                    let passed = reporter.jest.snapshots.passed;
                    let failed = reporter.jest.snapshots.failed;
                    let added = reporter.jest.snapshots.added;

                    let mut first = true;
                    if print_expect_calls && added == 0 && failed == 0 {
                        print_expect_calls = false;
                        pretty_error!(
                            "{}{:5>} snapshots, {:5>} expect() calls",
                            &indenter,
                            reporter.jest.snapshots.total,
                            summary.expectations
                        );
                    } else {
                        pretty_error!("<d>snapshots:<r> ");

                        if passed > 0 {
                            pretty_error!("<d>{} passed<r>", passed);
                            first = false;
                        }

                        if added > 0 {
                            if first {
                                first = false;
                                pretty_error!("<b>+{} added<r>", added);
                            } else {
                                pretty_error!("<b>, {} added<r>", added);
                            }
                        }

                        if failed > 0 {
                            if first {
                                first = false;
                                pretty_error!("<red>{} failed<r>", failed);
                            } else {
                                pretty_error!(", <red>{} failed<r>", failed);
                            }
                        }
                    }

                    pretty_error!("\n");
                }

                if print_expect_calls {
                    pretty_error!("{}{:5>} expect() calls\n", &indenter, summary.expectations);
                }

                reporter.print_summary();
            } else {
                pretty_error!(
                    "<red>error<r><d>:<r> regex <b>{}<r> matched 0 tests. Searched {} file{} (skipping {} test{}) ",
                    bun_fmt::quote(ctx.test_options.test_filter_pattern.as_ref().unwrap()),
                    summary.files,
                    if summary.files == 1 { "" } else { "s" },
                    summary.skipped_because_label,
                    if summary.skipped_because_label == 1 {
                        ""
                    } else {
                        "s"
                    },
                );
                Output::print_start_end(ctx.start_time, bun::time::nano_timestamp());
            }
        }

        pretty_error!("\n");
        Output::flush();

        reporter.write_junit_report_if_needed();

        if vm.hot_reload == jsc::virtual_machine::HOT_RELOAD_WATCH {
            let vm_ptr: *mut VirtualMachine = vm;
            vm.run_with_api_lock(|| Self::run_event_loop_for_watch(unsafe { &mut *vm_ptr }));
        }
        let summary = reporter.summary();

        let should_fail_on_no_tests = !ctx.test_options.pass_with_no_tests
            && (failed_to_find_any_tests || summary.did_label_filter_out_all_tests());
        if should_fail_on_no_tests
            || summary.fail > 0
            || (coverage_options.enabled
                && coverage_options.fractions.failing
                && coverage_options.fail_on_low_coverage)
            || !write_snapshots_success
        {
            vm.exit_handler.exit_code = 1;
        } else if reporter.jest.unhandled_errors_between_tests > 0 {
            vm.exit_handler.exit_code = 1;
        }
        vm.is_shutting_down = true;
        {
            let vm_ptr: *mut VirtualMachine = vm;
            vm.run_with_api_lock(|| unsafe { (*vm_ptr).global_exit() });
        }
        #[allow(unreachable_code)]
        Ok(())
    }

    fn run_event_loop_for_watch(vm: &mut VirtualMachine) {
        vm.event_loop_ref().tick_possibly_forever();

        loop {
            while vm.is_event_loop_alive() {
                vm.tick();
                vm.event_loop_ref().auto_tick_active();
            }

            vm.event_loop_ref().tick_possibly_forever();
        }
    }

    pub fn run_all_tests(
        reporter_: &mut CommandLineReporter,
        vm_: &mut VirtualMachine,
        files_: &[PathString],
    ) {
        struct Context<'a> {
            reporter: &'a mut CommandLineReporter,
            vm: &'a mut VirtualMachine,
            files: &'a [PathString],
        }
        impl<'a> Context<'a> {
            pub fn begin(&mut self) {
                let reporter = &mut *self.reporter;
                let vm = &mut *self.vm;
                let files = self.files;
                debug_assert!(!files.is_empty());

                let isolate = vm.test_isolation_enabled;

                if files.len() > 1 {
                    for (i, file_name) in files[0..files.len() - 1].iter().enumerate() {
                        if let Err(err) = TestCommand::run(
                            reporter,
                            vm,
                            file_name.slice(),
                            bun_test::FirstLast {
                                first: isolate || i == 0,
                                last: isolate,
                            },
                        ) {
                            handle_top_level_test_error_before_javascript_start(err);
                        }
                        reporter.jest.default_timeout_override = u32::MAX;
                        Global::mimalloc_cleanup(false);
                        if isolate {
                            vm.swap_global_for_test_isolation();
                            reporter
                                .jest
                                .bun_test_root
                                .reset_hook_scope_for_test_isolation();
                        }
                    }
                }

                if let Err(err) = TestCommand::run(
                    reporter,
                    vm,
                    files[files.len() - 1].slice(),
                    bun_test::FirstLast {
                        first: isolate || files.len() == 1,
                        last: true,
                    },
                ) {
                    handle_top_level_test_error_before_javascript_start(err);
                }
            }
        }

        // PERF(port): was MimallocArena bulk-free — profile in Phase B
        // TODO(port): vm_.arena = &arena; vm_.allocator = arena.arena(); — arena threading
        // dropped here. Phase B should reintroduce a bun_alloc::Arena and assign to vm.
        vm_.event_loop_ref().ensure_waker();
        // SAFETY: run_with_api_lock(&self) only acquires the JSC API lock around the
        // closure; ctx holds the unique &mut to the same VM and is the sole mutator.
        let vm_ptr = std::ptr::from_mut::<VirtualMachine>(vm_);
        let mut ctx = Context {
            reporter: reporter_,
            vm: vm_,
            files: files_,
        };
        unsafe { (*vm_ptr).run_with_api_lock(|| ctx.begin()) };
    }

    extern "C" fn timer_noop(_: *mut uws::Timer) {}

    pub fn run(
        reporter: &mut CommandLineReporter,
        vm: &mut VirtualMachine,
        file_name: &[u8],
        first_last: bun_test::FirstLast,
    ) -> Result<(), bun_core::Error> {
        // Capture the raw log pointer (Copy) so the guard does not borrow `vm`.
        let vm_log = vm.log;
        scopeguard::defer! {
            bun_ast::Expr::data_store_reset();
            bun_ast::Stmt::data_store_reset();

            if let Some(log_ptr) = vm_log {
                // SAFETY: vm.log points at the VM-owned Log for the lifetime of the run.
                let log = unsafe { &mut *log_ptr.as_ptr() };
                if log.errors > 0 {
                    let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(Output::error_writer()));
                    log.msgs.clear();
                    log.errors = 0;
                }
            }

            Output::flush();
        }

        // Restore test.only state after each module.
        let prev_only = reporter.jest.only;
        let reporter_ptr: *mut CommandLineReporter = reporter;
        // SAFETY: `reporter` is caller-owned and outlives this guard; raw-ptr
        // escape mirrors Zig's `defer` so the closure does not hold a borrowck
        // lock on `reporter` for the entire function body.
        scopeguard::defer! { unsafe { (*reporter_ptr).jest.only = prev_only; } }

        let resolution = vm.transpiler.resolve_entry_point(file_name)?;
        vm.clear_entry_point()?;

        // `append_slice` interns into the process-static `FilenameStore` and
        // returns `&'static [u8]`, matching Zig's `FilenameStore.append`.
        let file_path: &'static [u8] = FileSystem::instance()
            .filename_store
            .append_slice(resolution.path_pair.primary.text)
            .expect("oom");
        let file_title = resolve_path::relative(FileSystem::instance().top_level_dir, file_path);
        let file_id = jest::Jest::runner()
            .unwrap()
            .get_or_put_file(file_path)
            .file_id;

        // In Github Actions, append a special prefix that will group
        // subsequent log lines into a collapsable group.
        // https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#grouping-log-lines
        let file_prefix: &[u8] = if Output::is_github_action() {
            b"::group::"
        } else {
            b""
        };

        let repeat_count = reporter.repeat_count;
        let mut repeat_index: u32 = 0;
        vm.on_unhandled_rejection_ctx = None;
        vm.on_unhandled_rejection = jest::on_unhandled_rejection::on_unhandled_rejection;

        while repeat_index < repeat_count {
            // Clear the module cache before re-running (except for the first run)
            if repeat_index > 0 {
                vm.clear_entry_point()?;
                let entry = ZigString::init(file_path);
                vm.global().delete_module_registry_entry(&entry)?;
                // Reset per-test snapshot counters so rerun N matches the same
                // snapshot keys as run 1 instead of looking for "test name 2", etc.
                reporter.jest.snapshots.reset_counts();
            }

            let bun_test_root = &mut jest::Jest::runner().unwrap().bun_test_root;
            // Determine if this file should run tests concurrently based on glob pattern
            let should_run_concurrent = reporter.jest.should_file_run_concurrently(file_id);
            bun_test_root.enter_file(file_id, reporter, should_run_concurrent, first_last);
            let bun_test_root_ptr: *mut bun_test::BunTestRoot = bun_test_root;
            // SAFETY: `bun_test_root` is `&'static mut` from `Jest::runner()`;
            // raw-ptr escape mirrors Zig `defer bun_test_root.exitFile()` so the
            // closure does not hold a borrowck lock on it for the loop body.
            scopeguard::defer! { unsafe { (*bun_test_root_ptr).exit_file(); } }

            // SAFETY: `set()` reads only `reporter.{worker_ipc_file_idx, reporters}`
            // and writes only `current_file` — disjoint fields. Fresh raw-ptr
            // split (not the defer-captured `reporter_ptr`) mirrors Zig's
            // freely-aliasing `*CommandLineReporter` without tripping borrowck.
            unsafe {
                let rp: *mut CommandLineReporter = reporter;
                (*rp).jest.current_file.set(
                    file_title,
                    file_prefix,
                    repeat_count,
                    repeat_index,
                    &mut *rp,
                );
            }

            bun_output::scoped_log!(
                bun_test,
                "loadEntryPointForTestRunner(\"{}\")",
                bstr::BStr::new(file_path)
            );
            // PORT NOTE: bun.jsc.Jest.bun_test.debug.group.log → local declare_scope!(bun_test).

            // need to wake up so autoTick() doesn't wait for 16-100ms after loading the entrypoint
            vm.wakeup();
            let promise = vm.load_entry_point_for_test_runner(file_path)?;
            // Only count the file once, not once per repeat
            if repeat_index == 0 {
                reporter.summary().files += 1;
            }

            // S012: `JSInternalPromise` is an `opaque_ffi!` ZST — safe `*mut → &mut` deref.
            match jsc::JSInternalPromise::opaque_mut(promise).status() {
                jsc::js_promise::Status::Rejected => {
                    // `vm.global()` returns `&'static`, decoupled from `vm`'s borrow so
                    // `unhandled_rejection(&mut self, ...)` can reborrow.
                    let global = vm.global();
                    let p = jsc::JSInternalPromise::opaque_mut(promise);
                    let (result, promise_js) = (p.result(global.vm()), p.to_js());
                    vm.unhandled_rejection(global, result, promise_js);
                    reporter.summary().fail += 1;

                    if reporter.jest.bail == reporter.summary().fail {
                        reporter.print_summary();
                        pretty_error!(
                            "\nBailed out after {} failure{}<r>\n",
                            reporter.jest.bail,
                            if reporter.jest.bail == 1 { "" } else { "s" }
                        );
                        reporter.write_junit_report_if_needed();

                        vm.exit_handler.exit_code = 1;
                        vm.is_shutting_down = true;
                        // SAFETY: global_exit diverges; raw-ptr reborrow mirrors Zig
                        // runWithAPILock(*VM, vm, globalExit).
                        let vm_ptr = std::ptr::from_mut::<VirtualMachine>(vm);
                        unsafe { (*vm_ptr).run_with_api_lock(|| (&mut *vm_ptr).global_exit()) };
                    }

                    return Ok(());
                }
                _ => {}
            }

            vm.event_loop_ref().tick();

            'blk: {
                // Check if bun_test is available and has tests to run
                let Some(buntest_strong) = bun_test_root.clone_active_file() else {
                    debug_assert!(false);
                    break 'blk;
                };
                let buntest = buntest_strong.get();

                // Automatically execute bun_test tests
                if buntest.result_queue.readable_length() == 0 {
                    buntest.add_result(bun_test::ResultMsg::Start);
                }
                // `BunTestPtr` is `Rc<BunTestCell>`; clone (refcount++) so the
                // local `buntest_strong` survives for the post-run drain loop and
                // the explicit `drop` below (Zig's `defer buntest_strong.deinit()`).
                bun_test::BunTest::run(buntest_strong.clone(), vm.global())?;

                // Process event loop while bun_test tests are running
                vm.event_loop_ref().tick();

                let mut prev_unhandled_count = vm.unhandled_error_counter;
                while buntest.phase != bun_test::Phase::Done {
                    if buntest.wants_wakeup {
                        buntest.wants_wakeup = false;
                        vm.wakeup();
                    }
                    vm.event_loop_ref().auto_tick();
                    if buntest.phase == bun_test::Phase::Done {
                        break;
                    }
                    vm.event_loop_ref().tick();

                    while prev_unhandled_count < vm.unhandled_error_counter {
                        vm.global().handle_rejected_promises();
                        prev_unhandled_count = vm.unhandled_error_counter;
                    }
                }

                let el = vm.event_loop();
                // SAFETY: el is the VM-owned event loop; vm is passed back as *mut.
                unsafe { (*el).tick_immediate_tasks(std::ptr::from_mut::<VirtualMachine>(vm)) };
                drop(buntest_strong);
            }

            vm.global().handle_rejected_promises();

            if Output::is_github_action() {
                pretty_errorln!("<r>\n::endgroup::\n");
                Output::flush();
            }

            if !vm.test_isolation_enabled {
                // Ensure these never linger across files. Under --isolate this
                // is done by swapGlobalForTestIsolation() (kill+clear) and we
                // need tracking to remain enabled and populated until then.
                vm.auto_killer.clear();
                vm.auto_killer.disable();
            }

            repeat_index += 1;
        }
        Ok(())
    }
}

pub fn handle_top_level_test_error_before_javascript_start(err: bun_core::Error) -> ! {
    if cfg!(debug_assertions) {
        if err != bun_core::err!("ModuleNotFound") {
            bun_core::debug_warn!("Unhandled error: {}", err.name());
        }
    }
    Global::exit(1);
}

pub fn export() {
    // PORT NOTE: force-reference for linkage. In Rust, #[unsafe(no_mangle)] on
    // BunTest__shouldGenerateCodeCoverage above is sufficient. Kept as no-op.
    let _ = BunTest__shouldGenerateCodeCoverage;
    // TODO(port): Zig referenced Scanner.BunTest__shouldGenerateCodeCoverage — verify the
    // export lives here vs in Scanner module.
}

// ported from: src/cli/test_command.zig

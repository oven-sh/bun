use core::ffi::c_ulong;
use std::io::Write as _;

use bun_collections::{StringArrayHashMap, StringHashMap};
use bun_core::output as bun_output;
use bun_core::printer as js_printer;
use crate::Error;
use bun_core::{ZStr, strings};
use bun_js_parser::{self as js_parser, lexer as js_lexer};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::{self};

use super::bun_test::ExecutionEntry;
use super::diff_format::DiffFormatter;
use super::expect::Expect;
use super::expect::get_state::full_test_name;
use super::jest::{FileColumns as _, Jest};
use bun_collections::index_sort;

// TestRunner.File.ID — concrete alias from jest.rs (`pub type FileId = u32`).
type FileId = super::jest::FileId;

bun_core::declare_scope!(inline_snapshot, visible);

/// The conventions of the tool that wrote a snapshot file. Its first line names the tool, and the file keeps them.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Format {
    Bun,
    Jest,
    Vitest,
}

impl Format {
    fn of_file(contents: &[u8]) -> Format {
        let first_line = &contents[..strings::index_of_char_usize(contents, b'\n').unwrap_or(contents.len())];
        if first_line.starts_with(b"// Vitest Snapshot v") {
            Format::Vitest
        } else if first_line.starts_with(b"// Jest Snapshot v") && !strings::contains(first_line, b"//bun.sh/") {
            Format::Jest
        } else {
            Format::Bun
        }
    }

    fn header(self) -> &'static [u8] {
        match self {
            Format::Bun => b"// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n",
            Format::Jest => b"// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing\n",
            Format::Vitest => b"// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html\n",
        }
    }

    /// Between the names of the `describe` blocks and of the test.
    fn name_separator(self) -> &'static [u8] {
        if self == Format::Vitest { b" > " } else { b" " }
    }

    fn hint_separator(self) -> &'static [u8] {
        if self == Format::Vitest { b" > " } else { b": " }
    }

    pub(crate) fn matches(self, saved: &[u8], received: &[u8]) -> bool {
        match self {
            Format::Vitest => saved.trim_ascii() == received.trim_ascii(),
            Format::Bun | Format::Jest => saved == received,
        }
    }
}

struct Entry {
    value: Box<[u8]>,
    /// A snapshot matcher asked for it in this run.
    checked: bool,
}

pub(crate) enum Outcome {
    Passed,
    Written,
    Mismatch { saved: Box<[u8]> },
}

pub(crate) struct Snapshots {
    pub(crate) update_snapshots: bool,
    pub(crate) total: usize,
    pub(crate) added: usize,
    pub(crate) passed: usize,
    pub(crate) failed: usize,

    /// The text of a file in Bun's format, which new entries are appended to.
    file_buf: Vec<u8>,
    values: StringArrayHashMap<Entry>,
    counts: StringHashMap<usize>,
    _current_file: Option<File>,
    /// Directory whose `__snapshots__/` was last created (or found existing);
    /// borrowed from the runner's `File::source.path`, a `Path<'static>`.
    snapshot_dir_path: Option<&'static [u8]>,
    inline_snapshots_to_write: IndexMap<FileId, Vec<InlineSnapshotToWrite>>,
    pub(crate) last_error_snapshot_name: Option<Box<[u8]>>,
}

// Re-export the TSV-mandated container name so the field type matches verbatim.
pub(crate) use bun_collections::ArrayHashMap as IndexMap;

impl Snapshots {
    #[cfg(windows)]
    const SNAPSHOTS_DIR_NAME: &'static [u8] = b"__snapshots__\\";
    #[cfg(not(windows))]
    const SNAPSHOTS_DIR_NAME: &'static [u8] = b"__snapshots__/";

    pub(crate) fn init(update_snapshots: bool) -> Snapshots {
        Snapshots {
            update_snapshots,
            total: 0,
            added: 0,
            passed: 0,
            failed: 0,
            file_buf: Vec::new(),
            values: StringArrayHashMap::new(),
            counts: StringHashMap::new(),
            _current_file: None,
            snapshot_dir_path: None,
            inline_snapshots_to_write: IndexMap::new(),
            last_error_snapshot_name: None,
        }
    }
}

// hoisted out of `impl Snapshots` — inherent associated types are unstable.

pub(crate) struct InlineSnapshotToWrite {
    pub(crate) line: c_ulong,
    pub(crate) col: c_ulong,
    /// owned (was: owned by Snapshots.allocator)
    pub value: Box<[u8]>,
    pub(crate) has_matchers: bool,
    pub(crate) is_added: bool,
    /// static lifetime
    pub(crate) kind: &'static [u8],
    /// owned (was: owned by Snapshots.allocator)
    pub(crate) start_indent: Option<Box<[u8]>>,
    /// owned (was: owned by Snapshots.allocator)
    pub(crate) end_indent: Option<Box<[u8]>>,
}

impl InlineSnapshotToWrite {
    fn less_than_fn(a: &InlineSnapshotToWrite, b: &InlineSnapshotToWrite) -> bool {
        if a.line < b.line {
            return true;
        }
        if a.line > b.line {
            return false;
        }
        if a.col < b.col {
            return true;
        }
        false
    }
}

pub(crate) struct File {
    pub(crate) id: FileId,
    format: Format,
    /// Open while entries may be appended: Bun's format, from the first snapshot matcher on.
    file: Option<bun_sys::File>,
    /// What `values` holds is not what the file holds. Jest's and Vitest's formats, which are written as a whole.
    dirty: bool,
}

/// `path` of the snapshot file of a test file, and how much of it is the directory.
fn snapshot_file_path(file_id: FileId, buf: &mut [u8]) -> (&'static [u8], usize, usize) {
    // `Jest::runner()` would alias the `&mut Snapshots` of every caller, a field of the runner.
    // SAFETY: the runner is set before any `Snapshots` method runs; only its `.files` is read.
    let test_file_source = unsafe {
        let p = Jest::RUNNER.read().expect("Jest runner not set").as_ptr();
        &(*p).files.items_source()[file_id as usize]
    };
    let name = test_file_source.path.name();
    let dir_path = name.dir_with_trailing_slash();
    let mut pos = 0usize;
    for part in [dir_path, Snapshots::SNAPSHOTS_DIR_NAME] {
        buf[pos..pos + part.len()].copy_from_slice(part);
        pos += part.len();
    }
    let dir_len = pos;
    for part in [name.filename, b".snap", b"\0"] {
        buf[pos..pos + part.len()].copy_from_slice(part);
        pos += part.len();
    }
    (dir_path, dir_len, pos - 1)
}

/// natural-compare, which Jest and Vitest sort the keys of a file with.
fn natural_compare(a: &[u16], b: &[u16]) -> core::cmp::Ordering {
    fn code(text: &[u16], at: usize) -> u32 {
        let unit = u32::from(text.get(at).copied().unwrap_or(0));
        match unit {
            45 => 65,
            46..=47 => unit - 1,
            48..=57 => unit + 18,
            58..=64 => unit - 11,
            65..=90 => unit + 11,
            91..=96 => unit - 37,
            97..=122 => unit + 5,
            123..=127 => unit - 63,
            _ => unit,
        }
    }
    const DIGITS: core::ops::RangeInclusive<u32> = 66..=75;
    fn number(text: &[u16], first_digit: usize) -> (f64, usize) {
        let mut end = first_digit + 1;
        while DIGITS.contains(&code(text, end)) {
            end += 1;
        }
        let digits: Vec<u8> = text[first_digit..end].iter().map(|unit| *unit as u8).collect();
        (bun_core::str_utf8(&digits).and_then(|digits| digits.parse().ok()).unwrap_or(0.0), end)
    }

    let (mut at_a, mut at_b) = (0, 0);
    loop {
        let (code_a, code_b) = (code(a, at_a), code(b, at_b));
        let is_number = |code: u32| DIGITS.contains(&code) && code != *DIGITS.start();
        let order = if is_number(code_a) && is_number(code_b) {
            let (number_a, number_b);
            (number_a, at_a) = number(a, at_a);
            (number_b, at_b) = number(b, at_b);
            number_a.total_cmp(&number_b)
        } else {
            at_a += 1;
            at_b += 1;
            code_a.cmp(&code_b)
        };
        if order.is_ne() || code_b == 0 {
            return order;
        }
    }
}

/// jest-snapshot `printBacktickString`
fn write_backtick_string(out: &mut Vec<u8>, text: &[u8]) {
    out.push(b'`');
    let mut rest = text;
    while let Some(i) = strings::index_of_any(rest, b"`\\$") {
        out.extend_from_slice(&rest[..i]);
        if rest[i] != b'$' || rest.get(i + 1) == Some(&b'{') {
            out.push(b'\\');
        }
        out.push(rest[i]);
        rest = &rest[i + 1..];
    }
    out.extend_from_slice(rest);
    out.push(b'`');
}

impl Snapshots {
    /// Reset per-run snapshot counters to 0. Keys stay owned by the map until
    /// `writeSnapshotFile` tears them down on file switch.
    pub(crate) fn reset_counts(&mut self) {
        for v in self.counts.values_mut() {
            *v = 0;
        }
    }

    /// The name the snapshots of the running test have in a file of `format`, and which of them this one is.
    pub(crate) fn add_count(&mut self, expect: &Expect, format: Format, hint: &[u8]) -> Result<(Vec<u8>, usize), Error> {
        self.total += 1;
        let snapshot_name = Self::name_of(expect, format, hint)?;
        // bun_collections::StringHashMap::get_or_put can't hand out `key_ptr`, so return the
        // owned `snapshot_name` (same bytes as the interned key) instead.
        let gop = self
            .counts
            .get_or_put(&snapshot_name)
            .map_err(Error::from)?;
        if gop.found_existing {
            *gop.value_ptr += 1;
        } else {
            *gop.value_ptr = 1;
        }
        let count = *gop.value_ptr;
        Ok((snapshot_name, count))
    }

    fn name_of(expect: &Expect, format: Format, hint: &[u8]) -> Result<Vec<u8>, Error> {
        let parent = expect.parent.as_ref().ok_or(Error::NoTest)?;
        let buntest_strong = parent.bun_test().ok_or(Error::TestNotActive)?;
        let buntest = buntest_strong.get();
        let active = core::ptr::NonNull::from(parent.phase.entry(buntest).ok_or(Error::SnapshotInConcurrentGroup)?);
        let test = parent.phase.sequence(buntest).and_then(|sequence| sequence.test_entry);
        // SAFETY: `buntest_strong` owns the entries of its sequences.
        let entry: &ExecutionEntry = unsafe { test.filter(|_| format != Format::Bun).unwrap_or(active).as_ref() };
        let mut name = full_test_name(entry, format.name_separator());
        if !hint.is_empty() {
            name.extend_from_slice(format.hint_separator());
            name.extend_from_slice(hint);
        }
        if format == Format::Jest && strings::index_of_any(&name, b"\r\n").is_some() {
            name = name.iter().fold(Vec::with_capacity(name.len() + 8), |mut escaped, byte| {
                match byte {
                    b'\r' => escaped.extend_from_slice(b"\\r"),
                    b'\n' => escaped.extend_from_slice(b"\\n"),
                    _ => escaped.push(*byte),
                }
                escaped
            });
        }
        Ok(name)
    }

    /// The format of the snapshot file of the running test. Reads the file, and creates nothing.
    pub(crate) fn format_of(&mut self, expect: &Expect) -> Result<Format, Error> {
        let buntest_strong = expect.bun_test().ok_or(Error::SnapshotFailed)?;
        let buntest = buntest_strong.get();
        let file_id = buntest.file_id;
        if let Some(file) = self._current_file.as_ref().filter(|file| file.id == file_id) {
            return Ok(file.format);
        }
        self.write_snapshot_file()?;

        let mut path_buf = bun_paths::path_buffer_pool::get();
        let (_, _, len) = snapshot_file_path(file_id, path_buf.0.as_mut_slice());
        let path = &path_buf.0[..len];
        let contents = match bun_sys::File::read_from(bun_sys::Fd::cwd(), path) {
            Ok(contents) => contents,
            Err(err) if err.get_errno() == bun_sys::Errno::ENOENT => Vec::new(),
            Err(_) => return Err(Error::FailedToOpenSnapshotFile),
        };
        let format = if !contents.is_empty() {
            Format::of_file(&contents)
        } else if expect.is_in_vitest_test(buntest) {
            Format::Vitest
        } else {
            Format::Bun
        };

        if contents.is_empty() || (self.update_snapshots && format == Format::Bun) {
            self.file_buf.extend_from_slice(format.header());
        } else {
            self.file_buf = contents;
            self.parse_file(path)?;
        }
        if format != Format::Bun {
            self.file_buf = Vec::new();
        }
        self._current_file = Some(File { id: file_id, format, file: None, dirty: false });
        Ok(format)
    }

    /// Compares `received` with the snapshot of the running test that it is the next one of, or saves it.
    pub(crate) fn match_or_write(
        &mut self,
        expect: &Expect,
        received: &[u8],
        hint: &[u8],
    ) -> Result<Outcome, Error> {
        let format = self.format_of(expect)?;
        if format == Format::Bun {
            if let bun_sys::Result::Err(err) = self.open_to_append() {
                // `bun_sys::Tag` is a newtype-struct with assoc consts (lowercase),
                // not an enum — match arms require structural-eq; use if-chain instead.
                return Err(if err.syscall == bun_sys::Tag::mkdir {
                    Error::FailedToMakeSnapshotDirectory
                } else if err.syscall == bun_sys::Tag::open {
                    Error::FailedToOpenSnapshotFile
                } else {
                    Error::SnapshotFailed
                });
            }
        }

        let (mut key, counter) = self.add_count(expect, format, hint)?;
        let mut counter_string_buf = [0u8; 32];
        key.push(b' ');
        key.extend_from_slice(bun_core::fmt::int_as_bytes(&mut counter_string_buf, counter));

        if let Some(entry) = self.values.get_mut(&key) {
            entry.checked = true;
            if format.matches(&entry.value, received) {
                self.passed += 1;
                return Ok(Outcome::Passed);
            }
            if !self.update_snapshots {
                self.failed += 1;
                return Ok(Outcome::Mismatch { saved: entry.value.clone() });
            }
        } else if crate::cli::ci_info::is_ci() && !self.update_snapshots {
            self.last_error_snapshot_name = Some(key.into_boxed_slice());
            return Err(Error::SnapshotCreationNotAllowedInCI);
        }

        if format == Format::Bun {
            let escape = |text| {
                strings::format_escapes(text, strings::QuoteEscapeFormatFlags { quote_char: b'`', ..Default::default() })
            };
            self.file_buf.reserve(key.len() + received.len() + 32);
            write!(self.file_buf, "\nexports[`{}`] = `{}`;\n", escape(&key), escape(received))
                .map_err(|_| Error::WriteError)?;
        } else if let Some(file) = self._current_file.as_mut() {
            file.dirty = true;
        }
        self.added += 1;
        self.values.insert(&key, Entry { value: Box::<[u8]>::from(received), checked: true });
        Ok(Outcome::Written)
    }

    fn parse_file(&mut self, snapshot_file_path: &[u8]) -> Result<(), Error> {
        // SAFETY: VM is thread-local singleton installed before any test runs; lives for the
        // duration of the runner. Per `VirtualMachine::get` doc, callers form a short-lived borrow.
        let vm = VirtualMachine::get().as_mut();
        let opts = js_parser::ParserOptions::init(
            vm.transpiler.options.jsx.clone(),
            bun_ast::Loader::Js,
        );
        // Thread a per-call arena — js_parser is bump-allocated.
        let arena = bun_alloc::Arena::new();
        let mut temp_log = bun_ast::Log::init();

        let source = bun_ast::Source::init_path_string(snapshot_file_path, self.file_buf.as_slice());

        let parser = js_parser::Parser::init(
            opts,
            &mut temp_log,
            &source,
            &vm.transpiler.options.define,
            &arena,
        )?;

        let parse_result = parser.parse()?;
        let mut ast = match parse_result {
            bun_js_parser::Result::Ast(ast) => ast,
            _ => return Err(crate::Error::ParseError),
        };

        if ast.exports_ref.is_empty() {
            return Ok(());
        }
        let exports_ref = ast.exports_ref;

        // TODO: when common js transform changes, keep this updated or add flag to support this version

        for part in ast.parts.as_mut_slice() {
            // `part.stmts` is an arena-owned `StoreSlice<Stmt>`; arena outlives this
            // loop and `ast` is owned here, so unique access is upheld.
            for stmt in part.stmts.slice_mut() {
                match &mut stmt.data {
                    bun_ast::StmtData::SExpr(expr) => {
                        if let bun_ast::ExprData::EBinary(e_binary) = &mut expr.value.data {
                            // deref `StoreRef` once to a plain `&mut E::Binary`
                            // so the borrow checker can see `.left`/`.right` as disjoint
                            // field projections (custom `DerefMut` blocks split-borrows
                            // otherwise).
                            let e_binary = &mut **e_binary;
                            if e_binary.op == bun_ast::Op::Code::BinAssign {
                                let (left, right) = (&mut e_binary.left, &mut e_binary.right);
                                if let bun_ast::ExprData::EIndex(e_index) = &mut left.data {
                                    // split-borrow `index`/`target` so we can take
                                    // `&mut` on `index` (EString::slice needs &mut) while reading
                                    // `target` immutably.
                                    let target_is_exports = matches!(
                                        &e_index.target.data,
                                        bun_ast::ExprData::EIdentifier(target) if target.ref_.eql(exports_ref)
                                    );
                                    if target_is_exports {
                                        if let bun_ast::ExprData::EString(index) =
                                            &mut e_index.index.data
                                        {
                                            if let bun_ast::ExprData::EString(value_string) =
                                                &mut right.data
                                            {
                                                let key = index.slice(&arena);
                                                let value = value_string.slice(&arena);
                                                self.values.insert(
                                                    key,
                                                    Entry { value: Box::<[u8]>::from(value), checked: false },
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        let _ = &mut ast;
        Ok(())
    }

    pub(crate) fn write_snapshot_file(&mut self) -> Result<(), Error> {
        if let Some(file) = self._current_file.take() {
            let result = if file.dirty { self.write_sorted(&file) } else { Ok(()) };
            if let Some(file) = file.file {
                file.write_all(&self.file_buf)
                    .map_err(|_| crate::Error::FailedToWriteSnapshotFile)?;
                let _ = file.close();
            }
            self.file_buf.clear();
            self.file_buf.shrink_to_fit();

            self.values.clear();

            self.counts.clear();
            result?;
        }
        Ok(())
    }

    /// jest-snapshot `saveSnapshotFile`
    #[cold]
    fn write_sorted(&self, file: &File) -> Result<(), Error> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let (_, _, len) = snapshot_file_path(file.id, path_buf.0.as_mut_slice());
        let path = ZStr::from_buf(&path_buf.0[..], len);
        if self.values.is_empty() {
            let _ = bun_sys::unlink(path);
            return Ok(());
        }

        let keys: Vec<Vec<u16>> = self
            .values
            .keys()
            .iter()
            .map(|key| strings::to_utf16_alloc_for_real(key, false, false).unwrap_or_default())
            .collect();
        // Insertion, because the comparison is not known to be a total order, which `sort_by` may panic on.
        let mut order: Vec<usize> = Vec::with_capacity(keys.len());
        for i in 0..keys.len() {
            let at = order.partition_point(|other| natural_compare(&keys[*other], &keys[i]).is_le());
            order.insert(at, i);
        }

        let mut contents = file.format.header().to_vec();
        for i in order {
            contents.extend_from_slice(b"\nexports[");
            write_backtick_string(&mut contents, &self.values.keys()[i]);
            contents.extend_from_slice(b"] = ");
            write_backtick_string(&mut contents, &self.values.values()[i].value);
            contents.extend_from_slice(b";\n");
        }
        bun_sys::File::make_open(path.as_bytes(), bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC, 0o644)
            .and_then(|file| file.write_all(&contents))
            .map_err(|_| Error::FailedToWriteSnapshotFile)
    }

    pub(crate) fn add_inline_snapshot_to_write(
        &mut self,
        file_id: FileId,
        value: InlineSnapshotToWrite,
    ) -> Result<(), Error> {
        let list = self
            .inline_snapshots_to_write
            .entry(file_id)
            .or_default();
        list.push(value);
        Ok(())
    }

    pub(crate) fn write_inline_snapshots(&mut self) -> Result<bool, Error> {
        // `success` is a Cell so the per-iteration error-check guard
        // closure can flip it without holding a &mut across the loop body.
        let success = core::cell::Cell::new(true);
        // SAFETY: see `parse_file` — thread-local VM singleton, short-lived reborrow.
        let vm = VirtualMachine::get().as_mut();

        // The arena is reset() inside the loop, bulk-freeing per-iteration scratch.
        let mut arena = bun_alloc::Arena::new();

        // reshaped for borrowck — iterate by index to allow &mut access to values while reading keys.
        let file_ids: Vec<FileId> = self.inline_snapshots_to_write.keys().to_vec();
        for file_id in file_ids {
            arena.reset();
            let ils_info = self
                .inline_snapshots_to_write
                .get_mut(&file_id)
                .expect("unreachable");

            // The guard runs on every exit of the loop body (continue,
            // fall-through, AND `?` early-return).
            let mut log = scopeguard::guard(bun_ast::Log::init(), |log| {
                if log.errors > 0 {
                    let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(
                        bun_output::error_writer(),
                    ));
                    success.set(false);
                }
            });

            // 1. sort ils_info by row, col
            index_sort::sort_slice_by(ils_info, |a, b| {
                if InlineSnapshotToWrite::less_than_fn(a, b) {
                    core::cmp::Ordering::Less
                } else if InlineSnapshotToWrite::less_than_fn(b, a) {
                    core::cmp::Ordering::Greater
                } else {
                    core::cmp::Ordering::Equal
                }
            });

            // 2. load file text
            // avoid `Jest::runner()` (would alias `&mut TestRunner` over the live
            // `&mut self` / `ils_info` borrow of `runner.snapshots`). See comment in `parse_file`.
            // SAFETY: see `parse_file` — raw-pointer projection to disjoint `.files` field.
            let test_file_source = unsafe {
                let p = Jest::RUNNER.read().expect("Jest runner not set").as_ptr();
                &(*p).files.items_source()[file_id as usize]
            };
            let test_filename: Box<[u8]> = {
                let mut v = test_file_source.path.text.to_vec();
                v.push(0);
                v.into_boxed_slice()
            };
            // SAFETY: NUL appended above
            let test_filename_z = ZStr::from_slice_with_nul(&test_filename[..]);

            let fd = match bun_sys::open(test_filename_z, bun_sys::O::RDWR, 0o644) {
                bun_sys::Result::Ok(r) => r,
                bun_sys::Result::Err(e) => {
                    log.add_error_fmt(
                        &bun_ast::Source::init_empty_file(test_filename_z.as_bytes()),
                        bun_ast::Loc { start: 0 },
                        format_args!(
                            "Failed to update inline snapshot: Failed to open file: {}",
                            bstr::BStr::new(e.name()),
                        ),
                    );
                    continue;
                }
            };
            let file = bun_sys::File::from_fd(fd);

            let file_text: Vec<u8> = file.read_to_end().map_err(Error::from)?;

            let source =
                bun_ast::Source::init_path_string(test_filename_z.as_bytes(), file_text.as_slice());

            let mut result_text: Vec<u8> = Vec::new();

            // 3. start looping, finding bytes from line/col

            let mut uncommitted_segment_end: usize = 0;
            let mut last_byte: usize = 0;
            let mut last_line: c_ulong = 1;
            let mut last_col: c_ulong = 1;
            let mut last_value: &[u8] = b"";
            'ils: for ils in ils_info.iter() {
                if ils.line == last_line && ils.col == last_col {
                    if !strings::eql(&ils.value, last_value) {
                        log.add_error_fmt(
                            &source,
                            bun_ast::Loc {
                                start: i32::try_from(uncommitted_segment_end).unwrap(),
                            },
                            format_args!(
                                "Failed to update inline snapshot: Multiple inline snapshots on the same line must all have the same value:\n{}",
                                DiffFormatter::from_strings(&ils.value, last_value, false),
                            ),
                        );
                    }
                    continue;
                }

                bun_core::scoped_log!(inline_snapshot, "Finding byte for {}/{}", ils.line, ils.col);
                // c_ulong is u32 on Windows (LLP64); widen explicitly.
                #[allow(clippy::useless_conversion)]
                let Some(byte_offset_add) = bun_ast::Source::line_col_to_byte_offset(
                    &file_text[last_byte..],
                    u64::from(last_line),
                    u64::from(last_col),
                    u64::from(ils.line),
                    u64::from(ils.col),
                ) else {
                    bun_core::scoped_log!(inline_snapshot, "-> Could not find byte");
                    log.add_error_fmt(
                        &source,
                        bun_ast::Loc {
                            start: i32::try_from(uncommitted_segment_end).unwrap(),
                        },
                        format_args!(
                            "Failed to update inline snapshot: Ln {}, Col {} not found",
                            ils.line, ils.col
                        ),
                    );
                    continue;
                };

                // found
                last_byte += byte_offset_add;
                last_line = ils.line;
                last_col = ils.col;
                last_value = &ils.value;

                let mut next_start = last_byte;
                bun_core::scoped_log!(inline_snapshot, "-> Found byte {}", next_start);

                let (final_start, final_end, needs_pre_comma): (i32, i32, bool) = 'blk: {
                    let fn_name = ils.kind;
                    if !strings::starts_with(&file_text[next_start..], fn_name) {
                        log.add_error_fmt(
                            &source,
                            bun_ast::Loc {
                                start: i32::try_from(next_start).unwrap(),
                            },
                            format_args!(
                                "Failed to update inline snapshot: Could not find '{}' here",
                                bstr::BStr::new(fn_name)
                            ),
                        );
                        continue 'ils;
                    }
                    next_start += fn_name.len();

                    // `Lexer.initWithoutReading` and `TSXParser.init` both need the same
                    // `Log`, but Rust forbids two live `&'a mut Log`;
                    // derive a raw pointer so borrowck doesn't track the lexer/parser borrow,
                    // matching the pattern in `js_parser::Parser::init`. The unique `&mut`
                    // logically lives inside `parser.lexer`; `log.add_error_fmt` calls below
                    // reborrow via the scopeguard between parser uses.
                    // SAFETY: `log` outlives the `'blk` block; lexer/parser are dropped at
                    // block exit (or `continue 'ils`). See Parser.rs:214 for the provenance
                    // discussion.
                    let log_ptr: *mut bun_ast::Log = &raw mut *log;
                    let mut lexer = js_lexer::Lexer::init_without_reading(
                        // SAFETY: `log_ptr` derived from `&raw mut *log` just above; `log`
                        // outlives `'blk` and no other `&mut Log` is live until `lexer` is
                        // moved into `parser` below.
                        unsafe { &mut *log_ptr },
                        &source,
                        &arena,
                    );
                    if next_start > 0 {
                        // equivalent to lexer.consumeRemainderBytes(next_start)
                        lexer.current += next_start - (lexer.current - lexer.end);
                        lexer.step();
                    }
                    lexer.next()?;
                    // `ParserOptions` isn't `Clone`; rebuild per-iteration.
                    let opts = js_parser::ParserOptions::init(
                        vm.transpiler.options.jsx.clone(),
                        bun_ast::Loader::Js,
                    );
                    // `P::init` takes an out-param
                    // since 9a98701c980c — `P` is ~5 KiB and the previous
                    // `let p = P::init(..)?` shape forced 2-3 by-value moves.
                    // Mirror `init_p!` from `js_parser/parse/parse_entry.rs` here
                    // (that macro is crate-local).
                    let mut __parser_slot =
                        core::mem::MaybeUninit::<js_parser::TSXParser<'_>>::uninit();
                    // `P::init` writes a fully-initialized value on `Ok`. On `Err` we
                    // `?`-return before arming the drop guard, so the slot stays
                    // uninitialized and untouched.
                    js_parser::TSXParser::init(
                        &mut __parser_slot,
                        &arena,
                        core::ptr::NonNull::new(log_ptr).expect("log_ptr derived from &mut *log"),
                        &source,
                        &vm.transpiler.options.define,
                        lexer,
                        opts,
                    )?;
                    // SAFETY: `init` returned `Ok`, so `*__parser_slot` is initialized;
                    // the guard's drop closure is the sole owner of the slot from here.
                    let mut __parser_guard =
                        scopeguard::guard(__parser_slot, |mut s| unsafe { s.assume_init_drop() });
                    // SAFETY: guard armed only after `init` succeeded.
                    let parser: &mut js_parser::TSXParser<'_> =
                        unsafe { __parser_guard.assume_init_mut() };

                    parser.lexer.expect(js_lexer::T::TOpenParen)?;
                    let after_open_paren_loc = parser.lexer.loc().start;
                    if parser.lexer.token == js_lexer::T::TCloseParen {
                        // zero args
                        if ils.has_matchers {
                            log.add_error_fmt(
                                &source,
                                parser.lexer.loc(),
                                format_args!("Failed to update inline snapshot: Snapshot has matchers and yet has no arguments"),
                            );
                            continue 'ils;
                        }
                        let close_paren_loc = parser.lexer.loc().start;
                        parser.lexer.expect(js_lexer::T::TCloseParen)?;
                        break 'blk (after_open_paren_loc, close_paren_loc, false);
                    }
                    if parser.lexer.token == js_lexer::T::TDotDotDot {
                        log.add_error_fmt(
                            &source,
                            parser.lexer.loc(),
                            format_args!("Failed to update inline snapshot: Spread is not allowed"),
                        );
                        continue 'ils;
                    }

                    let before_expr_loc = parser.lexer.loc().start;
                    let expr_1 = parser.parse_expr(js_parser::Level::Comma)?;
                    let after_expr_loc = parser.lexer.loc().start;

                    let mut is_one_arg = false;
                    if parser.lexer.token == js_lexer::T::TComma {
                        parser.lexer.expect(js_lexer::T::TComma)?;
                        if parser.lexer.token == js_lexer::T::TCloseParen {
                            is_one_arg = true;
                        }
                    } else {
                        is_one_arg = true;
                    }
                    let after_comma_loc = parser.lexer.loc().start;

                    if is_one_arg {
                        parser.lexer.expect(js_lexer::T::TCloseParen)?;
                        if ils.has_matchers {
                            break 'blk (after_expr_loc, after_comma_loc, true);
                        } else {
                            if !matches!(expr_1.data, bun_ast::ExprData::EString(_)) {
                                log.add_error_fmt(
                                    &source,
                                    expr_1.loc,
                                    format_args!("Failed to update inline snapshot: Argument must be a string literal"),
                                );
                                continue 'ils;
                            }
                            break 'blk (before_expr_loc, after_expr_loc, false);
                        }
                    }

                    if parser.lexer.token == js_lexer::T::TDotDotDot {
                        log.add_error_fmt(
                            &source,
                            parser.lexer.loc(),
                            format_args!("Failed to update inline snapshot: Spread is not allowed"),
                        );
                        continue 'ils;
                    }

                    let before_expr_2_loc = parser.lexer.loc().start;
                    let expr_2 = parser.parse_expr(js_parser::Level::Comma)?;
                    let after_expr_2_loc = parser.lexer.loc().start;

                    if !ils.has_matchers {
                        log.add_error_fmt(
                            &source,
                            parser.lexer.loc(),
                            format_args!("Failed to update inline snapshot: Snapshot does not have matchers and yet has two arguments"),
                        );
                        continue 'ils;
                    }
                    if !matches!(expr_2.data, bun_ast::ExprData::EString(_)) {
                        log.add_error_fmt(
                            &source,
                            expr_2.loc,
                            format_args!("Failed to update inline snapshot: Argument must be a string literal"),
                        );
                        continue 'ils;
                    }

                    if parser.lexer.token == js_lexer::T::TComma {
                        parser.lexer.expect(js_lexer::T::TComma)?;
                    }
                    if parser.lexer.token != js_lexer::T::TCloseParen {
                        log.add_error_fmt(
                            &source,
                            parser.lexer.loc(),
                            format_args!("Failed to update inline snapshot: Snapshot expects at most two arguments"),
                        );
                        continue 'ils;
                    }
                    parser.lexer.expect(js_lexer::T::TCloseParen)?;

                    break 'blk (before_expr_2_loc, after_expr_2_loc, false);
                };
                let final_start_usize = usize::try_from(final_start).unwrap_or(0);
                let final_end_usize = usize::try_from(final_end).unwrap_or(0);
                bun_core::scoped_log!(
                    inline_snapshot,
                    "  -> Found update range {}-{}",
                    final_start_usize,
                    final_end_usize
                );

                if final_end_usize < final_start_usize
                    || final_start_usize < uncommitted_segment_end
                {
                    log.add_error_fmt(
                        &source,
                        bun_ast::Loc { start: final_start },
                        format_args!("Failed to update inline snapshot: Did not advance."),
                    );
                    continue;
                }

                result_text
                    .extend_from_slice(&file_text[uncommitted_segment_end..final_start_usize]);
                uncommitted_segment_end = final_end_usize;

                // preserve existing indentation level, otherwise indent the same as the start position plus two spaces
                let mut needs_more_spaces = false;
                let start_indent: &[u8] = match &ils.start_indent {
                    Some(s) => s,
                    None => 'd: {
                        let source_until_final_start = &source.contents[..final_start_usize];
                        let line_start =
                            match strings::last_index_of_char(source_until_final_start, b'\n') {
                                Some(newline_loc) => newline_loc + 1,
                                None => 0,
                            };
                        let tail = &source_until_final_start[line_start..];
                        let indent_count = tail
                            .iter()
                            .position(|&c| c != b' ' && c != b'\t')
                            .unwrap_or(tail.len());
                        needs_more_spaces = true;
                        break 'd &tail[..indent_count];
                    }
                };

                let mut re_indented_string: Vec<u8> = Vec::new();
                let re_indented: &[u8] = if !ils.value.is_empty() && ils.value[0] == b'\n' {
                    // append starting newline
                    re_indented_string.extend_from_slice(b"\n");
                    let mut re_indented_source = &ils.value[1..];
                    while !re_indented_source.is_empty() {
                        let next_newline =
                            match strings::index_of_char_usize(re_indented_source, b'\n') {
                                Some(a) => a + 1,
                                None => re_indented_source.len(),
                            };
                        let segment = &re_indented_source[..next_newline];
                        if segment.is_empty() {
                            // last line; loop already exited
                            unreachable!();
                        } else if segment == b"\n" {
                            // zero length line. no indent.
                        } else {
                            // regular line. indent.
                            re_indented_string.extend_from_slice(start_indent);
                            if needs_more_spaces {
                                re_indented_string.extend_from_slice(b"  ");
                            }
                        }
                        re_indented_string.extend_from_slice(segment);
                        re_indented_source = &re_indented_source[next_newline..];
                    }
                    // indent before backtick
                    re_indented_string
                        .extend_from_slice(ils.end_indent.as_deref().unwrap_or(start_indent));
                    &re_indented_string
                } else {
                    &ils.value
                };

                if needs_pre_comma {
                    result_text.extend_from_slice(b", ");
                }
                result_text.extend_from_slice(b"`");
                js_printer::write_pre_quoted_string(
                    re_indented,
                    &mut result_text,
                    b'`',
                    false,
                    false,
                    strings::Encoding::Utf8,
                )?;
                result_text.extend_from_slice(b"`");

                if ils.is_added {
                    // `runner.snapshots` *is* `*self`: going back through `Jest::runner()` would
                    // create a second `&mut Snapshots` aliasing `self` (UB) and invalidate `ils_info`.
                    self.added += 1;
                }
            }

            // commit the last segment
            result_text.extend_from_slice(&file_text[uncommitted_segment_end..]);

            if log.errors > 0 {
                // skip writing the file if there were errors — `log` guard prints on drop.
                continue;
            }

            // 4. write out result_text to the file
            if let Err(e) = file.seek_to(0) {
                log.add_error_fmt(
                    &source,
                    bun_ast::Loc { start: 0 },
                    format_args!(
                        "Failed to update inline snapshot: Seek file error: {}",
                        bstr::BStr::new(e.name()),
                    ),
                );
                continue;
            }

            if let Err(e) = file.write_all(&result_text) {
                log.add_error_fmt(
                    &source,
                    bun_ast::Loc { start: 0 },
                    format_args!(
                        "Failed to update inline snapshot: Write file error: {}",
                        bstr::BStr::new(e.name()),
                    ),
                );
                continue;
            }
            if result_text.len() < file_text.len() {
                if bun_sys::ftruncate(file.handle, result_text.len() as i64).is_err() {
                    panic!("Failed to update inline snapshot: File was left in an invalid state");
                }
            }
        }
        Ok(success.get())
    }

    /// Bun's format: makes the directory and the file.
    fn open_to_append(&mut self) -> bun_sys::Result<()> {
        let Some(current) = self._current_file.as_mut().filter(|file| file.file.is_none()) else {
            return Ok(());
        };
        let mut snapshot_file_path_buf = bun_paths::path_buffer_pool::get();
        let buf = snapshot_file_path_buf.0.as_mut_slice();
        let (dir_path, dir_len, len) = snapshot_file_path(current.id, buf);

        if !self.snapshot_dir_path.is_some_and(|cached| strings::eql_long(dir_path, cached, true)) {
            let after_dir = core::mem::replace(&mut buf[dir_len], 0);
            match bun_sys::mkdir(ZStr::from_buf(&buf[..], dir_len), 0o777) {
                Err(err) if err.get_errno() != bun_sys::Errno::EEXIST => return Err(err),
                _ => self.snapshot_dir_path = Some(dir_path),
            }
            buf[dir_len] = after_dir;
        }

        let mut flags: i32 = bun_sys::O::CREAT | bun_sys::O::RDWR;
        if self.update_snapshots {
            flags |= bun_sys::O::TRUNC;
        }
        let fd = bun_sys::open(ZStr::from_buf(&buf[..], len), flags, 0o644)?;
        current.file = Some(bun_sys::File::from_fd(fd));
        Ok(())
    }
}

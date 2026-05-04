use core::ffi::c_ulong;
use std::io::Write as _;

use bun_collections::{ArrayHashMap, HashMap, StringHashMap};
use bun_core::{self, Error};
use bun_jsc::VirtualMachine;
use bun_js_parser::{self as js_parser, ast as js_ast, lexer as js_lexer, printer as js_printer};
use bun_logger as logger;
use bun_output;
use bun_paths::{self, PathBuffer, MAX_PATH_BYTES, SEP};
use bun_str::{strings, ZStr};
use bun_sys::{self, Fd};
use bun_wyhash::hash;

use crate::diff_format::DiffFormatter;
use crate::expect::Expect;
use crate::jest::{Jest, TestRunner};

// TODO(port): TestRunner.File.ID — exact path depends on jest.rs port; using a local alias.
type FileId = <TestRunner as crate::jest::TestRunnerTypes>::FileId;
// If the above associated-type pattern doesn't land in Phase B, replace with the concrete `u32`/newtype from jest.rs.

bun_output::declare_scope!(inline_snapshot, visible);

pub struct Snapshots<'a> {
    pub update_snapshots: bool,
    pub total: usize,
    pub added: usize,
    pub passed: usize,
    pub failed: usize,

    pub file_buf: &'a mut Vec<u8>,
    // PORT NOTE: LIFETIMES.tsv said `HashMap<usize, String>`; overridden per §Strings (data is bytes) → Box<[u8]>.
    // Key is u64 to match `bun.hash` (Zig uses IdentityContext(usize) but hash returns u64; avoids narrowing cast).
    pub values: &'a mut HashMap<u64, Box<[u8]>>,
    // PORT NOTE: LIFETIMES.tsv said `HashMap<String, usize>`; Zig is `bun.StringHashMap(usize)` → byte-keyed wyhash map.
    pub counts: &'a mut StringHashMap<usize>,
    pub _current_file: Option<File>,
    // TODO(port): lifetime — borrows Jest.runner.files[..].source.path; BACKREF (not owned, never freed).
    pub snapshot_dir_path: Option<core::ptr::NonNull<[u8]>>,
    // TODO(port): LIFETIMES.tsv says `IndexMap<FileId, Vec<..>>`; PORTING.md prefers `bun_collections::ArrayHashMap`.
    pub inline_snapshots_to_write: &'a mut IndexMap<FileId, Vec<InlineSnapshotToWrite>>,
    pub last_error_snapshot_name: Option<Box<[u8]>>,
}

// Re-export the TSV-mandated container name so the field type matches verbatim.
pub use bun_collections::ArrayHashMap as IndexMap;

impl<'a> Snapshots<'a> {
    const FILE_HEADER: &'static [u8] =
        b"// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";

    #[cfg(windows)]
    const SNAPSHOTS_DIR_NAME: &'static [u8] = b"__snapshots__\\";
    #[cfg(not(windows))]
    const SNAPSHOTS_DIR_NAME: &'static [u8] = b"__snapshots__/";

    // std.HashMap(usize, string, bun.IdentityContext(usize), default_max_load_percentage)
    // TODO(port): IdentityContext — key is its own hash; Phase B may want `BuildHasherDefault<IdentityHasher>`.
    pub type ValuesHashMap = HashMap<u64, Box<[u8]>>;
}

pub struct InlineSnapshotToWrite {
    pub line: c_ulong,
    pub col: c_ulong,
    /// owned (was: owned by Snapshots.allocator)
    pub value: Box<[u8]>,
    pub has_matchers: bool,
    pub is_added: bool,
    /// static lifetime
    pub kind: &'static [u8],
    /// owned (was: owned by Snapshots.allocator)
    pub start_indent: Option<Box<[u8]>>,
    /// owned (was: owned by Snapshots.allocator)
    pub end_indent: Option<Box<[u8]>>,
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

pub struct File {
    pub id: FileId,
    // TODO(port): Zig used `std.fs.File` (via `fd.stdFile()`); std::fs is banned. Using bun_sys::File.
    pub file: bun_sys::File,
}

impl<'a> Snapshots<'a> {
    /// Reset per-run snapshot counters to 0. Keys stay owned by the map until
    /// `writeSnapshotFile` tears them down on file switch.
    pub fn reset_counts(&mut self) {
        for v in self.counts.values_mut() {
            *v = 0;
        }
    }

    pub fn add_count(
        &mut self,
        expect: &mut Expect,
        hint: &[u8],
    ) -> Result<(&[u8], usize), Error> {
        // TODO(port): narrow error set
        self.total += 1;
        let snapshot_name = expect.get_snapshot_name(hint)?;
        // PORT NOTE: reshaped for borrowck — Zig's getOrPut returns key_ptr/value_ptr together.
        // bun_collections::StringHashMap::get_or_put takes ownership of the key on miss (frees on hit)
        // and returns (&K, &mut V, found_existing) so we can return the interned key slice.
        let (key, value, found_existing) = self.counts.get_or_put(snapshot_name);
        if found_existing {
            // dup'd name already dropped by get_or_put on hit
            *value += 1;
        } else {
            *value = 1;
        }
        Ok((key.as_slice(), *value))
    }

    pub fn get_or_put(
        &mut self,
        expect: &mut Expect,
        target_value: &[u8],
        hint: &[u8],
    ) -> Result<Option<&[u8]>, Error> {
        // TODO(port): narrow error set
        let mut buntest_strong = expect
            .bun_test()
            .ok_or(bun_core::err!("SnapshotFailed"))?;
        // defer buntest_strong.deinit() → Drop
        let bun_test = buntest_strong.get();
        match self.get_snapshot_file(bun_test.file_id)? {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(err) => {
                return Err(match err.syscall {
                    bun_sys::Syscall::Mkdir => bun_core::err!("FailedToMakeSnapshotDirectory"),
                    bun_sys::Syscall::Open => bun_core::err!("FailedToOpenSnapshotFile"),
                    _ => bun_core::err!("SnapshotFailed"),
                });
            }
        }

        let (name, counter) = self.add_count(expect, hint)?;

        let mut counter_string_buf = [0u8; 32];
        let counter_string = {
            let mut cursor: &mut [u8] = &mut counter_string_buf[..];
            let start_len = cursor.len();
            write!(cursor, "{}", counter).map_err(|_| bun_core::err!("FmtError"))?;
            let written = start_len - cursor.len();
            &counter_string_buf[..written]
        };

        let mut name_with_counter: Vec<u8> =
            Vec::with_capacity(name.len() + 1 + counter_string.len());
        name_with_counter.extend_from_slice(name);
        name_with_counter.push(b' ');
        name_with_counter.extend_from_slice(counter_string);
        // defer free → Drop

        let name_hash: u64 = hash(&name_with_counter);
        if let Some(expected) = self.values.get(&name_hash) {
            // TODO(port): returning &[u8] borrowing self.values; lifetime tied to &mut self.
            return Ok(Some(&**expected));
        }

        // doesn't exist. append to file bytes and add to hashmap.
        // Prevent snapshot creation in CI environments unless --update-snapshots is used
        if bun_core::ci::is_ci() {
            if !self.update_snapshots {
                // Store the snapshot name for error reporting
                // (old name dropped automatically on reassign)
                self.last_error_snapshot_name = Some(name_with_counter.into_boxed_slice());
                return Err(bun_core::err!("SnapshotCreationNotAllowedInCI"));
            }
        }

        let estimated_length = b"\nexports[`".len()
            + name_with_counter.len()
            + b"`] = `".len()
            + target_value.len()
            + b"`;\n".len();
        self.file_buf.reserve(estimated_length + 10);
        write!(
            self.file_buf,
            "\nexports[`{}`] = `{}`;\n",
            strings::format_escapes(&name_with_counter, strings::FormatEscapesOpts { quote_char: b'`' }),
            strings::format_escapes(target_value, strings::FormatEscapesOpts { quote_char: b'`' }),
        )
        .map_err(|_| bun_core::err!("WriteError"))?;

        self.added += 1;
        self.values.insert(name_hash, Box::<[u8]>::from(target_value));
        Ok(None)
    }

    pub fn parse_file(&mut self, file: &File) -> Result<(), Error> {
        // TODO(port): narrow error set
        if self.file_buf.is_empty() {
            return Ok(());
        }

        let vm = VirtualMachine::get();
        let opts = js_parser::Parser::Options::init(vm.transpiler.options.jsx, js_parser::Loader::Js);
        let mut temp_log = logger::Log::init();

        let test_file = Jest::runner().unwrap().files.get(file.id);
        let test_filename = test_file.source.path.name.filename;
        let dir_path = test_file.source.path.name.dir_with_trailing_slash();

        let mut snapshot_file_path_buf = PathBuffer::uninit();
        let buf = snapshot_file_path_buf.as_mut_slice();
        let mut pos = 0usize;
        buf[pos..pos + dir_path.len()].copy_from_slice(dir_path);
        pos += dir_path.len();
        buf[pos..pos + Self::SNAPSHOTS_DIR_NAME.len()].copy_from_slice(Self::SNAPSHOTS_DIR_NAME);
        pos += Self::SNAPSHOTS_DIR_NAME.len();
        buf[pos..pos + test_filename.len()].copy_from_slice(test_filename);
        pos += test_filename.len();
        buf[pos..pos + b".snap".len()].copy_from_slice(b".snap");
        pos += b".snap".len();
        buf[pos] = 0;
        // SAFETY: buf[pos] == 0 written above
        let snapshot_file_path = unsafe { ZStr::from_raw(buf.as_ptr(), pos) };

        let source = logger::Source::init_path_string(snapshot_file_path.as_bytes(), self.file_buf);

        let mut parser = js_parser::Parser::init(
            opts,
            &mut temp_log,
            &source,
            vm.transpiler.options.define,
        )?;

        let parse_result = parser.parse()?;
        let mut ast = match parse_result {
            js_parser::ParseResult::Ast(ast) => ast,
            _ => return Err(bun_core::err!("ParseError")),
        };
        // defer ast.deinit() → Drop

        if ast.exports_ref.is_null() {
            return Ok(());
        }
        let exports_ref = ast.exports_ref;

        // TODO: when common js transform changes, keep this updated or add flag to support this version

        for part in ast.parts.slice() {
            for stmt in part.stmts {
                match &stmt.data {
                    js_ast::StmtData::SExpr(expr) => {
                        if let js_ast::ExprData::EBinary(e_binary) = &expr.value.data {
                            if e_binary.op == js_ast::Op::BinAssign {
                                let left = &e_binary.left;
                                if let js_ast::ExprData::EIndex(e_index) = &left.data {
                                    if let (
                                        js_ast::ExprData::EString(index),
                                        js_ast::ExprData::EIdentifier(target),
                                    ) = (&e_index.index.data, &e_index.target.data)
                                    {
                                        if target.ref_.eql(exports_ref) {
                                            if let js_ast::ExprData::EString(value_string) =
                                                &e_binary.right.data
                                            {
                                                let key = index.slice();
                                                let value = value_string.slice();
                                                // defer { if !isUTF8 free } → Drop on the slice guards
                                                let value_clone: Box<[u8]> =
                                                    Box::<[u8]>::from(value.as_ref());
                                                let name_hash: u64 = hash(key.as_ref());
                                                self.values.insert(name_hash, value_clone);
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

        // PORT NOTE: reshaped for borrowck — Zig's chained `.data == .x and .data.x.y == ...` becomes nested if-let.
        let _ = &mut ast;
        Ok(())
    }

    pub fn write_snapshot_file(&mut self) -> Result<(), Error> {
        // TODO(port): narrow error set
        if let Some(mut file) = self._current_file.take() {
            file.file
                .write_all(self.file_buf)
                .map_err(|_| bun_core::err!("FailedToWriteSnapshotFile"))?;
            file.file.close();
            self.file_buf.clear();
            self.file_buf.shrink_to_fit();

            // values: owned strings dropped by clear()
            self.values.clear();
            // PERF(port): Zig clearAndFree() also releases capacity; HashMap::clear keeps it.

            // counts: owned key strings dropped by clear()
            self.counts.clear();
        }
        Ok(())
    }

    pub fn add_inline_snapshot_to_write(
        &mut self,
        file_id: FileId,
        value: InlineSnapshotToWrite,
    ) -> Result<(), Error> {
        // TODO(port): narrow error set
        let list = self
            .inline_snapshots_to_write
            .entry(file_id)
            .or_insert_with(Vec::new);
        list.push(value);
        Ok(())
    }

    pub fn write_inline_snapshots(&mut self) -> Result<bool, Error> {
        // TODO(port): narrow error set
        // PERF(port): was arena bulk-free per iteration — profile in Phase B.
        // TODO(port): js_parser/lexer APIs likely still require `&Bump`; threading omitted in Phase A.

        // PORT NOTE: `success` is a Cell so the per-iteration `defer if (log.errors > 0)` guard
        // closure can flip it without holding a &mut across the loop body.
        let success = core::cell::Cell::new(true);
        let vm = VirtualMachine::get();
        let opts = js_parser::Parser::Options::init(vm.transpiler.options.jsx, js_parser::Loader::Js);

        // PORT NOTE: reshaped for borrowck — iterate by index to allow &mut access to values while reading keys.
        let file_ids: Vec<FileId> = self.inline_snapshots_to_write.keys().cloned().collect();
        for file_id in file_ids {
            let ils_info = self
                .inline_snapshots_to_write
                .get_mut(&file_id)
                .expect("unreachable");

            // Zig: `defer if (log.errors > 0) { log.print(...); success = false; }`
            // Runs on every exit of the loop body (continue, fall-through, AND `?` early-return).
            let mut log = scopeguard::guard(logger::Log::init(), |log| {
                if log.errors > 0 {
                    let _ = log.print(bun_output::error_writer());
                    success.set(false);
                }
            });

            // 1. sort ils_info by row, col
            ils_info.sort_by(|a, b| {
                if InlineSnapshotToWrite::less_than_fn(a, b) {
                    core::cmp::Ordering::Less
                } else if InlineSnapshotToWrite::less_than_fn(b, a) {
                    core::cmp::Ordering::Greater
                } else {
                    core::cmp::Ordering::Equal
                }
            });

            // 2. load file text
            let test_file = Jest::runner().unwrap().files.get(file_id);
            // TODO(port): arena.dupeZ — using owned Vec<u8> with trailing NUL.
            let test_filename: Box<[u8]> = {
                let mut v = test_file.source.path.text.to_vec();
                v.push(0);
                v.into_boxed_slice()
            };
            // SAFETY: NUL appended above
            let test_filename_z =
                unsafe { ZStr::from_raw(test_filename.as_ptr(), test_filename.len() - 1) };

            let fd = match bun_sys::open(test_filename_z, bun_sys::O::RDWR, 0o644) {
                bun_sys::Result::Ok(r) => r,
                bun_sys::Result::Err(e) => {
                    log.add_error_fmt(
                        &logger::Source::init_empty_file(test_filename_z.as_bytes()),
                        logger::Loc { start: 0 },
                        format_args!(
                            "Failed to update inline snapshot: Failed to open file: {}",
                            bstr::BStr::new(e.name()),
                        ),
                    )?;
                    continue;
                }
            };
            // Zig: `errdefer file.file.close()` — fires on `?` error returns only.
            // PORT NOTE: Zig never closes on the success path (or `continue`); preserve that by
            // disarming via `into_inner` on every non-`?` exit below.
            let mut file = scopeguard::guard(
                File { id: file_id, file: bun_sys::File::from_fd(fd) },
                |mut f| f.file.close(),
            );

            let file_text: Vec<u8> = file
                .file
                .read_to_end(usize::MAX)
                .map_err(|e| Error::from(e))?;

            let source = logger::Source::init_path_string(test_filename_z.as_bytes(), &file_text);

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
                            logger::Loc {
                                start: i32::try_from(uncommitted_segment_end).unwrap(),
                            },
                            format_args!(
                                "Failed to update inline snapshot: Multiple inline snapshots on the same line must all have the same value:\n{}",
                                DiffFormatter {
                                    received_string: &ils.value,
                                    expected_string: last_value,
                                    global_this: vm.global,
                                },
                            ),
                        )?;
                    }
                    continue;
                }

                bun_output::scoped_log!(
                    inline_snapshot,
                    "Finding byte for {}/{}",
                    ils.line,
                    ils.col
                );
                let Some(byte_offset_add) = logger::Source::line_col_to_byte_offset(
                    &file_text[last_byte..],
                    last_line,
                    last_col,
                    ils.line,
                    ils.col,
                ) else {
                    bun_output::scoped_log!(inline_snapshot, "-> Could not find byte");
                    log.add_error_fmt(
                        &source,
                        logger::Loc {
                            start: i32::try_from(uncommitted_segment_end).unwrap(),
                        },
                        format_args!(
                            "Failed to update inline snapshot: Ln {}, Col {} not found",
                            ils.line, ils.col
                        ),
                    )?;
                    continue;
                };

                // found
                last_byte += byte_offset_add;
                last_line = ils.line;
                last_col = ils.col;
                last_value = &ils.value;

                let mut next_start = last_byte;
                bun_output::scoped_log!(inline_snapshot, "-> Found byte {}", next_start);

                let (final_start, final_end, needs_pre_comma): (i32, i32, bool) = 'blk: {
                    if !file_text[next_start..].is_empty() {
                        match file_text[next_start] {
                            b' ' | b'.' => {
                                // work around off-by-1 error in `expect("§").toMatchInlineSnapshot()`
                                next_start += 1;
                            }
                            _ => {}
                        }
                    }
                    let fn_name = ils.kind;
                    if !strings::starts_with(&file_text[next_start..], fn_name) {
                        log.add_error_fmt(
                            &source,
                            logger::Loc {
                                start: i32::try_from(next_start).unwrap(),
                            },
                            format_args!(
                                "Failed to update inline snapshot: Could not find '{}' here",
                                bstr::BStr::new(fn_name)
                            ),
                        )?;
                        continue 'ils;
                    }
                    next_start += fn_name.len();

                    let mut lexer = js_lexer::Lexer::init_without_reading(&mut *log, &source);
                    if next_start > 0 {
                        // equivalent to lexer.consumeRemainderBytes(next_start)
                        lexer.current += next_start - (lexer.current - lexer.end);
                        lexer.step();
                    }
                    lexer.next()?;
                    // TODO(port): TSXParser::init takes out-param in Zig; assuming `-> Result<Self>` reshape.
                    let mut parser = js_parser::TSXParser::init(
                        &mut *log,
                        &source,
                        vm.transpiler.options.define,
                        lexer,
                        opts,
                    )?;

                    parser.lexer.expect(js_lexer::T::OpenParen)?;
                    let after_open_paren_loc = parser.lexer.loc().start;
                    if parser.lexer.token == js_lexer::T::CloseParen {
                        // zero args
                        if ils.has_matchers {
                            log.add_error_fmt(
                                &source,
                                parser.lexer.loc(),
                                format_args!("Failed to update inline snapshot: Snapshot has matchers and yet has no arguments"),
                            )?;
                            continue 'ils;
                        }
                        let close_paren_loc = parser.lexer.loc().start;
                        parser.lexer.expect(js_lexer::T::CloseParen)?;
                        break 'blk (after_open_paren_loc, close_paren_loc, false);
                    }
                    if parser.lexer.token == js_lexer::T::DotDotDot {
                        log.add_error_fmt(
                            &source,
                            parser.lexer.loc(),
                            format_args!(
                                "Failed to update inline snapshot: Spread is not allowed"
                            ),
                        )?;
                        continue 'ils;
                    }

                    let before_expr_loc = parser.lexer.loc().start;
                    let expr_1 = parser.parse_expr(js_parser::Level::Comma)?;
                    let after_expr_loc = parser.lexer.loc().start;

                    let mut is_one_arg = false;
                    if parser.lexer.token == js_lexer::T::Comma {
                        parser.lexer.expect(js_lexer::T::Comma)?;
                        if parser.lexer.token == js_lexer::T::CloseParen {
                            is_one_arg = true;
                        }
                    } else {
                        is_one_arg = true;
                    }
                    let after_comma_loc = parser.lexer.loc().start;

                    if is_one_arg {
                        parser.lexer.expect(js_lexer::T::CloseParen)?;
                        if ils.has_matchers {
                            break 'blk (after_expr_loc, after_comma_loc, true);
                        } else {
                            if !matches!(expr_1.data, js_ast::ExprData::EString(_)) {
                                log.add_error_fmt(
                                    &source,
                                    expr_1.loc,
                                    format_args!("Failed to update inline snapshot: Argument must be a string literal"),
                                )?;
                                continue 'ils;
                            }
                            break 'blk (before_expr_loc, after_expr_loc, false);
                        }
                    }

                    if parser.lexer.token == js_lexer::T::DotDotDot {
                        log.add_error_fmt(
                            &source,
                            parser.lexer.loc(),
                            format_args!(
                                "Failed to update inline snapshot: Spread is not allowed"
                            ),
                        )?;
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
                        )?;
                        continue 'ils;
                    }
                    if !matches!(expr_2.data, js_ast::ExprData::EString(_)) {
                        log.add_error_fmt(
                            &source,
                            expr_2.loc,
                            format_args!("Failed to update inline snapshot: Argument must be a string literal"),
                        )?;
                        continue 'ils;
                    }

                    if parser.lexer.token == js_lexer::T::Comma {
                        parser.lexer.expect(js_lexer::T::Comma)?;
                    }
                    if parser.lexer.token != js_lexer::T::CloseParen {
                        log.add_error_fmt(
                            &source,
                            parser.lexer.loc(),
                            format_args!("Failed to update inline snapshot: Snapshot expects at most two arguments"),
                        )?;
                        continue 'ils;
                    }
                    parser.lexer.expect(js_lexer::T::CloseParen)?;

                    break 'blk (before_expr_2_loc, after_expr_2_loc, false);
                };
                let final_start_usize = usize::try_from(final_start).unwrap_or(0);
                let final_end_usize = usize::try_from(final_end).unwrap_or(0);
                bun_output::scoped_log!(
                    inline_snapshot,
                    "  -> Found update range {}-{}",
                    final_start_usize,
                    final_end_usize
                );

                if final_end_usize < final_start_usize || final_start_usize < uncommitted_segment_end
                {
                    log.add_error_fmt(
                        &source,
                        logger::Loc { start: final_start },
                        format_args!("Failed to update inline snapshot: Did not advance."),
                    )?;
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
                        let line_start = match source_until_final_start
                            .iter()
                            .rposition(|&b| b == b'\n')
                        {
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
                        let next_newline = match re_indented_source.iter().position(|&b| b == b'\n')
                        {
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
                    re_indented_string.extend_from_slice(
                        ils.end_indent.as_deref().unwrap_or(start_indent),
                    );
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
                    js_printer::Encoding::Utf8,
                )?;
                result_text.extend_from_slice(b"`");

                if ils.is_added {
                    Jest::runner().unwrap().snapshots.added += 1;
                }
            }

            // commit the last segment
            result_text.extend_from_slice(&file_text[uncommitted_segment_end..]);

            if log.errors > 0 {
                // skip writing the file if there were errors — `log` guard prints on drop.
                let _ = scopeguard::ScopeGuard::into_inner(file);
                continue;
            }

            // 4. write out result_text to the file
            if let Err(e) = file.file.seek_to(0) {
                log.add_error_fmt(
                    &source,
                    logger::Loc { start: 0 },
                    format_args!(
                        "Failed to update inline snapshot: Seek file error: {}",
                        e.name()
                    ),
                )?;
                let _ = scopeguard::ScopeGuard::into_inner(file);
                continue;
            }

            if let Err(e) = file.file.write_all(&result_text) {
                log.add_error_fmt(
                    &source,
                    logger::Loc { start: 0 },
                    format_args!(
                        "Failed to update inline snapshot: Write file error: {}",
                        e.name()
                    ),
                )?;
                let _ = scopeguard::ScopeGuard::into_inner(file);
                continue;
            }
            if result_text.len() < file_text.len() {
                if file.file.set_end_pos(result_text.len()).is_err() {
                    panic!(
                        "Failed to update inline snapshot: File was left in an invalid state"
                    );
                }
            }

            // disarm errdefer (success path) — Zig never closes on success.
            let _ = scopeguard::ScopeGuard::into_inner(file);
        }
        Ok(success.get())
    }

    fn get_snapshot_file(&mut self, file_id: FileId) -> Result<bun_sys::Result<()>, Error> {
        // TODO(port): narrow error set
        if self._current_file.is_none() || self._current_file.as_ref().unwrap().id != file_id {
            self.write_snapshot_file()?;

            let test_file = Jest::runner().unwrap().files.get(file_id);
            let test_filename = test_file.source.path.name.filename;
            let dir_path = test_file.source.path.name.dir_with_trailing_slash();

            let mut snapshot_file_path_buf = PathBuffer::uninit();
            let buf = snapshot_file_path_buf.as_mut_slice();
            let mut pos = 0usize;
            buf[pos..pos + dir_path.len()].copy_from_slice(dir_path);
            pos += dir_path.len();
            buf[pos..pos + Self::SNAPSHOTS_DIR_NAME.len()]
                .copy_from_slice(Self::SNAPSHOTS_DIR_NAME);
            pos += Self::SNAPSHOTS_DIR_NAME.len();

            // SAFETY: snapshot_dir_path is a BACKREF into Jest::runner().files[..].source.path,
            // which outlives self (runner is process-global; files are never freed mid-run).
            let cached_dir = self.snapshot_dir_path.map(|p| unsafe { p.as_ref() });
            if cached_dir.is_none() || !strings::eql_long(dir_path, cached_dir.unwrap(), true) {
                buf[pos] = 0;
                // SAFETY: buf[pos] == 0 written above
                let snapshot_dir_path = unsafe { ZStr::from_raw(buf.as_ptr(), pos) };
                match bun_sys::mkdir(snapshot_dir_path, 0o777) {
                    bun_sys::Result::Ok(()) => {
                        self.snapshot_dir_path = core::ptr::NonNull::new(dir_path as *const [u8] as *mut [u8]);
                    }
                    bun_sys::Result::Err(err) => match err.get_errno() {
                        bun_sys::Errno::EXIST => {
                            self.snapshot_dir_path = core::ptr::NonNull::new(dir_path as *const [u8] as *mut [u8]);
                        }
                        _ => return Ok(bun_sys::Result::Err(err)),
                    },
                }
            }

            buf[pos..pos + test_filename.len()].copy_from_slice(test_filename);
            pos += test_filename.len();
            buf[pos..pos + b".snap".len()].copy_from_slice(b".snap");
            pos += b".snap".len();
            buf[pos] = 0;
            // SAFETY: buf[pos] == 0 written above
            let snapshot_file_path = unsafe { ZStr::from_raw(buf.as_ptr(), pos) };

            let mut flags: i32 = bun_sys::O::CREAT | bun_sys::O::RDWR;
            if self.update_snapshots {
                flags |= bun_sys::O::TRUNC;
            }
            let fd = match bun_sys::open(snapshot_file_path, flags, 0o644) {
                bun_sys::Result::Ok(fd) => fd,
                bun_sys::Result::Err(err) => return Ok(bun_sys::Result::Err(err)),
            };

            let mut file = File {
                id: file_id,
                file: bun_sys::File::from_fd(fd),
            };
            let guard = scopeguard::guard(&mut file, |f| {
                f.file.close();
            });

            if self.update_snapshots {
                self.file_buf.extend_from_slice(Self::FILE_HEADER);
            } else {
                let length = guard.file.get_end_pos().map_err(Error::from)?;
                if length == 0 {
                    self.file_buf.extend_from_slice(Self::FILE_HEADER);
                } else {
                    let mut tmp = vec![0u8; length];
                    let _ = guard.file.pread_all(&mut tmp, 0).map_err(Error::from)?;
                    #[cfg(windows)]
                    {
                        guard.file.seek_to(0).map_err(Error::from)?;
                    }
                    self.file_buf.extend_from_slice(&tmp);
                    // tmp dropped here (was: allocator.free(buf))
                }
            }

            // errdefer stays armed across parse_file — if it errors, guard closes the fd.
            self.parse_file(&**guard)?;
            let file = scopeguard::ScopeGuard::into_inner(guard);
            // PORT NOTE: reshaped for borrowck — guard captured &mut file; re-read it here.
            self._current_file = Some(File {
                id: file.id,
                // TODO(port): bun_sys::File move semantics — Zig copied the std.fs.File by value.
                file: core::mem::take(&mut file.file),
            });
        }

        Ok(bun_sys::Result::Ok(()))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/snapshot.zig (581 lines)
//   confidence: medium
//   todos:      17
//   notes:      values keyed u64/Box<[u8]> (overrides TSV per §Strings); counts uses StringHashMap::get_or_put (needs (&K,&mut V,bool) API); snapshot_dir_path is NonNull<[u8]> backref; write_inline_snapshots wraps log+file in scopeguards (success via Cell); js_parser/lexer arena threading deferred.
// ──────────────────────────────────────────────────────────────────────────

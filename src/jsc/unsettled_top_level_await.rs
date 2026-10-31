//! How a run reports an entry point that did not finish well: its rejection, and a module graph that nothing can finish anymore, with the place of each top-level `await` that it is suspended on, in Node's words.

use core::ffi::c_void;
use std::io::Write as _;

use crate::virtual_machine::{ExitHandler, MAIN_FILE_NAME, MAX_SOURCE_LINE_LENGTH, VirtualMachine};
use crate::{JSGlobalObject, JSInternalPromise, ModuleLoader};

unsafe extern "C" {
    /// `--no-warnings`, which `bun_runtime` sets while it reads the command line.
    safe static Bun__Node__ProcessNoWarnings: core::sync::atomic::AtomicBool;
    /// ModuleLoader.cpp: `callback` gets each stalled module's registry key, or the source that a source map names, and the one-based line and column of its `await` (0 where not known).
    fn Bun__forEachStalledTopLevelAwait(
        global: &JSGlobalObject,
        root_key: &bun_core::StringView<'_>,
        context: *mut c_void,
        callback: extern "C" fn(
            context: *mut c_void,
            url: &bun_core::String,
            line: i32,
            column: i32,
        ),
    ) -> usize;
}

struct Stalled {
    url: bun_core::String,
    line: i32,
    column: i32,
}

extern "C" fn collect(context: *mut c_void, url: &bun_core::String, line: i32, column: i32) {
    // SAFETY: `context` is the `Vec` of the one caller below, which outlives the walk.
    let stalled = unsafe { &mut *context.cast::<Vec<Stalled>>() };
    stalled.push(Stalled {
        url: url.clone(),
        line,
        column,
    });
}

/// The byte offset in `line` of its UTF-16 code unit `units`, which is how a source position counts.
fn byte_offset_of_utf16(line: &[u8], units: usize) -> usize {
    let (mut seen, mut offset) = (0, 0);
    while offset < line.len() && seen < units {
        let width = bun_core::strings::wtf8_byte_sequence_length(line[offset]) as usize;
        seen += if width == 4 { 2 } else { 1 };
        offset += width;
    }
    offset.min(line.len())
}

/// Where in `line` the `await` stands that one-based `column` points at. A source map can lead to the start of its statement instead, so the first one from there on counts too.
fn await_in(line: &[u8], column: i32) -> Option<usize> {
    let at = byte_offset_of_utf16(line, (column.max(1) - 1) as usize);
    bun_core::strings::index_of(&line[at..], b"await")
        .map(|found| at + found)
        .or_else(|| bun_core::strings::last_index_of(&line[..at], b"await"))
}

impl VirtualMachine {
    /// Reports the rejection of `entry`, the promise of the entry point, as its uncaught error. False: no 'uncaughtException' listener took it.
    pub fn report_entry_rejection(&mut self, entry: *mut JSInternalPromise) -> bool {
        let global = self.global();
        let reason = JSInternalPromise::opaque_mut(entry).result(self.jsc_vm());
        // A CJS entry runs synchronously in Node, so its top-level throw is an uncaughtException. Only the rejection of an ESM entry has the origin "unhandledRejection".
        let is_rejection = !self.entry_point_is_commonjs();
        self.uncaught_exception(global, reason, is_rejection)
    }

    /// Call once the loop has drained and 'beforeExit' has run, before the 'exit' listeners: an `entry` promise that is still pending gets exit code 13 and the warning, unless an exit code is already chosen.
    pub fn report_unsettled_entry(&mut self, entry: *mut JSInternalPromise) {
        if crate::JSPromise::status_ptr(entry) != crate::js_promise::Status::Pending
            || self.exit_handler.exit_code != 0
            || self.unhandled_error_counter != 0
        {
            return;
        }
        self.exit_handler.exit_code = 13;
        if Bun__Node__ProcessNoWarnings.load(core::sync::atomic::Ordering::Relaxed) {
            return;
        }
        let root = ExitHandler::Bun__VM__entryRootKey(self).to_utf8();
        let root = root.slice().to_vec();
        let mut report = self.describe_unsettled_module_graph(&root, b"Warning: ");
        report.extend_from_slice(b"\n\n");
        bun_core::Output::flush();
        let _ = bun_core::Output::error_writer().write_all(&report);
        bun_core::Output::flush();
    }

    /// Why the evaluation of the module graph under `root_key` (a module-registry key) cannot finish, as text without a last newline. One paragraph, which starts with `label`, for each module that is suspended on its own top-level await: "Detected unsettled top-level await at" its URL and line, the source line, a caret under the `await`.
    pub fn describe_unsettled_module_graph(&mut self, root_key: &[u8], label: &[u8]) -> Vec<u8> {
        let global = self.global();
        let mut stalled: Vec<Stalled> = Vec::new();
        // SAFETY: `collect` runs only during this call, on this thread, with `stalled` as its context.
        unsafe {
            Bun__forEachStalledTopLevelAwait(
                global,
                &bun_core::StringView::from_bytes(root_key),
                (&raw mut stalled).cast(),
                collect,
            )
        };

        let mut report = Vec::new();
        if stalled.is_empty() {
            let root = match self.main() {
                Some(main) if root_key == MAIN_FILE_NAME => main,
                _ => root_key,
            };
            report.extend_from_slice(label);
            if crate::compiled_program::is_compiled_module(root) {
                // The modules of an `--aot` executable have no record that says which of them is suspended.
                report.extend_from_slice(b"Detected unsettled top-level await in ");
                Self::write_module_name(&mut report, &bun_core::String::clone_utf8(root));
                report.extend_from_slice(b" or a module that it imports");
            } else {
                // No module is suspended on an await: the graph did not load that far.
                report.extend_from_slice(b"The load of ");
                Self::write_module_name(&mut report, &bun_core::String::clone_utf8(root));
                report.extend_from_slice(b" never finished, and nothing is left to wait for");
            }
            return report;
        }

        for (i, it) in stalled.iter().enumerate() {
            if i > 0 {
                report.extend_from_slice(b"\n\n");
            }
            report.extend_from_slice(label);
            report.extend_from_slice(b"Detected unsettled top-level await at ");
            Self::write_module_name(&mut report, &it.url);
            if it.line <= 0 {
                continue;
            }
            let mut must_reset_parser_arena = false;
            let text = self.source_text_for_display(global, &it.url, &mut must_reset_parser_arena);
            let line = bun_core::strings::split(text.slice(), b"\n")
                .nth((it.line - 1) as usize)
                .map(|line| line.strip_suffix(b"\r").unwrap_or(line));
            // A line without an `await` is not where the module is suspended: the position did not survive the source map, and the name alone is right.
            if let Some((line, caret)) =
                line.and_then(|line| await_in(line, it.column).map(|caret| (line, caret)))
            {
                let _ = writeln!(&mut report, ":{}", it.line);
                let shown = line.len().min(MAX_SOURCE_LINE_LENGTH);
                report.extend_from_slice(&line[..shown]);
                if caret < shown {
                    report.push(b'\n');
                    let mut offset = 0;
                    while offset < caret {
                        // Tabs stay, so that the caret lands under its column however wide a tab is shown.
                        report.push(if line[offset] == b'\t' { b'\t' } else { b' ' });
                        offset +=
                            bun_core::strings::wtf8_byte_sequence_length(line[offset]) as usize;
                    }
                    report.push(b'^');
                }
            }
            drop(text);
            if must_reset_parser_arena {
                ModuleLoader::ModuleLoader::reset_arena(self);
            }
        }
        report
    }

    /// A file URL for a path, as Node names a module. `[eval]` and `[stdin]` are no files: they keep their names.
    fn write_module_name(report: &mut Vec<u8>, url: &bun_core::String) {
        let path = url.to_utf8();
        let name = bun_paths::basename(path.slice());
        if name == b"[eval]" || name == b"[stdin]" {
            report.extend_from_slice(name);
        } else if bun_paths::is_absolute(path.slice()) {
            let _ = write!(report, "{}", bun_url::file_url_from_string(url));
        } else {
            report.extend_from_slice(path.slice());
        }
    }
}

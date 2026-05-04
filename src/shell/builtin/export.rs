use core::ffi::{c_char, CStr};
use core::mem::offset_of;

use bun_jsc::SystemError;
use bun_shell::interpreter::{EnvStr, Interpreter};
use bun_shell::interpreter::builtin::{Builtin, BuiltinImpl, BuiltinIo};
// TODO(port): verify module path for IoKind / Builtin::Kind (.@"export", .stdout, .stderr literals)
use bun_shell::interpreter::builtin::{BuiltinKind, IoKind};
use bun_shell::{self as shell, ExitCode, Yield};
use bun_str::strings;

bun_output::declare_scope!(ShellExport, hidden);

#[derive(Default)]
pub struct Export {
    pub printing: bool,
}

struct Entry {
    key: EnvStr,
    value: EnvStr,
}

impl Entry {
    pub fn compare(_context: (), this: &Self, other: &Self) -> core::cmp::Ordering {
        // PORT NOTE: Zig `cmpStringsAsc` returns bool (a < b) for std.mem.sort;
        // Rust sort_by wants Ordering. Map to the same ascending order.
        strings::cmp_strings_asc((), this.key.slice(), other.key.slice())
    }
}

impl Export {
    // PERF(port): `io_kind` was a comptime enum-literal monomorphization — profile in Phase B.
    pub fn write_output(&mut self, io_kind: IoKind, args: core::fmt::Arguments<'_>) -> Yield {
        if let Some(safeguard) = self.bltn().stdout.needs_io() {
            // Zig: &@field(this.bltn(), @tagName(io_kind))
            let output: &mut BuiltinIo::Output = self.bltn().io_mut(io_kind);
            self.printing = true;
            return output.enqueue_fmt_bltn(self, BuiltinKind::Export, args, safeguard);
        }

        let buf = self.bltn().fmt_error_arena(BuiltinKind::Export, args);
        let _ = self.bltn().write_no_io(io_kind, buf);
        self.bltn().done(0)
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, e: Option<SystemError>) -> Yield {
        if cfg!(debug_assertions) {
            debug_assert!(self.printing);
        }

        let exit_code: ExitCode = if let Some(e) = e {
            // `defer e.deref()` → SystemError's Drop decrements the refcount at scope exit.
            e.get_errno() as ExitCode
        } else {
            0
        };

        self.bltn().done(exit_code)
    }

    pub fn start(&mut self) -> Yield {
        let args = self.bltn().args_slice();

        // Calling `export` with no arguments prints all exported variables lexigraphically ordered
        if args.is_empty() {
            let arena = self.bltn().arena;

            let mut keys = bumpalo::collections::Vec::<Entry>::new_in(arena);
            let mut iter = self.bltn().export_env.iterator();
            while let Some(entry) = iter.next() {
                keys.push(Entry {
                    key: *entry.key_ptr,
                    value: *entry.value_ptr,
                });
            }

            keys.sort_by(|a, b| Entry::compare((), a, b));

            let len: usize = {
                let mut len: usize = 0;
                for entry in keys.iter() {
                    // Zig: std.fmt.count("{s}={s}\n", .{ key, value })
                    len += entry.key.slice().len() + 1 + entry.value.slice().len() + 1;
                }
                len
            };
            // PERF(port): was arena.allocator().alloc(u8, len) — bumpalo zero-fill then overwrite.
            let buf: &mut [u8] = arena.alloc_slice_fill_copy(len, 0u8);
            {
                let mut i: usize = 0;
                for entry in keys.iter() {
                    // Zig: std.fmt.bufPrint(buf[i..], "{s}={s}\n", .{ key, value })
                    // PORT NOTE: reshaped to raw byte copies — `{s}` on []const u8 is a byte memcpy
                    // and these slices are not guaranteed UTF-8.
                    let key = entry.key.slice();
                    let value = entry.value.slice();
                    buf[i..i + key.len()].copy_from_slice(key);
                    i += key.len();
                    buf[i] = b'=';
                    i += 1;
                    buf[i..i + value.len()].copy_from_slice(value);
                    i += value.len();
                    buf[i] = b'\n';
                    i += 1;
                }
            }

            if let Some(safeguard) = self.bltn().stdout.needs_io() {
                self.printing = true;
                return self.bltn().stdout.enqueue(self, buf, safeguard);
            }

            let _ = self.bltn().write_no_io(IoKind::Stdout, buf);
            return self.bltn().done(0);
        }

        // TODO: It would be nice to not have to duplicate the arguments here. Can
        // we make `Builtin.args` mutable so that we can take it out of the argv?
        for &arg_raw in args {
            // SAFETY: argsSlice() yields NUL-terminated argv pointers.
            let arg_sentinel = unsafe { CStr::from_ptr(arg_raw as *const c_char) };
            let arg: &[u8] = arg_sentinel.to_bytes();
            if arg.is_empty() {
                continue;
            }

            let Some(eqsign_idx) = arg.iter().position(|&b| b == b'=') else {
                if !shell::is_valid_var_name(arg) {
                    let buf = self.bltn().fmt_error_arena(
                        BuiltinKind::Export,
                        format_args!("`{}`: not a valid identifier", bstr::BStr::new(arg)),
                    );
                    return self.write_output(
                        IoKind::Stderr,
                        format_args!("{}\n", bstr::BStr::new(buf)),
                    );
                }

                let label_env_str = EnvStr::dupe_ref_counted(arg);
                // `defer label_env_str.deref()` → handled by EnvStr's Drop.
                self.bltn().parent_cmd().base.shell.assign_var(
                    self.bltn().parent_cmd().base.interpreter,
                    label_env_str,
                    EnvStr::init_slice(b""),
                    AssignKind::Exported,
                );
                continue;
            };

            let label = &arg[0..eqsign_idx];
            // Zig: arg_sentinel[eqsign_idx + 1 .. :0] — slice after '=' up to (excluding) the NUL.
            let value = &arg[eqsign_idx + 1..];

            let label_env_str = EnvStr::dupe_ref_counted(label);
            let value_env_str = EnvStr::dupe_ref_counted(value);
            // `defer .deref()` → handled by EnvStr's Drop.

            self.bltn().parent_cmd().base.shell.assign_var(
                self.bltn().parent_cmd().base.interpreter,
                label_env_str,
                value_env_str,
                AssignKind::Exported,
            );
        }

        self.bltn().done(0)
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self points to the `export` field of Builtin::Impl, which is the `impl` field of Builtin.
        unsafe {
            let impl_ptr = (self as *mut Self as *mut u8)
                .sub(offset_of!(BuiltinImpl, export))
                .cast::<BuiltinImpl>();
            // TODO(port): Zig field name is `impl` (Rust keyword) — verify actual Rust field ident on Builtin.
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, r#impl))
                .cast::<Builtin>()
        }
    }
}

impl Drop for Export {
    fn drop(&mut self) {
        bun_output::scoped_log!(ShellExport, "({}) deinit", "export");
    }
}

// TODO(port): verify path/name for the assign-var kind enum (.exported in Zig).
use bun_shell::interpreter::AssignKind;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/export.zig (144 lines)
//   confidence: medium
//   todos:      3
//   notes:      io_kind/@field dispatch + Builtin field names (impl/export) need Phase-B verification; fmt+args collapsed to fmt::Arguments
// ──────────────────────────────────────────────────────────────────────────

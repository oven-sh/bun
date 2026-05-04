use std::io::Write as _;

use bstr::BStr;

use bun_install::Lockfile;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};
use bun_logger as logger;
use bun_paths as path;
use bun_str::{String as BunString, StringJsc as _, ZigString};
use bun_sys::Fd;

pub mod bun_install_js_bindings {
    use super::*;

    pub fn generate(global: &JSGlobalObject) -> JSValue {
        let obj = JSValue::create_empty_object(global, 1);
        let parse_lockfile = ZigString::static_(b"parseLockfile");
        obj.put(
            global,
            parse_lockfile,
            JSFunction::create(global, b"parseLockfile", js_parse_lockfile, 1, Default::default()),
        );
        obj
    }

    #[bun_jsc::host_fn]
    pub fn js_parse_lockfile(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let mut log = logger::Log::init();

        let args = frame.arguments_old(1).slice();
        let cwd = args[0].to_slice_or_null(global)?;

        let dir = match bun_sys::open_dir_absolute_not_for_deleting_or_renaming(cwd.slice()) {
            Ok(d) => d,
            Err(err) => {
                return Err(global.throw(format_args!(
                    "failed to open: {}, '{}'",
                    err.name(),
                    BStr::new(cwd.slice()),
                )));
            }
        };

        let lockfile_path = path::join_abs_string_z(cwd.slice(), &[b"bun.lockb"], path::Platform::Auto);

        let mut lockfile = Lockfile::init_empty();
        // PORT NOTE: reshaped for borrowck — Zig accessed globalObject.bunVM().transpiler.resolver
        // through chained pointer dereferences.
        {
            let vm = global.bun_vm();
            if vm.transpiler.resolver.env_loader.is_none() {
                vm.transpiler.resolver.env_loader = Some(vm.transpiler.env);
            }
        }

        // as long as we aren't migration from `package-lock.json`, leaving this undefined is okay
        let manager = global.bun_vm().transpiler.resolver.get_package_manager();

        let load_result: bun_install::lockfile::LoadResult =
            lockfile.load_from_dir(Fd::from_std_dir(dir), manager, &mut log, true);

        match load_result {
            bun_install::lockfile::LoadResult::Err(err) => {
                return Err(global.throw(format_args!(
                    "failed to load lockfile: {}, '{}'",
                    err.value.name(),
                    BStr::new(lockfile_path.as_bytes()),
                )));
            }
            bun_install::lockfile::LoadResult::NotFound => {
                return Err(global.throw(format_args!(
                    "lockfile not found: '{}'",
                    BStr::new(lockfile_path.as_bytes()),
                )));
            }
            bun_install::lockfile::LoadResult::Ok(_) => {}
        }

        // TODO(port): std.json.fmt — Zig used std.json.fmt(lockfile, .{ .whitespace = .indent_2,
        // .emit_null_optional_fields = true, .emit_nonportable_numbers_as_strings = true }).
        // Need a Rust-side JSON serializer for Lockfile with the same options.
        let mut stringified = Vec::<u8>::new();
        write!(
            &mut stringified,
            "{}",
            lockfile.to_json_fmt(bun_install::lockfile::JsonFmtOptions {
                whitespace: bun_install::lockfile::JsonWhitespace::Indent2,
                emit_null_optional_fields: true,
                emit_nonportable_numbers_as_strings: true,
            }),
        )
        .expect("unreachable");

        let str = BunString::clone_utf8(&stringified);

        str.to_js_by_parse_json(global)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install_jsc/install_binding.zig (72 lines)
//   confidence: medium
//   todos:      1
//   notes:      std.json.fmt(Lockfile) needs a Rust serializer; bun_vm() field-chain access will need borrowck reshaping in Phase B
// ──────────────────────────────────────────────────────────────────────────

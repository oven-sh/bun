use bun_jsc::{JSGlobalObject, JSValue};

pub mod bun_install_js_bindings {
    use super::*;

    pub fn generate(global: &JSGlobalObject) -> JSValue {
        use bun_jsc::JSFunction;
        let obj = JSValue::create_empty_object(global, 1);
        obj.put(
            global,
            b"parseLockfile",
            JSFunction::create(
                global,
                bun_core::String::static_(b"parseLockfile"),
                // `#[bun_jsc::host_fn]` on the module-scope `js_parse_lockfile`
                // emits this `JSHostFn`-ABI shim.
                __jsc_host_js_parse_lockfile,
                1,
                Default::default(),
            ),
        );
        obj
    }

    // PORT NOTE: lives at module scope (not in an `impl`) because the
    // `#[bun_jsc::host_fn]` Free-kind shim body emits `#fn_name(__g, __f)` without
    // a `Self::` qualifier, so the wrapped fn must resolve unqualified.
    #[bun_jsc::host_fn]
    pub fn js_parse_lockfile(
        global: &JSGlobalObject,
        frame: &bun_jsc::CallFrame,
    ) -> bun_jsc::JsResult<JSValue> {
        use core::ptr::NonNull;

        use bstr::BStr;
        use bun_core::{OwnedString, String as BunString};
        use bun_install::lockfile::lockfile_json_stringify_for_debugging::{
            WriteStream, WriteStreamOptions, json_stringify,
        };
        use bun_install::lockfile::{LoadResult, Lockfile};
        use bun_paths::resolve_path;
        use bun_sys::FdExt as _;

        let mut log = bun_ast::Log::init();

        let args = frame.arguments_old::<1>();
        let args = args.slice();
        let cwd = args[0].to_slice_or_null(global)?;

        let dir = match bun_sys::open_dir_absolute_not_for_deleting_or_renaming(cwd.slice()) {
            Ok(d) => d,
            Err(err) => {
                return Err(global.throw(format_args!(
                    "failed to open: {}, '{}'",
                    BStr::new(err.name()),
                    BStr::new(cwd.slice()),
                )));
            }
        };
        // `defer dir.close()` — closed at fn return.
        let dir = scopeguard::guard(dir, |d| d.close());

        let lockfile_path = resolve_path::join_abs_string_z::<resolve_path::platform::Auto>(
            cwd.slice(),
            &[b"bun.lockb".as_slice()],
        );

        let mut lockfile_ = Lockfile::default();

        // PORT NOTE: reshaped for borrowck — Zig walked
        // `globalObject.bunVM().transpiler.resolver` through chained pointer
        // dereferences. `bun_vm()` returns `*mut VirtualMachine` (raw, mirroring
        // Zig's `*VirtualMachine`); deref locally so the env-loader fixup and the
        // package-manager borrow are scoped independently.
        // SAFETY: `bun_vm()` returns the live VM that owns `global`; this host fn
        // runs on the JS thread so no concurrent `&mut VirtualMachine` exists.
        let vm = global.bun_vm().as_mut();
        if vm.transpiler.resolver.env_loader.is_none() {
            vm.transpiler.resolver.env_loader = NonNull::new(vm.transpiler.env);
        }

        // as long as we aren't migration from `package-lock.json`, leaving this undefined is okay
        let manager = vm.package_manager();

        let load_result: LoadResult<'_> =
            lockfile_.load_from_dir::<true>(*dir, Some(manager), &mut log);

        match load_result {
            LoadResult::Err(err) => {
                return Err(global.throw(format_args!(
                    "failed to load lockfile: {}, '{}'",
                    err.value.name(),
                    BStr::new(lockfile_path.as_bytes()),
                )));
            }
            LoadResult::NotFound => {
                return Err(global.throw(format_args!(
                    "lockfile not found: '{}'",
                    BStr::new(lockfile_path.as_bytes()),
                )));
            }
            LoadResult::Ok(_) => {}
        }

        // Zig: `std.fmt.allocPrint("{f}", .{ std.json.fmt(lockfile, .{...}) })` —
        // drives `Lockfile.jsonStringify` through a `std.json.WriteStream` with
        // the given options. Port: feed the lockfile through the in-crate
        // `WriteStream` (lockfile_json_stringify_for_debugging.rs) into a
        // `Vec<u8>`. OOM is `bun.handleOom` in Zig → infallible `Vec` growth here.
        let mut w = WriteStream::new(WriteStreamOptions {
            indent: 2,
            emit_null_optional_fields: true,
            emit_nonportable_numbers_as_strings: true,
        });
        // `jsonStringify` only surfaces the underlying writer's error; the
        // `Vec<u8>` writer is infallible. Zig wraps the whole `allocPrint` in
        // `bun.handleOom` (crash on the impossible alloc failure) — mirror that
        // with an `expect` rather than swallowing.
        json_stringify(&lockfile_, &mut w).expect("Vec<u8> JSON writer is infallible");
        let stringified = w.into_bytes();

        // Zig: `defer str.deref()`. `bun_core::String` is `Copy` (no `Drop`),
        // so the +1 from `clone_utf8` must be released via `OwnedString`'s RAII
        // — `to_js_by_parse_json` borrows, it does not consume.
        let mut str = OwnedString::new(BunString::clone_utf8(&stringified));

        bun_jsc::bun_string_jsc::to_js_by_parse_json(&mut str, global)
    }
}

// ported from: src/install_jsc/install_binding.zig

use bun_jsc::{JSGlobalObject, JSValue};

pub mod bun_install_js_bindings {
    use super::*;

    pub fn generate(global: &JSGlobalObject) -> JSValue {
        use bun_jsc::JSFunction;
        let obj = JSValue::create_empty_object(global, 2);
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
        obj.put(
            global,
            b"simulateHardlinkFallback",
            JSFunction::create(
                global,
                bun_core::String::static_(b"simulateHardlinkFallback"),
                __jsc_host_js_simulate_hardlink_fallback,
                2,
                Default::default(),
            ),
        );
        obj
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_simulate_hardlink_fallback(
        global: &JSGlobalObject,
        frame: &bun_jsc::CallFrame,
    ) -> bun_jsc::JsResult<JSValue> {
        let args = frame.arguments();
        let volume = |value: JSValue| match value.to_u32() {
            0 => None,
            id => Some(u64::from(id)),
        };
        let cache_volume = volume(args[0]);
        let destination_volume = volume(args[1]);
        let cache = bun_install::package_installer::CachedVolumeId::default();
        let destination = bun_install::package_installer::CachedVolumeId::default();
        let cache_probe_count = core::cell::Cell::new(0u32);
        let destination_probe_count = core::cell::Cell::new(0u32);
        let decide = || {
            let cache_volume = cache.get_or_init(|| {
                cache_probe_count.set(cache_probe_count.get() + 1);
                cache_volume
            });
            let destination_volume = destination.get_or_init(|| {
                destination_probe_count.set(destination_probe_count.get() + 1);
                destination_volume
            });
            bun_install::package_installer::hardlink_fallback_decision(
                cache_volume,
                destination_volume,
            )
        };
        let decisions = [decide(), decide()];
        let copyfile_decision_count = decisions
            .iter()
            .filter(|use_copyfile| **use_copyfile)
            .count();

        let result = JSValue::create_empty_object(global, 3);
        result.put(
            global,
            b"copyfileDecisionCount",
            JSValue::js_number(copyfile_decision_count as f64),
        );
        result.put(
            global,
            b"cacheProbeCount",
            JSValue::js_number(cache_probe_count.get() as f64),
        );
        result.put(
            global,
            b"destinationProbeCount",
            JSValue::js_number(destination_probe_count.get() as f64),
        );
        Ok(result)
    }

    // Lives at module scope (not in an `impl`) because the
    // `#[bun_jsc::host_fn]` Free-kind shim body emits `#fn_name(__g, __f)` without
    // a `Self::` qualifier, so the wrapped fn must resolve unqualified.
    #[bun_jsc::host_fn]
    pub(crate) fn js_parse_lockfile(
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

        let args = frame.arguments();
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

        // `bun_vm()` returns a raw `*mut VirtualMachine`; deref locally so the
        // env-loader fixup and the package-manager borrow are scoped
        // independently.
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

        // Feed the lockfile through the in-crate
        // `WriteStream` (lockfile_json_stringify_for_debugging.rs) into a
        // `Vec<u8>`.
        let mut w = WriteStream::new(WriteStreamOptions {
            indent: 2,
            emit_nonportable_numbers_as_strings: true,
        });
        // `jsonStringify` only surfaces the underlying writer's error; the
        // `Vec<u8>` writer is infallible, so `expect` rather than swallowing.
        json_stringify(&lockfile_, &mut w).expect("Vec<u8> JSON writer is infallible");
        let stringified = w.into_bytes();

        // `bun_core::String` is `Copy` (no `Drop`),
        // so the +1 from `clone_utf8` must be released via `OwnedString`'s RAII
        // — `to_js_by_parse_json` borrows, it does not consume.
        let mut str = OwnedString::new(BunString::clone_utf8(&stringified));

        bun_jsc::bun_string_jsc::to_js_by_parse_json(&mut str, global)
    }
}

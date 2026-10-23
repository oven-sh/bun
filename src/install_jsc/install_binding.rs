use bun_jsc::bindgen::JsScope;
use bun_jsc::{JSValue, StringJsc as _};

pub(crate) fn parse_lockfile(cx: &mut JsScope<'_>, cwd: &[u8]) -> bun_jsc::JsResult<JSValue> {
    use core::ptr::NonNull;

    use bstr::BStr;
    use bun_core::String as BunString;
    use bun_install::lockfile::lockfile_json_stringify_for_debugging::{
        WriteStream, WriteStreamOptions, json_stringify,
    };
    use bun_install::lockfile::{LoadResult, Lockfile};
    use bun_paths::resolve_path;
    use bun_sys::FdExt as _;

    let global = cx.global();
    let mut log = bun_ast::Log::init();

    let dir = match bun_sys::open_dir_absolute_not_for_deleting_or_renaming(cwd) {
        Ok(d) => d,
        Err(err) => {
            return Err(global.throw(format_args!(
                "failed to open: {}, '{}'",
                BStr::new(err.name()),
                BStr::new(cwd),
            )));
        }
    };
    // `defer dir.close()` — closed at fn return.
    let dir = scopeguard::guard(dir, |d| d.close());

    let lockfile_path = resolve_path::join_abs_string_z::<resolve_path::platform::Auto>(
        cwd,
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

    BunString::borrow_utf8(&stringified).to_js_by_parse_json(global)
}

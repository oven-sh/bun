use bun_jsc::bindgen::JsScope;
use bun_jsc::{JSValue, StringJsc as _};

pub(crate) fn parse_lockfile(cx: &mut JsScope<'_>, cwd: &[u8]) -> bun_jsc::JsResult<JSValue> {
    use core::ptr::NonNull;

    use bstr::BStr;
    use bun_install::lockfile::lockfile_json_stringify_for_debugging::{
        WriteStream, WriteStreamOptions, json_stringify,
    };
    use bun_install::lockfile::{LoadResult, Lockfile};
    use bun_paths::resolve_path;

    let global = cx.global();
    let log = bun_ast::Log::init();

    let dir = match bun_sys::open_dir_absolute_not_for_deleting_or_renaming(cwd) {
        Ok(d) => bun_sys::File::from_fd(d),
        Err(err) => {
            return Err(global.throw(format_args!(
                "failed to open: {}, '{}'",
                BStr::new(err.name()),
                BStr::new(cwd),
            )));
        }
    };

    let lockfile_path = resolve_path::join_abs_string_z::<resolve_path::platform::Auto>(
        cwd,
        &[b"bun.lockb".as_slice()],
    );

    let mut lockfile_ = Lockfile::default();

    let vm = global.bun_vm();
    let load_result = vm.transpiler.with_mut(|t| {
        if t.resolver.env_loader.is_none() {
            t.resolver.env_loader = NonNull::new(t.env);
        }
        t.resolver.get_package_manager().map(|manager| {
            let manager = (manager as &mut dyn core::any::Any).downcast_mut();
            lockfile_.load_or_migrate(dir.fd(), manager.expect("the only `AutoInstaller`"), &log)
        })
    });
    let load_result: LoadResult = match load_result {
        Ok(load_result) => load_result,
        Err(err) => {
            return Err(global.throw(format_args!(
                "failed to initialize the package manager: {}",
                err.name(),
            )));
        }
    };

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

    bun_core::StringView::borrow_utf8(&stringified).to_js_by_parse_json(global)
}

use bun_jsc::{JSGlobalObject, JSValue};

pub mod bun_install_js_bindings {
    use super::*;

    pub fn generate(_global: &JSGlobalObject) -> JSValue {
        // TODO(b2-blocked): bun_jsc::host_fn (proc-macro) — `JSFunction::create`
        // takes a raw-ABI `JSHostFn`; the proc-macro lowers a `JSHostFnZig`-shaped
        // fn to that ABI. Until it lands, `js_parse_lockfile` has the wrong
        // fn-pointer type to pass here.
        #[cfg(any())]
        {
            use bun_jsc::JSFunction;
            let obj = JSValue::create_empty_object(_global, 1);
            obj.put(
                _global,
                b"parseLockfile",
                JSFunction::create(
                    _global,
                    bun_string::String::static_(b"parseLockfile"),
                    js_parse_lockfile,
                    1,
                    Default::default(),
                ),
            );
            return obj;
        }
        #[cfg(not(any()))]
        todo!("install_binding::generate — gated on bun_jsc::host_fn proc-macro")
    }

    pub fn js_parse_lockfile(global: &JSGlobalObject, frame: &bun_jsc::CallFrame) -> bun_jsc::JsResult<JSValue> {
        use std::io::Write as _;
        use bstr::BStr;
        use bun_install::lockfile::{self, Lockfile};
        use bun_logger as logger;
        use bun_paths::resolve_path;
        use bun_string::String as BunString;

        let mut log = logger::Log::init();

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
        let dir = scopeguard::guard(dir, |d| { let _ = bun_sys::close(d); });

        let lockfile_path =
            resolve_path::join_abs_string_z::<resolve_path::platform::Auto>(cwd.slice(), &[b"bun.lockb"]);

        let mut lockfile_ = Lockfile::init_empty();

        // TODO(b2-blocked): bun_bundler::Transpiler — stub is opaque `Transpiler(())`;
        // needs `.resolver.env_loader` / `.resolver.get_package_manager()` / `.env`.
        // Re-gated: env_loader fixup + manager acquisition. Passing `None` until
        // the bundler crate un-gates Transpiler/Resolver field surface.
        #[cfg(any())]
        {
            // PORT NOTE: reshaped for borrowck — Zig accessed globalObject.bunVM().transpiler.resolver
            // through chained pointer dereferences.
            let vm = global.bun_vm();
            if vm.transpiler.resolver.env_loader.is_none() {
                vm.transpiler.resolver.env_loader = Some(vm.transpiler.env);
            }
        }
        // as long as we aren't migration from `package-lock.json`, leaving this undefined is okay
        #[cfg(any())]
        let manager = Some(global.bun_vm().transpiler.resolver.get_package_manager());
        #[cfg(not(any()))]
        let manager = None;

        let load_result: lockfile::LoadResult =
            lockfile_.load_from_dir(*dir, manager, &mut log, true);

        match load_result {
            lockfile::LoadResult::Err(err) => {
                return Err(global.throw(format_args!(
                    "failed to load lockfile: {}, '{}'",
                    BStr::new(err.value.name()),
                    BStr::new(lockfile_path.as_bytes()),
                )));
            }
            lockfile::LoadResult::NotFound => {
                return Err(global.throw(format_args!(
                    "lockfile not found: '{}'",
                    BStr::new(lockfile_path.as_bytes()),
                )));
            }
            lockfile::LoadResult::Ok(_) => {}
        }

        // TODO(port): std.json.fmt — Zig used std.json.fmt(lockfile, .{ .whitespace = .indent_2,
        // .emit_null_optional_fields = true, .emit_nonportable_numbers_as_strings = true }).
        // Need a Rust-side JSON serializer for Lockfile with the same options.
        let mut stringified = Vec::<u8>::new();
        write!(
            &mut stringified,
            "{}",
            lockfile_.to_json_fmt(lockfile::JsonFmtOptions {
                whitespace: lockfile::JsonWhitespace::Indent2,
                emit_null_optional_fields: true,
                emit_nonportable_numbers_as_strings: true,
            }),
        )
        .expect("unreachable");

        let mut str = BunString::clone_utf8(&stringified);

        bun_jsc::bun_string_jsc::to_js_by_parse_json(&mut str, global)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install_jsc/install_binding.zig (72 lines)
//   confidence: medium
//   todos:      1
//   notes:      std.json.fmt(Lockfile) needs a Rust serializer; bun_vm() field-chain access will need borrowck reshaping in Phase B
// ──────────────────────────────────────────────────────────────────────────

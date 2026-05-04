//! Test-only host fns for `bun.ini` (used by `internal-for-testing.ts`).
//! Kept out of `ini/` so that directory has no JSC references.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_str::String as BunString;
use bun_str::StringJsc as _; // extension trait: .to_js()

use bun_logger::{Log, Source};
use bun_install::npm::Registry;
use bun_ini::{config_iterator, load_npmrc, Parser};
use bun_dotenv as dotenv;
use bun_schema::api::BunInstall;

pub struct IniTestingAPIs;

impl IniTestingAPIs {
    #[bun_jsc::host_fn]
    pub fn load_npmrc_from_js(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let arg = frame.argument(0);
        let npmrc_contents = arg.to_bun_string(global)?;
        let npmrc_utf8 = npmrc_contents.to_utf8();
        let source = Source::init_path_string(b"<js>", npmrc_utf8.as_bytes());

        let mut log = Log::new();

        // PERF(port): was ArenaAllocator bulk-free — profile in Phase B
        // (all `allocator.create`/`toOwnedSlice` below now use the global mimalloc)

        let envjs = frame.argument(1);
        // PORT NOTE: reshaped for borrowck — Zig returned either a VM-owned *Loader or
        // an arena-allocated *Loader from a labeled block. Here we hold the owned case
        // in `env_storage` and borrow uniformly.
        let mut env_storage: Option<Box<dotenv::Loader>> = None;
        let env: &dotenv::Loader = if envjs.is_empty_or_undefined_or_null() {
            global.bun_vm().transpiler.env
        } else {
            let mut envmap = dotenv::map::HashTable::new();
            let Some(envobj) = envjs.get_object() else {
                return Err(global.throw_type_error("env must be an object"));
            };
            // TODO(port): JSPropertyIterator took comptime options struct
            // `.{ .skip_empty_name = false, .include_value = true }` in Zig.
            let mut object_iter = bun_jsc::JSPropertyIterator::init(
                global,
                envobj,
                bun_jsc::JSPropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value: true,
                },
            )?;

            envmap.reserve(object_iter.len as usize);

            while let Some(key) = object_iter.next()? {
                let keyslice = key.to_owned_slice()?;
                let value = object_iter.value;
                if value.is_undefined() {
                    continue;
                }

                let value_str = value.get_zig_string(global)?;
                let slice = value_str.to_owned_slice()?;

                // Zig: `catch return globalThis.throwOutOfMemoryValue()` — Rust aborts on OOM.
                envmap.put(
                    keyslice,
                    dotenv::map::Entry {
                        value: slice,
                        conditional: false,
                    },
                );
            }

            let map = Box::new(dotenv::Map { map: envmap });
            // TODO(port): lifetime — Loader borrows `map`; Zig used arena so both lived
            // until fn return. Leaking the Box mirrors arena semantics for this test-only path.
            let map_ref: &'static mut dotenv::Map = Box::leak(map);
            let loader = dotenv::Loader::init(map_ref);
            env_storage = Some(Box::new(loader));
            env_storage.as_deref().unwrap()
        };

        // SAFETY: all-zero is a valid BunInstall (#[repr(C)] POD per schema codegen).
        let mut install: Box<BunInstall> =
            Box::new(unsafe { core::mem::zeroed::<BunInstall>() });
        let mut configs: Vec<config_iterator::Item> = Vec::new();
        if load_npmrc(&mut *install, env, b".npmrc", &mut log, &source, &mut configs).is_err() {
            return Ok(log.to_js(global, "error"));
        }

        let (
            default_registry_url,
            default_registry_token,
            default_registry_username,
            default_registry_password,
            default_registry_email,
        ) = 'brk: {
            let Some(default_registry) = install.default_registry.as_ref() else {
                break 'brk (
                    BunString::from_static(Registry::DEFAULT_URL),
                    BunString::empty(),
                    BunString::empty(),
                    BunString::empty(),
                    BunString::empty(),
                );
            };

            (
                BunString::from_bytes(&default_registry.url),
                BunString::from_bytes(&default_registry.token),
                BunString::from_bytes(&default_registry.username),
                BunString::from_bytes(&default_registry.password),
                BunString::from_bytes(&default_registry.email),
            )
        };
        // `defer { *.deref() }` deleted — bun_str::String impls Drop.

        // TODO(port): `jsc.JSObject.create(.{ .field = val, ... }, global)` reflects over
        // an anon struct's fields at comptime. Phase B needs a builder or proc-macro;
        // approximated here as a (name, JSValue) slice.
        Ok(bun_jsc::JSObject::create(
            global,
            &[
                ("default_registry_url", default_registry_url.to_js(global)),
                ("default_registry_token", default_registry_token.to_js(global)),
                ("default_registry_username", default_registry_username.to_js(global)),
                ("default_registry_password", default_registry_password.to_js(global)),
                ("default_registry_email", default_registry_email.to_js(global)),
            ],
        )?
        .to_js())
    }

    #[bun_jsc::host_fn]
    pub fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = frame.arguments_old(1);
        let arguments = arguments_.slice();

        let jsstr = arguments[0];
        let bunstr = jsstr.to_bun_string(global)?;
        let utf8str = bunstr.to_utf8();

        let mut parser = Parser::init(
            b"<src>",
            utf8str.as_bytes(),
            global.bun_vm().transpiler.env,
        );

        // PERF(port): Zig passed `parser.arena.allocator()`; ini is not an AST crate so
        // the allocator param is dropped.
        parser.parse()?;

        match parser.out.to_js(global) {
            Ok(v) => Ok(v),
            Err(e) => Err(global.throw_error(e, "failed to turn AST into JS")),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install_jsc/ini_jsc.zig (129 lines)
//   confidence: medium
//   todos:      3
//   notes:      arena removed (test-only path); JSObject::create anon-struct + JSPropertyIterator comptime opts need Phase-B API; dotenv::Loader/Map crate path guessed
// ──────────────────────────────────────────────────────────────────────────

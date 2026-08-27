//! Test-only host fns for `bun.ini` (used by `internal-for-testing.ts`).
//! Kept out of `ini/` so that directory has no JSC references.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, LogJsc as _, StringJsc};

/// Free-fn aliases of the [`IniTestingAPIs`] associated fns so
/// `bun_runtime::dispatch::js2native` can `pub use` them (associated fns
/// aren't importable items).
#[inline]
pub fn ini_testing_parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    IniTestingAPIs::parse(global, frame)
}
#[inline]
pub fn ini_testing_load_npmrc_from_js(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    IniTestingAPIs::load_npmrc_from_js(global, frame)
}

pub(crate) struct IniTestingAPIs;

impl IniTestingAPIs {
    pub(crate) fn load_npmrc_from_js(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        use bun_api::BunInstall;
        use bun_ast::{Log, Source};
        use bun_core::String as BunString;
        use bun_dotenv as dotenv;
        use bun_ini::load_npmrc;
        use bun_install::npm::Registry;

        let arg = frame.argument(0);
        let npmrc_contents = arg.to_js_string_view(global)?;
        let npmrc_utf8 = npmrc_contents.to_utf8();
        let source = Source::init_path_string(b"<js>", npmrc_utf8.slice());

        let mut log = Log::init();

        let envjs = frame.argument(1);
        // The loader is either VM-owned or built locally; keep local storage in
        // an `Option` so both arms yield the same `&Loader` type.
        let mut env_storage: Option<dotenv::Loader> = None;
        let env: &dotenv::Loader = if envjs.is_empty_or_undefined_or_null() {
            global.bun_vm().as_mut().transpiler.env()
        } else {
            let mut envmap = dotenv::map::HashTable::new();
            let Some(envobj) = envjs.get_object() else {
                return Err(global.throw_type_error(format_args!("env must be an object")));
            };
            let object_iter = bun_jsc::JSPropertyIterator::init(
                global,
                envobj,
                bun_jsc::JSPropertyIteratorOptions::new(
                    /* skip_empty_name */ false, /* include_value   */ true,
                ),
            )?;

            envmap.ensure_total_capacity(object_iter.len)?;

            while let Some((key, value)) = object_iter.next()? {
                let keyslice = key.to_owned_slice();
                if value.is_undefined() {
                    continue;
                }

                let slice = value.to_bun_string(global)?.to_owned_slice();

                envmap.put(
                    &keyslice,
                    dotenv::map::Entry {
                        value: slice.into_boxed_slice(),
                    },
                )?;
            }

            env_storage.insert(dotenv::Loader::init_with_map(dotenv::Map { map: envmap }))
        };

        let mut install = Box::new(BunInstall::default());
        if load_npmrc(&mut install, env, &mut log, &source).is_err() {
            return log.to_js(global, format_args!("error"));
        }
        // The package manager applies `url_auth` in `Options::load`; the same walk
        // here reports what a request to the default registry would carry.
        let default_url: Box<[u8]> = match install.default_registry.as_ref() {
            Some(registry) => registry.url.clone(),
            None => Registry::DEFAULT_URL.as_bytes().into(),
        };
        let found = bun_ini::RegistryKey::from_url(&default_url)
            .walk()
            .find_map(|key| install.url_auth.iter().find(|entry| *entry.key == *key));
        if let Some(found) = found {
            let registry = install
                .default_registry
                .get_or_insert_with(|| bun_api::NpmRegistry {
                    url: default_url.clone(),
                    ..Default::default()
                });
            if !registry.has_credentials() || registry.credentials_from_url {
                registry.token = Box::default();
                registry.auth = Box::default();
                registry.username = Box::default();
                registry.password = Box::default();
                registry.token.clone_from(&found.credentials.token);
                registry.auth.clone_from(&found.credentials.auth);
                registry.username.clone_from(&found.credentials.username);
                registry.password.clone_from(&found.credentials.password);
            }
        }

        let (
            default_registry_url,
            default_registry_token,
            default_registry_username,
            default_registry_password,
            default_registry_auth,
        ) = 'brk: {
            let Some(default_registry) = install.default_registry.as_ref() else {
                break 'brk (
                    BunString::static_(Registry::DEFAULT_URL),
                    BunString::EMPTY,
                    BunString::EMPTY,
                    BunString::EMPTY,
                    BunString::EMPTY,
                );
            };

            (
                BunString::from_bytes(&default_registry.url),
                BunString::from_bytes(&default_registry.token),
                BunString::from_bytes(&default_registry.username),
                BunString::from_bytes(&default_registry.password),
                BunString::from_bytes(&default_registry.auth),
            )
        };
        // Rust has no field reflection; mirror struct-literal object creation with
        // a local `PojoFields` impl (the bun_jsc-convention until `#[derive(PojoFields)]`
        // lands) so each `bun.String → JSValue` encoding interleaves with `put()` and
        // stays on the stack for JSC's conservative scan.
        struct Pojo {
            default_registry_url: BunString,
            default_registry_token: BunString,
            default_registry_username: BunString,
            default_registry_password: BunString,
            default_registry_auth: BunString,
        }
        impl bun_jsc::js_object::PojoFields for Pojo {
            const FIELD_COUNT: usize = 5;
            fn put_fields(
                &self,
                global: &JSGlobalObject,
                mut put: impl FnMut(&'static [u8], JSValue) -> JsResult<()>,
            ) -> JsResult<()> {
                put(
                    b"default_registry_url",
                    self.default_registry_url.to_js(global)?,
                )?;
                put(
                    b"default_registry_token",
                    self.default_registry_token.to_js(global)?,
                )?;
                put(
                    b"default_registry_username",
                    self.default_registry_username.to_js(global)?,
                )?;
                put(
                    b"default_registry_password",
                    self.default_registry_password.to_js(global)?,
                )?;
                put(
                    b"default_registry_auth",
                    self.default_registry_auth.to_js(global)?,
                )?;
                Ok(())
            }
        }
        let pojo = Pojo {
            default_registry_url,
            default_registry_token,
            default_registry_username,
            default_registry_password,
            default_registry_auth,
        };
        Ok(bun_jsc::JSObject::create(&pojo, global)?.to_js())
    }

    pub(crate) fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        use bun_ast::ToJSError;
        use bun_ini::Parser;
        use bun_jsc::JsError;

        let arguments = frame.arguments();

        let jsstr = arguments[0];
        let bunstr = jsstr.to_js_string_view(global)?;
        let utf8str = bunstr.to_utf8();

        let env = global.bun_vm().as_mut().transpiler.env();
        let source = bun_ast::Source::init_path_string(b"<src>", utf8str.slice());
        let arena = bun_alloc::Arena::new();
        let mut parser = Parser::init(&source, env);
        parser.parse(&arena)?;

        match bun_js_parser_jsc::expr_to_js(&parser.out, global) {
            Ok(v) => Ok(v),
            Err(ToJSError::OutOfMemory) => Err(JsError::OutOfMemory),
            Err(ToJSError::JSError) => Err(JsError::Thrown),
            Err(e) => {
                Err(global.throw_error(bun_jsc::CrateError::from(e), "failed to turn AST into JS"))
            }
        }
    }
}

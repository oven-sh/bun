//! `bun build --target=bun_builtins --builtins-manifest <path>`

use bstr::BStr;
use bun_ast::Target;
use bun_builtin_syntax::Manifest;
use bun_core::{Global, Output};
use bun_options_types::schema::api;

fn private_name(name: &[u8]) -> Box<[u8]> {
    [Target::PRIVATE_NAME_PREFIX, name]
        .concat()
        .into_boxed_slice()
}

/// Makes the tables at `path` the ones the parser and the linker read, and adds their defines.
pub(crate) fn install(path: &[u8], opts: &mut api::TransformOptions) {
    let Ok(text) = bun_sys::File::read_from(bun_core::Fd::cwd(), path) else {
        Output::err_generic(
            "--builtins-manifest: cannot read {}",
            format_args!("{}", BStr::new(path)),
        );
        Global::exit(1);
    };
    let manifest = match Manifest::parse(&text) {
        Ok(manifest) => Manifest::install(manifest),
        Err(error) => {
            Output::err_generic(
                "--builtins-manifest: malformed at {}",
                format_args!("{}:{}", BStr::new(path), error.line),
            );
            Global::exit(1);
        }
    };

    let define = opts.define.get_or_insert_with(|| api::StringMap {
        keys: Vec::new(),
        values: Vec::new(),
    });
    for (key, value) in manifest.defines() {
        define.keys.push(match key.strip_prefix(b"$") {
            Some(name) => private_name(name),
            None => key.clone(),
        });
        define.values.push(value.clone());
    }
    for name in manifest.hardened_globals() {
        define.keys.push(name.clone());
        define.values.push(private_name(name));
    }
    define.keys.push(private_name(b"debug"));
    define.values.push(if manifest.is_development() {
        Box::from(&b"$debug_log_enabled"[..])
    } else {
        Box::from(&b"false"[..])
    });
}

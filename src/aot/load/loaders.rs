use bun_ast::Loader;
use bun_paths::fs::PathName;
use bun_sema::program::HostLoader;
use bun_sema::resolve::{CodeImportKind, ScriptKind};

use crate::options::DEFAULT_LOADERS;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum TypeAttribute {
    Absent,
    Loader(Loader),
    Macro,
    Unknown,
}

pub(crate) fn classify_type_attribute(value: Option<&[u8]>) -> TypeAttribute {
    match value {
        None => TypeAttribute::Absent,
        Some(b"macro") => TypeAttribute::Macro,
        Some(text) => {
            Loader::from_string(text).map_or(TypeAttribute::Unknown, TypeAttribute::Loader)
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum HostLoaderKind {
    ByName,
    Loader(Loader),
}

pub(crate) const BY_NAME: HostLoader = HostLoader(0);

macro_rules! define_host_numbers {
    ($($loader:ident = $number:literal,)*) => {
        fn host_number(loader: Loader) -> u8 {
            match loader {
                $(Loader::$loader => $number,)*
            }
        }

        fn loader_from_host_number(number: u8) -> Option<Loader> {
            match number {
                $($number => Some(Loader::$loader),)*
                _ => None,
            }
        }
    };
}

define_host_numbers! {
    Jsx = 1,
    Js = 2,
    Ts = 3,
    Tsx = 4,
    Css = 5,
    File = 6,
    Json = 7,
    Jsonc = 8,
    Toml = 9,
    Wasm = 10,
    Napi = 11,
    Base64 = 12,
    Dataurl = 13,
    Text = 14,
    Bunsh = 15,
    Sqlite = 16,
    SqliteEmbedded = 17,
    Html = 18,
    Yaml = 19,
    Json5 = 20,
    Md = 21,
    Xml = 22,
}

pub(crate) fn to_host_loader(loader: Loader, path: &[u8]) -> HostLoader {
    match loader == loader_by_name(path) {
        true => BY_NAME,
        false => HostLoader(host_number(loader)),
    }
}

pub(crate) fn host_loader_kind(loader: HostLoader) -> Option<HostLoaderKind> {
    match loader {
        BY_NAME => Some(HostLoaderKind::ByName),
        HostLoader(number) => loader_from_host_number(number).map(HostLoaderKind::Loader),
    }
}

pub(crate) fn loader_by_name(path: &[u8]) -> Loader {
    loader_by_path(DEFAULT_LOADERS, path, CodeImportKind::Import)
}

pub(crate) fn loader_by_path<E: AsRef<[u8]>>(
    table: &[(E, Loader)],
    path: &[u8],
    kind: CodeImportKind,
) -> Loader {
    let name = PathName::init(path);
    let found = match table.binary_search_by(|(extension, _)| extension.as_ref().cmp(name.ext)) {
        Ok(index) => Some(table[index].1),
        Err(_) => Loader::from_string(name.ext),
    };
    if matches!(found, None | Some(Loader::Json)) && is_jsonc_file_name(name.filename) {
        return Loader::Jsonc;
    }
    match (found, kind) {
        (Some(loader), _) => loader,
        (None, _) if name.ext.is_empty() => Loader::Tsx,
        (None, CodeImportKind::EntryPoint) => Loader::Tsx,
        (None, CodeImportKind::Require) => Loader::Ts,
        (None, CodeImportKind::Import) => Loader::File,
    }
}

fn is_jsonc_file_name(file_name: &[u8]) -> bool {
    let is_typescript_config =
        file_name.starts_with(b"tsconfig.") || file_name.starts_with(b"jsconfig.");
    file_name == b"package.json"
        || file_name == b"bun.lock"
        || file_name.ends_with(b".jsonc")
        || (is_typescript_config && file_name.ends_with(b".json"))
}

pub(crate) fn script_kind_of(loader: Loader) -> Option<ScriptKind> {
    match loader {
        Loader::Js => Some(ScriptKind::Js),
        Loader::Jsx => Some(ScriptKind::Jsx),
        Loader::Ts => Some(ScriptKind::Ts),
        Loader::Tsx => Some(ScriptKind::Tsx),
        _ => None,
    }
}

pub(crate) fn script_loader(kind: ScriptKind) -> Loader {
    match kind {
        ScriptKind::Js => Loader::Js,
        ScriptKind::Jsx => Loader::Jsx,
        ScriptKind::Ts => Loader::Ts,
        ScriptKind::Tsx => Loader::Tsx,
    }
}

pub(crate) fn reads_raw_bytes(loader: Loader) -> bool {
    match loader {
        Loader::File
        | Loader::Wasm
        | Loader::Napi
        | Loader::Base64
        | Loader::Dataurl
        | Loader::Sqlite
        | Loader::SqliteEmbedded => true,
        _ => false,
    }
}

pub(crate) fn loader_name(loader: Loader) -> &'static str {
    loader.into()
}

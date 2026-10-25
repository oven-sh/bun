use bun_ast::Loader;
use bun_paths::fs::PathName;
use bun_sema::program::HostLoader;
use bun_sema::resolve::{CodeImportKind, ScriptKind};

use crate::options::DEFAULT_LOADERS;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum HostLoaderKind {
    ByName,
    Loader(Loader),
}

pub(crate) const BY_NAME: HostLoader = HostLoader(0);

macro_rules! define_host_numbers {
    ($($loader:ident = $number:literal,)*) => {
        #[cfg(test)]
        const ALL_LOADERS: &[Loader] = &[$(Loader::$loader),*];

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
    match (loader_named_by_path(table, path), kind) {
        (Some(loader), _) => loader,
        (None, _) if PathName::init(path).ext.is_empty() => Loader::Tsx,
        (None, CodeImportKind::EntryPoint) => Loader::Tsx,
        (None, CodeImportKind::Require) => Loader::Ts,
        (None, CodeImportKind::Import) => Loader::File,
    }
}

pub(crate) fn loader_named_by_path<E: AsRef<[u8]>>(
    table: &[(E, Loader)],
    path: &[u8],
) -> Option<Loader> {
    let name = PathName::init(path);
    let found = match table.binary_search_by(|(extension, _)| extension.as_ref().cmp(name.ext)) {
        Ok(index) => Some(table[index].1),
        Err(_) => Loader::from_string(name.ext),
    };
    match matches!(found, None | Some(Loader::Json)) && is_jsonc_file_name(name.filename) {
        true => Some(Loader::Jsonc),
        false => found,
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

pub(crate) fn reads_raw_bytes(loader: Loader) -> bool {
    matches!(
        loader,
        Loader::File
            | Loader::Wasm
            | Loader::Napi
            | Loader::Base64
            | Loader::Dataurl
            | Loader::Sqlite
            | Loader::SqliteEmbedded
    )
}

pub(crate) fn loader_name(loader: Loader) -> &'static str {
    loader.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    const JS_AS_TS: [(&[u8], Loader); 1] = [(b".js", Loader::Ts)];

    #[test]
    fn host_numbers_invert_and_avoid_reserved_numbers() {
        for &loader in ALL_LOADERS {
            let number = host_number(loader);
            assert_eq!(loader_from_host_number(number), Some(loader));
            assert_ne!(HostLoader(number), BY_NAME);
        }
    }

    #[test]
    fn host_loader_round_trips() {
        let paths: [&[u8]; 6] = [
            b"/project/a.ts",
            b"/project/a.js",
            b"/project/a.json",
            b"/project/a.toml",
            b"/project/a",
            b"/project/tool.bin",
        ];
        for path in paths {
            for &loader in ALL_LOADERS {
                let expected = match loader_by_name(path) == loader {
                    true => HostLoaderKind::ByName,
                    false => HostLoaderKind::Loader(loader),
                };
                let actual = host_loader_kind(to_host_loader(loader, path));
                assert_eq!(actual, Some(expected));
            }
        }
    }

    #[test]
    fn host_loader_zero_means_by_name() {
        let text = HostLoader(host_number(Loader::Text));
        assert_eq!(BY_NAME, HostLoader::default());
        assert_eq!(loader_by_name(b"/project/a.js"), Loader::Jsx);
        assert_eq!(to_host_loader(Loader::Jsx, b"/project/a.js"), BY_NAME);
        assert_eq!(to_host_loader(Loader::Text, b"/project/a.txt"), BY_NAME);
        assert_eq!(to_host_loader(Loader::Text, b"/project/a.ts"), text);
    }

    #[test]
    fn loader_option_changes_host_loader() {
        let imported = |path: &[u8]| loader_by_path(&JS_AS_TS, path, CodeImportKind::Import);
        let loader = imported(b"/project/a.js");
        assert_eq!(loader, Loader::Ts);
        let typescript = HostLoader(host_number(Loader::Ts));
        assert_eq!(to_host_loader(loader, b"/project/a.js"), typescript);
        assert_eq!(imported(b"/project/a.mjs"), Loader::Js);
    }

    #[test]
    fn host_loader_kind_rejects_unassigned_numbers() {
        let xml = HostLoaderKind::Loader(Loader::Xml);
        assert_eq!(host_loader_kind(BY_NAME), Some(HostLoaderKind::ByName));
        assert_eq!(host_loader_kind(HostLoader(22)), Some(xml));
        assert_eq!(host_loader_kind(HostLoader(23)), None);
        assert_eq!(host_loader_kind(HostLoader(200)), None);
        assert_eq!(host_loader_kind(HostLoader(255)), None);
    }

    #[test]
    fn configuration_files_are_jsonc() {
        let jsonc_paths: [&[u8]; 6] = [
            b"/project/package.json",
            b"/project/bun.lock",
            b"/project/tsconfig.json",
            b"/project/tsconfig.app.json",
            b"/project/jsconfig.json",
            b"/project/settings.jsonc",
        ];
        for path in jsonc_paths {
            assert_eq!(loader_by_name(path), Loader::Jsonc);
        }
        assert_eq!(loader_by_name(b"/project/data.json"), Loader::Json);
        assert_eq!(loader_by_name(b"/project/my-tsconfig.json"), Loader::Json);
        assert_eq!(loader_by_name(b"/project/tsconfig.ts"), Loader::Ts);
    }

    #[test]
    fn unknown_extension_depends_on_import_kind() {
        let loaded_as = |kind, path: &[u8]| loader_by_path(DEFAULT_LOADERS, path, kind);
        assert_eq!(loader_by_name(b"/project/tool"), Loader::Tsx);
        assert_eq!(loader_by_name(b"/project.d/tool"), Loader::Tsx);
        assert_eq!(loader_by_name(b"/project/x.unknown"), Loader::File);
        let entry_point = CodeImportKind::EntryPoint;
        assert_eq!(loaded_as(entry_point, b"/project/x.unknown"), Loader::Tsx);
        assert_eq!(loaded_as(entry_point, b"/project/x.txt"), Loader::Text);
        let require = CodeImportKind::Require;
        assert_eq!(loaded_as(require, b"/project/x.unknown"), Loader::Ts);
        assert_eq!(loaded_as(require, b"/project/tool"), Loader::Tsx);
        assert_eq!(loaded_as(require, b"/project/x.txt"), Loader::Text);
    }

    #[test]
    fn only_known_extension_names_loader() {
        let named = |path: &[u8]| loader_named_by_path(DEFAULT_LOADERS, path);
        assert_eq!(named(b"/project/x.unknown"), None);
        assert_eq!(named(b"/project/tool"), None);
        assert_eq!(named(b"/project.d/tool"), None);
        assert_eq!(named(b"/project/addon.node"), Some(Loader::Napi));
        assert_eq!(named(b"/project/a.xml"), Some(Loader::Xml));
        assert_eq!(named(b"/project/bun.lock"), Some(Loader::Jsonc));
    }

    #[test]
    fn unlisted_extension_uses_loader_name() {
        assert_eq!(loader_by_name(b"/project/a.xml"), Loader::Xml);
        assert_eq!(loader_by_name(b"/project/a.md"), Loader::Md);
        assert_eq!(loader_by_name(b"/project/a.sh"), Loader::Bunsh);
        assert_eq!(loader_by_name(b"/project/a.sqlite"), Loader::Sqlite);
    }

    #[test]
    fn only_script_loaders_have_script_kind() {
        assert_eq!(script_kind_of(Loader::Js), Some(ScriptKind::Js));
        assert_eq!(script_kind_of(Loader::Jsx), Some(ScriptKind::Jsx));
        assert_eq!(script_kind_of(Loader::Ts), Some(ScriptKind::Ts));
        assert_eq!(script_kind_of(Loader::Tsx), Some(ScriptKind::Tsx));
        let script_kinds = ALL_LOADERS.iter().copied().filter_map(script_kind_of);
        assert_eq!(script_kinds.count(), 4);
    }

    #[test]
    fn no_script_loader_reads_raw_bytes() {
        assert!(reads_raw_bytes(Loader::Wasm));
        assert!(reads_raw_bytes(Loader::SqliteEmbedded));
        assert!(!reads_raw_bytes(Loader::Text));
        assert!(!reads_raw_bytes(Loader::Json));
        for &loader in ALL_LOADERS {
            assert!(script_kind_of(loader).is_none() || !reads_raw_bytes(loader));
        }
    }

    #[test]
    fn loader_names_are_snake_case() {
        assert_eq!(loader_name(Loader::Text), "text");
        assert_eq!(loader_name(Loader::SqliteEmbedded), "sqlite_embedded");
    }
}

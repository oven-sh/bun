//! The keys under which an executable stores the program's modules. The build names each module by these rules, and the run time looks modules up by the same rules.

use bun_ast::Loader;
use bun_paths::fs::PathName;
use std::hash::{DefaultHasher, Hasher};

/// Made from a file's modification time and size, so it changes when the file is rewritten. The build records one for each file the program may read from disk again,
/// and the run time computes another before it first loads the compiled version of that file. Never zero: zero means no file.
pub fn stamp_of_file(written_seconds: i64, written_nanoseconds: i64, size: u64) -> u64 {
    let written = (written_seconds as u64)
        .wrapping_mul(1_000_000_000)
        .wrapping_add(written_nanoseconds as u64);
    (written ^ size.rotate_left(44)) | 1
}

pub const DEFAULT_LOADERS: &[(&[u8], Loader)] = &[
    (b".cjs", Loader::Js),
    (b".css", Loader::Css),
    (b".cts", Loader::Ts),
    (b".html", Loader::Html),
    // Bun reads JSX in `.js` files.
    (b".js", Loader::Jsx),
    (b".json", Loader::Json),
    (b".json5", Loader::Json5),
    (b".jsonc", Loader::Jsonc),
    (b".jsx", Loader::Jsx),
    (b".mjs", Loader::Js),
    (b".mts", Loader::Ts),
    (b".node", Loader::Napi),
    (b".text", Loader::Text),
    (b".toml", Loader::Toml),
    (b".ts", Loader::Ts),
    (b".tsx", Loader::Tsx),
    (b".txt", Loader::Text),
    (b".wasm", Loader::Wasm),
    (b".yaml", Loader::Yaml),
    (b".yml", Loader::Yaml),
];

/// The loader that an import without attributes uses.
pub fn loader_by_name(path: &[u8]) -> Loader {
    loader_by_path_or(DEFAULT_LOADERS, path, Loader::File)
}

/// `unnamed`: the loader for a file whose extension matches no loader.
pub fn loader_by_path_or<E: AsRef<[u8]>>(
    table: &[(E, Loader)],
    path: &[u8],
    unnamed: Loader,
) -> Loader {
    match loader_named_by_path(table, path) {
        Some(loader) => loader,
        None if PathName::init(path).ext.is_empty() => Loader::Tsx,
        None => unnamed,
    }
}

pub fn loader_named_by_path<E: AsRef<[u8]>>(table: &[(E, Loader)], path: &[u8]) -> Option<Loader> {
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

pub fn loader_name(loader: Loader) -> &'static str {
    loader.into()
}

/// The `type` attribute that `bun run` prints on an import statement that asks for `loader`.
pub fn type_attribute_of(loader: Loader) -> &'static str {
    match loader {
        Loader::Bunsh => "sh",
        Loader::SqliteEmbedded => "sqlite",
        _ => loader_name(loader),
    }
}

/// A file loaded the way an import without attributes loads it is keyed by its plain path. Loaded with any other loader, it is keyed by this.
pub fn path_of_form(path: &[u8], loader: Loader) -> Vec<u8> {
    [path, b"?", loader_name(loader).as_bytes()].concat()
}

/// The path of the file that a form is made of: what `path_of_form` was given. `None`: the path holds no `?`.
pub fn path_without_form(path: &[u8]) -> Option<&[u8]> {
    let mark = path.iter().rposition(|&byte| byte == b'?')?;
    Some(&path[..mark])
}

/// True if the module's value comes from the file's contents alone, not from its path.
pub fn parses_text_as_data(loader: Loader) -> bool {
    matches!(
        loader,
        Loader::Json
            | Loader::Jsonc
            | Loader::Json5
            | Loader::Toml
            | Loader::Yaml
            | Loader::Xml
            | Loader::Text
    )
}

/// True if `bun run` creates the module's exports while it loads the file. Evaluating such a module runs no code, and none of its exports has a temporal dead zone.
pub fn makes_values_at_load(loader: Loader) -> bool {
    matches!(
        loader,
        Loader::Json
            | Loader::Jsonc
            | Loader::Json5
            | Loader::Toml
            | Loader::Yaml
            | Loader::Xml
            | Loader::File
            | Loader::Wasm
            | Loader::Css
            | Loader::Html
    )
}

/// The keys to look under for the module that an import of `path` with `{ type: type_attribute }` gets.
#[derive(PartialEq, Eq, Debug)]
pub struct PlacesOfForm {
    /// The first key to look under.
    pub path_of_form: Vec<u8>,
    /// True if an import without attributes gets the same module, unless a build option gave the file another loader.
    pub is_form_without_attributes: bool,
}

/// `None`: the run-time loader creates the module, as it does in an executable that is not compiled ahead of time. For a type that loads the file as code it runs the code once more, and for a type that yields the file's path it reads nothing.
pub fn places_of_form(path: &[u8], type_attribute: &[u8]) -> Option<PlacesOfForm> {
    // A database is not parsed from the file's text, but every importer of the file shares one object.
    let has_form = |&it: &Loader| parses_text_as_data(it) || it == Loader::Sqlite;
    let loader = Loader::from_string(type_attribute).filter(has_form)?;
    Some(PlacesOfForm {
        path_of_form: path_of_form(path, loader),
        is_form_without_attributes: !is_url_with_text(path) && loader == loader_by_name(path),
    })
}

/// The key of the form that uses the default loader for `path`. `None` if that loader does not parse data.
pub fn path_of_default_form(path: &[u8]) -> Option<Vec<u8>> {
    let loader = loader_by_name(path);
    let has_form = !is_url_with_text(path) && parses_text_as_data(loader);
    has_form.then(|| path_of_form(path, loader))
}

/// An import without attributes loads the URL's contents as code, whatever the URL ends in.
pub fn is_url_with_text(path: &[u8]) -> bool {
    path.starts_with(b"data:")
}

/// True if `path` is not a file path but the URL of source text that a Worker starts from.
pub fn is_name_of_text(path: &[u8]) -> bool {
    path.starts_with(b"data:") || path.starts_with(b"blob:")
}

/// The key under which an executable stores the code that a Worker starts from through an object URL. It is derived from the text and its loader, and it is shaped like an object URL.
pub fn name_of_text(loader: Loader, text: &[u8]) -> Vec<u8> {
    let half = |which: u8| {
        let mut hasher = DefaultHasher::new();
        hasher.write(&[which, loader as u8]);
        hasher.write(text);
        hasher.finish()
    };
    let (first, second) = (half(0), half(1));
    format!(
        "blob:{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        first >> 32,
        (first >> 16) & 0xffff,
        first & 0xffff,
        second >> 48,
        second & 0xffff_ffff_ffff,
    )
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn places(path: &[u8], type_attribute: &[u8]) -> Option<(Vec<u8>, bool)> {
        let places = places_of_form(path, type_attribute)?;
        Some((places.path_of_form, places.is_form_without_attributes))
    }

    #[test]
    fn type_attribute_round_trips_to_its_loader() {
        for loader in [
            Loader::Toml,
            Loader::Json,
            Loader::Text,
            Loader::Bunsh,
            Loader::Sqlite,
        ] {
            let written = type_attribute_of(loader).as_bytes();
            assert_eq!(Loader::from_string(written), Some(loader));
        }
        assert_eq!(type_attribute_of(Loader::SqliteEmbedded), "sqlite");
    }

    #[test]
    fn type_that_matches_the_file_extension_is_the_default_form() {
        let path = b"/$bunfs/root/a.json";
        let as_json = b"/$bunfs/root/a.json?json".to_vec();
        let as_text = b"/$bunfs/root/a.json?text".to_vec();
        assert_eq!(places(path, b"json"), Some((as_json, true)));
        assert_eq!(places(path, b"text"), Some((as_text.clone(), false)));
        assert_eq!(places(path, b"txt"), Some((as_text, false)));
    }

    #[test]
    fn default_form_uses_the_loader_for_the_extension() {
        let as_yaml = b"/$bunfs/root/a.yaml?yaml".to_vec();
        assert_eq!(path_of_default_form(b"/$bunfs/root/a.yaml"), Some(as_yaml));
        assert_eq!(path_of_default_form(b"/$bunfs/root/a.ts"), None);
        assert_eq!(path_of_default_form(b"/$bunfs/root/a.png"), None);
        assert_eq!(path_of_default_form(b"data:text/plain,a.json"), None);
    }

    #[test]
    fn name_of_text_is_shaped_like_an_object_url() {
        let name = name_of_text(Loader::Tsx, b"postMessage(1)");
        assert_eq!(name.len(), b"blob:".len() + 36);
        assert_eq!(name, name_of_text(Loader::Tsx, b"postMessage(1)"));
        assert_ne!(name, name_of_text(Loader::Js, b"postMessage(1)"));
        assert_ne!(name, name_of_text(Loader::Tsx, b"postMessage(2)"));
    }

    #[test]
    fn data_url_is_data_only_with_a_type_attribute() {
        let url = b"data:text/plain,a.json";
        let as_json = b"data:text/plain,a.json?json".to_vec();
        assert_eq!(places(url, b"json"), Some((as_json, false)));
    }

    #[test]
    fn type_that_is_not_a_data_format_is_left_to_the_run_time_loader() {
        for type_attribute in [&b"file"[..], b"js", b"ts", b"wasm", b"no loader"] {
            assert_eq!(places(b"/$bunfs/root/a.js", type_attribute), None);
        }
    }

    #[test]
    fn database_is_keyed_by_its_type() {
        let as_database = b"/$bunfs/root/a.sqlite?sqlite".to_vec();
        assert_eq!(
            places(b"/$bunfs/root/a.sqlite", b"sqlite"),
            Some((as_database, true))
        );
    }
}

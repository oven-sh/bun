//! The path under which an executable holds a file of the program. The build names each module by these rules, and the run time looks a module up by them.

use bun_ast::Loader;
use bun_paths::fs::PathName;
use std::hash::{DefaultHasher, Hasher};

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

/// What an import without attributes gets.
pub fn loader_by_name(path: &[u8]) -> Loader {
    loader_by_path_or(DEFAULT_LOADERS, path, Loader::File)
}

/// `unnamed`: the loader of a file whose extension names none.
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

/// A file stands under its path as what an import without attributes gets. As anything else it stands here.
pub fn path_of_form(path: &[u8], loader: Loader) -> Vec<u8> {
    [path, b"?", loader_name(loader).as_bytes()].concat()
}

/// True if the module says what the text says, and nothing about where the text is.
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

/// True if `bun run` makes what the module exports when it loads the file. No code runs at the turn of such a module, and none of its names has a dead zone.
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

/// Where the module stands that an import of `path` with `{ type: type_attribute }` gets.
#[derive(PartialEq, Eq, Debug)]
pub struct PlacesOfForm {
    /// The first place to look in.
    pub path_of_form: Vec<u8>,
    /// An import without attributes gets the same, unless an option of the build gave the file another loader.
    pub is_form_without_attributes: bool,
}

/// `None`: the loader of the run time makes the module, as it does in an executable that is not compiled ahead of time. With a type that makes code of the text it runs the text once more, and with one that answers where the file is it reads nothing.
pub fn places_of_form(path: &[u8], type_attribute: &[u8]) -> Option<PlacesOfForm> {
    let loader = Loader::from_string(type_attribute).filter(|&it| parses_text_as_data(it))?;
    Some(PlacesOfForm {
        path_of_form: path_of_form(path, loader),
        is_form_without_attributes: !is_url_with_text(path) && loader == loader_by_name(path),
    })
}

/// An import without attributes reads what the URL holds as code, whatever the URL ends in.
pub fn is_url_with_text(path: &[u8]) -> bool {
    path.starts_with(b"data:")
}

/// The path is no path: it is the name of a text that a Worker starts from.
pub fn is_name_of_text(path: &[u8]) -> bool {
    path.starts_with(b"data:") || path.starts_with(b"blob:")
}

/// The name under which an executable holds the code that a Worker starts from through an object URL. It follows from the text and from how the text is read, and it has the form of such a URL.
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
    fn the_type_that_the_name_of_a_file_says_chooses_what_no_attribute_chooses() {
        let path = b"/$bunfs/root/a.json";
        let as_json = b"/$bunfs/root/a.json?json".to_vec();
        let as_text = b"/$bunfs/root/a.json?text".to_vec();
        assert_eq!(places(path, b"json"), Some((as_json, true)));
        assert_eq!(places(path, b"text"), Some((as_text.clone(), false)));
        assert_eq!(places(path, b"txt"), Some((as_text, false)));
    }

    #[test]
    fn the_name_of_a_text_has_the_form_of_an_object_url() {
        let name = name_of_text(Loader::Tsx, b"postMessage(1)");
        assert_eq!(name.len(), b"blob:".len() + 36);
        assert_eq!(name, name_of_text(Loader::Tsx, b"postMessage(1)"));
        assert_ne!(name, name_of_text(Loader::Js, b"postMessage(1)"));
        assert_ne!(name, name_of_text(Loader::Tsx, b"postMessage(2)"));
    }

    #[test]
    fn a_url_with_text_is_data_under_a_type_alone() {
        let url = b"data:text/plain,a.json";
        let as_json = b"data:text/plain,a.json?json".to_vec();
        assert_eq!(places(url, b"json"), Some((as_json, false)));
    }

    #[test]
    fn a_type_that_makes_no_data_of_the_text_is_left_to_the_loader() {
        for type_attribute in [&b"file"[..], b"js", b"ts", b"wasm", b"sqlite", b"no loader"] {
            assert_eq!(places(b"/$bunfs/root/a.js", type_attribute), None);
        }
    }
}

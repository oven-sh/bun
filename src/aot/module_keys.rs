use bun_ast::Loader;
use bun_paths::fs::PathName;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::normalize_string_buf;
use core::cmp::Ordering;
use std::hash::{DefaultHasher, Hasher};

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

pub fn loader_by_name(path: &[u8]) -> Loader {
    loader_by_path_or(DEFAULT_LOADERS, path, Loader::File)
}

pub fn encode_loaders_given_to_build<E: AsRef<[u8]>>(table: &[(E, Loader)]) -> Vec<u8> {
    let mut encoded = Vec::new();
    for (ending, loader) in table {
        if loader_named_by_path(DEFAULT_LOADERS, ending.as_ref()) != Some(*loader) {
            let fields = [
                ending.as_ref(),
                b"\0",
                type_attribute_of(*loader).as_bytes(),
                b"\0",
            ];
            encoded.extend_from_slice(&fields.concat());
        }
    }
    encoded
}

fn loader_by_name_in_build(loaders_given_to_build: &[u8], path: &[u8]) -> Loader {
    let ending = extension_of(path);
    let mut fields = bun_core::strings::split(loaders_given_to_build, b"\0");
    while let (Some(given), Some(type_attribute)) = (fields.next(), fields.next()) {
        if given == ending {
            return Loader::from_string(type_attribute).unwrap_or(Loader::File);
        }
    }
    loader_by_name(path)
}

pub fn loader_by_path_or<E: AsRef<[u8]>>(
    table: &[(E, Loader)],
    path: &[u8],
    unnamed: Loader,
) -> Loader {
    match loader_named_by_path(table, path) {
        Some(loader) => loader,
        None if extension_of(path).is_empty() => Loader::Tsx,
        None => unnamed,
    }
}

#[inline]
fn extension_of(path: &[u8]) -> &[u8] {
    for (index, &byte) in path.iter().enumerate().rev() {
        match byte {
            b'.' => return &path[index..],
            b'/' | b'\\' => break,
            _ => {}
        }
    }
    PathName::init(path).ext
}

#[inline]
fn compare_bytes(first: &[u8], second: &[u8]) -> Ordering {
    for (a, b) in first.iter().zip(second) {
        if a != b {
            return a.cmp(b);
        }
    }
    first.len().cmp(&second.len())
}

pub fn loader_named_by_path<E: AsRef<[u8]>>(table: &[(E, Loader)], path: &[u8]) -> Option<Loader> {
    let extension = extension_of(path);
    let place = table.binary_search_by(|(other, _)| compare_bytes(other.as_ref(), extension));
    let found = match place {
        Ok(index) => Some(table[index].1),
        Err(_) => Loader::from_string(extension),
    };
    let may_be_jsonc = matches!(found, None | Some(Loader::Json));
    match may_be_jsonc && is_jsonc_file_name(PathName::init(path).filename) {
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

pub fn type_attribute_of(loader: Loader) -> &'static str {
    match loader {
        Loader::Bunsh => "sh",
        Loader::SqliteEmbedded => "sqlite",
        _ => loader_name(loader),
    }
}

pub fn path_of_form(path: &[u8], loader: Loader) -> Vec<u8> {
    [path, b"?", loader_name(loader).as_bytes()].concat()
}

pub fn path_without_form(path: &[u8]) -> Option<&[u8]> {
    let mark = bun_core::strings::last_index_of_char(path, b'?')?;
    Some(&path[..mark])
}

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

#[derive(PartialEq, Eq, Debug)]
pub struct PlacesOfForm {
    pub path_of_form: Vec<u8>,
    pub is_form_without_attributes: bool,
}

pub const DATABASE_NAMESPACE: &[u8] = b"database";

pub fn name_of_database(specifier: &[u8]) -> Vec<u8> {
    let mut buffer = vec![0; specifier.len() + 2];
    let normalized = normalize_string_buf::<true, Posix, false>(specifier, &mut buffer);
    if specifier.starts_with(b"/") {
        return [b"/", &*normalized].concat();
    }
    match normalized.starts_with(b"../") {
        true => normalized.to_vec(),
        false => [b"./", &*normalized].concat(),
    }
}

pub fn places_of_form(
    path: &[u8],
    type_attribute: &[u8],
    loaders_given_to_build: &[u8],
) -> Option<PlacesOfForm> {
    let has_form =
        |&it: &Loader| parses_text_as_data(it) || it == Loader::Sqlite || it == Loader::File;
    let loader = Loader::from_string(type_attribute).filter(has_form)?;
    if path.starts_with(b"./") || path.starts_with(b"../") {
        return (loader == Loader::Sqlite).then(|| PlacesOfForm {
            path_of_form: [DATABASE_NAMESPACE, b":", &name_of_database(path)].concat(),
            is_form_without_attributes: false,
        });
    }
    let has_query = bun_core::strings::contains_char(path, b'?');
    let read_by_build_with = loader_by_name_in_build(loaders_given_to_build, path);
    Some(PlacesOfForm {
        path_of_form: path_of_form(path, loader),
        is_form_without_attributes: !is_url_with_text(path)
            && !has_query
            && loader == read_by_build_with,
    })
}

pub fn path_of_default_form(path: &[u8]) -> Option<Vec<u8>> {
    let loader = loader_by_name(path);
    let has_form = !is_url_with_text(path) && parses_text_as_data(loader);
    has_form.then(|| path_of_form(path, loader))
}

pub fn is_url_with_text(path: &[u8]) -> bool {
    path.starts_with(b"data:")
}

pub fn is_name_of_text(path: &[u8]) -> bool {
    path.starts_with(b"data:") || path.starts_with(b"blob:")
}

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
        let places = places_of_form(path, type_attribute, b"")?;
        Some((places.path_of_form, places.is_form_without_attributes))
    }

    #[test]
    fn database_under_a_name_as_the_program_writes_it_has_the_module_made_for_that_name() {
        let made = |path: &[u8]| Some((path.to_vec(), false));
        assert_eq!(
            places(b"./data.sqlite", b"sqlite"),
            made(b"database:./data.sqlite")
        );
        assert_eq!(
            places(b"./sub/../data.sqlite", b"sqlite"),
            made(b"database:./data.sqlite")
        );
        assert_eq!(
            places(b"../data.sqlite", b"sqlite"),
            made(b"database:../data.sqlite")
        );
        assert_eq!(places(b"./data.json", b"json"), None);
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
        for type_attribute in [&b"js"[..], b"ts", b"wasm", b"no loader"] {
            assert_eq!(places(b"/$bunfs/root/a.js", type_attribute), None);
        }
    }

    #[test]
    fn file_asked_for_as_a_file_is_keyed_by_that_type() {
        let as_file = |path: &[u8]| [path, b"?file"].concat();
        let (text, picture) = (b"/$bunfs/root/a.txt", b"/$bunfs/root/a.png");
        assert_eq!(places(text, b"file"), Some((as_file(text), false)));
        assert_eq!(places(picture, b"file"), Some((as_file(picture), true)));
        assert_eq!(places(b"./a.txt", b"file"), None);
    }

    #[test]
    fn module_under_a_query_answers_for_no_type() {
        let code = b"/$bunfs/root/a.js?x";
        assert_eq!(
            places(code, b"file"),
            Some((b"/$bunfs/root/a.js?x?file".to_vec(), false))
        );
    }

    #[test]
    fn module_without_attributes_is_what_the_loaders_given_to_the_build_made() {
        let table = [
            (&b".pic"[..], Loader::Text),
            (b".ts", Loader::Ts),
            (b".txt", Loader::File),
        ];
        let given = encode_loaders_given_to_build(&table);
        assert_eq!(given, b".pic\0text\0.txt\0file\0");
        let answers = |path: &[u8], type_attribute: &[u8]| {
            places_of_form(path, type_attribute, &given).map(|it| it.is_form_without_attributes)
        };
        assert_eq!(answers(b"/$bunfs/root/a.pic", b"file"), Some(false));
        assert_eq!(answers(b"/$bunfs/root/a.pic", b"text"), Some(true));
        assert_eq!(answers(b"/$bunfs/root/a.txt", b"file"), Some(true));
        assert_eq!(answers(b"/$bunfs/root/a.txt", b"text"), Some(false));
        assert_eq!(answers(b"/$bunfs/root/a.png", b"file"), Some(true));
        assert_eq!(encode_loaders_given_to_build(DEFAULT_LOADERS), b"");
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

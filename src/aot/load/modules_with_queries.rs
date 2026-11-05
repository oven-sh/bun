//! `import "./a.ts?fresh=1"`: `bun run` reads `a.ts` and makes one more module of it, which it knows as the path of the file with the query behind it.
//! The build gives each such module a path of its own, beside the file and with the ending of its name, so that whatever goes by the folder or
//! by the name of a file says of the module what it says of the file.

use bun_core::fmt::hex_byte_lower;
use bun_core::strings;
use bun_sema::util::ShardedMap;

/// How the `?` that every query begins with is written in the path of a module.
const START_OF_QUERY: &[u8] = b"%3f";

pub(crate) struct ModuleWithQuery {
    pub file: Vec<u8>,
    pub query: Vec<u8>,
    pub wrapper: Option<Vec<u8>>,
}

#[derive(Default)]
pub(crate) struct ModulesWithQueries {
    modules: ShardedMap<Vec<u8>, ModuleWithQuery>,
}

impl ModulesWithQueries {
    pub(crate) fn add(&self, file: &[u8], query: &[u8]) -> Vec<u8> {
        debug_assert!(query.starts_with(b"?"));
        let mut path = create_path(file, query);
        let constructor = find_worker_constructor(query);
        // The wrapper is an ES module, whatever the file is.
        if constructor.is_some() {
            path.extend_from_slice(b".mjs");
        }
        if self.modules.get_ref(path.as_slice()).is_none() {
            let module = ModuleWithQuery {
                file: file.to_vec(),
                query: query.to_vec(),
                wrapper: constructor.map(|constructor| write_worker_wrapper(file, constructor)),
            };
            self.modules.insert_ref(path.clone(), module);
        }
        path
    }

    /// One more module of `file`: an ES module, whatever the file is, with a text that the build has written.
    pub(crate) fn add_text(&self, file: &[u8], query: &[u8], text: Vec<u8>) -> Vec<u8> {
        debug_assert!(query.starts_with(b"?"));
        let path = [&create_path(file, query)[..], b".mjs"].concat();
        if self.modules.get_ref(path.as_slice()).is_none() {
            let module = ModuleWithQuery {
                file: file.to_vec(),
                query: query.to_vec(),
                wrapper: Some(text),
            };
            self.modules.insert_ref(path.clone(), module);
        }
        path
    }

    pub(crate) fn find(&self, path: &[u8]) -> Option<&ModuleWithQuery> {
        match strings::contains(path, START_OF_QUERY) {
            true => self.modules.get_ref(path),
            false => None,
        }
    }

    pub(crate) fn text_in_place_of_file(&self, path: &[u8]) -> Option<&[u8]> {
        self.find(path)?.wrapper.as_deref()
    }

    /// The file whose text the module at `path` runs.
    pub(crate) fn file_behind<'p>(&'p self, path: &'p [u8]) -> &'p [u8] {
        self.find(path).map_or(path, |module| &module.file)
    }
}

/// `bun run` goes by Vite's suffixes, `ImportSuffix::find` of the bundler. Behind the path of a script, `raw` among the parameters asks for the text of the file, `url` for its path,
/// and `worker` and `sharedworker` for a function that starts the file on a thread of its own: none of them runs the file where it is imported.
pub(crate) fn has_vite_suffix(query: &[u8]) -> bool {
    let parameters = query.strip_prefix(b"?").unwrap_or(query);
    strings::split(parameters, b"&")
        .any(|it| matches!(it, b"raw" | b"url" | b"worker" | b"sharedworker"))
}

pub(crate) fn find_worker_constructor(query: &[u8]) -> Option<&'static str> {
    let parameters = query.strip_prefix(b"?").unwrap_or(query);
    let mut constructors = strings::split(parameters, b"&").filter_map(|it| match it {
        b"worker" => Some("Worker"),
        b"sharedworker" => Some("SharedWorker"),
        _ => None,
    });
    let asks_for_path = strings::split(parameters, b"&").any(|it| it == b"url");
    constructors.next().filter(|_| !asks_for_path)
}

// `ImportSuffix::module` of the bundler, but for the name of the file: the build follows these two forms to an entry point.
fn write_worker_wrapper(file: &[u8], constructor: &str) -> Vec<u8> {
    let name = strings::basename_posix(file);
    let quote = |text: Vec<u8>| {
        bun_core::fmt::format_json_string_utf8(&text, Default::default()).to_string()
    };
    // A URL reads these otherwise than a path does.
    let named = match strings::index_of_any(name, b"#%\\").is_some() {
        true => format!("import.meta.dir + {}", quote([b"/", name].concat())),
        false => format!(
            "new URL({}, import.meta.url)",
            quote([b"./", name].concat())
        ),
    };
    format!(
        "export default function WorkerWrapper(options) {{\n  return new {constructor}({named}, {{ type: \"module\", name: options?.name }});\n}}\n"
    )
    .into_bytes()
}

fn create_path(file: &[u8], query: &[u8]) -> Vec<u8> {
    let name_start = file.len() - strings::basename_posix(file).len();
    let name = &file[name_start..];
    let stem_end = name_start + strings::index_of_char_usize(name, b'.').unwrap_or(name.len());
    let mut path = Vec::with_capacity(file.len() + 3 * query.len());
    path.extend_from_slice(&file[..stem_end]);
    // Two queries that differ in the case of a letter are two modules, on a disk that does not tell the two cases apart too.
    for &byte in query {
        if matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-') {
            path.push(byte);
        } else {
            let [high_digit, low_digit] = hex_byte_lower(byte);
            path.extend_from_slice(&[b'%', high_digit, low_digit]);
        }
    }
    path.extend_from_slice(&file[stem_end..]);
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(file: &str, query: &str) -> String {
        String::from_utf8(create_path(file.as_bytes(), query.as_bytes())).unwrap()
    }

    #[test]
    fn path_keeps_folder_and_ending_of_file() {
        assert_eq!(path("/p/lib/a.ts", "?x=1"), "/p/lib/a%3fx%3d1.ts");
        assert_eq!(path("/p/lib/a.test.ts", "?"), "/p/lib/a%3f.test.ts");
        assert_eq!(path("/p.d/a", "?x"), "/p.d/a%3fx");
        assert_eq!(path("/p/.a.js", "?x"), "/p/%3fx.a.js");
        assert_eq!(
            path("/p/a.ts", "?v=1.d/../b"),
            "/p/a%3fv%3d1%2ed%2f%2e%2e%2fb.ts"
        );
        assert_ne!(path("/p/a.ts", "?A"), path("/p/a.ts", "?a"));
    }

    #[test]
    fn same_file_and_query_are_one_module() {
        let modules = ModulesWithQueries::default();
        let first = modules.add(b"/p/a.ts", b"?x");
        assert_eq!(modules.add(b"/p/a.ts", b"?x"), first);
        assert_ne!(modules.add(b"/p/a.ts", b"?y"), first);
        assert_eq!(modules.file_behind(&first), b"/p/a.ts");
        assert_eq!(modules.find(&first).unwrap().query, b"?x");
        assert_eq!(modules.file_behind(b"/p/a.ts"), b"/p/a.ts");
        assert_eq!(modules.file_behind(b"/p/b%3fx.ts"), b"/p/b%3fx.ts");
    }

    #[test]
    fn a_worker_by_its_suffix_runs_a_wrapper_in_place_of_the_file() {
        let modules = ModulesWithQueries::default();
        let wrapper = modules.add(b"/p/lib/job.ts", b"?worker");
        assert_eq!(wrapper, b"/p/lib/job%3fworker.ts.mjs");
        let text = modules.text_in_place_of_file(&wrapper).unwrap();
        let text = core::str::from_utf8(text).unwrap();
        let start = "new Worker(new URL(\"./job.ts\", import.meta.url), {";
        assert!(text.contains(start), "{text}");
        let odd = modules.add(b"/p/lib/a#b.ts", b"?sharedworker");
        let text = modules.text_in_place_of_file(&odd).unwrap();
        let text = core::str::from_utf8(text).unwrap();
        let start = "new SharedWorker(import.meta.dir + \"/a#b.ts\", {";
        assert!(text.contains(start), "{text}");
        assert_eq!(modules.file_behind(&wrapper), b"/p/lib/job.ts");
        let again = modules.add(b"/p/lib/job.ts", b"?again");
        assert_eq!(modules.text_in_place_of_file(&again), None);
        assert_eq!(modules.text_in_place_of_file(b"/p/lib/job.ts"), None);
        for (query, constructor) in [
            (&b"?worker"[..], Some("Worker")),
            (b"?x=1&worker", Some("Worker")),
            (b"?worker&raw", Some("Worker")),
            (b"?sharedworker", Some("SharedWorker")),
            (b"?sharedworker&worker", Some("SharedWorker")),
            (b"?worker&sharedworker", Some("Worker")),
            (b"?worker&url", None),
            (b"?url&sharedworker", None),
            (b"?workers", None),
            (b"?raw", None),
        ] {
            assert_eq!(find_worker_constructor(query), constructor);
        }
    }

    #[test]
    fn a_suffix_among_the_parameters_asks_for_something_else() {
        for query in [&b"?raw"[..], b"?raw&x", b"?x&raw", b"?url", b"?x&url"] {
            assert!(has_vite_suffix(query));
        }
        for query in [
            &b"?worker"[..],
            b"?x&worker",
            b"?sharedworker",
            b"?worker&url",
        ] {
            assert!(has_vite_suffix(query));
        }
        for query in [&b"?"[..], b"?RAW", b"?raw=1", b"?text", b"?url=1", b"?x=1"] {
            assert!(!has_vite_suffix(query));
        }
        // `inline` and `init` mean something behind the path of an asset alone.
        for query in [
            &b"?WORKER"[..],
            b"?worker=1",
            b"?workers",
            b"?inline",
            b"?init",
        ] {
            assert!(!has_vite_suffix(query));
        }
    }
}

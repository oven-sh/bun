//! `import "./a.ts?fresh=1"`: `bun run` reads `a.ts` and makes one more module of it, which it knows as the path of the file with the query behind it.
//! The build gives each such module a path of its own, beside the file and with the ending of its name, so that whatever goes by the folder or
//! by the name of a file says of the module what it says of the file.

use bun_ast::Loader;
use bun_core::fmt::hex_byte_lower;
use bun_core::strings;
use bun_sema::util::ShardedMap;

use crate::module_keys::loader_by_query;

/// How the `?` that every query begins with is written in the path of a module.
const START_OF_QUERY: &[u8] = b"%3f";

pub(crate) struct ModuleWithQuery {
    pub file: Vec<u8>,
    pub query: Vec<u8>,
}

#[derive(Default)]
pub(crate) struct ModulesWithQueries {
    modules: ShardedMap<Vec<u8>, ModuleWithQuery>,
}

impl ModulesWithQueries {
    pub(crate) fn add(&self, file: &[u8], query: &[u8]) -> Vec<u8> {
        debug_assert!(query.starts_with(b"?"));
        let path = create_path(file, query);
        if self.modules.get_ref(path.as_slice()).is_none() {
            let module = ModuleWithQuery {
                file: file.to_vec(),
                query: query.to_vec(),
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

    pub(crate) fn loader_by_query(&self, path: &[u8]) -> Option<Loader> {
        loader_by_query(&self.find(path)?.query)
    }

    /// The file whose text the module at `path` runs.
    pub(crate) fn file_behind<'p>(&'p self, path: &'p [u8]) -> &'p [u8] {
        self.find(path).map_or(path, |module| &module.file)
    }
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
    fn raw_and_url_among_the_parameters_name_loaders() {
        let modules = ModulesWithQueries::default();
        let loader = |query: &[u8]| modules.loader_by_query(&modules.add(b"/p/a.ts", query));
        for query in [&b"?raw"[..], b"?raw&x", b"?x&raw", b"?url&raw"] {
            assert_eq!(loader(query), Some(Loader::Text));
        }
        for query in [
            &b"?url"[..],
            b"?x&url",
            b"?worker&url",
            b"?raw&url&sharedworker",
        ] {
            assert_eq!(loader(query), Some(Loader::File));
        }
        for query in [
            &b"?"[..],
            b"?RAW",
            b"?raw=1",
            b"?raw#x",
            b"?raw?raw",
            b"?text",
            b"?url=1",
            b"?worker",
            b"?worker&raw",
        ] {
            assert_eq!(loader(query), None);
        }
        assert_eq!(modules.loader_by_query(b"/p/a.ts"), None);
        assert_eq!(modules.loader_by_query(b"/p/b%3fraw.ts"), None);
    }
}

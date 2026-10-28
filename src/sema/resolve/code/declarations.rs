use super::manifest::ExportsEntry;
use super::*;

const DECLARATION_EXTENSIONS: [(&[u8], &[&[u8]]); 3] = [
    (b".js", &[b".d.ts"]),
    (b".mjs", &[b".d.mts", b".d.ts"]),
    (b".cjs", &[b".d.cts", b".d.ts"]),
];

// `./dist/index.js` is declared by `./dist/types/index.d.ts`: what lies in `./dist/` is declared in `./dist/types/`.
struct DeclarationFolder<'h> {
    code: &'h [u8],
    declarations: &'h [u8],
}

impl<'h> Resolver<'h> {
    /// The declaration file that a package ships for one of its JavaScript files.
    pub fn declaration_file_of(&self, path: &[u8]) -> Option<&'h [u8]> {
        let (stem, extensions) = DECLARATION_EXTENSIONS
            .into_iter()
            .find_map(|(code, declarations)| Some((path.strip_suffix(code)?, declarations)))?;
        let find_file = |stem: &[u8]| {
            let mut candidates = extensions.iter().map(|it| [stem, it].concat());
            candidates.find(|candidate| self.is_file(candidate))
        };
        let found = find_file(stem).or_else(|| {
            let manifest = self.nearest_code_manifest(dirname::<Posix>(path))?;
            let relative = stem.strip_prefix(manifest.directory)?;
            let relative = [b".", relative].concat();
            let mut folders = find_declaration_folders(manifest.exports.as_ref()?);
            folders.sort_by_key(|folder| std::cmp::Reverse(folder.code.len()));
            folders.iter().find_map(|folder| {
                let rest = relative.strip_prefix(folder.code)?;
                let declared = &[folder.declarations, rest].concat()[1..];
                find_file(&[manifest.directory, declared].concat())
            })
        })?;
        Some(self.keep(&found))
    }
}

fn find_declaration_folders<'h>(exports: &ExportsEntry<'h>) -> Vec<DeclarationFolder<'h>> {
    let root = match *exports {
        ExportsEntry::Map(map) => map.entries.iter().find(|entry| entry.0 == b"."),
        _ => None,
    };
    let root = root.map_or(*exports, |entry| entry.1);
    let targets = root.targets();
    let is_declaration = |target: &&[u8]| is_declaration_file_name(target);
    let Some(declaration) = targets.iter().copied().find(is_declaration) else {
        return Vec::new();
    };
    let Some((declarations, declared_name)) = split_file_name(declaration) else {
        return Vec::new();
    };
    let code_files = targets.iter().filter(|target| !is_declaration(target));
    code_files
        .filter_map(|target| split_file_name(target))
        .filter(|&(code, name)| name == declared_name && code != declarations)
        .map(|(code, _)| DeclarationFolder { code, declarations })
        .collect()
}

// The folder with its last slash, and the name up to its first dot.
fn split_file_name(path: &[u8]) -> Option<(&[u8], &[u8])> {
    let slash = bun_core::strings::last_index_of_char(path, b'/')?;
    let (folder, name) = path.split_at(slash + 1);
    let dot = bun_core::strings::index_of_char_usize(name, b'.')?;
    Some((folder, &name[..dot]))
}

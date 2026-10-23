use super::search::preserve_trailing_slash;
use super::*;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum TargetKind {
    Exact,
    Wildcard,
}

impl<'h> Resolver<'h> {
    pub(super) fn load_as_file_or_directory(
        &self,
        path: &[u8],
        search: CodeSearch<'_>,
    ) -> Option<Vec<u8>> {
        if let Some(file) = self.load_as_file(path, search.extensions) {
            return Some(file);
        }
        let directory = strings::without_trailing_slash(path);
        if !self.is_dir(directory) {
            return None;
        }
        self.code_manifest(directory)
            .filter(|manifest| manifest.has_main_fields())
            .and_then(|manifest| self.load_from_main_fields(directory, manifest, search))
            .or_else(|| self.load_as_index(directory, search.extensions))
    }

    pub(super) fn load_as_file(&self, path: &[u8], extensions: &[Vec<u8>]) -> Option<Vec<u8>> {
        let trimmed = strings::without_trailing_slash(path);
        if trimmed.is_empty() || trimmed.ends_with(b"/") {
            return None;
        }
        if !self.is_dir(dirname::<Posix>(trimmed)) {
            return None;
        }
        if self.is_file(trimmed) {
            return Some(trimmed.to_vec());
        }
        let has_trailing_separator = trimmed.len() != path.len();
        let with_extension = match has_trailing_separator {
            true => None,
            false => self.find_file_with_extension(trimmed, extensions),
        };
        with_extension
            .or_else(|| self.find_rewritten_file(trimmed))
            .or_else(|| self.find_file_in_another_case(trimmed))
    }

    // `bun run` looks a name up in the listing of its directory without regard to case, and opens the file under the name that is listed.
    fn find_file_in_another_case(&self, path: &[u8]) -> Option<Vec<u8>> {
        let directory = dirname::<Posix>(path);
        let name = &path[strings::last_index_of_char(path, b'/')? + 1..];
        let (files, _) = self.host.entries(directory);
        let listed = files.iter().find(|file| file.eq_ignore_ascii_case(name))?;
        Some(inside(directory, listed))
    }

    pub(super) fn load_as_index(
        &self,
        directory: &[u8],
        extensions: &[Vec<u8>],
    ) -> Option<Vec<u8>> {
        self.find_file_with_extension(&inside(directory, b"index"), extensions)
    }

    pub(super) fn probe_target_extensions(
        &self,
        directory: &[u8],
        base: &[u8],
        extensions: &[Vec<u8>],
        target: TargetKind,
    ) -> Option<Vec<u8>> {
        let path = inside(directory, base);
        let with_extension = match target {
            TargetKind::Wildcard if bun_paths::extension(base).is_empty() => {
                self.find_file_with_extension(&path, extensions)
            }
            TargetKind::Wildcard | TargetKind::Exact => None,
        };
        with_extension.or_else(|| self.find_rewritten_file(&path))
    }

    fn load_from_main_fields(
        &self,
        directory: &[u8],
        manifest: &CodeManifest<'_>,
        search: CodeSearch<'_>,
    ) -> Option<Vec<u8>> {
        let options = self.code_options();
        let main_order: &[Vec<u8>] = &options.extension_orders.main_field;
        let prefers_main = options.has_default_main_fields
            && !(options.prefers_module_field && search.kind != CodeImportKind::Require);
        for field in &options.main_fields {
            let Some(value) = manifest.main_field(field) else {
                continue;
            };
            let order = match field.as_slice() {
                b"main" => main_order,
                _ => search.extensions,
            };
            let Some(found) = self.load_from_main_field(directory, value, order) else {
                continue;
            };
            if !(prefers_main && matches!(field.as_slice(), b"module" | b"jsnext:main")) {
                return Some(found);
            }
            let main = match manifest.main_field(b"main") {
                Some(main_value) => self.load_from_main_field(directory, main_value, main_order),
                None => self.load_as_index(directory, main_order),
            };
            return main.or(Some(found));
        }
        None
    }

    fn load_from_main_field(
        &self,
        directory: &[u8],
        value: &[u8],
        extensions: &[Vec<u8>],
    ) -> Option<Vec<u8>> {
        let target = preserve_trailing_slash(join(directory, value), value);
        if let Some(file) = self.load_as_file(&target, extensions) {
            return Some(file);
        }
        if !self.is_dir(&target) {
            return None;
        }
        self.load_as_index(&target, extensions)
    }

    fn find_rewritten_file(&self, path: &[u8]) -> Option<Vec<u8>> {
        let base_start = strings::last_index_of_char(path, b'/').map_or(0, |slash| slash + 1);
        let dot = base_start + strings::last_index_of_char(&path[base_start..], b'.')?;
        let (stem, extension) = path.split_at(dot);
        let rewritten = rewritten_extensions(extension, is_in_node_modules(path));
        self.find_file_with_extension(stem, rewritten)
    }

    fn find_file_with_extension<E: AsRef<[u8]>>(
        &self,
        stem: &[u8],
        extensions: &[E],
    ) -> Option<Vec<u8>> {
        let longest = extensions.iter().map(|it| it.as_ref().len()).max()?;
        let mut candidate = Vec::with_capacity(stem.len() + longest);
        candidate.extend_from_slice(stem);
        for extension in extensions {
            candidate.extend_from_slice(extension.as_ref());
            if self.is_file(&candidate) {
                return Some(candidate);
            }
            candidate.truncate(stem.len());
        }
        None
    }
}

pub(super) fn rewritten_extensions(
    extension: &[u8],
    is_in_node_modules: bool,
) -> &'static [&'static [u8]] {
    match extension {
        b".js" | b".jsx" => &[b".ts", b".tsx", b".mts"],
        b".mjs" | b".cjs" if is_in_node_modules => &[],
        b".mjs" => &[b".mts"],
        b".cjs" => &[b".cts"],
        _ => &[],
    }
}

pub(super) fn is_in_node_modules(path: &[u8]) -> bool {
    strings::contains(path, b"/node_modules/")
}

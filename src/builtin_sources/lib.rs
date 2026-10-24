use std::sync::OnceLock;

const HEADER: &[u8] = b"bun-builtins-manifest\t4";

pub const VIRTUAL_ROOT: &[u8] = b"/$bun/js/";

pub struct Module {
    pub id: u32,
    pub path: Option<Box<[u8]>>,
    pub specifier: Option<Box<[u8]>>,
}

#[derive(Default)]
pub struct Manifest {
    defines: Vec<(Box<[u8]>, Box<[u8]>)>,
    modules: Vec<Module>,
    function_files: Vec<Box<[u8]>>,
    module_declarations: Vec<Box<[u8]>>,
    builtin_functions: Vec<(Box<[u8]>, u32)>,
    function_file_indexes: Vec<(u32, u32)>,
}

#[derive(Debug)]
pub struct ParseError {
    pub line: usize,
}

impl Manifest {
    pub fn parse(text: &[u8]) -> Result<Manifest, ParseError> {
        let mut manifest = Manifest::default();
        let mut functions: Vec<(u32, &[u8], usize)> = Vec::new();
        for (index, line) in bun_core::strings::split(text, b"\n").enumerate() {
            let error = || ParseError { line: index + 1 };
            if index == 0 {
                if line != HEADER {
                    return Err(error());
                }
                continue;
            }
            if line.is_empty() {
                continue;
            }
            let mut fields = bun_core::strings::split(line, b"\t");
            let kind = fields.next().ok_or_else(error)?;
            let mut field = || {
                fields
                    .next()
                    .filter(|bytes| !bytes.is_empty())
                    .ok_or_else(error)
            };
            match kind {
                b"define" => manifest.defines.push((field()?.into(), field()?.into())),
                b"module" => manifest.modules.push(Module {
                    id: number(field()?).ok_or_else(error)?,
                    path: optional(field()?),
                    specifier: optional(field()?),
                }),
                b"functions" => manifest.function_files.push(field()?.into()),
                b"declarations" => manifest.module_declarations.push(field()?.into()),
                b"function" => {
                    let id = number(field()?).ok_or_else(error)?;
                    let file = field()?;
                    let key = [file, field()?].join(&b'\t');
                    manifest
                        .builtin_functions
                        .push((key.into_boxed_slice(), id));
                    functions.push((id, file, index + 1));
                }
                _ => return Err(error()),
            }
        }
        manifest.builtin_functions.sort_unstable();
        let files = manifest.function_files.iter().map(|file| &**file);
        let mut sorted_files: Vec<(&[u8], u32)> = files.zip(0..).collect();
        sorted_files.sort_unstable();
        for (id, file, line) in functions {
            let found = sorted_files.binary_search_by_key(&file, |entry| entry.0);
            let (_, file_index) = sorted_files[found.map_err(|_| ParseError { line })?];
            manifest.function_file_indexes.push((id, file_index));
        }
        manifest.function_file_indexes.sort_unstable();
        Ok(manifest)
    }

    pub fn defines(&self) -> &[(Box<[u8]>, Box<[u8]>)] {
        &self.defines
    }

    pub fn resolve(&self, specifier: &[u8], importer: &[u8]) -> Option<u32> {
        let directory: &[u8] = match bun_core::strings::last_index_of_char(importer, b'/') {
            Some(end) => &importer[..end],
            None => &[],
        };
        self.module_by_specifier(specifier)
            .or_else(|| self.resolve_path(directory, specifier))
            .or_else(|| self.resolve_path(&[], specifier))
    }

    fn resolve_path(&self, directory: &[u8], specifier: &[u8]) -> Option<u32> {
        let mut parts: Vec<&[u8]> = Vec::new();
        for part in bun_core::strings::split(directory, b"/")
            .chain(bun_core::strings::split(specifier, b"/"))
        {
            match part {
                b"" | b"." => {}
                b".." => {
                    parts.pop()?;
                }
                _ => parts.push(part),
            }
        }
        let path = parts.join(&b'/');
        [&b""[..], b".ts", b".js"].iter().find_map(|extension| {
            let candidate = [&path[..], *extension].concat();
            self.modules
                .iter()
                .find(|module| module.path.as_deref() == Some(&candidate[..]))
                .map(|module| module.id)
        })
    }

    pub fn modules(&self) -> &[Module] {
        &self.modules
    }

    pub fn module(&self, id: u32) -> Option<&Module> {
        self.modules.iter().find(|module| module.id == id)
    }

    pub fn module_by_specifier(&self, specifier: &[u8]) -> Option<u32> {
        self.modules
            .iter()
            .find(|module| module.specifier.as_deref() == Some(specifier))
            .map(|module| module.id)
    }

    pub fn has_source(&self, id: u32) -> bool {
        self.module(id).is_some_and(|module| module.path.is_some())
    }

    pub fn function_files(&self) -> &[Box<[u8]>] {
        &self.function_files
    }

    /// Each says what `require` answers for the module beside it.
    pub fn module_declarations(&self) -> &[Box<[u8]>] {
        &self.module_declarations
    }

    /// Only `$linkTimeConstant` calls from other function files reach these.
    pub fn function_files_without_ids(&self) -> impl Iterator<Item = &[u8]> + '_ {
        let mut has_id = vec![false; self.function_files.len()];
        for &(_, file_index) in &self.function_file_indexes {
            has_id[file_index as usize] = true;
        }
        let files = self.function_files.iter().zip(has_id);
        files.filter_map(|(file, has_id)| (!has_id).then_some(&**file))
    }

    pub fn builtin_function_id(&self, path: &[u8], name: &[u8]) -> Option<u32> {
        let path = path.strip_prefix(VIRTUAL_ROOT).unwrap_or(path);
        find(&self.builtin_functions, &[path, name].join(&b'\t'))
    }

    pub fn function_file(&self, function: u32) -> Option<&[u8]> {
        let indexes = &self.function_file_indexes;
        let found = indexes.binary_search_by_key(&function, |entry| entry.0);
        Some(&self.function_files[indexes[found.ok()?].1 as usize])
    }
}

#[cfg(not(feature = "linked_archive"))]
fn archive() -> &'static [u8] {
    include_bytes!(concat!(env!("BUN_CODEGEN_DIR"), "/builtin_sources.bin"))
}

#[cfg(feature = "linked_archive")]
fn archive() -> &'static [u8] {
    unsafe extern "C" {
        static bun_builtin_sources_start: u8;
        static bun_builtin_sources_end: u8;
    }
    let start = &raw const bun_builtin_sources_start;
    let end = &raw const bun_builtin_sources_end;
    // SAFETY: archive.S puts the two symbols around the bytes of one read-only file.
    unsafe { core::slice::from_raw_parts(start, end.offset_from_unsigned(start)) }
}

const NAME_LEN: usize = 63;
const RECORD_LEN: usize = 1 + NAME_LEN + 4 + 4;

pub struct Archive {
    manifest: Manifest,
    paths: Vec<Option<Box<[u8]>>>,
}

impl Archive {
    pub fn embedded() -> &'static Archive {
        static EMBEDDED: OnceLock<Archive> = OnceLock::new();
        EMBEDDED.get_or_init(|| {
            let text = Archive::read(b"manifest").expect("the archive has a manifest");
            let manifest =
                Manifest::parse(&text).expect("the manifest of the archive is well-formed");
            let mut paths: Vec<Option<Box<[u8]>>> = Vec::new();
            for module in &manifest.modules {
                let Some(path) = &module.path else {
                    continue;
                };
                if paths.len() <= module.id as usize {
                    paths.resize_with(module.id as usize + 1, Default::default);
                }
                paths[module.id as usize] = Some([VIRTUAL_ROOT, &path[..]].concat().into());
            }
            Archive { manifest, paths }
        })
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    pub fn path(&self, id: u32) -> Option<&[u8]> {
        self.paths.get(id as usize)?.as_deref()
    }

    pub fn read(name: &[u8]) -> Option<Vec<u8>> {
        let records = records();
        let found = records.binary_search_by(|record| name_of(record).cmp(name));
        let offset_and_len = &records[found.ok()?][1 + NAME_LEN..];
        bun_zstd::decompress_alloc(
            &archive()[u32_at(offset_and_len)..][..u32_at(&offset_and_len[4..])],
        )
        .ok()
    }

    pub fn has(name: &[u8]) -> bool {
        records()
            .binary_search_by(|record| name_of(record).cmp(name))
            .is_ok()
    }

    /// Sorted.
    pub fn names_that_begin_with(prefix: &[u8]) -> impl Iterator<Item = &'static [u8]> {
        let records = records();
        let first = records.partition_point(|record| name_of(record) < prefix);
        let names = records[first..].iter().map(name_of);
        names.take_while(move |name| name.starts_with(prefix))
    }
}

fn u32_at(bytes: &[u8]) -> usize {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize
}

fn records() -> &'static [[u8; RECORD_LEN]] {
    let archive = archive();
    let records = &archive[4..][..u32_at(archive) * RECORD_LEN];
    records.as_chunks::<RECORD_LEN>().0
}

fn name_of(record: &[u8; RECORD_LEN]) -> &[u8] {
    &record[1..][..record[0] as usize]
}

fn number(field: &[u8]) -> Option<u32> {
    std::str::from_utf8(field).ok()?.parse().ok()
}

fn optional(field: &[u8]) -> Option<Box<[u8]>> {
    (field != b"-").then(|| field.into())
}

fn find(sorted: &[(Box<[u8]>, u32)], name: &[u8]) -> Option<u32> {
    sorted
        .binary_search_by(|(key, _)| (**key).cmp(name))
        .ok()
        .map(|index| sorted[index].1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_sema_standalone as _;

    const MANIFEST: &[u8] = b"bun-builtins-manifest\t4\n\
        define\tprocess.platform\t\"linux\"\n\
        \n\
        module\t0\tnode/fs.ts\tnode:fs\n\
        module\t1\tinternal/a.ts\tinternal/a\n\
        module\t2\tinternal/b.ts\t-\n\
        module\t3\tx.js\t-\n\
        module\t4\t-\tbun:jsc\n\
        function\t65536\tbuiltins/Fifo.ts\tcreateFIFO\n\
        function\t7\tengine/ArrayPrototype.js\tmap\n\
        functions\tengine/ArrayPrototype.js\n\
        functions\tbuiltins/Fifo.ts\n\
        declarations\tnode/fs.listed.d.ts\n";

    fn error_line(text: &[u8]) -> Option<usize> {
        Manifest::parse(text).err().map(|error| error.line)
    }

    #[test]
    fn parses_every_record_kind() {
        let manifest = Manifest::parse(MANIFEST).unwrap();
        assert_eq!(manifest.defines().len(), 1);
        let (name, value) = &manifest.defines()[0];
        assert_eq!(&**name, b"process.platform");
        assert_eq!(&**value, b"\"linux\"");
        assert_eq!(manifest.modules().len(), 5);
        let module = manifest.module(1).unwrap();
        assert_eq!(module.path.as_deref(), Some(&b"internal/a.ts"[..]));
        assert_eq!(module.specifier.as_deref(), Some(&b"internal/a"[..]));
        assert!(manifest.module(2).unwrap().specifier.is_none());
        assert!(manifest.module(4).unwrap().path.is_none());
        assert_eq!(manifest.function_files().len(), 2);
        assert_eq!(&*manifest.function_files()[1], b"builtins/Fifo.ts");
        assert_eq!(manifest.module_declarations().len(), 1);
        assert_eq!(&*manifest.module_declarations()[0], b"node/fs.listed.d.ts");
    }

    #[test]
    fn finds_modules_by_specifier() {
        let manifest = Manifest::parse(MANIFEST).unwrap();
        assert_eq!(manifest.module_by_specifier(b"node:fs"), Some(0));
        assert!(manifest.has_source(0));
        assert_eq!(manifest.module_by_specifier(b"bun:jsc"), Some(4));
        assert!(!manifest.has_source(4));
        assert_eq!(manifest.module_by_specifier(b""), None);
        assert_eq!(manifest.module_by_specifier(b"node:path"), None);
        assert!(!manifest.has_source(5));
    }

    #[test]
    fn finds_builtin_functions() {
        let manifest = Manifest::parse(MANIFEST).unwrap();
        let id = manifest.builtin_function_id(b"/$bun/js/builtins/Fifo.ts", b"createFIFO");
        assert_eq!(id, Some(65536));
        assert_eq!(
            manifest.builtin_function_id(b"builtins/Fifo.ts", b"createFIFO"),
            id
        );
        assert_eq!(
            manifest.builtin_function_id(b"builtins/Fifo.ts", b"create"),
            None
        );
        assert_eq!(
            manifest.builtin_function_id(b"engine/ArrayPrototype.js", b"map"),
            Some(7)
        );
        assert_eq!(
            manifest.function_file(65536),
            Some(&b"builtins/Fifo.ts"[..])
        );
        assert_eq!(
            manifest.function_file(7),
            Some(&b"engine/ArrayPrototype.js"[..])
        );
        assert_eq!(manifest.function_file(65537), None);
    }

    #[test]
    fn resolves_specifiers_and_paths() {
        let manifest = Manifest::parse(MANIFEST).unwrap();
        assert_eq!(manifest.resolve(b"node:fs", b"internal/a.ts"), Some(0));
        assert_eq!(manifest.resolve(b"./b", b"internal/a.ts"), Some(2));
        assert_eq!(manifest.resolve(b"internal/b", b"node/fs.ts"), Some(2));
        assert_eq!(manifest.resolve(b"../x", b"internal/a.ts"), Some(3));
        assert_eq!(manifest.resolve(b"../../x", b"internal/a.ts"), None);
        assert_eq!(manifest.resolve(b"../x", b"x.js"), None);
        assert_eq!(manifest.resolve(b"./c", b"internal/a.ts"), None);
    }

    #[test]
    fn empty_path_is_unresolved() {
        let manifest = Manifest::parse(MANIFEST).unwrap();
        assert_eq!(manifest.resolve(b".", b"x.js"), None);
        assert_eq!(manifest.resolve(b"./", b"internal/a.ts"), None);
        assert_eq!(manifest.resolve(b"internal/..", b"x.js"), None);
        assert_eq!(manifest.resolve(b"", b"x.js"), None);
        assert_eq!(manifest.resolve(b"", b"internal/a.ts"), None);
    }

    #[test]
    fn rejects_malformed_manifests() {
        assert_eq!(error_line(b""), Some(1));
        assert_eq!(error_line(b"bun-builtins-manifest\t3\n"), Some(1));
        for record in [
            "trigger\tprocess.stdout\t3",
            "native\t0\tcpp\tA.cpp\tf",
            "development\t1",
            "define\tIS_BUN_DEVELOPMENT",
            "define\tIS_BUN_DEVELOPMENT\t",
            "module\t0\tnode/fs.ts",
            "module\t0\tnode/fs.ts\t",
            "module\t0\t\tnode:fs",
            "module\tzero\tnode/fs.ts\tnode:fs",
            "functions\t",
            "function\t-1\tbuiltins/Fifo.ts\tcreateFIFO",
            "function\t1\tbuiltins/Fifo.ts",
        ] {
            let text = format!("bun-builtins-manifest\t4\n\n{record}\n");
            assert_eq!(error_line(text.as_bytes()), Some(3), "{record}");
        }
    }

    #[test]
    fn rejects_unlisted_function_file() {
        let text = b"bun-builtins-manifest\t4\n\
            functions\tbuiltins/Fifo.ts\n\
            function\t1\tbuiltins/Fifo.ts\tcreateFIFO\n\
            function\t2\tbuiltins/Other.ts\tother\n";
        assert_eq!(error_line(text), Some(4));
    }

    #[test]
    fn embedded_archive_is_complete() {
        let archive = Archive::embedded();
        let manifest = archive.manifest();
        for module in manifest.modules() {
            let Some(path) = &module.path else {
                assert_eq!(archive.path(module.id), None, "module {}", module.id);
                continue;
            };
            let text = Archive::read(path);
            assert!(
                text.is_some_and(|text| !text.is_empty()),
                "{}",
                path.escape_ascii()
            );
            let virtual_path = [VIRTUAL_ROOT, &path[..]].concat();
            assert_eq!(archive.path(module.id), Some(&virtual_path[..]));
        }
        let function_files = manifest.function_files().iter().map(|file| &**file);
        let other_files = [&b"tsconfig.json"[..], b"builtins.d.ts", b"private.d.ts"];
        for name in function_files.chain(other_files) {
            let text = Archive::read(name);
            assert!(
                text.is_some_and(|text| !text.is_empty()),
                "{}",
                name.escape_ascii()
            );
        }
        let wrap = manifest.module_by_specifier(b"bun:wrap");
        assert!(wrap.is_some_and(|id| manifest.has_source(id)));
        let runtime = manifest.resolve(b"./runtime", b"runtime.bun.js");
        assert_eq!(
            runtime.and_then(|id| archive.path(id)),
            Some(&b"/$bun/js/runtime.js"[..])
        );
    }

    #[test]
    fn embedded_defines_are_json() {
        let defines = Archive::embedded().manifest().defines();
        for (name, value) in defines {
            let starts_like_json = matches!(
                value.first(),
                Some(b'"' | b'[' | b'{' | b'-' | b'0'..=b'9' | b't' | b'f' | b'n')
            );
            assert!(starts_like_json, "{}", name.escape_ascii());
        }
        let value_of = |name: &[u8]| {
            let found = defines.iter().find(|define| *define.0 == *name);
            found.map(|define| &*define.1)
        };
        assert_eq!(value_of(b"IS_BUN_DEVELOPMENT"), Some(&b"false"[..]));
    }
}

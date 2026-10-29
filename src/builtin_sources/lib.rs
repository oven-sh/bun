use bun_exe_format::builtins::Builtins;
use std::sync::OnceLock;

const HEADER: &[u8] = b"bun-builtins-manifest\t6";

pub const VIRTUAL_ROOT: &[u8] = b"/$bun/js/";

pub struct Module {
    pub id: u32,
    pub path: Option<Box<[u8]>>,
    pub specifier: Option<Box<[u8]>>,
}

/// An identifier of a module that names a function or a class, where the text that `bun run` evaluates does not have it as the module writes it.
pub struct BundledName {
    pub position: u32,
    /// None: what the identifier names in the module has no name in that text.
    pub name: Option<Box<[u8]>>,
    /// In that text it is the function's or the class's own name, not a variable that holds an anonymous one.
    pub is_own_name: bool,
}

/// What it takes to find the words of a module in the text that `bun run` evaluates.
pub struct BundledPositions {
    pub evaluated: &'static [u8],
    /// As src/codegen/bundled-positions.ts writes them.
    pub corrections: &'static [u8],
}

/// Of a file that declares for every file. Each list says where statements stand, in ascending order.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
pub struct PartSeenByEveryFile {
    /// What a file sees that does not name the file: what the file declares for every file, and what that leads to.
    pub seen: Box<[(u32, u32)]>,
    /// The other statements that name another file.
    pub asked: Box<[(u32, u32)]>,
}

#[derive(Default)]
pub struct Manifest {
    defines: Vec<(Box<[u8]>, Box<[u8]>)>,
    modules: Vec<Module>,
    function_files: Vec<Box<[u8]>>,
    module_declarations: Vec<Box<[u8]>>,
    files_declaring_for_every_file: Vec<(Box<[u8]>, PartSeenByEveryFile)>,
    builtin_functions: Vec<(Box<[u8]>, u32)>,
    function_file_indexes: Vec<(u32, u32)>,
    bundled_names: Vec<(Box<[u8]>, Vec<BundledName>)>,
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
                b"declares-for-every-file" => {
                    let file = field()?.into();
                    let part = PartSeenByEveryFile {
                        seen: ranges(field()?).ok_or_else(error)?,
                        asked: ranges(field()?).ok_or_else(error)?,
                    };
                    (manifest.files_declaring_for_every_file).push((file, part));
                }
                b"name" => {
                    let file = field()?;
                    let name = BundledName {
                        position: number(field()?).ok_or_else(error)?,
                        name: optional(field()?),
                        is_own_name: match field()? {
                            b"own" => true,
                            b"variable" => false,
                            _ => return Err(error()),
                        },
                    };
                    match manifest.bundled_names.last_mut() {
                        Some((last, names)) if **last == *file => names.push(name),
                        _ => manifest.bundled_names.push((file.into(), vec![name])),
                    }
                }
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
        manifest.files_declaring_for_every_file.sort_unstable();
        for (_, names) in &mut manifest.bundled_names {
            names.sort_unstable_by_key(|name| name.position);
        }
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

    #[cfg(test)]
    pub fn has_source(&self, id: u32) -> bool {
        self.module(id).is_some_and(|module| module.path.is_some())
    }

    /// In order of position.
    pub fn bundled_names(&self, module: u32) -> &[BundledName] {
        let path = self
            .module(module)
            .and_then(|module| module.path.as_deref());
        let mut files = self.bundled_names.iter();
        let found = files.find(|(file, _)| Some(&**file) == path);
        found.map_or(&[], |(_, names)| names)
    }

    pub fn function_files(&self) -> &[Box<[u8]>] {
        &self.function_files
    }

    /// Each says what `require` answers for the module beside it.
    pub fn module_declarations(&self) -> &[Box<[u8]>] {
        &self.module_declarations
    }

    /// Whether the file declares a global or a module by its name, which files see that do not name the file.
    pub fn declares_for_every_file(&self, file: &[u8]) -> bool {
        self.part_seen_by_every_file(file).is_some()
    }

    pub fn part_seen_by_every_file(&self, file: &[u8]) -> Option<&PartSeenByEveryFile> {
        let files = &self.files_declaring_for_every_file;
        let found = files.binary_search_by(|it| (*it.0).cmp(file)).ok()?;
        Some(&files[found].1)
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

#[cfg(not(feature = "linked_archive"))]
fn evaluated_modules() -> &'static [u8] {
    include_bytes!(concat!(
        env!("BUN_CODEGEN_DIR"),
        "/InternalModuleRegistryConstants.bin"
    ))
}

#[cfg(feature = "linked_archive")]
fn evaluated_modules() -> &'static [u8] {
    use bun_exe_format::builtins::HEADER_SIZE;
    unsafe extern "C" {
        static bun_internal_modules_header: [u8; HEADER_SIZE];
    }
    // SAFETY: InternalModuleRegistryConstants.S puts the symbol in front of one read-only file, whose header says where its data starts and how long it is.
    unsafe {
        let header = &bun_internal_modules_header;
        let length = u32_at(&header[32..]) + u32_at(&header[36..]);
        core::slice::from_raw_parts(header.as_ptr(), length)
    }
}

/// What `bun run` evaluates for a module.
fn evaluated_text(module: u32) -> Option<&'static [u8]> {
    static EVALUATED: OnceLock<Option<Builtins<'static>>> = OnceLock::new();
    let evaluated = EVALUATED.get_or_init(|| Builtins::parse(evaluated_modules()).ok());
    Some(evaluated.as_ref()?.module(module)?.source)
}

const NAME_LEN: usize = 63;
const RECORD_LEN: usize = 1 + NAME_LEN + 4 + 4 + 4;

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
        let numbers = &records[found.ok()?][1 + NAME_LEN..];
        let archive = archive();
        let files = &archive[4 + u32_at(archive)..];
        let frame = &files[u32_at(numbers)..][..u32_at(&numbers[4..])];
        // One more than the id of the module whose evaluated text the file follows on.
        match u32_at(&numbers[8..]).checked_sub(1) {
            None => bun_zstd::decompress_alloc(frame).ok(),
            Some(module) => {
                bun_zstd::decompress_alloc_with_prefix(frame, evaluated_text(module as u32)?).ok()
            }
        }
    }

    /// None: a stack trace shows the lines and columns of the module as it is written.
    pub fn bundled_positions(module: u32) -> Option<BundledPositions> {
        // The part of each module stands behind its id and its length, in the order of the ids.
        static POSITIONS: OnceLock<(Vec<u8>, Vec<(u32, core::ops::Range<usize>)>)> =
            OnceLock::new();
        let (positions, parts) = POSITIONS.get_or_init(|| {
            let positions = Archive::read(b"positions").unwrap_or_default();
            let mut parts = Vec::new();
            let mut rest = &positions[..];
            while let (Some(id), Some(length)) = (read_number(&mut rest), read_number(&mut rest)) {
                let start = positions.len() - rest.len();
                let Some(behind) = rest.get(length as usize..) else {
                    break;
                };
                parts.push((id, start..start + length as usize));
                rest = behind;
            }
            (positions, parts)
        });
        let found = parts.binary_search_by_key(&module, |part| part.0).ok()?;
        let corrections = &positions[parts[found].1.clone()];
        Some(BundledPositions {
            evaluated: evaluated_text(module)?,
            corrections,
        })
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
    static RECORDS: OnceLock<Vec<u8>> = OnceLock::new();
    let records = RECORDS.get_or_init(|| {
        let archive = archive();
        bun_zstd::decompress_alloc(&archive[4..][..u32_at(archive)])
            .expect("the archive starts with the list of its files")
    });
    records.as_chunks::<RECORD_LEN>().0
}

/// 7 bits a byte, the lowest first.
fn read_number(bytes: &mut &[u8]) -> Option<u32> {
    let mut value = 0u32;
    for shift in (0..32).step_by(7) {
        let (byte, rest) = bytes.split_first()?;
        *bytes = rest;
        value |= u32::from(byte & 0x7F) << shift;
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

fn name_of(record: &[u8; RECORD_LEN]) -> &[u8] {
    &record[1..][..record[0] as usize]
}

fn number(field: &[u8]) -> Option<u32> {
    std::str::from_utf8(field).ok()?.parse().ok()
}

/// `-`: none.
fn ranges(field: &[u8]) -> Option<Box<[(u32, u32)]>> {
    let mut ranges = Vec::new();
    let mut offsets = bun_core::strings::split(field, b" ").filter(|_| field != b"-");
    while let Some(start) = offsets.next() {
        ranges.push((number(start)?, number(offsets.next()?)?));
    }
    Some(ranges.into())
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

    const MANIFEST: &[u8] = b"bun-builtins-manifest\t6\n\
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
        declarations\tnode/fs.listed.d.ts\n\
        name\tinternal/a.ts\t40\t-\tvariable\n\
        name\tinternal/a.ts\t12\tread2\town\n";

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
        let [first, second] = manifest.bundled_names(1) else {
            panic!("the module has two names");
        };
        assert_eq!(first.position, 12);
        assert_eq!(first.name.as_deref(), Some(&b"read2"[..]));
        assert!(first.is_own_name);
        assert_eq!(second.position, 40);
        assert!(second.name.is_none());
        assert!(!second.is_own_name);
        assert!(manifest.bundled_names(0).is_empty());
        assert!(manifest.bundled_names(4).is_empty());
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
        assert_eq!(error_line(b"bun-builtins-manifest\t4\n"), Some(1));
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
            let text = format!("bun-builtins-manifest\t6\n\n{record}\n");
            assert_eq!(error_line(text.as_bytes()), Some(3), "{record}");
        }
    }

    #[test]
    fn rejects_unlisted_function_file() {
        let text = b"bun-builtins-manifest\t6\n\
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
        assert_eq!(
            wrap.and_then(|id| archive.path(id)),
            Some(&b"/$bun/js/runtime.out.js"[..])
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

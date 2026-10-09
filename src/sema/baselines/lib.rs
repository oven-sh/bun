//! Runs TypeScript's compiler and conformance tests the way typescript-go's own runner does
//! (`internal/testrunner`, `internal/testutil/harnessutil`, `internal/testutil/tsbaseline`): each
//! test is split into its files, which are placed in an in-memory file system and checked through
//! the same driver as `bun check`. The output is written in the format of the `.errors.txt`
//! baselines committed there, for comparison with them.

use bun_core::strings;
use bun_sema::check::compute_ecma_line_starts;
use bun_sema::config::{self, Project};
use bun_sema::json::Json;
use bun_sema::messages::text;
use bun_sema::resolve::{Host, Options, displayed_path, join, to_path};
use bun_sema::session::Session;
use bun_sema_driver::{Category, Diagnostic, Report, Request};
use bun_threading::Guarded;
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

/// `println!` and `eprintln!`, which nothing in Bun uses. The streams of the standard library keep
/// the output capture of its panic hook alive, and so its backtrace printer, which imports the
/// unwinder from libgcc_s.
#[macro_export]
macro_rules! output_line {
    ($($arguments:tt)*) => {
        $crate::write_line(bun_core::Fd::stdout(), format_args!($($arguments)*))
    };
}
#[macro_export]
macro_rules! error_line {
    ($($arguments:tt)*) => {
        $crate::write_line(bun_core::Fd::stderr(), format_args!($($arguments)*))
    };
}

pub fn write_line(to: bun_core::Fd, line: std::fmt::Arguments<'_>) {
    let _ = bun_sys::File::from_fd(to).write_all(format!("{line}\n").as_bytes());
}

pub fn read_file(path: &str) -> Option<Vec<u8>> {
    bun_sys::File::read_from(bun_core::Fd::cwd(), path.as_bytes()).ok()
}

/// Its directory is created if there is none.
fn write_file(path: &str, contents: &[u8]) -> bun_sys::Maybe<()> {
    if let Some(end) = rfind(path, "/").filter(|&end| end > 0) {
        bun_sys::mkdir_recursive(&path.as_bytes()[..end])?;
    }
    let path = bun_core::ZBox::from_bytes(path);
    bun_sys::File::write_file(bun_core::Fd::cwd(), &path, contents)
}

/// For a file that is only written to be looked at: a failure is reported, and the run goes on.
pub fn write_file_to_look_at(path: &str, contents: &[u8]) {
    if let Err(error) = write_file(path, contents) {
        error_line!("cannot write {path}: {:?}", error.get_errno());
    }
}

// The searches of `str`, with Bun's. What is searched for is ASCII, so the text can be cut there.

fn find(text: &str, what: &str) -> Option<usize> {
    strings::index_of(text.as_bytes(), what.as_bytes())
}

fn rfind(text: &str, what: &str) -> Option<usize> {
    strings::last_index_of(text.as_bytes(), what.as_bytes())
}

fn contains(text: &str, what: &str) -> bool {
    strings::contains(text.as_bytes(), what.as_bytes())
}

fn split<'a>(text: &'a str, at: &'a str) -> impl Iterator<Item = &'a str> {
    let mut rest = Some(text);
    std::iter::from_fn(move || {
        let text = rest?;
        let found = find(text, at);
        rest = found.map(|found| &text[found + at.len()..]);
        Some(&text[..found.unwrap_or(text.len())])
    })
}

/// `str::lines`
pub fn lines(text: &str) -> impl Iterator<Item = &str> {
    let all = (!text.is_empty()).then(|| split(text.strip_suffix('\n').unwrap_or(text), "\n"));
    (all.into_iter().flatten()).map(|line| line.strip_suffix('\r').unwrap_or(line))
}

fn replace(text: &str, what: &str, with: &str) -> String {
    split(text, what).collect::<Vec<_>>().join(with)
}

/// What follows the last `/`.
fn base_name(path: &str) -> &str {
    rfind(path, "/").map_or(path, |at| &path[at + 1..])
}

fn replace_in_bytes(text: &[u8], what: &[u8], with: &[u8]) -> Vec<u8> {
    strings::split(text, what).collect::<Vec<_>>().join(with)
}

/// Where `what` is in `text`. The places do not overlap.
fn places<'a>(text: &'a [u8], what: &'a [u8]) -> impl Iterator<Item = usize> + 'a {
    let mut from = 0;
    std::iter::from_fn(move || {
        let at = from + strings::index_of(&text[from..], what)?;
        from = at + what.len();
        Some(at)
    })
}

/// `srcFolder`
const SRC: &str = "/.src";
/// `testLibFolder`
const LIB: &str = "/.lib";

/// `skippedTests`
const SKIPPED: &[&str] = &[
    "APILibCheck.ts",
    "APISample_Watch.ts",
    "APISample_WatchWithDefaults.ts",
    "APISample_WatchWithOwnWatchHost.ts",
    "APISample_compile.ts",
    "APISample_jsdoc.ts",
    "APISample_linter.ts",
    "APISample_parseConfig.ts",
    "APISample_transform.ts",
    "APISample_watcher.ts",
    "preserveUnusedImports.ts",
    "noCrashWithVerbatimModuleSyntaxAndImportsNotUsedAsValues.ts",
    "verbatimModuleSyntaxCompat.ts",
    "verbatimModuleSyntaxCompat2.ts",
    "verbatimModuleSyntaxCompat3.ts",
    "verbatimModuleSyntaxCompat4.ts",
    "preserveValueImports.ts",
    "preserveValueImports_importsNotUsedAsValues.ts",
    "preserveValueImports_errors.ts",
    "preserveValueImports_mixedImports.ts",
    "preserveValueImports_module.ts",
    "importsNotUsedAsValues_error.ts",
    "alwaysStrictNoImplicitUseStrict.ts",
    "nonPrimitiveIndexingWithForInSupressError.ts",
    "parameterInitializerBeforeDestructuringEmit.ts",
    "mappedTypeUnionConstraintInferences.ts",
    "lateBoundConstraintTypeChecksCorrectly.ts",
    "keyofDoesntContainSymbols.ts",
    "isolatedModulesOut.ts",
    "noStrictGenericChecks.ts",
    "noImplicitUseStrict_umd.ts",
    "noImplicitUseStrict_system.ts",
    "noImplicitUseStrict_es6.ts",
    "noImplicitUseStrict_commonjs.ts",
    "noImplicitUseStrict_amd.ts",
    "noImplicitAnyIndexingSuppressed.ts",
    "excessPropertyErrorsSuppressed.ts",
    "moduleNoneDynamicImport.ts",
    "moduleNoneErrors.ts",
    "moduleNoneOutFile.ts",
    "noErrorUsingImportExportModuleAugmentationInDeclarationFile1.ts",
    "noErrorUsingImportExportModuleAugmentationInDeclarationFile2.ts",
    "noErrorUsingImportExportModuleAugmentationInDeclarationFile3.ts",
    "requireOfJsonFileWithModuleEmitNone.ts",
    "requireOfJsonFileWithModuleNodeResolutionEmitNone.ts",
];

/// `skippedEmitTests`
const SKIPPED_EMIT: &[&str] = &[
    "filesEmittingIntoSameOutput.ts",
    "jsFileCompilationWithJsEmitPathSameAsInput.ts",
    "grammarErrors.ts",
    "jsFileCompilationEmitBlockedCorrectly.ts",
    "jsDeclarationsReexportAliasesEsModuleInterop.ts",
    "jsFileCompilationWithoutJsExtensions.ts",
    "typeOnlyMerge2.ts",
    "typeOnlyMerge3.ts",
];

/// `harnessCommandLineOptions`, in lower case, and the other directives that are not compiler
/// options.
const HARNESS_OPTIONS: &[&str] = &[
    "usecasesensitivefilenames",
    "baselinefile",
    "includebuiltfile",
    "filename",
    "libfiles",
    "noimplicitreferences",
    "currentdirectory",
    "symlink",
    "link",
    "notypesandsymbols",
    "fullemitpaths",
    "reportdiagnostics",
    "capturesuggestions",
    "typescriptversion",
];

/// The tests, their baselines and the libraries in one file, as `sync.ts` writes it. One file after
/// the other: `=== <path> <length in bytes>\n`, the bytes, `\n`.
pub struct Bundle {
    files: BTreeMap<&'static [u8], &'static [u8]>,
}

impl Bundle {
    /// `None` if `bytes` is malformed.
    pub fn parse(bytes: &'static [u8]) -> Option<Bundle> {
        let mut files = BTreeMap::new();
        let mut rest = bytes;
        while !rest.is_empty() {
            let header = rest.strip_prefix(b"=== ")?;
            let end = bun_core::strings::index_of_char_usize(header, b'\n')?;
            let (header, after) = (&header[..end], &header[end + 1..]);
            let space = bun_core::strings::last_index_of_char(header, b' ')?;
            let length: usize = std::str::from_utf8(&header[space + 1..])
                .ok()?
                .parse()
                .ok()?;
            files.insert(&header[..space], after.get(..length)?);
            rest = after.get(length..)?.strip_prefix(b"\n")?;
        }
        Some(Bundle { files })
    }

    fn read(&self, path: &[u8]) -> Option<&'static [u8]> {
        self.files.get(path).copied()
    }

    /// The paths of the files in `dir`, at any depth, without `dir` and the `/` after it.
    fn under<'a>(&'a self, dir: &'a [u8]) -> impl Iterator<Item = &'static [u8]> + 'a {
        self.files
            .range::<[u8], _>((std::ops::Bound::Included(dir), std::ops::Bound::Unbounded))
            .map_while(move |(path, _)| path.strip_prefix(dir))
            .filter_map(|rest| rest.strip_prefix(b"/"))
    }
}

/// Owns a `Bundle` and the bytes it points into. `Host::read` lends the contents of a file for
/// `'static`, so the two are borrowed for `'static`, and freed here.
struct OwnedBundle {
    bundle: *mut Bundle,
    bytes: *mut [u8],
}

impl OwnedBundle {
    /// `None` if the file cannot be read or is malformed.
    fn read(path: &str) -> Option<OwnedBundle> {
        let bytes = Box::into_raw(read_file(path)?.into_boxed_slice());
        // SAFETY: `bytes` comes from `Box::into_raw`. It is freed below, or in `drop` after `bundle`.
        let Some(bundle) = Bundle::parse(unsafe { &*bytes }) else {
            // SAFETY: as above, and nothing refers to it.
            drop(unsafe { Box::from_raw(bytes) });
            return None;
        };
        let bundle = Box::into_raw(Box::new(bundle));
        Some(OwnedBundle { bundle, bytes })
    }

    /// # Safety
    /// Neither the reference nor a slice that was read through it is used once `self` is dropped.
    unsafe fn get(&self) -> &'static Bundle {
        // SAFETY: `bundle` comes from `Box::into_raw` and is freed in `drop`.
        unsafe { &*self.bundle }
    }
}

impl Drop for OwnedBundle {
    fn drop(&mut self) {
        // SAFETY: both come from `Box::into_raw`. By the contract of `get` nothing refers to them.
        unsafe {
            drop(Box::from_raw(self.bundle));
            drop(Box::from_raw(self.bytes));
        }
    }
}

/// An in-memory file system, except for the default library and `tests/lib`, which are read from
/// the bundle, or else from disk.
pub struct Virtual {
    /// Keyed by path. On a case-insensitive file system, keyed by the lowercased path, with the
    /// original path alongside.
    files: BTreeMap<Vec<u8>, (Vec<u8>, Cow<'static, [u8]>)>,
    /// All non-empty directories, keyed the same way.
    directories: BTreeMap<Vec<u8>, Vec<u8>>,
    /// Symlinks and their targets.
    links: BTreeMap<Vec<u8>, Vec<u8>>,
    is_case_sensitive: bool,
    /// Path prefixes that are mapped to the bundle or the disk, and their locations there.
    mounted: Vec<(Vec<u8>, Vec<u8>)>,
    bundle: Option<&'static Bundle>,
    disk: bun_sema_driver::host::Disk,
}

impl Virtual {
    fn new(
        is_case_sensitive: bool,
        mounted: Vec<(Vec<u8>, Vec<u8>)>,
        bundle: Option<&'static Bundle>,
    ) -> Virtual {
        Virtual {
            bundle,
            files: BTreeMap::new(),
            directories: BTreeMap::new(),
            links: BTreeMap::new(),
            is_case_sensitive,
            mounted,
            disk: bun_sema_driver::host::Disk::with_already_read(1, Default::default(), b"/"),
        }
    }

    fn key(&self, path: &[u8]) -> Vec<u8> {
        to_path(path, self.is_case_sensitive).into_owned()
    }

    fn add_directories_above(&mut self, path: &[u8]) {
        let mut dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Posix>(path);
        loop {
            if self
                .directories
                .insert(self.key(dir), dir.to_vec())
                .is_some()
                || dir == b"/"
                || dir.is_empty()
            {
                break;
            }
            dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Posix>(dir);
        }
    }

    fn add_file(&mut self, path: &[u8], content: Vec<u8>) {
        self.files
            .insert(self.key(path), (path.to_vec(), Cow::Owned(content)));
        self.add_directories_above(path);
    }

    fn add_link(&mut self, path: &[u8], target: &[u8]) {
        self.links.insert(self.key(path), target.to_vec());
        self.add_directories_above(path);
    }

    /// The location of `path` on the disk, if it has one.
    fn on_disk(&self, path: &[u8]) -> Option<Vec<u8>> {
        self.mounted.iter().find_map(|(prefix, real)| {
            let rest = path.strip_prefix(prefix.as_slice())?;
            (rest.is_empty() || rest.starts_with(b"/")).then(|| [&real[..], rest].concat())
        })
    }

    /// `path` with its symlinks resolved.
    fn followed(&self, path: &[u8]) -> Vec<u8> {
        let mut path = path.to_vec();
        'again: for _ in 0..40 {
            if self.links.is_empty() {
                break;
            }
            let mut end = 0;
            while end < path.len() {
                end = bun_core::strings::index_of_char_usize(&path[end + 1..], b'/')
                    .map_or(path.len(), |i| end + 1 + i);
                if let Some(target) = self.links.get(&self.key(&path[..end])) {
                    path = [target, &path[end..]].concat();
                    continue 'again;
                }
            }
            break;
        }
        path
    }
}

impl Host for Virtual {
    fn script_kind(&self, _path: &[u8]) -> Option<bun_sema::resolve::ScriptKind> {
        None
    }
    fn extra_file_extensions(&self) -> &[(Vec<u8>, bun_sema::resolve::ScriptKind)] {
        &[]
    }
    fn scripts_of_page(&self, _page: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        if let Some(real) = self.on_disk(path) {
            return match self.bundle {
                Some(bundle) => bundle.read(&real).map(Cow::Borrowed),
                None => self.disk.read(&real),
            };
        }
        let (_, content) = self.files.get(&self.key(&self.followed(path)))?;
        Some(Cow::Owned(decode(content)))
    }
    fn is_file(&self, path: &[u8]) -> bool {
        match (self.on_disk(path), self.bundle) {
            (Some(real), Some(bundle)) => bundle.read(&real).is_some(),
            (Some(real), None) => self.disk.is_file(&real),
            (None, _) => self.files.contains_key(&self.key(&self.followed(path))),
        }
    }
    fn is_dir(&self, path: &[u8]) -> bool {
        match (self.on_disk(path), self.bundle) {
            (Some(real), Some(bundle)) => bundle.under(&real).next().is_some(),
            (Some(real), None) => self.disk.is_dir(&real),
            (None, _) => self
                .directories
                .contains_key(&self.key(&self.followed(path))),
        }
    }
    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        let followed = self.followed(path);
        let key = self.key(&followed);
        match (self.files.get(&key), self.directories.get(&key)) {
            (Some((written, _)), _) => written.clone(),
            (_, Some(written)) => written.clone(),
            _ => followed,
        }
    }
    fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
        if let Some(real) = self.on_disk(path) {
            let Some(bundle) = self.bundle else {
                return self.disk.list_dir(&real);
            };
            let names: BTreeSet<&[u8]> = bundle
                .under(&real)
                .filter_map(|rest| bun_core::strings::split(rest, b"/").next())
                .collect();
            return names.into_iter().map(<[u8]>::to_vec).collect();
        }
        let dir = self.followed(path);
        let prefix = if dir == b"/" {
            b"/".to_vec()
        } else {
            [&self.key(&dir)[..], b"/"].concat()
        };
        let mut names = BTreeSet::new();
        let written = self
            .files
            .iter()
            .map(|(key, (written, _))| (key, written))
            .chain(self.directories.iter());
        for (key, written) in written {
            if let Some(rest) = key.strip_prefix(&prefix[..])
                && !rest.is_empty()
                && !bun_core::strings::contains_char(rest, b'/')
            {
                names.insert(written[written.len() - rest.len()..].to_vec());
            }
        }
        for key in self.links.keys() {
            if let Some(rest) = key.strip_prefix(&prefix[..])
                && !rest.is_empty()
                && !bun_core::strings::contains_char(rest, b'/')
            {
                names.insert(rest.to_vec());
            }
        }
        names.into_iter().collect()
    }
    fn is_case_sensitive(&self) -> bool {
        self.is_case_sensitive
    }
    fn parse<'s>(
        &self,
        arena: &'s bun_sema::session::Arena,
        path: &[u8],
        text: &[u8],
        atoms: &bun_sema::atom::Interner<'s>,
        options: &Options,
    ) -> bun_sema::hir::File<'s> {
        self.disk.parse(arena, path, text, atoms, options)
    }
    fn parse_package_json(&self, arena: &bun_sema::session::Arena, text: &[u8]) -> Option<Json> {
        self.disk.parse_package_json(arena, text)
    }
    // One thread of the pool, as in `bun check --threads 1`: it has the same stack as in
    // production, and knows its stack limit.
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        self.disk.parallel(count, work);
    }
    fn loaded(&self) {
        self.disk.loaded();
    }
}

/// `decodeBytes`: the text of a file, decoded according to its byte order mark.
fn decode(bytes: &[u8]) -> Vec<u8> {
    let utf16 = |rest: &[u8], big: bool| {
        let units = rest.as_chunks::<2>().0.iter().map(|pair| {
            if big {
                u16::from_be_bytes([pair[0], pair[1]])
            } else {
                u16::from_le_bytes([pair[0], pair[1]])
            }
        });
        char::decode_utf16(units)
            .map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER))
            .collect::<String>()
            .into_bytes()
    };
    match bytes {
        [0xFF, 0xFE, rest @ ..] => utf16(rest, false),
        [0xFE, 0xFF, rest @ ..] => utf16(rest, true),
        [0xEF, 0xBB, 0xBF, rest @ ..] => rest.to_vec(),
        _ => bytes.to_vec(),
    }
}

/// `GetNormalizedAbsolutePath`, in the checker's path representation, where `c:/a` is `/c:/a`.
fn absolute(path: &str, cwd: &str) -> String {
    text(&match path.as_bytes() {
        [drive, b':', ..] if drive.is_ascii_alphabetic() => join(b"/", path.as_bytes()),
        _ => join(cwd.as_bytes(), path.as_bytes()),
    })
}

fn trim(bytes: &[u8]) -> &[u8] {
    bytes.trim_ascii()
}

/// `optionRegex` applied to one line: the name and the value.
fn option_in(line: &[u8]) -> Option<(String, &[u8])> {
    let rest = line.strip_prefix(b"//")?;
    let rest = rest.trim_ascii_start().strip_prefix(b"@")?;
    let end = rest
        .iter()
        .position(|b| !(b.is_ascii_alphanumeric() || *b == b'_'))?;
    if end == 0 {
        return None;
    }
    let value = rest[end..].trim_ascii_start().strip_prefix(b":")?;
    // `[^\r\n]*`
    let value = value.trim_ascii_start();
    let value_end = bun_core::strings::index_of_any(value, b"\r\n").unwrap_or(value.len());
    Some((text(&rest[..end]).to_lowercase(), &value[..value_end]))
}

/// `lineDelimiter.Split`
fn lines_of(text: &[u8]) -> Vec<&[u8]> {
    bun_core::strings::split(text, b"\n").collect()
}

struct Unit {
    name: String,
    content: Vec<u8>,
}

struct Parsed {
    units: Vec<Unit>,
    /// Symlinks and their targets.
    links: Vec<(String, String)>,
}

/// `ParseTestFilesAndSymlinks`
fn units_of(code: &[u8], file_name: &str) -> Parsed {
    let mut units = Vec::new();
    let mut links: Vec<(String, String)> = Vec::new();
    let mut content: Vec<u8> = Vec::new();
    let mut name = String::new();
    let all: Vec<&[u8]> = lines_of(code);
    let last = all.len() - 1;
    for (i, line) in all.into_iter().enumerate() {
        // `\r?\n`: a `\r` at the very end of the text is not before a `\n`.
        let line = if i < last {
            line.strip_suffix(b"\r").unwrap_or(line)
        } else {
            line
        };
        if let Some((option, value)) = option_in(line) {
            // `linkRegex`
            if option == "link"
                && let Some(arrow) = strings::index_of(value, b"->")
            {
                let (target, link) = (trim(&value[arrow + 2..]), trim(&value[..arrow]));
                links.push((text(target), text(link)));
                continue;
            }
            let value = text(trim(value));
            if option != "filename" {
                if option == "symlink" && !name.is_empty() {
                    for link in split(&value, ",").map(str::trim).filter(|l| !l.is_empty()) {
                        links.push((link.to_owned(), name.clone()));
                    }
                }
                continue;
            }
            if !name.is_empty() {
                units.push(Unit {
                    name: std::mem::take(&mut name),
                    content: std::mem::take(&mut content),
                });
            }
            content.clear();
            name = value;
        } else {
            if !content.is_empty() {
                content.push(b'\n');
            }
            content.extend_from_slice(line);
        }
    }
    if units.is_empty() && name.is_empty() {
        base_name(file_name).clone_into(&mut name);
    }
    units.push(Unit { name, content });
    Parsed { units, links }
}

/// `extractCompilerSettings`
fn settings_of(code: &[u8]) -> BTreeMap<String, String> {
    let mut settings = BTreeMap::new();
    for line in bun_core::strings::split(code, b"\n") {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if let Some((name, value)) = option_in(line) {
            let value = text(trim(value));
            let value = value.strip_suffix(';').unwrap_or(&value).to_owned();
            settings.insert(name, value);
        }
    }
    settings
}

/// `splitOptionValues` when a single value remains: that value.
fn the_one_value(option: &str, value: &str) -> String {
    let Some(all) = bun_sema::config_options::choices(option.as_bytes()) else {
        return value.to_owned();
    };
    let (mut includes, mut excludes, mut star) = (Vec::new(), Vec::new(), false);
    for item in split(value, ",").map(str::trim).filter(|s| !s.is_empty()) {
        if item == "*" {
            star = true;
        } else if let Some(excluded) = item.strip_prefix(['-', '!']) {
            excludes.push(excluded.to_lowercase());
        } else {
            includes.push(item.to_owned());
        }
    }
    if star {
        includes.extend(all.iter().map(|&s| text(s)));
    }
    includes
        .into_iter()
        .find(|item| !excludes.contains(&item.to_lowercase()))
        .unwrap_or_else(|| value.to_owned())
}

/// `removeTestPathPrefixes`
fn without_prefixes(text: &str, lib_dir: &str) -> String {
    bun_sema::messages::text(&without_prefixes_in_bytes(text.as_bytes(), lib_dir))
}

fn without_prefixes_in_bytes(text: &[u8], lib_dir: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let lib = format!("{lib_dir}/");
    let mut rest = text;
    'next: while let [first, after_first @ ..] = rest {
        if *first == b'/' {
            for prefix in ["/.ts/", "/.lib/", "/.src/", lib.as_str()] {
                if let Some(after) = rest.strip_prefix(prefix.as_bytes()) {
                    rest = after;
                    continue 'next;
                }
            }
        }
        out.push(*first);
        rest = after_first;
    }
    out
}

/// `FileName()` of the file at `path`, which is in the checker's format.
fn file_name(path: &[u8]) -> String {
    text(&displayed_path(path))
}

/// `isDefaultLibraryFile`
fn is_default_library(path: &str) -> bool {
    let name = base_name(path);
    name.starts_with("lib.") && name.ends_with(".d.ts")
}

fn category_name(category: Category) -> &'static str {
    match category {
        Category::Error => "error",
        Category::Warning => "warning",
        Category::Suggestion => "suggestion",
        Category::Message => "message",
    }
}

/// `utf8.RuneCountInString`
fn runes(bytes: &[u8]) -> usize {
    bstr::ByteSlice::chars(bytes).count()
}

const RESET: &str = "\u{1b}[0m";
const GREY: &str = "\u{1b}[90m";
const YELLOW: &str = "\u{1b}[93m";
const CYAN: &str = "\u{1b}[96m";
/// `gutterStyleSequence`
const GUTTER: &str = "\u{1b}[7m";

/// `getCategoryFormat`
fn category_color(category: Category) -> &'static str {
    match category {
        Category::Error => "\u{1b}[91m",
        Category::Warning => YELLOW,
        Category::Suggestion => GREY,
        Category::Message => "\u{1b}[94m",
    }
}

/// `WriteLocation`
fn write_location(out: &mut String, d: &Diagnostic) {
    out.push_str(&format!(
        "{CYAN}{}{RESET}:{YELLOW}{}{RESET}:{YELLOW}{}{RESET}",
        file_name(&d.path),
        d.line,
        d.column
    ));
}

/// `writeCodeSnippet`
fn write_code_snippet(out: &mut String, d: &Diagnostic, color: &str, indent: &str) {
    let utf16_len = |text: &str| text.encode_utf16().count();
    let (first_line, first_char) = (d.line as usize - 1, d.column as usize - 1);
    let (last_line, mut last_char) = (d.end_line as usize - 1, d.end_column as usize - 1);
    // For an empty span, the text right after it is marked.
    if d.end <= d.start {
        last_char += 1;
    }
    let is_long = last_line - first_line >= 4;
    let mut width = (last_line + 1).to_string().len();
    if is_long {
        width = width.max("...".len());
    }
    let mut i = first_line;
    while i <= last_line {
        out.push('\n');
        // Of five lines or more the first two and the last two are shown.
        if is_long && first_line + 1 < i && i < last_line - 1 {
            out.push_str(&format!("{indent}{GUTTER}{:>width$}{RESET} \n", "..."));
            i = last_line - 1;
        }
        let line = d
            .source
            .get((i + 1).saturating_sub(d.source_line as usize))
            .map_or_else(String::new, |line| text(line));
        let line = replace(line.trim_end(), "\t", " ");
        out.push_str(&format!(
            "{indent}{GUTTER}{:>width$}{RESET} {line}\n",
            i + 1
        ));
        out.push_str(&format!("{indent}{GUTTER}{:>width$}{RESET} {color}", ""));
        let (blanks, tildes) = if i == first_line {
            let end = if i == last_line {
                last_char
            } else {
                utf16_len(&line)
            };
            (first_char, end.saturating_sub(first_char))
        } else if i == last_line {
            (0, last_char)
        } else {
            (0, utf16_len(&line))
        };
        out.push_str(&" ".repeat(blanks));
        out.push_str(&"~".repeat(tildes));
        out.push_str(RESET);
        i += 1;
    }
}

/// `FormatDiagnosticsWithColorAndContext`, with `\n` for `\r\n`.
fn with_color_and_context(diagnostics: &[Diagnostic]) -> String {
    let mut out = String::new();
    for (i, d) in diagnostics.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        if !d.path.is_empty() {
            write_location(&mut out, d);
            out.push_str(" - ");
        }
        out.push_str(&format!(
            "{}{}{RESET}{GREY} TS{}: {RESET}{}",
            category_color(d.category),
            category_name(d.category),
            d.code as i32,
            text(&d.text)
        ));
        // `File_appears_to_be_binary`
        if !d.path.is_empty() && d.code != 1490 {
            out.push('\n');
            write_code_snippet(&mut out, d, category_color(d.category), "");
            out.push('\n');
        }
        for related in &d.related {
            if !related.path.is_empty() {
                out.push_str("\n  ");
                write_location(&mut out, related);
                out.push_str(" - ");
                out.push_str(&text(&related.text));
                write_code_snippet(&mut out, related, CYAN, "    ");
            }
            out.push('\n');
        }
    }
    out
}

/// `WriteErrorSummaryText`, with `\n` for `\r\n`.
fn error_summary(diagnostics: &[Diagnostic]) -> String {
    let errors: Vec<&Diagnostic> = diagnostics
        .iter()
        .filter(|d| d.category == Category::Error)
        .collect();
    if errors.is_empty() {
        return String::new();
    }
    // Keyed by file, sorted by name: the error count and `prettyPathForFileError`.
    let mut by_file: BTreeMap<&[u8], (usize, String)> = BTreeMap::new();
    for &d in &errors {
        if !d.path.is_empty() {
            by_file
                .entry(&d.path)
                .or_insert_with(|| (0, format!("{}{GREY}:{}{RESET}", file_name(&d.path), d.line)))
                .0 += 1;
        }
    }
    let first = by_file.values().next().map_or("", |file| file.1.as_str());
    let message = match (errors.len(), by_file.len()) {
        (1, 0) => "Found 1 error.".to_owned(),
        (1, _) => format!("Found 1 error in {first}"),
        (count, 0) => format!("Found {count} errors."),
        (count, 1) => format!("Found {count} errors in the same file, starting at: {first}"),
        (count, files) => format!("Found {count} errors in {files} files."),
    };
    let mut out = format!("\n{message}\n\n");
    // `writeTabularErrorsDisplay`
    if by_file.len() > 1 {
        let most = by_file.values().map(|file| file.0).max().unwrap_or(0);
        let digits = most.to_string().len();
        let goal = digits.max("Errors".len());
        out.push_str(&" ".repeat(digits.saturating_sub("Errors".len())));
        out.push_str("Errors  Files\n");
        for (count, name) in by_file.values() {
            out.push_str(&format!("{count:>goal$}  {name}\n"));
        }
        out.push('\n');
    }
    out
}

/// `GetErrorBaseline`, with `\n` for `\r\n`.
fn render(
    diagnostics: &[Diagnostic],
    inputs: &[(String, Vec<u8>)],
    lib_dir: &str,
    pretty: bool,
) -> Vec<u8> {
    let clean = |text: &str| without_prefixes(text, lib_dir);
    let mut out: Vec<u8> = Vec::new();
    if pretty {
        out.extend_from_slice(clean(&with_color_and_context(diagnostics)).as_bytes());
    }
    for d in diagnostics.iter().filter(|_| !pretty) {
        let mut line = String::new();
        if !d.path.is_empty() {
            let path = file_name(&d.path);
            if is_default_library(&path) {
                line.push_str(&format!("{path}(--,--): "));
            } else {
                line.push_str(&format!("{path}({},{}): ", d.line, d.column));
            }
        }
        line.push_str(&format!(
            "{} TS{}: {}\n",
            category_name(d.category),
            d.code as i32,
            text(&d.text)
        ));
        out.extend_from_slice(clean(&line).as_bytes());
    }
    out.extend_from_slice(b"\n\n");
    let mut is_first = true;
    let mut new_line = |out: &mut Vec<u8>| {
        if !std::mem::take(&mut is_first) {
            out.push(b'\n');
        }
    };
    let error_text = |out: &mut Vec<u8>, new_line: &mut dyn FnMut(&mut Vec<u8>), d: &Diagnostic| {
        for line in split(&clean(&text(&d.text)), "\n").filter(|l| !l.is_empty()) {
            new_line(out);
            out.extend_from_slice(
                format!(
                    "!!! {} TS{}: {line}",
                    category_name(d.category),
                    d.code as i32
                )
                .as_bytes(),
            );
        }
        for related in &d.related {
            let path = file_name(&related.path);
            let location = if path.is_empty() {
                String::new()
            } else if is_default_library(&path) {
                clean(&format!(" {path}:--:--"))
            } else {
                clean(&format!(" {path}:{}:{}", related.line, related.column))
            };
            new_line(out);
            out.extend_from_slice(
                format!(
                    "!!! related TS{}{location}: {}",
                    related.code as i32,
                    text(&related.text)
                )
                .as_bytes(),
            );
        }
    };
    for d in diagnostics.iter().filter(|d| d.path.is_empty()) {
        error_text(&mut out, &mut new_line, d);
    }
    for (name, content) in inputs {
        let name = clean(&file_name(name.as_bytes()));
        let is_in_it = |d: &Diagnostic| clean(&file_name(&d.path)).eq_ignore_ascii_case(&name);
        let errors: Vec<&Diagnostic> = diagnostics
            .iter()
            .filter(|&d| !d.path.is_empty() && is_in_it(d))
            .collect();
        new_line(&mut out);
        out.extend_from_slice(format!("==== {name} ({} errors) ====", errors.len()).as_bytes());
        let starts = compute_ecma_line_starts(content);
        let lines: Vec<&[u8]> = bun_core::strings::split(content, b"\n").collect();
        for (index, line) in lines.iter().enumerate() {
            let is_last = index == lines.len() - 1;
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            let this_start = starts
                .get(index)
                .map_or(content.len() as i64, |&s| i64::from(s));
            let next_start = if is_last {
                content.len() as i64
            } else {
                starts
                    .get(index + 1)
                    .map_or(content.len() as i64, |&s| i64::from(s))
            };
            new_line(&mut out);
            out.extend_from_slice(b"    ");
            out.extend_from_slice(line);
            for d in &errors {
                let (start, end) = (i64::from(d.start), i64::from(d.end.max(d.start)));
                if end >= this_start && (start < next_start || is_last) {
                    let relative = start - this_start;
                    let length = (end - start) - (this_start - start).max(0);
                    let from = (relative.max(0) as usize).min(line.len());
                    new_line(&mut out);
                    out.extend_from_slice(b"    ");
                    for c in bstr::ByteSlice::chars(&line[..from]) {
                        if matches!(c, '\t' | '\n' | '\x0C' | '\r' | ' ') {
                            out.push(c as u8);
                        } else {
                            out.push(b' ');
                        }
                    }
                    let to = from.max((from as i64 + length).clamp(0, line.len() as i64) as usize);
                    out.extend(std::iter::repeat_n(b'~', runes(&line[from..to])));
                    if is_last || next_start > end {
                        error_text(&mut out, &mut new_line, d);
                    }
                }
            }
        }
    }
    if pretty {
        out.extend_from_slice(clean(&error_summary(diagnostics)).as_bytes());
    }
    out
}

/// How closely the output matches the expected baseline.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Level {
    /// It crashed, or took too long.
    Broken,
    /// The errors have different codes or positions.
    Differs,
    /// The same codes at the same positions.
    Codes,
    /// And the same message text.
    Words,
    /// And the same spans: everything matches except the related information.
    Spans,
    /// Byte for byte.
    All,
}

/// The baselines of a test other than `.errors.txt`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Kind {
    Types,
    Symbols,
    /// The `.js` baseline without the JavaScript in it.
    Declarations,
    /// What `traceResolution` logs.
    Traces,
}

impl Kind {
    pub const ALL: [Kind; 4] = [Kind::Types, Kind::Symbols, Kind::Declarations, Kind::Traces];

    fn extension(self) -> &'static str {
        match self {
            Kind::Types => "types",
            Kind::Symbols => "symbols",
            Kind::Declarations => "js",
            Kind::Traces => "trace.json",
        }
    }
}

pub struct Outcome {
    /// `compiler/foo(target=es2015)`
    pub name: String,
    pub level: Level,
    pub note: String,
    /// The kinds that were compared, each with the first difference. `None`: the same, byte for
    /// byte.
    pub others: Vec<(Kind, Option<String>)>,
}

/// What `typeWriterWalker` finds in a unit of a test. Of each `typeWriterResult`: the line, the
/// source text, and the type or the symbol.
struct Walked {
    /// `TestFile.UnitName`
    name: String,
    types: Vec<(usize, Vec<u8>, String)>,
    symbols: Vec<(usize, Vec<u8>, String)>,
}

/// `codeLinesRegexp.Split`: `[\r\u2028\u2029]|\r?\n`. The first alternative that matches is taken,
/// so `\r\n` is two separators.
fn code_lines_of(content: &[u8]) -> Vec<&[u8]> {
    let (mut lines, mut start, mut at) = (Vec::new(), 0, 0);
    while at < content.len() {
        let length = match content[at..] {
            [b'\r' | b'\n', ..] => 1,
            [0xE2, 0x80, 0xA8 | 0xA9, ..] => 3,
            _ => 0,
        };
        if length > 0 {
            lines.push(&content[start..at]);
            start = at + length;
        }
        at += length.max(1);
    }
    lines.push(&content[start..]);
    lines
}

/// `generateBaseline`, `iterateBaseline`. `walked`: `allFiles`, each with its `TestFile.Content`.
/// Empty: `baseline.NoContent`.
fn type_or_symbol_baseline(
    header: &str,
    walked: &[(Walked, Vec<u8>)],
    is_symbol_baseline: bool,
    lib_dir: &str,
) -> Vec<u8> {
    let mut result = Vec::new();
    for (walked, content) in walked {
        let name = displayed_path(walked.name.as_bytes());
        let mut type_lines = [b"=== ", &name[..], b" ===\r\n"].concat();
        let code_lines = code_lines_of(content);
        // `bracketLineRegex`: `^\s*[{|}]\s*$`
        let is_bracket_line = |line: &[u8]| {
            matches!(line.trim_ascii(), [b'{' | b'|' | b'}']) && !line.contains(&0x0B)
        };
        // `strings.TrimSpace(line) == ""`
        let is_blank =
            |line: &[u8]| str::from_utf8(line).is_ok_and(|it| it.chars().all(char::is_whitespace));
        let follows_directly = |next: usize| {
            (code_lines.get(next)).is_some_and(|it| is_bracket_line(it) || is_blank(it))
        };
        let results = match is_symbol_baseline {
            true => &walked.symbols,
            false => &walked.types,
        };
        let mut next_to_write = 0;
        for (line, source_text, type_or_symbol) in results {
            if next_to_write != line + 1 {
                if next_to_write > 0 && !follows_directly(next_to_write) {
                    type_lines.extend_from_slice(b"\r\n");
                }
                let lines = code_lines.get(next_to_write..=*line).unwrap_or_default();
                type_lines.extend_from_slice(&lines.join(&b"\r\n"[..]));
                type_lines.extend_from_slice(b"\r\n");
            }
            next_to_write = line + 1;
            let written = [
                b">",
                &source_text[..],
                b" : ",
                type_or_symbol.as_bytes(),
                b"\r\n",
            ];
            type_lines.extend_from_slice(&written.concat());
        }
        if next_to_write < code_lines.len() {
            if !follows_directly(next_to_write) {
                type_lines.extend_from_slice(b"\r\n");
            }
            type_lines.extend_from_slice(&code_lines[next_to_write..].join(&b"\r\n"[..]));
        }
        type_lines.extend_from_slice(b"\r\n");
        result.extend_from_slice(&without_prefixes_in_bytes(&type_lines, lib_dir));
    }
    if result.is_empty() {
        return result;
    }
    [b"//// [", header.as_bytes(), b"] ////\r\n\r\n", &result].concat()
}

/// `DoJSEmitBaseline` writes `tsCode`, the JavaScript files, the declaration files and what it has
/// to say about the output. This is `baseline` from the first declaration file, without what it
/// says about JavaScript files. `None`: `baseline` does not begin with `ts_code`.
fn after_the_javascript<'a>(baseline: &'a [u8], ts_code: &[u8]) -> Option<&'a [u8]> {
    let js_code = baseline.strip_prefix(ts_code)?.strip_prefix(b"\r\n\r\n")?;
    let about_them = [
        &b"\r\n\r\n//// [DtsFileErrors]\r\n"[..],
        b"\r\n\r\n!!!! File ",
    ];
    let end = (about_them
        .iter()
        .filter_map(|it| strings::index_of(js_code, it)))
    .min();
    let end = end.unwrap_or(js_code.len());
    // `jsCode.WriteString("\r\n\r\n")` precedes the first one.
    let first = places(&js_code[..end], b"\r\n\r\n//// [").find(|&at| {
        let name = &js_code[at + 10..end];
        let name = strings::index_of_any(name, b"]\r\n").map(|end| (&name[..end], &name[end..]));
        name.is_some_and(|(name, rest)| {
            rest.starts_with(b"]\r\n") && bun_sema::resolve::is_declaration_file_name(name)
        })
    });
    // `compareResultFileSets` of the declaration files comes before that of the JavaScript files.
    let about_javascript = places(&js_code[end..], b"\r\n\r\n!!!! File ").find(|&at| {
        let name = &js_code[end + at + 14..];
        let name = &name[..strings::index_of_char_usize(name, b' ').unwrap_or(name.len())];
        !bun_sema::resolve::is_declaration_file_name(name)
    });
    let last = about_javascript.map_or(js_code.len(), |at| end + at);
    Some(&js_code[first.unwrap_or(end)..last])
}

/// `TracerForBaselining`: typescript-go resolves in several threads, so which lookup finds a
/// `package.json` in the cache differs from run to run. The first line about a file says that it
/// was looked up, and each later one that it was cached.
fn sanitize_trace(lines: &[Vec<u8>], is_case_sensitive: bool) -> Vec<u8> {
    use bstr::ByteSlice;
    let mut package_json_cache: BTreeSet<Vec<u8>> = BTreeSet::new();
    // Whether this is the first line about `file`.
    let mut is_new =
        |file: &[u8]| package_json_cache.insert(to_path(file, is_case_sensitive).into_owned());
    let file_of = |line: &[u8]| line.strip_prefix(b"File '").unwrap_or(line).to_vec();
    let mut trace = Vec::new();
    for line in lines {
        let is_missing = |file: &[u8]| [b"File '", file, b"' does not exist."].concat();
        let is_found = |file: &[u8]| [b"Found 'package.json' at '", file, b"'."].concat();
        let sanitized = if strings::contains(line, b"'7.0.2'") {
            line.replacen("'7.0.2'", "'FakeTSVersion'", 1)
        } else if let Some(start) =
            line.strip_suffix(b"' does not exist according to earlier cached lookups.")
        {
            let file = file_of(start);
            if is_new(&file) {
                is_missing(&file)
            } else {
                line.clone()
            }
        } else if let Some(start) =
            line.strip_suffix(b"' exists according to earlier cached lookups.")
        {
            let file = file_of(start);
            if is_new(&file) {
                is_found(&file)
            } else {
                line.clone()
            }
        } else if let Some(start) = line.strip_suffix(b"' does not exist.") {
            let file = file_of(start);
            match is_new(&file) {
                true => line.clone(),
                false => [
                    b"File '",
                    &file[..],
                    b"' does not exist according to earlier cached lookups.",
                ]
                .concat(),
            }
        } else if let Some(end) = line.strip_prefix(b"Found 'package.json' at '") {
            let file = end.strip_suffix(b"'.").unwrap_or(end);
            match is_new(file) {
                true => line.clone(),
                false => [
                    b"File '",
                    file,
                    b"' exists according to earlier cached lookups.",
                ]
                .concat(),
            }
        } else {
            line.clone()
        };
        trace.extend_from_slice(&sanitized);
        trace.push(b'\n');
    }
    trace
}

/// Where `ours` and `expected` differ first.
fn first_difference(ours: &[u8], expected: &[u8]) -> Option<String> {
    if ours == expected {
        return None;
    }
    let (mut ours, mut expected) = (
        bun_core::strings::split(ours, b"\n"),
        bun_core::strings::split(expected, b"\n"),
    );
    let mut line = 1;
    loop {
        let (a, b) = (ours.next(), expected.next());
        if a != b || a.is_none() {
            let shown = |it: Option<&[u8]>| match it {
                Some(it) => format!("{:?}", bstr::BStr::new(&it[..it.len().min(160)])),
                None => "the end".to_owned(),
            };
            return Some(format!(
                "line {line}: expected {}, got {}",
                shown(b),
                shown(a)
            ));
        }
        line += 1;
    }
}

/// The lines before the first empty line: one error each, with its elaboration below it.
fn top_of(text: &str) -> &str {
    find(text, "\n\n\n").map_or(text, |end| &text[..end])
}

/// Where and what, of each error in `top`.
fn heads(top: &str) -> Vec<String> {
    let mut heads: Vec<String> = lines(top)
        .filter(|line| !line.starts_with(' ') && !line.is_empty())
        .filter_map(|line| {
            let at = find(line, " TS")?;
            let code_end = find(&line[at + 3..], ":")? + at + 3;
            Some(line[..code_end].to_owned())
        })
        .collect();
    heads.sort();
    heads
}

/// The end of `compileFilesWithHost`: the errors of `postProgram`, which has emitted before it is
/// checked. If `preProgram`, which is only checked, has more or fewer, the shorter list and TS-1.
fn errors_of_both_programs(pre: Report, mut post: Report) -> Report {
    let (before, after) = (pre.diagnostics.len(), post.diagnostics.len());
    if before == after {
        return post;
    }
    // `NewCompilerDiagnostic(NewAdHocMessage(..))`
    let ad_hoc = |text: String| Diagnostic {
        path: Vec::new(),
        start: 0,
        end: 0,
        has_undefined_range: true,
        line: 0,
        column: 0,
        end_line: 0,
        end_column: 0,
        code: -1i32 as u32,
        category: Category::Error,
        text: text.into_bytes(),
        args: Box::default(),
        message_chain: Vec::new(),
        source: Vec::new(),
        source_line: 0,
        related: Vec::new(),
        project: 0,
    };
    let (longer, mut shorter) = match before > after {
        true => (pre.diagnostics, post.diagnostics),
        false => (post.diagnostics, pre.diagnostics),
    };
    let mut diag = ad_hoc(format!(
        "Pre-emit ({before}) and post-emit ({after}) diagnostic counts do not match! This can indicate that a semantic _error_ was added by the emit resolver - such an error may not be reflected on the command line or in the editor, but may be captured in a baseline here!"
    ));
    diag.related
        .push(ad_hoc("The excess diagnostics are:".to_owned()));
    // `CompareDiagnostics`
    let key = |d: &Diagnostic| (d.path.clone(), d.start, d.end, d.code, d.text.clone());
    let matched: Vec<_> = shorter.iter().map(key).collect();
    diag.related
        .extend(longer.into_iter().filter(|d| !matched.contains(&key(d))));
    // It has no file and the least code.
    shorter.insert(0, diag);
    post.diagnostics = shorter;
    post
}

fn without_related(text: &str) -> String {
    lines(text)
        .filter(|line| !line.starts_with("!!! related "))
        .collect::<Vec<_>>()
        .join("\n")
}

fn level_of(ours: &str, expected: &str) -> Level {
    if ours == expected {
        return Level::All;
    }
    if without_related(ours) == without_related(expected) {
        return Level::Spans;
    }
    let (a, b) = (top_of(ours), top_of(expected));
    if a == b {
        return Level::Words;
    }
    if heads(a) == heads(b) {
        return Level::Codes;
    }
    Level::Differs
}

pub struct Suite<'a> {
    /// `compiler`, `conformance`
    pub name: &'a str,
    /// Location of the tests.
    pub cases: &'a str,
    /// Location of the baselines.
    pub baselines: &'a str,
    /// The names of all baselines of the suite, of every kind.
    pub names: &'a [String],
}

pub struct Setup<'a> {
    /// What the paths of the libraries, the tests and the baselines are paths in. `None`: the
    /// disk.
    pub bundle: Option<&'static Bundle>,
    /// Where `lib.*.d.ts` are.
    pub lib_dir: &'a str,
    /// TypeScript's `tests/lib`.
    pub test_lib: &'a str,
    pub only: Option<&'a str>,
    /// Where to write what differs from its baseline, if anywhere, and next to it what was
    /// expected.
    pub out: Option<&'a str>,
    /// Whether the `.types` and `.symbols` baselines are compared.
    pub types_and_symbols: bool,
    /// Whether the `.js` baselines are compared, without the JavaScript in them.
    pub declarations: bool,
    /// Whether the `.trace.json` baselines are compared.
    pub traces: bool,
    pub threads: usize,
    /// Only every n-th test, in the order of their paths. 1: all of them.
    pub every: usize,
    /// The index of the first of those. The values below `every` divide the tests among as many
    /// runs.
    pub first: usize,
}

impl Setup<'_> {
    fn read(&self, path: &str) -> Option<Cow<'static, [u8]>> {
        match self.bundle {
            Some(bundle) => bundle.read(path.as_bytes()).map(Cow::Borrowed),
            None => read_file(path).map(Cow::Owned),
        }
    }

    /// The tests in `dir`, at any depth.
    fn tests_under(&self, dir: &str) -> Vec<String> {
        let mut found = Vec::new();
        match self.bundle {
            Some(bundle) => found.extend(
                bundle
                    .under(dir.as_bytes())
                    .filter(|rest| rest.ends_with(b".ts") || rest.ends_with(b".tsx"))
                    .map(|rest| format!("{dir}/{}", text(rest))),
            ),
            None => {
                let disk =
                    bun_sema_driver::host::Disk::with_already_read(1, Default::default(), b"/");
                files_under(&disk, dir, &mut found);
            }
        }
        found.sort_unstable();
        found
    }
}

fn files_under(disk: &dyn Host, dir: &str, found: &mut Vec<String>) {
    let (files, directories) = disk.entries(dir.as_bytes());
    let is_test = |name: &&Vec<u8>| name.ends_with(b".ts") || name.ends_with(b".tsx");
    found.extend((files.iter().filter(is_test)).map(|name| format!("{dir}/{}", text(name))));
    for name in &directories {
        files_under(disk, &format!("{dir}/{}", text(name)), found);
    }
}

/// `SkipUnsupportedCompilerOptions`
fn is_unsupported(compiler: &[(Vec<u8>, Json)]) -> bool {
    let get = |name: &str| {
        let mut options = compiler.iter().rev();
        options.find(|o| o.0 == name.as_bytes()).map(|o| &o.1)
    };
    let word = |name: &str| {
        get(name)
            .and_then(Json::as_str)
            .map(|word| text(word).to_lowercase())
            .unwrap_or_default()
    };
    matches!(word("module").as_str(), "amd" | "umd" | "system")
        || matches!(
            word("moduleResolution").as_str(),
            "node10" | "node" | "classic"
        )
        || matches!(get("esModuleInterop"), Some(Json::Bool(false)))
        || matches!(get("allowSyntheticDefaultImports"), Some(Json::Bool(false)))
        || !word("baseUrl").is_empty()
        || !word("outFile").is_empty()
        || matches!(word("target").as_str(), "es5" | "es3")
        || matches!(get("alwaysStrict"), Some(Json::Bool(false)))
}

/// One test in one configuration. `None`: typescript-go does not run it.
/// What `run_one` produces besides the errors.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Also {
    Nothing,
    TypesAndSymbols,
    Declarations,
}

struct Ran {
    report: Report,
    /// The files that `.errors.txt` shows.
    inputs: Vec<(String, Vec<u8>)>,
    /// `allFiles` of `verifyTypesAndSymbols`, each with its `TestFile.Content`.
    walked: Vec<(Walked, Vec<u8>)>,
    /// `tsCode` of `DoJSEmitBaseline`, without the header.
    ts_code: Vec<u8>,
    /// `result.DTS`: the name and the text of each file.
    declarations: Vec<(Vec<u8>, Vec<u8>)>,
    /// `prepareDeclarationCompilationContext`: `declInputFiles` and `declOtherFiles`.
    declaration_files: Option<(Vec<Unit>, Vec<Unit>)>,
    /// Whether `DoJSEmitBaseline` compares the declaration files with those of `noCheck`.
    repeats_without_checking: bool,
    /// `compilerTest.hasNonDtsFiles`
    has_non_dts_files: bool,
    /// `result.Trace`, with `traceResolution`.
    trace: Option<Vec<u8>>,
}

fn run_one(
    setup: &Setup,
    path: &str,
    code: &[u8],
    settings: &BTreeMap<String, String>,
    has_baselines: bool,
    also: Also,
    declaration_files: Option<&(Vec<Unit>, Vec<Unit>)>,
) -> Option<Ran> {
    let Parsed { mut units, links } = units_of(code, path);
    let cwd = absolute(
        settings.get("currentdirectory").map_or("", |s| s.as_str()),
        SRC,
    );
    // The options from the test directives, in the form of `compilerOptions`.
    let mut reported: Vec<(Vec<u8>, Json)> = Vec::new();
    for (name, value) in settings {
        if HARNESS_OPTIONS.contains(&name.as_str()) {
            continue;
        }
        match bun_sema::config_options::from_text(name.as_bytes(), value.as_bytes()) {
            // `getOptionValue`: an option declared `IsFilePath` is resolved against the current
            // directory.
            Some((name @ (b"outDir" | b"rootDir" | b"declarationDir"), Json::String(path))) => {
                let path = absolute(&text(&path), &cwd).into_bytes();
                reported.push((name.to_owned(), Json::String(path)))
            }
            Some((name, value)) => reported.push((name.to_owned(), value)),
            None => match name.as_str() {
                "suppressoutputpathcheck" => reported.push((
                    b"suppressOutputPathCheck".to_vec(),
                    Json::Bool(value.eq_ignore_ascii_case("true")),
                )),
                "allownontsextensions" | "noerrortruncation" => {}
                // `t.Fatalf`
                _ if !has_baselines => return None,
                _ => {}
            },
        }
    }
    let is_case_sensitive = settings
        .get("usecasesensitivefilenames")
        .is_none_or(|v| !v.eq_ignore_ascii_case("false"));
    let mounted = vec![
        (setup.lib_dir.into(), setup.lib_dir.into()),
        (LIB.into(), setup.test_lib.into()),
    ];

    // `makeUnitsFromTest`: the first `tsconfig.json` or `jsconfig.json` is the configuration,
    // parsed against a file system that contains only the files of the test.
    let config_at = units.iter().position(|unit| {
        let name = replace(&unit.name, "\\", "/");
        let name = base_name(&name).to_lowercase();
        name == "tsconfig.json" || name == "jsconfig.json"
    });
    let config_cwd = settings
        .get("currentdirectory")
        .filter(|s| !s.is_empty())
        .map_or_else(|| SRC.to_owned(), |dir| absolute(dir, "/"));
    let mut named_by_config: Option<Vec<Vec<u8>>> = None;
    let mut config_unit = None;
    if let Some(at) = config_at {
        let mut only_units = Virtual::new(true, Vec::new(), None);
        for unit in &units {
            only_units.add_file(
                absolute(&unit.name, &config_cwd).as_bytes(),
                unit.content.clone(),
            );
        }
        let config_path = absolute(&units[at].name, &config_cwd);
        let project = config::load_overriding(
            &only_units,
            &Session::new(),
            config_path.as_bytes(),
            &|_| Vec::new(),
        );
        named_by_config = project.ok().map(|project| project.files);
        config_unit = Some(units.remove(at));
    }

    let (mut roots, mut others): (Vec<&Unit>, Vec<&Unit>) = (Vec::new(), Vec::new());
    match &named_by_config {
        Some(named) => {
            for unit in &units {
                if named.contains(&absolute(&unit.name, &cwd).into_bytes()) {
                    roots.push(unit);
                } else {
                    others.push(unit);
                }
            }
        }
        None => {
            let last = units.last().unwrap();
            let refers = |needle: &[u8]| strings::contains(&last.content, needle);
            let has_reference = places(&last.content, b"reference").any(|at| {
                let rest = &last.content[at + 9..];
                rest.first().is_some_and(u8::is_ascii_whitespace) && rest[1..].starts_with(b"path")
            });
            if settings
                .get("noimplicitreferences")
                .is_some_and(|v| !v.is_empty())
                || refers(b"require(")
                || has_reference
            {
                roots.push(last);
                others.extend(units[..units.len() - 1].iter());
            } else {
                roots.extend(units.iter());
            }
        }
    }

    // `compileDeclarationFiles`
    if let Some((inputs, other_files)) = declaration_files {
        (roots, others) = (inputs.iter().collect(), other_files.iter().collect());
    }

    let mut host = Virtual::new(is_case_sensitive, mounted, setup.bundle);
    for unit in roots.iter().chain(&others) {
        host.add_file(absolute(&unit.name, &cwd).as_bytes(), unit.content.clone());
    }
    for (link, target) in &links {
        host.add_link(
            absolute(link, &cwd).as_bytes(),
            absolute(target, &cwd).as_bytes(),
        );
    }
    let mut files: Vec<Vec<u8>> = roots
        .iter()
        .map(|unit| absolute(&unit.name, &cwd))
        .filter(|name| !name.ends_with(".json") && !name.ends_with(".tsbuildinfo"))
        .map(String::into_bytes)
        .collect();
    let no_lib = reported
        .iter()
        .any(|o| o.0 == b"noLib" && matches!(o.1, Json::Bool(true)));
    if let Some(lib_files) = settings.get("libfiles") {
        for lib in split(lib_files, ",")
            .map(str::trim)
            .filter(|l| !l.is_empty())
        {
            if lib == "lib.d.ts" && !no_lib {
                continue;
            }
            files.push(format!("{LIB}/{lib}").into_bytes());
        }
    }

    // `CompileFiles`: the default options of a test, unless it overrides them.
    let defaults = |compiler: &mut Vec<(Vec<u8>, Json)>| {
        if !compiler.iter().any(|o| o.0 == b"skipDefaultLibCheck") {
            compiler.push((b"skipDefaultLibCheck".to_vec(), Json::Bool(true)));
        }
        compiler.push((b"noErrorTruncation".to_vec(), Json::Bool(true)));
    };
    if let Some(unit) = &config_unit {
        host.add_file(absolute(&unit.name, &cwd).as_bytes(), unit.content.clone());
    }
    // `compileFilesWithHost` creates two programs from it.
    let parsed_command_line = || -> Project {
        let mut compiler = reported.clone();
        defaults(&mut compiler);
        let from_config_file = config_unit.as_ref().and_then(|unit| {
            let path = absolute(&unit.name, &cwd);
            let over = |_: bool| compiler.clone();
            config::load_overriding(&host, &Session::new(), path.as_bytes(), &over).ok()
        });
        let mut project: Project = from_config_file.unwrap_or_else(|| {
            config::without_config(&host, cwd.as_bytes(), Json::Object(compiler), files.clone())
        });
        // `compileDeclarationFiles` passes on `ConfigFile` and not `Errors`.
        if declaration_files.is_some() {
            project.errors.clear();
        }
        project.files.clone_from(&files);
        project.options.files.clone_from(&files);
        // `NewProgram` gets options and file names: there is no `ConfigFile` to explain a root file with.
        project.options.file_specs.clear();
        project.options.include_specs.clear();
        project.options.is_default_include_spec = false;
        project.options.captures_suggestions = settings
            .get("capturesuggestions")
            .is_some_and(|v| v.eq_ignore_ascii_case("true"));
        project
    };
    let project = parsed_command_line();
    if !has_baselines && is_unsupported(&project.raw_compiler_options) {
        return None;
    }

    // What is found in each file. An invalid task is retried, so a file can be visited twice: the
    // last visit replaces the first, in place.
    type Sections = Vec<(bun_sema::program::FileId, Vec<Walked>)>;
    let sections: Guarded<Sections> = Guarded::new(Vec::new());
    let write_unit = |checker: &mut bun_sema::check::Checker<'_, '_>,
                      file: bun_sema::program::FileId,
                      path: &str| {
        let text = checker.hir(file).text.clone();
        let starts = compute_ecma_line_starts(&text);
        let result = |start: u32, end: u32, type_or_symbol: String| {
            let (start, end) = (start as usize, (end as usize).min(text.len()));
            // A missing identifier has no text.
            let source_text = text.get(start..end)?;
            let line = starts.partition_point(|&s| s as usize <= start) - 1;
            // `lineDelimiter.ReplaceAllString(result.sourceText, "")`
            let source_text = replace_in_bytes(source_text, b"\r\n", b"");
            let source_text = replace_in_bytes(&source_text, b"\n", b"");
            Some((line, source_text, type_or_symbol))
        };
        let types = checker.types_at_locations(file).into_iter();
        let types = types.filter_map(|it| result(it.start, it.end, it.type_text));
        let types = types.collect();
        let symbols = checker.symbols_at_locations(file).into_iter();
        let symbols = symbols.filter_map(|it| result(it.start, it.end, it.symbol_text));
        let walked = Walked {
            name: path.to_owned(),
            types,
            symbols: symbols.collect(),
        };
        let mut sections = sections.lock();
        let section = sections.iter_mut().find(|it| it.0 == file).unwrap();
        section.1.push(walked);
    };
    let write_types = |checker: &mut bun_sema::check::Checker<'_, '_>,
                       file: bun_sema::program::FileId| {
        {
            let mut sections = sections.lock();
            match sections.iter_mut().find(|it| it.0 == file) {
                Some(section) => section.1.clear(),
                None => sections.push((file, Vec::new())),
            }
        }
        let files = &checker.p.files;
        let path = text(files.modules[file.idx()].file_name());
        // `GetSourceFile` of a path in `redirectFilesByPath` returns the retained copy of the
        // package: the harness walks it once more, alongside the text of that unit.
        let mut copies: Vec<String> = Vec::new();
        if contains(&path, "/node_modules/") {
            let same_file = files
                .redirect_targets
                .get(&file)
                .copied()
                .unwrap_or_default();
            copies.extend(same_file.iter().map(|other| text(other)));
        }
        // A later unit with the same name replaces the file. The harness walks the result of
        // `GetSourceFile` once for each of them, alongside the text of that unit.
        let units = roots.iter().chain(&others);
        for _ in units.filter(|unit| absolute(&unit.name, &cwd) == path) {
            write_unit(checker, file, &path);
        }
        for copy in copies {
            write_unit(checker, file, &copy);
        }
    };
    let is_true = |option: &[u8]| {
        let mut all = project.raw_compiler_options.iter();
        all.any(|it| it.0 == option && matches!(it.1, Json::Bool(true)))
    };
    let (declaration, emit_bom) = (is_true(b"declaration"), is_true(b"emitBOM"));
    let (no_emit, no_check) = (project.options.no_emit, project.options.no_check);
    let no_emit_on_error = project.options.no_emit_on_error;
    let emits_declarations = project.options.emits_declarations;
    let (out_dir, allow_js) = (project.options.out_dir.clone(), project.options.allow_js);
    // Of each declaration file: the place of its source in the program, whether `getOutputPath`
    // finds it, its name and its text.
    let dts: Guarded<Vec<(u32, bool, Vec<u8>, Vec<u8>)>> = Guarded::new(Vec::new());
    let common_source_directory: Guarded<Option<Vec<u8>>> = Guarded::new(None);
    let write_dts = |checker: &mut bun_sema::check::Checker<'_, '_>,
                     file: bun_sema::program::FileId| {
        // `emitDeclarationFile`
        if !emits_declarations || no_emit {
            return;
        }
        let files = &checker.p.files;
        let (path, output) = (
            files.module(file).file_name(),
            files.declaration_file_path(file),
        );
        let common = files.common_source_directory;
        *common_source_directory.lock() = common.map(<[u8]>::to_vec);
        // `getOutputPath`, which looks in `outDir` for what is in `declarationDir`.
        let moves = !files.options.declaration_dir.is_empty() || !out_dir.is_empty();
        let looked_up = match common.filter(|it| moves && !it.is_empty()) {
            Some(common) => {
                use bun_paths::{platform::Posix, resolve_path::relative_normalized};
                let dir = match out_dir.is_empty() {
                    true => cwd.as_bytes(),
                    false => &out_dir[..],
                };
                join(dir, relative_normalized::<Posix, true>(common, path))
            }
            None => path.to_vec(),
        };
        let looked_up = bun_sema::resolve::output_declaration_file_name(&looked_up, None);
        // In the order of the program.
        let order = files.order;
        let place = order
            .iter()
            .position(|&it| it == file)
            .unwrap_or(order.len());
        let Some(written) = checker.emit_declaration_file(file) else {
            return;
        };
        let mut text: Vec<u8> = match emit_bom {
            true => "\u{feff}".into(),
            false => Vec::new(),
        };
        // The harness requests `\r\n`.
        for line in written.split_inclusive(|&b| b == b'\n') {
            match line.strip_suffix(b"\n") {
                Some(line) => text.extend_from_slice(&[line, b"\r\n"].concat()),
                None => text.extend_from_slice(line),
            }
        }
        let is_found = looked_up.as_ref() == Some(&output);
        let mut written = dts.lock();
        written.retain(|it| it.0 != place as u32);
        written.push((place as u32, is_found, output, text));
    };
    type AfterFile<'a> =
        &'a (dyn Fn(&mut bun_sema::check::Checker<'_, '_>, bun_sema::program::FileId) + Sync);
    let check = |project: Project, after_file: Option<AfterFile>| {
        let request = Request {
            compiler_options: &[],
            cwd: cwd.as_bytes(),
            project: None,
            build: false,
            errors: &[],
            paths: &[],
            are_entry_points: false,
            threads: 1,
            libs: bun_sema_driver::Libs::Directory(setup.lib_dir.as_bytes()),
            progress: None,
            only: None,
            order: 1,
            digests: false,
            task_clock: None,
            plan_options: bun_sema_driver::PlanOptions {
                reproduces_symbol_ids: false,
                ..Default::default()
            },
            retains_everything: false,
            script_kinds: &[],
            script_kinds_by_extension: &[],
            conditions: &[],
            stops_like_tsc: false,
            uses_typescript_wording: true,
            loaded: None,
            checked: None,
            declaration_file_emitted: None,
            after_file,
        };
        let began = std::time::Instant::now();
        bun_sema_driver::check_project(&host, project, &request, Report::default(), began)
    };
    // `compileFilesWithHost`: `preProgram` is only checked. `postProgram` emits first, and the types
    // and the symbols are read from it.
    let mut trace = None;
    let report = match also {
        // `result.DTS` is what `postProgram` emits.
        Also::Declarations => {
            let mut project = project;
            project.options.emits_first = true;
            project.options.trace_resolution = false;
            check(project, Some(&write_dts))
        }
        Also::Nothing | Also::TypesAndSymbols => {
            // `preCompilerOptions.TraceResolution = core.TSFalse`
            let mut pre = project;
            pre.options.trace_resolution = false;
            let pre = check(pre, None);
            let mut project = parsed_command_line();
            project.options.emits_first = true;
            let traces_resolution = project.options.trace_resolution;
            let write_types = (also == Also::TypesAndSymbols).then_some(&write_types as AfterFile);
            let post = check(project, write_types);
            if traces_resolution {
                trace = Some(sanitize_trace(&post.resolution_trace, is_case_sensitive));
            }
            errors_of_both_programs(pre, post)
        }
    };
    let sections = std::mem::take(&mut *sections.lock());
    let mut found: Vec<Walked> = sections.into_iter().flat_map(|it| it.1).collect();
    let mut walked = Vec::new();
    for unit in roots.iter().chain(&others) {
        let name = absolute(&unit.name, &cwd);
        // `program.GetSourceFile(f.UnitName) != nil`
        if let Some(at) = found.iter().position(|it| it.name == name) {
            walked.push((found.remove(at), unit.content.clone()));
        }
    }
    // `tsSources`
    let sources: Vec<Vec<u8>> = (others.iter().chain(&roots))
        .map(|unit| {
            let name = base_name(&unit.name);
            let name = rfind(name, "\\").map_or(name, |at| &name[at + 1..]);
            [b"//// [", name.as_bytes(), b"]\r\n", &unit.content[..]].concat()
        })
        .collect();
    let mut declarations = std::mem::take(&mut *dts.lock());
    // `HandleNoEmitOnError`
    if no_emit_on_error && !report.diagnostics.is_empty() {
        declarations.clear();
    }
    // `IsEmitBlocked`: `blockEmittingOfFile` is called with the file that these name.
    let blocked = report
        .diagnostics
        .iter()
        .filter(|it| matches!(it.code, 5055 | 5056));
    let blocked: Vec<&[u8]> = blocked
        .filter_map(|it| bun_core::strings::split(&it.text, b"'").nth(1))
        .collect();
    declarations.retain(|it| !blocked.contains(&&it.2[..]));
    // `newCompilationResult`: in the order of the inputs, then "any unhandled outputs, ordered by
    // unit name".
    declarations.sort_by(|a, b| match (a.1, b.1) {
        (true, true) => a.0.cmp(&b.0),
        (false, false) => a.2.cmp(&b.2),
        (a_is_found, _) => (!a_is_found).cmp(&a_is_found),
    });
    let declarations: Vec<(Vec<u8>, Vec<u8>)> =
        declarations.into_iter().map(|it| (it.2, it.3)).collect();
    // `prepareDeclarationCompilationContext`
    let has_errors = !report.diagnostics.is_empty();
    let declaration_files = (declaration && !has_errors && !declarations.is_empty()).then(|| {
        let common = common_source_directory.lock().take();
        // `findResultCodeFile`
        let find_result_code_file = |name: &str| {
            let moved = match (&common, out_dir.is_empty()) {
                (Some(common), false) => {
                    // `EnsureTrailingDirectorySeparator`
                    let common = format!("{}/", text(common).trim_end_matches('/'));
                    let rest = match find(name, &common) {
                        Some(at) => [&name[..at], &name[at + common.len()..]].concat(),
                        None => name.to_owned(),
                    };
                    join(&out_dir, rest.as_bytes())
                }
                _ => name.as_bytes().to_vec(),
            };
            let name = bun_sema::resolve::output_declaration_file_name(&moved, None)?;
            declarations.iter().find(|it| it.0 == name)
        };
        let mut lists: [Vec<Unit>; 2] = [Vec::new(), Vec::new()];
        for (list, units) in [&roots, &others].into_iter().enumerate() {
            // `addDtsFile`
            for unit in units {
                let name = absolute(&unit.name, &cwd);
                let is_one_of =
                    |extensions: &[&str]| extensions.iter().any(|it| name.ends_with(it));
                if bun_sema::resolve::is_declaration_file_name(name.as_bytes())
                    || name.ends_with(".json")
                {
                    lists[list].push(Unit {
                        name,
                        content: unit.content.clone(),
                    });
                } else if (is_one_of(&[".ts", ".tsx", ".mts", ".cts"])
                    || allow_js && is_one_of(&[".js", ".jsx", ".mjs", ".cjs"]))
                    && let Some((name, content)) = find_result_code_file(&name)
                    && !lists
                        .iter()
                        .flatten()
                        .any(|it| it.name.as_bytes() == &name[..])
                {
                    let without_mark = content.strip_prefix("\u{feff}".as_bytes());
                    lists[list].push(Unit {
                        name: text(name),
                        content: without_mark.unwrap_or(content).to_vec(),
                    });
                }
            }
        }
        let [inputs, other_files] = lists;
        (inputs, other_files)
    });
    let inputs = config_unit
        .iter()
        .chain(roots.iter().copied())
        .chain(others.iter().copied())
        .map(|unit| (absolute(&unit.name, &cwd), unit.content.clone()))
        .collect();
    Some(Ran {
        report,
        inputs,
        walked,
        ts_code: sources.join(&b"\r\n"[..]),
        declarations,
        declaration_files,
        repeats_without_checking: emits_declarations && !no_check && !no_emit,
        has_non_dts_files: (roots.iter().chain(&others)).any(|it| !it.name.ends_with(".d.ts")),
        trace,
    })
}

/// Runs the tests of `suite`.
pub fn run(suite: &Suite, setup: &Setup) -> Vec<Outcome> {
    let tests = setup.tests_under(suite.cases);
    // Keyed by test: the configurations that have baselines.
    let mut configurations: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for name in suite.names {
        // A test name can contain dots, so the baseline kind is stripped from the end.
        const KINDS: [&str; 7] = [
            ".errors.txt",
            ".sourcemap.txt",
            ".trace.json",
            ".js.map",
            ".symbols",
            ".types",
            ".js",
        ];
        let name = name.strip_suffix(".diff").unwrap_or(name);
        let Some(configured) = KINDS.iter().find_map(|kind| name.strip_suffix(kind)) else {
            continue;
        };
        let (stem, configuration) = match configured.strip_suffix(')').map(|c| (c, rfind(c, "("))) {
            Some((inner, Some(open))) => (&inner[..open], &inner[open + 1..]),
            _ => (configured, ""),
        };
        configurations
            .entry(stem)
            .or_default()
            .insert(configuration);
    }
    let outcomes = Guarded::new(Vec::new());
    let next = std::sync::atomic::AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..setup.threads.max(1) {
            // A task is checked on this thread, which needs the stack of a thread of Bun's pool.
            let stack = bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize;
            let thread = std::thread::Builder::new().stack_size(stack);
            let spawned = thread.spawn_scoped(scope, || {
                bun_core::StackCheck::configure_thread();
                loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    let Some(path) = tests.get(i) else { break };
                    let base = base_name(path);
                    if SKIPPED.contains(&base)
                        || setup.only.is_some_and(|only| !contains(path, only))
                        || i % setup.every.max(1) != setup.first
                    {
                        continue;
                    }
                    let stem = base
                        .strip_suffix(".tsx")
                        .or_else(|| base.strip_suffix(".ts"))
                        .unwrap();
                    let code = decode(&setup.read(path).unwrap());
                    let settings = settings_of(&code);
                    let none = BTreeSet::from([""]);
                    let (known, has_baselines) = match configurations.get(stem) {
                        Some(known) => (known, true),
                        None => (&none, false),
                    };
                    for configuration in known {
                        let mut settings = settings.clone();
                        let varied: Vec<(&str, &str)> = split(configuration, ",")
                            .filter_map(|pair| find(pair, "=").map(|at| (&pair[..at], &pair[at + 1..])))
                            .collect();
                        for (name, value) in settings.iter_mut() {
                            match varied.iter().find(|v| v.0 == name) {
                                Some(&(_, chosen)) => chosen.clone_into(value),
                                None => *value = the_one_value(name, value),
                            }
                        }
                        let configured = if configuration.is_empty() {
                            stem.to_owned()
                        } else {
                            format!("{stem}({configuration})")
                        };
                        let name = format!("{}/{configured}", suite.name);
                        let _watched = Watched::new(&name);
                        let run_one = |also: Also,
                                       settings: &BTreeMap<String, String>,
                                       declaration_files: Option<&(Vec<Unit>, Vec<Unit>)>| {
                            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                run_one(
                                    setup,
                                    path,
                                    &code,
                                    settings,
                                    has_baselines,
                                    also,
                                    declaration_files,
                                )
                            }))
                        };
                        let also = match setup.types_and_symbols {
                            true => Also::TypesAndSymbols,
                            false => Also::Nothing,
                        };
                        let ran = run_one(also, &settings, None);
                        // `tests/cases/compiler/a.ts`
                        let header = rfind(path, "/tests/cases/").map_or(&path[..], |at| &path[at + 1..]);
                        let mut others: Vec<(Kind, Option<String>)> = Vec::new();
                        let compare = |kind: Kind, ours: &[u8], expected: &[u8]| {
                            let difference = first_difference(ours, expected);
                            if let (Some(out), Some(_)) = (setup.out, &difference) {
                                let dir = format!("{out}/{}", suite.name);
                                let path = format!("{dir}/{configured}.{}", kind.extension());
                                write_file_to_look_at(&path, ours);
                                write_file_to_look_at(&format!("{path}.expected"), expected);
                            }
                            (kind, difference)
                        };
                        let baseline = |kind: Kind| {
                            setup.read(&format!(
                                "{}/{configured}.{}",
                                suite.baselines,
                                kind.extension()
                            ))
                        };
                        let is_set = |option: &str| {
                            (settings.get(option)).is_some_and(|it| it.eq_ignore_ascii_case("true"))
                        };
                        // `verifyTypesAndSymbols`
                        if setup.types_and_symbols && !is_set("notypesandsymbols") {
                            match &ran {
                                Ok(Some(ran)) => {
                                    // `typeWriterWalker.hadErrorBaseline`: the error type is printed
                                    // with its intrinsic name only in a test without errors.
                                    let name = match ran.report.diagnostics.is_empty() {
                                        true => "error",
                                        false => "any",
                                    };
                                    let walked: Vec<(Walked, Vec<u8>)> = (ran.walked.iter())
                                        .map(|(walked, content)| {
                                            let types = walked.types.iter().cloned().map(|mut it| {
                                                if it.2 == bun_sema::check::type_writer::ERROR_TYPE_TEXT
                                                {
                                                    name.clone_into(&mut it.2);
                                                }
                                                it
                                            });
                                            let walked = Walked {
                                                name: walked.name.clone(),
                                                types: types.collect(),
                                                symbols: walked.symbols.clone(),
                                            };
                                            (walked, content.clone())
                                        })
                                        .collect();
                                    for kind in [Kind::Types, Kind::Symbols] {
                                        let ours = type_or_symbol_baseline(
                                            header,
                                            &walked,
                                            kind == Kind::Symbols,
                                            setup.lib_dir,
                                        );
                                        let expected = baseline(kind).unwrap_or_default();
                                        others.push(compare(kind, &ours, &expected));
                                    }
                                }
                                Ok(None) => {}
                                Err(_) => {
                                    for kind in [Kind::Types, Kind::Symbols] {
                                        others.push((kind, Some("panicked".to_owned())));
                                    }
                                }
                            }
                        }
                        // `verifyModuleResolution`
                        if setup.traces
                            && let Ok(Some(ran)) = &ran
                            && let Some(ours) = &ran.trace
                        {
                            let expected = baseline(Kind::Traces).unwrap_or_default();
                            others.push(compare(Kind::Traces, ours, &expected));
                        }
                        // `len(result.Diagnostics) > 0`
                        let has_errors =
                            !matches!(&ran, Ok(Some(ran)) if ran.report.diagnostics.is_empty());
                        // `verifyJavaScriptOutput`
                        if setup.declarations && !SKIPPED_EMIT.contains(&base) {
                            match run_one(Also::Declarations, &settings, None) {
                                Ok(Some(ran)) if ran.has_non_dts_files => {
                                    let ts_code =
                                        [b"//// [", header.as_bytes(), b"] ////\r\n\r\n", &ran.ts_code]
                                            .concat();
                                    // `fileOutput`
                                    let file_output = |(name, text): &(Vec<u8>, Vec<u8>)| {
                                        let name = match is_set("fullemitpaths") {
                                            true => without_prefixes_in_bytes(
                                                &displayed_path(name),
                                                setup.lib_dir,
                                            ),
                                            false => {
                                                name.rsplit(|&b| b == b'/').next().unwrap().to_vec()
                                            }
                                        };
                                        [b"//// [", &name[..], b"]\r\n", &text[..]].concat()
                                    };
                                    let mut ours = Vec::new();
                                    if !ran.declarations.is_empty() {
                                        ours.extend_from_slice(b"\r\n\r\n");
                                        ours.extend(ran.declarations.iter().flat_map(file_output));
                                    }
                                    // `compileDeclarationFiles`
                                    if let Some(files) = &ran.declaration_files
                                        && !has_errors
                                        && let Ok(Some(compiled)) =
                                            run_one(Also::Nothing, &settings, Some(files))
                                        && !compiled.report.diagnostics.is_empty()
                                    {
                                        let errors = render(
                                            &compiled.report.diagnostics,
                                            &compiled.inputs,
                                            setup.lib_dir,
                                            false,
                                        );
                                        ours.extend_from_slice(
                                            b"\r\n\r\n//// [DtsFileErrors]\r\n\r\n\r\n",
                                        );
                                        ours.extend(replace_in_bytes(&errors, b"\n", b"\r\n"));
                                    }
                                    // `compareResultFileSets(&withoutChecking.DTS, &result.DTS)`
                                    let mut without_checking = settings.clone();
                                    without_checking.insert("nocheck".to_owned(), "true".to_owned());
                                    if ran.repeats_without_checking
                                        && let Ok(Some(without_checking)) =
                                            run_one(Also::Declarations, &without_checking, None)
                                    {
                                        for doc in &without_checking.declarations {
                                            let mut originals = ran.declarations.iter();
                                            let what: &[u8] = match originals.find(|it| it.0 == doc.0) {
                                                None => b" missing from original emit, but present in noCheck emit\r\n",
                                                Some(original) if original.1 != doc.1 => {
                                                    b" differs from original emit in noCheck emit\r\n"
                                                }
                                                Some(_) => continue,
                                            };
                                            let name = displayed_path(&doc.0);
                                            let name = without_prefixes_in_bytes(&name, setup.lib_dir);
                                            ours.extend_from_slice(
                                                &[b"\r\n\r\n!!!! File ", &name[..], what].concat(),
                                            );
                                            ours.extend(file_output(doc));
                                        }
                                    }
                                    others.push(match baseline(Kind::Declarations) {
                                        // `baseline.NoContent`
                                        None => compare(Kind::Declarations, &ours, b""),
                                        Some(expected) => match after_the_javascript(&expected, &ts_code)
                                        {
                                            Some(expected) => {
                                                compare(Kind::Declarations, &ours, expected)
                                            }
                                            None => compare(Kind::Declarations, &ts_code, &expected),
                                        },
                                    });
                                }
                                Ok(_) => {}
                                Err(_) => {
                                    others.push((Kind::Declarations, Some("panicked".to_owned())))
                                }
                            }
                        }
                        let outcome = match ran {
                            Err(_) => Outcome {
                                name,
                                level: Level::Broken,
                                note: "panicked".to_owned(),
                                others,
                            },
                            Ok(None) => continue,
                            Ok(Some(Ran { report, inputs, .. })) => {
                                let expected = setup
                                    .read(&format!("{}/{configured}.errors.txt", suite.baselines))
                                    .map(|bytes| replace(&text(&bytes), "\r\n", "\n"))
                                    .unwrap_or_default();
                                let ours = if report.diagnostics.is_empty() {
                                    String::new()
                                } else {
                                    text(&render(
                                        &report.diagnostics,
                                        &inputs,
                                        setup.lib_dir,
                                        settings
                                            .get("pretty")
                                            .is_some_and(|v| v.eq_ignore_ascii_case("true")),
                                    ))
                                };
                                let level = level_of(&ours, &expected);
                                if let Some(out) = setup.out
                                    && level != Level::All
                                {
                                    let dir = format!("{out}/{}", suite.name);
                                    let path = format!("{dir}/{configured}.errors.txt");
                                    write_file_to_look_at(&path, ours.as_bytes());
                                }
                                let note = if level == Level::Differs {
                                    let (a, b) = (heads(top_of(&ours)), heads(top_of(&expected)));
                                    let only_in = |x: &[String], y: &[String]| {
                                        x.iter()
                                            .filter(|h| !y.contains(h))
                                            .map(|h| rfind(h, " ").map_or(&h[..], |at| &h[at + 1..]))
                                            .collect::<Vec<_>>()
                                            .join(",")
                                    };
                                    format!("false:{} missed:{}", only_in(&a, &b), only_in(&b, &a))
                                } else {
                                    String::new()
                                };
                                Outcome {
                                    name,
                                    level,
                                    note,
                                    others,
                                }
                            }
                        };
                        outcomes.lock().push(outcome);
                    }
                }
            });
            spawned.unwrap();
        }
    });
    let mut outcomes = std::mem::take(&mut *outcomes.lock());
    outcomes.sort_by(|a, b| a.name.cmp(&b.name));
    outcomes
}

/// A test in progress. The checker has no time limit, so a test that does not terminate would
/// silently hang the whole run: after ten minutes the run aborts and reports which test it was.
struct Watched(usize);

static IN_PROGRESS: Guarded<Vec<Option<(String, std::time::Instant)>>> = Guarded::new(Vec::new());

impl Watched {
    fn new(name: &str) -> Watched {
        static WATCHDOG: std::sync::Once = std::sync::Once::new();
        WATCHDOG.call_once(|| {
            let _ = std::thread::Builder::new().spawn(|| {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    for (name, since) in IN_PROGRESS.lock().iter().flatten() {
                        if since.elapsed() > std::time::Duration::from_secs(600) {
                            error_line!("STUCK: {name} has been under way for ten minutes. The run ends here.");
                            std::process::abort();
                        }
                    }
                }
            });
        });
        let mut in_progress = IN_PROGRESS.lock();
        let entry = Some((name.to_owned(), std::time::Instant::now()));
        match in_progress.iter().position(Option::is_none) {
            Some(free) => {
                in_progress[free] = entry;
                Watched(free)
            }
            None => {
                in_progress.push(entry);
                Watched(in_progress.len() - 1)
            }
        }
    }
}

impl Drop for Watched {
    fn drop(&mut self) {
        IN_PROGRESS.lock()[self.0] = None;
    }
}

/// `[--bundle=file] --lib=<dir> --testlib=<dir> [--only=substring] [--every=n [--first=i]] [--threads=n] [--report=file]
/// [--out=dir] [--types-and-symbols] [--declarations] [--traces]
/// <name>=<tests>=<baselines>=<file with the names of all the baselines> ..`
///
/// With `--bundle`, the directories and the file with the names are paths in it.
///
/// Prints how many tests match their `.errors.txt` baseline and how closely, how many match each
/// of the other baselines that are compared, and the first of those that do not. Returns whether
/// all match byte for byte.
pub fn run_from_command_line(args: &[&[u8]]) -> bool {
    let args: Vec<String> = args.iter().map(|arg| text(arg)).collect();
    let flag = |name: &str| {
        args.iter()
            .find_map(|a| a.strip_prefix(&format!("--{name}=")).map(str::to_owned))
    };
    let number = |name: &str| flag(name).and_then(|n| n.parse().ok());
    let (Some(lib_dir), Some(test_lib)) = (flag("lib"), flag("testlib")) else {
        error_line!("--lib and --testlib are required");
        return false;
    };
    let (only, out) = (flag("only"), flag("out"));
    // Declared before whatever reads from it, so it is dropped after.
    let bundle = match flag("bundle") {
        None => None,
        Some(path) => match OwnedBundle::read(&path) {
            Some(bundle) => Some(bundle),
            None => {
                error_line!("cannot read {path}");
                return false;
            }
        },
    };
    let setup = Setup {
        // SAFETY: `setup` and the outcomes are dropped before `bundle`, and the threads of `run`
        // are scoped.
        bundle: bundle.as_ref().map(|bundle| unsafe { bundle.get() }),
        lib_dir: &lib_dir,
        test_lib: &test_lib,
        only: only.as_deref(),
        out: out.as_deref(),
        types_and_symbols: args.iter().any(|it| it == "--types-and-symbols"),
        declarations: args.iter().any(|it| it == "--declarations"),
        traces: args.iter().any(|it| it == "--traces"),
        threads: number("threads").unwrap_or(8),
        every: number("every").unwrap_or(1),
        first: number("first").unwrap_or(0),
    };
    let mut all = Vec::new();
    for spec in args.iter().filter(|a| !a.starts_with("--")) {
        let [name, cases, baselines, names] = split(spec, "=").collect::<Vec<_>>()[..] else {
            error_line!("not <name>=<tests>=<baselines>=<names>: {spec}");
            return false;
        };
        let Some(listed) = setup.read(names) else {
            error_line!("cannot read {names}");
            return false;
        };
        let names: Vec<String> = lines(&text(&listed)).map(str::to_owned).collect();
        let suite = Suite {
            name,
            cases,
            baselines,
            names: &names,
        };
        all.extend(run(&suite, &setup));
    }
    let at_least = |level: Level| all.iter().filter(|o| o.level >= level).count();
    let percent = |n: usize| n as f64 * 100.0 / all.len().max(1) as f64;
    output_line!("{} tests (each configuration counts)", all.len());
    for (level, what) in [
        (Level::Codes, "the same errors at the same places"),
        (Level::Words, "and in the same words"),
        (Level::Spans, "and as long: all but the related information"),
    ] {
        let n = at_least(level);
        output_line!("{n:>6} {:>6.2}%  {what}", percent(n));
    }
    let n = at_least(Level::All);
    output_line!(
        "{n:>6} {:>6.2}%  of {} Errors, byte for byte",
        percent(n),
        all.len()
    );
    let mut failed: Vec<&Outcome> = all.iter().filter(|o| o.level < Level::All).collect();
    failed.sort_unstable_by(|a, b| a.name.cmp(&b.name));
    for outcome in failed.iter().take(50) {
        output_line!(
            "FAIL Errors {} {:?} {}",
            outcome.name,
            outcome.level,
            outcome.note
        );
    }
    let mut are_the_others_the_same = true;
    for kind in Kind::ALL {
        let compared: Vec<(&Outcome, &Option<String>)> = (all.iter())
            .filter_map(|o| Some((o, &o.others.iter().find(|it| it.0 == kind)?.1)))
            .collect();
        if compared.is_empty() {
            continue;
        }
        let same = compared.iter().filter(|it| it.1.is_none()).count();
        are_the_others_the_same &= same == compared.len();
        output_line!(
            "{same:>6} {:>6.2}%  of {} {kind:?}, byte for byte",
            same as f64 * 100.0 / compared.len() as f64,
            compared.len()
        );
        let differences = compared
            .iter()
            .filter_map(|it| Some((it.0, it.1.as_ref()?)));
        for (outcome, difference) in differences.take(50) {
            output_line!("FAIL {kind:?} {} {difference}", outcome.name);
        }
    }
    if let Some(path) = flag("report") {
        let lines: Vec<String> = all
            .iter()
            .map(|o| {
                let differs = o.others.iter().filter(|it| it.1.is_some());
                let differs: Vec<String> = differs.map(|it| format!("{:?}", it.0)).collect();
                format!(
                    "{:?}\t{}\t{}\t{}",
                    o.level,
                    o.name,
                    o.note,
                    differs.join(",")
                )
            })
            .collect();
        if let Err(error) = write_file(&path, (lines.join("\n") + "\n").as_bytes()) {
            error_line!("cannot write {path}: {:?}", error.get_errno());
            return false;
        }
    }
    !all.is_empty() && failed.is_empty() && are_the_others_the_same
}

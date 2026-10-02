//! Runs TypeScript's compiler and conformance tests the way typescript-go's own runner does (`internal/testrunner`,
//! `internal/testutil/harnessutil`, `internal/testutil/tsbaseline`): each test is split into its files, which are put in a file system
//! that is only in memory, checked through the driver `bun check` goes through, and what comes out is written in the format of the
//! `.errors.txt` baselines that are committed there, to be compared with them.

use bun_sema::config::{self, Project};
use bun_sema::json::Json;
use bun_sema::resolve::{Host, Options, join, normalize, parent_dir};
use bun_sema_driver::{Category, Diagnostic, Report, Request};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

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

/// `harnessCommandLineOptions`, in lower case, and what else is no compiler option.
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

/// A file system that is only in memory, but for the default library and `tests/lib`, which are read from where they are.
pub struct Virtual {
    /// By path. On a file system that does not tell `A` from `a`, by the path in lower case, with the path as it is written.
    files: BTreeMap<String, (String, Cow<'static, [u8]>)>,
    /// All that has something in it, likewise.
    directories: BTreeMap<String, String>,
    /// What stands for something else, and what for.
    links: BTreeMap<String, String>,
    is_case_sensitive: bool,
    /// Prefixes that are somewhere on the disk, and where.
    mounted: Vec<(String, String)>,
    disk: bun_sema_driver::host::Disk,
}

impl Virtual {
    fn new(is_case_sensitive: bool, mounted: Vec<(String, String)>) -> Virtual {
        Virtual {
            files: BTreeMap::new(),
            directories: BTreeMap::new(),
            links: BTreeMap::new(),
            is_case_sensitive,
            mounted,
            disk: bun_sema_driver::host::Disk::new(1),
        }
    }

    fn key(&self, path: &str) -> String {
        if self.is_case_sensitive {
            path.to_owned()
        } else {
            path.to_lowercase()
        }
    }

    fn add_directories_above(&mut self, path: &str) {
        let mut dir = parent_dir(path);
        loop {
            if self
                .directories
                .insert(self.key(dir), dir.to_owned())
                .is_some()
                || dir == "/"
                || dir.is_empty()
            {
                break;
            }
            dir = parent_dir(dir);
        }
    }

    fn add_file(&mut self, path: &str, content: Vec<u8>) {
        self.files
            .insert(self.key(path), (path.to_owned(), Cow::Owned(content)));
        self.add_directories_above(path);
    }

    fn add_link(&mut self, path: &str, target: &str) {
        self.links.insert(self.key(path), target.to_owned());
        self.add_directories_above(path);
    }

    /// Where `path` is on the disk, if it is.
    fn on_disk(&self, path: &str) -> Option<String> {
        self.mounted.iter().find_map(|(prefix, real)| {
            let rest = path.strip_prefix(prefix.as_str())?;
            (rest.is_empty() || rest.starts_with('/')).then(|| format!("{real}{rest}"))
        })
    }

    /// `path` with the links in it followed.
    fn followed(&self, path: &str) -> String {
        let mut path = path.to_owned();
        'again: for _ in 0..40 {
            if self.links.is_empty() {
                break;
            }
            let mut end = 0;
            while end < path.len() {
                end = path[end + 1..]
                    .find('/')
                    .map_or(path.len(), |i| end + 1 + i);
                if let Some(target) = self.links.get(&self.key(&path[..end])) {
                    path = format!("{target}{}", &path[end..]);
                    continue 'again;
                }
            }
            break;
        }
        path
    }
}

impl Host for Virtual {
    fn read(&self, path: &str) -> Option<Cow<'static, [u8]>> {
        if let Some(real) = self.on_disk(path) {
            return self.disk.read(&real);
        }
        let (_, content) = self.files.get(&self.key(&self.followed(path)))?;
        Some(Cow::Owned(decode(content)))
    }
    fn is_file(&self, path: &str) -> bool {
        match self.on_disk(path) {
            Some(real) => self.disk.is_file(&real),
            None => self.files.contains_key(&self.key(&self.followed(path))),
        }
    }
    fn is_dir(&self, path: &str) -> bool {
        match self.on_disk(path) {
            Some(real) => self.disk.is_dir(&real),
            None => self
                .directories
                .contains_key(&self.key(&self.followed(path))),
        }
    }
    fn realpath(&self, path: &str) -> String {
        let followed = self.followed(path);
        let key = self.key(&followed);
        match (self.files.get(&key), self.directories.get(&key)) {
            (Some((written, _)), _) => written.clone(),
            (_, Some(written)) => written.clone(),
            _ => followed,
        }
    }
    fn list_dir(&self, path: &str) -> Vec<String> {
        if let Some(real) = self.on_disk(path) {
            return self.disk.list_dir(&real);
        }
        let dir = self.followed(path);
        let prefix = if dir == "/" {
            "/".to_owned()
        } else {
            format!("{}/", self.key(&dir))
        };
        let mut names = BTreeSet::new();
        let written = self
            .files
            .iter()
            .map(|(key, (written, _))| (key, written))
            .chain(self.directories.iter());
        for (key, written) in written {
            if let Some(rest) = key.strip_prefix(&prefix)
                && !rest.is_empty()
                && !rest.contains('/')
            {
                names.insert(written[written.len() - rest.len()..].to_owned());
            }
        }
        for key in self.links.keys() {
            if let Some(rest) = key.strip_prefix(&prefix)
                && !rest.is_empty()
                && !rest.contains('/')
            {
                names.insert(rest.to_owned());
            }
        }
        names.into_iter().collect()
    }
    fn is_case_sensitive(&self) -> bool {
        self.is_case_sensitive
    }
    fn parse(
        &self,
        path: &str,
        text: &[u8],
        atoms: &bun_sema::atom::Interner,
        options: &Options,
    ) -> bun_sema::hir::File {
        self.disk.parse(path, text, atoms, options)
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        for i in 0..count {
            work(i);
        }
    }
}

/// `decodeBytes`: what a file says, going by the mark at its start.
fn decode(bytes: &[u8]) -> Vec<u8> {
    let utf16 = |rest: &[u8], big: bool| {
        let units = rest.chunks_exact(2).map(|pair| {
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

/// `GetNormalizedAbsolutePath`, in the terms of the checker, where `c:/a` is `/c:/a`.
fn absolute(path: &str, cwd: &str) -> String {
    let path = path.replace('\\', "/");
    match path.as_bytes() {
        [drive, b':', ..] if drive.is_ascii_alphabetic() => normalize(&format!("/{path}")),
        _ => join(cwd, &path),
    }
}

fn trim(bytes: &[u8]) -> &[u8] {
    bytes.trim_ascii()
}

/// `optionRegex`, of one line: the name and the value.
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
    let value_end = value
        .iter()
        .position(|&b| b == b'\r' || b == b'\n')
        .unwrap_or(value.len());
    Some((
        String::from_utf8_lossy(&rest[..end]).to_lowercase(),
        &value[..value_end],
    ))
}

/// `lineDelimiter.Split`
fn lines_of(text: &[u8]) -> Vec<&[u8]> {
    text.split(|&b| b == b'\n').collect()
}

struct Unit {
    name: String,
    content: Vec<u8>,
}

struct Parsed {
    units: Vec<Unit>,
    /// What stands for something else, and what for.
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
                && let Some(arrow) = value.windows(2).position(|w| w == b"->")
            {
                let text = |b: &[u8]| String::from_utf8_lossy(trim(b)).into_owned();
                links.push((text(&value[arrow + 2..]), text(&value[..arrow])));
                continue;
            }
            let value = String::from_utf8_lossy(trim(value)).into_owned();
            if option != "filename" {
                if option == "symlink" && !name.is_empty() {
                    for link in value.split(',').map(str::trim).filter(|l| !l.is_empty()) {
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
        name = file_name.rsplit('/').next().unwrap_or(file_name).to_owned();
    }
    units.push(Unit { name, content });
    Parsed { units, links }
}

/// `extractCompilerSettings`
fn settings_of(code: &[u8]) -> BTreeMap<String, String> {
    let mut settings = BTreeMap::new();
    for line in code.split(|&b| b == b'\n') {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if let Some((name, value)) = option_in(line) {
            let value = String::from_utf8_lossy(trim(value)).into_owned();
            let value = value.strip_suffix(';').unwrap_or(&value).to_owned();
            settings.insert(name, value);
        }
    }
    settings
}

/// `splitOptionValues`, where only one is left: which.
fn the_one_value(option: &str, value: &str) -> String {
    let Some(all) = bun_sema::config_options::choices(option) else {
        return value.to_owned();
    };
    let (mut includes, mut excludes, mut star) = (Vec::new(), Vec::new(), false);
    for item in value.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        if item == "*" {
            star = true;
        } else if let Some(excluded) = item.strip_prefix(['-', '!']) {
            excludes.push(excluded.to_lowercase());
        } else {
            includes.push(item.to_owned());
        }
    }
    if star {
        includes.extend(all.iter().map(|&s| s.to_owned()));
    }
    includes
        .into_iter()
        .find(|item| !excludes.contains(&item.to_lowercase()))
        .unwrap_or_else(|| value.to_owned())
}

/// `removeTestPathPrefixes`
fn without_prefixes(text: &str, lib_dir: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let lib = format!("{lib_dir}/");
    let mut rest = text;
    'next: while !rest.is_empty() {
        for prefix in ["/.ts/", "/.lib/", "/.src/", lib.as_str()] {
            if let Some(after) = rest.strip_prefix(prefix) {
                rest = after;
                continue 'next;
            }
        }
        // `/c:/a` is `c:/a` to TypeScript.
        if let [b'/', drive, b':', b'/', ..] = rest.as_bytes()
            && drive.is_ascii_alphabetic()
        {
            rest = &rest[1..];
            continue;
        }
        let c = rest.chars().next().unwrap();
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

/// `isDefaultLibraryFile`
fn is_default_library(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
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

/// `ComputeECMALineStarts`
fn line_starts(text: &[u8]) -> Vec<usize> {
    let mut starts = vec![0];
    let mut i = 0;
    while i < text.len() {
        match text[i] {
            b'\r' => {
                if text.get(i + 1) == Some(&b'\n') {
                    i += 1;
                }
                starts.push(i + 1);
            }
            b'\n' => starts.push(i + 1),
            0xE2 if text.get(i + 1) == Some(&0x80)
                && matches!(text.get(i + 2), Some(0xA8 | 0xA9)) =>
            {
                i += 2;
                starts.push(i + 1);
            }
            _ => {}
        }
        i += 1;
    }
    starts
}

/// `utf8.RuneCountInString`
fn runes(bytes: &[u8]) -> usize {
    String::from_utf8_lossy(bytes).chars().count()
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
        d.path, d.line, d.column
    ));
}

/// `writeCodeSnippet`
fn write_code_snippet(out: &mut String, d: &Diagnostic, color: &str, indent: &str) {
    let utf16_len = |text: &str| text.encode_utf16().count();
    let (first_line, first_char) = (d.line as usize - 1, d.column as usize - 1);
    let (last_line, mut last_char) = (d.end_line as usize - 1, d.end_column as usize - 1);
    // Without length, what comes right after is pointed at.
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
            .map_or("", |line| line.as_str());
        let line = line.trim_end().replace('\t', " ");
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
            d.code,
            d.text
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
                out.push_str(&related.text);
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
    // By file, in the order of their names: how many, and `prettyPathForFileError`.
    let mut by_file: BTreeMap<&str, (usize, String)> = BTreeMap::new();
    for &d in &errors {
        if !d.path.is_empty() {
            by_file
                .entry(d.path.as_str())
                .or_insert_with(|| (0, format!("{}{GREY}:{}{RESET}", d.path, d.line)))
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
            if is_default_library(&d.path) {
                line.push_str(&format!("{}(--,--): ", d.path));
            } else {
                line.push_str(&format!("{}({},{}): ", d.path, d.line, d.column));
            }
        }
        line.push_str(&format!(
            "{} TS{}: {}\n",
            category_name(d.category),
            d.code,
            d.text
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
        for line in clean(&d.text).split('\n').filter(|l| !l.is_empty()) {
            new_line(out);
            out.extend_from_slice(
                format!("!!! {} TS{}: {line}", category_name(d.category), d.code).as_bytes(),
            );
        }
        for related in &d.related {
            let location = if related.path.is_empty() {
                String::new()
            } else if is_default_library(&related.path) {
                clean(&format!(" {}:--:--", related.path))
            } else {
                clean(&format!(
                    " {}:{}:{}",
                    related.path, related.line, related.column
                ))
            };
            new_line(out);
            out.extend_from_slice(
                format!("!!! related TS{}{location}: {}", related.code, related.text).as_bytes(),
            );
        }
    };
    for d in diagnostics.iter().filter(|d| d.path.is_empty()) {
        error_text(&mut out, &mut new_line, d);
    }
    for (name, content) in inputs {
        let name = clean(name);
        let errors: Vec<&Diagnostic> = diagnostics
            .iter()
            .filter(|d| !d.path.is_empty() && clean(&d.path).eq_ignore_ascii_case(&name))
            .collect();
        new_line(&mut out);
        out.extend_from_slice(format!("==== {name} ({} errors) ====", errors.len()).as_bytes());
        let starts = line_starts(content);
        let lines: Vec<&[u8]> = content.split(|&b| b == b'\n').collect();
        for (index, line) in lines.iter().enumerate() {
            let is_last = index == lines.len() - 1;
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            let this_start = starts.get(index).copied().unwrap_or(content.len()) as i64;
            let next_start = if is_last {
                content.len() as i64
            } else {
                starts.get(index + 1).copied().unwrap_or(content.len()) as i64
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
                    for c in String::from_utf8_lossy(&line[..from]).chars() {
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

/// How far what comes out is what is expected.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Level {
    /// It crashed, or took too long.
    Broken,
    /// The errors are others, or elsewhere.
    Differs,
    /// The same codes at the same places.
    Codes,
    /// And the same words.
    Words,
    /// And they reach as far: all is the same but for the related information.
    Spans,
    /// Byte for byte.
    All,
}

pub struct Outcome {
    /// `compiler/foo(target=es2015)`
    pub name: String,
    pub level: Level,
    pub note: String,
}

/// The lines before the first empty one: an error each, with the reasons below it.
fn top_of(text: &str) -> &str {
    text.find("\n\n\n").map_or(text, |end| &text[..end])
}

/// Where and what, of each error in `top`.
fn heads(top: &str) -> Vec<String> {
    let mut heads: Vec<String> = top
        .lines()
        .filter(|line| !line.starts_with(' ') && !line.is_empty())
        .filter_map(|line| {
            let at = line.find(" TS")?;
            let code_end = line[at + 3..].find(':')? + at + 3;
            Some(line[..code_end].to_owned())
        })
        .collect();
    heads.sort();
    heads
}

/// `compileFilesWithHost` compiles twice, and says so (TS-1) where writing the output has added errors: "such an error may not be reflected
/// on the command line or in the editor". Without that, what is left is what there is before anything is written.
fn without_what_emit_added(text: &str) -> String {
    if !text.contains("error TS-1: ") {
        return text.to_owned();
    }
    // All there was before is listed: nothing is the same before and after.
    if let Some((before, after)) = counts_around_emit(text)
        && before > after
        && listed_under_the_mismatch(text).len() >= before
    {
        return String::new();
    }
    let mut lines: Vec<Cow<'_, str>> = Vec::new();
    // With `pretty`, what is said of it on top goes on to the next line that is not indented.
    let (mut is_pretty, mut is_in_it_on_top, mut is_in_it) = (false, false, false);
    for line in text.split('\n') {
        if line.starts_with("error TS-1: ") {
            continue;
        }
        if line.starts_with("\u{1b}[91merror\u{1b}[0m\u{1b}[90m TS-1: ") {
            (is_pretty, is_in_it_on_top) = (true, true);
            continue;
        }
        if is_in_it_on_top && (line.is_empty() || line.starts_with(' ')) {
            continue;
        }
        is_in_it_on_top = false;
        if line.starts_with("!!! error TS-1: ") {
            is_in_it = true;
            continue;
        }
        if is_in_it && line.starts_with("!!! related ") {
            continue;
        }
        is_in_it = false;
        // `WriteErrorSummaryText` counts it.
        let counted = line
            .strip_prefix("Found ")
            .filter(|_| is_pretty)
            .and_then(|rest| rest.split_once(" errors"))
            .and_then(|(count, rest)| Some((count.parse::<usize>().ok()?, rest)));
        lines.push(match counted {
            Some((2, rest)) => Cow::Owned(
                match rest.strip_prefix(" in the same file, starting at: ") {
                    Some(place) => format!("Found 1 error in {place}"),
                    None => "Found 1 error.".to_owned(),
                },
            ),
            Some((count, rest)) if count > 2 => {
                Cow::Owned(format!("Found {} errors{rest}", count - 1))
            }
            _ => Cow::Borrowed(line),
        });
    }
    let left = lines.join("\n");
    if heads(top_of(&left)).is_empty() {
        String::new()
    } else {
        left
    }
}

/// The numbers in `Pre-emit (8) and post-emit (6) diagnostic counts do not match!`
fn counts_around_emit(text: &str) -> Option<(usize, usize)> {
    let (_, rest) = text.split_once("Pre-emit (")?;
    let (before, rest) = rest.split_once(") and post-emit (")?;
    let (after, _) = rest.split_once(')')?;
    Some((before.parse().ok()?, after.parse().ok()?))
}

/// What is listed under TS-1, each as it is written after `!!! related TS`.
fn listed_under_the_mismatch(text: &str) -> Vec<&str> {
    text.lines()
        .skip_while(|line| !line.starts_with("!!! error TS-1: "))
        .skip(1)
        .map_while(|line| line.strip_prefix("!!! related TS"))
        .filter(|listed| !listed.starts_with("-1:"))
        .collect()
}

/// `compileFilesWithHost` goes by the shorter of its two lists. Where writing the output has taken errors away, that is what there is
/// afterwards, and what there was before besides is listed under TS-1.
fn what_emit_took_away(text: &str) -> Vec<&str> {
    match counts_around_emit(text) {
        Some((before, after)) if before > after => listed_under_the_mismatch(text),
        _ => Vec::new(),
    }
}

/// `d` as it would be listed there.
fn as_listed(d: &Diagnostic, lib_dir: &str) -> String {
    let location = if d.path.is_empty() {
        String::new()
    } else if is_default_library(&d.path) {
        format!(" {}:--:--", d.path)
    } else {
        format!(" {}:{}:{}", d.path, d.line, d.column)
    };
    format!(
        "{}{}: {}",
        d.code,
        without_prefixes(&location, lib_dir),
        d.text.lines().next().unwrap_or("")
    )
}

fn without_related(text: &str) -> String {
    text.lines()
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
    /// Where the tests are.
    pub cases: &'a str,
    /// Where the `.errors.txt` are.
    pub baselines: &'a str,
    /// The names of all the baselines there are of the suite, of whatever kind.
    pub names: &'a [String],
}

pub struct Setup<'a> {
    /// Where `lib.*.d.ts` are.
    pub lib_dir: &'a str,
    /// TypeScript's `tests/lib`.
    pub test_lib: &'a str,
    pub only: Option<&'a str>,
    /// Where to write what comes out, if anywhere.
    pub out: Option<&'a str>,
    /// Where to write the type at every expression and name of every test, if anywhere: to compare with `.types` baselines.
    pub types_out: Option<&'a str>,
    pub threads: usize,
}

fn files_under(dir: &str, found: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        let path = entry.path().to_string_lossy().into_owned();
        if entry.path().is_dir() {
            files_under(&path, found);
        } else if path.ends_with(".ts") || path.ends_with(".tsx") {
            found.push(path);
        }
    }
}

/// `SkipUnsupportedCompilerOptions`
fn is_unsupported(compiler: &[(String, Json)]) -> bool {
    let get = |name: &str| compiler.iter().rev().find(|o| o.0 == name).map(|o| &o.1);
    let word = |name: &str| {
        get(name)
            .and_then(Json::as_str)
            .map(str::to_lowercase)
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
fn run_one(
    setup: &Setup,
    path: &str,
    code: &[u8],
    settings: &BTreeMap<String, String>,
    has_baselines: bool,
    types: Option<&Mutex<String>>,
) -> Option<(Report, Vec<(String, Vec<u8>)>)> {
    let Parsed { mut units, links } = units_of(code, path);
    let cwd = absolute(
        settings.get("currentdirectory").map_or("", |s| s.as_str()),
        SRC,
    );
    // What the directives say, as `compilerOptions` would.
    let mut said: Vec<(String, Json)> = Vec::new();
    for (name, value) in settings {
        if HARNESS_OPTIONS.contains(&name.as_str()) {
            continue;
        }
        match bun_sema::config_options::from_text(name, value) {
            // `getOptionValue`: what is declared `IsFilePath` is taken from the current directory.
            Some((name @ ("outDir" | "rootDir" | "declarationDir"), Json::String(path))) => {
                said.push((name.to_owned(), Json::String(absolute(&path, &cwd))))
            }
            Some((name, value)) => said.push((name.to_owned(), value)),
            None => match name.as_str() {
                "suppressoutputpathcheck" => said.push((
                    "suppressOutputPathCheck".to_owned(),
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
        (setup.lib_dir.to_owned(), setup.lib_dir.to_owned()),
        (LIB.to_owned(), setup.test_lib.to_owned()),
    ];

    // `makeUnitsFromTest`: the first `tsconfig.json` or `jsconfig.json` is the configuration, read where there are only the files of
    // the test.
    let config_at = units.iter().position(|unit| {
        let name = unit.name.replace('\\', "/");
        let name = name.rsplit('/').next().unwrap_or(&name).to_lowercase();
        name == "tsconfig.json" || name == "jsconfig.json"
    });
    let config_cwd = settings
        .get("currentdirectory")
        .filter(|s| !s.is_empty())
        .map_or(SRC.to_owned(), |dir| absolute(dir, "/"));
    let mut named_by_config: Option<Vec<String>> = None;
    let mut config_unit = None;
    if let Some(at) = config_at {
        let mut only_units = Virtual::new(true, Vec::new());
        for unit in &units {
            only_units.add_file(&absolute(&unit.name, &config_cwd), unit.content.clone());
        }
        let config_path = absolute(&units[at].name, &config_cwd);
        named_by_config =
            Some(config::load_as_typescript_does(&only_units, &config_path, Vec::new()).files);
        config_unit = Some(units.remove(at));
    }

    let (mut roots, mut others): (Vec<&Unit>, Vec<&Unit>) = (Vec::new(), Vec::new());
    match &named_by_config {
        Some(named) => {
            for unit in &units {
                if named.contains(&absolute(&unit.name, &cwd)) {
                    roots.push(unit);
                } else {
                    others.push(unit);
                }
            }
        }
        None => {
            let last = units.last().unwrap();
            let refers = |needle: &[u8]| last.content.windows(needle.len()).any(|w| w == needle);
            let has_reference = last.content.windows(14).any(|w| {
                w.starts_with(b"reference") && w[9].is_ascii_whitespace() && &w[10..] == b"path"
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

    let mut host = Virtual::new(is_case_sensitive, mounted);
    for unit in roots.iter().chain(&others) {
        host.add_file(&absolute(&unit.name, &cwd), unit.content.clone());
    }
    for (link, target) in &links {
        host.add_link(&absolute(link, &cwd), &absolute(target, &cwd));
    }
    let mut files: Vec<String> = roots
        .iter()
        .map(|unit| absolute(&unit.name, &cwd))
        .filter(|name| !name.ends_with(".json") && !name.ends_with(".tsbuildinfo"))
        .collect();
    let no_lib = said
        .iter()
        .any(|o| o.0 == "noLib" && matches!(o.1, Json::Bool(true)));
    if let Some(lib_files) = settings.get("libfiles") {
        for lib in lib_files
            .split(',')
            .map(str::trim)
            .filter(|l| !l.is_empty())
        {
            if lib == "lib.d.ts" && !no_lib {
                continue;
            }
            files.push(format!("{LIB}/{lib}"));
        }
    }

    // `CompileFiles`: what tests go by unless they say otherwise.
    let defaults = |compiler: &mut Vec<(String, Json)>| {
        if !compiler.iter().any(|o| o.0 == "skipDefaultLibCheck") {
            compiler.push(("skipDefaultLibCheck".to_owned(), Json::Bool(true)));
        }
        compiler.push(("noErrorTruncation".to_owned(), Json::Bool(true)));
    };
    let mut project: Project = match &config_unit {
        Some(unit) => {
            let config_path = absolute(&unit.name, &cwd);
            host.add_file(&config_path, unit.content.clone());
            let mut over = said.clone();
            defaults(&mut over);
            config::load_as_typescript_does(&host, &config_path, over)
        }
        None => {
            let mut compiler = said.clone();
            defaults(&mut compiler);
            config::without_config(&host, &cwd, Json::Object(compiler), files.clone())
        }
    };
    if !has_baselines && is_unsupported(&project.compiler_options_as_written) {
        return None;
    }
    project.files = files.clone();
    project.options.files = files;
    // `NewProgram` gets options and file names: there is no `ConfigFile` to explain a root file with.
    project.options.file_specs.clear();
    project.options.include_specs.clear();
    project.options.is_default_include_spec = false;
    project.options.captures_suggestions = settings
        .get("capturesuggestions")
        .is_some_and(|v| v.eq_ignore_ascii_case("true"));

    // One line per location: unit, line, offset, source text without line breaks, type.
    let write_types = |checker: &mut bun_sema::check::Checker<'_>,
                       file: bun_sema::program::FileId| {
        let Some(types) = types else { return };
        let path = checker.p.files.modules[file.idx()].path.clone();
        if is_default_library(&path) {
            return;
        }
        let text = checker.hir(file).text.clone();
        let starts = line_starts(&text);
        let unit = without_prefixes(&path, setup.lib_dir);
        // The source goes along, so that each entry of a baseline can be given its line.
        let mut lines = format!(
            "#source\t{unit}\t{}\n",
            String::from_utf8_lossy(&text)
                .replace('\\', "\\\\")
                .replace('\n', "\\n")
                .replace('\r', "\\r")
                .replace('\t', "\\t")
        );
        for found in checker.types_at_locations(file) {
            let (start, end) = (found.start as usize, (found.end as usize).min(text.len()));
            if start >= end {
                continue;
            }
            let line = starts.partition_point(|&s| s <= start) - 1;
            let source = String::from_utf8_lossy(&text[start..end]).replace(['\r', '\n'], "");
            lines.push_str(&format!(
                "{unit}\t{line}\t{start}\t{source}\t{}\t{}\n",
                found.type_text, found.kind
            ));
        }
        types.lock().unwrap().push_str(&lines);
    };
    let request = Request {
        compiler_options: &[],
        cwd: &cwd,
        project: None,
        paths: &[],
        threads: 1,
        lib_dir: Some(setup.lib_dir),
        global_node_modules: None,
        file_time_limit: std::time::Duration::from_secs(20),
        progress: None,
        only: None,
        ends_the_process: false,
        keeps_everything: false,
        stops_where_tsc_does: false,
        says_it_as_typescript_does: true,
        loaded: None,
        checked: None,
        after_file: types.is_some().then_some(
            &write_types
                as &(dyn Fn(&mut bun_sema::check::Checker<'_>, bun_sema::program::FileId) + Sync),
        ),
    };
    let report = bun_sema_driver::check_project(
        &host,
        project,
        &request,
        Report::default(),
        std::time::Instant::now(),
    );
    let inputs = config_unit
        .iter()
        .chain(roots.iter().copied())
        .chain(others.iter().copied())
        .map(|unit| (absolute(&unit.name, &cwd), unit.content.clone()))
        .collect();
    Some((report, inputs))
}

/// Runs the tests of `suite`.
pub fn run(suite: &Suite, setup: &Setup) -> Vec<Outcome> {
    let mut tests = Vec::new();
    files_under(suite.cases, &mut tests);
    // By test: the configurations there are baselines of.
    let mut configurations: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for name in suite.names {
        // The name of a test can have dots in it: what kind of baseline it is comes off the end.
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
        let (stem, configuration) = match configured.strip_suffix(')').map(|c| (c, c.rfind('('))) {
            Some((inner, Some(open))) => (&inner[..open], &inner[open + 1..]),
            _ => (configured, ""),
        };
        configurations
            .entry(stem)
            .or_default()
            .insert(configuration);
    }
    let outcomes = Mutex::new(Vec::new());
    let next = std::sync::atomic::AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..setup.threads.max(1) {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    let Some(path) = tests.get(i) else { break };
                    let base = path.rsplit('/').next().unwrap();
                    if SKIPPED.contains(&base)
                        || setup.only.is_some_and(|only| !path.contains(only))
                    {
                        continue;
                    }
                    let stem = base
                        .strip_suffix(".tsx")
                        .or_else(|| base.strip_suffix(".ts"))
                        .unwrap();
                    let code = decode(&std::fs::read(path).unwrap());
                    let settings = settings_of(&code);
                    let none = BTreeSet::from([""]);
                    let (known, has_baselines) = match configurations.get(stem) {
                        Some(known) => (known, true),
                        None => (&none, false),
                    };
                    for configuration in known {
                        let mut settings = settings.clone();
                        let varied: Vec<(&str, &str)> = configuration
                            .split(',')
                            .filter_map(|pair| pair.split_once('='))
                            .collect();
                        for (name, value) in settings.iter_mut() {
                            match varied.iter().find(|v| v.0 == name) {
                                Some(&(_, chosen)) => *value = chosen.to_owned(),
                                None => *value = the_one_value(name, value),
                            }
                        }
                        let configured = if configuration.is_empty() {
                            stem.to_owned()
                        } else {
                            format!("{stem}({configuration})")
                        };
                        let name = format!("{}/{configured}", suite.name);
                        let types = setup.types_out.map(|_| Mutex::new(String::new()));
                        let ran = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            run_one(setup, path, &code, &settings, has_baselines, types.as_ref())
                        }));
                        if let (Some(out), Some(types), Ok(Some(_))) =
                            (setup.types_out, types, &ran)
                        {
                            let dir = format!("{out}/{}", suite.name);
                            let _ = std::fs::create_dir_all(&dir);
                            let _ = std::fs::write(
                                format!("{dir}/{configured}.tsv"),
                                types.into_inner().unwrap(),
                            );
                        }
                        let outcome = match ran {
                            Err(_) => Outcome {
                                name,
                                level: Level::Broken,
                                note: "panicked".to_owned(),
                            },
                            Ok(None) => continue,
                            Ok(Some((report, _))) if !report.gave_up.is_empty() => Outcome {
                                name,
                                level: Level::Broken,
                                note: "took too long".to_owned(),
                            },
                            Ok(Some((mut report, inputs))) => {
                                let expected = std::fs::read(format!(
                                    "{}/{configured}.errors.txt",
                                    suite.baselines
                                ))
                                .map(|bytes| String::from_utf8_lossy(&bytes).replace("\r\n", "\n"))
                                .unwrap_or_default();
                                let taken_away = what_emit_took_away(&expected);
                                if !taken_away.is_empty() {
                                    report.diagnostics.retain(|d| {
                                        !taken_away.contains(&as_listed(d, setup.lib_dir).as_str())
                                    });
                                }
                                let ours = if report.diagnostics.is_empty() {
                                    String::new()
                                } else {
                                    String::from_utf8_lossy(&render(
                                        &report.diagnostics,
                                        &inputs,
                                        setup.lib_dir,
                                        settings
                                            .get("pretty")
                                            .is_some_and(|v| v.eq_ignore_ascii_case("true")),
                                    ))
                                    .into_owned()
                                };
                                let expected = without_what_emit_added(&expected);
                                let level = level_of(&ours, &expected);
                                if let Some(out) = setup.out
                                    && level != Level::All
                                {
                                    let dir = format!("{out}/{}", suite.name);
                                    let _ = std::fs::create_dir_all(&dir);
                                    let _ = std::fs::write(
                                        format!("{dir}/{configured}.errors.txt"),
                                        &ours,
                                    );
                                }
                                let note = if level == Level::Differs {
                                    let (a, b) = (heads(top_of(&ours)), heads(top_of(&expected)));
                                    let only_in = |x: &[String], y: &[String]| {
                                        x.iter()
                                            .filter(|h| !y.contains(h))
                                            .map(|h| h.rsplit(' ').next().unwrap_or(h).to_owned())
                                            .collect::<Vec<_>>()
                                            .join(",")
                                    };
                                    format!("false:{} missed:{}", only_in(&a, &b), only_in(&b, &a))
                                } else {
                                    String::new()
                                };
                                Outcome { name, level, note }
                            }
                        };
                        outcomes.lock().unwrap().push(outcome);
                    }
                }
            });
        }
    });
    let mut outcomes = outcomes.into_inner().unwrap();
    outcomes.sort_by(|a, b| a.name.cmp(&b.name));
    outcomes
}

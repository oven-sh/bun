use std::borrow::Cow;

use bun_ast::Target;
use bun_builtin_sources::{Archive, Manifest, PartSeenByEveryFile, VIRTUAL_ROOT};
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_resolve_builtins::HardcodedModule::BUN_ALIASES;
use bun_resolve_builtins::{Alias, Cfg, Module};
use bun_sema::program::HostModuleId;
use bun_sema::resolve::{HostResolution, ancestors};
use bun_sema::util::{FxHashMap, SharedSort};

use crate::builtins::{RuntimeFunction, RuntimeModule, table};
use crate::load::HOST_ROOT;
use crate::prelude;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum RuntimeFileKind {
    Module(RuntimeModule),
    Functions,
    Declarations,
    Configuration,
}

/// Every module of Bun's has an id, so the tests name this one where they need a module that only the host has.
#[cfg(test)]
pub(crate) const HOST_VALUE_MODULE: &str = "bun:only-the-host-has-it";

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum RuntimeResolution {
    Module(HostModuleId),
    HostValue,
}

struct RuntimeFile {
    kind: RuntimeFileKind,
    comes_with_module: bool,
    is_seen_only_by_name: bool,
    archive_name: Box<[u8]>,
    contents: Option<&'static [u8]>,
}

/// The files and the directories.
type DirectoryEntries = (Vec<Vec<u8>>, Vec<Vec<u8>>);

pub(crate) struct RuntimeModules {
    archive: &'static Archive,
    omits_builtin_modules: bool,
    answers_modules_of_own_tests: bool,
    aliases: Cfg,
    files: FxHashMap<Vec<u8>, RuntimeFile>,
    /// In ascending order. The position of a path is the number of its file.
    paths: Vec<Vec<u8>>,
    directories: FxHashMap<Vec<u8>, DirectoryEntries>,
    public_specifiers: Vec<(HostModuleId, &'static [u8])>,
}

const PACKAGE_JSON: &[u8] = br#"{"name":"bun-runtime-modules"}"#;

const DECLARATION_FILES: [&[u8]; 2] = [b"builtins.d.ts", b"private.d.ts"];

impl RuntimeModules {
    pub(crate) fn new(archive: &'static Archive, omits_builtin_modules: bool) -> RuntimeModules {
        let files = collect_files(archive);
        let mut paths: Vec<Vec<u8>> = files.keys().cloned().collect();
        paths.shared_sort_unstable();
        RuntimeModules {
            archive,
            paths,
            omits_builtin_modules,
            answers_modules_of_own_tests: runs_own_tests(),
            aliases: Cfg::default(),
            directories: collect_directories(&files),
            files,
            public_specifiers: match omits_builtin_modules {
                true => Vec::new(),
                false => collect_public_specifiers(archive.manifest()),
            },
        }
    }

    pub(crate) fn with_test_aliases(mut self, runs_tests: bool) -> RuntimeModules {
        self.aliases.rewrite_jest_for_tests = runs_tests;
        let aliases = self.aliases;
        self.public_specifiers
            .retain(|&(_, specifier)| !(runs_tests && wraps_entry_point(specifier, aliases)));
        self
    }

    #[cfg(test)]
    pub(crate) fn with_replaced_sources(
        mut self,
        sources: &[(Vec<u8>, Vec<u8>)],
    ) -> RuntimeModules {
        for (path, text) in sources {
            if let Some(file) = self.files.get_mut(path) {
                let text: &'static [u8] = text.clone().leak();
                file.contents = Some(text);
                file.is_seen_only_by_name = false;
            }
        }
        self
    }

    pub(crate) fn file_kind(&self, path: &[u8]) -> Option<RuntimeFileKind> {
        self.files.get(path).map(|file| file.kind)
    }

    pub(crate) fn file_count(&self) -> usize {
        self.paths.len()
    }

    pub(crate) fn number_of(&self, path: &[u8]) -> Option<u32> {
        let found = self.paths.binary_search_by(|it| (**it).cmp(path));
        found.ok().map(|number| number as u32)
    }

    pub(crate) fn path_of(&self, number: u32) -> &[u8] {
        &self.paths[number as usize]
    }

    /// Whether only the files that name the file at `path` see what it declares.
    pub(crate) fn is_seen_only_by_name(&self, path: &[u8]) -> bool {
        (self.files.get(path)).is_some_and(|file| file.is_seen_only_by_name)
    }

    pub(crate) fn is_directory(&self, path: &[u8]) -> bool {
        self.directories.contains_key(path)
    }

    pub(crate) fn entries(&self, path: &[u8]) -> Option<DirectoryEntries> {
        self.directories.get(path).cloned()
    }

    pub(crate) fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        let file = self.files.get(path)?;
        match file.contents {
            Some(contents) => Some(Cow::Borrowed(contents)),
            None => Archive::read(&file.archive_name).map(Cow::Owned),
        }
    }

    fn part_seen_by_every_file(&self, path: &[u8]) -> Option<&'static PartSeenByEveryFile> {
        let file = self.files.get(path).filter(|it| it.contents.is_none())?;
        let manifest = self.archive.manifest();
        manifest.part_seen_by_every_file(&file.archive_name)
    }

    /// Whether a file that does not name the file at `path` sees only a part of it.
    pub(crate) fn is_seen_in_part(&self, path: &[u8]) -> bool {
        self.part_seen_by_every_file(path).is_some()
    }

    pub(crate) fn read_part_seen_by_every_file(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        let part = self.part_seen_by_every_file(path)?;
        let mut text = self.read(path)?.into_owned();
        let mut kept: Vec<(u32, u32)> = part.seen.iter().chain(&part.asked).copied().collect();
        kept.push((text.len() as u32, 0));
        kept.sort_unstable();
        let mut blank_from = 0;
        for (start, end) in kept {
            leave_blank(&mut text[blank_from..start as usize]);
            blank_from = end as usize;
        }
        Some(Cow::Owned(text))
    }

    pub(crate) fn is_seen_by_every_file(&self, path: &[u8], position: u32) -> bool {
        let Some(part) = self.part_seen_by_every_file(path) else {
            return true;
        };
        let after = part.seen.partition_point(|it| it.0 <= position);
        after > 0 && position < part.seen[after - 1].1
    }

    pub(crate) fn resolve_module(
        &self,
        specifier: &[u8],
        importer: &[u8],
    ) -> Option<RuntimeResolution> {
        #[cfg(test)]
        if specifier == HOST_VALUE_MODULE.as_bytes() {
            return Some(RuntimeResolution::HostValue);
        }
        let manifest = self.archive.manifest();
        let internal_module = self
            .files
            .get(importer)
            .and_then(|file| manifest.resolve(specifier, &file.archive_name));
        let resolution = match internal_module {
            Some(id) => RuntimeResolution::Module(HostModuleId(id)),
            None if self.refuses(specifier, importer) => return None,
            None => resolve_alias(manifest, specifier, self.aliases)?,
        };
        Some(match resolution {
            RuntimeResolution::Module(_) if self.omits_builtin_modules => {
                RuntimeResolution::HostValue
            }
            // A test run has no entry point, so `bun test` has no such module, and says so to whoever asks for it.
            RuntimeResolution::Module(_)
                if self.aliases.rewrite_jest_for_tests
                    && wraps_entry_point(specifier, self.aliases) =>
            {
                RuntimeResolution::HostValue
            }
            RuntimeResolution::Module(_) | RuntimeResolution::HostValue => resolution,
        })
    }

    fn refuses(&self, specifier: &[u8], importer: &[u8]) -> bool {
        !self.answers_modules_of_own_tests
            && !self.files.contains_key(importer)
            && is_module_of_own_tests(specifier, self.aliases)
    }

    /// Every name under which a program imports a module of Bun's own.
    pub(crate) fn specifiers(&self) -> Vec<Vec<u8>> {
        let aliases = BUN_ALIASES.iter().copied().flatten();
        let specifiers = aliases.map(|&(specifier, _)| specifier);
        let provided = specifiers.filter(|specifier| self.resolve_module(specifier, b"").is_some());
        provided.map(<[u8]>::to_vec).collect()
    }

    #[cfg(test)]
    pub(crate) fn public_specifiers(&self) -> impl Iterator<Item = &'static [u8]> + '_ {
        self.public_specifiers
            .iter()
            .map(|&(_, specifier)| specifier)
    }

    /// `process.getBuiltinModule` answers with the modules of the registry, and none of those is an ES module.
    pub(crate) fn answers_get_builtin_module(&self, specifier: &[u8]) -> bool {
        match self.resolve_module(specifier, b"") {
            Some(RuntimeResolution::Module(id)) => {
                RuntimeModule::from_registry_id(id.0).is_some_and(|it| !table::is_es_module(it))
            }
            Some(RuntimeResolution::HostValue) => true,
            None => false,
        }
    }

    pub(crate) fn find_modules(&self, prefix: &[u8], suffix: &[u8]) -> Vec<HostModuleId> {
        let matches = self.public_specifiers.iter().filter(|(_, specifier)| {
            specifier.len() >= prefix.len() + suffix.len()
                && specifier.starts_with(prefix)
                && specifier.ends_with(suffix)
        });
        let mut modules: Vec<HostModuleId> = matches.map(|&(module, _)| module).collect();
        modules.dedup();
        modules
    }

    pub(crate) fn module_resolution(&self, id: HostModuleId) -> HostResolution {
        match self.source_path(id.0) {
            Some(path) => HostResolution::ModuleSource {
                module: id,
                path: path.to_vec(),
            },
            None => HostResolution::Module(id),
        }
    }

    pub(crate) fn module_path(&self, module: RuntimeModule) -> Option<&[u8]> {
        self.source_path(module.registry_id())
    }

    pub(crate) fn function_file_path(&self, function: RuntimeFunction) -> Option<Vec<u8>> {
        match self.archive.manifest().function_file(function.0) {
            Some(_) if self.omits_builtin_modules => None,
            Some(archive_name) => Some(virtual_path(archive_name)),
            None => {
                let file = table::runtime_function(function)?.file;
                let path = virtual_path(&[file.as_bytes(), b".ts"].concat());
                self.files.contains_key(&path).then_some(path)
            }
        }
    }

    pub(crate) fn declaration_paths(&self) -> [Vec<u8>; 2] {
        DECLARATION_FILES.map(virtual_path)
    }

    /// The file that says what `require` answers for the module at `path`.
    pub(crate) fn declarations_of_module(&self, path: &[u8]) -> Option<Vec<u8>> {
        let extension_start = bun_core::strings::last_index_of_char(path, b'.')?;
        let declarations = [&path[..extension_start], b".listed.d.ts"].concat();
        let kind = self.file_kind(&declarations)?;
        (kind == RuntimeFileKind::Declarations).then_some(declarations)
    }

    pub(crate) fn prelude_paths(&self) -> impl Iterator<Item = Vec<u8>> {
        prelude::FILES
            .iter()
            .map(|(name, _)| virtual_path(&prelude_archive_name(name)))
    }

    pub(crate) fn function_files_without_ids(&self) -> impl Iterator<Item = Vec<u8>> + '_ {
        let files = match self.omits_builtin_modules {
            true => None,
            false => Some(self.archive.manifest().function_files_without_ids()),
        };
        files.into_iter().flatten().map(virtual_path)
    }

    fn source_path(&self, registry_id: u32) -> Option<&'static [u8]> {
        if self.omits_builtin_modules {
            return None;
        }
        self.archive.path(registry_id)
    }
}

fn virtual_path(archive_name: &[u8]) -> Vec<u8> {
    [VIRTUAL_ROOT, archive_name].concat()
}

fn prelude_archive_name(name: &str) -> Vec<u8> {
    [&b"prelude/"[..], name.as_bytes()].concat()
}

// As `bun run` decides it: `load_env` in src/jsc/VirtualMachine.rs.
fn runs_own_tests() -> bool {
    cfg!(test)
        || bun_core::env::IS_DEBUG
        || (bun_core::getenv_z(bun_core::zstr!("BUN_GARBAGE_COLLECTOR_LEVEL")).is_some()
            && bun_core::getenv_z(bun_core::zstr!("BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING"))
                .is_some())
}

// The module whose one import is the entry point of `bun run`.
fn wraps_entry_point(specifier: &[u8], aliases: Cfg) -> bool {
    let alias = Alias::get(specifier, Target::Bun, aliases);
    alias.is_some_and(|alias| {
        matches!(
            Module::MAP.get(alias.path.as_bytes()),
            Some(Module::BunMain)
        )
    })
}

// The names that `bun run` answers to Bun's own tests alone: `fetch_builtin_module` in src/runtime/jsc_hooks.rs.
fn is_module_of_own_tests(specifier: &[u8], aliases: Cfg) -> bool {
    let Some(alias) = Alias::get(specifier, Target::Bun, aliases) else {
        return false;
    };
    matches!(
        Module::MAP.get(alias.path.as_bytes()),
        Some(
            Module::BunInternalForTesting
                | Module::InternalClusterRoundRobinHandle
                | Module::NodeInternalRepl
                | Module::NodeInternalReplAwait
                | Module::NodeInternalReplHistory
                | Module::NodeInternalUtilInspect
                | Module::InternalTestBinding
        )
    )
}

/// The specifiers of those of Bun's own modules that are written in JavaScript and that a program can load.
pub(crate) fn library_modules_that_programs_load() -> Vec<&'static [u8]> {
    let written_for_programs = table::ModuleFlags::HAS_SOURCE | table::ModuleFlags::IS_PUBLIC;
    let all = RuntimeModule::ALL.into_iter().map(table::module_data);
    all.filter(|data| data.flags.contains(written_for_programs))
        .map(|data| data.specifier.as_bytes())
        .filter(|specifier| {
            Alias::has(specifier, Target::Bun, Cfg::default())
                && (runs_own_tests() || !is_module_of_own_tests(specifier, Cfg::default()))
        })
        .collect()
}

/// The text of a file with what stands in a comment, or between two single or double quotes on one line, made blank, byte for byte. What is left is code.
/// A template stays: it holds code.
fn blank_comments_and_strings(text: &[u8]) -> Vec<u8> {
    let mut code = text.to_vec();
    let mut at = 0;
    while at < text.len() {
        let rest = &text[at..];
        let (blank, length) = match rest {
            // In a regular expression: `/\/*$/`.
            [b'\\', ..] => (0..0, 2),
            [b'/', b'/', ..] => {
                let length = strings::index_of_char_usize(rest, b'\n');
                let length = length.unwrap_or(rest.len());
                (0..length, length)
            }
            [b'/', b'*', ..] => match strings::index_of(&rest[2..], b"*/") {
                Some(end) => (0..end + 4, end + 4),
                None => (0..0, 1),
            },
            [quote @ (b'"' | b'\''), ..] => {
                let mut end = 1;
                while end < rest.len() && rest[end] != *quote && rest[end] != b'\n' {
                    end += if rest[end] == b'\\' { 2 } else { 1 };
                }
                let end = end.min(rest.len());
                (1..end, end + 1)
            }
            _ => (0..0, 1),
        };
        code[at + blank.start..at + blank.end].fill(b' ');
        at += length;
    }
    code
}

/// Those of `library_modules_that_programs_load` whose names stand between quotes in the text of a file, wherever that is. None: the file evaluates text,
/// or loads code under a name that it does not spell, which may be the name of any module.
pub(crate) fn library_modules_spelled_in(text: &[u8]) -> Option<Vec<&'static [u8]>> {
    let code = &blank_comments_and_strings(text)[..];
    let is_part_of_name = |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$');
    let skip_space = |at: usize| code.len() - code[at..].trim_ascii_start().len();
    // What stands between two of the quote at `at` on one line, and where the text goes on.
    let read_string = |at: usize| {
        let (quote, rest) = text[at..].split_first()?;
        let end = rest
            .iter()
            .position(|byte| byte == quote || *byte == b'\n')?;
        (matches!(quote, b'"' | b'\'' | b'`') && rest[end] == *quote)
            .then(|| (&rest[..end], at + end + 2))
    };
    // Where the code goes on behind each place at which the word stands alone.
    let behind_each = |word: &'static [u8]| {
        let mut at = 0;
        std::iter::from_fn(move || {
            loop {
                let start = at + strings::index_of(&code[at..], word)?;
                at = start + word.len();
                if !(start > 0 && is_part_of_name(code[start - 1]))
                    && !code.get(at).is_some_and(|&byte| is_part_of_name(byte))
                {
                    return Some(skip_space(at));
                }
            }
        })
    };
    if strings::contains(code, b"createRequire")
        || strings::contains(code, b"_load")
        || behind_each(b"eval").next().is_some()
        || behind_each(b"Function").any(|next| code.get(next) == Some(&b'('))
    {
        return None;
    }
    // No module of Bun's own code has a name that begins so, however the name goes on. A package maps a name behind "#" to any.
    let begins_as_no_module = |name: &[u8]| {
        let fixed = strings::index_of(name, b"${").map_or(name, |end| &name[..end]);
        let mut spellings = BUN_ALIASES.iter().copied().flatten();
        !fixed.is_empty()
            && !fixed.starts_with(b"#")
            && !fixed.starts_with(b"bun:")
            && !b"bun:".starts_with(fixed)
            && !strings::contains_char(fixed, b'\\')
            && !spellings.any(|(spelling, _)| spelling.starts_with(fixed))
    };
    let begins_with_path_of_this_file = |at: usize| {
        let paths: [&[u8]; 7] = [
            b"import.meta.path",
            b"import.meta.url",
            b"import.meta.filename",
            b"import.meta.dirname",
            b"import.meta.dir",
            b"__filename",
            b"__dirname",
        ];
        paths.into_iter().any(|it| {
            code[at..].starts_with(it)
                && !code
                    .get(at + it.len())
                    .is_some_and(|&byte| is_part_of_name(byte))
        })
    };
    let loaders: [&'static [u8]; 5] = [
        b"import",
        b"require",
        b"getBuiltinModule",
        b"requireActual",
        b"importActual",
    ];
    for word in loaders {
        for next in behind_each(word) {
            let loads_what_is_spelled = match code.get(next) {
                Some(b'(') => {
                    let argument = skip_space(next + 1);
                    begins_with_path_of_this_file(argument)
                        || read_string(argument).is_some_and(|(name, end)| {
                            begins_as_no_module(name)
                                || (!strings::contains(name, b"${")
                                    && matches!(code.get(skip_space(end)), Some(b')' | b',')))
                        })
                }
                // A statement.
                _ if word == b"import" => true,
                Some(b'.') if word == b"require" => {
                    let member = &code[skip_space(next + 1)..];
                    let length = member
                        .iter()
                        .take_while(|&&byte| is_part_of_name(byte))
                        .count();
                    matches!(
                        &member[..length],
                        b"resolve" | b"cache" | b"main" | b"extensions"
                    )
                }
                _ => false,
            };
            if !loads_what_is_spelled {
                return None;
            }
        }
    }
    let written_for_programs = table::ModuleFlags::HAS_SOURCE | table::ModuleFlags::IS_PUBLIC;
    let strings = (0..text.len()).filter_map(read_string);
    let modules =
        strings.filter_map(|(name, _)| Some(table::module_data(find_module_named(name)?)));
    let modules = modules.filter(|data| data.flags.contains(written_for_programs));
    let modules: Vec<&'static [u8]> = modules.map(|data| data.specifier.as_bytes()).collect();
    (!modules.contains(&&b"node:vm"[..])).then_some(modules)
}

/// The built-ins for which native code loads a module of Bun's own code, as a program spells them: `Bun.sql`, `process.stdin`. Those that a program reaches from a global by names alone.
pub(crate) fn builtins_that_load_library_modules() -> Vec<String> {
    let is_name = |part: &[u8]| {
        !part.is_empty()
            && part
                .iter()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$'))
    };
    let all = table::BuiltinId::ALL.into_iter();
    all.filter(|&id| !table::entry(id).loads().is_empty())
        .filter(|&id| {
            table::global(table::entry(table::root_of(id)).name) == Some(table::root_of(id))
        })
        .map(table::text_of)
        .filter(|text| {
            let text = text.as_bytes();
            strings::contains_char(text, b'.') && strings::split(text, b".").all(is_name)
        })
        .collect()
}

/// Those of `builtins_that_load_library_modules` whose last name stands in the text of a file, wherever that is. None: the file does something else with the
/// object that has one of them, or with the global object, than to read a member by its name, so it may read any.
pub(crate) fn builtins_that_load_library_modules_spelled_in(text: &[u8]) -> Option<Vec<String>> {
    let code = &blank_comments_and_strings(text)[..];
    let is_part_of_name = |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$');
    // What follows each place at which the word stands alone.
    let behind_each = |text: &'_ [u8], word: &[u8]| {
        let mut found = Vec::new();
        let mut at = 0;
        while let Some(start) = strings::index_of(&text[at..], word).map(|it| at + it) {
            at = start + word.len();
            if !(start > 0 && is_part_of_name(text[start - 1]))
                && !text.get(at).is_some_and(|&byte| is_part_of_name(byte))
            {
                found.push(at);
            }
        }
        found
    };
    let all = builtins_that_load_library_modules();
    let mut objects: Vec<&[u8]> = vec![b"globalThis", b"global", b"self"];
    objects.extend(
        all.iter()
            .filter_map(|it| Some(strings::split_once_char(it.as_bytes(), b'.')?.0)),
    );
    objects.sort_unstable();
    objects.dedup();
    let reads_a_member_by_name = |object: &[u8], at: usize| {
        let mut rest = code[at..].trim_ascii_start();
        // `(process as any).name`, in parentheses of its own: those of a call hand the object on.
        if let Some(cast) = rest.strip_prefix(b"as ") {
            let before = code[..at - object.len()].trim_ascii_end();
            let Some(before) = before.strip_suffix(b"(").map(<[u8]>::trim_ascii_end) else {
                return false;
            };
            let is_called = |byte: u8| is_part_of_name(byte) || matches!(byte, b')' | b']');
            let end = strings::index_of_char_usize(cast, b')');
            let Some(end) = end.filter(|&end| !strings::contains_char(&cast[..end], b'(')) else {
                return false;
            };
            if before.last().is_some_and(|&byte| is_called(byte)) {
                return false;
            }
            rest = cast[end + 1..].trim_ascii_start();
        }
        let rest = rest.strip_prefix(b"!").unwrap_or(rest);
        let rest = rest.strip_prefix(b"?").unwrap_or(rest);
        let member = rest.strip_prefix(b".").map(<[u8]>::trim_ascii_start);
        member.is_some_and(|it| it.first().is_some_and(|&byte| is_part_of_name(byte)))
    };
    // A module that is one of the objects under a name of the file's own.
    let is_between_quotes = |at: usize, length: usize| {
        let quote = (at > length).then(|| text[at - length - 1]);
        quote.is_some_and(|it| matches!(it, b'"' | b'\'' | b'`') && text.get(at) == Some(&it))
    };
    let modules: [&[u8]; 5] = [
        b"bun",
        b"process",
        b"node:process",
        b"console",
        b"node:console",
    ];
    if modules.into_iter().any(|it| {
        behind_each(text, it)
            .into_iter()
            .any(|at| is_between_quotes(at, it.len()))
    }) || !(objects.into_iter()).all(|it| {
        behind_each(code, it)
            .into_iter()
            .all(|at| reads_a_member_by_name(it, at))
    }) {
        return None;
    }
    let is_spelled = |it: &String| {
        let name = it.as_bytes();
        let last = strings::rsplit_once_char(name, b'.').map_or(name, |(_, last)| last);
        !behind_each(text, last).is_empty()
    };
    Some(all.into_iter().filter(is_spelled).collect())
}

/// The module of Bun that a program means with a specifier, however it spells it: "node:crypto", "crypto", "sys".
pub(crate) fn find_module_named(specifier: &[u8]) -> Option<RuntimeModule> {
    let specifier = Alias::bun_prefixed_builtin(specifier).unwrap_or(specifier);
    let alias = Alias::get(specifier, Target::Bun, Cfg::default())?;
    table::module_by_specifier(alias.path.as_bytes())
}

fn resolve_alias(manifest: &Manifest, specifier: &[u8], aliases: Cfg) -> Option<RuntimeResolution> {
    let specifier = Alias::bun_prefixed_builtin(specifier).unwrap_or(specifier);
    let alias = Alias::get(specifier, Target::Bun, aliases)?;
    Some(match manifest.module_by_specifier(alias.path.as_bytes()) {
        Some(id) => RuntimeResolution::Module(HostModuleId(id)),
        None => RuntimeResolution::HostValue,
    })
}

// Some names are there for Bun's own tests alone. An executable answers none of them.
fn is_public(module: HostModuleId) -> bool {
    let module = RuntimeModule::from_registry_id(module.0);
    module.is_some_and(|it| {
        table::module_data(it)
            .flags
            .contains(table::ModuleFlags::IS_PUBLIC)
    })
}

fn collect_public_specifiers(manifest: &Manifest) -> Vec<(HostModuleId, &'static [u8])> {
    let mut specifiers = Vec::new();
    for &(specifier, _) in BUN_ALIASES.iter().copied().flatten() {
        match resolve_alias(manifest, specifier, Cfg::default()) {
            Some(RuntimeResolution::Module(module)) if is_public(module) => {
                specifiers.push((module, specifier));
            }
            Some(RuntimeResolution::Module(_) | RuntimeResolution::HostValue) | None => {}
        }
    }
    specifiers.shared_sort_unstable();
    specifiers
}

/// Every line stays as long as it is, so what follows stands where it stood.
fn leave_blank(text: &mut [u8]) {
    let mut rest = &mut *text;
    while let Some(line_end) = strings::index_of_char_usize(rest, b'\n') {
        rest[..line_end].fill(b' ');
        rest = &mut rest[line_end + 1..];
    }
    rest.fill(b' ');
    let (open, close) = (
        strings::index_of(text, b"  "),
        strings::last_index_of(text, b"  "),
    );
    if let (Some(open), Some(close)) = (open, close)
        && open + 2 <= close
    {
        text[open..open + 2].copy_from_slice(b"/*");
        text[close..close + 2].copy_from_slice(b"*/");
    }
}

fn collect_files(archive: &'static Archive) -> FxHashMap<Vec<u8>, RuntimeFile> {
    let manifest = archive.manifest();
    let mut files = FxHashMap::default();
    let mut add = |archive_name: &[u8], kind, contents: Option<&'static [u8]>| {
        let is_code = match kind {
            RuntimeFileKind::Module(_) | RuntimeFileKind::Functions => true,
            RuntimeFileKind::Declarations | RuntimeFileKind::Configuration => false,
        };
        let file = RuntimeFile {
            kind,
            comes_with_module: false,
            is_seen_only_by_name: is_code
                && contents.is_none()
                && !manifest.declares_for_every_file(archive_name),
            archive_name: archive_name.into(),
            contents,
        };
        let replaced = files.insert(virtual_path(archive_name), file);
        debug_assert!(replaced.is_none());
    };
    for module in manifest.modules() {
        let Some(archive_name) = &module.path else {
            continue;
        };
        let runtime_module = RuntimeModule::from_registry_id(module.id)
            .expect("the archive and the built-ins table must come from the same build");
        add(archive_name, RuntimeFileKind::Module(runtime_module), None);
    }
    for file in manifest.function_files() {
        add(file, RuntimeFileKind::Functions, None);
    }
    for name in DECLARATION_FILES {
        add(name, RuntimeFileKind::Declarations, None);
    }
    let configuration = RuntimeFileKind::Configuration;
    add(b"tsconfig.json", configuration, None);
    add(b"package.json", configuration, Some(PACKAGE_JSON));
    for &(name, text) in prelude::FILES {
        let name = prelude_archive_name(name);
        add(&name, RuntimeFileKind::Functions, Some(text.as_bytes()));
    }
    for name in manifest.module_declarations() {
        let file = RuntimeFile {
            kind: RuntimeFileKind::Declarations,
            comes_with_module: true,
            is_seen_only_by_name: false,
            archive_name: name.clone(),
            contents: None,
        };
        files.insert(virtual_path(name), file);
    }
    files
}

fn collect_directories(
    files: &FxHashMap<Vec<u8>, RuntimeFile>,
) -> FxHashMap<Vec<u8>, DirectoryEntries> {
    let top_directory = HOST_ROOT.strip_suffix(b"/").unwrap_or(HOST_ROOT);
    let mut directories: FxHashMap<Vec<u8>, DirectoryEntries> = FxHashMap::default();
    // The project is every file that a directory lists. What says something of one module comes with that module.
    let listed = files.iter().filter(|(_, file)| !file.comes_with_module);
    for path in listed.map(|(path, _)| path) {
        debug_assert!(path.starts_with(HOST_ROOT));
        let mut child: &[u8] = path;
        let mut is_child_file = true;
        for directory in ancestors(dirname::<Posix>(path)) {
            let is_listed = directories.contains_key(directory);
            let entries = directories.entry(directory.to_vec()).or_default();
            let names = match is_child_file {
                true => &mut entries.0,
                false => &mut entries.1,
            };
            names.push(child[directory.len() + 1..].to_vec());
            if is_listed || directory == top_directory {
                break;
            }
            child = directory;
            is_child_file = false;
        }
    }
    for entries in directories.values_mut() {
        entries.0.shared_sort_unstable();
        entries.1.shared_sort_unstable();
    }
    directories
}

#[cfg(test)]
mod tests {
    use bstr::{BStr, ByteSlice};
    use bun_sema::atom::Interner;
    use bun_sema::hir_from_data::DataValue;
    use bun_sema::session::Session;

    use super::*;
    use crate::builtins::table::STARTUP_FUNCTIONS;
    use crate::load::data_modules::parse_json;

    const HOST_VALUE: Option<RuntimeResolution> = Some(RuntimeResolution::HostValue);

    #[test]
    fn built_ins_that_load_modules_are_spelled_as_programs_spell_them() {
        let spelled = builtins_that_load_library_modules();
        for text in ["Bun.sql", "process.stdin", "Bun.spawn"] {
            assert!(spelled.iter().any(|it| it == text), "{text}");
        }
        let is_no_name = |byte: u8| matches!(byte, b':' | b'%' | b'[');
        assert!(spelled.iter().all(|it| !it.bytes().any(is_no_name)));
    }

    #[test]
    fn a_module_is_found_however_a_program_spells_it() {
        for (spelled, path) in [
            (&b"crypto"[..], &b"node:crypto"[..]),
            (b"node:crypto", b"node:crypto"),
            (b"fs", b"node:fs"),
            (b"sys", b"node:util"),
            (b"bun:sqlite", b"bun:sqlite"),
        ] {
            let found = find_module_named(spelled).map(table::specifier_of);
            assert_eq!(found.map(BStr::new), Some(BStr::new(path)));
        }
        for spelled in [&b"./crypto"[..], b"crypto/", b"no-such-module"] {
            assert_eq!(find_module_named(spelled), None, "{}", BStr::new(spelled));
        }
    }

    #[test]
    fn programs_load_the_public_modules_that_have_source() {
        let names = library_modules_that_programs_load();
        for name in [
            &b"node:http"[..],
            b"node:worker_threads",
            b"bun:sqlite",
            b"ws",
        ] {
            assert!(names.contains(&name), "{}", BStr::new(name));
        }
        // Native code, a module for Bun's own code alone, a module behind a flag.
        for name in [
            &b"node:buffer"[..],
            b"internal/validators",
            b"node:zlib/iter",
        ] {
            assert!(!names.contains(&name), "{}", BStr::new(name));
        }
    }

    #[test]
    fn a_text_spells_the_library_modules_that_it_loads_or_may_load_any() {
        let spelled = |text: &str| {
            let modules = library_modules_spelled_in(text.as_bytes())?;
            Some(modules.into_iter().map(BStr::new).collect::<Vec<_>>())
        };
        assert_eq!(spelled("const a = [1, 'two', \"./three\"];"), Some(vec![]));
        assert_eq!(
            spelled(
                "import { a } from \"node:http\";\nrequire('zlib'); await import(`crypto`, {}); export * from 'ws';"
            ),
            Some(vec![
                BStr::new("node:http"),
                BStr::new("node:zlib"),
                BStr::new("node:crypto"),
                BStr::new("ws"),
            ])
        );
        assert_eq!(
            spelled("new Worker('require(\"node:worker_threads\")'); mock.module(\"os\", f);"),
            Some(vec![BStr::new("node:worker_threads"), BStr::new("node:os")])
        );
        assert_eq!(
            spelled("import(/* webpackIgnore */ 'fs') // 'dns'"),
            Some(vec![BStr::new("node:fs"), BStr::new("node:dns")])
        );
        // Native code, and a module for Bun's own code alone.
        assert_eq!(
            spelled("import 'node:buffer'; 'internal/validators';"),
            Some(vec![])
        );
        for text in [
            "require.resolve(name)",
            "delete require.cache[name]",
            "require.main === module",
            "requires(name); required(name); reimport(name); it.imports(name)",
            "import.meta.url",
            "process.getBuiltinModule('fs')",
            "jest.requireActual('fs'); vi.importActual(\"fs\")",
            "evaluate(text); isFunction(f); Function.prototype.toString.call(f); f instanceof Function",
            "import('./pages/' + name)",
            "require(`../${name}.js`)",
            "import('/opt/' + name)",
            "import('file://' + path)",
            "import(`specs/build/${name}.js`)",
            "import('@/pages/' + name)",
            "require('~/' + name)",
            "import('node:zz' + name)",
            "require(import.meta.path)",
            "import(import.meta.dir + name)",
            "require(__dirname + '/' + name)",
            "test('they require a password', f);",
            "log(\"require\", \"import()\", \"eval(text)\", 'it\\'s require');",
            "// we require that\nf();",
            "/* require(name)\n * eval(text) */ f();",
        ] {
            assert!(spelled(text).is_some(), "{text}");
        }
        for text in [
            "require(name)",
            "import(name)",
            "import('node:' + name)",
            "require('node:' + name)",
            "import(`node:${name}`)",
            "import(`${name}`)",
            "import('' + name)",
            "import('s' + name)",
            "import('fs/' + name)",
            "import('b' + name)",
            "import('bun:' + name)",
            "import('bun:f' + name)",
            "import('#internal/' + name)",
            "import('\\x66' + name)",
            "import(name + './x')",
            "import(import.meta.directory)",
            "const load = require;",
            "[require].map(load => load(name))",
            "typeof require !== 'undefined' ? require : fail",
            "require.call(null, name)",
            "module.require(name)",
            "import.meta.require(name)",
            "process.getBuiltinModule(name)",
            "const { getBuiltinModule } = process;",
            "jest.requireActual(name)",
            "vi.importActual(name)",
            "createRequire(import.meta.url)",
            "Module._load(name)",
            "eval(text)",
            "(0, eval)(text)",
            "new Function(text)",
            "Function ('return 1')",
            "import vm from 'node:vm';",
            "require(\"vm\")",
            "`${require(name)}`",
            "'a'; require(name); 'b'",
            "// a comment\nrequire(name)",
            "/* a comment */ require(name)",
            "path.replace(/\\/*$/, ''); require(name); /* a comment */",
            "/https?:\\/\\//.test(url) && require(name)",
            "it's\nrequire(name)",
        ] {
            assert_eq!(spelled(text), None, "{text}");
        }
    }

    #[test]
    fn a_text_spells_the_built_ins_that_load_modules_or_may_read_any() {
        let spelled = |text: &str| builtins_that_load_library_modules_spelled_in(text.as_bytes());
        let some = |names: &[&str]| Some(names.iter().map(|it| it.to_string()).collect::<Vec<_>>());
        assert_eq!(
            spelled("console.log(process.env.HOME, Bun.version, globalThis.x);"),
            some(&[])
        );
        assert_eq!(
            spelled("import { test } from 'bun:test'; self.x = 1;"),
            some(&[])
        );
        assert_eq!(
            spelled("test('the process ends', f); // typeof process"),
            some(&[])
        );
        for text in [
            "(globalThis as any).x = 2;",
            "a + (process as unknown as Thing).env.X",
            "[( globalThis as any )?.x, process!.env]",
        ] {
            assert_eq!(spelled(text), some(&[]), "{text}");
        }
        assert_eq!(
            spelled("process.stdin.on('data', f); Bun?.spawn(['ls']);"),
            some(&["Bun.spawn", "process.stdin"])
        );
        assert_eq!(spelled("globalThis['pro' + 'cess'];"), None);
        for text in [
            "read(globalThis.process . nextTick)",
            "const name = 'sql';",
            "// it writes to stderr",
        ] {
            assert_eq!(spelled(text).map(|it| it.len()), Some(1), "{text}");
        }
        for text in [
            "process[name]",
            "const { [name]: read } = process;",
            "({ ...process })",
            "typeof process",
            "Object.values(Bun)",
            "inspect(console)",
            "import process from 'node:process';",
            "import { stdout } from 'node:process';",
            "require(\"process\")[name]",
            "import held from 'node:console';",
            "require(\"console\")._stdout",
            "global[name]",
            "self[name]",
            "const self = this;",
            "import * as all from 'bun';",
            "require(\"bun\")[name]",
            "for (const name in globalThis) read(name);",
            "`${process[name]}`",
            "(globalThis as any)[name]",
            "read(globalThis as any).x",
            "list[0](process as any).x",
            "read((process as any))",
            "(process as Pick<Thing, keyof (typeof it)>).env",
            "globalThis as any",
        ] {
            assert_eq!(spelled(text), None, "{text}");
        }
    }

    fn runtime_modules() -> RuntimeModules {
        RuntimeModules::new(Archive::embedded(), false)
    }

    fn host_module_id(module: RuntimeModule) -> HostModuleId {
        HostModuleId(module.registry_id())
    }

    fn source_path(runtime: &RuntimeModules, resolution: Option<RuntimeResolution>) -> Vec<u8> {
        let Some(RuntimeResolution::Module(id)) = resolution else {
            panic!("expected a module, got {resolution:?}");
        };
        match runtime.module_resolution(id) {
            HostResolution::ModuleSource { module, path } if module == id => path,
            other => panic!("expected the source of {id:?}, got {other:?}"),
        }
    }

    #[test]
    fn alias_and_specifier_resolve_to_one_module() {
        let runtime = runtime_modules();
        let resolution = runtime.resolve_module(b"fs", b"");
        assert_eq!(resolution, runtime.resolve_module(b"node:fs", b""));
        let path = source_path(&runtime, resolution);
        let kind = RuntimeFileKind::Module(RuntimeModule::NodeFs);
        assert_eq!(runtime.file_kind(&path), Some(kind));
        assert_eq!(runtime.module_path(RuntimeModule::NodeFs), Some(&path[..]));
    }

    #[test]
    fn module_sources_are_listed_at_archive_paths() {
        let runtime = runtime_modules();
        let mut source_count = 0;
        for module in runtime.archive.manifest().modules() {
            let Some(path) = runtime.archive.path(module.id) else {
                assert!(module.path.is_none(), "module {}", module.id);
                continue;
            };
            let runtime_module = RuntimeModule::from_registry_id(module.id).unwrap();
            let kind = RuntimeFileKind::Module(runtime_module);
            assert_eq!(runtime.file_kind(path), Some(kind), "{}", BStr::new(path));
            assert_eq!(runtime.module_path(runtime_module), Some(path));
            source_count += 1;
        }
        assert!(source_count > 0);
    }

    #[test]
    fn a_file_that_waits_for_its_name_declares_nothing_for_other_files() {
        use bun_sema::hir::ModuleName;
        use bun_sema_parser::{CompileParseOptions, parse_for_compile};
        let runtime = runtime_modules();
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let waiting = runtime.files.iter().filter(|it| it.1.is_seen_only_by_name);
        let mut count = 0;
        for (path, _) in waiting {
            let options = CompileParseOptions {
                path,
                script_kind: None,
                experimental_decorators: false,
                every_file_is_a_module: true,
                reads_jsdoc: false,
                keeps_function_directives: false,
            };
            let text = runtime.read(path).unwrap();
            let hir = parse_for_compile(session.arena(), &options, &text, &atoms);
            let mut names = hir.modules.iter().map(|module| module.name);
            let name = BStr::new(path);
            assert!(names.all(|it| matches!(it, ModuleName::Ident(_))), "{name}");
            count += 1;
        }
        assert!(count > 100);
        let read_at_once = [RuntimeModule::NodeNet, RuntimeModule::NodeEvents];
        for module in read_at_once {
            assert!(!runtime.is_seen_only_by_name(runtime.module_path(module).unwrap()));
        }
        for path in runtime.declaration_paths() {
            assert!(!runtime.is_seen_only_by_name(&path));
        }
    }

    #[test]
    fn the_part_that_every_file_sees_asks_and_declares_what_the_whole_file_does() {
        use bun_sema::hir::ModuleName;
        use bun_sema_parser::{CompileParseOptions, parse_for_compile};
        let runtime = runtime_modules();
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let (mut whole_length, mut seen_length) = (0, 0);
        for path in runtime
            .files
            .keys()
            .filter(|path| runtime.is_seen_in_part(path))
        {
            let options = CompileParseOptions {
                path,
                script_kind: None,
                experimental_decorators: false,
                every_file_is_a_module: true,
                reads_jsdoc: false,
                keeps_function_directives: false,
            };
            let name = BStr::new(path);
            let whole = runtime.read(path).unwrap();
            let part = runtime.read_part_seen_by_every_file(path).unwrap();
            assert_eq!(whole.len(), part.len(), "{name}");
            let lines = |text: &[u8]| strings::count_char(text, b'\n');
            assert_eq!(lines(&whole), lines(&part), "{name}");
            let [whole, part] = [&whole, &part]
                .map(|text| parse_for_compile(session.arena(), &options, text, &atoms));
            assert!(!part.has_errors, "{name}");
            let asked = |hir: &bun_sema::hir::File| -> Vec<_> {
                let uses = hir.specifier_uses.iter();
                uses.map(|it| (it.spec, it.pos, it.kind.is_dynamic()))
                    .collect()
            };
            assert_eq!(asked(&whole), asked(&part), "{name}");
            let declared = |hir: &bun_sema::hir::File| {
                let names = hir.modules.iter().map(|module| module.name);
                names
                    .filter(|it| !matches!(it, ModuleName::Ident(_)))
                    .count()
            };
            assert_eq!(declared(&whole), declared(&part), "{name}");
            whole_length += whole.source_len as usize;
            let kept = runtime.part_seen_by_every_file(path).unwrap();
            let kept = kept.seen.iter().chain(&kept.asked);
            seen_length += kept.map(|it| (it.1 - it.0) as usize).sum::<usize>();
        }
        assert!(whole_length > 1_000_000);
        assert!(seen_length * 3 < whole_length);
    }

    #[test]
    fn native_module_has_no_path() {
        let runtime = runtime_modules();
        let Some(RuntimeResolution::Module(id)) = runtime.resolve_module(b"bun:jsc", b"") else {
            panic!("bun:jsc has a registry id");
        };
        assert_eq!(runtime.module_resolution(id), HostResolution::Module(id));
        let module = RuntimeModule::from_registry_id(id.0).unwrap();
        assert_eq!(runtime.module_path(module), None);
    }

    #[test]
    fn modules_of_own_tests_are_no_modules_for_a_program_built_elsewhere() {
        let names: [&[u8]; 2] = [b"bun:internal-for-testing", b"internal/test/binding"];
        let mut runtime = runtime_modules();
        let importer = runtime.module_path(RuntimeModule::NodeFs).unwrap().to_vec();
        for name in names {
            assert!(runtime.resolve_module(name, b"/project/a.js").is_some());
        }
        runtime.answers_modules_of_own_tests = false;
        for name in names {
            assert_eq!(runtime.resolve_module(name, b"/project/a.js"), None);
            assert!(runtime.resolve_module(name, &importer).is_some());
        }
        assert!(
            runtime
                .resolve_module(b"node:fs", b"/project/a.js")
                .is_some()
        );
    }

    #[test]
    fn internal_modules_resolve_from_runtime_sources_only() {
        let runtime = runtime_modules();
        let importer = source_path(&runtime, runtime.resolve_module(b"node:fs", b""));
        let from_runtime = runtime.resolve_module(b"internal/validators", &importer);
        let kind = runtime.file_kind(&source_path(&runtime, from_runtime));
        assert!(matches!(kind, Some(RuntimeFileKind::Module(_))));
        let from_program = runtime.resolve_module(b"internal/validators", b"/project/a.ts");
        assert_eq!(from_program, None);
    }

    #[test]
    fn module_that_only_the_host_has_is_host_value() {
        let resolution = runtime_modules().resolve_module(HOST_VALUE_MODULE.as_bytes(), b"");
        assert_eq!(resolution, HOST_VALUE);
    }

    #[test]
    fn module_in_place_of_entry_point_wrapper_has_source() {
        let runtime = runtime_modules();
        let resolution = runtime.resolve_module(b"bun:main", b"");
        assert_eq!(
            source_path(&runtime, resolution),
            b"/$bun/js/runtime.main.js"
        );
    }

    #[test]
    fn test_run_leaves_entry_point_wrapper_to_host() {
        let runtime = runtime_modules().with_test_aliases(true);
        assert_eq!(runtime.resolve_module(b"bun:main", b""), HOST_VALUE);
        assert!(runtime.find_modules(b"bun:main", b"").is_empty());
        let fs = host_module_id(RuntimeModule::NodeFs);
        assert!(runtime.find_modules(b"node:f", b"").contains(&fs));
        let wrap = runtime.resolve_module(b"bun:wrap", b"");
        assert_eq!(source_path(&runtime, wrap), b"/$bun/js/runtime.out.js");
        let program = runtime_modules().with_test_aliases(false);
        assert_eq!(program.find_modules(b"bun:main", b"").len(), 1);
    }

    #[test]
    fn other_specifiers_are_unclaimed() {
        let runtime = runtime_modules();
        assert_eq!(runtime.resolve_module(b"./nothing", b""), None);
        assert_eq!(runtime.resolve_module(b"./nothing", b"/project/a.ts"), None);
        let importer = source_path(&runtime, runtime.resolve_module(b"node:fs", b""));
        assert_eq!(runtime.resolve_module(b"./nothing", &importer), None);
    }

    #[test]
    fn find_modules_matches_public_specifiers_by_prefix_and_suffix() {
        let runtime = runtime_modules();
        let fs = host_module_id(RuntimeModule::NodeFs);
        assert!(runtime.find_modules(b"node:f", b"").contains(&fs));
        assert!(runtime.find_modules(b"f", b"s").contains(&fs));
        assert_eq!(runtime.find_modules(b"node:", b"fs"), [fs]);
        let every_module = runtime.find_modules(b"", b"");
        assert!(every_module.contains(&fs));
        assert!(every_module.is_sorted_by(|a, b| a < b));
        let ws = host_module_id(RuntimeModule::Ws);
        assert_eq!(runtime.find_modules(b"ws/lib/", b""), [ws]);
        let util = host_module_id(RuntimeModule::NodeUtil);
        assert_eq!(runtime.find_modules(b"node:sy", b""), [util]);
        assert!(runtime.find_modules(b"node:fs", b"fs").is_empty());
        assert!(runtime.find_modules(b"internal/validators", b"").is_empty());
        assert_eq!(runtime.find_modules(b"bun:main", b"").len(), 1);
        assert!(
            runtime
                .find_modules(HOST_VALUE_MODULE.as_bytes(), b"")
                .is_empty()
        );
        assert!(runtime.find_modules(b"./", b"").is_empty());
    }

    #[test]
    fn listed_files_are_readable() {
        let runtime = runtime_modules();
        for path in runtime.files.keys() {
            let text = runtime.read(path);
            assert!(
                text.is_some_and(|text| !text.is_empty()),
                "{}",
                BStr::new(path)
            );
        }
    }

    #[test]
    fn function_files_have_virtual_paths() {
        let runtime = runtime_modules();
        for &function in STARTUP_FUNCTIONS {
            let path = runtime.function_file_path(function).unwrap();
            let kind = runtime.file_kind(&path);
            assert_eq!(kind, Some(RuntimeFileKind::Functions), "{function:?}");
        }
        for path in runtime.function_files_without_ids() {
            let kind = runtime.file_kind(&path);
            assert_eq!(
                kind,
                Some(RuntimeFileKind::Functions),
                "{}",
                BStr::new(&path)
            );
        }
        let unknown_function = RuntimeFunction(u32::MAX);
        assert_eq!(runtime.function_file_path(unknown_function), None);
    }

    #[test]
    fn prelude_function_has_a_file() {
        let mut functions = table::runtime_functions().iter();
        let decorator_function = functions
            .find(|data| data.file == "prelude/decorators")
            .unwrap()
            .function;
        for omits_builtin_modules in [false, true] {
            let runtime = RuntimeModules::new(Archive::embedded(), omits_builtin_modules);
            let path = runtime.function_file_path(decorator_function).unwrap();
            assert_eq!(path, b"/$bun/js/prelude/decorators.ts");
            assert_eq!(runtime.file_kind(&path), Some(RuntimeFileKind::Functions));
            assert!(runtime.prelude_paths().any(|listed| listed == path));
        }
    }

    #[test]
    fn directories_are_listed_up_to_host_root() {
        let runtime = runtime_modules();
        assert!(runtime.is_directory(b"/$bun/js/node"));
        assert!(runtime.is_directory(b"/$bun/js"));
        assert!(runtime.is_directory(b"/$bun"));
        assert!(!runtime.is_directory(b"/"));
        assert!(!runtime.is_directory(b"/$bun/js/"));
        assert!(!runtime.is_directory(b"/$bun/js/node/fs.ts"));
        assert!(!runtime.is_directory(b"/$bun/plugin"));
    }

    #[test]
    fn entries_are_sorted_and_unique() {
        let runtime = runtime_modules();
        let (files, directories) = runtime.entries(b"/$bun/js").unwrap();
        assert!(files.contains(&b"tsconfig.json".to_vec()));
        assert!(files.contains(&b"package.json".to_vec()));
        assert!(directories.contains(&b"node".to_vec()));
        assert!(directories.contains(&b"prelude".to_vec()));
        assert!(files.is_sorted_by(|a, b| a < b));
        assert!(directories.is_sorted_by(|a, b| a < b));
        let top_entries = (Vec::new(), vec![b"js".to_vec()]);
        assert_eq!(runtime.entries(b"/$bun"), Some(top_entries));
        assert_eq!(runtime.entries(b"/$bun/js/node/fs.ts"), None);
        assert_eq!(runtime.entries(b"/"), None);
    }

    #[test]
    fn entries_name_files_and_directories() {
        let runtime = runtime_modules();
        let mut file_count = 0;
        for (directory, (files, directories)) in &runtime.directories {
            for name in files {
                let path = [&directory[..], b"/", &name[..]].concat();
                assert!(runtime.file_kind(&path).is_some(), "{}", BStr::new(&path));
            }
            for name in directories {
                let path = [&directory[..], b"/", &name[..]].concat();
                assert!(runtime.is_directory(&path), "{}", BStr::new(&path));
            }
            file_count += files.len();
        }
        let listed = runtime.files.values().filter(|it| !it.comes_with_module);
        assert_eq!(file_count, listed.count());
    }

    #[test]
    fn non_module_files_have_kinds() {
        let runtime = runtime_modules();
        let kind_at = |name: &[u8]| runtime.file_kind(&virtual_path(name));
        let declarations = Some(RuntimeFileKind::Declarations);
        assert_eq!(kind_at(b"builtins.d.ts"), declarations);
        assert_eq!(kind_at(b"private.d.ts"), declarations);
        for path in runtime.declaration_paths() {
            assert_eq!(runtime.file_kind(&path), declarations);
        }
        let configuration = Some(RuntimeFileKind::Configuration);
        assert_eq!(kind_at(b"tsconfig.json"), configuration);
        assert_eq!(kind_at(b"package.json"), configuration);
        for file in runtime.archive.manifest().function_files() {
            assert_eq!(kind_at(file), Some(RuntimeFileKind::Functions));
        }
        for path in runtime.prelude_paths() {
            assert_eq!(runtime.file_kind(&path), Some(RuntimeFileKind::Functions));
        }
        for name in [&b"builtins.d.ts"[..], b"private.d.ts", b"tsconfig.json"] {
            let text = runtime.read(&virtual_path(name));
            assert!(text.is_some_and(|text| !text.is_empty()));
        }
    }

    #[test]
    fn what_require_answers_for_a_module_is_declared_beside_the_module() {
        let runtime = runtime_modules();
        let module = runtime.module_path(RuntimeModule::NodeFs).unwrap();
        let declarations = runtime.declarations_of_module(module).unwrap();
        assert_eq!(declarations, b"/$bun/js/node/fs.listed.d.ts");
        let text = runtime.read(&declarations).unwrap();
        let line = br#""node:fs": $ModuleValue<typeof import("./fs")>;"#;
        assert!(text.find(line).is_some(), "{}", BStr::new(&text));
        assert_eq!(runtime.declarations_of_module(&declarations), None);

        // A file that a directory lists is part of every program, and what it names is read.
        let (files, _) = runtime.entries(b"/$bun/js/node").unwrap();
        assert!(files.contains(&b"fs.ts".to_vec()));
        assert!(!files.contains(&b"fs.listed.d.ts".to_vec()));
        let shared = runtime.read(b"/$bun/js/private.d.ts").unwrap();
        assert!(shared.find(b"interface $BunModules {").is_some());
        assert!(shared.find(b"$ModuleValue<typeof import(\"./").is_none());
    }

    #[test]
    fn virtual_package_json_has_name_and_no_type() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let text = runtime_modules().read(b"/$bun/js/package.json").unwrap();
        let value = parse_json(&text, session.arena(), &atoms);
        let Some(DataValue::Object(properties)) = value else {
            panic!("expected an object, got {value:?}");
        };
        let keys: Vec<&[u8]> = properties
            .iter()
            .map(|(key, _)| atoms.bytes(*key))
            .collect();
        assert_eq!(keys, [&b"name"[..]]);
    }

    #[test]
    fn paths_match_exactly() {
        let runtime = runtime_modules();
        assert!(runtime.file_kind(b"/$bun/js/node/fs.ts").is_some());
        assert_eq!(runtime.file_kind(b"/$bun/js/node/fs.ts.bak"), None);
        assert_eq!(runtime.file_kind(b"/$bun/js/node/fs"), None);
        assert_eq!(runtime.file_kind(b"/project/$bun/js/node/fs.ts"), None);
        assert_eq!(runtime.read(b"/$bun/js/node/fs.ts.bak"), None);
    }

    #[test]
    fn replaced_source_keeps_kind_and_listing() {
        let unchanged = runtime_modules();
        let module: &[u8] = b"/$bun/js/node/os.ts";
        let functions = virtual_path(&unchanged.archive.manifest().function_files()[0]);
        let sources = [
            (module.to_vec(), b"export {};".to_vec()),
            (functions.clone(), b"export function probe() {}".to_vec()),
            (
                b"/project/main.ts".to_vec(),
                b"import \"node:os\";".to_vec(),
            ),
            (b"/$bun/js/node/missing.ts".to_vec(), b"export {};".to_vec()),
        ];
        let replaced = runtime_modules().with_replaced_sources(&sources);

        assert_eq!(replaced.read(module).unwrap(), &b"export {};"[..]);
        assert_eq!(
            replaced.read(&functions).unwrap(),
            &b"export function probe() {}"[..]
        );
        let kind = RuntimeFileKind::Module(RuntimeModule::NodeOs);
        assert_eq!(replaced.file_kind(module), Some(kind));
        assert_eq!(
            replaced.file_kind(&functions),
            Some(RuntimeFileKind::Functions)
        );
        let os = replaced.resolve_module(b"node:os", b"");
        assert_eq!(source_path(&replaced, os), module);
        let validators = replaced.resolve_module(b"internal/validators", module);
        assert_eq!(
            validators,
            unchanged.resolve_module(b"internal/validators", module)
        );
        assert!(validators.is_some());

        assert_eq!(replaced.files.len(), unchanged.files.len());
        assert_eq!(replaced.file_kind(b"/project/main.ts"), None);
        assert_eq!(replaced.file_kind(b"/$bun/js/node/missing.ts"), None);
        assert_eq!(
            replaced.entries(b"/$bun/js/node"),
            unchanged.entries(b"/$bun/js/node")
        );
        let other: &[u8] = b"/$bun/js/node/fs.ts";
        assert_eq!(replaced.read(other), unchanged.read(other));
    }

    #[test]
    fn omitted_builtin_modules_are_host_values() {
        let runtime = RuntimeModules::new(Archive::embedded(), true);
        assert!(runtime.omits_builtin_modules);
        for specifier in [&b"fs"[..], b"node:fs", b"bun:jsc", b"bun:main"] {
            assert_eq!(runtime.resolve_module(specifier, b""), HOST_VALUE);
        }
        let importer: &[u8] = b"/$bun/js/node/fs.ts";
        assert_eq!(
            runtime.resolve_module(b"internal/validators", importer),
            HOST_VALUE
        );
        assert_eq!(runtime.resolve_module(b"./nothing", b""), None);
        assert!(runtime.find_modules(b"", b"").is_empty());
        assert_eq!(runtime.module_path(RuntimeModule::NodeFs), None);
        let fs = host_module_id(RuntimeModule::NodeFs);
        assert_eq!(runtime.module_resolution(fs), HostResolution::Module(fs));
        for &function in STARTUP_FUNCTIONS {
            assert_eq!(runtime.function_file_path(function), None);
        }
        assert_eq!(runtime.function_files_without_ids().count(), 0);
        assert!(runtime.file_kind(importer).is_some());
    }
}

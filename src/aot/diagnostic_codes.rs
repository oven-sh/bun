use crate::diagnostics::Severity;

macro_rules! diagnostic_codes {
    ($( $section:ident $first:literal ..= $last:literal { $( $name:ident = $number:literal, $severity:ident, $template:literal; )* } )*) => {
        #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
        pub enum Code { $($( $name, )*)* }

        impl Code {
            pub const ALL: &'static [Code] = &[$($( Code::$name, )*)*];

            pub fn number(self) -> u32 {
                match self { $($( Code::$name => $number, )*)* }
            }

            pub fn severity(self) -> Severity {
                match self { $($( Code::$name => Severity::$severity, )*)* }
            }

            pub fn template(self) -> &'static str {
                match self { $($( Code::$name => $template, )*)* }
            }

            #[cfg(test)]
            fn section_range(self) -> (u32, u32) {
                match self { $($( Code::$name => ($first, $last), )*)* }
            }
        }
    };
}

diagnostic_codes! {
    Build 100050..=100099 {
        UnsupportedOption = 100050, Error, "--aot does not support {0}";
        MacroArgumentNotConstant = 100051, Error, "This macro argument isn't known at build time";
        MacrosDisabled = 100053, Error, "Macros are disabled";
        EmbeddedFileNameCollision = 100054, Error, "Two files with different contents would be embedded as \"{0}\": \"{1}\" and \"{2}\"";
        ProgramTooLarge = 100055, Error, "The program is too large to compile: its IR is {0} bytes, and the limit is 4 GB";
        FileNestedTooDeeply = 100060, Error, "The code in \"{0}\" is nested too deeply to be compiled";
        OutputNotWritten = 100061, Error, "Cannot write \"{0}\": {1}";
        ShadowRealmIsAbsent = 100076, Warning, "A compiled program has no ShadowRealm. This throws a ReferenceError if it runs";
        ModulesLoadAgainUncompiled = 100078, Warning, "What loads again after resetModules() runs from source, not compiled. The tests still work, but from there on they don't test compiled code";
        EveryFileMayLoadAgain = 100079, Warning, "{0}. After that any file of this test run may load again, so the whole run is compiled for that, and not as an executable is. The tests still work, but they don't test the code that ships";
        LoaderFunctionNotAsked = 100080, Warning, "A compiled program calls {0} only for a path that it computes when it runs. Every import, and every require() of a constant path, is resolved at build time and doesn't ask it. If the program depends on this hook, build it with --no-aot";
        WorkerFileNotCompiled = 100081, Warning, "This Worker may start from a file that isn't compiled, and then it fails to load: {0}. Add the file as an entry point, or write its path as new URL(\"./file\", import.meta.url)";
        WorkerStartedFromUnknownValue = 100082, Warning, "The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load{0}";
        WorkerTextNotCompiled = 100084, Warning, "This Worker may start from code in a text: a data: or blob: URL, or the text of a Worker with eval: true. That code isn't compiled, so it runs in the interpreter. To compile it, move it to a file and write the path as new URL(\"./file\", import.meta.url)";
        FolderNamedAsParentIsSpelled = 100085, Error, "Two files would have the path \"{0}\" in the executable: \"{1}\" and \"{2}\". A folder above that of the entry point is written \"_.._\" there, so no folder beside it can have that name";
        DeletionFromModuleCacheDoesNothing = 100091, Warning, "A compiled module that has run doesn't run again. Taking it out of require.cache does nothing in an executable, and the next require() returns the same exports";
        EntryStoredInModuleCacheIsNotAsked = 100092, Warning, "require.cache doesn't list compiled modules. In an executable, require() doesn't ask an entry that's stored under the path of one: it runs the compiled file and returns that file's exports";
        ModuleCacheIsHandedOn = 100093, Warning, "Code that the build doesn't follow gets require.cache here. In an executable, require.cache doesn't list compiled modules: deleting an entry or storing one changes nothing, and require() returns the same exports";
        FunctionSourceReparseMismatch = 100090, Error, "A check of the compiler itself failed: the retained source of a function does not parse back to its syntax tree: {0}";
        WorkerFilesGoByOnePath = 100086, Warning, "In the executable \"{0}\" is all that is left of the paths of two files: \"{1}\" and \"{2}\". A \"..\" above the root of the executable takes nothing away, so nothing tells the two apart, and a Worker that starts from either fails to load. Pass both files to the build as entry points";
        FilesLeftOutByPattern = 100089, Warning, "The executable doesn't embed {0}, which this path may name. {1}";
        ModuleMayBeNamedAtRunTime = 100094, Warning, "This call may load a module, and the build can't work out its name. If it names code that isn't in the executable, the call throws at run time. Import the module by its name to keep it, or build with --aot-allow-code-from-disk";
        FoldersOfResolveAreNotRead = 100095, Warning, "The build can't work out the folders that this call looks in, so what they hold may not be in the executable. The call may then find a module of the same name in a folder above them, or none. Write the list of folders in the call, each as a path from __dirname or import.meta.dirname";
        MadeRequireGoesOutOfSight = 100096, Warning, "The build can't follow the require() that is made here to every call of it. If such a call names code that isn't in the executable, it throws at run time. Make it for the file's own path or URL, keep it in a const and call it by that name, or build with --aot-allow-code-from-disk";
        SearchGoesOnAboveListedFolder = 100097, Warning, "One of the folders that this call looks in isn't there or doesn't hold the module, so the search goes on in the folders above it and finds {0}. In an executable the search doesn't go on above a listed folder, so the call may find another module of the same name, or none. List the folder that holds the module";
        ResolvedFileNotEmbedded = 100099, Warning, "This path names {0}, which isn't in the executable, so the call throws at run time. Pass the file to bun compile as another entry point";
        IgnoreCommentSilencesNothing = 100073, Warning, "This comment silences nothing: {0}";
        DataFilesFoundByPattern = 100088, Note, "This path isn't a constant, so the executable embeds every file that it may name. These aren't code: {0}";
        UnembeddedFileRead = 100098, Warning, "This reads \"{0}\", but the executable has no file at that path. Embed it with --asset {0}";
        EmbeddedFileUnreachable = 100087, Warning, "This reads \"{0}\", which is in the executable, but this path doesn't lead there: a path made from import.meta climbs at most one folder above the root of the executable. Make it from __dirname";


    }
    Fold 100100..=100149 {
        FeatureArgumentCount = 100100, Error, "feature() requires exactly one string argument";
        FeatureArgumentNotString = 100101, Error, "feature() argument must be a string literal";
        FeatureFlagNotAscii = 100102, Error, "feature() flag name must be an ASCII string";
        FeatureOutsideCondition = 100103, Error, "feature() from \"bun:bundle\" can only be used directly in an if statement or ternary condition";
        FeatureImportedTwice = 100104, Error, "`feature` from \"bun:bundle\" may only be imported once";
        UnknownBundleExport = 100105, Error, "\"bun:bundle\" has no export named \"{0}\"";
        ImportStatementInCommonJs = 100106, Error, "Cannot use import statement with CommonJS-only features";
        CommonJsBecauseModule = 100112, Note, "This file is CommonJS because '{0}' was used";
        CommonJsBecauseExports = 100108, Note, "This file is CommonJS because '{0}' was used";
        CommonJsBecauseWith = 100110, Note, "This file is CommonJS because a \"with\" statement is used";
        TryRequireInstead = 100111, Note, "Try require({0}) instead";
        MacroInExportStar = 100113, Error, "cannot use macro in export statement";
        MacroInExportFrom = 100114, Error, "export from cannot be used with \"type\": \"macro\"";
    }
    Resolve 100150..=100199 {
        ModuleNotFound = 100150, Error, "Could not resolve: \"{0}\"";
        PackageNotFound = 100151, Error, "Could not resolve: \"{0}\". Maybe you need to \"bun install\"?";
        BuiltinModuleNotFound = 100152, Error, "No such built-in module: {0}";
        PackagePathNotExported = 100153, Error, "The path \"{0}\" is not exported by its package";
        PackageImportNotDefined = 100154, Error, "The import \"{0}\" is not defined in the \"imports\" of the enclosing package.json";
        InvalidModuleSpecifier = 100155, Error, "\"{0}\" is not a valid module specifier";
        InvalidPackageTarget = 100156, Error, "The package target for \"{0}\" is not valid";
        InvalidPackageConfiguration = 100157, Error, "The package.json that \"{0}\" resolves through is not valid";
        UnsupportedDirectoryImport = 100158, Error, "\"{0}\" is a directory, which cannot be imported";
        QueryStringInSpecifier = 100159, Error, "bun compile can't load \"{0}\": a query string works on an import of code, not in require(), on a data file, or as ?raw or ?url. Drop the query. Under bun run --aot, --aot-allow-code-from-disk loads it as bun run does";
        EntryPointNotFound = 100160, Error, "Entry point \"{0}\" was not found";
        EntryPointIsBuiltinModule = 100161, Error, "Cannot use \"{0}\" as an entry point: it resolves to a builtin module";
        EntryPointIsExternal = 100162, Error, "The entry point \"{0}\" cannot be marked as external";
        FileIsNotAProgram = 100163, Error, "\"{0}\" is loaded as JavaScript, because nothing says what else it is, and it isn't JavaScript: {1}";
        DataFileIsRefused = 100164, Error, "\"{0}\" could not be parsed as {1}: {2}";
        FileEmbeddedImplicitly = 100166, Note, "The executable embeds \"{0}\" because this reads it";
        WorkerFileFoundByName = 100167, Note, "The executable holds \"{0}\", which this names, because a Worker may start from it";
        WorkerFilesFoundByName = 100168, Note, "The build can't tell which file each Worker starts from, so the executable holds these files, which the program names: {0}";
        WorkerFileIsRefused = 100169, Warning, "\"{0}\" is only compiled because a Worker may start from it, and it can't be: {1}. A Worker that loads it fails";
        PackageJsonEmbeddedImplicitly = 100170, Note, "The executable embeds \"{0}\" because this reads a path that isn't known at build time";
        NearerPackageJsonEmbedded = 100171, Note, "The executable embeds \"{0}\" because a search for the nearest package.json would otherwise find \"{1}\"";
        NamedPathNotEmbedded = 100172, Warning, "This passes on \"{0}\", but the executable has nothing at that path once it's moved. Embed it with --asset {0}, or ship it and find it through process.execPath";
        PathNeededOnDisk = 100173, Warning, "This looks for \"{0}\" on the disk, and the executable has nothing there once it's moved. Ship it and find it through process.execPath";
        SearchMissesPackageJson = 100174, Warning, "This hands on \"{0}\", and the executable doesn't hold the package.json that a search from there finds first. Once it's moved, the search finds another one or none";
        FolderListedInPart = 100175, Warning, "This hands on \"{0}\" to code that may list it, and the executable holds some of its files alone. Once it's moved, the list is shorter. Embed the folder with --asset {0}";
        FileBehindAssetSymlink = 100165, Warning, "This reads \"{0}\", but the executable has no file at that path: --asset follows no links inside a folder. Embed it with --asset {1}";
    }
    Link 100200..=100299 {
        ExportNotFound = 100200, Error, "No matching export in \"{0}\" for import \"{1}\"";
        AmbiguousExport = 100201, Error, "Ambiguous import \"{0}\" has multiple matching exports";
        ProgramLimitExceeded = 100202, Error, "The program is too large to compile: {0} is limited to {1}, and it needs {2}";
    }
    Lower 100300..=100699 {
        NestedTooDeeply = 100301, Error, "This code is nested more than {0} levels deep.";
        FunctionIntrospection = 100302, Warning, "'{0}' is always null on a compiled function.";
        InvalidRuntimeSource = 100305, Error, "Bun's own source cannot be compiled: {0}";
        InvalidRegExp = 100307, Error, "{0}";
        DependencyHasTypeErrors = 100308, Warning, "The package \"{0}\" has {1} in the TypeScript that is compiled. Your build doesn't stop for them. To list them, run bun check --aot --all";
        LibraryFileHasTopLevelCode = 100501, Error, "A library file can only declare functions and types";
        InvalidRegExpFlags = 100515, Error, "Invalid flags \"{0}\" in regular expression";
    }
    Builtins 100700..=100749 {}
}

#[cfg(test)]
pub const RETIRED_NUMBERS: &[u32] = &[
    100009, 100010, 100013, 100015, 100017, 100021, 100033, 100034, 100052, 100056, 100059, 100062,
    100063, 100065, 100067, 100068, 100069, 100070, 100071, 100072, 100074, 100075, 100077, 100109,
    100120, 100300, 100303, 100304, 100306, 100500, 100502, 100510, 100511, 100513, 100519,
];

impl Code {
    pub fn message(self, arguments: &[impl AsRef<[u8]>]) -> Vec<u8> {
        let mut out = Vec::new();
        bun_sema::messages::format(&mut out, self.template(), arguments);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::generated::UserDiagnosticKind;
    use bstr::BStr;
    use bun_core::strings;
    use bun_sema_standalone as _;
    use std::collections::{BTreeMap, BTreeSet};

    const NO_ARGUMENTS: &[&[u8]] = &[];

    fn placeholders(template: &str) -> BTreeSet<usize> {
        let mut numbers = BTreeSet::new();
        let mut rest = template.as_bytes();
        while let Some(open) = strings::index_of_char_usize(rest, b'{') {
            rest = &rest[open + 1..];
            let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
            if digits > 0 && rest.get(digits) == Some(&b'}') {
                let number = rest[..digits]
                    .iter()
                    .fold(0, |number, digit| number * 10 + usize::from(digit - b'0'));
                numbers.insert(number);
            }
        }
        numbers
    }

    fn has_consecutive_placeholders(template: &str) -> bool {
        let numbers = placeholders(template);
        numbers.iter().copied().eq(0..numbers.len())
    }

    #[test]
    fn no_message_says_that_the_code_it_points_at_runs() {
        for code in Code::ALL {
            let template = code.template();
            assert!(
                !(template.contains("throws") && template.contains("when it runs")),
                "{code:?} may point at code behind a test that is false: \"if it runs\"",
            );
        }
    }

    #[test]
    fn numbers_are_unique() {
        let mut uses = BTreeMap::<u32, usize>::new();
        for code in Code::ALL {
            *uses.entry(code.number()).or_default() += 1;
        }
        for (number, count) in uses {
            assert_eq!(count, 1, "{count} codes have the number {number}");
        }
    }

    #[test]
    fn engine_numbers_stay_unused() {
        let engine_numbers: BTreeSet<u32> = UserDiagnosticKind::ALL
            .into_iter()
            .map(UserDiagnosticKind::code)
            .collect();
        for code in Code::ALL {
            assert!(
                !engine_numbers.contains(&code.number()),
                "{code:?} takes a number of the engine"
            );
        }
        for number in RETIRED_NUMBERS {
            assert!(!engine_numbers.contains(number), "{number} is in use");
        }
    }

    #[test]
    fn retired_numbers_stay_unused() {
        for code in Code::ALL {
            assert!(
                !RETIRED_NUMBERS.contains(&code.number()),
                "{code:?} takes a retired number"
            );
        }
    }

    #[test]
    fn numbers_fit_section_ranges() {
        for code in Code::ALL {
            let (first, last) = code.section_range();
            assert!(
                (first..=last).contains(&code.number()),
                "{code:?} is outside {first}..={last}"
            );
        }
    }

    #[test]
    fn placeholders_are_consecutive() {
        for code in Code::ALL {
            assert!(has_consecutive_placeholders(code.template()), "{code:?}");
        }
        assert!(has_consecutive_placeholders("no placeholder"));
        assert!(has_consecutive_placeholders("{1} {0} {1}"));
        assert!(has_consecutive_placeholders("{...spread} {} {name} {0"));
        assert!(!has_consecutive_placeholders("{1}"));
        assert!(!has_consecutive_placeholders("{0} {2}"));
    }

    #[test]
    fn message_fills_placeholders() {
        assert_eq!(
            BStr::new(&Code::ModuleNotFound.message(&[b"./a"])),
            "Could not resolve: \"./a\""
        );
        assert_eq!(
            BStr::new(&Code::ModuleNotFound.message(NO_ARGUMENTS)),
            "Could not resolve: \"{0}\""
        );
        assert_eq!(
            BStr::new(&Code::ExportNotFound.message(&["./a.ts", "b"])),
            "No matching export in \"./a.ts\" for import \"b\""
        );
    }
}

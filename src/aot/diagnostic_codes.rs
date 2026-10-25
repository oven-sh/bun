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

// A new code takes the next free number of its section. The number of a deleted line goes into `RETIRED_NUMBERS`, and no code takes a number of `UserDiagnosticKind::code`.
diagnostic_codes! {
    Legacy 100001..=100049 {
        PackageCompiledWithoutTypes = 100009, Warning, "'{0}' has {1} (the first at {2}), so {3} of its {4} files are compiled without their types. They still work, but run slower.";
        FileCompiledWithoutTypes = 100010, Warning, "'{0}' has {1} (the first at {2}), so it is compiled without its types. It still works, but runs slower.";
    }
    Build 100050..=100099 {
        UnsupportedOption = 100050, Error, "--aot does not support {0}";
        MacroArgumentNotConstant = 100051, Error, "This macro argument isn't known at build time";
        MacroInNodeModules = 100052, Error, "For security reasons, macros cannot be run from node_modules.";
        MacrosDisabled = 100053, Error, "Macros are disabled";
        EmbeddedFileNameCollision = 100054, Error, "Two files with different contents would be embedded as \"{0}\": \"{1}\" and \"{2}\"";
        ProgramTooLarge = 100055, Error, "The program is too large to compile: its IR is {0} bytes, and the limit is 4 GB";
        FileNestedTooDeeply = 100060, Error, "The code in \"{0}\" is nested too deeply to be compiled";
        OutputNotWritten = 100061, Error, "Cannot write \"{0}\": {1}";
        WorkerFileNotCompiled = 100071, Warning, "This Worker may start from an embedded file that isn't compiled, and then it fails to load: {0}. Add the file as an entry point, or pass its import straight to new Worker()";
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
        QueryStringInSpecifier = 100159, Error, "bun compile does not support a query string in an import path: \"{0}\"";
        EntryPointNotFound = 100160, Error, "Entry point \"{0}\" was not found";
        EntryPointIsBuiltinModule = 100161, Error, "Cannot use \"{0}\" as an entry point: it resolves to a builtin module";
        EntryPointIsExternal = 100162, Error, "The entry point \"{0}\" cannot be marked as external";
        FileIsNotAProgram = 100163, Error, "\"{0}\" is loaded as JavaScript, because nothing says what else it is, and it isn't JavaScript: {1}";
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
        LibraryFileHasTopLevelCode = 100501, Error, "A library file can only declare functions and types";
        JsxKeyIgnored = 100510, Warning, "\"key\" prop ignored. Must be a string, number or symbol.";
        JsxKeyAfterSpread = 100511, Warning, "\"key\" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.";
        InvalidRegExpFlags = 100515, Error, "Invalid flags \"{0}\" in regular expression";
    }
    Builtins 100700..=100749 {}
}

pub const RETIRED_NUMBERS: &[u32] = &[
    100013, 100015, 100017, 100021, 100033, 100034, 100056, 100059, 100062, 100063, 100065, 100067,
    100068, 100069, 100070, 100109, 100120, 100300, 100303, 100304, 100500, 100502, 100513, 100519,
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
    fn templates_are_trimmed() {
        for code in Code::ALL {
            let template = code.template();
            assert!(!template.is_empty(), "{code:?}");
            assert!(!template.starts_with(' '), "{code:?}");
            assert!(!template.ends_with('\n'), "{code:?}");
        }
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
        assert_eq!(
            BStr::new(&Code::JsxKeyAfterSpread.message(&["unused"])),
            Code::JsxKeyAfterSpread.template()
        );
    }
}

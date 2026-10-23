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
        }
    };
}

// A new code takes the next free number of its section. The number of a deleted line goes into `RETIRED_NUMBERS`, and no code takes a number of `UserDiagnosticKind::code`.
diagnostic_codes! {
    Legacy 100001..=100049 {
        PackageCompiledWithoutTypes = 100009, Warning, "'{0}' has {1} (the first at {2}), so {3} of its {4} files are compiled without their types. They still work, but run slower.";
        FileCompiledWithoutTypes = 100010, Warning, "'{0}' has {1} (the first at {2}), so it is compiled without its types. It still works, but runs slower.";
        TypedVersionHasTypeErrors = 100021, Error, "The typed version of '{0}' in {1} has type errors ({2}), the first at {3}";
    }
    LegacyValidation 100107..=100107 {
        UnsupportedValidationType = 100107, Error, "{0}<{1}>() cannot validate '{2}'. Only types that JSON can represent can be validated.";
    }
    Build 100050..=100099 {
        UnsupportedOption = 100050, Error, "--aot does not support {0}";
        MacroArgumentNotConstant = 100051, Error, "This macro argument isn't known at build time";
        MacroInNodeModules = 100052, Error, "For security reasons, macros cannot be run from node_modules.";
        MacrosDisabled = 100053, Error, "Macros are disabled";
        EmbeddedFileNameCollision = 100054, Error, "Two files with different contents would be embedded as \"{0}\": \"{1}\" and \"{2}\"";
        ProgramTooLarge = 100055, Error, "The program is too large to compile: its IR is {0} bytes, and the limit is 4 GB";
        TypedPackageNotUsed = 100056, Warning, "The typed version of \"{0}\" in {1} can't be used: {2}";
        FileNestedTooDeeply = 100060, Error, "The code in \"{0}\" is nested too deeply to be compiled";
        OutputNotWritten = 100061, Error, "Cannot write \"{0}\": {1}";
        TypedPackageUsed = 100062, Note, "\"{0}\" {1} is compiled from its typed version in {2}";
        ShippedTypedVersionNotUsed = 100065, Warning, "\"{0}\" is compiled without types, because its typed version in {1} can't be used: {2}";
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
        ValidationTypeParameter = 100503, Error, "'{0}' is a type parameter here, so there is no type to validate against.";
        TypedParseNeedsTypeArgument = 100504, Error, "JSON.parse() from \"bun\" needs a type argument: JSON.parse<User>(text). Use JSON.parse<any>(text) to skip validation";
        ValidateNeedsTypeArgument = 100505, Error, "validate() needs a type argument: validate<User>(value)";
        ValidateNeedsTypeScript = 100506, Error, "validate() from \"bun:bundle\" needs a type argument, so it only works in TypeScript files";
        ValidateArgumentCount = 100507, Error, "validate() requires exactly one argument";
        ValidateOptionalCall = 100508, Error, "validate?.() isn't supported. Call it directly: validate<User>(value)";
        ValidateIsNotAValue = 100509, Error, "validate() from \"bun:bundle\" can only be called. It can't be assigned, passed as an argument or exported";
        JsxKeyIgnored = 100510, Warning, "\"key\" prop ignored. Must be a string, number or symbol.";
        JsxKeyAfterSpread = 100511, Warning, "\"key\" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.";
        JsonFromBunIsExported = 100512, Error, "JSON from \"bun\" can't be exported. Import it in each file that uses it";
        TypedParseCalleeIsNotResolved = 100514, Warning, "This call has the type of JSON.parse<T>(), but the compiler can't prove it calls the built-in JSON.parse. If it calls something else, the result isn't validated.";
        InvalidRegExpFlags = 100515, Error, "Invalid flags \"{0}\" in regular expression";
    }
    Builtins 100700..=100749 {}
}

pub const RETIRED_NUMBERS: &[u32] = &[
    100013, 100015, 100017, 100033, 100034, 100059, 100063, 100109, 100120, 100300, 100303, 100304,
    100500, 100502, 100513,
];

pub const WITHOUT_PRINTED_NUMBER: &[Code] =
    &[Code::TypedPackageUsed, Code::ShippedTypedVersionNotUsed];

impl Code {
    pub fn prints_number(self) -> bool {
        !WITHOUT_PRINTED_NUMBER.contains(&self)
    }

    pub fn message(self, arguments: &[impl AsRef<[u8]>]) -> Vec<u8> {
        let mut out = Vec::new();
        bun_sema::messages::format(&mut out, self.template(), arguments);
        out
    }
}

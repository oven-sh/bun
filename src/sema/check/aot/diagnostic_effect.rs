use super::diagnostic_class::DiagnosticClass;
use crate::messages::Category;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum FileOrigin {
    NoFile,
    ProgramSource,
    ProgramJavaScript,
    ProjectTypedVersion,
    DependencySource,
    DependencyJavaScript,
    Declarations,
    Runtime,
    EvaluatedText,
}

impl FileOrigin {
    pub const COUNT: usize = 9;
    pub const ALL: [FileOrigin; FileOrigin::COUNT] = [
        FileOrigin::NoFile,
        FileOrigin::ProgramSource,
        FileOrigin::ProgramJavaScript,
        FileOrigin::ProjectTypedVersion,
        FileOrigin::DependencySource,
        FileOrigin::DependencyJavaScript,
        FileOrigin::Declarations,
        FileOrigin::Runtime,
        FileOrigin::EvaluatedText,
    ];

    pub fn name(self) -> &'static str {
        match self {
            FileOrigin::NoFile => "NoFile",
            FileOrigin::ProgramSource => "ProgramSource",
            FileOrigin::ProgramJavaScript => "ProgramJavaScript",
            FileOrigin::ProjectTypedVersion => "ProjectTypedVersion",
            FileOrigin::DependencySource => "DependencySource",
            FileOrigin::DependencyJavaScript => "DependencyJavaScript",
            FileOrigin::Declarations => "Declarations",
            FileOrigin::Runtime => "Runtime",
            FileOrigin::EvaluatedText => "EvaluatedText",
        }
    }

    pub fn can_lose_trust(self) -> bool {
        DiagnosticClass::ALL
            .into_iter()
            .any(|class| effect_of_error(self, class) == Effect::WithdrawsTrust)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum Effect {
    StopsBuild,
    Warns,
    WithdrawsTrust,
    Dropped,
    InternalError,
}

impl Effect {
    pub fn name(self) -> &'static str {
        match self {
            Effect::StopsBuild => "StopsBuild",
            Effect::Warns => "Warns",
            Effect::WithdrawsTrust => "WithdrawsTrust",
            Effect::Dropped => "Dropped",
            Effect::InternalError => "InternalError",
        }
    }
}

fn effect_of_error(origin: FileOrigin, class: DiagnosticClass) -> Effect {
    match (class, origin) {
        (DiagnosticClass::DeclarationFile | DiagnosticClass::EmittedOutput, _) => Effect::Dropped,
        (DiagnosticClass::Style, FileOrigin::NoFile | FileOrigin::ProgramSource) => {
            Effect::StopsBuild
        }
        (
            DiagnosticClass::Style,
            FileOrigin::ProgramJavaScript
            | FileOrigin::ProjectTypedVersion
            | FileOrigin::DependencySource
            | FileOrigin::DependencyJavaScript
            | FileOrigin::Declarations
            | FileOrigin::Runtime
            | FileOrigin::EvaluatedText,
        ) => Effect::Dropped,
        (DiagnosticClass::EarlyError, FileOrigin::Runtime) => Effect::InternalError,
        (
            DiagnosticClass::EarlyError,
            FileOrigin::NoFile
            | FileOrigin::ProgramSource
            | FileOrigin::ProgramJavaScript
            | FileOrigin::ProjectTypedVersion
            | FileOrigin::DependencySource
            | FileOrigin::DependencyJavaScript
            | FileOrigin::Declarations,
        ) => Effect::StopsBuild,
        (DiagnosticClass::EarlyError, FileOrigin::EvaluatedText) => Effect::WithdrawsTrust,
        // What the program's `lib` and `types` declare does not count against the full types of a package.
        (DiagnosticClass::MissingDeclaration, FileOrigin::ProjectTypedVersion) => Effect::Dropped,
        // Full types that do not check cost the package its types, never the build.
        (
            DiagnosticClass::TypeScriptGrammar | DiagnosticClass::Semantic,
            FileOrigin::ProjectTypedVersion,
        ) => Effect::WithdrawsTrust,
        (
            DiagnosticClass::TypeScriptGrammar
            | DiagnosticClass::Semantic
            | DiagnosticClass::MissingDeclaration,
            FileOrigin::NoFile | FileOrigin::ProgramSource,
        ) => Effect::StopsBuild,
        (
            DiagnosticClass::TypeScriptGrammar
            | DiagnosticClass::Semantic
            | DiagnosticClass::MissingDeclaration,
            FileOrigin::ProgramJavaScript
            | FileOrigin::DependencyJavaScript
            | FileOrigin::Declarations
            | FileOrigin::EvaluatedText,
        ) => Effect::Dropped,
        (DiagnosticClass::Semantic, FileOrigin::DependencySource | FileOrigin::Runtime) => {
            Effect::WithdrawsTrust
        }
        (
            DiagnosticClass::TypeScriptGrammar | DiagnosticClass::MissingDeclaration,
            FileOrigin::DependencySource | FileOrigin::Runtime,
        ) => Effect::Dropped,
    }
}

pub fn effect_of(origin: FileOrigin, class: DiagnosticClass, category: Category) -> Effect {
    match category {
        // ECMAScript refuses the program, whatever category TypeScript gives the sentence: 1450 is a message.
        Category::Suggestion | Category::Message if class == DiagnosticClass::EarlyError => {
            effect_of_error(origin, class)
        }
        Category::Suggestion | Category::Message => Effect::Dropped,
        Category::Error => effect_of_error(origin, class),
        // TypeScript gives this category to nothing. The compiler's own warnings have it, under the class of early errors.
        Category::Warning => match effect_of_error(origin, class) {
            Effect::StopsBuild | Effect::Warns => Effect::Warns,
            Effect::WithdrawsTrust | Effect::Dropped | Effect::InternalError => Effect::Dropped,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use Effect::{
        Dropped as D, InternalError as I, StopsBuild as S, Warns as W, WithdrawsTrust as T,
    };

    const EXPECTED_FOR_ERRORS: [(DiagnosticClass, [Effect; FileOrigin::COUNT]); 7] = [
        (DiagnosticClass::EarlyError, [S, S, S, S, S, S, S, I, T]),
        (
            DiagnosticClass::TypeScriptGrammar,
            [S, S, D, T, D, D, D, D, D],
        ),
        (DiagnosticClass::Semantic, [S, S, D, T, T, D, D, T, D]),
        (
            DiagnosticClass::MissingDeclaration,
            [S, S, D, D, D, D, D, D, D],
        ),
        (DiagnosticClass::Style, [S, S, D, D, D, D, D, D, D]),
        (
            DiagnosticClass::DeclarationFile,
            [D, D, D, D, D, D, D, D, D],
        ),
        (DiagnosticClass::EmittedOutput, [D, D, D, D, D, D, D, D, D]),
    ];

    #[test]
    fn effect_decides_every_cell() {
        assert_eq!(
            EXPECTED_FOR_ERRORS.map(|(class, _)| class),
            DiagnosticClass::ALL
        );
        for (class, by_origin) in EXPECTED_FOR_ERRORS {
            for (origin, for_error) in FileOrigin::ALL.into_iter().zip(by_origin) {
                let cell = format!("{class:?} {origin:?}");
                assert_eq!(
                    effect_of(origin, class, Category::Error),
                    for_error,
                    "{cell}"
                );
                let is_early_error = class == DiagnosticClass::EarlyError;
                let for_warning = match for_error {
                    S | W => W,
                    T | D | I => D,
                };
                let for_note = if is_early_error { for_error } else { D };
                assert_eq!(
                    effect_of(origin, class, Category::Warning),
                    for_warning,
                    "{cell}"
                );
                assert_eq!(
                    effect_of(origin, class, Category::Suggestion),
                    for_note,
                    "{cell}"
                );
                assert_eq!(
                    effect_of(origin, class, Category::Message),
                    for_note,
                    "{cell}"
                );
            }
        }
    }

    #[test]
    fn only_typed_code_that_the_program_did_not_write_and_evaluated_text_can_lose_trust() {
        for origin in FileOrigin::ALL {
            let is_expected = matches!(
                origin,
                FileOrigin::ProjectTypedVersion
                    | FileOrigin::DependencySource
                    | FileOrigin::Runtime
                    | FileOrigin::EvaluatedText
            );
            assert_eq!(origin.can_lose_trust(), is_expected, "{origin:?}");
        }
    }

    #[test]
    fn names_are_variant_names() {
        for (index, origin) in FileOrigin::ALL.into_iter().enumerate() {
            assert_eq!(origin as usize, index);
            assert_eq!(origin.name(), format!("{origin:?}"));
        }
        for effect in [S, W, T, D, I] {
            assert_eq!(effect.name(), format!("{effect:?}"));
        }
    }
}

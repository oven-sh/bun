use super::diagnostic_class::DiagnosticClass;
use crate::messages::Category;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum FileOrigin {
    NoFile,
    ProgramSource,
    ProgramJavaScript,
    DependencySource,
    DependencyJavaScript,
    Declarations,
    Runtime,
    EvaluatedText,
}

impl FileOrigin {
    pub const COUNT: usize = 8;
    pub const ALL: [FileOrigin; FileOrigin::COUNT] = [
        FileOrigin::NoFile,
        FileOrigin::ProgramSource,
        FileOrigin::ProgramJavaScript,
        FileOrigin::DependencySource,
        FileOrigin::DependencyJavaScript,
        FileOrigin::Declarations,
        FileOrigin::Runtime,
        FileOrigin::EvaluatedText,
    ];

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

fn effect_of_error(origin: FileOrigin, class: DiagnosticClass) -> Effect {
    match (class, origin) {
        (DiagnosticClass::DeclarationFile | DiagnosticClass::EmittedOutput, _) => Effect::Dropped,
        (DiagnosticClass::Style, FileOrigin::NoFile | FileOrigin::ProgramSource) => {
            Effect::StopsBuild
        }
        (
            DiagnosticClass::Style,
            FileOrigin::ProgramJavaScript
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
            | FileOrigin::DependencySource
            | FileOrigin::DependencyJavaScript
            | FileOrigin::Declarations,
        ) => Effect::StopsBuild,
        (DiagnosticClass::EarlyError, FileOrigin::EvaluatedText) => Effect::WithdrawsTrust,
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
        Category::Suggestion | Category::Message if class == DiagnosticClass::EarlyError => {
            effect_of_error(origin, class)
        }
        Category::Suggestion | Category::Message => Effect::Dropped,
        Category::Error => effect_of_error(origin, class),
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
        (DiagnosticClass::EarlyError, [S, S, S, S, S, S, I, T]),
        (DiagnosticClass::TypeScriptGrammar, [S, S, D, D, D, D, D, D]),
        (DiagnosticClass::Semantic, [S, S, D, T, D, D, T, D]),
        (
            DiagnosticClass::MissingDeclaration,
            [S, S, D, D, D, D, D, D],
        ),
        (DiagnosticClass::Style, [S, S, D, D, D, D, D, D]),
        (DiagnosticClass::DeclarationFile, [D, D, D, D, D, D, D, D]),
        (DiagnosticClass::EmittedOutput, [D, D, D, D, D, D, D, D]),
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
                FileOrigin::DependencySource | FileOrigin::Runtime | FileOrigin::EvaluatedText
            );
            assert_eq!(origin.can_lose_trust(), is_expected, "{origin:?}");
        }
    }

    #[test]
    fn origins_are_listed_in_order() {
        for (index, origin) in FileOrigin::ALL.into_iter().enumerate() {
            assert_eq!(origin as usize, index);
        }
    }
}

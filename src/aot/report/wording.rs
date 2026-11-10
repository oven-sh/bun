use bun_trim::UnseenCodeCause;

use super::levels::AccessColumn;
use crate::ir::generated::{
    AllocationEscapeReason, AllocationHeapCause, CodeForm, KnowledgeLevel, TypeTestFailure,
    UnprovenCause,
};

pub(super) const DOCUMENTATION_URL: &[u8] = b"https://bun.com/docs/compiler/explain#";

pub(super) struct CauseWording {
    pub message: &'static str,
    pub fix: &'static str,
}

pub(super) const GUARD_HEADLINE: &str =
    "the type of this value isn't proven, so it is checked here";
pub(super) const GUARD_FIX: &str = "nothing to fix unless it fails in hot code. Then trace the value back from here to where its type is lost";

pub(super) const ESCAPE_REASONS: [(AllocationEscapeReason, &str);
    AllocationEscapeReason::NAMES.len()] = [
    (AllocationEscapeReason::RETURNED, "it is returned"),
    (AllocationEscapeReason::THROWN, "it is thrown"),
];

pub(super) fn cause_wording(cause: UnprovenCause) -> CauseWording {
    let (message, fix) = match cause {
        UnprovenCause::Unknown => (
            "The compiler recorded no reason for this slow path.",
            "this is a bug in Bun: please report it.",
        ),
        UnprovenCause::UnknownObject => (
            "The compiler doesn't know the shape of this object, so the access is a lookup or needs a shape check.",
            "that depends on where the object comes from. See the table at the link below.",
        ),
        UnprovenCause::UnknownCallee => (
            "The compiler can't tell which function this call reaches, so the call is indirect and its result has no type.",
            "call the function directly, or narrow the result.",
        ),
        UnprovenCause::Untracked => (
            "An operator runs on a value whose type the compiler doesn't know.",
            "start with the unknown-object or unknown-callee entry at the same location. If there is none, narrow the value first, for example with typeof.",
        ),
    };
    CauseWording { message, fix }
}

pub(super) fn failure_sentence(failure: TypeTestFailure) -> &'static str {
    match failure {
        TypeTestFailure::TakesGenericPath => "when it fails, only this operation is slower",
        TypeTestFailure::Throws => {
            "when it fails, the operation throws, as it does in plain JavaScript"
        }
        TypeTestFailure::ExitsToSlowVersion => {
            "when it fails, the rest of the call runs in the function's slow version"
        }
    }
}

pub(super) fn heap_cause_sentence(cause: AllocationHeapCause) -> Option<&'static str> {
    match cause {
        AllocationHeapCause::None => None,
        AllocationHeapCause::NotTracked => Some("escape analysis doesn't track it"),
        AllocationHeapCause::Escapes => Some("it can outlive the call that creates it"),
        AllocationHeapCause::LiveAcrossSuspension => Some("it is live across an await or a yield"),
        AllocationHeapCause::RetainedAcrossIterations => {
            Some("an object that outlives one loop iteration references it")
        }
    }
}

pub(super) fn unseen_code_sentence(cause: UnseenCodeCause) -> &'static str {
    match cause {
        UnseenCodeCause::ProgramNotCompiled => "the program wasn't built with --aot",
        UnseenCodeCause::ReportMissing => "the compiler didn't report which APIs are used",
        UnseenCodeCause::FlowResultDisabled => "a developer option turned the analysis off",
        UnseenCodeCause::EvaluatesText => "the program calls eval() or new Function()",
        UnseenCodeCause::ImportsUncompiledCode => {
            "the program imports a module that isn't in the executable"
        }
        UnseenCodeCause::LoadsModuleByName | UnseenCodeCause::LoadsCodeByName => {
            "the program calls import() or require() with a dynamic path"
        }
        UnseenCodeCause::RunsUnseenCode => "the program can run code that isn't in the executable",
        UnseenCodeCause::RunsMachineCode => "the program loads a native addon or a shared library",
        UnseenCodeCause::OptionAdmitsCode => {
            "a build option lets the executable load code at run time"
        }
    }
}

pub(super) fn level_label(level: KnowledgeLevel) -> &'static str {
    match level {
        KnowledgeLevel::Proven => "proven",
        KnowledgeLevel::Expected => "guarded",
        KnowledgeLevel::Unknown => "unknown",
    }
}

pub(super) fn column_label(column: AccessColumn) -> &'static str {
    match column {
        AccessColumn::Free => "free",
        AccessColumn::Tested => "tested",
        AccessColumn::ByName => "by name",
    }
}

pub(super) fn column_key(column: AccessColumn) -> &'static str {
    match column {
        AccessColumn::Free => "free",
        AccessColumn::Tested => "tested",
        AccessColumn::ByName => "byName",
    }
}

pub(super) fn column_description(column: AccessColumn) -> &'static str {
    match column {
        AccessColumn::Free => "free: one load or store at a fixed offset",
        AccessColumn::Tested => "tested: a test of its own, then a load or store at a fixed offset",
        AccessColumn::ByName => "by name: looked up by name",
    }
}

pub(super) fn form_label(form: CodeForm) -> &'static str {
    match form {
        CodeForm::Open => "open",
        CodeForm::Closed => "closed",
        CodeForm::Generic => "generic",
    }
}

pub(super) fn cause_code(cause: UnprovenCause) -> &'static str {
    match cause {
        UnprovenCause::Unknown => "unknown",
        UnprovenCause::UnknownObject => "unknown-object",
        UnprovenCause::UnknownCallee => "unknown-callee",
        UnprovenCause::Untracked => "lost-track",
    }
}

pub(super) fn failure_code(failure: TypeTestFailure) -> &'static str {
    match failure {
        TypeTestFailure::TakesGenericPath => "rejoins",
        TypeTestFailure::Throws => "throws",
        TypeTestFailure::ExitsToSlowVersion => "leaves",
    }
}

pub(super) fn trim_blocker_code(cause: UnseenCodeCause) -> &'static str {
    match cause {
        UnseenCodeCause::ProgramNotCompiled => "no-aot",
        UnseenCodeCause::ReportMissing => "no-report",
        UnseenCodeCause::FlowResultDisabled => "analysis-disabled",
        UnseenCodeCause::EvaluatesText => "eval",
        UnseenCodeCause::ImportsUncompiledCode => "external-import",
        UnseenCodeCause::LoadsModuleByName | UnseenCodeCause::LoadsCodeByName => "dynamic-import",
        UnseenCodeCause::RunsUnseenCode => "runtime-code",
        UnseenCodeCause::RunsMachineCode => "native-code",
        UnseenCodeCause::OptionAdmitsCode => "build-option",
    }
}

#[cfg(test)]
mod tests;

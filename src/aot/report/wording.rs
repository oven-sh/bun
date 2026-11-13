use bun_trim::UnseenCodeCause;

use super::levels::AccessColumn;
use crate::ir::generated::{
    AllocationEscapeReason, AllocationHeapCause, CodeForm, KnowledgeLevel, TypeOriginReason,
    TypeTestFailure, UnprovenCause,
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

/// The message has a place for a name. Without a wording the cause of the operation says everything that is known.
pub(super) struct OriginWording {
    pub before_name: &'static str,
    pub unnamed: &'static str,
    pub after_name: &'static str,
    pub fix: &'static str,
}

impl OriginWording {
    pub(super) fn message(&self, name: &[u8]) -> Vec<u8> {
        let name = match name.is_empty() {
            true => self.unnamed.as_bytes(),
            false => name,
        };
        [
            self.before_name.as_bytes(),
            name,
            self.after_name.as_bytes(),
        ]
        .concat()
    }
}

pub(super) fn origin_wording(reason: TypeOriginReason) -> Option<OriginWording> {
    let (before_name, unnamed, after_name, fix) = match reason {
        TypeOriginReason::Unknown | TypeOriginReason::Untracked => return None,
        TypeOriginReason::BuiltinResult => (
            "The compiler doesn't know the shape of what ",
            "this call",
            " returns.",
            "check its fields and build a new object from them.",
        ),
        TypeOriginReason::CallResult => (
            "The compiler doesn't know what ",
            "this call",
            " returns, because it can't tell which function is called.",
            "call the function directly, or narrow the result.",
        ),
        TypeOriginReason::PropertyRead => (
            "The compiler doesn't know the shape of what is read from ",
            "here",
            ".",
            "check its fields and build a new object from them.",
        ),
        TypeOriginReason::OutsideCaller => (
            "Code that the compiler can't see can call ",
            "this function",
            " with any values.",
            "check the arguments where the function starts, or call it from compiled code.",
        ),
        TypeOriginReason::ExposedObject => (
            "Code that the compiler can't see can store anything in the fields of ",
            "objects that it gets here",
            ".",
            "pass a copy, or only the values that are needed.",
        ),
        TypeOriginReason::ExposedVariable => (
            "Code that the compiler can't see can assign anything to ",
            "this variable",
            ".",
            "copy it into a constant and use that.",
        ),
        TypeOriginReason::CaughtException => (
            "A caught exception can be anything",
            "",
            ".",
            "narrow it, for example with instanceof.",
        ),
        TypeOriginReason::OtherValue => (
            "A value that isn't an object gets to places that hold objects: ",
            "this one",
            ".",
            "keep it in a variable or a field of its own.",
        ),
        TypeOriginReason::ArrayArgument => (
            "new Array() makes its argument an element unless that's a number, and ",
            "this value",
            " may not be one yet.",
            "make it a number before the array is created: declare it with const, above its first use.",
        ),
        TypeOriginReason::OtherBuiltin => (
            "A built-in object, such as an array or a map, gets to places that hold other objects: ",
            "this one",
            ".",
            "keep it in a variable or a field of its own.",
        ),
        TypeOriginReason::OtherFunction => (
            "A function gets to places that hold objects: ",
            "this one",
            ".",
            "keep it in a variable or a field of its own.",
        ),
        TypeOriginReason::ManyShapes => (
            "Objects of too many shapes come together in ",
            "this access",
            ".",
            "keep them apart, or give them one class.",
        ),
        TypeOriginReason::ManyFunctions => (
            "More than one function can be called here, so the call is indirect and its result has no type",
            "",
            ".",
            "call the function directly, or narrow the result.",
        ),
        TypeOriginReason::ChangedShape => (
            "Objects of ",
            "this class",
            " change their shape: a property is added, deleted or redefined.",
            "declare every property in the class and assign them there.",
        ),
        TypeOriginReason::MissingField => (
            "The compiler can't prove that the object has this field already, so each access checks for it",
            "",
            ".",
            "assign the field on every path of the constructor, or in every literal.",
        ),
        TypeOriginReason::CheckedElement => (
            "The compiler can't prove that this element exists, so each access checks for it",
            "",
            ".",
            "nothing to fix unless it's in hot code. Then loop from 0 to the length, over an array without holes.",
        ),
        TypeOriginReason::CheckedResult => (
            "The result of ",
            "this call",
            " is checked each time, because it can take a slow path that returns anything.",
            "nothing to fix unless it's in hot code. Then use a loop or an index instead.",
        ),
        TypeOriginReason::CheckedKeys => (
            "Copying or listing the properties of an object checks that it has no others",
            "",
            ".",
            "nothing to fix unless it's in hot code. Then name the properties one by one.",
        ),
        TypeOriginReason::StaticField => (
            "A static field is added to its class when the class is evaluated",
            "",
            ".",
            "nothing to fix: it runs once.",
        ),
        TypeOriginReason::ComputedName => (
            "The name of this property is only known when the program runs, so it is looked up",
            "",
            ".",
            "use a Map, or an array with numbers as indexes.",
        ),
        TypeOriginReason::BuiltinProperty => (
            "Properties of built-in objects, functions and primitive values are looked up by name",
            "",
            ".",
            "read it outside your loops.",
        ),
    };
    Some(OriginWording {
        before_name,
        unnamed,
        after_name,
        fix,
    })
}

/// There may be a faster way to write it, but no type or declaration to change.
pub(super) fn has_fix(reason: TypeOriginReason) -> bool {
    !matches!(
        reason,
        TypeOriginReason::CheckedElement
            | TypeOriginReason::CheckedKeys
            | TypeOriginReason::CheckedResult
            | TypeOriginReason::StaticField
    )
}

pub(super) fn origin_code(reason: TypeOriginReason) -> &'static str {
    match reason {
        TypeOriginReason::Unknown => "",
        TypeOriginReason::Untracked => "untracked-value",
        TypeOriginReason::BuiltinResult => "builtin-result",
        TypeOriginReason::CallResult => "call-result",
        TypeOriginReason::PropertyRead => "property-read",
        TypeOriginReason::OutsideCaller => "outside-caller",
        TypeOriginReason::ExposedObject => "exposed-object",
        TypeOriginReason::ExposedVariable => "exposed-variable",
        TypeOriginReason::CaughtException => "caught-exception",
        TypeOriginReason::OtherValue => "other-value",
        TypeOriginReason::ArrayArgument => "array-argument",
        TypeOriginReason::OtherBuiltin => "other-builtin",
        TypeOriginReason::OtherFunction => "other-function",
        TypeOriginReason::ManyShapes => "many-shapes",
        TypeOriginReason::ManyFunctions => "many-functions",
        TypeOriginReason::ChangedShape => "changed-shape",
        TypeOriginReason::MissingField => "missing-field",
        TypeOriginReason::CheckedElement => "checked-element",
        TypeOriginReason::CheckedResult => "checked-result",
        TypeOriginReason::CheckedKeys => "checked-keys",
        TypeOriginReason::StaticField => "static-field",
        TypeOriginReason::BuiltinProperty => "builtin-property",
        TypeOriginReason::ComputedName => "computed-name",
    }
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

use bun_trim::UnseenCodeCause;

use super::levels::AccessColumn;
use crate::ir::generated::{
    AllocationEscapeReason, AllocationHeapCause, CodeForm, IllTypedCause, KnowledgeLevel,
    TypeTestFailure, UnprovenCause,
};

pub(super) const DOCUMENTATION_URL: &[u8] = b"https://bun.com/docs/compiler/explain#";

pub(super) struct CauseWording {
    pub message: &'static str,
    pub fix: &'static str,
}

pub(super) struct GuardWording {
    pub counted_as: &'static str,
    pub headline: &'static str,
    pub fix: &'static str,
}

pub(super) struct IllTypedWording {
    pub code: &'static str,
    pub message: &'static str,
    pub fix: &'static str,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub(super) enum GuardClass {
    OtherType,
    UnknownObject,
    UnknownCallee,
    UnprovenContents,
    ProofWithheld,
    ReadBeforeInitialized,
    ElementAccess,
    ObjectState,
    NotRecorded,
}

impl GuardClass {
    pub(super) const COUNT: usize = 9;
    pub(super) const ALL: [GuardClass; GuardClass::COUNT] = [
        GuardClass::OtherType,
        GuardClass::UnknownObject,
        GuardClass::UnknownCallee,
        GuardClass::UnprovenContents,
        GuardClass::ProofWithheld,
        GuardClass::ReadBeforeInitialized,
        GuardClass::ElementAccess,
        GuardClass::ObjectState,
        GuardClass::NotRecorded,
    ];
}

pub(super) const ESCAPE_REASONS: [(AllocationEscapeReason, &str);
    AllocationEscapeReason::NAMES.len()] = [
    (AllocationEscapeReason::RETURNED, "it is returned"),
    (AllocationEscapeReason::THROWN, "it is thrown"),
    (
        AllocationEscapeReason::STORED_IN_UNKNOWN_MEMORY,
        "it is stored somewhere the compiler can't track",
    ),
    (
        AllocationEscapeReason::PASSED_TO_UNKNOWN_CODE,
        "it is passed to code the compiler can't see",
    ),
    (
        AllocationEscapeReason::RETAINED_BY_CALLEE,
        "a callee keeps a reference to it",
    ),
    (
        AllocationEscapeReason::STORED_IN_ESCAPING_OBJECT,
        "it is stored in an object that escapes",
    ),
    (
        AllocationEscapeReason::LEAKED_BY_CONTAINER,
        "it is in a collection that escapes",
    ),
    (
        AllocationEscapeReason::LIMIT_REACHED,
        "escape analysis hit a limit",
    ),
];

pub(super) fn cause_wording(cause: UnprovenCause) -> CauseWording {
    let (message, fix) = match cause {
        UnprovenCause::Unknown => (
            "The compiler recorded no reason for this slow path.",
            "the compiler recorded nothing to suggest here.",
        ),
        UnprovenCause::ResultDisabled => (
            "The part of the analysis that proves this was left out of the build.",
            "no build option does that, so this is a bug in Bun: please report it.",
        ),
        UnprovenCause::UnknownObject => (
            "An object from untyped code is used as this type here, so it can have any shape.",
            "build a new object of this type from it where it enters typed code.",
        ),
        UnprovenCause::NonLayoutObject => (
            "The object is an array, a function or another built-in object, and the compiler has no direct load for this property of it. The property is looked up by name.",
            "the compiler recorded nothing to suggest here.",
        ),
        UnprovenCause::BuiltinBase => (
            "This class extends a built-in class. The built-in constructor allocates the instances, so their fields can't be at fixed offsets.",
            "fine for an error class. For a class with many instances, hold the built-in object in a field instead of extending it.",
        ),
        UnprovenCause::UnknownBase => (
            "This class extends a class that comes from untyped code.",
            "extend one of your own classes, or store the other object in a field.",
        ),
        UnprovenCause::ClassEvaluatedAgain => (
            "This class declaration, or one it extends, can be evaluated more than once.",
            "define the class at the top level of a module, not in a function or a loop.",
        ),
        UnprovenCause::ReachesNativeCode => (
            "An object of this type is passed to a built-in function here that may add, delete or redefine its properties.",
            "pass only the fields the function needs, or a copy.",
        ),
        UnprovenCause::ReachesUnknownJavaScript => (
            "An object of this type is passed to untyped code here, which may add, delete or redefine its properties.",
            "pass only the fields the other code needs. Instead of Object.defineProperty, declare the property in the class. Instead of Object.create, use a class and extends.",
        ),
        UnprovenCause::UnknownWriter => (
            "Untyped code can write to a field of this type, so the field may hold any value.",
            "keep the object out of that code, or pass only the fields it needs.",
        ),
        UnprovenCause::UnknownCallee => (
            "The callee isn't known at build time, so the result has no type.",
            "call the function directly, or narrow the result.",
        ),
        UnprovenCause::UnprovenContents => (
            "The array, Map or Set this value is read from may contain values of other types.",
            "only add to the collection from typed code, or narrow the element after reading it.",
        ),
        UnprovenCause::OtherNewTarget => (
            "This class is constructed with a different new.target (Reflect.construct, or a subclass from untyped code).",
            "construct it with new.",
        ),
        UnprovenCause::UndescribedNativeResult => (
            "The value is the result of a built-in function whose result type the compiler doesn't know, or it is read out of such a result.",
            "narrow the result.",
        ),
        UnprovenCause::UnseenCode => (
            "The value comes from code that isn't in the executable.",
            "keep eval'd code and modules loaded at run time away from this value.",
        ),
        UnprovenCause::UncheckedConversionOfUntracked => (
            "A value that nothing checked against its declared type can reach this access.",
            "follow the 'why' line of this entry.",
        ),
        UnprovenCause::DataFromOutside => (
            "The value comes from outside the program (JSON.parse, response.json(), a file loaded at run time).",
            "check its fields, and build a new object of this type from them.",
        ),
        UnprovenCause::ThrownByRunTime => (
            "The value was caught, or it is read out of a caught value, and anything can be thrown.",
            "narrow it first, for example with instanceof Error.",
        ),
        UnprovenCause::ParameterOfEscapedFunction => (
            "A function is handed to code the compiler can't see here, which can call it with any arguments.",
            "call the function from your own code, or hand over a small wrapper that checks its arguments.",
        ),
        UnprovenCause::ContentsOfEscapedObject => (
            "An object is handed to code the compiler can't see here, which can write anything into it.",
            "hand over a copy, or only the fields that code needs.",
        ),
        UnprovenCause::ResultOfUnknownCallee => (
            "The value is returned by a call whose callee isn't known at build time, or it is read out of such a result.",
            "give the callee a function type.",
        ),
        UnprovenCause::ObjectWithoutLayout => (
            "The compiler found no fixed layout for the object where it is built.",
            "the compiler recorded nothing to suggest here.",
        ),
        UnprovenCause::Untracked => (
            "The compiler stopped tracking the objects that reach this access.",
            "give the value a declared type, or split the function.",
        ),
        UnprovenCause::LayoutOutsideFamily => (
            "An object reaches this access with a shape its declared type doesn't include.",
            "trace the object back from here. An unsound cast hides it from TypeScript.",
        ),
        UnprovenCause::UnprovenEntryValue => (
            "The value comes into this function from outside, as an argument or as 'this', or it is read out of such a value. The compiler didn't prove the type of what comes in.",
            "pass a value whose type the compiler can prove. For data from outside the program, check its fields and build a new object of the type from them.",
        ),
        UnprovenCause::UnprovenStoredValue => (
            "The value is read from a property or a variable, or out of such a value. The compiler didn't prove what is stored there.",
            "read the value into a local variable, and narrow that before you use it.",
        ),
        UnprovenCause::UnprovenResultOfCall => (
            "The value is returned by a function that the compiler knows, or it is read out of such a value. The compiler didn't prove the type of the result.",
            "the compiler recorded nothing to suggest here.",
        ),
        UnprovenCause::UnprovenState => (
            "The compiler didn't prove that an object is still as it was built: that no code added, removed or redefined a property, replaced a prototype or froze it. The access of the object tests that where it runs, here or where the value that is used here is read, and takes a slower path when the test fails.",
            "the compiler recorded nothing to suggest here.",
        ),
        UnprovenCause::PlaceOfElement => (
            "An element of an array or a typed array is read or written here, or the value that is used here comes from such a read. The access of the element tests the index and how the array stores its elements where it runs.",
            "the compiler recorded nothing to suggest here.",
        ),
        UnprovenCause::IndexMayBeUndefined => (
            "An element is read or written here with an index that can be 'undefined', or the value that is used here comes from such a read. The index is 'undefined' for example when it is read from an array that has a hole. With 'undefined' as the index, the access looks the element up by name.",
            "read the index into a variable and check it against 'undefined' before the access, or keep the indexes in a typed array.",
        ),
    };
    CauseWording { message, fix }
}

pub(super) fn guard_class(cause: UnprovenCause) -> GuardClass {
    match cause {
        UnprovenCause::Unknown => GuardClass::NotRecorded,
        UnprovenCause::LayoutOutsideFamily => GuardClass::OtherType,
        UnprovenCause::PlaceOfElement | UnprovenCause::IndexMayBeUndefined => {
            GuardClass::ElementAccess
        }
        UnprovenCause::UnprovenState => GuardClass::ObjectState,
        UnprovenCause::ResultDisabled => GuardClass::ProofWithheld,
        UnprovenCause::UnknownCallee | UnprovenCause::ResultOfUnknownCallee => {
            GuardClass::UnknownCallee
        }
        UnprovenCause::UnprovenContents => GuardClass::UnprovenContents,
        UnprovenCause::UnknownObject
        | UnprovenCause::NonLayoutObject
        | UnprovenCause::BuiltinBase
        | UnprovenCause::UnknownBase
        | UnprovenCause::ClassEvaluatedAgain
        | UnprovenCause::ReachesNativeCode
        | UnprovenCause::ReachesUnknownJavaScript
        | UnprovenCause::UnknownWriter
        | UnprovenCause::OtherNewTarget
        | UnprovenCause::UndescribedNativeResult
        | UnprovenCause::UnseenCode
        | UnprovenCause::UncheckedConversionOfUntracked
        | UnprovenCause::DataFromOutside
        | UnprovenCause::ThrownByRunTime
        | UnprovenCause::ParameterOfEscapedFunction
        | UnprovenCause::ContentsOfEscapedObject
        | UnprovenCause::ObjectWithoutLayout
        | UnprovenCause::Untracked
        | UnprovenCause::UnprovenEntryValue
        | UnprovenCause::UnprovenStoredValue
        | UnprovenCause::UnprovenResultOfCall => GuardClass::UnknownObject,
    }
}

pub(super) fn guard_wording(class: GuardClass) -> GuardWording {
    match class {
        GuardClass::OtherType => GuardWording {
            counted_as: "on a value of the wrong type",
            headline: "a value of the wrong type reaches this guard",
            fix: "trace the value back from here: an unsound cast ('as', 'any' or '!') hides the mismatch from TypeScript",
        },
        GuardClass::UnknownObject => GuardWording {
            counted_as: "on a value whose type isn't proven",
            headline: "the type of the value isn't proven",
            fix: "narrow it first: typeof for a primitive. For an object, check its fields and build a new object of the type from them",
        },
        GuardClass::UnknownCallee => GuardWording {
            counted_as: "on the result of an unknown callee",
            headline: "the value is returned by a call whose callee isn't known at build time",
            fix: "call the function directly, or narrow the result",
        },
        GuardClass::UnprovenContents => GuardWording {
            counted_as: "on an element of a collection",
            headline: "the array, Map or Set it's read from may contain values of other types",
            fix: "only add to the collection from typed code, or narrow the element after reading it",
        },
        GuardClass::ProofWithheld => GuardWording {
            counted_as: "because part of the analysis was left out of the build",
            headline: "the part of the analysis that proves this was left out of the build",
            fix: "no build option does that, so this is a bug in Bun: please report it",
        },
        GuardClass::ReadBeforeInitialized => GuardWording {
            counted_as: "on a variable that may be read too early",
            headline: "the variable may be read before it's initialized",
            fix: "initialize it before the code that reads it can run",
        },
        GuardClass::ElementAccess => GuardWording {
            counted_as: "on the place of an element",
            headline: "the access tests the index and how the array stores its elements where it runs",
            fix: "the compiler recorded nothing to suggest here",
        },
        GuardClass::ObjectState => GuardWording {
            counted_as: "on the state of an object",
            headline: "the compiler didn't prove that the object is still as it was built",
            fix: "the compiler recorded nothing to suggest here",
        },
        GuardClass::NotRecorded => GuardWording {
            counted_as: "with no recorded reason",
            headline: "the compiler recorded no reason for this guard",
            fix: "the compiler recorded nothing to suggest here",
        },
    }
}

pub(super) fn ill_typed_cause_wording(cause: IllTypedCause) -> Option<IllTypedWording> {
    let (code, message, fix) = match cause {
        IllTypedCause::None => return None,
        IllTypedCause::Unclassified => (
            "unclassified",
            "The compiler recorded no reason for this guard.",
            "this is a bug in Bun: please report it.",
        ),
        IllTypedCause::FromLooseType => (
            "loose-type",
            "The value comes from 'any', 'unknown', 'object', '{}', 'Function' or a bare type parameter.",
            "narrow it, or give the source a precise type.",
        ),
        IllTypedCause::Assertion => (
            "unsound-cast",
            "An 'as' cast changes the type here, and nothing checks it.",
            "remove the cast, or narrow the value first.",
        ),
        IllTypedCause::SuppressedError => (
            "suppressed-error",
            "The type checker doesn't accept this value here.",
            "fix the type error.",
        ),
        IllTypedCause::DeclarationWithoutBody => (
            "declaration-only",
            "The type comes from a 'declare' or a .d.ts file, which the compiler can't check against the code.",
            "compile the typed source of the package, or narrow the value.",
        ),
        IllTypedCause::OutsideData => (
            "external-data",
            "The value comes from outside the program (JSON.parse, response.json(), structuredClone, a message).",
            "check its fields, and build a new object of this type from them.",
        ),
        IllTypedCause::LayoutOutsideFamily => (
            "unexpected-shape",
            "An object reaches this point with a shape its declared type doesn't include.",
            "trace the object back from here: an unsound cast hides it from TypeScript.",
        ),
        IllTypedCause::MemberWithoutSlot => (
            "not-a-plain-object",
            "A primitive, function, array, built-in object or proxy is used as this object type.",
            "pass an object literal or a class instance.",
        ),
        IllTypedCause::NativeWritesOperand => (
            "passed-to-builtin",
            "The object is passed to a built-in function that may write to it.",
            "pass a copy, or only the fields the function needs.",
        ),
        IllTypedCause::UnseenWriter => (
            "written-by-runtime-code",
            "Code that isn't in the executable can write to this object.",
            "keep the object out of eval'd code and modules loaded at run time.",
        ),
        IllTypedCause::UnseenCaller => (
            "called-by-runtime-code",
            "Code that isn't in the executable can call this function with any arguments.",
            "keep the function out of eval'd code and modules loaded at run time.",
        ),
        IllTypedCause::UnprovenCallee => (
            "unknown-callee",
            "The callee isn't known at build time.",
            "call the function directly.",
        ),
        IllTypedCause::OtherThis => (
            "other-this",
            "The method can run with a different 'this' (call, apply, bind, or read off its object and called later).",
            "call it as a method, or use an arrow function.",
        ),
        IllTypedCause::CalledByEngine => (
            "called-by-builtin",
            "A built-in calls this function (a callback, getter, toString or iterator), so its arguments aren't proven.",
            "nothing to fix if the guard passes: it costs a few instructions.",
        ),
        IllTypedCause::ContainerWriterUnseen => (
            "untyped-collection",
            "Something the compiler can't see may add to this array, Map, Set or Promise.",
            "only add to the collection from typed code.",
        ),
        IllTypedCause::ElementMayBeAbsent => (
            "element-may-be-missing",
            "The index may be out of bounds, or the array may have holes, so the read can produce undefined.",
            "the compiler recorded nothing to suggest here.",
        ),
        IllTypedCause::ScopeOpenedByEval => (
            "direct-eval",
            "A direct eval() in this scope can reassign the variable.",
            "use indirect eval, (0, eval)(code), or move the eval out of this scope.",
        ),
        IllTypedCause::ReadBeforeInitialized => (
            "read-before-init",
            "The field or variable can be read before it's initialized.",
            "initialize it in the declaration or first in the constructor.",
        ),
    };
    Some(IllTypedWording { code, message, fix })
}

pub(super) fn failure_sentence(failure: TypeTestFailure) -> &'static str {
    match failure {
        TypeTestFailure::TakesGenericPath => "when it fails, only this operation is slower",
        TypeTestFailure::Throws => {
            "when it fails, the operation throws, as it does in plain JavaScript"
        }
        TypeTestFailure::Leaves => {
            "when it fails, the rest of the call runs in the function's slow version"
        }
    }
}

pub(super) fn heap_cause_sentence(cause: AllocationHeapCause) -> Option<&'static str> {
    match cause {
        AllocationHeapCause::None => None,
        AllocationHeapCause::NotTracked => Some("escape analysis doesn't track it"),
        AllocationHeapCause::HasNoFrameForm => Some("this kind of object is never stack-allocated"),
        AllocationHeapCause::Escapes => Some("it can outlive the call that creates it"),
        AllocationHeapCause::SeveralLiveInstances => {
            Some("more than one object created here can be live at the same time")
        }
        AllocationHeapCause::HasUntrackedAlias => {
            Some("it has an alias the compiler doesn't track")
        }
        AllocationHeapCause::LiveAcrossSuspension => Some("it is live across an await or a yield"),
        AllocationHeapCause::LiveAtReturnCall => {
            Some("it is live at a tail call, which replaces the stack frame")
        }
        AllocationHeapCause::HeldByHeapCell => Some("a heap object references it"),
        AllocationHeapCause::HeldAcrossIterations => {
            Some("an object that outlives one loop iteration references it")
        }
        AllocationHeapCause::ChangedByUse => {
            Some("an operation may change its shape, its prototype or its storage")
        }
        AllocationHeapCause::SeenByNativeCode => {
            Some("it is passed to a built-in function or looked up by a computed key")
        }
        AllocationHeapCause::ClosureIsNotOnlyCalled => {
            Some("the function is used as a value, not only called")
        }
        AllocationHeapCause::LayoutDefersClosures => {
            Some("one of its methods is created lazily and captures the object")
        }
        AllocationHeapCause::FieldsCreatedLater => {
            Some("some of its fields are added after it is created")
        }
        AllocationHeapCause::ExceedsLimit => Some("it has too many fields to stack-allocate"),
        AllocationHeapCause::MaterializationDoesNotPay => {
            Some("moving it to the heap later would not be cheaper")
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
        UnprovenCause::ResultDisabled => "analysis-disabled",
        UnprovenCause::UnknownObject => "unknown-object",
        UnprovenCause::NonLayoutObject => "not-a-plain-object",
        UnprovenCause::BuiltinBase => "builtin-base",
        UnprovenCause::UnknownBase => "untyped-base",
        UnprovenCause::ClassEvaluatedAgain => "class-not-top-level",
        UnprovenCause::ReachesNativeCode => "passed-to-builtin",
        UnprovenCause::ReachesUnknownJavaScript => "passed-to-untyped-code",
        UnprovenCause::UnknownWriter => "written-by-untyped-code",
        UnprovenCause::UnknownCallee => "unknown-callee",
        UnprovenCause::UnprovenContents => "untyped-collection",
        UnprovenCause::OtherNewTarget => "other-new-target",
        UnprovenCause::UndescribedNativeResult => "builtin-result",
        UnprovenCause::UnseenCode => "runtime-code",
        UnprovenCause::UncheckedConversionOfUntracked => "unchecked-value",
        UnprovenCause::DataFromOutside => "external-data",
        UnprovenCause::ThrownByRunTime => "caught-value",
        UnprovenCause::ParameterOfEscapedFunction => "called-by-unknown-code",
        UnprovenCause::ContentsOfEscapedObject => "read-from-shared-object",
        UnprovenCause::ResultOfUnknownCallee => "unknown-callee-result",
        UnprovenCause::ObjectWithoutLayout => "no-fixed-layout",
        UnprovenCause::Untracked => "lost-track",
        UnprovenCause::LayoutOutsideFamily => "unexpected-shape",
        UnprovenCause::UnprovenEntryValue => "incoming-value",
        UnprovenCause::UnprovenStoredValue => "stored-value",
        UnprovenCause::UnprovenResultOfCall => "call-result",
        UnprovenCause::UnprovenState => "object-state",
        UnprovenCause::PlaceOfElement => "element-access",
        UnprovenCause::IndexMayBeUndefined => "index-may-be-undefined",
    }
}

pub(super) fn guard_cause_code(class: GuardClass) -> &'static str {
    match class {
        GuardClass::OtherType => "wrong-type",
        GuardClass::UnknownObject => "untyped-value",
        GuardClass::UnknownCallee => "unknown-callee",
        GuardClass::UnprovenContents => "untyped-collection",
        GuardClass::ProofWithheld => "analysis-disabled",
        GuardClass::ReadBeforeInitialized => "read-before-init",
        GuardClass::ElementAccess => "element-access",
        GuardClass::ObjectState => "object-state",
        GuardClass::NotRecorded => "unknown",
    }
}

pub(super) fn failure_code(failure: TypeTestFailure) -> &'static str {
    match failure {
        TypeTestFailure::TakesGenericPath => "rejoins",
        TypeTestFailure::Throws => "throws",
        TypeTestFailure::Leaves => "leaves",
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

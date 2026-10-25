use bun_trim::UnseenCodeCause;

use super::levels::AccessColumn;
use crate::ir::generated::{
    AllocationEscapeReason, AllocationHeapCause, ArrayChainDeclineReason, CallDeclineReason,
    CheckCause, DeclineKind, GeneratorFusionDeclineReason, IllTypedCause, InterpretedCause,
    KnowledgeLevel, LoopDeclineReason, StringBuilderDeclineReason, TypedResultDeclineReason,
    UnprovenCause,
};

pub(super) const DOCUMENTATION_URL: &[u8] = b"https://bun.com/docs/bundler/aot-explain#";

pub(super) struct CauseWording {
    pub message: &'static str,
    pub fix: &'static str,
}

pub(super) struct CheckWording {
    pub counted_as: &'static str,
    pub headline: &'static str,
    pub fix: &'static str,
}

pub(super) struct IllTypedWording {
    pub code: &'static str,
    pub message: &'static str,
    pub fix: &'static str,
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
            "this is a bug in Bun: please report it.",
        ),
        UnprovenCause::ResultDisabled => (
            "The analysis that proves this was turned off by a developer option.",
            "build without --aot-disable.",
        ),
        UnprovenCause::LimitReached => (
            "The analysis gave up here because it hit a compiler limit.",
            "the limit is shown above. Split the function or the type to get under it.",
        ),
        UnprovenCause::UnknownObject => (
            "An object from untyped code is used as this type here, so it can have any shape.",
            "build a new object of this type from it where it enters typed code.",
        ),
        UnprovenCause::NonLayoutObject => (
            "An array, a function or a built-in object is used as this type here.",
            "pass an object literal or a class instance, or declare the parameter with the type that is actually passed.",
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
        UnprovenCause::FieldDeleted => (
            "A property that the type requires is deleted here.",
            "declare the property optional, or assign undefined.",
        ),
        UnprovenCause::UnknownKeyDelete => (
            "A property is deleted here with a computed key.",
            "use a Map, or delete a constant key.",
        ),
        UnprovenCause::PropertyRedefined => (
            "A property of an object of this type is redefined here, for example as a getter or a setter.",
            "declare it as a field, a getter or a setter in the class or the object literal.",
        ),
        UnprovenCause::PropertyAdded => (
            "A property that the type does not declare is added to an object of this type here.",
            "declare the property in the class or the object type.",
        ),
        UnprovenCause::UnknownKeyStore => (
            "A property is assigned here with a computed key.",
            "use a Map or a Record type for data with computed keys.",
        ),
        UnprovenCause::StoreOfOtherType => (
            "A value of a different type is stored in this field here.",
            "store a value of the declared type, or widen the type of the field.",
        ),
        UnprovenCause::IntegrityChanged => (
            "An object of this type is passed to Object.freeze, Object.seal or Object.preventExtensions here.",
            "freeze the object where it is created, or freeze a copy.",
        ),
        UnprovenCause::PrototypeChanged => (
            "The prototype of an object of this type is changed here.",
            "create the object with the prototype it needs.",
        ),
        UnprovenCause::OwnPropertyHidesMember => (
            "A property added to an instance can shadow a method of its class.",
            "declare the property in the class.",
        ),
        UnprovenCause::OtherNewTarget => (
            "This class is constructed with a different new.target (Reflect.construct, or a subclass from untyped code).",
            "construct it with new.",
        ),
        UnprovenCause::LeftByPasses => (
            "The compiler proved the types here and still emitted the slow path.",
            "this is a missed optimization in Bun, not a problem in your code. Please report it.",
        ),
        UnprovenCause::UndescribedNativeResult => (
            "The value is the result of a built-in function whose result type the compiler doesn't know.",
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
            "The value was caught, and anything can be thrown.",
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
            "The value is returned by a call whose callee isn't known at build time.",
            "give the callee a function type.",
        ),
        UnprovenCause::ObjectWithoutLayout => (
            "The object is made by a function that the compiler found no fixed layout for.",
            "use a class or an object literal.",
        ),
        UnprovenCause::Untracked => (
            "The compiler stopped tracking the objects that reach this access.",
            "give the value a declared type, or split the function.",
        ),
        UnprovenCause::LayoutOutsideFamily => (
            "An object reaches this access with a shape its declared type doesn't include.",
            "trace the object back from here. An unsound cast hides it from TypeScript.",
        ),
    };
    CauseWording { message, fix }
}

pub(super) fn check_wording(cause: CheckCause) -> CheckWording {
    match cause {
        CheckCause::Unknown => CheckWording {
            counted_as: "with no recorded cause",
            headline: "the compiler couldn't prove the type of this value",
            fix: "this is a bug in Bun: please report it",
        },
        CheckCause::UnknownObject => CheckWording {
            counted_as: "on a value from untyped code",
            headline: "the value may come from untyped code",
            fix: "narrow it first: typeof for a primitive. For an object, check its fields and build a new object of the type from them",
        },
        CheckCause::UnknownCallee => CheckWording {
            counted_as: "on the result of an unknown callee",
            headline: "the value is returned by a call whose callee isn't known at build time",
            fix: "call the function directly, or narrow the result",
        },
        CheckCause::UnprovenContents => CheckWording {
            counted_as: "on an element of a collection",
            headline: "the array, Map or Set it's read from may contain values of other types",
            fix: "only add to the collection from typed code, or narrow the element after reading it",
        },
        CheckCause::MayFail => CheckWording {
            counted_as: "on a value of the wrong type",
            headline: "a value of the wrong type reaches this guard",
            fix: "trace the value back from here: an unsound cast ('as', 'any' or '!') hides the mismatch from TypeScript",
        },
        CheckCause::LimitReached => CheckWording {
            counted_as: "where the analysis hit a limit",
            headline: "the analysis gave up on this value because it hit a compiler limit",
            fix: "give the values a common class, or split the function",
        },
        CheckCause::ResultDisabled => CheckWording {
            counted_as: "because a developer option turned the proof off",
            headline: "the analysis that proves this was turned off",
            fix: "build without --aot-disable",
        },
        CheckCause::AddedByPass => CheckWording {
            counted_as: "added by the compiler",
            headline: "the compiler added this guard for an optimization",
            fix: "nothing to fix: it can only fail if another guard in this list fails",
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
            "A type error is suppressed here (@ts-ignore, @ts-expect-error, @ts-nocheck).",
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
        IllTypedCause::StoreOutsideFieldType => (
            "wrong-type-stored",
            "A value of a different type is stored in this field somewhere in the program.",
            "store a value of the declared type, or widen the field's type.",
        ),
        IllTypedCause::ComputedKeyStore => (
            "computed-key-store",
            "A store with a computed key may write this field.",
            "use a Map or a Record type for data with computed keys.",
        ),
        IllTypedCause::UnprovenReceiverStore => (
            "store-through-unknown-object",
            "A store through an object of unknown type may write this field.",
            "give that object a type.",
        ),
        IllTypedCause::NativeWritesOperand => (
            "passed-to-builtin",
            "The object is passed to a built-in function that may write to it.",
            "pass a copy, or only the fields the function needs.",
        ),
        IllTypedCause::StateChanged => (
            "object-changed",
            "A delete, Object.defineProperty, Object.setPrototypeOf or Object.freeze changes an object of this type.",
            "declare the property optional, or create the object in its final form.",
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
            "check the index, or loop with for...of.",
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
        IllTypedCause::LookupMayChange => (
            "lookup-may-change",
            "The method can be replaced, shadowed or overridden at run time, so the call isn't resolved at build time.",
            "don't assign to methods or prototypes after the class is defined.",
        ),
    };
    Some(IllTypedWording { code, message, fix })
}

pub(super) fn decline_sentence(kind: DeclineKind) -> &'static str {
    match kind {
        DeclineKind::Unknown => "no reason was recorded",
        DeclineKind::HotCallNotInlined => "a hot call was not inlined",
        DeclineKind::HotCallNotResolved => "the callee of a hot call isn't known at build time",
        DeclineKind::GeneratorLoopNotFused => {
            "a generator wasn't inlined into its loop, so every iteration suspends and resumes it"
        }
        DeclineKind::ArrayChainNotFused => {
            "a chain of array methods wasn't fused, so it allocates the intermediate arrays"
        }
        DeclineKind::StringBuilderNotCreated => {
            "strings are concatenated in a loop without a string builder"
        }
        DeclineKind::StringBuildersNotJoined => {
            "a string is built separately and then copied into a larger string"
        }
        DeclineKind::AllocationNotSunk => {
            "an allocation couldn't be removed or moved to the stack (see --explain=allocations)"
        }
        DeclineKind::TypedResultNotSelected => {
            "a built-in call returns a boxed value even though a typed version exists"
        }
        DeclineKind::IterationNotExpandedByClass => {
            "a loop uses the iterator protocol because the type of the iterable isn't known"
        }
        DeclineKind::LoopNotVersioned => {
            "loop guards couldn't be hoisted, so they run on every iteration"
        }
        DeclineKind::LoopBoundNotClamped => {
            "bounds checks couldn't be hoisted out of a loop, so they run on every iteration"
        }
        DeclineKind::StretchNotGuarded => {
            "code with expected types got no fast path, so it always takes the slow path"
        }
        DeclineKind::ResultNodeInterpreted => {
            "part of the type that a parse is written under is built by the generic parser, not compiled code"
        }
        DeclineKind::GenericVersionNotCreated => {
            "a function got no slow path, so values are guarded at every use instead of checked once"
        }
    }
}

pub(super) fn typed_result_decline_sentence(reason: u32) -> Option<&'static str> {
    match TypedResultDeclineReason::from_wire(reason)? {
        TypedResultDeclineReason::None => None,
        TypedResultDeclineReason::NoTarget => Some("the result isn't converted to a declared type"),
        TypedResultDeclineReason::TargetIsNotModeledByFlow => Some(
            "the declared type only becomes visible after inlining, or it reaches more object and array types than one call handles",
        ),
        TypedResultDeclineReason::TargetHasNoTypedPart => {
            Some("the type contains no object or array")
        }
        TypedResultDeclineReason::PromiseIsNotAwaitedAtOnce => {
            Some("the promise isn't awaited immediately")
        }
        TypedResultDeclineReason::HostHasNoBytesForm => Some("the class has no bytes() method"),
        TypedResultDeclineReason::RowsHaveSeveralLayouts => {
            Some("the rows have more than one shape")
        }
        TypedResultDeclineReason::AnotherSourceIsOpen => {
            Some("the function is still parsing another string")
        }
    }
}

pub(super) fn call_decline_sentence(reason: u32) -> Option<&'static str> {
    match CallDeclineReason::from_wire(reason)? {
        CallDeclineReason::None => None,
        CallDeclineReason::UnknownCallee => Some("the callee could be any function"),
        CallDeclineReason::CalleeNotCallable => {
            Some("none of the possible callees can be called this way")
        }
        CallDeclineReason::CalleeNeedsClosure => {
            Some("the method is a closure, so the call needs its function object")
        }
        CallDeclineReason::UnknownMember => {
            Some("a possible receiver may have a different function under this name")
        }
        CallDeclineReason::NeedsTest => {
            Some("the callee is only expected, so the call needs a guard")
        }
        CallDeclineReason::EffectsBeforeCall => {
            Some("other code runs between loading the method and calling it")
        }
        CallDeclineReason::TooManyCallees => Some("the call site has too many possible callees"),
    }
}

pub(super) fn generator_fusion_decline_sentence(reason: u32) -> Option<&'static str> {
    match GeneratorFusionDeclineReason::from_wire(reason)? {
        GeneratorFusionDeclineReason::Unknown => Some("the compiler lost track of the generator"),
        GeneratorFusionDeclineReason::None => None,
        GeneratorFusionDeclineReason::BodyIsNotDescribed => {
            Some("the generator function's body isn't visible here")
        }
        GeneratorFusionDeclineReason::HasNoStep => {
            Some("the function that creates the generator never resumes it")
        }
        GeneratorFusionDeclineReason::SeveralLiveInstances => {
            Some("more than one generator created here can be live at the same time")
        }
        GeneratorFusionDeclineReason::StepMayReachOtherGenerator => {
            Some("a next(), return() or throw() call in the loop may resume a different generator")
        }
        GeneratorFusionDeclineReason::MayEscapeBeforeStep => {
            Some("the generator escapes while the loop runs")
        }
        GeneratorFusionDeclineReason::BodyIsBoundToFrame => {
            Some("the generator's body can't be moved out of its own stack frame")
        }
        GeneratorFusionDeclineReason::BodyIsTooLarge => {
            Some("the generator's body is too large to inline")
        }
        GeneratorFusionDeclineReason::CallerIsTooLarge => {
            Some("inlining would make the caller too large")
        }
        GeneratorFusionDeclineReason::InlineDepth => {
            Some("the inlining depth limit was hit, or the generator is recursive")
        }
    }
}

pub(super) fn array_chain_decline_sentence(reason: u32) -> Option<&'static str> {
    match ArrayChainDeclineReason::from_wire(reason)? {
        ArrayChainDeclineReason::Unknown => Some("the compiler recorded no reason"),
        ArrayChainDeclineReason::None => None,
        ArrayChainDeclineReason::SourceIsNotPristine => {
            Some("the first array may have holes, or its methods may have been overridden")
        }
        ArrayChainDeclineReason::CallbackIsNotAFunction => Some("a callback may not be a function"),
        ArrayChainDeclineReason::CalleeIsUnknown => Some("a callback is not known at build time"),
        ArrayChainDeclineReason::CallbackSeesIntermediateArray => {
            Some("a callback uses its array argument, which is an intermediate array")
        }
        ArrayChainDeclineReason::CallbacksInterfere => {
            Some("one callback can observe the order the others run in")
        }
        ArrayChainDeclineReason::SkippedCallIsObservable => {
            Some("a callback with side effects would run fewer times")
        }
        ArrayChainDeclineReason::CallbackWritesSource => {
            Some("a callback may write to the first array")
        }
        ArrayChainDeclineReason::ValueBetweenLinksInterferes => {
            Some("code between the chained calls depends on the callbacks' side effects")
        }
    }
}

pub(super) fn string_builder_decline_sentence(reason: u32) -> Option<&'static str> {
    match StringBuilderDeclineReason::from_wire(reason)? {
        StringBuilderDeclineReason::Unknown => Some("the compiler recorded no reason"),
        StringBuilderDeclineReason::Created => Some("a string builder was created"),
        StringBuilderDeclineReason::TooFewAppends => {
            Some("too few appends for a string builder to be worth it")
        }
        StringBuilderDeclineReason::TwoStatesLive => {
            Some("an earlier value of the string is used after more was appended")
        }
        StringBuilderDeclineReason::StateIsNotFirstOperand => {
            Some("the string is not the left operand of the concatenation")
        }
        StringBuilderDeclineReason::WebLimit => {
            Some("the function builds more strings than the compiler tracks")
        }
    }
}

pub(super) fn loop_decline_sentence(reason: u32) -> Option<&'static str> {
    match LoopDeclineReason::from_wire(reason)? {
        LoopDeclineReason::None => None,
        LoopDeclineReason::NotInnermost => Some("the loop contains another loop"),
        LoopDeclineReason::SeveralEntries => Some("the loop has more than one entry"),
        LoopDeclineReason::NoSingleLikelyPath => Some("the loop body has no single hot path"),
        LoopDeclineReason::UncloneableValue => {
            Some("the loop has an operation that can't be duplicated")
        }
        LoopDeclineReason::NothingToHoist => Some("too few guards can be hoisted out of the loop"),
        LoopDeclineReason::NotCounted => Some("the loop isn't a counted loop with a constant step"),
        LoopDeclineReason::CounterMayWrap => Some("the loop counter may overflow"),
        LoopDeclineReason::BoundNotInvariant => Some("the loop bound isn't loop-invariant"),
        LoopDeclineReason::TestNotOnLikelyPath => {
            Some("the loop's exit test isn't on its hot path")
        }
        LoopDeclineReason::EffectsBeforeTopTest => {
            Some("code with side effects runs before the loop's exit test")
        }
        LoopDeclineReason::LimitReached => Some("the loop exceeds a compiler limit"),
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

pub(super) fn interpreted_cause_sentence(reason: u32) -> Option<&'static str> {
    match InterpretedCause::from_wire(reason)? {
        InterpretedCause::None => None,
        InterpretedCause::RepeatedRecursion => Some("two members of a union are both recursive"),
        InterpretedCause::LayoutIsNotModeled => Some("no call in the program parses this type"),
        InterpretedCause::FieldTypeIsNotTestable => {
            Some("a field's proven type can't be checked at run time")
        }
    }
}

pub(super) fn unseen_code_sentence(cause: UnseenCodeCause) -> &'static str {
    match cause {
        UnseenCodeCause::ProgramNotCompiled => "the program wasn't built with --aot",
        UnseenCodeCause::ReportMissing => "the compiler didn't report which APIs are used",
        UnseenCodeCause::FlowResultDisabled => "a developer option turned the analysis off",
        UnseenCodeCause::FlowGaveUp => "the analysis hit a compiler limit",
        UnseenCodeCause::EvaluatesText => "the program calls eval() or new Function()",
        UnseenCodeCause::ImportsUncompiledCode => {
            "the program imports a module that isn't in the executable"
        }
        UnseenCodeCause::LoadsModuleByName | UnseenCodeCause::LoadsCodeByName => {
            "the program calls import() or require() with a dynamic path"
        }
        UnseenCodeCause::RunsUnseenCode => "the program can run code that isn't in the executable",
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

pub(super) fn cause_code(cause: UnprovenCause) -> &'static str {
    match cause {
        UnprovenCause::Unknown => "unknown",
        UnprovenCause::ResultDisabled => "analysis-disabled",
        UnprovenCause::LimitReached => "limit-reached",
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
        UnprovenCause::FieldDeleted => "field-deleted",
        UnprovenCause::UnknownKeyDelete => "computed-key-delete",
        UnprovenCause::PropertyRedefined => "property-redefined",
        UnprovenCause::PropertyAdded => "property-added",
        UnprovenCause::UnknownKeyStore => "computed-key-store",
        UnprovenCause::StoreOfOtherType => "wrong-type-stored",
        UnprovenCause::IntegrityChanged => "frozen",
        UnprovenCause::PrototypeChanged => "prototype-changed",
        UnprovenCause::OwnPropertyHidesMember => "method-shadowed",
        UnprovenCause::OtherNewTarget => "other-new-target",
        UnprovenCause::LeftByPasses => "missed-optimization",
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
    }
}

pub(super) fn guard_cause_code(cause: CheckCause) -> &'static str {
    match cause {
        CheckCause::Unknown => "unknown",
        CheckCause::UnknownObject => "untyped-value",
        CheckCause::UnknownCallee => "unknown-callee",
        CheckCause::UnprovenContents => "untyped-collection",
        CheckCause::MayFail => "wrong-type",
        CheckCause::LimitReached => "limit-reached",
        CheckCause::ResultDisabled => "analysis-disabled",
        CheckCause::AddedByPass => "added-by-compiler",
    }
}

pub(super) fn missed_optimization_code(kind: DeclineKind) -> &'static str {
    match kind {
        DeclineKind::Unknown => "unknown",
        DeclineKind::HotCallNotInlined => "not-inlined",
        DeclineKind::HotCallNotResolved => "unknown-callee",
        DeclineKind::GeneratorLoopNotFused => "generator-not-inlined",
        DeclineKind::ArrayChainNotFused => "array-chain-not-fused",
        DeclineKind::StringBuilderNotCreated => "no-string-builder",
        DeclineKind::StringBuildersNotJoined => "string-copied",
        DeclineKind::AllocationNotSunk => "heap-allocation",
        DeclineKind::TypedResultNotSelected => "boxed-result",
        DeclineKind::IterationNotExpandedByClass => "iterator-protocol",
        DeclineKind::LoopNotVersioned => "loop-guards-not-hoisted",
        DeclineKind::LoopBoundNotClamped => "bounds-checks-not-hoisted",
        DeclineKind::StretchNotGuarded => "no-fast-path",
        DeclineKind::ResultNodeInterpreted => "generic-parser",
        DeclineKind::GenericVersionNotCreated => "guarded-at-every-use",
    }
}

pub(super) fn trim_blocker_code(cause: UnseenCodeCause) -> &'static str {
    match cause {
        UnseenCodeCause::ProgramNotCompiled => "no-aot",
        UnseenCodeCause::ReportMissing => "no-report",
        UnseenCodeCause::FlowResultDisabled => "analysis-disabled",
        UnseenCodeCause::FlowGaveUp => "limit-reached",
        UnseenCodeCause::EvaluatesText => "eval",
        UnseenCodeCause::ImportsUncompiledCode => "external-import",
        UnseenCodeCause::LoadsModuleByName | UnseenCodeCause::LoadsCodeByName => "dynamic-import",
        UnseenCodeCause::RunsUnseenCode => "runtime-code",
        UnseenCodeCause::OptionAdmitsCode => "build-option",
    }
}

#[cfg(test)]
mod tests;

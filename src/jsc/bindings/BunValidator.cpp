#include "root.h"

#include "BunValidator.h"
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/ThreadSafeRefCounted.h>
#if ENABLE(AOT)
#include <JavaScriptCore/AOTRemovableFeature.h>
#endif

namespace Bun {

using namespace JSC;

namespace {

class ValidatorState final : public ThreadSafeRefCounted<ValidatorState> {
public:
    static Ref<ValidatorState> create(ValidatorNodes&& nodes) { return adoptRef(*new ValidatorState(WTF::move(nodes))); }

    ValidationPlan& plan() const { return m_nodes.plan.get(); }

    // Only an error report needs the text.
    const String& planText()
    {
        if (m_planText.isNull())
            m_planText = writeValidationPlanText(m_nodes);
        return m_planText;
    }

    bool fillsDefaults() const
    {
        for (auto& node : plan().nodes) {
            if (node.defaultKind != ValidationPlan::Literal::None)
                return true;
        }
        return false;
    }

private:
    explicit ValidatorState(ValidatorNodes&& nodes)
        : m_nodes(WTF::move(nodes))
    {
    }

    ValidatorNodes m_nodes;
    String m_planText;
};

} // namespace

static JSValue callWith(JSGlobalObject* globalObject, JSObject* function, JSValue argument)
{
    MarkedArgumentBuffer arguments;
    arguments.append(argument);
    return call(globalObject, function, getCallData(function), jsUndefined(), arguments);
}

// The engine's own JSON.parse, whatever the program has stored under that name.
static JSFunction* createJSONParse(VM& vm, JSGlobalObject* globalObject)
{
    const HashTableValue* entry = JSONObject::info()->staticPropHashTable->entry(Identifier::fromString(vm, "parse"_s));
    RELEASE_ASSERT(entry && (entry->attributes() & PropertyAttribute::Function));
    return JSFunction::create(vm, globalObject, 2, "parse"_s, entry->function(), ImplementationVisibility::Public);
}

static JSObject* createResult(VM& vm, JSGlobalObject* globalObject, ASCIILiteral key, JSValue value)
{
    JSObject* result = constructEmptyObject(globalObject);
    result->putDirect(vm, Identifier::fromString(vm, key), value);
    return result;
}

static EncodedJSValue createValidator(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

#if ENABLE(AOT)
    if (globalObject->aotInstance()) {
        throwTypeError(globalObject, scope, "Bun.Validator isn't supported in an executable built with --aot. Use validate<T>(value) or JSON.parse<T>(text)"_s);
        return {};
    }
#endif

    JSObject* constructor = callFrame->jsCallee();
    JSValue prototype = constructor->getDirect(vm, vm.propertyNames->prototype);
    JSObject* newTarget = asObject(callFrame->newTarget());
    if (newTarget != constructor) {
        JSValue derived = newTarget->get(globalObject, vm.propertyNames->prototype);
        RETURN_IF_EXCEPTION(scope, {});
        if (derived.isObject())
            prototype = derived;
    }

    std::optional<ValidatorNodes> nodes = readJSONSchema(globalObject, callFrame->argument(0), callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    Ref<ValidatorState> state = ValidatorState::create(WTF::move(*nodes));
    Ref<ValidationPlan> plan = state->plan();

    auto throwTooLarge = [&] {
        throwTypeError(globalObject, scope, "JSON Schema is too large or too deeply nested"_s);
        return EncodedJSValue {};
    };

    JSFunction* check = createCheckFunction(vm, globalObject, plan.copyRef());
    RETURN_IF_EXCEPTION(scope, {});
    if (!check)
        return throwTooLarge();

    JSObject* onRefused = JSNativeStdFunction::create(vm, globalObject, 1, String(), [state](JSGlobalObject* globalObject, CallFrame* callFrame) -> EncodedJSValue {
        throwValidationError(globalObject, state->planText(), callFrame->argument(0));
        return {};
    });

    // The copy is plain data that nobody else holds. Bytecode that copies gives up on a few kinds of plain data, such as very large index keys. Bytecode that only checks does not.
    JSObject* onCopyNotCopied = JSNativeStdFunction::create(vm, globalObject, 1, String(), [state, check](JSGlobalObject* globalObject, CallFrame* callFrame) -> EncodedJSValue {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSValue copy = callFrame->argument(0);
        JSValue isValid = callWith(globalObject, check, copy);
        RETURN_IF_EXCEPTION(scope, {});
        if (isValid.isTrue() && !state->fillsDefaults())
            return JSValue::encode(copy);
        throwValidationError(globalObject, state->planText(), copy);
        return {}; }, check);

    JSFunction* validateCopy = createValidateFunction(vm, globalObject, plan.copyRef(), onRefused, onCopyNotCopied);
    RETURN_IF_EXCEPTION(scope, {});
    if (!validateCopy)
        return throwTooLarge();

    // Getters and proxy traps run here, once. The bytecode then decides about the copy.
    // A value that validate() refuses comes here too: where the bytecode only checks, as under a union, it refuses a proxy without reading it.
    JSObject* onBailout = JSNativeStdFunction::create(vm, globalObject, 1, String(), [state, validateCopy](JSGlobalObject* globalObject, CallFrame* callFrame) -> EncodedJSValue {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSValue copy = copyForValidation(globalObject, state->plan(), callFrame->argument(0));
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, JSValue::encode(callWith(globalObject, validateCopy, copy))); }, validateCopy);

    JSFunction* validate = createValidateFunction(vm, globalObject, plan.copyRef(), onBailout, onBailout);
    RETURN_IF_EXCEPTION(scope, {});
    if (!validate)
        return throwTooLarge();

    // parse() with a reviver, or with something that is not a string. What a reviver returns is an object that the program holds, so it is validated and returned as it is.
    JSFunction* parseJSON = createJSONParse(vm, globalObject);
    JSObject* onOtherArguments = JSNativeStdFunction::create(vm, globalObject, 2, String(), [validate, parseJSON](JSGlobalObject* globalObject, CallFrame* callFrame) -> EncodedJSValue {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        MarkedArgumentBuffer arguments;
        for (unsigned i = 0; i < callFrame->argumentCount(); ++i)
            arguments.append(callFrame->uncheckedArgument(i));
        JSValue parsed = call(globalObject, parseJSON, getCallData(parseJSON), jsUndefined(), arguments);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue copy = callWith(globalObject, validate, parsed);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(callFrame->argumentCount() < 2 ? copy : parsed); }, validate, parseJSON);

    JSFunction* parse = createParseFunction(vm, globalObject, plan.copyRef(), onRefused, onBailout, onOtherArguments);
    RETURN_IF_EXCEPTION(scope, {});
    if (!parse)
        return throwTooLarge();

    JSObject* issues = JSNativeStdFunction::create(vm, globalObject, 1, "issues"_s, [state, check](JSGlobalObject* globalObject, CallFrame* callFrame) -> EncodedJSValue {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSValue copy = copyForValidation(globalObject, state->plan(), callFrame->argument(0));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue isValid = callWith(globalObject, check, copy);
        RETURN_IF_EXCEPTION(scope, {});
        if (isValid.isTrue())
            RELEASE_AND_RETURN(scope, JSValue::encode(constructEmptyArray(globalObject, nullptr)));
        RELEASE_AND_RETURN(scope, JSValue::encode(collectValidationIssues(globalObject, state->planText(), copy))); }, check);

    JSObject* validateForStandardSchema = JSNativeStdFunction::create(vm, globalObject, 1, "validate"_s, [state, check, validateCopy](JSGlobalObject* globalObject, CallFrame* callFrame) -> EncodedJSValue {
        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSValue copy = copyForValidation(globalObject, state->plan(), callFrame->argument(0));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue isValid = callWith(globalObject, check, copy);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue result = isValid.isTrue() ? callWith(globalObject, validateCopy, copy) : collectValidationIssues(globalObject, state->planText(), copy);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(createResult(vm, globalObject, isValid.isTrue() ? "value"_s : "issues"_s, result)); }, check, validateCopy);

    constexpr unsigned frozen = PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete;
    JSObject* standard = constructEmptyObject(globalObject);
    standard->putDirect(vm, Identifier::fromString(vm, "version"_s), jsNumber(1), frozen);
    standard->putDirect(vm, Identifier::fromString(vm, "vendor"_s), jsNontrivialString(vm, "bun"_s), frozen);
    standard->putDirect(vm, Identifier::fromString(vm, "validate"_s), validateForStandardSchema, frozen);
    JSObject::preventExtensions(standard, globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // The methods are own properties, so a call goes straight to the generated function and the JIT can inline it.
    constexpr unsigned fixed = frozen | PropertyAttribute::DontEnum;
    JSObject* validator = constructEmptyObject(globalObject, asObject(prototype));
    validator->putDirect(vm, Identifier::fromString(vm, "check"_s), check, fixed);
    validator->putDirect(vm, Identifier::fromString(vm, "validate"_s), validate, fixed);
    validator->putDirect(vm, Identifier::fromString(vm, "parse"_s), parse, fixed);
    validator->putDirect(vm, Identifier::fromString(vm, "issues"_s), issues, fixed);
    validator->putDirect(vm, Identifier::fromString(vm, "schema"_s), callFrame->argument(0), fixed);
    validator->putDirect(vm, Identifier::fromString(vm, "~standard"_s), standard, fixed);
    JSObject::preventExtensions(validator, globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(validator);
}

static JSC_DECLARE_HOST_FUNCTION(callValidatorConstructor);
static JSC_DECLARE_HOST_FUNCTION(constructValidator);

JSC_DEFINE_HOST_FUNCTION(callValidatorConstructor, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    throwTypeError(globalObject, scope, "Class constructor Validator cannot be invoked without 'new'"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(constructValidator, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if ENABLE(AOT)
    // The bytecode needs the engine's tiers, which an AOT-compiled executable leaves out.
    return callRemovable<RemovableFeature::JIT, RemovedFeatureStub::Throw, createValidator>(globalObject, callFrame);
#else
    return createValidator(globalObject, callFrame);
#endif
}

namespace {

class ValidatorConstructor final : public InternalFunction {
public:
    using Base = InternalFunction;

    static ValidatorConstructor* create(VM& vm, Structure* structure, JSObject* prototype)
    {
        auto* constructor = new (NotNull, allocateCell<ValidatorConstructor>(vm)) ValidatorConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
    }

    DECLARE_INFO;

private:
    ValidatorConstructor(VM& vm, Structure* structure)
        : Base(vm, structure, callValidatorConstructor, constructValidator)
    {
    }

    void finishCreation(VM& vm, JSObject* prototype)
    {
        Base::finishCreation(vm, 1, "Validator"_s, PropertyAdditionMode::WithoutStructureTransition);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    }
};

const ClassInfo ValidatorConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ValidatorConstructor) };

} // namespace

JSValue constructValidatorConstructor(VM& vm, JSObject* bunObject)
{
    JSGlobalObject* globalObject = bunObject->globalObject();
    JSObject* prototype = constructEmptyObject(globalObject);
    prototype->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsNontrivialString(vm, "Validator"_s), PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly);
    auto* constructor = ValidatorConstructor::create(vm, ValidatorConstructor::createStructure(vm, globalObject, globalObject->functionPrototype()), prototype);
    prototype->putDirect(vm, vm.propertyNames->constructor, constructor, static_cast<unsigned>(PropertyAttribute::DontEnum));
    return constructor;
}

} // namespace Bun

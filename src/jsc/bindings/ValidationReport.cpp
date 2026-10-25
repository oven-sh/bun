#include "root.h"

#include "BunValidator.h"
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SourceCode.h>
#include <wtf/text/SymbolImpl.h>
#if ENABLE(AOT)
#include <JavaScriptCore/AOTRemovableFeature.h>
#include <JavaScriptCore/AOTRuntimeTable.h>
#endif

// The bytecode has already refused the value. JavaScript (src/aot/prelude/validation.ts) finds the words for the error,
// and this file makes the error. If the JavaScript fails or returns anything unexpected, the error gets a generic message.
namespace Bun {

using namespace JSC;

static constexpr ASCIILiteral genericValidationMessage = "Expected value to match the schema"_s;

namespace {

struct ValidationReport {
    JSValue message;
    JSArray* issues { nullptr };
    // What the JavaScript threw, if it threw.
    JSValue cause;
};

} // namespace

#if ENABLE(AOT)

struct ValidationLibraryText {
    const uint8_t* pointer;
    size_t length;
};
extern "C" ValidationLibraryText Bun__AOT__validationLibrary();

static SymbolImpl::StaticSymbolImpl validationReportPrivateName { "validationReport"_s, SymbolImpl::s_flagIsPrivate };
static SymbolImpl::StaticSymbolImpl preparedValidationPlansPrivateName { "preparedValidationPlans"_s, SymbolImpl::s_flagIsPrivate };

// report(value, planText, preparedPlans) => [message, issues], or undefined if it finds nothing wrong.
// Evaluated once per global object. Returns null if this executable has no library.
static JSObject* ensureReportFunction(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    PropertyName name(&static_cast<SymbolImpl&>(validationReportPrivateName));
    if (JSValue known = globalObject->getDirect(vm, name))
        return asObject(known);

    // Removing the types from the library takes the type checker's parser. AOT-compiled executables leave out the parser and the JIT.
    ValidationLibraryText text = JSC::callRemovable<JSC::RemovableFeature::JIT, JSC::RemovedFeatureStub::ReturnDefault, Bun__AOT__validationLibrary>();
    if (!text.length)
        return nullptr;

    NakedPtr<JSC::Exception> exception;
    SourceCode source = makeSource(String::fromUTF8(std::span { text.pointer, text.length }), SourceOrigin(), SourceTaintedOrigin::Untainted, "bun:validation"_s);
    JSValue report = JSC::evaluate(globalObject, source, globalObject->globalThis(), exception);
    if (exception) [[unlikely]] {
        throwException(globalObject, scope, exception.get());
        return nullptr;
    }
    if (!report.isCallable())
        return nullptr;
    globalObject->putDirect(vm, name, report, PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete);
    return asObject(report);
}

// The library keeps the parsed nodes of each plan in this map. A program can create any number of validators, so the map starts over when it is full.
static JSMap* ensurePreparedPlans(JSGlobalObject* globalObject, JSObject* report)
{
    constexpr uint32_t maxPreparedPlans = 1024;
    VM& vm = globalObject->vm();
    PropertyName name(&static_cast<SymbolImpl&>(preparedValidationPlansPrivateName));
    if (JSValue known = report->getDirect(vm, name)) {
        auto* plans = uncheckedDowncast<JSMap>(known);
        if (plans->size() < maxPreparedPlans)
            return plans;
    }
    JSMap* plans = JSC::AOT::createPreparedPlans(globalObject);
    report->putDirect(vm, name, plans, static_cast<unsigned>(PropertyAttribute::DontEnum));
    return plans;
}

static JSValue callReportFunction(JSGlobalObject* globalObject, const String& planText, JSValue refusedValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* report = ensureReportFunction(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (!report)
        return {};

    MarkedArgumentBuffer arguments;
    arguments.append(refusedValue);
    arguments.append(jsString(vm, planText));
    arguments.append(ensurePreparedPlans(globalObject, report));
    RELEASE_AND_RETURN(scope, JSC::call(globalObject, report, JSC::getCallData(report), jsUndefined(), arguments));
}

#else

static JSValue callReportFunction(JSGlobalObject*, const String&, JSValue)
{
    return {};
}

#endif // ENABLE(AOT)

// Takes [message, issues] only if it is a string and an array that starts with an object. Runs no JavaScript.
static bool readReport(JSValue returned, ValidationReport& report)
{
    auto* pair = returned ? dynamicDowncast<JSArray>(returned) : nullptr;
    if (!pair || !pair->canGetIndexQuickly(0u) || !pair->canGetIndexQuickly(1u))
        return false;
    JSValue message = pair->getIndexQuickly(0u);
    auto* issues = dynamicDowncast<JSArray>(pair->getIndexQuickly(1u));
    if (!message.isString() || !issues || !issues->canGetIndexQuickly(0u) || !issues->getIndexQuickly(0u).isObject())
        return false;
    report.message = message;
    report.issues = issues;
    return true;
}

static JSArray* createGenericIssues(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* path = constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSArray* issues = constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, nullptr);

    JSObject* issue = constructEmptyObject(globalObject);
    issue->putDirect(vm, Identifier::fromString(vm, "code"_s), jsNontrivialString(vm, "invalid_type"_s));
    issue->putDirect(vm, Identifier::fromString(vm, "path"_s), path);
    issue->putDirect(vm, vm.propertyNames->message, jsNontrivialString(vm, genericValidationMessage));
    issues->putDirectIndex(globalObject, 0, issue);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return issues;
}

// Returns a message and at least one issue, or leaves an exception pending.
static ValidationReport createReport(JSGlobalObject* globalObject, const String& planText, JSValue refusedValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ValidationReport report;

    JSValue returned = callReportFunction(globalObject, planText, refusedValue);
    if (JSC::Exception* exception = scope.exception()) [[unlikely]] {
        report.cause = exception->value();
        returned = {};
        // A termination stays pending.
        if (!scope.tryClearException())
            return {};
    }
    if (readReport(returned, report)) [[likely]]
        return report;

    report.issues = createGenericIssues(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    report.message = jsNontrivialString(vm, genericValidationMessage);
    return report;
}

void throwValidationError(JSGlobalObject* globalObject, const String& planText, JSValue refusedValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ValidationReport report = createReport(globalObject, planText, refusedValue);
    RETURN_IF_EXCEPTION(scope, );

    ErrorInstance* error = ErrorInstance::create(vm, globalObject->errorStructure(ErrorType::TypeError), String(), report.cause, nullptr, TypeNothing, ErrorType::TypeError, true);
    error->putDirect(vm, vm.propertyNames->message, report.message, static_cast<unsigned>(PropertyAttribute::DontEnum));
    error->putDirect(vm, Identifier::fromString(vm, "issues"_s), report.issues);
    throwException(globalObject, scope, error);
}

JSValue collectValidationIssues(JSGlobalObject* globalObject, const String& planText, JSValue refusedValue)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    ValidationReport report = createReport(globalObject, planText, refusedValue);
    RETURN_IF_EXCEPTION(scope, {});
    return report.issues;
}

} // namespace Bun

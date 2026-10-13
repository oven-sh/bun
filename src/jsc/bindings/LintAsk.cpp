// How the program in src/lint/js_plugin/worker reads what Rust says: numbers and text, straight from Rust's memory.
// src/lint/js_plugin/wire.rs lists what can be asked for.

#include "root.h"

#include "LintHost.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>

namespace Bun {
using namespace JSC;

// The answer to `kind`, the first argument, with the details in the second, a string. Null with an exception if these aren't as expected
// or nothing is being handled.
static std::span<const uint8_t> askForLint(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue kind = callFrame->argument(0);
    JSValue details = callFrame->argument(1);
    if (!kind.isNumber() || !(details.isString() || details.isUndefined())) {
        throwTypeError(globalObject, scope, "Expected a number and a string"_s);
        return {};
    }
    UTF8CString bytes;
    if (details.isString()) {
        auto text = asString(details)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        bytes = text.data.utf8();
    }
    LintSpan answer = Bun__Lint__ask(globalObject, JSC::toUInt32(kind.asNumber()), bytes.length() ? byteCast<uint8_t>(bytes.span()).data() : nullptr, bytes.length());
    if (!answer.ptr) {
        throwTypeError(globalObject, scope, "Nothing is being handled"_s);
        return {};
    }
    return { answer.ptr, answer.len };
}

// `askText(kind, details, start = 0, end = the length)`: the text that these bytes of the answer are in UTF-8.
JSC_DEFINE_HOST_FUNCTION(jsLintAskText, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto answer = askForLint(globalObject, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    auto index = [&](JSValue value, size_t otherwise) { return value.isNumber() ? std::min<size_t>(JSC::toUInt32(value.asNumber()), answer.size()) : otherwise; };
    size_t end = index(callFrame->argument(3), answer.size());
    size_t start = std::min(index(callFrame->argument(2), 0), end);
    return JSValue::encode(jsString(vm, String::fromUTF8ReplacingInvalidSequences(byteCast<char8_t>(answer.subspan(start, end - start)))));
}

// `askWords(kind, details, count)`: a `Uint32Array` of the first `count` words of the answer, or of as many as it has.
JSC_DEFINE_HOST_FUNCTION(jsLintAskWords, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto answer = askForLint(globalObject, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue count = callFrame->argument(2);
    size_t length = std::min<size_t>(count.isNumber() ? JSC::toUInt32(count.asNumber()) : 0, answer.size() / 4);
    auto* words = JSUint32Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypeUint32>(), length);
    RETURN_IF_EXCEPTION(scope, {});
    memcpy(words->typedVector(), answer.data(), length * 4);
    return JSValue::encode(words);
}

// Adds what the program in src/lint/js_plugin/worker calls to its `native` object.
void addLintAskFunctions(JSGlobalObject* globalObject, JSObject* native)
{
    addLintFunction(globalObject, native, "askText"_s, 4, jsLintAskText);
    addLintFunction(globalObject, native, "askWords"_s, 3, jsLintAskWords);
}

} // namespace Bun

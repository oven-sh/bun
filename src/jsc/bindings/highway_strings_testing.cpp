// Testing-only JS binding for the byte-search kernels in highway_strings.cpp.
//
// Kept in its own TU so the Highway kernels stay free of JSC/WebKit headers
// (same reason as xxhash3_testing.cpp). This wrapper just forwards to the C
// entry points and returns their raw result.

#include "root.h"

#include "highway_strings_testing.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSCast.h>

extern "C" size_t highway_index_of_char(const uint8_t* haystack, size_t haystack_len, uint8_t needle);
extern "C" size_t highway_last_index_of_char(const uint8_t* haystack, size_t haystack_len, uint8_t needle);
extern "C" size_t highway_index_of_not_char(const uint8_t* haystack, size_t haystack_len, uint8_t value);
extern "C" size_t highway_count_char(const uint8_t* haystack, size_t haystack_len, uint8_t needle);
extern "C" size_t highway_index_of_any_char(const uint8_t* text, size_t text_len, const uint8_t* chars, size_t chars_len);
extern "C" size_t highway_last_index_of_any_char(const uint8_t* text, size_t text_len, const uint8_t* chars, size_t chars_len);
extern "C" void* highway_memmem(const uint8_t* haystack, size_t haystack_len, const uint8_t* needle, size_t needle_len);
extern "C" size_t highway_memrmem(const uint8_t* haystack, size_t haystack_len, const uint8_t* needle, size_t needle_len);

namespace Bun {

//   (op: string, haystack: Uint8Array, arg: number | Uint8Array) -> number
//
// `arg` is the byte for the *Char ops and the needle / char-set view for the
// others. Returns exactly what the kernel returns: an index (with
// `haystack.length` meaning "not found" for the index_of family), a count, or
// for memmem/memrmem the match offset with -1 for "not found".
BUN_DEFINE_HOST_FUNCTION(Bun__highwayStringsForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto op = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto* view = dynamicDowncast<JSC::JSArrayBufferView>(callFrame->argument(1));
    if (!view || view->isDetached()) {
        throwTypeError(globalObject, scope, "haystack must be an attached ArrayBufferView"_s);
        return {};
    }
    const uint8_t* haystack = static_cast<const uint8_t*>(view->vector());
    size_t len = view->byteLength();

    JSC::JSValue arg = callFrame->argument(2);
    uint8_t byte = 0;
    const uint8_t* needle = nullptr;
    size_t needle_len = 0;
    if (arg.isNumber()) {
        byte = static_cast<uint8_t>(arg.toUInt32(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
    } else if (auto* needleView = dynamicDowncast<JSC::JSArrayBufferView>(arg); needleView && !needleView->isDetached()) {
        needle = static_cast<const uint8_t*>(needleView->vector());
        needle_len = needleView->byteLength();
    } else {
        throwTypeError(globalObject, scope, "arg must be a byte (number) or an attached ArrayBufferView"_s);
        return {};
    }

    size_t result;
    if (op == "indexOfChar"_s) {
        result = highway_index_of_char(haystack, len, byte);
    } else if (op == "lastIndexOfChar"_s) {
        result = highway_last_index_of_char(haystack, len, byte);
    } else if (op == "indexOfNotChar"_s) {
        result = highway_index_of_not_char(haystack, len, byte);
    } else if (op == "countChar"_s) {
        result = highway_count_char(haystack, len, byte);
    } else if (op == "indexOfAny"_s || op == "lastIndexOfAny"_s) {
        if (needle_len < 2 || needle_len > 16) {
            throwRangeError(globalObject, scope, "char set must have 2..=16 bytes"_s);
            return {};
        }
        result = op == "indexOfAny"_s
            ? highway_index_of_any_char(haystack, len, needle, needle_len)
            : highway_last_index_of_any_char(haystack, len, needle, needle_len);
    } else if (op == "memmem"_s) {
        if (!needle_len)
            RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsNumber(0)));
        void* p = highway_memmem(haystack, len, needle, needle_len);
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsNumber(p ? static_cast<double>(static_cast<const uint8_t*>(p) - haystack) : -1.0)));
    } else if (op == "memrmem"_s) {
        size_t r = highway_memrmem(haystack, len, needle, needle_len);
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsNumber(r == static_cast<size_t>(-1) ? -1.0 : static_cast<double>(r))));
    } else {
        throwTypeError(globalObject, scope, "unknown op"_s);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsNumber(static_cast<double>(result))));
}

} // namespace Bun

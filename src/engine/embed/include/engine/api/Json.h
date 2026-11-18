#pragma once

// JSON text to values and back.

#include "engine/api/GlobalObject.h"

namespace JSC {

// Empty if it is not JSON.
inline JSValue JSONParse(JSGlobalObject* globalObject, StringView text) { return Engine::json_try_parse(globalObject, text); }
inline JSValue JSONParse(JSGlobalObject* globalObject, std::span<const char8_t> utf8) { return Engine::json_try_parse_utf8(globalObject, byteCast<uint8_t>(utf8)); }
inline JSValue JSONParseWithException(JSGlobalObject* globalObject, StringView text) { return text.isNull() ? JSValue() : Engine::json_parse(globalObject, text); }
// Null where `JSON.stringify` returns undefined.
inline String JSONStringify(JSGlobalObject* globalObject, JSValue value, JSValue space) { return Engine::json_stringify(globalObject, value, space); }
inline String JSONStringify(JSGlobalObject* globalObject, JSValue value, unsigned indent) { return JSONStringify(globalObject, value, jsNumber(indent)); }
// For the value of a string in parsed data. Short ones are shared. Null if there is no memory.
inline JSString* tryMakeJSONString(VM& vm, StringView text) { return Engine::json_try_make_string(vm, text); }

struct StreamingJSONParseResult {
    enum class Status : uint8_t {
        Complete = Engine::LinesEnd::Complete,
        NeedMoreData = Engine::LinesEnd::NeedsMoreText,
        Error = Engine::LinesEnd::SyntaxError,
    };

    // Up to the end of the last value.
    size_t charactersConsumed { 0 };
    Status status { Status::Complete };
};

// A value on each line, up to the first one that is incomplete or has an error.
StreamingJSONParseResult streamingJSONParse(JSGlobalObject*, StringView, MarkedArgumentBuffer& values);
StreamingJSONParseResult streamingJSONParse(JSGlobalObject*, std::span<const char8_t> utf8, MarkedArgumentBuffer& values);

} // namespace JSC

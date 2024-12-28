#pragma once

#include "root.h"

#include "JavaScriptCore/LazyClassStructure.h"
#include <JavaScriptCore/JSObject.h>

namespace Bun {

using namespace JSC;

// Forward declarations
class JSReadableStream;
class JSReadableStreamDefaultReader;
class JSReadableStreamDefaultController;
class JSReadableStreamByteController;
class JSReadableStreamBYOBReader;
class JSWritableStream;
class JSWritableStreamDefaultWriter;
class JSWritableStreamDefaultController;
class JSTransformStream;
class JSTransformStreamDefaultController;

// clang-format off
#define FOR_EACH_WHATWG_STREAM_CLASS_TYPE(macro) \
    macro(JSReadableStream) \
    macro(JSReadableStreamDefaultReader) \
    macro(JSReadableStreamDefaultController) \
    macro(JSReadableStreamBYOBReader) \
    macro(JSWritableStream) \
    macro(JSWritableStreamDefaultWriter) \
    macro(JSWritableStreamDefaultController) \
    macro(JSTransformStream) \
    macro(JSTransformStreamDefaultController)
// clang-format on

// Stream-related structures for the global object
struct StreamStructures {
public:
#define DECLARE_STREAM_MEMBER(ClassName) LazyClassStructure m_##ClassName;
    FOR_EACH_WHATWG_STREAM_CLASS_TYPE(DECLARE_STREAM_MEMBER)
#undef DECLARE_STREAM_MEMBER

    template<typename T>
    JSObject* constructor(const JSGlobalObject* globalObject);

    template<typename T>
    Structure* structure(const JSGlobalObject* globalObject);

    template<typename T>
    JSObject* prototype(const JSGlobalObject* globalObject);

    void initialize(VM& vm, JSC::JSGlobalObject* globalObject);
};

#define DECLARE_STREAM_TEMPLATE_METHODS(ClassName)                                          \
    template<>                                                                              \
    JSObject* StreamStructures::constructor<ClassName>(const JSGlobalObject* globalObject); \
    template<>                                                                              \
    Structure* StreamStructures::structure<ClassName>(const JSGlobalObject* globalObject);  \
    template<>                                                                              \
    JSObject* StreamStructures::prototype<ClassName>(const JSGlobalObject* globalObject);

FOR_EACH_WHATWG_STREAM_CLASS_TYPE(DECLARE_STREAM_TEMPLATE_METHODS)

}

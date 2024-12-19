#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include "JavaScriptCore/JSCast.h"
#include <JavaScriptCore/LazyProperty.h>

namespace Bun {

using namespace JSC;

// Forward declarations
class JSReadableStream;
class JSReadableStreamDefaultReader;
class JSReadableStreamBYOBReader;
class JSWritableStream;
class JSWritableStreamDefaultWriter;

// Stream-related structures for the global object
struct StreamStructures {
    LazyProperty<JSGlobalObject, Structure> m_readableStreamStructure;
    LazyProperty<JSGlobalObject, Structure> m_readableStreamDefaultReaderStructure;
    LazyProperty<JSGlobalObject, Structure> m_readableStreamBYOBReaderStructure;
    LazyProperty<JSGlobalObject, Structure> m_writableStreamDefaultWriterStructure;
    LazyProperty<JSGlobalObject, Structure> m_transformStreamStructure;
    LazyProperty<JSGlobalObject, Structure> m_transformStreamDefaultControllerStructure;
    LazyProperty<JSGlobalObject, JSObject> m_transformStreamConstructor;

public:
    Structure* getReadableStreamStructure(const JSGlobalObject* globalObject) const { return m_readableStreamStructure.getInitializedOnMainThread(globalObject); }
    Structure* getReadableStreamDefaultReaderStructure(const JSGlobalObject* globalObject) const { return m_readableStreamDefaultReaderStructure.getInitializedOnMainThread(globalObject); }
    Structure* getReadableStreamBYOBReaderStructure(const JSGlobalObject* globalObject) const { return m_readableStreamBYOBReaderStructure.getInitializedOnMainThread(globalObject); }
    Structure* getWritableStreamDefaultWriterStructure(const JSGlobalObject* globalObject) const { return m_writableStreamDefaultWriterStructure.getInitializedOnMainThread(globalObject); }
    Structure* getTransformStreamStructure(const JSGlobalObject* globalObject) const { return m_transformStreamStructure.getInitializedOnMainThread(globalObject); }
    Structure* getTransformStreamDefaultControllerStructure(const JSGlobalObject* globalObject) const { return m_transformStreamDefaultControllerStructure.getInitializedOnMainThread(globalObject); }
    JSObject* getTransformStreamConstructor(const JSGlobalObject* globalObject) const { return m_transformStreamConstructor.getInitializedOnMainThread(globalObject); }
};

} // namespace Bun

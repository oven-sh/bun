#pragma once

#include "root.h"

#include "JavaScriptCore/LazyClassStructure.h"
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
    LazyClassStructure m_readableStream;
    LazyClassStructure m_readableStreamDefaultReader;
    LazyClassStructure m_readableStreamBYOBReader;
    LazyClassStructure m_writableStreamDefaultWriter;
    LazyClassStructure m_transformStream;
    LazyClassStructure m_transformStreamDefaultController;
    LazyClassStructure m_writableStream;
    LazyClassStructure m_writableStreamDefaultController;

public:
    JSObject* getReadableStreamConstructor(const JSGlobalObject* globalObject) const { return m_readableStream.constructorInitializedOnMainThread(globalObject); }
    Structure* getReadableStreamStructure(const JSGlobalObject* globalObject) const { return m_readableStream.getInitializedOnMainThread(globalObject); }
    Structure* getReadableStreamDefaultReaderStructure(const JSGlobalObject* globalObject) const { return m_readableStreamDefaultReader.getInitializedOnMainThread(globalObject); }
    Structure* getReadableStreamBYOBReaderStructure(const JSGlobalObject* globalObject) const { return m_readableStreamBYOBReader.getInitializedOnMainThread(globalObject); }
    Structure* getWritableStreamDefaultWriterStructure(const JSGlobalObject* globalObject) const { return m_writableStreamDefaultWriter.getInitializedOnMainThread(globalObject); }
    Structure* getTransformStreamStructure(const JSGlobalObject* globalObject) const { return m_transformStream.getInitializedOnMainThread(globalObject); }
    Structure* getTransformStreamDefaultControllerStructure(const JSGlobalObject* globalObject) const { return m_transformStreamDefaultController.getInitializedOnMainThread(globalObject); }
    JSObject* getTransformStreamConstructor(const JSGlobalObject* globalObject) const { return m_transformStream.constructorInitializedOnMainThread(globalObject); }
    Structure* getWritableStreamStructure(const JSGlobalObject* globalObject) const { return m_writableStream.getInitializedOnMainThread(globalObject); }
    JSObject* getWritableStreamConstructor(const JSGlobalObject* globalObject) const { return m_writableStream.constructorInitializedOnMainThread(globalObject); }
    JSObject* getReadableStreamBYOBReaderConstructor(const JSGlobalObject* globalObject) const { return m_readableStreamBYOBReader.constructorInitializedOnMainThread(globalObject); }
    Structure* getWritableStreamDefaultControllerStructure(const JSGlobalObject* globalObject) const { return m_writableStreamDefaultController.getInitializedOnMainThread(globalObject); }
};

} // namespace Bun

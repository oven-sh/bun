#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* ReadableStream.ts */
// initializeReadableStream
#define WEBCORE_BUILTIN_READABLESTREAM_INITIALIZEREADABLESTREAM 1
extern const char* const s_readableStreamInitializeReadableStreamCode;
extern const int s_readableStreamInitializeReadableStreamCodeLength;
extern const JSC::ConstructAbility s_readableStreamInitializeReadableStreamCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamInitializeReadableStreamCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamInitializeReadableStreamCodeImplementationVisibility;

// readableStreamToArray
#define WEBCORE_BUILTIN_READABLESTREAM_READABLESTREAMTOARRAY 1
extern const char* const s_readableStreamReadableStreamToArrayCode;
extern const int s_readableStreamReadableStreamToArrayCodeLength;
extern const JSC::ConstructAbility s_readableStreamReadableStreamToArrayCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamReadableStreamToArrayCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamReadableStreamToArrayCodeImplementationVisibility;

// readableStreamToText
#define WEBCORE_BUILTIN_READABLESTREAM_READABLESTREAMTOTEXT 1
extern const char* const s_readableStreamReadableStreamToTextCode;
extern const int s_readableStreamReadableStreamToTextCodeLength;
extern const JSC::ConstructAbility s_readableStreamReadableStreamToTextCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamReadableStreamToTextCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamReadableStreamToTextCodeImplementationVisibility;

// readableStreamToArrayBuffer
#define WEBCORE_BUILTIN_READABLESTREAM_READABLESTREAMTOARRAYBUFFER 1
extern const char* const s_readableStreamReadableStreamToArrayBufferCode;
extern const int s_readableStreamReadableStreamToArrayBufferCodeLength;
extern const JSC::ConstructAbility s_readableStreamReadableStreamToArrayBufferCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamReadableStreamToArrayBufferCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamReadableStreamToArrayBufferCodeImplementationVisibility;

// readableStreamToJSON
#define WEBCORE_BUILTIN_READABLESTREAM_READABLESTREAMTOJSON 1
extern const char* const s_readableStreamReadableStreamToJSONCode;
extern const int s_readableStreamReadableStreamToJSONCodeLength;
extern const JSC::ConstructAbility s_readableStreamReadableStreamToJSONCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamReadableStreamToJSONCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamReadableStreamToJSONCodeImplementationVisibility;

// readableStreamToBlob
#define WEBCORE_BUILTIN_READABLESTREAM_READABLESTREAMTOBLOB 1
extern const char* const s_readableStreamReadableStreamToBlobCode;
extern const int s_readableStreamReadableStreamToBlobCodeLength;
extern const JSC::ConstructAbility s_readableStreamReadableStreamToBlobCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamReadableStreamToBlobCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamReadableStreamToBlobCodeImplementationVisibility;

// consumeReadableStream
#define WEBCORE_BUILTIN_READABLESTREAM_CONSUMEREADABLESTREAM 1
extern const char* const s_readableStreamConsumeReadableStreamCode;
extern const int s_readableStreamConsumeReadableStreamCodeLength;
extern const JSC::ConstructAbility s_readableStreamConsumeReadableStreamCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamConsumeReadableStreamCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamConsumeReadableStreamCodeImplementationVisibility;

// createEmptyReadableStream
#define WEBCORE_BUILTIN_READABLESTREAM_CREATEEMPTYREADABLESTREAM 1
extern const char* const s_readableStreamCreateEmptyReadableStreamCode;
extern const int s_readableStreamCreateEmptyReadableStreamCodeLength;
extern const JSC::ConstructAbility s_readableStreamCreateEmptyReadableStreamCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamCreateEmptyReadableStreamCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamCreateEmptyReadableStreamCodeImplementationVisibility;

// createNativeReadableStream
#define WEBCORE_BUILTIN_READABLESTREAM_CREATENATIVEREADABLESTREAM 1
extern const char* const s_readableStreamCreateNativeReadableStreamCode;
extern const int s_readableStreamCreateNativeReadableStreamCodeLength;
extern const JSC::ConstructAbility s_readableStreamCreateNativeReadableStreamCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamCreateNativeReadableStreamCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamCreateNativeReadableStreamCodeImplementationVisibility;

// cancel
#define WEBCORE_BUILTIN_READABLESTREAM_CANCEL 1
extern const char* const s_readableStreamCancelCode;
extern const int s_readableStreamCancelCodeLength;
extern const JSC::ConstructAbility s_readableStreamCancelCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamCancelCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamCancelCodeImplementationVisibility;

// getReader
#define WEBCORE_BUILTIN_READABLESTREAM_GETREADER 1
extern const char* const s_readableStreamGetReaderCode;
extern const int s_readableStreamGetReaderCodeLength;
extern const JSC::ConstructAbility s_readableStreamGetReaderCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamGetReaderCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamGetReaderCodeImplementationVisibility;

// pipeThrough
#define WEBCORE_BUILTIN_READABLESTREAM_PIPETHROUGH 1
extern const char* const s_readableStreamPipeThroughCode;
extern const int s_readableStreamPipeThroughCodeLength;
extern const JSC::ConstructAbility s_readableStreamPipeThroughCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamPipeThroughCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamPipeThroughCodeImplementationVisibility;

// pipeTo
#define WEBCORE_BUILTIN_READABLESTREAM_PIPETO 1
extern const char* const s_readableStreamPipeToCode;
extern const int s_readableStreamPipeToCodeLength;
extern const JSC::ConstructAbility s_readableStreamPipeToCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamPipeToCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamPipeToCodeImplementationVisibility;

// tee
#define WEBCORE_BUILTIN_READABLESTREAM_TEE 1
extern const char* const s_readableStreamTeeCode;
extern const int s_readableStreamTeeCodeLength;
extern const JSC::ConstructAbility s_readableStreamTeeCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamTeeCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamTeeCodeImplementationVisibility;

// locked
#define WEBCORE_BUILTIN_READABLESTREAM_LOCKED 1
extern const char* const s_readableStreamLockedCode;
extern const int s_readableStreamLockedCodeLength;
extern const JSC::ConstructAbility s_readableStreamLockedCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamLockedCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamLockedCodeImplementationVisibility;

// values
#define WEBCORE_BUILTIN_READABLESTREAM_VALUES 1
extern const char* const s_readableStreamValuesCode;
extern const int s_readableStreamValuesCodeLength;
extern const JSC::ConstructAbility s_readableStreamValuesCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamValuesCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamValuesCodeImplementationVisibility;

// lazyAsyncIterator
#define WEBCORE_BUILTIN_READABLESTREAM_LAZYASYNCITERATOR 1
extern const char* const s_readableStreamLazyAsyncIteratorCode;
extern const int s_readableStreamLazyAsyncIteratorCodeLength;
extern const JSC::ConstructAbility s_readableStreamLazyAsyncIteratorCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamLazyAsyncIteratorCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamLazyAsyncIteratorCodeImplementationVisibility;

#define WEBCORE_FOREACH_READABLESTREAM_BUILTIN_DATA(macro) \
    macro(initializeReadableStream, readableStreamInitializeReadableStream, 2) \
    macro(readableStreamToArray, readableStreamReadableStreamToArray, 1) \
    macro(readableStreamToText, readableStreamReadableStreamToText, 1) \
    macro(readableStreamToArrayBuffer, readableStreamReadableStreamToArrayBuffer, 1) \
    macro(readableStreamToJSON, readableStreamReadableStreamToJSON, 1) \
    macro(readableStreamToBlob, readableStreamReadableStreamToBlob, 1) \
    macro(consumeReadableStream, readableStreamConsumeReadableStream, 3) \
    macro(createEmptyReadableStream, readableStreamCreateEmptyReadableStream, 0) \
    macro(createNativeReadableStream, readableStreamCreateNativeReadableStream, 3) \
    macro(cancel, readableStreamCancel, 1) \
    macro(getReader, readableStreamGetReader, 1) \
    macro(pipeThrough, readableStreamPipeThrough, 2) \
    macro(pipeTo, readableStreamPipeTo, 1) \
    macro(tee, readableStreamTee, 0) \
    macro(locked, readableStreamLocked, 0) \
    macro(values, readableStreamValues, 1) \
    macro(lazyAsyncIterator, readableStreamLazyAsyncIterator, 0) \

#define WEBCORE_FOREACH_READABLESTREAM_BUILTIN_CODE(macro) \
    macro(readableStreamInitializeReadableStreamCode, initializeReadableStream, ASCIILiteral(), s_readableStreamInitializeReadableStreamCodeLength) \
    macro(readableStreamReadableStreamToArrayCode, readableStreamToArray, ASCIILiteral(), s_readableStreamReadableStreamToArrayCodeLength) \
    macro(readableStreamReadableStreamToTextCode, readableStreamToText, ASCIILiteral(), s_readableStreamReadableStreamToTextCodeLength) \
    macro(readableStreamReadableStreamToArrayBufferCode, readableStreamToArrayBuffer, ASCIILiteral(), s_readableStreamReadableStreamToArrayBufferCodeLength) \
    macro(readableStreamReadableStreamToJSONCode, readableStreamToJSON, ASCIILiteral(), s_readableStreamReadableStreamToJSONCodeLength) \
    macro(readableStreamReadableStreamToBlobCode, readableStreamToBlob, ASCIILiteral(), s_readableStreamReadableStreamToBlobCodeLength) \
    macro(readableStreamConsumeReadableStreamCode, consumeReadableStream, ASCIILiteral(), s_readableStreamConsumeReadableStreamCodeLength) \
    macro(readableStreamCreateEmptyReadableStreamCode, createEmptyReadableStream, ASCIILiteral(), s_readableStreamCreateEmptyReadableStreamCodeLength) \
    macro(readableStreamCreateNativeReadableStreamCode, createNativeReadableStream, ASCIILiteral(), s_readableStreamCreateNativeReadableStreamCodeLength) \
    macro(readableStreamCancelCode, cancel, ASCIILiteral(), s_readableStreamCancelCodeLength) \
    macro(readableStreamGetReaderCode, getReader, ASCIILiteral(), s_readableStreamGetReaderCodeLength) \
    macro(readableStreamPipeThroughCode, pipeThrough, ASCIILiteral(), s_readableStreamPipeThroughCodeLength) \
    macro(readableStreamPipeToCode, pipeTo, ASCIILiteral(), s_readableStreamPipeToCodeLength) \
    macro(readableStreamTeeCode, tee, ASCIILiteral(), s_readableStreamTeeCodeLength) \
    macro(readableStreamLockedCode, locked, "get locked"_s, s_readableStreamLockedCodeLength) \
    macro(readableStreamValuesCode, values, ASCIILiteral(), s_readableStreamValuesCodeLength) \
    macro(readableStreamLazyAsyncIteratorCode, lazyAsyncIterator, ASCIILiteral(), s_readableStreamLazyAsyncIteratorCodeLength) \

#define WEBCORE_FOREACH_READABLESTREAM_BUILTIN_FUNCTION_NAME(macro) \
    macro(initializeReadableStream) \
    macro(readableStreamToArray) \
    macro(readableStreamToText) \
    macro(readableStreamToArrayBuffer) \
    macro(readableStreamToJSON) \
    macro(readableStreamToBlob) \
    macro(consumeReadableStream) \
    macro(createEmptyReadableStream) \
    macro(createNativeReadableStream) \
    macro(cancel) \
    macro(getReader) \
    macro(pipeThrough) \
    macro(pipeTo) \
    macro(tee) \
    macro(locked) \
    macro(values) \
    macro(lazyAsyncIterator) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_READABLESTREAM_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class ReadableStreamBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit ReadableStreamBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_READABLESTREAM_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_READABLESTREAM_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_READABLESTREAM_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_READABLESTREAM_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_READABLESTREAM_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_READABLESTREAM_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* ReadableStreamBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_READABLESTREAM_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ReadableStreamBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_READABLESTREAM_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

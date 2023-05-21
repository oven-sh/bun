#pragma once
namespace Zig { class GlobalObject; }
#include "root.h"
#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* ReadableStreamDefaultReader.ts */
// initializeReadableStreamDefaultReader
#define WEBCORE_BUILTIN_READABLESTREAMDEFAULTREADER_INITIALIZEREADABLESTREAMDEFAULTREADER 1
extern const char* const s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCode;
extern const int s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeLength;
extern const JSC::ConstructAbility s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeImplementationVisibility;

// cancel
#define WEBCORE_BUILTIN_READABLESTREAMDEFAULTREADER_CANCEL 1
extern const char* const s_readableStreamDefaultReaderCancelCode;
extern const int s_readableStreamDefaultReaderCancelCodeLength;
extern const JSC::ConstructAbility s_readableStreamDefaultReaderCancelCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamDefaultReaderCancelCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamDefaultReaderCancelCodeImplementationVisibility;

// readMany
#define WEBCORE_BUILTIN_READABLESTREAMDEFAULTREADER_READMANY 1
extern const char* const s_readableStreamDefaultReaderReadManyCode;
extern const int s_readableStreamDefaultReaderReadManyCodeLength;
extern const JSC::ConstructAbility s_readableStreamDefaultReaderReadManyCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamDefaultReaderReadManyCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamDefaultReaderReadManyCodeImplementationVisibility;

// read
#define WEBCORE_BUILTIN_READABLESTREAMDEFAULTREADER_READ 1
extern const char* const s_readableStreamDefaultReaderReadCode;
extern const int s_readableStreamDefaultReaderReadCodeLength;
extern const JSC::ConstructAbility s_readableStreamDefaultReaderReadCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamDefaultReaderReadCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamDefaultReaderReadCodeImplementationVisibility;

// releaseLock
#define WEBCORE_BUILTIN_READABLESTREAMDEFAULTREADER_RELEASELOCK 1
extern const char* const s_readableStreamDefaultReaderReleaseLockCode;
extern const int s_readableStreamDefaultReaderReleaseLockCodeLength;
extern const JSC::ConstructAbility s_readableStreamDefaultReaderReleaseLockCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamDefaultReaderReleaseLockCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamDefaultReaderReleaseLockCodeImplementationVisibility;

// closed
#define WEBCORE_BUILTIN_READABLESTREAMDEFAULTREADER_CLOSED 1
extern const char* const s_readableStreamDefaultReaderClosedCode;
extern const int s_readableStreamDefaultReaderClosedCodeLength;
extern const JSC::ConstructAbility s_readableStreamDefaultReaderClosedCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamDefaultReaderClosedCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamDefaultReaderClosedCodeImplementationVisibility;

#define WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_DATA(macro) \
    macro(initializeReadableStreamDefaultReader, readableStreamDefaultReaderInitializeReadableStreamDefaultReader, 1) \
    macro(cancel, readableStreamDefaultReaderCancel, 1) \
    macro(readMany, readableStreamDefaultReaderReadMany, 0) \
    macro(read, readableStreamDefaultReaderRead, 0) \
    macro(releaseLock, readableStreamDefaultReaderReleaseLock, 0) \
    macro(closed, readableStreamDefaultReaderClosed, 0) \

#define WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_CODE(macro) \
    macro(readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCode, initializeReadableStreamDefaultReader, ASCIILiteral(), s_readableStreamDefaultReaderInitializeReadableStreamDefaultReaderCodeLength) \
    macro(readableStreamDefaultReaderCancelCode, cancel, ASCIILiteral(), s_readableStreamDefaultReaderCancelCodeLength) \
    macro(readableStreamDefaultReaderReadManyCode, readMany, ASCIILiteral(), s_readableStreamDefaultReaderReadManyCodeLength) \
    macro(readableStreamDefaultReaderReadCode, read, ASCIILiteral(), s_readableStreamDefaultReaderReadCodeLength) \
    macro(readableStreamDefaultReaderReleaseLockCode, releaseLock, ASCIILiteral(), s_readableStreamDefaultReaderReleaseLockCodeLength) \
    macro(readableStreamDefaultReaderClosedCode, closed, "get closed"_s, s_readableStreamDefaultReaderClosedCodeLength) \

#define WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_FUNCTION_NAME(macro) \
    macro(initializeReadableStreamDefaultReader) \
    macro(cancel) \
    macro(readMany) \
    macro(read) \
    macro(releaseLock) \
    macro(closed) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class ReadableStreamDefaultReaderBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit ReadableStreamDefaultReaderBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* ReadableStreamDefaultReaderBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ReadableStreamDefaultReaderBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_READABLESTREAMDEFAULTREADER_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

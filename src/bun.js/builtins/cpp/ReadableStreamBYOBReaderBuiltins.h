#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* ReadableStreamBYOBReader.ts */
// initializeReadableStreamBYOBReader
#define WEBCORE_BUILTIN_READABLESTREAMBYOBREADER_INITIALIZEREADABLESTREAMBYOBREADER 1
extern const char* const s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCode;
extern const int s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeLength;
extern const JSC::ConstructAbility s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeImplementationVisibility;

// cancel
#define WEBCORE_BUILTIN_READABLESTREAMBYOBREADER_CANCEL 1
extern const char* const s_readableStreamBYOBReaderCancelCode;
extern const int s_readableStreamBYOBReaderCancelCodeLength;
extern const JSC::ConstructAbility s_readableStreamBYOBReaderCancelCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamBYOBReaderCancelCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamBYOBReaderCancelCodeImplementationVisibility;

// read
#define WEBCORE_BUILTIN_READABLESTREAMBYOBREADER_READ 1
extern const char* const s_readableStreamBYOBReaderReadCode;
extern const int s_readableStreamBYOBReaderReadCodeLength;
extern const JSC::ConstructAbility s_readableStreamBYOBReaderReadCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamBYOBReaderReadCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamBYOBReaderReadCodeImplementationVisibility;

// releaseLock
#define WEBCORE_BUILTIN_READABLESTREAMBYOBREADER_RELEASELOCK 1
extern const char* const s_readableStreamBYOBReaderReleaseLockCode;
extern const int s_readableStreamBYOBReaderReleaseLockCodeLength;
extern const JSC::ConstructAbility s_readableStreamBYOBReaderReleaseLockCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamBYOBReaderReleaseLockCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamBYOBReaderReleaseLockCodeImplementationVisibility;

// closed
#define WEBCORE_BUILTIN_READABLESTREAMBYOBREADER_CLOSED 1
extern const char* const s_readableStreamBYOBReaderClosedCode;
extern const int s_readableStreamBYOBReaderClosedCodeLength;
extern const JSC::ConstructAbility s_readableStreamBYOBReaderClosedCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamBYOBReaderClosedCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamBYOBReaderClosedCodeImplementationVisibility;

#define WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_DATA(macro) \
    macro(initializeReadableStreamBYOBReader, readableStreamBYOBReaderInitializeReadableStreamBYOBReader, 1) \
    macro(cancel, readableStreamBYOBReaderCancel, 1) \
    macro(read, readableStreamBYOBReaderRead, 1) \
    macro(releaseLock, readableStreamBYOBReaderReleaseLock, 0) \
    macro(closed, readableStreamBYOBReaderClosed, 0) \

#define WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_CODE(macro) \
    macro(readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCode, initializeReadableStreamBYOBReader, ASCIILiteral(), s_readableStreamBYOBReaderInitializeReadableStreamBYOBReaderCodeLength) \
    macro(readableStreamBYOBReaderCancelCode, cancel, ASCIILiteral(), s_readableStreamBYOBReaderCancelCodeLength) \
    macro(readableStreamBYOBReaderReadCode, read, ASCIILiteral(), s_readableStreamBYOBReaderReadCodeLength) \
    macro(readableStreamBYOBReaderReleaseLockCode, releaseLock, ASCIILiteral(), s_readableStreamBYOBReaderReleaseLockCodeLength) \
    macro(readableStreamBYOBReaderClosedCode, closed, "get closed"_s, s_readableStreamBYOBReaderClosedCodeLength) \

#define WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_FUNCTION_NAME(macro) \
    macro(initializeReadableStreamBYOBReader) \
    macro(cancel) \
    macro(read) \
    macro(releaseLock) \
    macro(closed) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class ReadableStreamBYOBReaderBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit ReadableStreamBYOBReaderBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* ReadableStreamBYOBReaderBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ReadableStreamBYOBReaderBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_READABLESTREAMBYOBREADER_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

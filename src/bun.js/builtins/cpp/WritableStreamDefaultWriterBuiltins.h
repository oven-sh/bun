#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* WritableStreamDefaultWriter.ts */
// initializeWritableStreamDefaultWriter
#define WEBCORE_BUILTIN_WRITABLESTREAMDEFAULTWRITER_INITIALIZEWRITABLESTREAMDEFAULTWRITER 1
extern const char* const s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCode;
extern const int s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeLength;
extern const JSC::ConstructAbility s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeConstructAbility;
extern const JSC::ConstructorKind s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeConstructorKind;
extern const JSC::ImplementationVisibility s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeImplementationVisibility;

// closed
#define WEBCORE_BUILTIN_WRITABLESTREAMDEFAULTWRITER_CLOSED 1
extern const char* const s_writableStreamDefaultWriterClosedCode;
extern const int s_writableStreamDefaultWriterClosedCodeLength;
extern const JSC::ConstructAbility s_writableStreamDefaultWriterClosedCodeConstructAbility;
extern const JSC::ConstructorKind s_writableStreamDefaultWriterClosedCodeConstructorKind;
extern const JSC::ImplementationVisibility s_writableStreamDefaultWriterClosedCodeImplementationVisibility;

// desiredSize
#define WEBCORE_BUILTIN_WRITABLESTREAMDEFAULTWRITER_DESIREDSIZE 1
extern const char* const s_writableStreamDefaultWriterDesiredSizeCode;
extern const int s_writableStreamDefaultWriterDesiredSizeCodeLength;
extern const JSC::ConstructAbility s_writableStreamDefaultWriterDesiredSizeCodeConstructAbility;
extern const JSC::ConstructorKind s_writableStreamDefaultWriterDesiredSizeCodeConstructorKind;
extern const JSC::ImplementationVisibility s_writableStreamDefaultWriterDesiredSizeCodeImplementationVisibility;

// ready
#define WEBCORE_BUILTIN_WRITABLESTREAMDEFAULTWRITER_READY 1
extern const char* const s_writableStreamDefaultWriterReadyCode;
extern const int s_writableStreamDefaultWriterReadyCodeLength;
extern const JSC::ConstructAbility s_writableStreamDefaultWriterReadyCodeConstructAbility;
extern const JSC::ConstructorKind s_writableStreamDefaultWriterReadyCodeConstructorKind;
extern const JSC::ImplementationVisibility s_writableStreamDefaultWriterReadyCodeImplementationVisibility;

// abort
#define WEBCORE_BUILTIN_WRITABLESTREAMDEFAULTWRITER_ABORT 1
extern const char* const s_writableStreamDefaultWriterAbortCode;
extern const int s_writableStreamDefaultWriterAbortCodeLength;
extern const JSC::ConstructAbility s_writableStreamDefaultWriterAbortCodeConstructAbility;
extern const JSC::ConstructorKind s_writableStreamDefaultWriterAbortCodeConstructorKind;
extern const JSC::ImplementationVisibility s_writableStreamDefaultWriterAbortCodeImplementationVisibility;

// close
#define WEBCORE_BUILTIN_WRITABLESTREAMDEFAULTWRITER_CLOSE 1
extern const char* const s_writableStreamDefaultWriterCloseCode;
extern const int s_writableStreamDefaultWriterCloseCodeLength;
extern const JSC::ConstructAbility s_writableStreamDefaultWriterCloseCodeConstructAbility;
extern const JSC::ConstructorKind s_writableStreamDefaultWriterCloseCodeConstructorKind;
extern const JSC::ImplementationVisibility s_writableStreamDefaultWriterCloseCodeImplementationVisibility;

// releaseLock
#define WEBCORE_BUILTIN_WRITABLESTREAMDEFAULTWRITER_RELEASELOCK 1
extern const char* const s_writableStreamDefaultWriterReleaseLockCode;
extern const int s_writableStreamDefaultWriterReleaseLockCodeLength;
extern const JSC::ConstructAbility s_writableStreamDefaultWriterReleaseLockCodeConstructAbility;
extern const JSC::ConstructorKind s_writableStreamDefaultWriterReleaseLockCodeConstructorKind;
extern const JSC::ImplementationVisibility s_writableStreamDefaultWriterReleaseLockCodeImplementationVisibility;

// write
#define WEBCORE_BUILTIN_WRITABLESTREAMDEFAULTWRITER_WRITE 1
extern const char* const s_writableStreamDefaultWriterWriteCode;
extern const int s_writableStreamDefaultWriterWriteCodeLength;
extern const JSC::ConstructAbility s_writableStreamDefaultWriterWriteCodeConstructAbility;
extern const JSC::ConstructorKind s_writableStreamDefaultWriterWriteCodeConstructorKind;
extern const JSC::ImplementationVisibility s_writableStreamDefaultWriterWriteCodeImplementationVisibility;

#define WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_DATA(macro) \
    macro(initializeWritableStreamDefaultWriter, writableStreamDefaultWriterInitializeWritableStreamDefaultWriter, 1) \
    macro(closed, writableStreamDefaultWriterClosed, 0) \
    macro(desiredSize, writableStreamDefaultWriterDesiredSize, 0) \
    macro(ready, writableStreamDefaultWriterReady, 0) \
    macro(abort, writableStreamDefaultWriterAbort, 1) \
    macro(close, writableStreamDefaultWriterClose, 0) \
    macro(releaseLock, writableStreamDefaultWriterReleaseLock, 0) \
    macro(write, writableStreamDefaultWriterWrite, 1) \

#define WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_CODE(macro) \
    macro(writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCode, initializeWritableStreamDefaultWriter, ASCIILiteral(), s_writableStreamDefaultWriterInitializeWritableStreamDefaultWriterCodeLength) \
    macro(writableStreamDefaultWriterClosedCode, closed, "get closed"_s, s_writableStreamDefaultWriterClosedCodeLength) \
    macro(writableStreamDefaultWriterDesiredSizeCode, desiredSize, "get desiredSize"_s, s_writableStreamDefaultWriterDesiredSizeCodeLength) \
    macro(writableStreamDefaultWriterReadyCode, ready, "get ready"_s, s_writableStreamDefaultWriterReadyCodeLength) \
    macro(writableStreamDefaultWriterAbortCode, abort, ASCIILiteral(), s_writableStreamDefaultWriterAbortCodeLength) \
    macro(writableStreamDefaultWriterCloseCode, close, ASCIILiteral(), s_writableStreamDefaultWriterCloseCodeLength) \
    macro(writableStreamDefaultWriterReleaseLockCode, releaseLock, ASCIILiteral(), s_writableStreamDefaultWriterReleaseLockCodeLength) \
    macro(writableStreamDefaultWriterWriteCode, write, ASCIILiteral(), s_writableStreamDefaultWriterWriteCodeLength) \

#define WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_FUNCTION_NAME(macro) \
    macro(initializeWritableStreamDefaultWriter) \
    macro(closed) \
    macro(desiredSize) \
    macro(ready) \
    macro(abort) \
    macro(close) \
    macro(releaseLock) \
    macro(write) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class WritableStreamDefaultWriterBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit WritableStreamDefaultWriterBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* WritableStreamDefaultWriterBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void WritableStreamDefaultWriterBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_WRITABLESTREAMDEFAULTWRITER_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

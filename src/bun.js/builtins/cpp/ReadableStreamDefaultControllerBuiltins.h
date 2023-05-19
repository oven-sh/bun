#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* ReadableStreamDefaultController.ts */
// initializeReadableStreamDefaultController
#define WEBCORE_BUILTIN_READABLESTREAMDEFAULTCONTROLLER_INITIALIZEREADABLESTREAMDEFAULTCONTROLLER 1
extern const char* const s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCode;
extern const int s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeLength;
extern const JSC::ConstructAbility s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeImplementationVisibility;

// enqueue
#define WEBCORE_BUILTIN_READABLESTREAMDEFAULTCONTROLLER_ENQUEUE 1
extern const char* const s_readableStreamDefaultControllerEnqueueCode;
extern const int s_readableStreamDefaultControllerEnqueueCodeLength;
extern const JSC::ConstructAbility s_readableStreamDefaultControllerEnqueueCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamDefaultControllerEnqueueCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamDefaultControllerEnqueueCodeImplementationVisibility;

// error
#define WEBCORE_BUILTIN_READABLESTREAMDEFAULTCONTROLLER_ERROR 1
extern const char* const s_readableStreamDefaultControllerErrorCode;
extern const int s_readableStreamDefaultControllerErrorCodeLength;
extern const JSC::ConstructAbility s_readableStreamDefaultControllerErrorCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamDefaultControllerErrorCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamDefaultControllerErrorCodeImplementationVisibility;

// close
#define WEBCORE_BUILTIN_READABLESTREAMDEFAULTCONTROLLER_CLOSE 1
extern const char* const s_readableStreamDefaultControllerCloseCode;
extern const int s_readableStreamDefaultControllerCloseCodeLength;
extern const JSC::ConstructAbility s_readableStreamDefaultControllerCloseCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamDefaultControllerCloseCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamDefaultControllerCloseCodeImplementationVisibility;

// desiredSize
#define WEBCORE_BUILTIN_READABLESTREAMDEFAULTCONTROLLER_DESIREDSIZE 1
extern const char* const s_readableStreamDefaultControllerDesiredSizeCode;
extern const int s_readableStreamDefaultControllerDesiredSizeCodeLength;
extern const JSC::ConstructAbility s_readableStreamDefaultControllerDesiredSizeCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamDefaultControllerDesiredSizeCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamDefaultControllerDesiredSizeCodeImplementationVisibility;

#define WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_DATA(macro) \
    macro(initializeReadableStreamDefaultController, readableStreamDefaultControllerInitializeReadableStreamDefaultController, 4) \
    macro(enqueue, readableStreamDefaultControllerEnqueue, 1) \
    macro(error, readableStreamDefaultControllerError, 1) \
    macro(close, readableStreamDefaultControllerClose, 0) \
    macro(desiredSize, readableStreamDefaultControllerDesiredSize, 0) \

#define WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(macro) \
    macro(readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCode, initializeReadableStreamDefaultController, ASCIILiteral(), s_readableStreamDefaultControllerInitializeReadableStreamDefaultControllerCodeLength) \
    macro(readableStreamDefaultControllerEnqueueCode, enqueue, ASCIILiteral(), s_readableStreamDefaultControllerEnqueueCodeLength) \
    macro(readableStreamDefaultControllerErrorCode, error, ASCIILiteral(), s_readableStreamDefaultControllerErrorCodeLength) \
    macro(readableStreamDefaultControllerCloseCode, close, ASCIILiteral(), s_readableStreamDefaultControllerCloseCodeLength) \
    macro(readableStreamDefaultControllerDesiredSizeCode, desiredSize, "get desiredSize"_s, s_readableStreamDefaultControllerDesiredSizeCodeLength) \

#define WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(macro) \
    macro(initializeReadableStreamDefaultController) \
    macro(enqueue) \
    macro(error) \
    macro(close) \
    macro(desiredSize) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class ReadableStreamDefaultControllerBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit ReadableStreamDefaultControllerBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* ReadableStreamDefaultControllerBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ReadableStreamDefaultControllerBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_READABLESTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

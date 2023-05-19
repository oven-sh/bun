#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* ReadableByteStreamController.ts */
// initializeReadableByteStreamController
#define WEBCORE_BUILTIN_READABLEBYTESTREAMCONTROLLER_INITIALIZEREADABLEBYTESTREAMCONTROLLER 1
extern const char* const s_readableByteStreamControllerInitializeReadableByteStreamControllerCode;
extern const int s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeLength;
extern const JSC::ConstructAbility s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeConstructAbility;
extern const JSC::ConstructorKind s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeImplementationVisibility;

// enqueue
#define WEBCORE_BUILTIN_READABLEBYTESTREAMCONTROLLER_ENQUEUE 1
extern const char* const s_readableByteStreamControllerEnqueueCode;
extern const int s_readableByteStreamControllerEnqueueCodeLength;
extern const JSC::ConstructAbility s_readableByteStreamControllerEnqueueCodeConstructAbility;
extern const JSC::ConstructorKind s_readableByteStreamControllerEnqueueCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableByteStreamControllerEnqueueCodeImplementationVisibility;

// error
#define WEBCORE_BUILTIN_READABLEBYTESTREAMCONTROLLER_ERROR 1
extern const char* const s_readableByteStreamControllerErrorCode;
extern const int s_readableByteStreamControllerErrorCodeLength;
extern const JSC::ConstructAbility s_readableByteStreamControllerErrorCodeConstructAbility;
extern const JSC::ConstructorKind s_readableByteStreamControllerErrorCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableByteStreamControllerErrorCodeImplementationVisibility;

// close
#define WEBCORE_BUILTIN_READABLEBYTESTREAMCONTROLLER_CLOSE 1
extern const char* const s_readableByteStreamControllerCloseCode;
extern const int s_readableByteStreamControllerCloseCodeLength;
extern const JSC::ConstructAbility s_readableByteStreamControllerCloseCodeConstructAbility;
extern const JSC::ConstructorKind s_readableByteStreamControllerCloseCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableByteStreamControllerCloseCodeImplementationVisibility;

// byobRequest
#define WEBCORE_BUILTIN_READABLEBYTESTREAMCONTROLLER_BYOBREQUEST 1
extern const char* const s_readableByteStreamControllerByobRequestCode;
extern const int s_readableByteStreamControllerByobRequestCodeLength;
extern const JSC::ConstructAbility s_readableByteStreamControllerByobRequestCodeConstructAbility;
extern const JSC::ConstructorKind s_readableByteStreamControllerByobRequestCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableByteStreamControllerByobRequestCodeImplementationVisibility;

// desiredSize
#define WEBCORE_BUILTIN_READABLEBYTESTREAMCONTROLLER_DESIREDSIZE 1
extern const char* const s_readableByteStreamControllerDesiredSizeCode;
extern const int s_readableByteStreamControllerDesiredSizeCodeLength;
extern const JSC::ConstructAbility s_readableByteStreamControllerDesiredSizeCodeConstructAbility;
extern const JSC::ConstructorKind s_readableByteStreamControllerDesiredSizeCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableByteStreamControllerDesiredSizeCodeImplementationVisibility;

#define WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_DATA(macro) \
    macro(initializeReadableByteStreamController, readableByteStreamControllerInitializeReadableByteStreamController, 3) \
    macro(enqueue, readableByteStreamControllerEnqueue, 1) \
    macro(error, readableByteStreamControllerError, 1) \
    macro(close, readableByteStreamControllerClose, 0) \
    macro(byobRequest, readableByteStreamControllerByobRequest, 0) \
    macro(desiredSize, readableByteStreamControllerDesiredSize, 0) \

#define WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_CODE(macro) \
    macro(readableByteStreamControllerInitializeReadableByteStreamControllerCode, initializeReadableByteStreamController, ASCIILiteral(), s_readableByteStreamControllerInitializeReadableByteStreamControllerCodeLength) \
    macro(readableByteStreamControllerEnqueueCode, enqueue, ASCIILiteral(), s_readableByteStreamControllerEnqueueCodeLength) \
    macro(readableByteStreamControllerErrorCode, error, ASCIILiteral(), s_readableByteStreamControllerErrorCodeLength) \
    macro(readableByteStreamControllerCloseCode, close, ASCIILiteral(), s_readableByteStreamControllerCloseCodeLength) \
    macro(readableByteStreamControllerByobRequestCode, byobRequest, "get byobRequest"_s, s_readableByteStreamControllerByobRequestCodeLength) \
    macro(readableByteStreamControllerDesiredSizeCode, desiredSize, "get desiredSize"_s, s_readableByteStreamControllerDesiredSizeCodeLength) \

#define WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_FUNCTION_NAME(macro) \
    macro(initializeReadableByteStreamController) \
    macro(enqueue) \
    macro(error) \
    macro(close) \
    macro(byobRequest) \
    macro(desiredSize) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class ReadableByteStreamControllerBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit ReadableByteStreamControllerBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* ReadableByteStreamControllerBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ReadableByteStreamControllerBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_READABLEBYTESTREAMCONTROLLER_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

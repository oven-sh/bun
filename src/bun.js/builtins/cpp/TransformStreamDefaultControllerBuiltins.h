#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* TransformStreamDefaultController.ts */
// initializeTransformStreamDefaultController
#define WEBCORE_BUILTIN_TRANSFORMSTREAMDEFAULTCONTROLLER_INITIALIZETRANSFORMSTREAMDEFAULTCONTROLLER 1
extern const char* const s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCode;
extern const int s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeLength;
extern const JSC::ConstructAbility s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeConstructAbility;
extern const JSC::ConstructorKind s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeConstructorKind;
extern const JSC::ImplementationVisibility s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeImplementationVisibility;

// desiredSize
#define WEBCORE_BUILTIN_TRANSFORMSTREAMDEFAULTCONTROLLER_DESIREDSIZE 1
extern const char* const s_transformStreamDefaultControllerDesiredSizeCode;
extern const int s_transformStreamDefaultControllerDesiredSizeCodeLength;
extern const JSC::ConstructAbility s_transformStreamDefaultControllerDesiredSizeCodeConstructAbility;
extern const JSC::ConstructorKind s_transformStreamDefaultControllerDesiredSizeCodeConstructorKind;
extern const JSC::ImplementationVisibility s_transformStreamDefaultControllerDesiredSizeCodeImplementationVisibility;

// enqueue
#define WEBCORE_BUILTIN_TRANSFORMSTREAMDEFAULTCONTROLLER_ENQUEUE 1
extern const char* const s_transformStreamDefaultControllerEnqueueCode;
extern const int s_transformStreamDefaultControllerEnqueueCodeLength;
extern const JSC::ConstructAbility s_transformStreamDefaultControllerEnqueueCodeConstructAbility;
extern const JSC::ConstructorKind s_transformStreamDefaultControllerEnqueueCodeConstructorKind;
extern const JSC::ImplementationVisibility s_transformStreamDefaultControllerEnqueueCodeImplementationVisibility;

// error
#define WEBCORE_BUILTIN_TRANSFORMSTREAMDEFAULTCONTROLLER_ERROR 1
extern const char* const s_transformStreamDefaultControllerErrorCode;
extern const int s_transformStreamDefaultControllerErrorCodeLength;
extern const JSC::ConstructAbility s_transformStreamDefaultControllerErrorCodeConstructAbility;
extern const JSC::ConstructorKind s_transformStreamDefaultControllerErrorCodeConstructorKind;
extern const JSC::ImplementationVisibility s_transformStreamDefaultControllerErrorCodeImplementationVisibility;

// terminate
#define WEBCORE_BUILTIN_TRANSFORMSTREAMDEFAULTCONTROLLER_TERMINATE 1
extern const char* const s_transformStreamDefaultControllerTerminateCode;
extern const int s_transformStreamDefaultControllerTerminateCodeLength;
extern const JSC::ConstructAbility s_transformStreamDefaultControllerTerminateCodeConstructAbility;
extern const JSC::ConstructorKind s_transformStreamDefaultControllerTerminateCodeConstructorKind;
extern const JSC::ImplementationVisibility s_transformStreamDefaultControllerTerminateCodeImplementationVisibility;

#define WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_DATA(macro) \
    macro(initializeTransformStreamDefaultController, transformStreamDefaultControllerInitializeTransformStreamDefaultController, 0) \
    macro(desiredSize, transformStreamDefaultControllerDesiredSize, 0) \
    macro(enqueue, transformStreamDefaultControllerEnqueue, 1) \
    macro(error, transformStreamDefaultControllerError, 1) \
    macro(terminate, transformStreamDefaultControllerTerminate, 0) \

#define WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_CODE(macro) \
    macro(transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCode, initializeTransformStreamDefaultController, ASCIILiteral(), s_transformStreamDefaultControllerInitializeTransformStreamDefaultControllerCodeLength) \
    macro(transformStreamDefaultControllerDesiredSizeCode, desiredSize, "get desiredSize"_s, s_transformStreamDefaultControllerDesiredSizeCodeLength) \
    macro(transformStreamDefaultControllerEnqueueCode, enqueue, ASCIILiteral(), s_transformStreamDefaultControllerEnqueueCodeLength) \
    macro(transformStreamDefaultControllerErrorCode, error, ASCIILiteral(), s_transformStreamDefaultControllerErrorCodeLength) \
    macro(transformStreamDefaultControllerTerminateCode, terminate, ASCIILiteral(), s_transformStreamDefaultControllerTerminateCodeLength) \

#define WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(macro) \
    macro(initializeTransformStreamDefaultController) \
    macro(desiredSize) \
    macro(enqueue) \
    macro(error) \
    macro(terminate) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class TransformStreamDefaultControllerBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit TransformStreamDefaultControllerBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* TransformStreamDefaultControllerBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void TransformStreamDefaultControllerBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_TRANSFORMSTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

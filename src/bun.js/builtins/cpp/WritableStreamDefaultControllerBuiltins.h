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
/* WritableStreamDefaultController.ts */
// initializeWritableStreamDefaultController
#define WEBCORE_BUILTIN_WRITABLESTREAMDEFAULTCONTROLLER_INITIALIZEWRITABLESTREAMDEFAULTCONTROLLER 1
extern const char* const s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCode;
extern const int s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeLength;
extern const JSC::ConstructAbility s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeConstructAbility;
extern const JSC::ConstructorKind s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeConstructorKind;
extern const JSC::ImplementationVisibility s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeImplementationVisibility;

// error
#define WEBCORE_BUILTIN_WRITABLESTREAMDEFAULTCONTROLLER_ERROR 1
extern const char* const s_writableStreamDefaultControllerErrorCode;
extern const int s_writableStreamDefaultControllerErrorCodeLength;
extern const JSC::ConstructAbility s_writableStreamDefaultControllerErrorCodeConstructAbility;
extern const JSC::ConstructorKind s_writableStreamDefaultControllerErrorCodeConstructorKind;
extern const JSC::ImplementationVisibility s_writableStreamDefaultControllerErrorCodeImplementationVisibility;

#define WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_DATA(macro) \
    macro(initializeWritableStreamDefaultController, writableStreamDefaultControllerInitializeWritableStreamDefaultController, 0) \
    macro(error, writableStreamDefaultControllerError, 1) \

#define WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(macro) \
    macro(writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCode, initializeWritableStreamDefaultController, ASCIILiteral(), s_writableStreamDefaultControllerInitializeWritableStreamDefaultControllerCodeLength) \
    macro(writableStreamDefaultControllerErrorCode, error, ASCIILiteral(), s_writableStreamDefaultControllerErrorCodeLength) \

#define WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(macro) \
    macro(initializeWritableStreamDefaultController) \
    macro(error) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class WritableStreamDefaultControllerBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit WritableStreamDefaultControllerBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* WritableStreamDefaultControllerBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void WritableStreamDefaultControllerBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_WRITABLESTREAMDEFAULTCONTROLLER_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

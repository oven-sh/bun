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
/* ProcessObjectInternals.ts */
// binding
#define WEBCORE_BUILTIN_PROCESSOBJECTINTERNALS_BINDING 1
extern const char* const s_processObjectInternalsBindingCode;
extern const int s_processObjectInternalsBindingCodeLength;
extern const JSC::ConstructAbility s_processObjectInternalsBindingCodeConstructAbility;
extern const JSC::ConstructorKind s_processObjectInternalsBindingCodeConstructorKind;
extern const JSC::ImplementationVisibility s_processObjectInternalsBindingCodeImplementationVisibility;

// getStdioWriteStream
#define WEBCORE_BUILTIN_PROCESSOBJECTINTERNALS_GETSTDIOWRITESTREAM 1
extern const char* const s_processObjectInternalsGetStdioWriteStreamCode;
extern const int s_processObjectInternalsGetStdioWriteStreamCodeLength;
extern const JSC::ConstructAbility s_processObjectInternalsGetStdioWriteStreamCodeConstructAbility;
extern const JSC::ConstructorKind s_processObjectInternalsGetStdioWriteStreamCodeConstructorKind;
extern const JSC::ImplementationVisibility s_processObjectInternalsGetStdioWriteStreamCodeImplementationVisibility;

// getStdinStream
#define WEBCORE_BUILTIN_PROCESSOBJECTINTERNALS_GETSTDINSTREAM 1
extern const char* const s_processObjectInternalsGetStdinStreamCode;
extern const int s_processObjectInternalsGetStdinStreamCodeLength;
extern const JSC::ConstructAbility s_processObjectInternalsGetStdinStreamCodeConstructAbility;
extern const JSC::ConstructorKind s_processObjectInternalsGetStdinStreamCodeConstructorKind;
extern const JSC::ImplementationVisibility s_processObjectInternalsGetStdinStreamCodeImplementationVisibility;

#define WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_DATA(macro) \
    macro(binding, processObjectInternalsBinding, 1) \
    macro(getStdioWriteStream, processObjectInternalsGetStdioWriteStream, 2) \
    macro(getStdinStream, processObjectInternalsGetStdinStream, 3) \

#define WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_CODE(macro) \
    macro(processObjectInternalsBindingCode, binding, ASCIILiteral(), s_processObjectInternalsBindingCodeLength) \
    macro(processObjectInternalsGetStdioWriteStreamCode, getStdioWriteStream, ASCIILiteral(), s_processObjectInternalsGetStdioWriteStreamCodeLength) \
    macro(processObjectInternalsGetStdinStreamCode, getStdinStream, ASCIILiteral(), s_processObjectInternalsGetStdinStreamCodeLength) \

#define WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_FUNCTION_NAME(macro) \
    macro(binding) \
    macro(getStdioWriteStream) \
    macro(getStdinStream) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class ProcessObjectInternalsBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit ProcessObjectInternalsBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* ProcessObjectInternalsBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ProcessObjectInternalsBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_PROCESSOBJECTINTERNALS_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

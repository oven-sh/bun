#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* ConsoleObject.ts */
// asyncIterator
#define WEBCORE_BUILTIN_CONSOLEOBJECT_ASYNCITERATOR 1
extern const char* const s_consoleObjectAsyncIteratorCode;
extern const int s_consoleObjectAsyncIteratorCodeLength;
extern const JSC::ConstructAbility s_consoleObjectAsyncIteratorCodeConstructAbility;
extern const JSC::ConstructorKind s_consoleObjectAsyncIteratorCodeConstructorKind;
extern const JSC::ImplementationVisibility s_consoleObjectAsyncIteratorCodeImplementationVisibility;

// write
#define WEBCORE_BUILTIN_CONSOLEOBJECT_WRITE 1
extern const char* const s_consoleObjectWriteCode;
extern const int s_consoleObjectWriteCodeLength;
extern const JSC::ConstructAbility s_consoleObjectWriteCodeConstructAbility;
extern const JSC::ConstructorKind s_consoleObjectWriteCodeConstructorKind;
extern const JSC::ImplementationVisibility s_consoleObjectWriteCodeImplementationVisibility;

#define WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_DATA(macro) \
    macro(asyncIterator, consoleObjectAsyncIterator, 0) \
    macro(write, consoleObjectWrite, 1) \

#define WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(macro) \
    macro(consoleObjectAsyncIteratorCode, asyncIterator, "[Symbol.asyncIterator]"_s, s_consoleObjectAsyncIteratorCodeLength) \
    macro(consoleObjectWriteCode, write, ASCIILiteral(), s_consoleObjectWriteCodeLength) \

#define WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_FUNCTION_NAME(macro) \
    macro(asyncIterator) \
    macro(write) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class ConsoleObjectBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit ConsoleObjectBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* ConsoleObjectBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ConsoleObjectBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* TransformStream.ts */
// initializeTransformStream
#define WEBCORE_BUILTIN_TRANSFORMSTREAM_INITIALIZETRANSFORMSTREAM 1
extern const char* const s_transformStreamInitializeTransformStreamCode;
extern const int s_transformStreamInitializeTransformStreamCodeLength;
extern const JSC::ConstructAbility s_transformStreamInitializeTransformStreamCodeConstructAbility;
extern const JSC::ConstructorKind s_transformStreamInitializeTransformStreamCodeConstructorKind;
extern const JSC::ImplementationVisibility s_transformStreamInitializeTransformStreamCodeImplementationVisibility;

// readable
#define WEBCORE_BUILTIN_TRANSFORMSTREAM_READABLE 1
extern const char* const s_transformStreamReadableCode;
extern const int s_transformStreamReadableCodeLength;
extern const JSC::ConstructAbility s_transformStreamReadableCodeConstructAbility;
extern const JSC::ConstructorKind s_transformStreamReadableCodeConstructorKind;
extern const JSC::ImplementationVisibility s_transformStreamReadableCodeImplementationVisibility;

// writable
#define WEBCORE_BUILTIN_TRANSFORMSTREAM_WRITABLE 1
extern const char* const s_transformStreamWritableCode;
extern const int s_transformStreamWritableCodeLength;
extern const JSC::ConstructAbility s_transformStreamWritableCodeConstructAbility;
extern const JSC::ConstructorKind s_transformStreamWritableCodeConstructorKind;
extern const JSC::ImplementationVisibility s_transformStreamWritableCodeImplementationVisibility;

#define WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_DATA(macro) \
    macro(initializeTransformStream, transformStreamInitializeTransformStream, 0) \
    macro(readable, transformStreamReadable, 0) \
    macro(writable, transformStreamWritable, 0) \

#define WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_CODE(macro) \
    macro(transformStreamInitializeTransformStreamCode, initializeTransformStream, ASCIILiteral(), s_transformStreamInitializeTransformStreamCodeLength) \
    macro(transformStreamReadableCode, readable, "get readable"_s, s_transformStreamReadableCodeLength) \
    macro(transformStreamWritableCode, writable, ASCIILiteral(), s_transformStreamWritableCodeLength) \

#define WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_FUNCTION_NAME(macro) \
    macro(initializeTransformStream) \
    macro(readable) \
    macro(writable) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class TransformStreamBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit TransformStreamBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* TransformStreamBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void TransformStreamBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_TRANSFORMSTREAM_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* ByteLengthQueuingStrategy.ts */
// highWaterMark
#define WEBCORE_BUILTIN_BYTELENGTHQUEUINGSTRATEGY_HIGHWATERMARK 1
extern const char* const s_byteLengthQueuingStrategyHighWaterMarkCode;
extern const int s_byteLengthQueuingStrategyHighWaterMarkCodeLength;
extern const JSC::ConstructAbility s_byteLengthQueuingStrategyHighWaterMarkCodeConstructAbility;
extern const JSC::ConstructorKind s_byteLengthQueuingStrategyHighWaterMarkCodeConstructorKind;
extern const JSC::ImplementationVisibility s_byteLengthQueuingStrategyHighWaterMarkCodeImplementationVisibility;

// size
#define WEBCORE_BUILTIN_BYTELENGTHQUEUINGSTRATEGY_SIZE 1
extern const char* const s_byteLengthQueuingStrategySizeCode;
extern const int s_byteLengthQueuingStrategySizeCodeLength;
extern const JSC::ConstructAbility s_byteLengthQueuingStrategySizeCodeConstructAbility;
extern const JSC::ConstructorKind s_byteLengthQueuingStrategySizeCodeConstructorKind;
extern const JSC::ImplementationVisibility s_byteLengthQueuingStrategySizeCodeImplementationVisibility;

// initializeByteLengthQueuingStrategy
#define WEBCORE_BUILTIN_BYTELENGTHQUEUINGSTRATEGY_INITIALIZEBYTELENGTHQUEUINGSTRATEGY 1
extern const char* const s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCode;
extern const int s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeLength;
extern const JSC::ConstructAbility s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeConstructAbility;
extern const JSC::ConstructorKind s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeConstructorKind;
extern const JSC::ImplementationVisibility s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeImplementationVisibility;

#define WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_DATA(macro) \
    macro(highWaterMark, byteLengthQueuingStrategyHighWaterMark, 0) \
    macro(size, byteLengthQueuingStrategySize, 1) \
    macro(initializeByteLengthQueuingStrategy, byteLengthQueuingStrategyInitializeByteLengthQueuingStrategy, 1) \

#define WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_CODE(macro) \
    macro(byteLengthQueuingStrategyHighWaterMarkCode, highWaterMark, "get highWaterMark"_s, s_byteLengthQueuingStrategyHighWaterMarkCodeLength) \
    macro(byteLengthQueuingStrategySizeCode, size, ASCIILiteral(), s_byteLengthQueuingStrategySizeCodeLength) \
    macro(byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCode, initializeByteLengthQueuingStrategy, ASCIILiteral(), s_byteLengthQueuingStrategyInitializeByteLengthQueuingStrategyCodeLength) \

#define WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(macro) \
    macro(highWaterMark) \
    macro(size) \
    macro(initializeByteLengthQueuingStrategy) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class ByteLengthQueuingStrategyBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit ByteLengthQueuingStrategyBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* ByteLengthQueuingStrategyBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ByteLengthQueuingStrategyBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_BYTELENGTHQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

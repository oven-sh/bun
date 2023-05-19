#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* CountQueuingStrategy.ts */
// highWaterMark
#define WEBCORE_BUILTIN_COUNTQUEUINGSTRATEGY_HIGHWATERMARK 1
extern const char* const s_countQueuingStrategyHighWaterMarkCode;
extern const int s_countQueuingStrategyHighWaterMarkCodeLength;
extern const JSC::ConstructAbility s_countQueuingStrategyHighWaterMarkCodeConstructAbility;
extern const JSC::ConstructorKind s_countQueuingStrategyHighWaterMarkCodeConstructorKind;
extern const JSC::ImplementationVisibility s_countQueuingStrategyHighWaterMarkCodeImplementationVisibility;

// size
#define WEBCORE_BUILTIN_COUNTQUEUINGSTRATEGY_SIZE 1
extern const char* const s_countQueuingStrategySizeCode;
extern const int s_countQueuingStrategySizeCodeLength;
extern const JSC::ConstructAbility s_countQueuingStrategySizeCodeConstructAbility;
extern const JSC::ConstructorKind s_countQueuingStrategySizeCodeConstructorKind;
extern const JSC::ImplementationVisibility s_countQueuingStrategySizeCodeImplementationVisibility;

// initializeCountQueuingStrategy
#define WEBCORE_BUILTIN_COUNTQUEUINGSTRATEGY_INITIALIZECOUNTQUEUINGSTRATEGY 1
extern const char* const s_countQueuingStrategyInitializeCountQueuingStrategyCode;
extern const int s_countQueuingStrategyInitializeCountQueuingStrategyCodeLength;
extern const JSC::ConstructAbility s_countQueuingStrategyInitializeCountQueuingStrategyCodeConstructAbility;
extern const JSC::ConstructorKind s_countQueuingStrategyInitializeCountQueuingStrategyCodeConstructorKind;
extern const JSC::ImplementationVisibility s_countQueuingStrategyInitializeCountQueuingStrategyCodeImplementationVisibility;

#define WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_DATA(macro) \
    macro(highWaterMark, countQueuingStrategyHighWaterMark, 0) \
    macro(size, countQueuingStrategySize, 0) \
    macro(initializeCountQueuingStrategy, countQueuingStrategyInitializeCountQueuingStrategy, 1) \

#define WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(macro) \
    macro(countQueuingStrategyHighWaterMarkCode, highWaterMark, "get highWaterMark"_s, s_countQueuingStrategyHighWaterMarkCodeLength) \
    macro(countQueuingStrategySizeCode, size, ASCIILiteral(), s_countQueuingStrategySizeCodeLength) \
    macro(countQueuingStrategyInitializeCountQueuingStrategyCode, initializeCountQueuingStrategy, ASCIILiteral(), s_countQueuingStrategyInitializeCountQueuingStrategyCodeLength) \

#define WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(macro) \
    macro(highWaterMark) \
    macro(size) \
    macro(initializeCountQueuingStrategy) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class CountQueuingStrategyBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit CountQueuingStrategyBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* CountQueuingStrategyBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void CountQueuingStrategyBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

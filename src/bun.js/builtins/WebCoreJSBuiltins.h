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
extern const char* const s_CountQueuingStrategyHighWaterMarkCode;
extern const int s_CountQueuingStrategyHighWaterMarkCodeLength;
extern const JSC::ConstructAbility s_CountQueuingStrategyHighWaterMarkCodeConstructAbility;
extern const JSC::ConstructorKind s_CountQueuingStrategyHighWaterMarkCodeConstructorKind;
extern const JSC::ImplementationVisibility s_CountQueuingStrategyHighWaterMarkCodeImplementationVisibility;

// size
#define WEBCORE_BUILTIN_COUNTQUEUINGSTRATEGY_SIZE 1
extern const char* const s_CountQueuingStrategySizeCode;
extern const int s_CountQueuingStrategySizeCodeLength;
extern const JSC::ConstructAbility s_CountQueuingStrategySizeCodeConstructAbility;
extern const JSC::ConstructorKind s_CountQueuingStrategySizeCodeConstructorKind;
extern const JSC::ImplementationVisibility s_CountQueuingStrategySizeCodeImplementationVisibility;

// initializeCountQueuingStrategy
#define WEBCORE_BUILTIN_COUNTQUEUINGSTRATEGY_INITIALIZECOUNTQUEUINGSTRATEGY 1
extern const char* const s_CountQueuingStrategyInitializeCountQueuingStrategyCode;
extern const int s_CountQueuingStrategyInitializeCountQueuingStrategyCodeLength;
extern const JSC::ConstructAbility s_CountQueuingStrategyInitializeCountQueuingStrategyCodeConstructAbility;
extern const JSC::ConstructorKind s_CountQueuingStrategyInitializeCountQueuingStrategyCodeConstructorKind;
extern const JSC::ImplementationVisibility s_CountQueuingStrategyInitializeCountQueuingStrategyCodeImplementationVisibility;

#define WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_DATA(macro) \
    macro(highWaterMark, CountQueuingStrategyHighWaterMark, 0) \
    macro(size, CountQueuingStrategySize, 0) \
    macro(initializeCountQueuingStrategy, CountQueuingStrategyInitializeCountQueuingStrategy, 1) \

#define WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(macro) \
    macro(CountQueuingStrategyHighWaterMarkCode, highWaterMark, "get highWaterMark"_s, s_CountQueuingStrategyHighWaterMarkCodeLength) \
    macro(CountQueuingStrategySizeCode, size, ASCIILiteral(), s_CountQueuingStrategySizeCodeLength) \
    macro(CountQueuingStrategyInitializeCountQueuingStrategyCode, initializeCountQueuingStrategy, ASCIILiteral(), s_CountQueuingStrategyInitializeCountQueuingStrategyCodeLength) \

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

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length)     JSC::UnlinkedFunctionExecutable* name##Executable();     const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length)     JSC::SourceCode m_##name##Source;    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) inline JSC::UnlinkedFunctionExecutable* CountQueuingStrategyBuiltinsWrapper::name##Executable() {    if (!m_##name##Executable) {        JSC::Identifier executableName = functionName##PublicName();        if (overriddenName)            executableName = JSC::Identifier::fromString(m_vm, overriddenName);        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);    }    return m_##name##Executable.get();}
WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void CountQueuingStrategyBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_COUNTQUEUINGSTRATEGY_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
/* ConsoleObject.ts */
// asyncIterator
#define WEBCORE_BUILTIN_CONSOLEOBJECT_ASYNCITERATOR 1
extern const char* const s_ConsoleObjectAsyncIteratorCode;
extern const int s_ConsoleObjectAsyncIteratorCodeLength;
extern const JSC::ConstructAbility s_ConsoleObjectAsyncIteratorCodeConstructAbility;
extern const JSC::ConstructorKind s_ConsoleObjectAsyncIteratorCodeConstructorKind;
extern const JSC::ImplementationVisibility s_ConsoleObjectAsyncIteratorCodeImplementationVisibility;

// write
#define WEBCORE_BUILTIN_CONSOLEOBJECT_WRITE 1
extern const char* const s_ConsoleObjectWriteCode;
extern const int s_ConsoleObjectWriteCodeLength;
extern const JSC::ConstructAbility s_ConsoleObjectWriteCodeConstructAbility;
extern const JSC::ConstructorKind s_ConsoleObjectWriteCodeConstructorKind;
extern const JSC::ImplementationVisibility s_ConsoleObjectWriteCodeImplementationVisibility;

#define WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_DATA(macro) \
    macro(asyncIterator, ConsoleObjectAsyncIterator, 0) \
    macro(write, ConsoleObjectWrite, 1) \

#define WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(macro) \
    macro(ConsoleObjectAsyncIteratorCode, asyncIterator, "[Symbol.asyncIterator]"_s, s_ConsoleObjectAsyncIteratorCodeLength) \
    macro(ConsoleObjectWriteCode, write, ASCIILiteral(), s_ConsoleObjectWriteCodeLength) \

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

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length)     JSC::UnlinkedFunctionExecutable* name##Executable();     const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length)     JSC::SourceCode m_##name##Source;    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) inline JSC::UnlinkedFunctionExecutable* ConsoleObjectBuiltinsWrapper::name##Executable() {    if (!m_##name##Executable) {        JSC::Identifier executableName = functionName##PublicName();        if (overriddenName)            executableName = JSC::Identifier::fromString(m_vm, overriddenName);        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);    }    return m_##name##Executable.get();}
WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ConsoleObjectBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_CONSOLEOBJECT_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
/* BundlerPlugin.ts */
// runSetupFunction
#define WEBCORE_BUILTIN_BUNDLERPLUGIN_RUNSETUPFUNCTION 1
extern const char* const s_BundlerPluginRunSetupFunctionCode;
extern const int s_BundlerPluginRunSetupFunctionCodeLength;
extern const JSC::ConstructAbility s_BundlerPluginRunSetupFunctionCodeConstructAbility;
extern const JSC::ConstructorKind s_BundlerPluginRunSetupFunctionCodeConstructorKind;
extern const JSC::ImplementationVisibility s_BundlerPluginRunSetupFunctionCodeImplementationVisibility;

// runOnResolvePlugins
#define WEBCORE_BUILTIN_BUNDLERPLUGIN_RUNONRESOLVEPLUGINS 1
extern const char* const s_BundlerPluginRunOnResolvePluginsCode;
extern const int s_BundlerPluginRunOnResolvePluginsCodeLength;
extern const JSC::ConstructAbility s_BundlerPluginRunOnResolvePluginsCodeConstructAbility;
extern const JSC::ConstructorKind s_BundlerPluginRunOnResolvePluginsCodeConstructorKind;
extern const JSC::ImplementationVisibility s_BundlerPluginRunOnResolvePluginsCodeImplementationVisibility;

// runOnLoadPlugins
#define WEBCORE_BUILTIN_BUNDLERPLUGIN_RUNONLOADPLUGINS 1
extern const char* const s_BundlerPluginRunOnLoadPluginsCode;
extern const int s_BundlerPluginRunOnLoadPluginsCodeLength;
extern const JSC::ConstructAbility s_BundlerPluginRunOnLoadPluginsCodeConstructAbility;
extern const JSC::ConstructorKind s_BundlerPluginRunOnLoadPluginsCodeConstructorKind;
extern const JSC::ImplementationVisibility s_BundlerPluginRunOnLoadPluginsCodeImplementationVisibility;

#define WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_DATA(macro) \
    macro(runSetupFunction, BundlerPluginRunSetupFunction, 2) \
    macro(runOnResolvePlugins, BundlerPluginRunOnResolvePlugins, 5) \
    macro(runOnLoadPlugins, BundlerPluginRunOnLoadPlugins, 4) \

#define WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(macro) \
    macro(BundlerPluginRunSetupFunctionCode, runSetupFunction, ASCIILiteral(), s_BundlerPluginRunSetupFunctionCodeLength) \
    macro(BundlerPluginRunOnResolvePluginsCode, runOnResolvePlugins, ASCIILiteral(), s_BundlerPluginRunOnResolvePluginsCodeLength) \
    macro(BundlerPluginRunOnLoadPluginsCode, runOnLoadPlugins, ASCIILiteral(), s_BundlerPluginRunOnLoadPluginsCodeLength) \

#define WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_FUNCTION_NAME(macro) \
    macro(runSetupFunction) \
    macro(runOnResolvePlugins) \
    macro(runOnLoadPlugins) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class BundlerPluginBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit BundlerPluginBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length)     JSC::UnlinkedFunctionExecutable* name##Executable();     const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length)     JSC::SourceCode m_##name##Source;    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) inline JSC::UnlinkedFunctionExecutable* BundlerPluginBuiltinsWrapper::name##Executable() {    if (!m_##name##Executable) {        JSC::Identifier executableName = functionName##PublicName();        if (overriddenName)            executableName = JSC::Identifier::fromString(m_vm, overriddenName);        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);    }    return m_##name##Executable.get();}
WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void BundlerPluginBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}

} // namespace WebCore

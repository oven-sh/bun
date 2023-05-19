#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* BundlerPlugin.ts */
// runSetupFunction
#define WEBCORE_BUILTIN_BUNDLERPLUGIN_RUNSETUPFUNCTION 1
extern const char* const s_bundlerPluginRunSetupFunctionCode;
extern const int s_bundlerPluginRunSetupFunctionCodeLength;
extern const JSC::ConstructAbility s_bundlerPluginRunSetupFunctionCodeConstructAbility;
extern const JSC::ConstructorKind s_bundlerPluginRunSetupFunctionCodeConstructorKind;
extern const JSC::ImplementationVisibility s_bundlerPluginRunSetupFunctionCodeImplementationVisibility;

// runOnResolvePlugins
#define WEBCORE_BUILTIN_BUNDLERPLUGIN_RUNONRESOLVEPLUGINS 1
extern const char* const s_bundlerPluginRunOnResolvePluginsCode;
extern const int s_bundlerPluginRunOnResolvePluginsCodeLength;
extern const JSC::ConstructAbility s_bundlerPluginRunOnResolvePluginsCodeConstructAbility;
extern const JSC::ConstructorKind s_bundlerPluginRunOnResolvePluginsCodeConstructorKind;
extern const JSC::ImplementationVisibility s_bundlerPluginRunOnResolvePluginsCodeImplementationVisibility;

// runOnLoadPlugins
#define WEBCORE_BUILTIN_BUNDLERPLUGIN_RUNONLOADPLUGINS 1
extern const char* const s_bundlerPluginRunOnLoadPluginsCode;
extern const int s_bundlerPluginRunOnLoadPluginsCodeLength;
extern const JSC::ConstructAbility s_bundlerPluginRunOnLoadPluginsCodeConstructAbility;
extern const JSC::ConstructorKind s_bundlerPluginRunOnLoadPluginsCodeConstructorKind;
extern const JSC::ImplementationVisibility s_bundlerPluginRunOnLoadPluginsCodeImplementationVisibility;

#define WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_DATA(macro) \
    macro(runSetupFunction, bundlerPluginRunSetupFunction, 2) \
    macro(runOnResolvePlugins, bundlerPluginRunOnResolvePlugins, 5) \
    macro(runOnLoadPlugins, bundlerPluginRunOnLoadPlugins, 4) \

#define WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(macro) \
    macro(bundlerPluginRunSetupFunctionCode, runSetupFunction, ASCIILiteral(), s_bundlerPluginRunSetupFunctionCodeLength) \
    macro(bundlerPluginRunOnResolvePluginsCode, runOnResolvePlugins, ASCIILiteral(), s_bundlerPluginRunOnResolvePluginsCodeLength) \
    macro(bundlerPluginRunOnLoadPluginsCode, runOnLoadPlugins, ASCIILiteral(), s_bundlerPluginRunOnLoadPluginsCodeLength) \

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

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* BundlerPluginBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void BundlerPluginBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_BUNDLERPLUGIN_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

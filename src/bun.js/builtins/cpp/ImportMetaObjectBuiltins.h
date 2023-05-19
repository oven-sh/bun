#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* ImportMetaObject.ts */
// loadCJS2ESM
#define WEBCORE_BUILTIN_IMPORTMETAOBJECT_LOADCJS2ESM 1
extern const char* const s_importMetaObjectLoadCJS2ESMCode;
extern const int s_importMetaObjectLoadCJS2ESMCodeLength;
extern const JSC::ConstructAbility s_importMetaObjectLoadCJS2ESMCodeConstructAbility;
extern const JSC::ConstructorKind s_importMetaObjectLoadCJS2ESMCodeConstructorKind;
extern const JSC::ImplementationVisibility s_importMetaObjectLoadCJS2ESMCodeImplementationVisibility;

// requireESM
#define WEBCORE_BUILTIN_IMPORTMETAOBJECT_REQUIREESM 1
extern const char* const s_importMetaObjectRequireESMCode;
extern const int s_importMetaObjectRequireESMCodeLength;
extern const JSC::ConstructAbility s_importMetaObjectRequireESMCodeConstructAbility;
extern const JSC::ConstructorKind s_importMetaObjectRequireESMCodeConstructorKind;
extern const JSC::ImplementationVisibility s_importMetaObjectRequireESMCodeImplementationVisibility;

// internalRequire
#define WEBCORE_BUILTIN_IMPORTMETAOBJECT_INTERNALREQUIRE 1
extern const char* const s_importMetaObjectInternalRequireCode;
extern const int s_importMetaObjectInternalRequireCodeLength;
extern const JSC::ConstructAbility s_importMetaObjectInternalRequireCodeConstructAbility;
extern const JSC::ConstructorKind s_importMetaObjectInternalRequireCodeConstructorKind;
extern const JSC::ImplementationVisibility s_importMetaObjectInternalRequireCodeImplementationVisibility;

// require
#define WEBCORE_BUILTIN_IMPORTMETAOBJECT_REQUIRE 1
extern const char* const s_importMetaObjectRequireCode;
extern const int s_importMetaObjectRequireCodeLength;
extern const JSC::ConstructAbility s_importMetaObjectRequireCodeConstructAbility;
extern const JSC::ConstructorKind s_importMetaObjectRequireCodeConstructorKind;
extern const JSC::ImplementationVisibility s_importMetaObjectRequireCodeImplementationVisibility;

// main
#define WEBCORE_BUILTIN_IMPORTMETAOBJECT_MAIN 1
extern const char* const s_importMetaObjectMainCode;
extern const int s_importMetaObjectMainCodeLength;
extern const JSC::ConstructAbility s_importMetaObjectMainCodeConstructAbility;
extern const JSC::ConstructorKind s_importMetaObjectMainCodeConstructorKind;
extern const JSC::ImplementationVisibility s_importMetaObjectMainCodeImplementationVisibility;

#define WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_DATA(macro) \
    macro(loadCJS2ESM, importMetaObjectLoadCJS2ESM, 1) \
    macro(requireESM, importMetaObjectRequireESM, 1) \
    macro(internalRequire, importMetaObjectInternalRequire, 1) \
    macro(require, importMetaObjectRequire, 1) \
    macro(main, importMetaObjectMain, 0) \

#define WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_CODE(macro) \
    macro(importMetaObjectLoadCJS2ESMCode, loadCJS2ESM, ASCIILiteral(), s_importMetaObjectLoadCJS2ESMCodeLength) \
    macro(importMetaObjectRequireESMCode, requireESM, ASCIILiteral(), s_importMetaObjectRequireESMCodeLength) \
    macro(importMetaObjectInternalRequireCode, internalRequire, ASCIILiteral(), s_importMetaObjectInternalRequireCodeLength) \
    macro(importMetaObjectRequireCode, require, ASCIILiteral(), s_importMetaObjectRequireCodeLength) \
    macro(importMetaObjectMainCode, main, "get main"_s, s_importMetaObjectMainCodeLength) \

#define WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_FUNCTION_NAME(macro) \
    macro(loadCJS2ESM) \
    macro(requireESM) \
    macro(internalRequire) \
    macro(require) \
    macro(main) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class ImportMetaObjectBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit ImportMetaObjectBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* ImportMetaObjectBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ImportMetaObjectBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_IMPORTMETAOBJECT_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

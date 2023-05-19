#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* ReadableStreamBYOBRequest.ts */
// initializeReadableStreamBYOBRequest
#define WEBCORE_BUILTIN_READABLESTREAMBYOBREQUEST_INITIALIZEREADABLESTREAMBYOBREQUEST 1
extern const char* const s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCode;
extern const int s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeLength;
extern const JSC::ConstructAbility s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeImplementationVisibility;

// respond
#define WEBCORE_BUILTIN_READABLESTREAMBYOBREQUEST_RESPOND 1
extern const char* const s_readableStreamBYOBRequestRespondCode;
extern const int s_readableStreamBYOBRequestRespondCodeLength;
extern const JSC::ConstructAbility s_readableStreamBYOBRequestRespondCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamBYOBRequestRespondCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamBYOBRequestRespondCodeImplementationVisibility;

// respondWithNewView
#define WEBCORE_BUILTIN_READABLESTREAMBYOBREQUEST_RESPONDWITHNEWVIEW 1
extern const char* const s_readableStreamBYOBRequestRespondWithNewViewCode;
extern const int s_readableStreamBYOBRequestRespondWithNewViewCodeLength;
extern const JSC::ConstructAbility s_readableStreamBYOBRequestRespondWithNewViewCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamBYOBRequestRespondWithNewViewCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamBYOBRequestRespondWithNewViewCodeImplementationVisibility;

// view
#define WEBCORE_BUILTIN_READABLESTREAMBYOBREQUEST_VIEW 1
extern const char* const s_readableStreamBYOBRequestViewCode;
extern const int s_readableStreamBYOBRequestViewCodeLength;
extern const JSC::ConstructAbility s_readableStreamBYOBRequestViewCodeConstructAbility;
extern const JSC::ConstructorKind s_readableStreamBYOBRequestViewCodeConstructorKind;
extern const JSC::ImplementationVisibility s_readableStreamBYOBRequestViewCodeImplementationVisibility;

#define WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_DATA(macro) \
    macro(initializeReadableStreamBYOBRequest, readableStreamBYOBRequestInitializeReadableStreamBYOBRequest, 2) \
    macro(respond, readableStreamBYOBRequestRespond, 1) \
    macro(respondWithNewView, readableStreamBYOBRequestRespondWithNewView, 1) \
    macro(view, readableStreamBYOBRequestView, 0) \

#define WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_CODE(macro) \
    macro(readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCode, initializeReadableStreamBYOBRequest, ASCIILiteral(), s_readableStreamBYOBRequestInitializeReadableStreamBYOBRequestCodeLength) \
    macro(readableStreamBYOBRequestRespondCode, respond, ASCIILiteral(), s_readableStreamBYOBRequestRespondCodeLength) \
    macro(readableStreamBYOBRequestRespondWithNewViewCode, respondWithNewView, ASCIILiteral(), s_readableStreamBYOBRequestRespondWithNewViewCodeLength) \
    macro(readableStreamBYOBRequestViewCode, view, "get view"_s, s_readableStreamBYOBRequestViewCodeLength) \

#define WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_FUNCTION_NAME(macro) \
    macro(initializeReadableStreamBYOBRequest) \
    macro(respond) \
    macro(respondWithNewView) \
    macro(view) \

#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class ReadableStreamBYOBRequestBuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit ReadableStreamBYOBRequestBuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* ReadableStreamBYOBRequestBuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ReadableStreamBYOBRequestBuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_READABLESTREAMBYOBREQUEST_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
} // namespace WebCore

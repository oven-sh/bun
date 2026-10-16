#include "config.h"
#include "JSDOMCSSNamespace.h"

#include "DOMCSSNamespace.h"
#include "JSDOMBinding.h"
#include "JSDOMConvertBoolean.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/StructureCreateInlines.h>

namespace WebCore {
using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(jsDOMCSSNamespaceFunction_supports);
static JSC_DECLARE_HOST_FUNCTION(jsDOMCSSNamespaceFunction_escape);

static const std::array<HashTableValue, 2> JSDOMCSSNamespaceTableValues {
    HashTableValue { "supports"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDOMCSSNamespaceFunction_supports, 1 } },
    HashTableValue { "escape"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDOMCSSNamespaceFunction_escape, 1 } },
};

const ClassInfo JSDOMCSSNamespace::s_info = { "CSS"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDOMCSSNamespace) };

JSDOMCSSNamespace* JSDOMCSSNamespace::create(VM& vm, Structure* structure, JSDOMGlobalObject&)
{
    auto* object = new (NotNull, allocateCell<JSDOMCSSNamespace>(vm)) JSDOMCSSNamespace(vm, structure);
    object->finishCreation(vm);
    return object;
}

Structure* JSDOMCSSNamespace::createStructure(VM& vm, JSGlobalObject& globalObject, JSValue prototype)
{
    return Structure::create(vm, &globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSValue JSDOMCSSNamespace::prototypeForStructure(VM&, const JSDOMGlobalObject& globalObject)
{
    return globalObject.objectPrototype();
}

void JSDOMCSSNamespace::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, info(), JSDOMCSSNamespaceTableValues, *this);
    putDirectWithoutTransition(vm, vm.propertyNames->toStringTagSymbol, jsNontrivialString(vm, "CSS"_s), PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly);
}

JSValue JSDOMCSSNamespace::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSDOMCSSNamespace, DOMConstructorID::DOMCSSNamespace>(vm, *uncheckedDowncast<JSDOMGlobalObject>(globalObject));
}

// boolean supports(DOMString property, DOMString value);
// boolean supports(DOMString conditionText);
JSC_DEFINE_HOST_FUNCTION(jsDOMCSSNamespaceFunction_supports, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (!callFrame->argumentCount()) [[unlikely]]
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));

    auto first = convert<IDLDOMString>(*lexicalGlobalObject, callFrame->uncheckedArgument(0));
    if (first.hasException(throwScope)) [[unlikely]]
        return encodedJSValue();
    if (callFrame->argumentCount() == 1)
        return JSValue::encode(jsBoolean(DOMCSSNamespace::supports(first.releaseReturnValue())));

    auto second = convert<IDLDOMString>(*lexicalGlobalObject, callFrame->uncheckedArgument(1));
    if (second.hasException(throwScope)) [[unlikely]]
        return encodedJSValue();
    return JSValue::encode(jsBoolean(DOMCSSNamespace::supports(first.releaseReturnValue(), second.releaseReturnValue())));
}

// DOMString escape(DOMString ident);
JSC_DEFINE_HOST_FUNCTION(jsDOMCSSNamespaceFunction_escape, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (!callFrame->argumentCount()) [[unlikely]]
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));

    auto ident = convert<IDLDOMString>(*lexicalGlobalObject, callFrame->uncheckedArgument(0));
    if (ident.hasException(throwScope)) [[unlikely]]
        return encodedJSValue();
    RELEASE_AND_RETURN(throwScope, JSValue::encode(toJS<IDLDOMString>(*lexicalGlobalObject, throwScope, DOMCSSNamespace::escape(ident.releaseReturnValue()))));
}

} // namespace WebCore

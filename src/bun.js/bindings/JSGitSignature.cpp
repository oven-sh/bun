#include "root.h"
#include "JSGit.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/DateInstance.h"
#include "wtf/text/WTFString.h"
#include "helpers.h"
#include <git2.h>

namespace Bun {
using namespace JSC;

// ============================================================================
// JSGitSignature Implementation
// ============================================================================

const ClassInfo JSGitSignature::s_info = { "Signature"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitSignature) };

void JSGitSignature::finishCreation(VM& vm, JSGlobalObject* globalObject, const git_signature* sig)
{
    Base::finishCreation(vm);
    if (sig) {
        m_name = WTF::String::fromUTF8(sig->name ? sig->name : "");
        m_email = WTF::String::fromUTF8(sig->email ? sig->email : "");
        m_time = sig->when.time;
        m_offset = sig->when.offset;
    }
}

// Getter: name
JSC_DEFINE_CUSTOM_GETTER(jsGitSignatureGetter_name, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitSignature*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Signature"_s, "name"_s);
        return {};
    }

    return JSValue::encode(jsString(vm, thisObject->name()));
}

// Getter: email
JSC_DEFINE_CUSTOM_GETTER(jsGitSignatureGetter_email, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitSignature*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Signature"_s, "email"_s);
        return {};
    }

    return JSValue::encode(jsString(vm, thisObject->email()));
}

// Getter: date
JSC_DEFINE_CUSTOM_GETTER(jsGitSignatureGetter_date, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitSignature*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Signature"_s, "date"_s);
        return {};
    }

    // Convert git_time_t (seconds since epoch) to JavaScript Date (milliseconds)
    double ms = static_cast<double>(thisObject->time()) * 1000.0;
    return JSValue::encode(DateInstance::create(vm, globalObject->dateStructure(), ms));
}

// Getter: timezone
JSC_DEFINE_CUSTOM_GETTER(jsGitSignatureGetter_timezone, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitSignature*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Signature"_s, "timezone"_s);
        return {};
    }

    int offset = thisObject->offset();
    int hours = offset / 60;
    int minutes = offset % 60;
    if (minutes < 0) minutes = -minutes;

    char buf[16];
    snprintf(buf, sizeof(buf), "%+03d:%02d", hours, minutes);
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(buf)));
}

// Method: toString() -> "Name <email>"
JSC_DEFINE_HOST_FUNCTION(jsGitSignatureProtoFunc_toString, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitSignature*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Signature"_s, "toString"_s);
        return {};
    }

    WTF::String result = makeString(thisObject->name(), " <"_s, thisObject->email(), ">"_s);
    return JSValue::encode(jsString(vm, result));
}

// ============================================================================
// JSGitSignature Prototype Table
// ============================================================================

static const HashTableValue JSGitSignaturePrototypeTableValues[] = {
    { "name"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitSignatureGetter_name, 0 } },
    { "email"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitSignatureGetter_email, 0 } },
    { "date"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitSignatureGetter_date, 0 } },
    { "timezone"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitSignatureGetter_timezone, 0 } },
    { "toString"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitSignatureProtoFunc_toString, 0 } },
};

// ============================================================================
// JSGitSignaturePrototype Implementation
// ============================================================================

const ClassInfo JSGitSignaturePrototype::s_info = { "Signature"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitSignaturePrototype) };

void JSGitSignaturePrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSGitSignature::info(), JSGitSignaturePrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// ============================================================================
// JSGitSignatureConstructor Implementation
// ============================================================================

const ClassInfo JSGitSignatureConstructor::s_info = { "Signature"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitSignatureConstructor) };

JSGitSignatureConstructor* JSGitSignatureConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSGitSignaturePrototype* prototype)
{
    JSGitSignatureConstructor* constructor = new (NotNull, allocateCell<JSGitSignatureConstructor>(vm)) JSGitSignatureConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

void JSGitSignatureConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSGitSignaturePrototype* prototype)
{
    Base::finishCreation(vm, 0, "Signature"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSGitSignatureConstructor::construct(JSGlobalObject* globalObject, CallFrame*)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwException(globalObject, scope, createTypeError(globalObject, "Signature cannot be directly constructed"_s));
    return {};
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSGitSignatureConstructor::call(JSGlobalObject* globalObject, CallFrame*)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwException(globalObject, scope, createTypeError(globalObject, "Signature cannot be called as a function"_s));
    return {};
}

// ============================================================================
// Class Structure Initialization
// ============================================================================

void initJSGitSignatureClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototype = JSGitSignaturePrototype::create(init.vm, init.global, JSGitSignaturePrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
    auto* structure = JSGitSignature::createStructure(init.vm, init.global, prototype);
    auto* constructor = JSGitSignatureConstructor::create(init.vm, init.global, JSGitSignatureConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun

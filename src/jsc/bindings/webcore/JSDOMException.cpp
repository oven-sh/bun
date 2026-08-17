/*
    This file is part of the WebKit open source project.

    This library is free software; you can redistribute it and/or
    modify it under the terms of the GNU Library General Public
    License as published by the Free Software Foundation; either
    version 2 of the License, or (at your option) any later version.

    This library is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
    Library General Public License for more details.

    You should have received a copy of the GNU Library General Public License
    along with this library; see the file COPYING.LIB.  If not, write to
    the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
    Boston, MA 02110-1301, USA.
*/

#include "root.h"

#include "JSDOMException.h"

#include "JSDOMAttribute.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "WebCoreJSClientData.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/InternalFunction.h>

namespace WebCore {
using namespace JSC;

// Attributes

static JSC_DECLARE_CUSTOM_GETTER(jsDOMExceptionConstructor);
static JSC_DECLARE_CUSTOM_GETTER(jsDOMException_code);
static JSC_DECLARE_CUSTOM_GETTER(jsDOMException_name);
static JSC_DECLARE_CUSTOM_GETTER(jsDOMException_message);

class JSDOMExceptionPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSDOMExceptionPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSDOMExceptionPrototype* ptr = new (NotNull, JSC::allocateCell<JSDOMExceptionPrototype>(vm)) JSDOMExceptionPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSDOMExceptionPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSDOMExceptionPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSDOMExceptionPrototype, JSDOMExceptionPrototype::Base);

using JSDOMExceptionDOMConstructor = JSDOMConstructor<JSDOMException>;

/* Hash table for constructor */

static const HashTableValue JSDOMExceptionConstructorTableValues[] = {
    { "INDEX_SIZE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 1 } },
    { "DOMSTRING_SIZE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 2 } },
    { "HIERARCHY_REQUEST_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 3 } },
    { "WRONG_DOCUMENT_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 4 } },
    { "INVALID_CHARACTER_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 5 } },
    { "NO_DATA_ALLOWED_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 6 } },
    { "NO_MODIFICATION_ALLOWED_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 7 } },
    { "NOT_FOUND_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 8 } },
    { "NOT_SUPPORTED_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 9 } },
    { "INUSE_ATTRIBUTE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 10 } },
    { "INVALID_STATE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 11 } },
    { "SYNTAX_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 12 } },
    { "INVALID_MODIFICATION_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 13 } },
    { "NAMESPACE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 14 } },
    { "INVALID_ACCESS_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 15 } },
    { "VALIDATION_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 16 } },
    { "TYPE_MISMATCH_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 17 } },
    { "SECURITY_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 18 } },
    { "NETWORK_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 19 } },
    { "ABORT_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 20 } },
    { "URL_MISMATCH_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 21 } },
    { "QUOTA_EXCEEDED_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 22 } },
    { "TIMEOUT_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 23 } },
    { "INVALID_NODE_TYPE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 24 } },
    { "DATA_CLONE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 25 } },
};

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSDOMExceptionDOMConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = uncheckedDowncast<JSDOMExceptionDOMConstructor>(callFrame->jsCallee());
    ASSERT(castedThis);
    EnsureStillAliveScope argument0 = callFrame->argument(0);
    auto message = argument0.value().isUndefined() ? emptyString() : convert<IDLDOMString>(*lexicalGlobalObject, argument0.value());
    RETURN_IF_EXCEPTION(throwScope, {});

    String name = "Error"_s;
    JSValue cause = {};

    EnsureStillAliveScope argument1 = callFrame->argument(1);
    if (JSObject* optionsObj = argument1.value().getObject()) {
        // Get name from options
        JSValue nameValue = optionsObj->get(lexicalGlobalObject, vm.propertyNames->name);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!nameValue.isUndefined())
            name = convert<IDLDOMString>(*lexicalGlobalObject, nameValue);
        RETURN_IF_EXCEPTION(throwScope, {});

        // Get cause from options
        auto causeValue = optionsObj->getIfPropertyExists(lexicalGlobalObject, vm.propertyNames->cause);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (causeValue) {
            cause = causeValue;
        }
    } else if (!argument1.value().isUndefined()) {
        name = convert<IDLDOMString>(*lexicalGlobalObject, argument1.value());
        RETURN_IF_EXCEPTION(throwScope, {});
    }

    auto description = DOMException::create(WTF::move(message), WTF::move(name));

    // Like JSC's ErrorConstructor: a `class X extends DOMException` gets a structure whose
    // prototype is X.prototype, and the captured stack starts at the `new X()` call site.
    Structure* structure = getDOMStructure<JSDOMException>(vm, *castedThis->globalObject());
    JSObject* newTarget = callFrame->newTarget().getObject();
    if (newTarget && newTarget != castedThis) {
        auto* functionGlobalObject = getFunctionRealm(lexicalGlobalObject, newTarget);
        RETURN_IF_EXCEPTION(throwScope, {});
        structure = InternalFunction::createSubclassStructure(lexicalGlobalObject, newTarget, getDOMStructure<JSDOMException>(vm, *defaultGlobalObject(functionGlobalObject)));
        RETURN_IF_EXCEPTION(throwScope, {});
    } else {
        newTarget = nullptr;
    }

    return JSValue::encode(JSDOMException::create(vm, structure, description, cause, /* useCurrentFrame */ false, newTarget));
}
JSC_ANNOTATE_HOST_FUNCTION(JSDOMExceptionDOMConstructorConstruct, JSDOMExceptionDOMConstructor::construct);

template<> const ClassInfo JSDOMExceptionDOMConstructor::s_info = { "DOMException"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDOMExceptionDOMConstructor) };

template<> JSValue JSDOMExceptionDOMConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    UNUSED_PARAM(vm);
    return globalObject.functionPrototype();
}

template<> void JSDOMExceptionDOMConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "DOMException"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSDOMException::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    reifyStaticProperties(vm, JSDOMException::info(), JSDOMExceptionConstructorTableValues, *this);
}

/* Hash table for prototype */

static const HashTableValue JSDOMExceptionPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsDOMExceptionConstructor, 0 } },
    { "code"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsDOMException_code, 0 } },
    { "name"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsDOMException_name, 0 } },
    { "message"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsDOMException_message, 0 } },
    { "INDEX_SIZE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 1 } },
    { "DOMSTRING_SIZE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 2 } },
    { "HIERARCHY_REQUEST_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 3 } },
    { "WRONG_DOCUMENT_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 4 } },
    { "INVALID_CHARACTER_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 5 } },
    { "NO_DATA_ALLOWED_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 6 } },
    { "NO_MODIFICATION_ALLOWED_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 7 } },
    { "NOT_FOUND_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 8 } },
    { "NOT_SUPPORTED_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 9 } },
    { "INUSE_ATTRIBUTE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 10 } },
    { "INVALID_STATE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 11 } },
    { "SYNTAX_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 12 } },
    { "INVALID_MODIFICATION_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 13 } },
    { "NAMESPACE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 14 } },
    { "INVALID_ACCESS_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 15 } },
    { "VALIDATION_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 16 } },
    { "TYPE_MISMATCH_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 17 } },
    { "SECURITY_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 18 } },
    { "NETWORK_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 19 } },
    { "ABORT_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 20 } },
    { "URL_MISMATCH_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 21 } },
    { "QUOTA_EXCEEDED_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 22 } },
    { "TIMEOUT_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 23 } },
    { "INVALID_NODE_TYPE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 24 } },
    { "DATA_CLONE_ERR"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 25 } },
};

const ClassInfo JSDOMExceptionPrototype::s_info = { "DOMException"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDOMExceptionPrototype) };

void JSDOMExceptionPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSDOMException::info(), JSDOMExceptionPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSDOMException::s_info = { "DOMException"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDOMException) };

JSDOMException::JSDOMException(VM& vm, Structure* structure)
    : Base(vm, structure, ErrorType::Error)
{
}

JSDOMException* JSDOMException::create(VM& vm, Structure* structure, const DOMException& description, JSValue cause, bool useCurrentFrame, JSCell* subclassCaller)
{
    auto* exception = new (NotNull, allocateCell<JSDOMException>(vm)) JSDOMException(vm, structure);
    exception->finishCreation(vm, description, cause, useCurrentFrame, subclassCaller);
    return exception;
}

JSDOMException* JSDOMException::createWithStack(JSDOMGlobalObject& globalObject, const DOMException& description, LineColumn lineColumn, String&& sourceURL, String&& stack)
{
    VM& vm = globalObject.vm();
    // Looked up before allocateCell(): the first DOMException in a realm allocates the structure
    // and prototype, which is not allowed while a cell is being initialized.
    Structure* structure = getDOMStructure<JSDOMException>(vm, globalObject);
    auto* exception = new (NotNull, allocateCell<JSDOMException>(vm)) JSDOMException(vm, structure);
    exception->finishCreation(vm, description, lineColumn, WTF::move(sourceURL), WTF::move(stack));
    return exception;
}

// Both finishCreation overloads pass a null message: WebIDL wants `name`, `message` and `code` to be
// the prototype getters below, so ErrorInstance must not define an own `message` property
// (new DOMException("m").hasOwnProperty("message") is false).
void JSDOMException::finishCreation(VM& vm, const DOMException& description, JSValue cause, bool useCurrentFrame, JSCell* subclassCaller)
{
    Base::finishCreation(vm, String(), cause, nullptr, TypeNothing, useCurrentFrame, subclassCaller);
    storeDescription(vm, description);
}

void JSDOMException::finishCreation(VM& vm, const DOMException& description, LineColumn lineColumn, String&& sourceURL, String&& stack)
{
    Base::finishCreation(vm, String(), lineColumn, WTF::move(sourceURL), WTF::move(stack), String());
    storeDescription(vm, description);
}

void JSDOMException::storeDescription(VM& vm, const DOMException& description)
{
    ASSERT(inherits(info()));
    const auto& names = builtinNames(vm);
    constexpr unsigned attributes = PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete;
    putDirect(vm, names.domExceptionNamePrivateName(), jsString(vm, description.name()), attributes);
    putDirect(vm, names.domExceptionMessagePrivateName(), jsString(vm, description.message()), attributes);
    putDirect(vm, names.domExceptionCodePrivateName(), jsNumber(description.legacyCode()), attributes);
}

static inline JSValue storedSlot(const JSDOMException& exception, const Identifier& privateName)
{
    JSValue value = exception.getDirect(exception.vm(), privateName);
    ASSERT(value);
    return value;
}

String JSDOMException::name() const
{
    auto holder = asString(storedSlot(*this, builtinNames(vm()).domExceptionNamePrivateName()))->tryGetValue();
    return holder.data;
}

String JSDOMException::message() const
{
    auto holder = asString(storedSlot(*this, builtinNames(vm()).domExceptionMessagePrivateName()))->tryGetValue();
    return holder.data;
}

JSObject* JSDOMException::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return JSDOMExceptionPrototype::create(vm, &globalObject, JSDOMExceptionPrototype::createStructure(vm, &globalObject, globalObject.errorPrototype()));
}

JSObject* JSDOMException::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSDOMException>(vm, globalObject);
}

JSValue JSDOMException::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSDOMExceptionDOMConstructor, DOMConstructorID::DOMException>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsDOMExceptionConstructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSDOMExceptionPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(JSDOMException::getConstructor(JSC::getVM(lexicalGlobalObject), prototype->globalObject()));
}

// The `this` type check happens before these run: the prototype entries are DOMAttributes
// annotated with JSDOMException::info(), so a plain Error (or anything else) gets a TypeError.
static inline JSValue jsDOMException_codeGetter(JSGlobalObject& lexicalGlobalObject, JSDOMException& thisObject)
{
    return storedSlot(thisObject, builtinNames(JSC::getVM(&lexicalGlobalObject)).domExceptionCodePrivateName());
}

JSC_DEFINE_CUSTOM_GETTER(jsDOMException_code, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<JSDOMException>::get<jsDOMException_codeGetter, CastedThisErrorBehavior::Assert>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsDOMException_nameGetter(JSGlobalObject& lexicalGlobalObject, JSDOMException& thisObject)
{
    return storedSlot(thisObject, builtinNames(JSC::getVM(&lexicalGlobalObject)).domExceptionNamePrivateName());
}

JSC_DEFINE_CUSTOM_GETTER(jsDOMException_name, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<JSDOMException>::get<jsDOMException_nameGetter, CastedThisErrorBehavior::Assert>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsDOMException_messageGetter(JSGlobalObject& lexicalGlobalObject, JSDOMException& thisObject)
{
    return storedSlot(thisObject, builtinNames(JSC::getVM(&lexicalGlobalObject)).domExceptionMessagePrivateName());
}

JSC_DEFINE_CUSTOM_GETTER(jsDOMException_message, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<JSDOMException>::get<jsDOMException_messageGetter, CastedThisErrorBehavior::Assert>(*lexicalGlobalObject, thisValue, attributeName);
}

// Used for the DOMExceptions Bun itself throws (AbortError, DataCloneError, ...), so the stack
// starts at the JS frame that called into the native API.
JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, DOMException& description)
{
    VM& vm = globalObject->vm();
    return JSDOMException::create(vm, getDOMStructure<JSDOMException>(vm, *globalObject), description, JSValue(), /* useCurrentFrame */ true);
}

}

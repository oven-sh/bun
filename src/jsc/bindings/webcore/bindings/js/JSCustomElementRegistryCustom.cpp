/*
 * Copyright (C) 2015-2020 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "JSCustomElementRegistry.h"

#include "ContextDestructionObserverInlines.h"
#include "CustomElementRegistry.h"
#include "Document.h"
#include "HTMLNames.h"
#include "JSCustomElementInterface.h"
#include "JSDOMBinding.h"
#include "JSDOMConvertSequences.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMPromiseDeferred.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <wtf/SetForScope.h>


namespace WebCore {
using namespace JSC;

static JSObject* getCustomElementCallback(JSGlobalObject& lexicalGlobalObject, JSObject& prototype, const Identifier& id)
{
    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue callback = prototype.get(&lexicalGlobalObject, id);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (callback.isUndefined())
        return nullptr;
    if (!callback.isCallable()) {
        throwTypeError(&lexicalGlobalObject, scope, "A custom element callback must be a function"_s);
        return nullptr;
    }
    return callback.getObject();
}

static bool validateCustomElementNameAndThrowIfNeeded(JSGlobalObject& lexicalGlobalObject, const AtomString& name)
{
    auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject.vm());
    switch (Document::validateCustomElementName(name)) {
    case CustomElementNameValidationStatus::Valid:
        return true;
    case CustomElementNameValidationStatus::FirstCharacterIsNotLowercaseASCIILetter:
        throwDOMSyntaxError(lexicalGlobalObject, scope, "Custom element name must have a lowercase ASCII letter as its first character"_s);
        return false;
    case CustomElementNameValidationStatus::ContainsUppercaseASCIILetter:
        throwDOMSyntaxError(lexicalGlobalObject, scope, "Custom element name cannot contain an uppercase ASCII letter"_s);
        return false;
    case CustomElementNameValidationStatus::ContainsNoHyphen:
        throwDOMSyntaxError(lexicalGlobalObject, scope, "Custom element name must contain a hyphen"_s);
        return false;
    case CustomElementNameValidationStatus::ContainsDisallowedCharacter:
        throwDOMSyntaxError(lexicalGlobalObject, scope, "Custom element name contains a character that is not allowed"_s);
        return false;
    case CustomElementNameValidationStatus::ConflictsWithStandardElementName:
        throwDOMSyntaxError(lexicalGlobalObject, scope, "Custom element name cannot be same as one of the standard elements"_s);
        return false;
    }
    ASSERT_NOT_REACHED();
    return false;
}

// https://html.spec.whatwg.org/#dom-customelementregistry-define
JSValue JSCustomElementRegistry::define(JSGlobalObject& lexicalGlobalObject, CallFrame& callFrame)
{
    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame.argumentCount() < 2) [[unlikely]]
        return throwException(&lexicalGlobalObject, scope, createNotEnoughArgumentsError(&lexicalGlobalObject));

    AtomString localName(callFrame.uncheckedArgument(0).toString(&lexicalGlobalObject)->toAtomString(&lexicalGlobalObject));
    RETURN_IF_EXCEPTION(scope, { });

    JSValue constructorValue = callFrame.uncheckedArgument(1);
    if (!constructorValue.isConstructor())
        return throwTypeError(&lexicalGlobalObject, scope, "The second argument must be a constructor"_s);
    JSObject* constructor = constructorValue.getObject();

    validateCustomElementNameAndThrowIfNeeded(lexicalGlobalObject, localName);
    RETURN_IF_EXCEPTION(scope, { });

    CustomElementRegistry& registry = wrapped();

    if (registry.elementDefinitionIsRunning()) {
        throwNotSupportedError(lexicalGlobalObject, scope, "Cannot define a custom element while defining another custom element"_s);
        return jsUndefined();
    }
    SetForScope change(registry.elementDefinitionIsRunning(), true);

    if (registry.findInterface(localName)) {
        throwNotSupportedError(lexicalGlobalObject, scope, "Cannot define multiple custom elements with the same tag name"_s);
        return jsUndefined();
    }

    if (registry.containsConstructor(constructor)) {
        throwNotSupportedError(lexicalGlobalObject, scope, "Cannot define multiple custom elements with the same class"_s);
        return jsUndefined();
    }

    JSValue prototypeValue = constructor->get(&lexicalGlobalObject, vm.propertyNames->prototype);
    RETURN_IF_EXCEPTION(scope, { });
    if (!prototypeValue.isObject())
        return throwTypeError(&lexicalGlobalObject, scope, "Custom element constructor's prototype must be an object"_s);
    JSObject& prototypeObject = *asObject(prototypeValue);

    QualifiedName name(nullAtom(), localName, HTMLNames::xhtmlNamespaceURI);
    auto elementInterface = JSCustomElementInterface::create(name, constructor, realm());

    auto* connectedCallback = getCustomElementCallback(lexicalGlobalObject, prototypeObject, Identifier::fromString(vm, "connectedCallback"_s));
    if (connectedCallback)
        elementInterface->setConnectedCallback(connectedCallback);
    RETURN_IF_EXCEPTION(scope, { });

    auto* disconnectedCallback = getCustomElementCallback(lexicalGlobalObject, prototypeObject, Identifier::fromString(vm, "disconnectedCallback"_s));
    if (disconnectedCallback)
        elementInterface->setDisconnectedCallback(disconnectedCallback);
    RETURN_IF_EXCEPTION(scope, { });

    auto* adoptedCallback = getCustomElementCallback(lexicalGlobalObject, prototypeObject, Identifier::fromString(vm, "adoptedCallback"_s));
    if (adoptedCallback)
        elementInterface->setAdoptedCallback(adoptedCallback);
    RETURN_IF_EXCEPTION(scope, { });

    auto* attributeChangedCallback = getCustomElementCallback(lexicalGlobalObject, prototypeObject, Identifier::fromString(vm, "attributeChangedCallback"_s));
    RETURN_IF_EXCEPTION(scope, { });
    if (attributeChangedCallback) {
        auto observedAttributesValue = constructor->get(&lexicalGlobalObject, Identifier::fromString(vm, "observedAttributes"_s));
        RETURN_IF_EXCEPTION(scope, { });
        if (!observedAttributesValue.isUndefined()) {
            auto observedAttributes = convert<IDLSequence<IDLAtomStringAdaptor<IDLDOMString>>>(lexicalGlobalObject, observedAttributesValue);
            if (observedAttributes.hasException(scope)) [[unlikely]]
                return { };
            elementInterface->setAttributeChangedCallback(attributeChangedCallback, observedAttributes.releaseReturnValue());
        }
    }

    auto disabledFeaturesValue = constructor->get(&lexicalGlobalObject, Identifier::fromString(vm, "disabledFeatures"_s));
    RETURN_IF_EXCEPTION(scope, { });
    if (!disabledFeaturesValue.isUndefined()) {
        auto disabledFeatures = convert<IDLSequence<IDLDOMString>>(lexicalGlobalObject, disabledFeaturesValue);
        if (disabledFeatures.hasException(scope)) [[unlikely]]
            return { };

        if (disabledFeatures.returnValue().contains("internals"_s))
            elementInterface->disableElementInternals();
        if (disabledFeatures.returnValue().contains("shadow"_s))
            elementInterface->disableShadow();
    }

    auto formAssociatedValue = constructor->get(&lexicalGlobalObject, Identifier::fromString(vm, "formAssociated"_s));
    RETURN_IF_EXCEPTION(scope, { });
    if (formAssociatedValue.toBoolean(&lexicalGlobalObject)) {
        elementInterface->setIsFormAssociated();

        auto* formAssociatedCallback = getCustomElementCallback(lexicalGlobalObject, prototypeObject, Identifier::fromString(vm, "formAssociatedCallback"_s));
        RETURN_IF_EXCEPTION(scope, { });
        if (formAssociatedCallback)
            elementInterface->setFormAssociatedCallback(formAssociatedCallback);

        auto* formResetCallback = getCustomElementCallback(lexicalGlobalObject, prototypeObject, Identifier::fromString(vm, "formResetCallback"_s));
        RETURN_IF_EXCEPTION(scope, { });
        if (formResetCallback)
            elementInterface->setFormResetCallback(formResetCallback);

        auto* formDisabledCallback = getCustomElementCallback(lexicalGlobalObject, prototypeObject, Identifier::fromString(vm, "formDisabledCallback"_s));
        RETURN_IF_EXCEPTION(scope, { });
        if (formDisabledCallback)
            elementInterface->setFormDisabledCallback(formDisabledCallback);

        auto* formStateRestoreCallback = getCustomElementCallback(lexicalGlobalObject, prototypeObject, Identifier::fromString(vm, "formStateRestoreCallback"_s));
        RETURN_IF_EXCEPTION(scope, { });
        if (formStateRestoreCallback)
            elementInterface->setFormStateRestoreCallback(formStateRestoreCallback);
    }

    if (auto promise = registry.addElementDefinition(WTF::move(elementInterface)))
        promise->resolveWithJSValue(constructor);

    return jsUndefined();
}

// https://html.spec.whatwg.org/#dom-customelementregistry-whendefined
static JSValue whenDefinedPromise(JSGlobalObject& lexicalGlobalObject, CallFrame& callFrame, JSDOMGlobalObject& globalObject, CustomElementRegistry& registry, JSPromise& promise)
{
    auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject.vm());

    if (callFrame.argumentCount() < 1) [[unlikely]]
        return throwException(&lexicalGlobalObject, scope, createNotEnoughArgumentsError(&lexicalGlobalObject));

    AtomString localName(callFrame.uncheckedArgument(0).toString(&lexicalGlobalObject)->toAtomString(&lexicalGlobalObject));
    RETURN_IF_EXCEPTION(scope, { });

    validateCustomElementNameAndThrowIfNeeded(lexicalGlobalObject, localName);
    RETURN_IF_EXCEPTION(scope, { });

    if (RefPtr elementInterface = registry.findInterface(localName)) {
        DeferredPromise::create(globalObject, promise)->resolveWithJSValue(elementInterface->constructor());
        return &promise;
    }

    auto result = registry.promiseMap().ensure(localName, [&] {
        return DeferredPromise::create(globalObject, promise);
    });

    return result.iterator->value->promise();
}

JSValue JSCustomElementRegistry::whenDefined(JSGlobalObject& lexicalGlobalObject, CallFrame& callFrame)
{
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(lexicalGlobalObject.vm());

    ASSERT(realm());
    auto* result = JSPromise::create(lexicalGlobalObject.vm(), lexicalGlobalObject.promiseStructure());
    JSValue promise = whenDefinedPromise(lexicalGlobalObject, callFrame, *realm(), wrapped(), *result);

    if (catchScope.exception()) [[unlikely]] {
        rejectPromiseWithExceptionIfAny(lexicalGlobalObject, *realm(), *result, catchScope);
        // FIXME: We could have error since any JS call can throw stack-overflow errors.
        // https://bugs.webkit.org/show_bug.cgi?id=203402
        RETURN_IF_EXCEPTION(catchScope, JSC::jsUndefined());
        return result;
    }

    return promise;
}

template<typename Visitor>
void JSCustomElementRegistry::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    wrapped().visitJSCustomElementInterfacesInGCThread(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSCustomElementRegistry);

} // namespace WebCore

/*
 * Copyright (C) 2007, 2016 Apple Inc. All rights reserved.
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
#include "JSHTMLElement.h"

#include "CustomElementRegistry.h"
#include "Document.h"
#include "FormAssociatedElement.h"
#include "HTMLFormControlElement.h"
#include "HTMLFormElement.h"
#include "JSCustomElementInterface.h"
#include "JSDOMConstructorBase.h"
#include "JSDOMWrapperCache.h"
#include "JSHTMLElementWrapperFactory.h"
#include "JSNodeCustom.h"
#include "NodeDocument.h"
#include "Window.h"
#include <JavaScriptCore/CallFrameInlines.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSWithScope.h>

namespace WebCore {

using namespace JSC;

EncodedJSValue constructJSHTMLElement(JSGlobalObject* lexicalGlobalObject, CallFrame& callFrame)
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* jsConstructor = downcast<JSDOMConstructorBase>(callFrame.jsCallee());
    ASSERT(jsConstructor);

    auto* currentDocument = jsConstructor->document();
    if (!currentDocument)
        return throwConstructorScriptExecutionContextUnavailableError(*lexicalGlobalObject, scope, "HTMLElement"_s);

    auto* newTarget = callFrame.newTarget().getObject();
    auto* functionGlobalObject = getFunctionRealm(lexicalGlobalObject, newTarget);
    RETURN_IF_EXCEPTION(scope, { });
    // A class made in a node:vm context has a realm that is not a JSDOMGlobalObject.
    auto* newTargetGlobalObject = dynamicDowncast<JSDOMGlobalObject>(functionGlobalObject);
    if (!newTargetGlobalObject)
        newTargetGlobalObject = jsConstructor->realm();
    JSValue htmlElementConstructorValue = JSHTMLElement::getConstructor(vm, newTargetGlobalObject);
    if (newTarget == htmlElementConstructorValue || newTarget == jsConstructor)
        return throwVMTypeError(lexicalGlobalObject, scope, "new.target is not a valid custom element constructor"_s);

    Ref document = *currentDocument;

    RefPtr registry = document->activeCustomElementConstructorRegistry(newTarget);
    if (!registry) {
        RefPtr window = document->window();
        if (!window)
            return throwVMTypeError(lexicalGlobalObject, scope, "new.target is not a valid custom element constructor"_s);

        registry = window->customElementRegistry();
        if (!registry)
            return throwVMTypeError(lexicalGlobalObject, scope, "new.target is not a valid custom element constructor"_s);
    }

    RefPtr elementInterface = registry->findInterface(newTarget);
    if (!elementInterface)
        return throwVMTypeError(lexicalGlobalObject, scope, "new.target does not define a custom element"_s);

    if (!elementInterface->isUpgradingElement()) {
        Structure* baseStructure = getDOMStructure<JSHTMLElement>(vm, *newTargetGlobalObject);
        auto* newElementStructure = InternalFunction::createSubclassStructure(lexicalGlobalObject, newTarget, baseStructure);
        RETURN_IF_EXCEPTION(scope, { });

        Ref element = elementInterface->createElement(document);
        if (registry->isScoped())
            CustomElementRegistry::addToScopedCustomElementRegistryMap(element, *registry);
        element->setIsDefinedCustomElement(*elementInterface);
        auto* jsElement = JSHTMLElement::create(newElementStructure, newTargetGlobalObject, element.get());
        cacheWrapper(newTargetGlobalObject->world(), element.ptr(), jsElement);
        return JSValue::encode(jsElement);
    }

    RefPtr elementToUpgrade = elementInterface->lastElementInConstructionStack();
    if (!elementToUpgrade) {
        throwTypeError(lexicalGlobalObject, scope, "Cannot instantiate a custom element inside its own constructor during upgrades"_s);
        return JSValue::encode(jsUndefined());
    }

    JSValue elementWrapperValue = toJS(lexicalGlobalObject, jsConstructor->realm(), *elementToUpgrade);
    ASSERT(elementWrapperValue.isObject());

    JSValue newPrototype = newTarget->get(lexicalGlobalObject, vm.propertyNames->prototype);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    JSObject* elementWrapperObject = asObject(elementWrapperValue);
    JSObject::setPrototype(elementWrapperObject, lexicalGlobalObject, newPrototype, true /* shouldThrowIfCantSet */);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    elementInterface->didUpgradeLastElementInConstructionStack();

    return JSValue::encode(elementWrapperValue);
}

JSScope* JSHTMLElement::pushEventHandlerScope(JSGlobalObject* lexicalGlobalObject, JSScope* scope) const
{
    CheckedRef element = wrapped();

    // The document is put on first, fall back to searching it only after the element and form.
    // FIXME: This probably may use the wrong global object. If this is called from a native
    // function, then it would be correct but not optimal since the native function would *know*
    // the global object. But, it may be that globalObject() is more correct.
    // https://bugs.webkit.org/show_bug.cgi?id=134932
    VM& vm = lexicalGlobalObject->vm();
    
    scope = JSWithScope::create(vm, lexicalGlobalObject, scope, asObject(toJS(lexicalGlobalObject, realm(), protect(element->document()))));

    // The form is next, searched before the document, but after the element itself.
    if (RefPtr formAssociated = element->asFormAssociatedElement()) {
        if (RefPtr form = formAssociated->form())
            scope = JSWithScope::create(vm, lexicalGlobalObject, scope, asObject(toJS(lexicalGlobalObject, realm(), *form)));
    }

    // The element is on top, searched first.
    return JSWithScope::create(vm, lexicalGlobalObject, scope, asObject(toJS(lexicalGlobalObject, realm(), element)));
}

JSValue toJS(JSGlobalObject*, JSDOMGlobalObject* globalObject, HTMLElement& element)
{
    if (auto* wrapper = getCachedWrapper(globalObject->world(), element))
        return wrapper;
    return createJSHTMLWrapper(globalObject, element);
}

JSValue toJSNewlyCreated(JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<HTMLElement>&& element)
{
    if (element->isDefinedCustomElement()) {
        JSValue result = getCachedWrapper(globalObject->world(), element);
        if (result)
            return result;
        ASSERT(!globalObject->vm().exceptionForInspection());
    }
    ASSERT(!getCachedWrapper(globalObject->world(), element));
    return createJSHTMLWrapper(globalObject, WTF::move(element));
}

} // namespace WebCore

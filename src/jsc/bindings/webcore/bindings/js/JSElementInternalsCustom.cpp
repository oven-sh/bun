/*
 * Copyright (C) 2022 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "JSElementInternals.h"

#include "HTMLNames.h"
#include "IDLTypes.h"
#include "JSBlob.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertSequences.h"
#include "JSDOMConvertUnion.h"
#include "JSDOMFormData.h"
#include "JSElement.h"
#include "WebCoreJSClientData.h"
#include <JavaScriptCore/ObjectConstructor.h>

namespace WebCore {
using namespace JSC;

JSValue JSElementInternals::setFormValue(JSGlobalObject& lexicalGlobalObject, CallFrame& callFrame)
{
    using JSCustomElementFormValue = IDLUnion<IDLNull, IDLInterface<Blob>, IDLUSVString, IDLInterface<DOMFormData>>;

    auto& vm = lexicalGlobalObject.vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame.argumentCount() < 1) [[unlikely]] {
        throwException(&lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(&lexicalGlobalObject));
        return { };
    }

    EnsureStillAliveScope argument0 = callFrame.uncheckedArgument(0);
    auto value = convert<JSCustomElementFormValue>(lexicalGlobalObject, argument0.value());
    if (value.hasException(throwScope)) [[unlikely]]
        return { };

    std::optional<CustomElementFormValue> state;
    if (callFrame.argumentCount() > 1) {
        EnsureStillAliveScope argument1 = callFrame.argument(1);
        auto stateConversionResult = convert<JSCustomElementFormValue>(lexicalGlobalObject, argument1.value());
        if (stateConversionResult.hasException(throwScope)) [[unlikely]]
            return { };
        state = stateConversionResult.releaseReturnValue();
    }

    auto result = wrapped().setFormValue(value.releaseReturnValue(), WTF::move(state));
    if (result.hasException()) [[unlikely]] {
        propagateException(lexicalGlobalObject, throwScope, result.releaseException());
        return { };
    }

    return jsUndefined();
}

static JSValue getElementsArrayAttribute(JSGlobalObject& lexicalGlobalObject, const JSElementInternals& thisObject, const QualifiedName& attributeName)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSObject* cachedObject = nullptr;
    JSValue cachedObjectValue = thisObject.getDirect(vm, builtinNames(vm).cachedAttrAssociatedElementsPrivateName());
    if (cachedObjectValue)
        cachedObject = asObject(cachedObjectValue);
    else {
        cachedObject = JSC::constructEmptyObject(vm, thisObject.realm()->nullPrototypeObjectStructure());
        const_cast<JSElementInternals&>(thisObject).putDirect(vm, builtinNames(vm).cachedAttrAssociatedElementsPrivateName(), cachedObject);
    }

    std::optional<Vector<Ref<Element>>> elements = thisObject.wrapped().getElementsArrayAttributeForBindings(attributeName);
    auto propertyName = PropertyName(Identifier::fromString(vm, attributeName.toString()));
    JSValue cachedValue = cachedObject->getDirect(vm, propertyName);
    if (!cachedValue.isEmpty()) {
        auto cachedElements = convert<IDLNullable<IDLFrozenArray<IDLInterface<Element>>>>(lexicalGlobalObject, cachedValue);
        if (!cachedElements.hasException(throwScope) && elements == cachedElements.returnValue())
            return cachedValue;
    }

    JSValue elementsValue = toJS<IDLNullable<IDLFrozenArray<IDLInterface<Element>>>>(lexicalGlobalObject, *thisObject.realm(), throwScope, elements);
    cachedObject->putDirect(vm, propertyName, elementsValue);
    return elementsValue;
}

JSValue JSElementInternals::ariaControlsElements(JSGlobalObject& lexicalGlobalObject) const
{
    return getElementsArrayAttribute(lexicalGlobalObject, *this, WebCore::HTMLNames::aria_controlsAttr);
}

JSValue JSElementInternals::ariaDescribedByElements(JSGlobalObject& lexicalGlobalObject) const
{
    return getElementsArrayAttribute(lexicalGlobalObject, *this, WebCore::HTMLNames::aria_describedbyAttr);
}

JSValue JSElementInternals::ariaDetailsElements(JSGlobalObject& lexicalGlobalObject) const
{
    return getElementsArrayAttribute(lexicalGlobalObject, *this, WebCore::HTMLNames::aria_detailsAttr);
}

JSValue JSElementInternals::ariaErrorMessageElements(JSGlobalObject& lexicalGlobalObject) const
{
    return getElementsArrayAttribute(lexicalGlobalObject, *this, WebCore::HTMLNames::aria_errormessageAttr);
}

JSValue JSElementInternals::ariaFlowToElements(JSGlobalObject& lexicalGlobalObject) const
{
    return getElementsArrayAttribute(lexicalGlobalObject, *this, WebCore::HTMLNames::aria_flowtoAttr);
}

JSValue JSElementInternals::ariaLabelledByElements(JSGlobalObject& lexicalGlobalObject) const
{
    return getElementsArrayAttribute(lexicalGlobalObject, *this, WebCore::HTMLNames::aria_labelledbyAttr);
}

JSValue JSElementInternals::ariaOwnsElements(JSGlobalObject& lexicalGlobalObject) const
{
    return getElementsArrayAttribute(lexicalGlobalObject, *this, WebCore::HTMLNames::aria_ownsAttr);
}

} // namespace WebCore

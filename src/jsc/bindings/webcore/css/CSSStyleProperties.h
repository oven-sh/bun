/*
 * Copyright (C) 2025 Samuel Weinig <sam@webkit.org>
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
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "CSSProperty.h"
#include "CSSPropertyNames.h"
#include "CSSStyleDeclaration.h"
#include "MutableStyleProperties.h"
#include "StyledElement.h"
#include <wtf/RefCounted.h>
#include <wtf/RefPtr.h>
#include <wtf/WeakPtr.h>

namespace WebCore {

class CSSStyleProperties : public CSSStyleDeclaration {
    WTF_MAKE_TZONE_ALLOCATED(CSSStyleProperties);
public:
    StyleDeclarationType styleDeclarationType() const final { return StyleDeclarationType::Style; }

    String cssFloat();
    ExceptionOr<void> setCssFloat(const String&);

    // CSSPropertyID versions of the CSSOM functions to support bindings and editing.
    virtual String getPropertyValueInternal(CSSPropertyID) = 0;
    virtual ExceptionOr<void> setPropertyInternal(CSSPropertyID, const String& value, IsImportant) = 0;

    // The property that `style[propertyName]` stands for: "fontSize", "font-size", "WebkitTransform", "webkitTransform".
    static CSSPropertyID getCSSPropertyIDFromJavaScriptPropertyName(const AtomString&);
};

class PropertySetCSSStyleProperties : public CSSStyleProperties {
    WTF_MAKE_TZONE_ALLOCATED(PropertySetCSSStyleProperties);
public:
    explicit PropertySetCSSStyleProperties(MutableStyleProperties& propertySet)
        : m_propertySet(&propertySet)
    {
    }

    void LEGACY_NODELETE ref() const override;
    void deref() const override;

protected:
    enum class MutationType : uint8_t { NoChanges, StyleAttributeChanged, PropertyChanged };

    CheckedPtr<MutableStyleProperties> m_propertySet;

private:
    CSSRule* parentRule() const override { return nullptr; }
    unsigned length() const final;
    String item(unsigned index) const final;
    String getPropertyValue(const String& propertyName) final;
    String getPropertyPriority(const String& propertyName) final;
    ExceptionOr<void> setProperty(const String& propertyName, const String& value, const String& priority) final;
    ExceptionOr<String> removeProperty(const String& propertyName) final;
    String cssText() const final;
    ExceptionOr<void> setCssText(const String&) final;
    String getPropertyValueInternal(CSSPropertyID) final;
    ExceptionOr<void> setPropertyInternal(CSSPropertyID, const String& value, IsImportant) final;

    [[nodiscard]] virtual bool willMutate() { return true; }
    virtual void didMutate(MutationType) { }
};

// Owns the property set of a StyleRuleCSSStyleProperties. It is inherited before PropertySetCSSStyleProperties
// so that it is destroyed after PropertySetCSSStyleProperties::m_propertySet.
class StyleRuleCSSStylePropertiesOwner {
protected:
    explicit StyleRuleCSSStylePropertiesOwner(MutableStyleProperties& propertySet)
        : m_ownedPropertySet(propertySet)
    {
    }

    void setOwnedPropertySet(MutableStyleProperties& propertySet) { m_ownedPropertySet = propertySet; }

private:
    Ref<MutableStyleProperties> m_ownedPropertySet;
};

class StyleRuleCSSStyleProperties final : private StyleRuleCSSStylePropertiesOwner, public PropertySetCSSStyleProperties, public RefCounted<StyleRuleCSSStyleProperties> {
    WTF_MAKE_TZONE_ALLOCATED(StyleRuleCSSStyleProperties);
public:
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }

    static Ref<StyleRuleCSSStyleProperties> create(MutableStyleProperties& propertySet, CSSRule& parentRule)
    {
        return adoptRef(*new StyleRuleCSSStyleProperties(propertySet, parentRule));
    }
    virtual ~StyleRuleCSSStyleProperties();

    void clearParentRule() { m_parentRule = nullptr; }

private:
    StyleRuleCSSStyleProperties(MutableStyleProperties&, CSSRule&);

    CSSRule* LEGACY_NODELETE parentRule() const final;

    [[nodiscard]] bool willMutate() final;
    void didMutate(MutationType) final;

    WeakPtr<CSSRule> m_parentRule;
};

class InlineCSSStyleProperties final : public PropertySetCSSStyleProperties {
    WTF_MAKE_TZONE_ALLOCATED(InlineCSSStyleProperties);
public:
    InlineCSSStyleProperties(MutableStyleProperties& propertySet, StyledElement& parentElement)
        : PropertySetCSSStyleProperties(propertySet)
        , m_parentElement(parentElement)
    {
    }

private:
    StyledElement* parentElement() const final { return m_parentElement.get(); }

    void didMutate(MutationType) final;

    WeakPtr<StyledElement, WeakPtrImplWithEventTargetData> m_parentElement;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CSS_STYLE_DECLARATION(CSSStyleProperties, StyleDeclarationType::Style)

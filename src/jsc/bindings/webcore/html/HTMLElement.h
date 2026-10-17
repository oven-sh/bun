/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 *
 */

#pragma once

#include "HTMLNames.h"
#include "StyledElement.h"

namespace WebCore {

class ElementInternals;
class FormListedElement;
class FormAssociatedElement;
class HTMLButtonElement;
class HTMLFormElement;

enum class AutocapitalizeType : uint8_t;
enum class EnterKeyHint : uint8_t;
enum class InputMode : uint8_t;
enum class PopoverVisibilityState : bool;
enum class ToggleState : bool;

enum class FireEvents : bool { No, Yes };
enum class FocusPreviousElement : bool { No, Yes };

class HTMLElement : public StyledElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLElement);
public:
    static Ref<HTMLElement> create(const QualifiedName& tagName, Document&);

    WEBCORE_EXPORT String title() const final;

    WEBCORE_EXPORT ExceptionOr<void> setInnerText(String&&);
    WEBCORE_EXPORT ExceptionOr<void> setOuterText(String&&);

    enum class IncludeAltText : bool { No, Yes };
    static String htmlAwareTextContent(const Element&, IncludeAltText);

    virtual bool LEGACY_NODELETE hasCustomFocusLogic() const;
    bool supportsFocus() const override;

    WEBCORE_EXPORT String contentEditable() const;
    WEBCORE_EXPORT ExceptionOr<void> setContentEditable(const String&);

    static Editability editabilityFromContentEditableAttr(const Node&);

    virtual bool draggable() const;
    WEBCORE_EXPORT void setDraggable(bool);
    virtual bool isDraggableIgnoringAttributes() const { return false; }

    WEBCORE_EXPORT bool spellcheck() const;
    WEBCORE_EXPORT void setSpellcheck(bool);

    WEBCORE_EXPORT const AtomString& writingSuggestions() const;

    WEBCORE_EXPORT bool translate() const;
    WEBCORE_EXPORT void setTranslate(bool);

    WEBCORE_EXPORT void click();

    bool accessKeyAction(bool sendMouseEvents) override;

    String accessKeyLabel() const;

    WEBCORE_EXPORT const AtomString& dir() const;

    virtual bool isTextControlInnerTextElement() const { return false; }
    virtual bool isSearchFieldResultsButtonElement() const { return false; }
    virtual bool isDataListButtonElement() const { return false; }
    virtual bool isSelectFallbackButtonElement() const { return false; }
    virtual bool isSelectPopoverElement() const { return false; }

    // Represents "labelable element": https://html.spec.whatwg.org/multipage/forms.html#category-label
    virtual bool isLabelable() const { return false; }
    WEBCORE_EXPORT RefPtr<NodeList> labels();

    virtual FormAssociatedElement* LEGACY_NODELETE asFormAssociatedElement();

    virtual bool isInteractiveContent() const { return false; }

    bool hasTagName(const HTMLQualifiedName& name) const { return elementName() == name.nodeName(); }

    static const AtomString& eventNameForEventHandlerAttribute(const QualifiedName& attributeName);

    // Only some element types can be disabled: https://html.spec.whatwg.org/multipage/scripting.html#concept-element-disabled
    bool LEGACY_NODELETE canBeActuallyDisabled() const;
    virtual bool isActuallyDisabled() const;

#if ENABLE(AUTOCAPITALIZE)
    WEBCORE_EXPORT virtual AutocapitalizeType autocapitalizeType() const;
    WEBCORE_EXPORT const AtomString& autocapitalize() const;
#endif

#if ENABLE(AUTOCORRECT)
    bool autocorrect() const { return shouldAutocorrect(); }
    WEBCORE_EXPORT virtual bool shouldAutocorrect() const;
    WEBCORE_EXPORT void setAutocorrect(bool);
#endif

    const AtomString& inputMode() const;

    WEBCORE_EXPORT EnterKeyHint canonicalEnterKeyHint() const;
    String enterKeyHint() const;

    bool isHiddenUntilFound() const;
    std::optional<Variant<bool, double, String>> hidden() const;
    void setHidden(const std::optional<Variant<bool, double, String>>&);

    WEBCORE_EXPORT ExceptionOr<Ref<ElementInternals>> attachInternals();

    struct ShowPopoverOptions {
        RefPtr<HTMLElement> source;
    };

    struct TogglePopoverOptions : public ShowPopoverOptions {
        std::optional<bool> force;
    };

    void queuePopoverToggleEventTask(ToggleState oldState, ToggleState newState, Element* source);
    ExceptionOr<void> showPopover(const ShowPopoverOptions&);
    ExceptionOr<void> showPopoverInternal(HTMLElement* = nullptr);
    ExceptionOr<void> hidePopover();
    ExceptionOr<void> hidePopoverInternal(FocusPreviousElement, FireEvents, HTMLElement* = nullptr);
    ExceptionOr<bool> togglePopover(Variant<WebCore::HTMLElement::TogglePopoverOptions, bool>);

    const AtomString& LEGACY_NODELETE popover() const;
    void setPopover(const AtomString& value);
    void popoverAttributeChanged(const AtomString& value);

    bool isValidCommandType(const CommandType) override;
    bool handleCommandInternal(HTMLButtonElement& invoker, const CommandType&) override;

protected:
    HTMLElement(const QualifiedName& tagName, Document&, OptionSet<TypeFlag> = { });

    bool matchesReadWritePseudoClass() const override;
    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) override;
    void removingSteps(RemovalType, ContainerNode& oldParentOfRemovedTree) override;

    virtual void setPopoverVisibilityState(PopoverVisibilityState);
    virtual void popoverWasHidden() { }

    using EventHandlerNameMap = HashMap<AtomString, AtomString>;
    static const AtomString& LEGACY_NODELETE eventNameForEventHandlerAttribute(const QualifiedName& attributeName, const EventHandlerNameMap&);

private:
    HTMLElement(ClangVTableWorkaroundTag, const QualifiedName&, Document&);

    void setInvoker(HTMLElement*);

    String nodeName() const final;
};

inline bool Node::hasTagName(const HTMLQualifiedName& name) const
{
    auto* htmlElement = dynamicDowncast<HTMLElement>(*this);
    return htmlElement && htmlElement->hasTagName(name);
}

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::HTMLElement)
    static bool isType(const WebCore::Node& node) { return node.isHTMLElement(); }
    static bool isType(const WebCore::EventTarget& target)
    {
        auto* node = dynamicDowncast<WebCore::Node>(target);
        return node && isType(*node);
    }
SPECIALIZE_TYPE_TRAITS_END()

#include "HTMLElementTypeHelpers.h"

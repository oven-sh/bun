/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2021-2024 Google Inc. All rights reserved.
 * Copyright (C) 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
 * Copyright (C) 2011 Motorola Mobility. All rights reserved.
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

#include "config.h"
#include "HTMLElement.h"

#include "CommonAtomStrings.h"
#include "CustomElementReactionQueue.h"
#include "DOMClientData.h"
#include "DOMTokenList.h"
#include "DocumentFragment.h"
#include "DocumentInlines.h"
#include "ElementAncestorIteratorInlines.h"
#include "ElementChildIteratorInlines.h"
#include "ElementInternals.h"
#include "ElementRareData.h"
#include "EnterKeyHint.h"
#include "Event.h"
#include "EventNames.h"
#include "HTMLBRElement.h"
#include "HTMLButtonElement.h"
#include "HTMLDialogElement.h"
#include "HTMLDocument.h"
#include "HTMLElementFactory.h"
#include "HTMLFieldSetElement.h"
#include "HTMLFormElement.h"
#include "HTMLHeadingElement.h"
#include "HTMLImageElement.h"
#include "HTMLInputElement.h"
#include "HTMLMaybeFormAssociatedCustomElement.h"
#include "HTMLNames.h"
#include "HTMLOptGroupElement.h"
#include "HTMLOptionElement.h"
#include "HTMLParserIdioms.h"
#include "HTMLSelectElement.h"
#include "HTMLTextAreaElement.h"
#include "HTMLTextFormControlElement.h"
#include "InputMode.h"
#include "JSHTMLElement.h"
#include "LabelsNodeList.h"
#include "NodeName.h"
#include "NodeTraversal.h"
#include "PopoverData.h"
#include "ScriptDisallowedScope.h"
#include "ScriptElement.h"
#include "ShadowRoot.h"
#include "SimulatedClick.h"
#include "Text.h"
#include "ToggleEvent.h"
#include "TypedElementDescendantIteratorInlines.h"
#include "XMLNames.h"
#include "markup.h"
#include <wtf/Range.h>
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/CString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/unicode/CharacterNames.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLElement);

using namespace HTMLNames;

Ref<HTMLElement> HTMLElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLElement(tagName, document));
}

HTMLElement::HTMLElement(const QualifiedName& tagName, Document& document, OptionSet<TypeFlag> type)
    : StyledElement(tagName, document, type | TypeFlag::IsHTMLElement)
{
    ASSERT(tagName.localName().impl());
}

HTMLElement::HTMLElement(ClangVTableWorkaroundTag, const QualifiedName& name, Document& document)
    : HTMLElement(name, document)
{
}

String HTMLElement::nodeName() const
{
    // FIXME: Would be nice to have an AtomString lookup based off uppercase
    // ASCII characters that does not have to copy the string on a hit in the hash.
    if (document().isHTMLDocument()) {
        if (!tagQName().hasPrefix()) [[likely]]
            return tagQName().localNameUppercase();
        return Element::nodeName().convertToASCIIUppercase();
    }
    return Element::nodeName();
}

enum class ContentEditableType {
    Inherit,
    True,
    False,
    PlaintextOnly
};

static inline ContentEditableType contentEditableType(const AtomString& value)
{
    if (value.isNull())
        return ContentEditableType::Inherit;
    if (value.isEmpty() || equalLettersIgnoringASCIICase(value, "true"_s))
        return ContentEditableType::True;
    if (equalLettersIgnoringASCIICase(value, "false"_s))
        return ContentEditableType::False;
    if (equalLettersIgnoringASCIICase(value, "plaintext-only"_s))
        return ContentEditableType::PlaintextOnly;

    return ContentEditableType::Inherit;
}

static ContentEditableType contentEditableType(const HTMLElement& element)
{
    return contentEditableType(element.attributeWithoutSynchronization(contenteditableAttr));
}

const AtomString& HTMLElement::eventNameForEventHandlerAttribute(const QualifiedName& attributeName, const EventHandlerNameMap& map)
{
    ASSERT(!attributeName.localName().isNull());

    // Event handler attributes have no namespace.
    if (!attributeName.namespaceURI().isNull())
        return nullAtom();

    // Fast early return for names that don't start with "on".
    AtomStringImpl& localName = *attributeName.localName().impl();
    if (localName.length() < 3 || localName[0] != 'o' || localName[1] != 'n')
        return nullAtom();

    auto it = map.find(&localName);
    return it == map.end() ? nullAtom() : it->value;
}

const AtomString& HTMLElement::eventNameForEventHandlerAttribute(const QualifiedName& attributeName)
{
    auto& localName = attributeName.localName();
    if (localName.length() < 3 || localName[0] != 'o' || localName[1] != 'n')
        return nullAtom();

    auto& map = domClientData().htmlEventHandlerNames();
    if (map.isEmpty()) {
        JSHTMLElement::forEachEventHandlerContentAttribute([&] (const AtomString& attributeName, const AtomString& eventName) {
            map.add(attributeName, eventName);
        });
        // FIXME: Remove these special cases. These are not in IDL with [EventHandler] but were historically in this map.
        static constexpr std::array table {
            &onautocompleteAttr,
            &onautocompleteerrorAttr,
            &onbeforeloadAttr,
            &onfocusinAttr,
            &onfocusoutAttr,
            &ongesturechangeAttr,
            &ongestureendAttr,
            &ongesturestartAttr,
            &onwebkitbeginfullscreenAttr,
            &onwebkitcurrentplaybacktargetiswirelesschangedAttr,
            &onwebkitendfullscreenAttr,
            &onwebkitfullscreenchangeAttr,
            &onwebkitfullscreenerrorAttr,
            &onwebkitkeyaddedAttr,
            &onwebkitkeyerrorAttr,
            &onwebkitkeymessageAttr,
            &onwebkitneedkeyAttr,
            &onwebkitplaybacktargetavailabilitychangedAttr,
            &onwebkitpresentationmodechangedAttr,
        };
        for (auto& entry : table) {
            auto& name = entry->get().localName();
            map.add(name, AtomString { name.impl(), 2, String::MaxLength });
        }
    }
    return eventNameForEventHandlerAttribute(attributeName, map);
}

Node::Editability HTMLElement::editabilityFromContentEditableAttr(const Node& node)
{
    auto* startElement = dynamicDowncast<Element>(node);
    if (!startElement)
        startElement = node.parentElement();
    if (startElement) {
        for (Ref element : lineageOfType<HTMLElement>(*startElement)) {
            switch (contentEditableType(element)) {
            case ContentEditableType::True:
                return Editability::CanEditRichly;
            case ContentEditableType::PlaintextOnly:
                return Editability::CanEditPlainText;
            case ContentEditableType::False:
                return Editability::ReadOnly;
            case ContentEditableType::Inherit:
                break;
            }
        }
    }

    RefPtr containingShadowRoot { node.containingShadowRoot() };
    if (containingShadowRoot && containingShadowRoot->mode() == ShadowRootMode::UserAgent)
        return Editability::ReadOnly;

    if (node.document().inDesignMode() && node.isInDocumentTree())
        return Editability::CanEditRichly;

    return Editability::ReadOnly;
}

bool HTMLElement::matchesReadWritePseudoClass() const
{
    return editabilityFromContentEditableAttr(*this) != Editability::ReadOnly;
}

void HTMLElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    StyledElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);

    switch (name.nodeName()) {
    case AttributeNames::tabindexAttr:
        if (auto optionalTabIndex = parseHTMLInteger(newValue))
            setTabIndexExplicitly(optionalTabIndex.value());
        else
            setTabIndexExplicitly(std::nullopt);
        return;
    case AttributeNames::headingoffsetAttr:
    case AttributeNames::headingresetAttr:
        document().setUsesHeadingOffsetAttribute();
        updateEffectiveHeadingOffsetForElementAndDescendants(*this, computedHeadingOffset(*this));
        return;
    case AttributeNames::popoverAttr:
        popoverAttributeChanged(newValue);
        return;
    default:
        break;
    }

    auto& eventName = eventNameForEventHandlerAttribute(name);
    if (!eventName.isNull())
        setAttributeEventListener(eventName, name, newValue);
}

void HTMLElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    if (popoverData())
        hidePopoverInternal(FocusPreviousElement::No, FireEvents::No);

    StyledElement::removingSteps(removalType, oldParentOfRemovedTree);
}

static Ref<DocumentFragment> textToFragment(Document& document, const String& text)
{
    Ref fragment = DocumentFragment::create(document);

    // It's safe to dispatch events on the new fragment since author scripts have no access to it yet.
    ScriptDisallowedScope::EventAllowedScope allowedScope(fragment);

    for (unsigned start = 0, length = text.length(); start < length; ) {
        // Find next line break.
        char16_t c = 0;
        unsigned i;
        for (i = start; i < length; i++) {
            c = text[i];
            if (c == '\r' || c == '\n')
                break;
        }

        // If text is not the empty string, then append a new Text node whose data is text and node document is document to fragment.
        if (i > start)
            fragment->appendChild(Text::create(document, text.substring(start, i - start)));

        if (i == length)
            break;

        fragment->appendChild(HTMLBRElement::create(document));
        // Make sure \r\n doesn't result in two line breaks.
        if (c == '\r' && i + 1 < length && text[i + 1] == '\n')
            ++i;

        start = i + 1; // Character after line break.
    }

    return fragment;
}

// Returns the conforming 'dir' value associated with the state the attribute is in (in its canonical case), if any,
// or the empty string if the attribute is in a state that has no associated keyword value or if the attribute is
// not in a defined state (e.g. the attribute is missing and there is no missing value default).
// http://www.whatwg.org/specs/web-apps/current-work/multipage/common-dom-interfaces.html#limited-to-only-known-values
static inline const AtomString& toValidDirValue(const AtomString& value)
{
    if (equalLettersIgnoringASCIICase(value, "ltr"_s))
        return ltrAtom();
    if (equalLettersIgnoringASCIICase(value, "rtl"_s))
        return rtlAtom();
    if (equalLettersIgnoringASCIICase(value, "auto"_s))
        return autoAtom();
    return nullAtom();
}

const AtomString& HTMLElement::dir() const
{
    return toValidDirValue(attributeWithoutSynchronization(dirAttr));
}

ExceptionOr<void> HTMLElement::setInnerText(String&& text)
{
    // FIXME: This doesn't take whitespace collapsing into account at all.

    if (!text.contains([](char16_t c) { return c == '\n' || c == '\r'; })) {
        stringReplaceAll(WTF::move(text));
        return { };
    }

    if (isConnected() && isTextControlInnerTextElement()) {
        if (!text.contains('\r')) {
            stringReplaceAll(WTF::move(text));
            return { };
        }
        String textWithConsistentLineBreaks = makeStringBySimplifyingNewLines(text);
        stringReplaceAll(WTF::move(textWithConsistentLineBreaks));
        return { };
    }

    // FIXME: This should use replaceAll(), after we fix that to work properly for DocumentFragment.
    // Add text nodes and <br> elements.
    Ref fragment = textToFragment(protect(document()), WTF::move(text));
    // It's safe to dispatch events on the new fragment since author scripts have no access to it yet.
    ScriptDisallowedScope::EventAllowedScope allowedScope(fragment.get());
    return replaceChildrenWithFragment(*this, WTF::move(fragment));
}

ExceptionOr<void> HTMLElement::setOuterText(String&& text)
{
    RefPtr parent = parentNode();
    if (!parent)
        return Exception { ExceptionCode::NoModificationAllowedError };

    RefPtr prev = previousSibling();
    RefPtr next = nextSibling();
    RefPtr<Node> newChild;

    // Convert text to fragment with <br> tags instead of linebreaks if needed.
    if (text.contains([](char16_t c) { return c == '\n' || c == '\r'; }))
        newChild = textToFragment(protect(document()), WTF::move(text));
    else
        newChild = Text::create(protect(document()), WTF::move(text));

    if (!parentNode())
        return Exception { ExceptionCode::HierarchyRequestError };

    auto replaceResult = parent->replaceChild(*newChild, *this);
    if (replaceResult.hasException())
        return replaceResult.releaseException();

    if (RefPtr node = dynamicDowncast<Text>(next ? next->previousSibling() : nullptr)) {
        auto result = mergeWithNextTextNode(*node);
        if (result.hasException())
            return result.releaseException();
    }
    if (RefPtr previousText = dynamicDowncast<Text>(WTF::move(prev))) {
        auto result = mergeWithNextTextNode(*previousText);
        if (result.hasException())
            return result.releaseException();
    }
    return { };
}

bool HTMLElement::hasCustomFocusLogic() const
{
    return false;
}

bool HTMLElement::supportsFocus() const
{
    if (Element::supportsFocus())
        return true;
    RefPtr parent = parentNode();
    return hasEditableStyle() && parent && !parent->hasEditableStyle();
}

String HTMLElement::contentEditable() const
{
    switch (contentEditableType(*this)) {
    case ContentEditableType::Inherit:
        return "inherit"_s;
    case ContentEditableType::True:
        return trueAtom();
    case ContentEditableType::False:
        return falseAtom();
    case ContentEditableType::PlaintextOnly:
        return plaintextOnlyAtom();
    }
    return "inherit"_s;
}

ExceptionOr<void> HTMLElement::setContentEditable(const String& enabled)
{
    if (equalLettersIgnoringASCIICase(enabled, "true"_s))
        setAttributeWithoutSynchronization(contenteditableAttr, trueAtom());
    else if (equalLettersIgnoringASCIICase(enabled, "false"_s))
        setAttributeWithoutSynchronization(contenteditableAttr, falseAtom());
    else if (equalLettersIgnoringASCIICase(enabled, "plaintext-only"_s))
        setAttributeWithoutSynchronization(contenteditableAttr, plaintextOnlyAtom());
    else if (equalLettersIgnoringASCIICase(enabled, "inherit"_s))
        removeAttribute(contenteditableAttr);
    else
        return Exception { ExceptionCode::SyntaxError };
    return { };
}

bool HTMLElement::draggable() const
{
    auto& value = attributeWithoutSynchronization(draggableAttr);
    if (isDraggableIgnoringAttributes())
        return !equalLettersIgnoringASCIICase(value, "false"_s);

    return equalLettersIgnoringASCIICase(value, "true"_s);
}

void HTMLElement::setDraggable(bool value)
{
    setAttributeWithoutSynchronization(draggableAttr, value ? trueAtom() : falseAtom());
}

bool HTMLElement::spellcheck() const
{
    return isSpellCheckingEnabled();
}

void HTMLElement::setSpellcheck(bool enable)
{
    setAttributeWithoutSynchronization(spellcheckAttr, enable ? trueAtom() : falseAtom());
}

const AtomString& HTMLElement::writingSuggestions() const
{
    return computedWritingSuggestionsValue() ? trueAtom() : falseAtom();
}

void HTMLElement::click()
{
    simulateClick(*this, nullptr, SendNoEvents, DoNotShowPressedLook, SimulatedClickSource::Bindings);
}

bool HTMLElement::accessKeyAction(bool sendMouseEvents)
{
    if (isFocusable())
        focus();
    return dispatchSimulatedClick(nullptr, sendMouseEvents ? SendMouseUpDownEvents : SendNoEvents);
}

String HTMLElement::accessKeyLabel() const
{
    const auto& accessKey = attributeWithoutSynchronization(accesskeyAttr);
    if (accessKey.isEmpty())
        return String();

    StringBuilder result;

    result.append("Alt+"_s);
    result.append(accessKey);
    return result.toString();
}

String HTMLElement::title() const
{
    return attributeWithoutSynchronization(titleAttr);
}

// https://html.spec.whatwg.org/multipage/form-elements.html#get-html-aware-text-content
String HTMLElement::htmlAwareTextContent(const Element& element, IncludeAltText includeAltText)
{
    StringBuilder text;
    for (RefPtr node = element.firstChild(); node;) {
        if (isScriptElement(*node)) {
            node = NodeTraversal::nextSkippingChildren(*node, &element);
            continue;
        }
        if (RefPtr textNode = dynamicDowncast<Text>(*node))
            text.append(textNode->data());
        if (RefPtr image = dynamicDowncast<HTMLImageElement>(*node)) {
            if (includeAltText == IncludeAltText::Yes)
                text.append(image->attributeWithoutSynchronization(altAttr));
            node = NodeTraversal::nextSkippingChildren(*node, &element);
            continue;
        }
        node = NodeTraversal::next(*node, &element);
    }
    return text.toString().simplifyWhiteSpace(isASCIIWhitespace);
}

bool HTMLElement::translate() const
{
    for (Ref element : lineageOfType<HTMLElement>(*this)) {
        const AtomString& value = element->attributeWithoutSynchronization(translateAttr);
        if (equalLettersIgnoringASCIICase(value, "yes"_s) || (value.isEmpty() && !value.isNull()))
            return true;
        if (equalLettersIgnoringASCIICase(value, "no"_s))
            return false;
    }
    // Default on the root element is translate=yes.
    return true;
}

void HTMLElement::setTranslate(bool enable)
{
    setAttributeWithoutSynchronization(translateAttr, enable ? "yes"_s : "no"_s);
}

FormAssociatedElement* HTMLElement::asFormAssociatedElement()
{
    return nullptr;
}

bool HTMLElement::canBeActuallyDisabled() const
{
    if (isAnyOf<HTMLButtonElement, HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement, HTMLOptGroupElement, HTMLOptionElement, HTMLFieldSetElement>(*this))
        return true;
    auto* customElement = dynamicDowncast<HTMLMaybeFormAssociatedCustomElement>(*this);
    return customElement && customElement->isFormAssociatedCustomElement();
}

bool HTMLElement::isActuallyDisabled() const
{
    return canBeActuallyDisabled() && isDisabledFormControl();
}

RefPtr<NodeList> HTMLElement::labels()
{
    if (!isLabelable())
        return nullptr;

    return ensureRareData().ensureNodeLists().addCacheWithAtomName<LabelsNodeList>(*this, starAtom());
}

#if ENABLE(AUTOCAPITALIZE)

const AtomString& HTMLElement::autocapitalize() const
{
    return stringForAutocapitalizeType(autocapitalizeType());
}

AutocapitalizeType HTMLElement::autocapitalizeType() const
{
    return autocapitalizeTypeForAttributeValue(attributeWithoutSynchronization(HTMLNames::autocapitalizeAttr));
}

#endif

#if ENABLE(AUTOCORRECT)

bool HTMLElement::shouldAutocorrect() const
{
    auto& autocorrectValue = attributeWithoutSynchronization(HTMLNames::autocorrectAttr);
    // Unrecognized values fall back to "on".
    return !equalLettersIgnoringASCIICase(autocorrectValue, "off"_s);
}

void HTMLElement::setAutocorrect(bool autocorrect)
{
    setAttributeWithoutSynchronization(autocorrectAttr, autocorrect ? onAtom() : offAtom());
}

#endif

const AtomString& HTMLElement::inputMode() const
{
    return stringForInputMode(inputModeForAttributeValue(attributeWithoutSynchronization(inputmodeAttr)));
}

EnterKeyHint HTMLElement::canonicalEnterKeyHint() const
{
    return enterKeyHintForAttributeValue(attributeWithoutSynchronization(enterkeyhintAttr));
}

String HTMLElement::enterKeyHint() const
{
    return attributeValueForEnterKeyHint(canonicalEnterKeyHint());
}

bool HTMLElement::isHiddenUntilFound() const
{
    return equalIgnoringASCIICase(attributeWithoutSynchronization(HTMLNames::hiddenAttr), "until-found"_s);
}

// https://html.spec.whatwg.org/#dom-hidden
std::optional<Variant<bool, double, String>> HTMLElement::hidden() const
{
    auto value = attributeWithoutSynchronization(HTMLNames::hiddenAttr);
    if (equalIgnoringASCIICase(value, "until-found"_s))
        return "until-found"_s;
    return !value.isNull();
}

// https://html.spec.whatwg.org/#dom-hidden
void HTMLElement::setHidden(const std::optional<Variant<bool, double, String>>& value)
{
    if (!value) {
        removeAttribute(hiddenAttr);
        return;
    }

    WTF::switchOn(*value, [&](bool boolean) {
        if (!boolean)
            removeAttribute(hiddenAttr);
        else
            setAttributeWithoutSynchronization(hiddenAttr, emptyAtom());
    }, [&](double number) {
        if (number == 0.0 || std::isnan(number))
            removeAttribute(hiddenAttr);
        else
            setAttributeWithoutSynchronization(hiddenAttr, emptyAtom());
    }, [&](const String& string) {
        if (equalIgnoringASCIICase(string, "until-found"_s))
            setAttributeWithoutSynchronization(hiddenAttr, "until-found"_s);
        else if (string.isEmpty())
            removeAttribute(hiddenAttr);
        else
            setAttributeWithoutSynchronization(hiddenAttr, emptyAtom());
    });
}

ExceptionOr<Ref<ElementInternals>> HTMLElement::attachInternals()
{
    CheckedPtr queue = reactionQueue();
    if (!queue)
        return Exception { ExceptionCode::NotSupportedError, "attachInternals is only supported on a custom element instance"_s };

    if (queue->isElementInternalsDisabled())
        return Exception { ExceptionCode::NotSupportedError, "attachInternals is disabled"_s };

    if (queue->isElementInternalsAttached())
        return Exception { ExceptionCode::NotSupportedError, "There is already an existing ElementInternals"_s };

    if (!isPrecustomizedOrDefinedCustomElement())
        return Exception { ExceptionCode::NotSupportedError, "Custom element is in an invalid state"_s };

    queue->setElementInternalsAttached();
    return ElementInternals::create(*this);
}

static ExceptionOr<bool> checkPopoverValidity(HTMLElement& element, PopoverVisibilityState expectedState, Document* expectedDocument = nullptr)
{
    if (element.popoverState() == PopoverState::None)
        return Exception { ExceptionCode::NotSupportedError, "Element does not have the popover attribute"_s };

    if (element.popoverData()->visibilityState() != expectedState)
        return false;

    if (!element.isConnected())
        return Exception { ExceptionCode::InvalidStateError, "Element is not connected"_s };

    if (expectedDocument && &element.document() != expectedDocument)
        return Exception { ExceptionCode::InvalidStateError, "Invalid when the document changes while showing or hiding a popover element"_s };

    if (auto* dialog = dynamicDowncast<HTMLDialogElement>(element); dialog && dialog->isModal())
        return Exception { ExceptionCode::InvalidStateError, "Element is a modal <dialog> element"_s };

    if (!protect(element.document())->isFullyActive())
        return Exception { ExceptionCode::InvalidStateError, "Invalid for popovers within documents that are not fully active"_s };

    return true;
}

// https://html.spec.whatwg.org/#popover-focusing-steps
static void runPopoverFocusingSteps(HTMLElement& popover)
{
    if (RefPtr dialog = dynamicDowncast<HTMLDialogElement>(popover)) {
        dialog->runFocusingSteps();
        return;
    }

    RefPtr control = popover.hasAttributeWithoutSynchronization(autofocusAttr) ? &popover : popover.findAutofocusDelegate();
    if (!control)
        return;

    control->runFocusingStepsForAutofocus();
}

void HTMLElement::queuePopoverToggleEventTask(ToggleState oldState, ToggleState newState, Element* source)
{
    if (auto* popoverData = this->popoverData())
        popoverData->ensureToggleEventTask(*this)->queue(oldState, newState, source);
    else
        ToggleEventTask::create(*this)->queue(oldState, newState, source);
}

ExceptionOr<void> HTMLElement::showPopover(const ShowPopoverOptions& options)
{
    // A scripted showPopover() during another popover's show/hide (e.g. from a beforetoggle
    // handler) is not allowed. See popover-open-in-beforetoggle.html.
    if (document().isRunningPopoverShowOrHide())
        return Exception { ExceptionCode::InvalidStateError, "Cannot show a popover while a popover is being shown or hidden"_s };
    return showPopoverInternal(options.source.get());
}

ExceptionOr<void> HTMLElement::showPopoverInternal(HTMLElement* source)
{
    auto check = checkPopoverValidity(*this, PopoverVisibilityState::Hidden);
    if (check.hasException())
        return check.releaseException();
    if (!check.returnValue())
        return { };

    Ref document = this->document();

    Document::PopoverShowOrHideScope popoverShowOrHideScope(document);

    if (popoverData())
        setInvoker(source);

    ASSERT(!isInTopLayer());

    PopoverData::ScopedStartShowingOrHiding showOrHidingPopoverScope(*this);
    auto fireEvents = showOrHidingPopoverScope.wasShowingOrHiding() ? FireEvents::No : FireEvents::Yes;

    ToggleEvent::Init init;
    init.oldState = "closed"_s;
    init.newState = "open"_s;
    init.source = source;
    Ref event = ToggleEvent::create(eventNames().beforetoggleEvent, init, Event::IsCancelable::Yes);
    dispatchEvent(event);
    if (event->defaultPrevented() || event->defaultHandled())
        return { };

    check = checkPopoverValidity(*this, PopoverVisibilityState::Hidden, document.ptr());
    if (check.hasException())
        return check.releaseException();
    if (!check.returnValue())
        return { };

    ASSERT(popoverData());

    bool shouldRestoreFocus = false;

    auto originalState = popoverState();
    if (originalState == PopoverState::Auto || originalState == PopoverState::Hint) {
        RefPtr ancestor = topmostPopoverAncestor(TopLayerElementType::Popover);

        auto isShowingAsHint = [](const HTMLElement& element) {
            return element.popoverData() && element.popoverData()->showingAsHint();
        };

        // A popover=auto shown with a hint ancestor is "demoted" to a hint and joins the hint
        // stack. See https://github.com/whatwg/html/issues/12304.
        bool showingAsHint = originalState == PopoverState::Hint || (ancestor && isShowingAsHint(*ancestor));

        if (!showingAsHint) {
            // Effective auto: close every hint popover first (hints are dismissed before autos),
            // then hide auto popovers up to the ancestor (all of them when there is no ancestor).
            document->closeAllHintPopovers(FocusPreviousElement::No, fireEvents);
            document->hideAutoPopoversUntil(ancestor.get(), FocusPreviousElement::No, fireEvents);
        } else {
            // Effective hint: close hints down to the nearest ancestor hint (all hints when the
            // ancestor is an auto or there is none). Showing a hint never dismisses auto popovers.
            RefPtr<HTMLElement> nearestAncestorHint = (ancestor && isShowingAsHint(*ancestor)) ? ancestor : nullptr;
            document->closeHintPopoversUntil(nearestAncestorHint.get(), FocusPreviousElement::No, fireEvents);
        }

        if (popoverState() != originalState)
            return Exception { ExceptionCode::InvalidStateError, "The value of the popover attribute was changed while hiding the popover."_s };

        check = checkPopoverValidity(*this, PopoverVisibilityState::Hidden, document.ptr());
        if (check.hasException())
            return check.releaseException();
        if (!check.returnValue())
            return { };

        popoverData()->setShowingAsHint(showingAsHint);
        popoverData()->setHintStackParent(showingAsHint ? ancestor.get() : nullptr);

        if (!showingAsHint) {
            // Auto popovers restore focus only when no other autos remain.
            shouldRestoreFocus = !document->topmostAutoPopover();
        } else {
            // Hints restore focus only when no auto or hint popovers remain.
            shouldRestoreFocus = !document->topmostAutoPopover() && !document->topmostHintPopover();
        }
    }

    RefPtr previouslyFocusedElement = document->focusedElement();

    addToTopLayer();

    if (auto* popoverData = this->popoverData())
        popoverData->setPreviouslyFocusedElement(nullptr);

    if (popoverData())
        setPopoverVisibilityState(PopoverVisibilityState::Showing);

    runPopoverFocusingSteps(*this);

    if (shouldRestoreFocus && popoverData()) {
        ASSERT(popoverState() == PopoverState::Auto || popoverState() == PopoverState::Hint);
        popoverData()->setPreviouslyFocusedElement(previouslyFocusedElement.get());
    }

    queuePopoverToggleEventTask(ToggleState::Closed, ToggleState::Open, source);

    return { };
}

void HTMLElement::setInvoker(HTMLElement* invoker)
{
    if (RefPtr oldInvoker = popoverData()->invoker())
        oldInvoker->setInvokedPopover(nullptr);
    popoverData()->setInvoker(invoker);
    if (RefPtr newInvoker = popoverData()->invoker())
        newInvoker->setInvokedPopover(RefPtr { this });
}

ExceptionOr<void> HTMLElement::hidePopoverInternal(FocusPreviousElement focusPreviousElement, FireEvents fireEvents, HTMLElement* source)
{
    auto check = checkPopoverValidity(*this, PopoverVisibilityState::Showing);
    if (check.hasException())
        return check.releaseException();
    if (!check.returnValue())
        return { };

    ASSERT(popoverData());

    PopoverData::ScopedStartShowingOrHiding showOrHidingPopoverScope(*this);
    if (showOrHidingPopoverScope.wasShowingOrHiding())
        fireEvents = FireEvents::No;

    Ref document = this->document();

    Document::PopoverShowOrHideScope popoverShowOrHideScope(document);

    // Only an "effective auto" popover hides other auto popovers when it is hidden. A manual
    // popover hides nothing, and a hint (including an auto demoted to a hint) only closes the
    // hints stacked above it, handled below.
    if (popoverState() == PopoverState::Auto && !popoverData()->showingAsHint()) {
        document->hideAutoPopoversUntil(this, focusPreviousElement, fireEvents);

        check = checkPopoverValidity(*this, PopoverVisibilityState::Showing);
        if (check.hasException())
            return check.releaseException();
        if (!check.returnValue())
            return { };
    }

    // Hiding any popover also closes every hint whose hint-stack-parent chain reaches it.
    {
        Vector<Ref<HTMLElement>> descendantHints;
        descendantHints.reserveCapacity(document->hintPopoverList().size());
        for (auto& hint : document->hintPopoverList()) {
            if (hint.ptr() == this)
                continue;
            for (RefPtr parent = hint->popoverData() ? hint->popoverData()->hintStackParent() : nullptr; parent; parent = parent->popoverData() ? parent->popoverData()->hintStackParent() : nullptr) {
                if (parent == this) {
                    descendantHints.append(hint);
                    break;
                }
            }
        }
        for (auto& hint : descendantHints)
            hint->hidePopoverInternal(focusPreviousElement, fireEvents);
    }

    setInvoker(nullptr);

    if (fireEvents == FireEvents::Yes) {
        ToggleEvent::Init init;
        init.oldState = "open"_s;
        init.newState = "closed"_s;
        init.source = source;
        dispatchEvent(ToggleEvent::create(eventNames().beforetoggleEvent, init,
            Event::IsCancelable::No));
    }

    check = checkPopoverValidity(*this, PopoverVisibilityState::Showing);
    if (check.hasException())
        return check.releaseException();
    if (!check.returnValue())
        return { };

    ASSERT(popoverData());

    if (isInTopLayer())
        removeFromTopLayer();

    setPopoverVisibilityState(PopoverVisibilityState::Hidden);
    popoverData()->setShowingAsHint(false);
    popoverData()->setHintStackParent(nullptr);

    if (fireEvents == FireEvents::Yes)
        queuePopoverToggleEventTask(ToggleState::Open, ToggleState::Closed, source);

    if (RefPtr element = popoverData()->previouslyFocusedElement()) {
        if (focusPreviousElement == FocusPreviousElement::Yes && isShadowIncludingInclusiveAncestorOf(document->focusedElement())) {
            FocusOptions options;
            options.preventScroll = true;
            element->focus(options);
        }

        if (auto* popoverData = this->popoverData())
            popoverData->setPreviouslyFocusedElement(nullptr);
    }

    popoverWasHidden();

    return { };
}

void HTMLElement::setPopoverVisibilityState(PopoverVisibilityState visibilityState)
{
    popoverData()->setVisibilityState(visibilityState);
}

ExceptionOr<void> HTMLElement::hidePopover()
{
    return hidePopoverInternal(FocusPreviousElement::Yes, FireEvents::Yes);
}

ExceptionOr<bool> HTMLElement::togglePopover(Variant<WebCore::HTMLElement::TogglePopoverOptions, bool> options)
{
    std::optional<bool> force;
    HTMLElement* source = nullptr;

    WTF::switchOn(options,
        [&](TogglePopoverOptions options) {
            force = options.force;
            source = options.source.get();
        },
        [&](bool value) {
            force = value;
        }
    );

    if (isPopoverShowing() && !force.value_or(false)) {
        auto returnValue = hidePopoverInternal(FocusPreviousElement::Yes, FireEvents::Yes, source);
        if (returnValue.hasException())
            return returnValue.releaseException();
    } else if (!isPopoverShowing() && force.value_or(true)) {
        if (document().isRunningPopoverShowOrHide())
            return Exception { ExceptionCode::InvalidStateError, "Cannot show a popover while a popover is being shown or hidden"_s };
        auto returnValue = showPopoverInternal(source);
        if (returnValue.hasException())
            return returnValue.releaseException();
    } else {
        auto check = checkPopoverValidity(*this, popoverData() ? popoverData()->visibilityState() : PopoverVisibilityState::Showing);
        if (check.hasException())
            return check.releaseException();
    }
    return isPopoverShowing();
}

void HTMLElement::popoverAttributeChanged(const AtomString& value)
{
    auto computePopoverState = [](const AtomString& value) -> PopoverState {
        if (!value || value.isNull())
            return PopoverState::None;

        if (value == emptyString() || equalIgnoringASCIICase(value, autoAtom()))
            return PopoverState::Auto;

        if (equalIgnoringASCIICase(value, hintAtom()))
            return PopoverState::Hint;

        return PopoverState::Manual;
    };

    auto newPopoverState = computePopoverState(value);

    auto oldPopoverState = popoverState();
    if (newPopoverState == oldPopoverState)
        return;

    if (isPopoverShowing()) {
        hidePopoverInternal(FocusPreviousElement::Yes, FireEvents::Yes);
        newPopoverState = computePopoverState(attributeWithoutSynchronization(popoverAttr));
    }

    if (newPopoverState == PopoverState::None)
        clearPopoverData();
    else
        ensurePopoverData().setPopoverState(newPopoverState);
}

bool HTMLElement::isValidCommandType(const CommandType command)
{
    return Element::isValidCommandType(command) || command == CommandType::TogglePopover || command == CommandType::ShowPopover || command == CommandType::HidePopover;
}

bool HTMLElement::handleCommandInternal(HTMLButtonElement& invoker, const CommandType& command)
{
    if (popoverState() == PopoverState::None)
        return false;

    if (isPopoverShowing()) {
        bool shouldHide = command == CommandType::TogglePopover || command == CommandType::HidePopover;
        if (shouldHide) {
            hidePopoverInternal(FocusPreviousElement::Yes, FireEvents::Yes, &invoker);
            return true;
        }
    } else {
        bool shouldShow = command == CommandType::TogglePopover || command == CommandType::ShowPopover;
        if (shouldShow) {
            showPopoverInternal(&invoker);
            return true;
        }
    }

    return false;
}

const AtomString& HTMLElement::popover() const
{
    switch (popoverState()) {
    case PopoverState::None:
        return nullAtom();
    case PopoverState::Auto:
        return autoAtom();
    case PopoverState::Manual:
        return manualAtom();
    case PopoverState::Hint:
        return hintAtom();
    }
    return nullAtom();
}

void HTMLElement::setPopover(const AtomString& value)
{
    setAttributeWithoutSynchronization(HTMLNames::popoverAttr, value);
}

} // namespace WebCore

#ifndef NDEBUG

// For use in the debugger
void dumpInnerHTML(WebCore::HTMLElement*);

void dumpInnerHTML(WebCore::HTMLElement* element)
{
    SAFE_PRINTF("%s\n", element->innerHTML().ascii());
}

#endif

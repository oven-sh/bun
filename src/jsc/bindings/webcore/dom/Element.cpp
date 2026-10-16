/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Peter Kelly (pmk@post.com)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 *           (C) 2007 David Smith (catfish.man@gmail.com)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 *           (C) 2007 Eric Seidel (eric@webkit.org)
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
 */

#include "config.h"
#include "Element.h"

#include "Attr.h"
#include "ChildListMutationScope.h"
#include "ComposedTreeAncestorIterator.h"
#include "ComposedTreeIterator.h"
#include "ContainerNodeAlgorithms.h"
#include "ContainerNodeInlines.h"
#include "CustomElementReactionQueue.h"
#include "CustomElementRegistry.h"
#include "CustomStateSet.h"
#include "DOMRect.h"
#include "DOMRectList.h"
#include "DOMTokenList.h"
#include "DocumentInlines.h"
#include "DocumentSharedObjectPool.h"
#include "ElementAncestorIteratorInlines.h"
#include "ElementChildIteratorInlines.h"
#include "ElementRareData.h"
#include "ElementTextDirection.h"
#include "EventDispatcher.h"
#include "EventNames.h"
#include "FocusEvent.h"
#include "FocusEventData.h"
#include "FormAssociatedCustomElement.h"
#include "GetHTMLOptions.h"
#include "HTMLBodyElement.h"
#include "HTMLDialogElement.h"
#include "HTMLDocument.h"
#include "HTMLHtmlElement.h"
#include "HTMLInputElement.h"
#include "HTMLNameCollection.h"
#include "HTMLParserIdioms.h"
#include "HTMLScriptElement.h"
#include "HTMLSelectElement.h"
#include "HTMLTemplateElement.h"
#include "IdTargetObserverRegistry.h"
#include "JSLazyEventListener.h"
#include "MutationObserverInterestGroup.h"
#include "MutationRecord.h"
#include "NameValidation.h"
#include "NodeName.h"
#include "PopoverData.h"
#include "SVGNames.h"
#include "ScriptDisallowedScope.h"
#include "ScrollIntoViewOptions.h"
#include "ScrollToOptions.h"
#include "SelectorQuery.h"
#include "ShadowRootInit.h"
#include "SimulatedClick.h"
#include "SlotAssignment.h"
#include "StyleProperties.h"
#include "StyledElement.h"
#include "TypedElementDescendantIteratorInlines.h"
#include "Window.h"
#include "XLinkNames.h"
#include "XMLNSNames.h"
#include "XMLNames.h"
#include "markup.h"
#include <wtf/Scope.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/CString.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/TextStream.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Element);

struct SameSizeAsElement : public ContainerNode {
    QualifiedName tagName;
    void* elementData;
    void* shadowRoot;
};

static_assert(sizeof(Element) == sizeof(SameSizeAsElement), "Element should stay small");

using namespace HTMLNames;
using namespace XMLNames;

Vector<Ref<Attr>>* Element::attrNodeListForElement(Element& element)
{
    if (!element.hasSyntheticAttrChildNodes())
        return nullptr;
    return &element.elementRareData()->attrNodeList();
}

Vector<Ref<Attr>>& Element::ensureAttrNodeListForElement(Element& element)
{
    element.setHasSyntheticAttrChildNodes(true);
    return element.ensureElementRareData().attrNodeList();
}

void Element::removeAttrNodeListForElement(Element& element)
{
    ASSERT(element.hasSyntheticAttrChildNodes());
    element.elementRareData()->attrNodeList().clear();
    element.setHasSyntheticAttrChildNodes(false);
}

static Attr* LEGACY_NODELETE findAttrNodeInList(Vector<Ref<Attr>>& attrNodeList, const QualifiedName& name)
{
    for (auto& node : attrNodeList) {
        if (node->qualifiedName().matches(name))
            return node.ptr();
    }
    return nullptr;
}

Ref<Element> Element::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new Element(tagName, document, { }));
}

Element::Element(const QualifiedName& tagName, Document& document, OptionSet<TypeFlag> typeFlags)
    : ContainerNode(document, NodeType::Element, typeFlags | TypeFlag::IsElement)
    , m_tagName(tagName)
{
}

Element::Element(ClangVTableWorkaroundTag, const QualifiedName& tagName, Document& document)
    : Element(tagName, document, { })
{
}

Element::~Element()
{
    removeShadowRoot();

    if (hasSyntheticAttrChildNodes())
        detachAllAttrNodesFromElement();
}

inline ElementRareData& Element::ensureElementRareData()
{
    // Node::materializeRareData() always creates ElementRareData for Elements.
    return uncheckedDowncast<ElementRareData>(ensureRareData());
}

void Element::setTabIndexExplicitly(std::optional<int> tabIndex)
{
    if (!tabIndex) {
        setTabIndexState(TabIndexState::NotSet);
        return;
    }
    setTabIndexState([this, value = tabIndex.value()]() {
        switch (value) {
        case 0:
            return TabIndexState::Zero;
        case -1:
            return TabIndexState::NegativeOne;
        default:
            ensureElementRareData().setUnusualTabIndex(value);
            return TabIndexState::InRareData;
        }
    }());
}

std::optional<int> Element::tabIndexSetExplicitly() const
{
    switch (tabIndexState()) {
    case TabIndexState::NotSet:
        return std::nullopt;
    case TabIndexState::Zero:
        return 0;
    case TabIndexState::NegativeOne:
        return -1;
    case TabIndexState::InRareData:
        ASSERT(hasRareData());
        return elementRareData()->unusualTabIndex();
    }
    ASSERT_NOT_REACHED();
    return std::nullopt;
}

int Element::defaultTabIndex() const
{
    // There is no SVGAElement to say this.
    return hasTagName(SVGNames::aTag) ? 0 : -1;
}

bool Element::isNonceable() const
{
    // https://www.w3.org/TR/CSP3/#is-element-nonceable
    // '<link' is not in the published algorithm yet. See https://github.com/w3c/webappsec-csp/pull/810
    if (elementRareData()->nonce().isNull())
        return false;

    if (hasDuplicateAttribute())
        return false;

    if (hasAttributes() && is<HTMLScriptElement>(*this)) {
        static constexpr auto scriptString = "<script"_s;
        static constexpr auto styleString = "<style"_s;
        static constexpr auto linkString = "<link"_s;

        for (auto& attribute : attributes()) {
            auto name = attribute.localNameLowercase();
            auto value = attribute.value();
            if (name.contains(scriptString)
                || name.contains(styleString)
                || name.contains(linkString)
                || value.containsIgnoringASCIICase(scriptString)
                || value.containsIgnoringASCIICase(styleString)
                || value.containsIgnoringASCIICase(linkString))
                return false;
        }
    }

    return true;
}

const AtomString& Element::nonce() const
{
    if (hasRareData() && isNonceable())
        return elementRareData()->nonce();

    return emptyAtom();
}

void Element::setNonce(const AtomString& newValue)
{
    if (newValue == emptyAtom() && !hasRareData())
        return;

    ensureElementRareData().setNonce(newValue);
}

bool Element::supportsFocus() const
{
    if (tabIndexSetExplicitly())
        return true;
    // There is no SVGAElement to say this: a link takes focus.
    return hasTagName(SVGNames::aTag) && (hasAttributeWithoutSynchronization(SVGNames::hrefAttr) || hasAttributeWithoutSynchronization(XLinkNames::hrefAttr));
}

int Element::tabIndexForBindings() const
{
    return valueOrCompute(tabIndexSetExplicitly(), [&] { return defaultTabIndex(); });
}

void Element::setTabIndexForBindings(int value)
{
    setIntegralAttribute(tabindexAttr, value);
}

bool Element::isKeyboardFocusable(const FocusEventData&) const
{
    if (!isFocusable() || shouldBeIgnoredInSequentialFocusNavigation() || tabIndexSetExplicitly().value_or(0) < 0)
        return false;
    if (auto* root = shadowRoot()) {
        if (root->delegatesFocus())
            return false;
    }
    return true;
}

bool Element::isMouseFocusable() const
{
    return isFocusable();
}

bool Element::dispatchSimulatedClick(Event* underlyingEvent, SimulatedClickMouseEventOptions eventOptions, SimulatedClickVisualOptions visualOptions)
{
    auto simulatedClickSource = [&] {
        if (!underlyingEvent)
            return SimulatedClickSource::UserAgent;

        return underlyingEvent->isTrusted() ? SimulatedClickSource::UserAgent : SimulatedClickSource::Bindings;
    }();

    return simulateClick(*this, underlyingEvent, eventOptions, visualOptions, simulatedClickSource);
}

Ref<Node> Element::cloneNodeInternal(Document& document, CloningOperation type, CustomElementRegistry* fallbackRegistry) const
{
    switch (type) {
    case CloningOperation::SelfOnly:
    case CloningOperation::SelfWithTemplateContent: {
        Ref clone = cloneElementWithoutChildren(document, fallbackRegistry);
        ScriptDisallowedScope::EventAllowedScope eventAllowedScope { clone };
        cloneShadowTreeIfPossible(clone);
        return clone;
    }
    case CloningOperation::Everything:
        break;
    }
    return cloneElementWithChildren(document, fallbackRegistry);
}

void Element::cloneShadowTreeIfPossible(Element& newHost) const
{
    RefPtr oldShadowRoot = this->shadowRoot();
    if (!oldShadowRoot || !oldShadowRoot->isClonable())
        return;

    Ref clonedShadowRoot = [&] {
        Ref clone = oldShadowRoot->cloneNodeInternal(protect(newHost.document()), Node::CloningOperation::SelfWithTemplateContent, nullptr);
        return downcast<ShadowRoot>(WTF::move(clone));
    }();
    if (oldShadowRoot->usesNullCustomElementRegistry())
        clonedShadowRoot->setUsesNullCustomElementRegistry(); // Set this flag for Element::insertionSteps.
    else {
        clonedShadowRoot->clearUsesNullCustomElementRegistry(); // Unset flag potentially set by DocumentFragment constructor
        if (RefPtr registry = oldShadowRoot->customElementRegistry()) {
            if (!registry->isScoped())
                registry = newHost.document().effectiveGlobalCustomElementRegistry();
            clonedShadowRoot->setCustomElementRegistry(WTF::move(registry));
        }
    }
    newHost.addShadowRoot(clonedShadowRoot.copyRef());
    oldShadowRoot->cloneChildNodes(protect(newHost.document()), nullptr, clonedShadowRoot);
}

Ref<Element> Element::cloneElementWithChildren(Document& document, CustomElementRegistry* fallbackRegistry) const
{
    Ref clone = cloneElementWithoutChildren(document, fallbackRegistry);
    ScriptDisallowedScope::EventAllowedScope eventAllowedScope { clone };
    cloneShadowTreeIfPossible(clone);
    cloneChildNodes(document, fallbackRegistry, clone);
    return clone;
}

Ref<Element> Element::cloneElementWithoutChildren(Document& document, CustomElementRegistry* fallbackRegistry) const
{
    RefPtr registry = CustomElementRegistry::registryForElement(*this);
    if (!registry)
        registry = fallbackRegistry;
    if (registry && !registry->isScoped())
        registry = document.effectiveGlobalCustomElementRegistry();

    Ref clone = cloneElementWithoutAttributesAndChildren(document, registry.get());

    // This will catch HTML elements in the wrong namespace that are not correctly copied.
    // This is a sanity check as HTML overloads some of the DOM methods.
    ASSERT(isHTMLElement() == clone->isHTMLElement());

    clone->cloneDataFromElement(*this);

    if (usesNullCustomElementRegistry() && !registry)
        clone->setUsesNullCustomElementRegistry();

    return clone;
}

Ref<Element> Element::cloneElementWithoutAttributesAndChildren(Document& document, CustomElementRegistry* registry) const
{
    return document.createElement(tagQName(), false, registry);
}

Ref<Attr> Element::detachAttribute(unsigned index)
{
    ASSERT(elementData());

    const Attribute& attribute = elementData()->attributeAt(index);

    RefPtr attrNode = attrIfExists(attribute.name());
    if (attrNode)
        detachAttrNodeFromElementWithValue(attrNode.get(), attribute.value());
    else
        attrNode = Attr::create(protect(document()), attribute.name(), attribute.value());

    removeAttributeInternal(index, InSynchronizationOfLazyAttribute::No);
    return attrNode.releaseNonNull();
}

bool Element::removeAttribute(const QualifiedName& name)
{
    if (!elementData())
        return false;

    synchronizeAttribute(name);

    unsigned index = elementData()->findAttributeIndexByName(name);
    if (index == ElementData::attributeNotFound)
        return false;

    removeAttributeInternal(index, InSynchronizationOfLazyAttribute::No);
    return true;
}

void Element::setBooleanAttribute(const QualifiedName& name, bool value)
{
    if (value)
        setAttributeWithoutSynchronization(name, emptyAtom());
    else
        removeAttribute(name);
}

NamedNodeMap& Element::attributesMap() const
{
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST ElementRareData& rareData = const_cast<Element*>(this)->ensureElementRareData();
    if (NamedNodeMap* attributeMap = rareData.attributeMap())
        return *attributeMap;

    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST rareData.setAttributeMap(makeUniqueWithoutRefCountedCheck<NamedNodeMap>(const_cast<Element&>(*this)));
    return *rareData.attributeMap();
}

bool Element::hasAttribute(const QualifiedName& name) const
{
    if (!elementData())
        return false;
    synchronizeAttribute(name);
    return elementData()->findAttributeByName(name);
}

bool Element::hasAttribute(StaticQualifiedName name) const
{
    if (!elementData())
        return false;
    synchronizeAttribute(name);
    return elementData()->findAttributeByName(name);
}

void Element::synchronizeAllAttributes() const
{
    if (!elementData())
        return;
    // FIXME: Use downcast<> if affordable. Relies on only StyledElement marking the style attribute as dirty.
    if (elementData()->styleAttributeIsDirty())
        uncheckedDowncast<StyledElement>(*this).synchronizeStyleAttributeInternal();
}

ALWAYS_INLINE void Element::synchronizeAttribute(const QualifiedName& name) const
{
    if (!elementData())
        return;
    if (name == styleAttr && elementData()->styleAttributeIsDirty()) [[unlikely]] {
        // FIXME: Use downcast<> if affordable. Relies on only StyledElement marking the style attribute as dirty.
        uncheckedDowncast<StyledElement>(*this).synchronizeStyleAttributeInternal();
    }
}

ALWAYS_INLINE void Element::synchronizeAttribute(StaticQualifiedName name) const
{
    if (!elementData())
        return;
    if (name == styleAttr && elementData()->styleAttributeIsDirty()) [[unlikely]] {
        ASSERT_WITH_SECURITY_IMPLICATION(isStyledElement());
        static_cast<const StyledElement*>(this)->synchronizeStyleAttributeInternal();
    }
}

static ALWAYS_INLINE bool isStyleAttribute(const Element& element, const AtomString& attributeLocalName)
{
    if (shouldIgnoreAttributeCase(element))
        return equalLettersIgnoringASCIICase(attributeLocalName, "style"_s);
    return attributeLocalName == styleAttr->localName();
}

ALWAYS_INLINE void Element::synchronizeAttribute(const AtomString& localName) const
{
    // This version of synchronizeAttribute() is streamlined for the case where you don't have a full QualifiedName,
    // e.g when called from DOM API.
    if (!elementData())
        return;
    if (elementData()->styleAttributeIsDirty() && isStyleAttribute(*this, localName)) {
        // FIXME: Use downcast<> if affordable. Relies on only StyledElement marking the style attribute as dirty.
        uncheckedDowncast<StyledElement>(*this).synchronizeStyleAttributeInternal();
    }
}

const AtomString& Element::getAttribute(const QualifiedName& name) const
{
    if (auto* attribute = getAttributeInternal(name))
        return attribute->value();
    return nullAtom();
}

const AtomString& Element::getAttribute(StaticQualifiedName name) const
{
    if (auto* attribute = getAttributeInternal(name))
        return attribute->value();
    return nullAtom();
}

AtomString Element::getAttributeForBindings(const QualifiedName& name, ResolveURLs resolveURLs) const
{
    auto* attribute = getAttributeInternal(name);
    if (!attribute)
        return nullAtom();

    if (!attributeContainsURL(*attribute))
        return attribute->value();

    switch (resolveURLs) {
    case ResolveURLs::Yes:
    case ResolveURLs::YesExcludingURLsForPrivacy:
        return AtomString(completeURLsInAttributeValue(URL(), *attribute, resolveURLs));

    case ResolveURLs::No:
    case ResolveURLs::NoExcludingURLsForPrivacy:
        break;
    }

    return attribute->value();
}

Vector<String> Element::getAttributeNames() const
{
    if (!hasAttributes())
        return { };

    auto attributes = this->attributes();
    return WTF::map(attributes, [](auto& attribute) {
        return attribute.name().toString();
    });
}

// Upstream has this as an inherited bit of the style, `effectiveInert`, which Style::Adjuster sets by the same three rules.
static bool isInert(const Element& element)
{
    RefPtr modalDialog = element.document().activeModalDialog();
    for (RefPtr ancestor = &element; ancestor; ancestor = ancestor->parentElementInComposedTree()) {
        if (is<HTMLElement>(*ancestor) && ancestor->hasAttributeWithoutSynchronization(inertAttr))
            return true;
        if (ancestor == modalDialog)
            return false;
    }
    return modalDialog;
}

bool Element::isFocusable() const
{
    return isConnected() && supportsFocus() && !isInert(*this);
}

bool Element::isUserActionElementInActiveChain() const
{
    ASSERT(isUserActionElement());
    return document().userActionElements().isInActiveChain(*this);
}

bool Element::isUserActionElementActive() const
{
    ASSERT(isUserActionElement());
    return document().userActionElements().isActive(*this);
}

bool Element::isUserActionElementFocused() const
{
    ASSERT(isUserActionElement());
    return document().userActionElements().isFocused(*this);
}

bool Element::isUserActionElementHovered() const
{
    ASSERT(isUserActionElement());
    return document().userActionElements().isHovered(*this);
}

bool Element::isUserActionElementHasFocusVisible() const
{
    ASSERT(isUserActionElement());
    return document().userActionElements().hasFocusVisible(*this);
}

FormListedElement* Element::asFormListedElement()
{
    return nullptr;
}

ValidatedFormListedElement* Element::asValidatedFormListedElement()
{
    return nullptr;
}

#if ENABLE(ATTACHMENT_ELEMENT)
AttachmentAssociatedElement* Element::asAttachmentAssociatedElement()
{
    return nullptr;
}
#endif

bool Element::isUserActionElementHasFocusWithin() const
{
    ASSERT(isUserActionElement());
    return document().userActionElements().hasFocusWithin(*this);
}

void Element::setActive(bool value)
{
    if (value == active())
        return;
    document().userActionElements().setActive(*this, value);
}

static bool shouldAlwaysHaveFocusVisibleWhenFocused(const Element& element)
{
    return element.isTextField() || element.isContentEditable() || is<HTMLSelectElement>(element);
}

void Element::setFocus(bool value, FocusVisibility visibility)
{
    if (value == focused())
        return;

    document().userActionElements().setFocused(*this, value);

    // Shadow host with a slot that contain focused element is not considered focused.
    for (RefPtr root = containingShadowRoot(); root; root = root->host()->containingShadowRoot())
        root->setContainsFocusedElement(value);

    for (Ref element : composedTreeLineage(*this)) {
        element->setHasFocusWithin(value);
        if (element->isInTopLayer())
            break;
    }

    setHasFocusVisible(value && (visibility == FocusVisibility::Visible || (visibility == FocusVisibility::Invisible && shouldAlwaysHaveFocusVisibleWhenFocused(*this))));
}

void Element::setHasFocusVisible(bool value)
{
    Ref document = this->document();

#if ASSERT_ENABLED
    ASSERT(!value || focused());
#endif

    if (hasFocusVisible() == value)
        return;

    document->userActionElements().setHasFocusVisible(*this, value);
}

void Element::setHasFocusWithin(bool value)
{
    if (hasFocusWithin() == value)
        return;
    document().userActionElements().setHasFocusWithin(*this, value);
}

void Element::setHasTentativeFocus(bool value)
{
    // Tentative focus is used when trying to set the focus on a new element.
    if (isInTopLayer())
        return;
    for (Ref ancestor : composedTreeAncestors(*this)) {
        ASSERT(ancestor->hasFocusWithin() != value);
        document().userActionElements().setHasFocusWithin(ancestor, value);
        if (ancestor->isInTopLayer())
            break;
    }
}

void Element::setHovered(bool value)
{
    if (value == hovered())
        return;
    document().userActionElements().setHovered(*this, value);
}

void Element::scrollIntoView(Variant<bool, ScrollIntoViewOptions>&&)
{
}

void Element::scrollIntoView(bool)
{
}

void Element::scrollIntoViewIfNeeded(bool)
{
}

void Element::scrollBy(const ScrollToOptions& options)
{
    ScrollToOptions scrollToOptions = normalizeNonFiniteCoordinatesOrFallBackTo(options, 0, 0);
    scrollToOptions.left.value() += scrollLeft();
    scrollToOptions.top.value() += scrollTop();
    scrollTo(scrollToOptions);
}

void Element::scrollBy(double x, double y)
{
    scrollBy(ScrollToOptions { { ScrollBehavior::Auto }, x, y });
}

void Element::scrollTo(const ScrollToOptions& options)
{
    auto scrollToOptions = normalizeNonFiniteCoordinatesOrFallBackTo(options, scrollLeft(), scrollTop());
    setScrollLeft(clampTo<int>(scrollToOptions.left.value()));
    setScrollTop(clampTo<int>(scrollToOptions.top.value()));
}

void Element::scrollTo(double x, double y)
{
    scrollTo(ScrollToOptions { { ScrollBehavior::Auto }, x, y });
}

int Element::offsetLeftForBindings()
{
    return 0;
}

int Element::offsetTopForBindings()
{
    return 0;
}

int Element::offsetWidth()
{
    return 0;
}

int Element::offsetHeight()
{
    return 0;
}

RefPtr<Element> Element::offsetParentForBindings()
{
    return nullptr;
}

int Element::clientLeft()
{
    return 0;
}

int Element::clientTop()
{
    return 0;
}

int Element::clientWidth()
{
    return 0;
}

int Element::clientHeight()
{
    return 0;
}

double Element::currentCSSZoom()
{
    return 1.0;
}

int Element::scrollLeft()
{
    return hasRareData() ? elementRareData()->scrollLeft() : 0;
}

int Element::scrollTop()
{
    return hasRareData() ? elementRareData()->scrollTop() : 0;
}

void Element::setScrollLeft(int newLeft)
{
    if (newLeft || hasRareData())
        ensureElementRareData().setScrollLeft(newLeft);
}

void Element::setScrollTop(int newTop)
{
    if (newTop || hasRareData())
        ensureElementRareData().setScrollTop(newTop);
}

int Element::scrollWidth()
{
    return 0;
}

int Element::scrollHeight()
{
    return 0;
}

Ref<DOMRectList> Element::getClientRects()
{
    return DOMRectList::create();
}

Ref<DOMRect> Element::getBoundingClientRect()
{
    return DOMRect::create();
}

const AtomString& Element::getAttribute(const AtomString& qualifiedName) const
{
    if (auto* attribute = getAttributeInternal(qualifiedName))
        return attribute->value();
    return nullAtom();
}

AtomString Element::getAttributeForBindings(const AtomString& qualifiedName, ResolveURLs resolveURLs) const
{
    auto* attribute = getAttributeInternal(qualifiedName);
    if (!attribute)
        return nullAtom();

    if (!attributeContainsURL(*attribute))
        return attribute->value();

    switch (resolveURLs) {
    case ResolveURLs::Yes:
    case ResolveURLs::YesExcludingURLsForPrivacy:
        return AtomString(completeURLsInAttributeValue(URL(), *attribute, resolveURLs));

    case ResolveURLs::No:
    case ResolveURLs::NoExcludingURLsForPrivacy:
        break;
    }

    return attribute->value();
}

const AtomString& Element::getAttributeNS(const AtomString& namespaceURI, const AtomString& localName) const
{
    return getAttribute(QualifiedName(nullAtom(), localName, namespaceURI));
}

// https://dom.spec.whatwg.org/#dom-element-toggleattribute
ExceptionOr<bool> Element::toggleAttribute(const AtomString& qualifiedName, std::optional<bool> force)
{
    if (!NameValidation::isValidAttributeName(qualifiedName))
        return Exception { ExceptionCode::InvalidCharacterError, makeString("Invalid attribute name: '"_s, qualifiedName, '\'') };

    synchronizeAttribute(qualifiedName);

    auto caseAdjustedQualifiedName = shouldIgnoreAttributeCase(*this) ? qualifiedName.convertToASCIILowercase() : qualifiedName;
    unsigned index = elementData() ? elementData()->findAttributeIndexByName(caseAdjustedQualifiedName, false) : ElementData::attributeNotFound;
    if (index == ElementData::attributeNotFound) {
        if (!force || *force) {
            setAttributeInternal(index, QualifiedName { nullAtom(), caseAdjustedQualifiedName, nullAtom() }, emptyAtom(), InSynchronizationOfLazyAttribute::No);
            return true;
        }
        return false;
    }

    if (!force || !*force) {
        removeAttributeInternal(index, InSynchronizationOfLazyAttribute::No);
        return false;
    }
    return true;
}

ExceptionOr<void> Element::setAttribute(const AtomString& qualifiedName, const AtomString& value)
{
    if (!NameValidation::isValidAttributeName(qualifiedName))
        return Exception { ExceptionCode::InvalidCharacterError, makeString("Invalid attribute name: '"_s, qualifiedName, '\'') };

    synchronizeAttribute(qualifiedName);
    auto caseAdjustedQualifiedName = shouldIgnoreAttributeCase(*this) ? qualifiedName.convertToASCIILowercase() : qualifiedName;
    unsigned index = elementData() ? elementData()->findAttributeIndexByName(caseAdjustedQualifiedName, false) : ElementData::attributeNotFound;
    auto name = index != ElementData::attributeNotFound ? attributeAt(index).name() : QualifiedName { nullAtom(), caseAdjustedQualifiedName, nullAtom() };
    setAttributeInternal(index, name, value, InSynchronizationOfLazyAttribute::No);
    return { };
}

void Element::setAttribute(const QualifiedName& name, const AtomString& value)
{
    synchronizeAttribute(name);
    unsigned index = elementData() ? elementData()->findAttributeIndexByName(name) : ElementData::attributeNotFound;
    setAttributeInternal(index, name, value, InSynchronizationOfLazyAttribute::No);
}

void Element::setAttributeWithoutOverwriting(const QualifiedName& name, const AtomString& value)
{
    synchronizeAttribute(name);
    if (!elementData() || elementData()->findAttributeIndexByName(name) == ElementData::attributeNotFound)
        addAttributeInternal(name, value, InSynchronizationOfLazyAttribute::No);
}

void Element::setAttributeWithoutSynchronization(const QualifiedName& name, const AtomString& value)
{
    unsigned index = elementData() ? elementData()->findAttributeIndexByName(name) : ElementData::attributeNotFound;
    setAttributeInternal(index, name, value, InSynchronizationOfLazyAttribute::No);
}

void Element::setSynchronizedLazyAttribute(const QualifiedName& name, const AtomString& value)
{
    unsigned index = elementData() ? elementData()->findAttributeIndexByName(name) : ElementData::attributeNotFound;
    setAttributeInternal(index, name, value, InSynchronizationOfLazyAttribute::Yes);
}

inline void Element::setAttributeInternal(unsigned index, const QualifiedName& name, const AtomString& newValue, InSynchronizationOfLazyAttribute inSynchronizationOfLazyAttribute)
{
    ASSERT_WITH_MESSAGE(refCount() || parentNode(), "Attribute must not be set on an element before adoptRef");

    if (newValue.isNull()) {
        if (index != ElementData::attributeNotFound)
            removeAttributeInternal(index, inSynchronizationOfLazyAttribute);
        return;
    }

    if (index == ElementData::attributeNotFound) {
        addAttributeInternal(name, newValue, inSynchronizationOfLazyAttribute);
        return;
    }

    if (inSynchronizationOfLazyAttribute == InSynchronizationOfLazyAttribute::Yes) {
        ensureUniqueElementData().attributeAt(index).setValue(newValue);
        return;
    }

    const Attribute& attribute = attributeAt(index);
    QualifiedName attributeName = attribute.name();
    AtomString oldValue = attribute.value();

    willModifyAttribute(attributeName, oldValue, newValue);

    if (newValue != oldValue)
        ensureUniqueElementData().attributeAt(index).setValue(newValue);

    didModifyAttribute(attributeName, oldValue, newValue);
}

static inline AtomString makeIdForStyleResolution(const AtomString& value, bool inQuirksMode)
{
    if (inQuirksMode)
        return value.convertToASCIILowercase();
    return value;
}

bool Element::isElementReflectionAttribute(const QualifiedName& name)
{
    return name == HTMLNames::aria_activedescendantAttr
        || name == HTMLNames::popovertargetAttr
        || name == HTMLNames::commandforAttr;
}

bool Element::isElementsArrayReflectionAttribute(const QualifiedName& name)
{
    switch (name.nodeName()) {
    case AttributeNames::aria_actionsAttr:
    case AttributeNames::aria_controlsAttr:
    case AttributeNames::aria_describedbyAttr:
    case AttributeNames::aria_detailsAttr:
    case AttributeNames::aria_errormessageAttr:
    case AttributeNames::aria_flowtoAttr:
    case AttributeNames::aria_labelledbyAttr:
    case AttributeNames::aria_ownsAttr:
        return true;
    default:
        break;
    }
    return false;
}

ALWAYS_INLINE void Element::notifyAttributeChangedCommon(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason reason)
{
    attributeChanged(name, oldValue, newValue, reason);

    if (isDefinedCustomElement()) [[unlikely]]
        CustomElementReactionQueue::enqueueAttributeChangedCallbackIfNeeded(*this, name, oldValue, newValue);
}

void Element::notifyAttributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason reason)
{
    notifyAttributeChangedCommon(name, oldValue, newValue, reason);

    document().incDOMTreeVersion();

    if (oldValue != newValue) {
        IsMutationBySetInnerHTML isMutationBySetInnerHTML = reason == AttributeModificationReason::ParserFastPath
            ? IsMutationBySetInnerHTML::Yes
            : IsMutationBySetInnerHTML::No;
        invalidateNodeListCollectionAndInnerHTMLPrefixCachesInAncestorsForAttribute(name, isMutationBySetInnerHTML);

        if (isConnected() && oldValue == nullAtom())
            protect(document())->attributeAddedToElement(name);
    }
}

void Element::parserNotifyAttributeAdded(const QualifiedName& name, const AtomString& value, AttributeModificationReason reason)
{
    ASSERT(!isConnected());
    ASSERT(!parentNode());
    notifyAttributeChangedCommon(name, nullAtom(), value, reason);
}

void Element::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason reason)
{
    if (oldValue == newValue)
        return;

    switch (name.nodeName()) {
    case AttributeNames::classAttr:
        classAttributeChanged(newValue, reason);
        break;
    case AttributeNames::idAttr: {
        AtomString oldId = elementData()->idForStyleResolution();
        AtomString newId = makeIdForStyleResolution(newValue, document().inQuirksMode());
        if (newId != oldId)
            protect(m_elementData)->setIdForStyleResolution(newId);

        if (CheckedPtr observerRegistry = treeScope().idTargetObserverRegistryIfExists()) {
            if (!oldValue.isEmpty())
                observerRegistry->notifyObservers(*this, oldValue);
            if (!newValue.isEmpty())
                observerRegistry->notifyObservers(*this, newValue);
        }
        break;
    }
    case AttributeNames::nameAttr:
        elementData()->setHasNameAttribute(!newValue.isNull());
        break;
    case AttributeNames::nonceAttr:
        if (is<HTMLElement>(*this))
            setNonce(newValue.isNull() ? emptyAtom() : newValue);
        break;
    case AttributeNames::slotAttr:
        if (RefPtr parent = parentElement()) {
            if (RefPtr shadowRoot = parent->shadowRoot())
                shadowRoot->hostChildElementDidChangeSlotAttribute(*this, oldValue, newValue);
        }
        break;
    case AttributeNames::partAttr:
        partAttributeChanged(newValue);
        break;
    case AttributeNames::dirAttr:
        dirAttributeChanged(newValue);
        return;
    case AttributeNames::XML::langAttr:
    case AttributeNames::langAttr: {
        if (name == HTMLNames::langAttr)
            setHasLangAttr(!newValue.isNull() && (isHTMLElement() || isSVGElement()));
        else
            setHasXMLLangAttr(!newValue.isNull());
        Ref document = this->document();
        if (document->documentElement() == this)
            document->setDocumentElementLanguage(langFromAttribute());
        else
            updateEffectiveLangStateAndPropagateToDescendants();
        break;
    }
    case AttributeNames::customelementregistryAttr:
        if (reason == AttributeModificationReason::Parser && !isDefinedCustomElement())
            setUsesNullCustomElementRegistry();
        break;
    default:
        if (isElementReflectionAttribute(name) || isElementsArrayReflectionAttribute(name)) {
            if (auto* map = explicitlySetAttrElementsMapIfExists())
                map->remove(name);
        }
        break;
    }
}

void Element::updateEffectiveLangStateAndPropagateToDescendants()
{
    updateEffectiveLangState();

    for (auto it = descendantsOfType<Element>(*this).begin(); it;) {
        Ref element = *it;
        if (element->hasLanguageAttribute()) {
            it.traverseNextSkippingChildren();
            continue;
        }
        element->updateEffectiveLangStateFromParent();
        it.traverseNext();
    }
}

ExplicitlySetAttrElementsMap& Element::explicitlySetAttrElementsMap()
{
    return ensureElementRareData().explicitlySetAttrElementsMap();
}

ExplicitlySetAttrElementsMap* Element::explicitlySetAttrElementsMapIfExists() const
{
    return hasRareData() ? &elementRareData()->explicitlySetAttrElementsMap() : nullptr;
}

static RefPtr<Element> getElementByIdIncludingDisconnected(const Element& startElement, const AtomString& id)
{
    if (id.isEmpty())
        return nullptr;

    if (startElement.isInTreeScope()) [[likely]]
        return protect(startElement.treeScope())->getElementById(id);

    // https://html.spec.whatwg.org/#attr-associated-element
    // Attr associated element lookup does not depend on whether the element
    // is connected. However, the TreeScopeOrderedMap that is used for
    // TreeScope::getElementById() only stores connected elements.
    if (auto* root = startElement.rootElement()) {
        for (auto& element : descendantsOfType<Element>(*root)) {
            if (element.getIdAttribute() == id) {
                // FIXME: Remove suppression once rdar://189998365 is fixed.
                SUPPRESS_MEMORY_UNSAFE_CAST return const_cast<Element*>(&element);
            }
        }
    }

    return nullptr;
}

RefPtr<Element> Element::elementForAttributeInternal(const QualifiedName& attributeName) const
{
    RefPtr<Element> element;
    bool hasExplicitlySetElement = false;

    if (auto* map = explicitlySetAttrElementsMapIfExists()) {
        auto it = map->find(attributeName);
        if (it != map->end()) {
            ASSERT(it->value.size() == 1);
            hasExplicitlySetElement = true;
            RefPtr explicitlySetElement = it->value[0].get();
            if (explicitlySetElement && isShadowIncludingDescendantOf(explicitlySetElement->rootNode()))
                element = explicitlySetElement;
        }
    }

    if (!hasExplicitlySetElement) {
        const AtomString& id = getAttribute(attributeName);
        element = getElementByIdIncludingDisconnected(*this, id);
    }

    if (!element)
        return nullptr;

    return element->resolveReferenceTarget();
}

RefPtr<Element> Element::getElementAttributeForBindings(const QualifiedName& attributeName) const
{
    ASSERT(isElementReflectionAttribute(attributeName));
    return retargetReferenceTargetForBindings(elementForAttributeInternal(attributeName));
}

void Element::setElementAttribute(const QualifiedName& attributeName, Element* element)
{
    ASSERT(isElementReflectionAttribute(attributeName));

    if (!element) {
        if (auto* map = explicitlySetAttrElementsMapIfExists())
            map->remove(attributeName);
        removeAttribute(attributeName);
        return;
    }

    setAttribute(attributeName, emptyAtom());

    explicitlySetAttrElementsMap().set(attributeName, Vector<WeakPtr<Element, WeakPtrImplWithEventTargetData>> { element });
}

std::optional<Vector<Ref<Element>>> Element::elementsArrayForAttributeInternal(const QualifiedName& attributeName) const
{
    std::optional<Vector<Ref<Element>>> elements;
    bool hasExplicitlySetElements = false;

    if (auto* map = explicitlySetAttrElementsMapIfExists()) {
        auto it = map->find(attributeName);
        if (it != map->end()) {
            hasExplicitlySetElements = true;
            elements = compactMap(it->value, [&](auto& weakElement) -> std::optional<Ref<Element>> {
                RefPtr element = weakElement.get();
                if (element && isShadowIncludingDescendantOf(element->rootNode()))
                    return element.releaseNonNull();
                return std::nullopt;
            });
        }
    }

    if (!hasExplicitlySetElements) {
        auto attr = attributeName;
        if (attr == HTMLNames::aria_labelledbyAttr && !hasAttribute(HTMLNames::aria_labelledbyAttr) && hasAttribute(HTMLNames::aria_labeledbyAttr))
            attr = HTMLNames::aria_labeledbyAttr;

        if (!hasAttribute(attr))
            return std::nullopt;

        SpaceSplitString ids(getAttribute(attr), SpaceSplitString::ShouldFoldCase::No);
        elements = compactMap(ids, [&](auto& id) {
            return getElementByIdIncludingDisconnected(*this, id);
        });
    }

    return elements;
}

std::optional<Vector<Ref<Element>>> Element::getElementsArrayAttributeForBindings(const QualifiedName& attributeName) const
{
    ASSERT(isElementsArrayReflectionAttribute(attributeName));
    return elementsArrayForAttributeInternal(attributeName);
}

void Element::setElementsArrayAttribute(const QualifiedName& attributeName, std::optional<Vector<Ref<Element>>>&& elements)
{
    ASSERT(isElementsArrayReflectionAttribute(attributeName));

    if (!elements) {
        if (auto* map = explicitlySetAttrElementsMapIfExists())
            map->remove(attributeName);
        removeAttribute(attributeName);
        return;
    }

    setAttribute(attributeName, emptyAtom());

    auto newElements = copyToVectorOf<WeakPtr<Element, WeakPtrImplWithEventTargetData>>(*elements);
    explicitlySetAttrElementsMap().set(attributeName, WTF::move(newElements));
}

void Element::classAttributeChanged(const AtomString& newClassString, AttributeModificationReason reason)
{
    // Note: We'll need ElementData, but it doesn't have to be UniqueElementData.
    if (!elementData())
        ensureUniqueElementData();

    if (hasRareData()) {
        if (auto* classList = elementRareData()->classList())
            classList->associatedAttributeValueChanged();
    }

    if (reason == AttributeModificationReason::Parser || reason == AttributeModificationReason::ParserFastPath) {
        // If ElementData is ShareableElementData created in parserSetAttributes,
        // it is possible that SpaceSplitString is already created and set.
        // We also do not need to invalidate caches / styles since it is not inserted to the tree yet.
        if (elementData()->classNames().keyString() == newClassString)
            return;
        auto shouldFoldCase = document().inQuirksMode() ? SpaceSplitString::ShouldFoldCase::Yes : SpaceSplitString::ShouldFoldCase::No;
        SpaceSplitString newClassNames(newClassString, shouldFoldCase);
        protect(m_elementData)->setClassNames(WTF::move(newClassNames));
        return;
    }

    auto shouldFoldCase = document().inQuirksMode() ? SpaceSplitString::ShouldFoldCase::Yes : SpaceSplitString::ShouldFoldCase::No;
    SpaceSplitString newClassNames(newClassString, shouldFoldCase);
    protect(document())->invalidateQuerySelectorResultsForClassAttributeChange(*this, elementData()->classNames(), newClassNames);
    protect(m_elementData)->setClassNames(WTF::move(newClassNames));
}

void Element::partAttributeChanged(const AtomString& newValue)
{
    SpaceSplitString newParts(newValue, SpaceSplitString::ShouldFoldCase::No);
    if (!newParts.isEmpty() || !partNames().isEmpty())
        ensureElementRareData().setPartNames(WTF::move(newParts));

    if (hasRareData()) {
        if (auto* partList = elementRareData()->partList())
            partList->associatedAttributeValueChanged();
    }
}

void Element::setIsLink(bool flag)
{
    if (isLink() == flag)
        return;
    setStateFlag(StateFlag::IsLink, flag);
}

// Returns true is the given attribute is an event handler.
// We consider an event handler any attribute that begins with "on".
// It is a simple solution that has the advantage of not requiring any
// code or configuration change if a new event handler is defined.

bool Element::isEventHandlerAttribute(const Attribute& attribute) const
{
    return attribute.name().namespaceURI().isNull() && attribute.name().localName().startsWith("on"_s);
}

bool Element::attributeContainsJavaScriptURL(const Attribute& attribute) const
{
    return isURLAttribute(attribute) && WTF::isValidJavaScriptURL(attribute.value());
}

void Element::stripScriptingAttributes(Vector<Attribute>& attributeVector) const
{
    attributeVector.removeAllMatching([this](auto& attribute) -> bool {
        return this->isEventHandlerAttribute(attribute)
            || this->attributeContainsJavaScriptURL(attribute)
            || this->isHTMLContentAttribute(attribute);
    });
}

void Element::parserSetAttributes(std::span<const Attribute> attributes, AttributeModificationReason reason)
{
    ASSERT(!isConnected());
    ASSERT(!parentNode());
    ASSERT(!m_elementData);

    if (attributes.size()) {
        if (auto* sharedObjectPool = document().sharedObjectPool())
            m_elementData = sharedObjectPool->cachedShareableElementDataWithAttributes(attributes);
        else
            m_elementData = ShareableElementData::createWithAttributes(attributes);
    }

    if (auto* inputElement = dynamicDowncast<HTMLInputElement>(*this)) {
        DelayedUpdateValidityScope delayedUpdateValidityScope(*inputElement);
        inputElement->initializeInputTypeAfterParsingOrCloning();
    }

    // Use attributes instead of m_elementData because attributeChanged might modify m_elementData.
    for (const auto& attribute : attributes)
        parserNotifyAttributeAdded(attribute.name(), attribute.value(), reason);

    if (!attributes.empty())
        document().incDOMTreeVersion();
}

void Element::didMoveToNewDocument(Document& oldDocument, Document& newDocument)
{
    ASSERT_WITH_SECURITY_IMPLICATION(&document() == &newDocument);

    if (oldDocument.inQuirksMode() != document().inQuirksMode()) {
        ensureUniqueElementData();
        // ElementData::m_classNames or ElementData::m_idForStyleResolution need to be updated with the right case.
        if (hasID())
            notifyAttributeChanged(idAttr, nullAtom(), getIdAttribute());
        if (hasClass())
            notifyAttributeChanged(classAttr, nullAtom(), getAttribute(classAttr));
    }

    if (isDefinedCustomElement()) [[unlikely]]
        CustomElementReactionQueue::enqueueAdoptedCallbackIfNeeded(*this, oldDocument, newDocument);

    if (hasLangAttrKnownToMatchDocumentElement()) {
        oldDocument.removeElementWithLangAttrMatchingDocumentElement(*this);
        setEffectiveLangKnownToMatchDocumentElement(false);
    }

    updateEffectiveLangState();
}

bool Element::hasValidTextDirectionState() const
{
    return elementHasValidTextDirectionState(*this);
}

bool Element::hasAutoTextDirectionState() const
{
    return elementHasAutoTextDirectionState(*this);
}

void Element::updateEffectiveTextDirection()
{
    auto textDirectionState = elementTextDirectionState(*this);
    updateEffectiveTextDirectionState(*this, textDirectionState);
}

void Element::updateEffectiveTextDirectionIfNeeded()
{
    if (selfOrPrecedingNodesAffectDirAuto()) [[unlikely]] {
        updateEffectiveTextDirection();
        return;
    }

    RefPtr parent = parentOrShadowHostElement();
    if (!(parent && parent->usesEffectiveTextDirection()))
        return;

    if (hasAttributeWithoutSynchronization(HTMLNames::dirAttr) || shadowRoot()) {
        updateEffectiveTextDirection();
        return;
    }

    if (auto* input = dynamicDowncast<HTMLInputElement>(*this); input && input->isTelephoneField()) {
        updateEffectiveTextDirection();
        return;
    }

    setUsesEffectiveTextDirection(parent->usesEffectiveTextDirection());
    setEffectiveTextDirection(parent->effectiveTextDirection());
}

void Element::dirAttributeChanged(const AtomString& newValue)
{
    auto textDirectionState = parseTextDirectionState(newValue);
    textDirectionStateChanged(*this, textDirectionState);
}

void Element::updateEffectiveLangStateFromParent()
{
    ASSERT(!hasLanguageAttribute());
    ASSERT(parentNode() != &document());

    RefPtr parent = parentOrShadowHostElement();

    if (!parent || parent == document().documentElement()) {
        setEffectiveLangKnownToMatchDocumentElement(parent.get());
        if (hasRareData())
            elementRareData()->setEffectiveLang(nullAtom());
        return;
    }

    setEffectiveLangKnownToMatchDocumentElement(parent->effectiveLangKnownToMatchDocumentElement());
    if (parent->hasRareData()) [[unlikely]] {
        if (!parent->elementRareData()->effectiveLang().isNull()) {
            ensureElementRareData().setEffectiveLang(parent->elementRareData()->effectiveLang());
            return;
        }
    }
    if (hasRareData())
        elementRareData()->setEffectiveLang(nullAtom());
}

void Element::updateEffectiveLangState()
{
    auto& lang = langFromAttribute();
    if (!lang) {
        updateEffectiveLangStateFromParent();
        return;
    }

    if (lang == document().effectiveDocumentElementLanguage()) {
        if (hasRareData())
            elementRareData()->setEffectiveLang(nullAtom());
        protect(document())->addElementWithLangAttrMatchingDocumentElement(*this);
        setEffectiveLangKnownToMatchDocumentElement(true);
        return;
    }

    if (hasLangAttrKnownToMatchDocumentElement()) {
        // Unable to protect the document as it may have started destruction.
        document().removeElementWithLangAttrMatchingDocumentElement(*this);
    }

    setEffectiveLangKnownToMatchDocumentElement(false);
    ensureElementRareData().setEffectiveLang(lang);
}

bool Element::hasAttributes() const
{
    synchronizeAllAttributes();
    return elementData() && elementData()->length();
}

bool Element::hasEquivalentAttributes(const Element& other) const
{
    synchronizeAllAttributes();
    other.synchronizeAllAttributes();
    if (elementData() == other.elementData())
        return true;
    if (elementData())
        return elementData()->isEquivalent(other.elementData());
    if (other.elementData())
        return other.elementData()->isEquivalent(elementData());
    return true;
}

String Element::nodeName() const
{
    return m_tagName.toString();
}

void Element::setPrefixForCustomElementUpgrade(const AtomString& prefix)
{
    ASSERT(!prefix.isEmpty());
    ASSERT(m_tagName.prefix().isNull());
    m_tagName.setPrefix(prefix);
}

static void preserveCustomElementRegistryAfterLeavingTreeScope(Element& element, ContainerNode& oldParent)
{
    if (!oldParent.isInShadowTree())
        return;
    if (RefPtr registry = oldParent.treeScope().customElementRegistry()) {
        if (registry->isScoped() && !element.usesScopedCustomElementRegistryMap()) [[unlikely]]
            CustomElementRegistry::addToScopedCustomElementRegistryMap(element, *registry);
    }
}

static void preserveCustomElementRegistryAfterEnteringTreeScope(Element& element)
{
    if (element.usesScopedCustomElementRegistryMap()) {
        if (CustomElementRegistry::registryForElement(element) == element.treeScope().customElementRegistry())
            CustomElementRegistry::removeFromScopedCustomElementRegistryMap(element);
    } else if (!element.usesNullCustomElementRegistry()) {
        if (element.treeScope().customElementRegistry() != element.document().customElementRegistry()) [[unlikely]] {
            // This element was moved into a shadow tree with a scoped custom element registry.
            // Keep using the document's non-scoped custom element registry.
            if (RefPtr window = element.document().window())
                CustomElementRegistry::addToScopedCustomElementRegistryMap(element, protect(window->ensureCustomElementRegistry()));
        }
    }
}

Node::NeedsPostConnectionSteps Element::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    ContainerNode::insertionSteps(insertionType, parentOfInsertedTree);

    if (insertionType.treeScopeChanged) {
        RefPtr<HTMLDocument> newHTMLDocument = insertionType.connectedToDocument && parentOfInsertedTree.isInDocumentTree()
            ? dynamicDowncast<HTMLDocument>(treeScope().documentScope()) : nullptr;
        addToIdAndNameMaps(protect(treeScope()), newHTMLDocument.get());

        if (parentOfInsertedTree.isInTreeScope())
            preserveCustomElementRegistryAfterEnteringTreeScope(*this);
    }

    if (insertionType.connectedToDocument) {
        if (isCustomElementUpgradeCandidate()) [[unlikely]] {
            ASSERT(isConnected());
            if (usesNullCustomElementRegistry() || !CustomElementReactionQueue::tryToUpgradeElement(*this))
                protect(document())->addCustomElementUpgradeCandidateLocalName(localName());
        }
        if (isDefinedCustomElement()) [[unlikely]]
            CustomElementReactionQueue::enqueueConnectedCallbackIfNeeded(*this);

        if (hasAttributesWithoutUpdate()) {
            Ref document = this->document();
            for (auto& attribute : attributes())
                document->attributeAddedToElement(attribute.name());
        }
    }

    if (parentNode() == &parentOfInsertedTree) {
        if (RefPtr shadowRoot = parentNode()->shadowRoot())
            shadowRoot->hostChildElementDidChange(*this);
    }

    if (parentNode() == &parentOfInsertedTree && is<Document>(*parentNode())) {
        clearEffectiveLangStateOnNewDocumentElement();
        protect(document())->setDocumentElementLanguage(langFromAttribute());
    } else if (!hasLanguageAttribute())
        updateEffectiveLangStateFromParent();

    if (!is<HTMLSlotElement>(*this))
        updateEffectiveTextDirectionIfNeeded();

    return NeedsPostConnectionSteps::No;
}

void Element::clearEffectiveLangStateOnNewDocumentElement()
{
    ASSERT(parentNode() == &document());

    if (hasLangAttrKnownToMatchDocumentElement())
        protect(document())->removeElementWithLangAttrMatchingDocumentElement(*this);

    setEffectiveLangKnownToMatchDocumentElement(true);

    if (hasRareData())
        elementRareData()->setEffectiveLang(nullAtom());
}

void Element::setEffectiveLangStateOnOldDocumentElement()
{
    setEffectiveLangKnownToMatchDocumentElement(false);

    if (auto& lang = langFromAttribute(); !lang.isNull() || hasRareData())
        ensureElementRareData().setEffectiveLang(lang);
}

bool Element::hasEffectiveLangState() const
{
    if (effectiveLangKnownToMatchDocumentElement())
        return true;

    if (hasRareData()) [[unlikely]]
        return !elementRareData()->effectiveLang().isNull();

    return false;
}

void Element::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    ContainerNode::removingSteps(removalType, oldParentOfRemovedTree);

    if (removalType.treeScopeChanged) {
        Ref oldTreeScope = oldParentOfRemovedTree.treeScope();
        RefPtr<HTMLDocument> oldHTMLDocument = removalType.disconnectedFromDocument
            && oldParentOfRemovedTree.isInDocumentTree() ? dynamicDowncast<HTMLDocument>(oldTreeScope->documentScope()) : nullptr;

        removeFromIdAndNameMaps(oldTreeScope, oldHTMLDocument.get());
        preserveCustomElementRegistryAfterLeavingTreeScope(*this, oldParentOfRemovedTree);
    }

    if (removalType.disconnectedFromDocument) {
        Ref<Document> oldDocument = oldParentOfRemovedTree.treeScope().documentScope();
        ASSERT(&document() == oldDocument.ptr());

        oldDocument->elementDisconnectedFromDocument(*this);

        if (isInTopLayer()) [[unlikely]]
            removeFromTopLayer();

        if (isDefinedCustomElement()) [[unlikely]]
            CustomElementReactionQueue::enqueueDisconnectedCallbackIfNeeded(*this);
    }

    if (!parentNode()) {
        if (RefPtr shadowRoot = oldParentOfRemovedTree.shadowRoot())
            shadowRoot->hostChildElementDidChange(*this);
    }

    if (!parentNode()) {
        if (is<Document>(oldParentOfRemovedTree)) {
            setEffectiveLangStateOnOldDocumentElement();
            protect(document())->setDocumentElementLanguage(nullAtom());
        } else if (!hasLanguageAttribute()) {
            setEffectiveLangKnownToMatchDocumentElement(false);
            if (hasRareData())
                elementRareData()->setEffectiveLang(nullAtom());
        }
    }

    document().userActionElements().clearAllForElement(*this);

    if (usesEffectiveTextDirection()) [[unlikely]] {
        if (!hasValidTextDirectionState()) {
            if (auto* parent = parentOrShadowHostElement(); !(parent && parent->usesEffectiveTextDirection()))
                setUsesEffectiveTextDirection(false);
        }
    }
}

void Element::movingSteps(MovingType movingType, ContainerNode& oldParent)
{
    ContainerNode::movingSteps(movingType, oldParent);

    RefPtr htmlDocument = dynamicDowncast<HTMLDocument>(document());
    if (movingType.didRemoveFromOldTreeScope) {
        removeFromIdAndNameMaps(protect(oldParent.treeScope()), oldParent.isInDocumentTree() ? htmlDocument.get() : nullptr);
        preserveCustomElementRegistryAfterLeavingTreeScope(*this, oldParent);
    }
    if (movingType.didInsertIntoNewTreeScope) {
        addToIdAndNameMaps(protect(treeScope()), isInDocumentTree() ? htmlDocument.get() : nullptr);
        preserveCustomElementRegistryAfterEnteringTreeScope(*this);
    }

    if (!is<HTMLSlotElement>(*this))
        updateEffectiveTextDirectionIfNeeded();

    updateEffectiveLangState();

    if (!movingType.isSubtreeRoot || !hasFocusWithin())
        return;

    if (RefPtr oldParentElement = dynamicDowncast<Element>(oldParent))
        oldParentElement->setHasFocusWithin(false);
    for (Ref oldAncestor : composedTreeAncestors(oldParent))
        oldAncestor->setHasFocusWithin(false);

    for (Ref newAncestor : composedTreeAncestors(*this))
        newAncestor->setHasFocusWithin(true);

    // FIXME(314066): Audit removingSteps and insertionSteps and handle all internal state that needs updating here.
}

PopoverData* Element::popoverData() const
{
    return hasRareData() ? elementRareData()->popoverData() : nullptr;
}

PopoverData& Element::ensurePopoverData()
{
    ElementRareData& data = ensureElementRareData();
    if (!data.popoverData())
        data.setPopoverData(makeUnique<PopoverData>());
    return *data.popoverData();
}

void Element::clearPopoverData()
{
    if (hasRareData())
        elementRareData()->setPopoverData(nullptr);
}

Element* Element::invokedPopover() const
{
    return hasRareData() ? elementRareData()->invokedPopover() : nullptr;
}

void Element::setInvokedPopover(RefPtr<Element>&& element)
{
    auto& data = ensureElementRareData();
    data.setInvokedPopover(WTF::move(element));
}

inline void ShadowRoot::setHost(Element* host)
{
    m_host = host;
    m_shadowIncludingRoot = host ? &host->shadowIncludingRoot() : this;
}

void Element::addShadowRoot(Ref<ShadowRoot>&& newShadowRoot)
{
    ASSERT(!newShadowRoot->hasChildNodes());
    ASSERT(!shadowRoot());

    Ref shadowRoot = newShadowRoot;
    {
        ScriptDisallowedScope::InMainThread scriptDisallowedScope;

        m_shadowRoot = WTF::move(newShadowRoot);

        shadowRoot->setHost(this);
        shadowRoot->setParentTreeScope(protect(treeScope()));

        NodeVector postInsertionNotificationTargets;
        notifyChildNodeInserted(*this, shadowRoot, postInsertionNotificationTargets);
        ASSERT_UNUSED(postInsertionNotificationTargets, postInsertionNotificationTargets.isEmpty());
    }

    if (shadowRoot->mode() == ShadowRootMode::UserAgent)
        didAddUserAgentShadowRoot(shadowRoot);
}

inline void Element::removeShadowRoot()
{
    RefPtr shadowRoot = this->shadowRoot();
    if (!shadowRoot) [[likely]]
        return;
    removeShadowRootSlow(*shadowRoot);
}

void Element::removeShadowRootSlow(ShadowRoot& oldRoot)
{
    ASSERT(&oldRoot == shadowRoot());

    protect(document())->adjustFocusedNodeOnNodeRemoval(oldRoot);

    m_shadowRoot = nullptr;

    oldRoot.setHost(nullptr);
    oldRoot.setParentTreeScope(protect(document()));
}

static bool canAttachAuthorShadowRoot(const Element& element)
{
    using namespace ElementNames;

    if (!is<HTMLElement>(element))
        return false;

    switch (element.elementName()) {
    case HTML::article:
    case HTML::aside:
    case HTML::blockquote:
    case HTML::body:
    case HTML::div:
    case HTML::footer:
    case HTML::h1:
    case HTML::h2:
    case HTML::h3:
    case HTML::h4:
    case HTML::h5:
    case HTML::h6:
    case HTML::header:
    case HTML::main:
    case HTML::nav:
    case HTML::p:
    case HTML::section:
    case HTML::span:
        return true;
    default:
        break;
    }

    if (auto localName = element.localName(); Document::validateCustomElementName(localName) == CustomElementNameValidationStatus::Valid) {
        if (auto* window = element.document().window()) {
            auto* registry = window->customElementRegistry();
            if (registry && registry->isShadowDisabled(localName))
                return false;
        }

        return true;
    }

    return false;
}

ExceptionOr<ShadowRoot&> Element::attachShadow(const ShadowRootInit& init, std::optional<CustomElementRegistryKind> registryKind)
{
    if (init.mode == ShadowRootMode::UserAgent)
        return Exception { ExceptionCode::TypeError };
    if (!canAttachAuthorShadowRoot(*this))
        return Exception { ExceptionCode::NotSupportedError };
    if (RefPtr shadowRoot = this->shadowRoot()) {
        if (shadowRoot->isDeclarativeShadowRoot()) {
            if (init.mode != shadowRoot->mode())
                return Exception { ExceptionCode::NotSupportedError };
            ChildListMutationScope mutation(*shadowRoot);
            shadowRoot->removeChildren();
            shadowRoot->setIsDeclarativeShadowRoot(false);
            return *shadowRoot;
        }
        return Exception { ExceptionCode::NotSupportedError };
    }
    RefPtr<CustomElementRegistry> registry;
    if (init.customElementRegistry) {
        registry = *init.customElementRegistry;
        if (registry && !registry->isScoped() && registry != document().customElementRegistry())
            return Exception { ExceptionCode::NotSupportedError };
        if (!registry)
            registryKind = CustomElementRegistryKind::Null;
    }
    auto scopedRegistry = ShadowRootScopedCustomElementRegistry::No;
    if (!registryKind)
        registryKind = CustomElementRegistryKind::Window;
    if (registryKind == CustomElementRegistryKind::Null) {
        ASSERT(!registry);
        scopedRegistry = ShadowRootScopedCustomElementRegistry::Yes;
    } else if (registry) {
        ASSERT(registryKind == CustomElementRegistryKind::Window);
        scopedRegistry = ShadowRootScopedCustomElementRegistry::Yes;
    } else
        registry = document().customElementRegistry();
    Ref shadow = ShadowRoot::create(protect(document()), init.mode, init.slotAssignment,
        init.delegatesFocus ? ShadowRootDelegatesFocus::Yes : ShadowRootDelegatesFocus::No,
        init.clonable ? ShadowRoot::Clonable::Yes : ShadowRoot::Clonable::No,
        init.serializable ? ShadowRootSerializable::Yes : ShadowRootSerializable::No,
        isPrecustomizedOrDefinedCustomElement() ? ShadowRootAvailableToElementInternals::Yes : ShadowRootAvailableToElementInternals::No,
        WTF::move(registry), scopedRegistry);
    if (registryKind == CustomElementRegistryKind::Null)
        shadow->setUsesNullCustomElementRegistry(); // Set this flag for Element::insertionSteps.
    addShadowRoot(shadow.copyRef());
    return shadow.get();
}

ExceptionOr<ShadowRoot&> Element::attachDeclarativeShadow(ShadowRootMode mode, ShadowRootDelegatesFocus delegatesFocus, ShadowRootClonable clonable, ShadowRootSerializable serializable, SlotAssignmentMode slotAssignment, CustomElementRegistryKind registryKind)
{
    if (this->shadowRoot())
        return Exception { ExceptionCode::NotSupportedError };
    auto exceptionOrShadowRoot = attachShadow({
        mode,
        delegatesFocus == ShadowRootDelegatesFocus::Yes,
        clonable == ShadowRootClonable::Yes,
        serializable == ShadowRootSerializable::Yes,
        slotAssignment,
        std::nullopt,
        { },
    }, registryKind);
    if (exceptionOrShadowRoot.hasException())
        return exceptionOrShadowRoot.releaseException();
    Ref shadowRoot = exceptionOrShadowRoot.releaseReturnValue();
    shadowRoot->setIsDeclarativeShadowRoot(true);
    shadowRoot->setIsAvailableToElementInternals(true);
    return shadowRoot.get();
}

RefPtr<ShadowRoot> Element::shadowRootForBindings(JSC::JSGlobalObject&) const
{
    RefPtr shadow = shadowRoot();
    if (!shadow)
        return nullptr;
    if (shadow->mode() == ShadowRootMode::Open)
        return shadow;
    return nullptr;
}

RefPtr<Element> Element::resolveReferenceTarget() const
{
    return const_cast<Element*>(this);
}

RefPtr<Element> Element::retargetReferenceTargetForBindings(RefPtr<Element> element) const
{
    return element;
}

ShadowRoot* Element::userAgentShadowRoot() const
{
    auto* root = shadowRoot();
    return root && root->mode() == ShadowRootMode::UserAgent ? root : nullptr;
}

ShadowRoot& Element::ensureUserAgentShadowRoot()
{
    if (auto* shadow = userAgentShadowRoot())
        return *shadow;
    return createUserAgentShadowRoot();
}

ShadowRoot& Element::createUserAgentShadowRoot()
{
    ASSERT(!userAgentShadowRoot());
    Ref newShadow = ShadowRoot::create(protect(document()), ShadowRootMode::UserAgent);
    SUPPRESS_UNCHECKED_LOCAL auto& shadow = newShadow.unsafeGet();
    addShadowRoot(WTF::move(newShadow));
    return shadow;
}

inline void Node::setCustomElementState(CustomElementState state)
{
    auto bitfields = rareDataBitfields();
    bitfields.customElementState = std::to_underlying(state);
    setRareDataBitfields(bitfields);
}

void Element::setIsDefinedCustomElement(JSCustomElementInterface& elementInterface)
{
    setCustomElementState(CustomElementState::Custom);
    auto& data = ensureElementRareData();
    if (!data.customElementReactionQueue())
        data.initializeCustomElementReactionQueue(makeUnique<CustomElementReactionQueue>(elementInterface));
}

void Element::setIsFailedCustomElement()
{
    ASSERT(isUnknownElement());
    setIsFailedOrPrecustomizedCustomElementWithoutClearingReactionQueue();
    clearReactionQueueFromFailedCustomElement();
    ASSERT(isFailedCustomElement());
}

void Element::setIsFailedOrPrecustomizedCustomElementWithoutClearingReactionQueue()
{
    ASSERT(customElementState() == CustomElementState::Undefined);
    setCustomElementState(CustomElementState::FailedOrPrecustomized);
}

void Element::clearReactionQueueFromFailedCustomElement()
{
    ASSERT(isFailedOrPrecustomizedCustomElement());
    if (hasRareData()) {
        // Clear the queue instead of deleting it since this function can be called inside CustomElementReactionQueue::invokeAll during upgrades.
        if (CheckedPtr queue = elementRareData()->customElementReactionQueue())
            queue->clear();
    }
}

void Element::setIsCustomElementUpgradeCandidate()
{
    ASSERT(customElementState() == CustomElementState::Uncustomized);
    setCustomElementState(CustomElementState::Undefined);
}

void Element::enqueueToUpgrade(JSCustomElementInterface& elementInterface)
{
    ASSERT(isCustomElementUpgradeCandidate());
    auto& data = ensureElementRareData();
    bool alreadyScheduledToUpgrade = data.customElementReactionQueue();
    if (!alreadyScheduledToUpgrade)
        data.initializeCustomElementReactionQueue(makeUnique<CustomElementReactionQueue>(elementInterface));
    data.customElementReactionQueue()->enqueueElementUpgrade(*this, alreadyScheduledToUpgrade);
}

CustomElementReactionQueue* Element::reactionQueue() const
{
#if ASSERT_ENABLED
    if (isFailedOrPrecustomizedCustomElement()) {
        auto* queue = elementRareData()->customElementReactionQueue();
        ASSERT(queue);
    }
#endif
    if (!hasRareData())
        return nullptr;
    return elementRareData()->customElementReactionQueue();
}

CustomElementRegistry* Element::customElementRegistry() const
{
    if (RefPtr window = document().window())
        window->ensureCustomElementRegistry(); // Create the global registry before querying since registryForElement doesn't ensure it.
    return CustomElementRegistry::registryForElement(*this);
}

CustomElementRegistry* Element::scopedCustomElementRegistry() const
{
    return hasRareData() ? elementRareData()->scopedCustomElementRegistry() : nullptr;
}

void Element::setScopedCustomElementRegistry(RefPtr<CustomElementRegistry>&& registry)
{
    ensureElementRareData().setScopedCustomElementRegistry(WTF::move(registry));
}

CustomElementDefaultARIA& Element::customElementDefaultARIA()
{
    ASSERT(isPrecustomizedOrDefinedCustomElement());
    CheckedPtr defaultARIA = elementRareData()->customElementDefaultARIA();
    if (!defaultARIA) {
        elementRareData()->initializeCustomElementDefaultARIA(makeUnique<CustomElementDefaultARIA>());
        defaultARIA = elementRareData()->customElementDefaultARIA();
    }
    return *defaultARIA.unsafeGet();
}

CustomElementDefaultARIA* Element::customElementDefaultARIAIfExists() const
{
    return isPrecustomizedOrDefinedCustomElement() && hasRareData() ? elementRareData()->customElementDefaultARIA() : nullptr;
}

bool Element::childTypeAllowed(NodeType type) const
{
    switch (type) {
    case NodeType::Element:
    case NodeType::Text:
    case NodeType::Comment:
    case NodeType::ProcessingInstruction:
    case NodeType::CDATASection:
        return true;
    default:
        break;
    }
    return false;
}

void Element::childrenChanged(const ChildChange& change)
{
    ContainerNode::childrenChanged(change);

    if (RefPtr shadowRoot = this->shadowRoot()) {
        switch (change.type) {
        case ChildChange::Type::ElementInserted:
        case ChildChange::Type::ElementRemoved:
        case ChildChange::Type::ElementMovedFrom:
        case ChildChange::Type::ElementMovedInto:
            // For elements, we notify shadowRoot in Element::insertionSteps and Element::removingSteps.
            // FIXME(321178): Need to notify shadowRoot when elements are moved.
            break;
        case ChildChange::Type::AllChildrenRemoved:
        case ChildChange::Type::AllChildrenReplaced:
            shadowRoot->didRemoveAllChildrenOfShadowHost();
            break;
        case ChildChange::Type::ElementAndTextInserted:
        case ChildChange::Type::TextInserted:
        case ChildChange::Type::TextRemoved:
        case ChildChange::Type::TextChanged:
        case ChildChange::Type::TextMovedFrom:
        case ChildChange::Type::TextMovedInto:
            shadowRoot->didMutateTextNodesOfShadowHost();
            break;
        case ChildChange::Type::NonContentsChildInserted:
        case ChildChange::Type::NonContentsChildRemoved:
        case ChildChange::Type::NonContentsChildMovedFrom:
        case ChildChange::Type::NonContentsChildMovedInto:
            break;
        }
    }

    if (document().isDirAttributeDirty()) [[unlikely]] {
        if (selfOrPrecedingNodesAffectDirAuto()) {
            bool allInsertedElementsAreTreatedAsNeutralCharacter = false;
            if (change.siblingChanged && protect(change.siblingChanged)->isReplaced())
                allInsertedElementsAreTreatedAsNeutralCharacter = true;
            else if (change.insertedChildren) {
                allInsertedElementsAreTreatedAsNeutralCharacter = true;
                for (auto& child : *change.insertedChildren) {
                    if (RefPtr element = dynamicDowncast<Element>(child); !element || !element->isReplaced())
                        allInsertedElementsAreTreatedAsNeutralCharacter = false;
                }
            }
            if (!allInsertedElementsAreTreatedAsNeutralCharacter)
                updateEffectiveTextDirection();
        } else {
            // No light DOM dir=auto ancestor, but this element may be slotted
            // into a dir=auto slot whose direction depends on slotted content.
            for (Ref ancestor : composedTreeAncestors(*this)) {
                if (auto* slot = dynamicDowncast<HTMLSlotElement>(ancestor.get())) {
                    if (slot->selfOrPrecedingNodesAffectDirAuto())
                        slot->updateEffectiveTextDirection();
                    break;
                }
            }
        }
    }
}

void Element::setAttributeEventListener(const AtomString& eventType, const QualifiedName& attributeName, const AtomString& attributeValue)
{
    setAttributeEventListener(eventType, JSLazyEventListener::create(*this, attributeName, attributeValue), mainThreadNormalWorldSingleton());
}

void Element::removeAllEventListeners()
{
    ContainerNode::removeAllEventListeners();
    if (RefPtr shadowRoot = this->shadowRoot())
        shadowRoot->removeAllEventListeners();
}

void Element::finishParsingChildren()
{
    if (hasHeldBackChildrenChanged())
        parserNotifyChildrenChanged();

    setIsParsingChildrenFinished();
}

static void appendAttributes(StringBuilder& builder, const Element& element)
{
    if (element.hasID())
        builder.append(" id=\'"_s, element.getIdAttribute(), '\'');

    if (element.hasClass()) {
        builder.append(" class=\'"_s);
        size_t classNamesToDump = element.classNames().size();
        constexpr size_t maxNumClassNames = 7;
        bool addEllipsis = false;
        if (classNamesToDump > maxNumClassNames) {
            classNamesToDump = maxNumClassNames;
            addEllipsis = true;
        }

        for (size_t i = 0; i < classNamesToDump; ++i) {
            if (i > 0)
                builder.append(' ');
            builder.append(element.classNames()[i]);
        }
        if (addEllipsis)
            builder.append(" ..."_s);
        builder.append('\'');
    }
}

String Element::attributesForDescription() const
{
    StringBuilder builder;
    appendAttributes(builder, *this);
    return builder.toString();
}

String Element::description() const
{
    StringBuilder builder;

    builder.append(ContainerNode::description());
    appendAttributes(builder, *this);

    return builder.toString();
}

String Element::debugDescription() const
{
    StringBuilder builder;

    builder.append(ContainerNode::debugDescription());
    appendAttributes(builder, *this);

    return builder.toString();
}

const Vector<Ref<Attr>>& Element::attrNodeList()
{
    ASSERT(hasSyntheticAttrChildNodes());
    return *attrNodeListForElement(*this);
}

void Element::attachAttributeNodeIfNeeded(Attr& attrNode)
{
    ASSERT(!attrNode.ownerElement() || attrNode.ownerElement() == this);
    if (attrNode.ownerElement() == this)
        return;

    ScriptDisallowedScope::InMainThread scriptDisallowedScope;

    attrNode.attachToElement(*this);
    ensureAttrNodeListForElement(*this).append(attrNode);
}

ExceptionOr<RefPtr<Attr>> Element::setAttributeNode(Attr& attrNode)
{
    // Attr::value() will return its 'm_standaloneValue' member any time its Element is set to nullptr. We need to cache this value
    // before making changes to attrNode's Element connections.
    auto attrNodeValue = attrNode.value();

    RefPtr oldAttrNode = attrIfExists(attrNode.qualifiedName());
    if (oldAttrNode.get() == &attrNode)
        return oldAttrNode;

    // InUseAttributeError: Raised if node is an Attr that is already an attribute of another Element object.
    // The DOM user must explicitly clone Attr nodes to re-use them in other elements.
    if (attrNode.ownerElement() && attrNode.ownerElement() != this)
        return Exception { ExceptionCode::InUseAttributeError };

    {
        ScriptDisallowedScope::InMainThread scriptDisallowedScope;
        synchronizeAllAttributes();
    }

    Ref elementData = ensureUniqueElementData();

    auto existingAttributeIndex = elementData->findAttributeIndexByName(attrNode.qualifiedName());

    if (existingAttributeIndex == ElementData::attributeNotFound) {
        attachAttributeNodeIfNeeded(attrNode);
        setAttributeInternal(elementData->findAttributeIndexByName(attrNode.qualifiedName()), attrNode.qualifiedName(), attrNodeValue, InSynchronizationOfLazyAttribute::No);
    } else {
        const Attribute& attribute = attributeAt(existingAttributeIndex);
        if (oldAttrNode)
            detachAttrNodeFromElementWithValue(oldAttrNode.get(), attribute.value());
        else
            oldAttrNode = Attr::create(protect(document()), attrNode.qualifiedName(), attribute.value());

        attachAttributeNodeIfNeeded(attrNode);

        if (attribute.name().matches(attrNode.qualifiedName()))
            setAttributeInternal(existingAttributeIndex, attrNode.qualifiedName(), attrNodeValue, InSynchronizationOfLazyAttribute::No);
        else {
            removeAttributeInternal(existingAttributeIndex, InSynchronizationOfLazyAttribute::No);
            setAttributeInternal(ensureUniqueElementData().findAttributeIndexByName(attrNode.qualifiedName()), attrNode.qualifiedName(), attrNodeValue, InSynchronizationOfLazyAttribute::No);
        }
    }

    return oldAttrNode;
}

ExceptionOr<RefPtr<Attr>> Element::setAttributeNodeNS(Attr& attrNode)
{
    // Attr::value() will return its 'm_standaloneValue' member any time its Element is set to nullptr. We need to cache this value
    // before making changes to attrNode's Element connections.
    auto attrNodeValue = attrNode.value();

    RefPtr oldAttrNode = attrIfExists(attrNode.qualifiedName());
    if (oldAttrNode == &attrNode)
        return oldAttrNode;

    // InUseAttributeError: Raised if node is an Attr that is already an attribute of another Element object.
    // The DOM user must explicitly clone Attr nodes to re-use them in other elements.
    if (attrNode.ownerElement() && attrNode.ownerElement() != this)
        return Exception { ExceptionCode::InUseAttributeError };

    unsigned index = 0;

    {
        ScriptDisallowedScope::InMainThread scriptDisallowedScope;
        synchronizeAllAttributes();
        Ref elementData = ensureUniqueElementData();

        index = elementData->findAttributeIndexByName(attrNode.qualifiedName());

        if (index != ElementData::attributeNotFound) {
            if (oldAttrNode)
                detachAttrNodeFromElementWithValue(oldAttrNode.get(), elementData->attributeAt(index).value());
            else
                oldAttrNode = Attr::create(protect(document()), attrNode.qualifiedName(), elementData->attributeAt(index).value());
        }
    }

    attachAttributeNodeIfNeeded(attrNode);
    setAttributeInternal(index, attrNode.qualifiedName(), attrNodeValue, InSynchronizationOfLazyAttribute::No);

    return oldAttrNode;
}

ExceptionOr<Ref<Attr>> Element::removeAttributeNode(Attr& attr)
{
    if (attr.ownerElement() != this)
        return Exception { ExceptionCode::NotFoundError };

    ASSERT(&document() == &attr.document());

    synchronizeAllAttributes();

    if (!m_elementData)
        return Exception { ExceptionCode::NotFoundError };

    auto existingAttributeIndex = m_elementData->findAttributeIndexByName(attr.qualifiedName());
    if (existingAttributeIndex == ElementData::attributeNotFound)
        return Exception { ExceptionCode::NotFoundError };

    Ref oldAttrNode { attr };

    detachAttrNodeFromElementWithValue(oldAttrNode.ptr(), m_elementData->attributeAt(existingAttributeIndex).value());
    removeAttributeInternal(existingAttributeIndex, InSynchronizationOfLazyAttribute::No);

    return oldAttrNode;
}

ExceptionOr<void> Element::setAttributeNS(const AtomString& namespaceURI, const AtomString& qualifiedName, const AtomString& value)
{
    auto parseResult = NameValidation::parseQualifiedAttributeName(namespaceURI, qualifiedName);
    if (parseResult.hasException())
        return parseResult.releaseException();
    QualifiedName parsedAttributeName { parseResult.releaseReturnValue() };
    if (!NameValidation::hasValidNamespaceForAttributes(parsedAttributeName))
        return Exception { ExceptionCode::NamespaceError };
    setAttribute(parsedAttributeName, value);
    return { };
}

void Element::removeAttributeInternal(unsigned index, InSynchronizationOfLazyAttribute inSynchronizationOfLazyAttribute)
{
    ASSERT_WITH_SECURITY_IMPLICATION(index < attributeCount());

    Ref<UniqueElementData> elementData = ensureUniqueElementData();

    QualifiedName name = elementData->attributeAt(index).name();
    AtomString valueBeingRemoved = elementData->attributeAt(index).value();

    if (RefPtr attrNode = attrIfExists(name))
        detachAttrNodeFromElementWithValue(attrNode.get(), elementData->attributeAt(index).value());

    if (inSynchronizationOfLazyAttribute == InSynchronizationOfLazyAttribute::Yes) {
        elementData->removeAttributeAt(index);
        return;
    }

    ASSERT(!valueBeingRemoved.isNull());
    willModifyAttribute(name, valueBeingRemoved, nullAtom());
    elementData->removeAttributeAt(index);
    didRemoveAttribute(name, valueBeingRemoved);
}

void Element::addAttributeInternal(const QualifiedName& name, const AtomString& value, InSynchronizationOfLazyAttribute inSynchronizationOfLazyAttribute)
{
    if (inSynchronizationOfLazyAttribute == InSynchronizationOfLazyAttribute::Yes) {
        protect(ensureUniqueElementData())->addAttribute(name, value);
        return;
    }

    willModifyAttribute(name, nullAtom(), value);
    protect(ensureUniqueElementData())->addAttribute(name, value);
    didAddAttribute(name, value);
}

bool Element::removeAttribute(const AtomString& qualifiedName)
{
    if (!elementData())
        return false;

    AtomString caseAdjustedQualifiedName = shouldIgnoreAttributeCase(*this) ? qualifiedName.convertToASCIILowercase() : qualifiedName;
    synchronizeAttribute(caseAdjustedQualifiedName);

    unsigned index = elementData()->findAttributeIndexByName(caseAdjustedQualifiedName, false);
    if (index == ElementData::attributeNotFound)
        return false;

    removeAttributeInternal(index, InSynchronizationOfLazyAttribute::No);
    return true;
}

bool Element::removeAttributeNS(const AtomString& namespaceURI, const AtomString& localName)
{
    return removeAttribute(QualifiedName(nullAtom(), localName, namespaceURI));
}

RefPtr<Attr> Element::getAttributeNode(const AtomString& qualifiedName)
{
    if (!elementData())
        return nullptr;
    synchronizeAttribute(qualifiedName);
    const Attribute* attribute = elementData()->findAttributeByName(qualifiedName, shouldIgnoreAttributeCase(*this));
    if (!attribute)
        return nullptr;
    return ensureAttr(attribute->name());
}

RefPtr<Attr> Element::getAttributeNodeNS(const AtomString& namespaceURI, const AtomString& localName)
{
    if (!elementData())
        return nullptr;
    QualifiedName qName(nullAtom(), localName, namespaceURI);
    synchronizeAttribute(qName);
    const Attribute* attribute = elementData()->findAttributeByName(qName);
    if (!attribute)
        return nullptr;
    return ensureAttr(attribute->name());
}

bool Element::hasAttribute(const AtomString& qualifiedName) const
{
    if (!elementData())
        return false;
    synchronizeAttribute(qualifiedName);
    return elementData()->findAttributeByName(qualifiedName, shouldIgnoreAttributeCase(*this));
}

bool Element::hasAttributeNS(const AtomString& namespaceURI, const AtomString& localName) const
{
    if (!elementData())
        return false;
    QualifiedName qName(nullAtom(), localName, namespaceURI);
    synchronizeAttribute(qName);
    return elementData()->findAttributeByName(qName);
}

static RefPtr<ShadowRoot> shadowRootWithDelegatesFocus(const Element& element)
{
    if (RefPtr root = element.shadowRoot()) {
        if (root->delegatesFocus())
            return root;
    }
    return nullptr;
}

static bool isProgramaticallyFocusable(Element& element)
{
    ScriptDisallowedScope::InMainThread scriptDisallowedScope;

    if (shadowRootWithDelegatesFocus(element))
        return false;

    return element.isFocusable();
}

// https://html.spec.whatwg.org/multipage/interaction.html#autofocus-delegate
static RefPtr<Element> autoFocusDelegate(ContainerNode& target, FocusTrigger trigger)
{
    if (auto* root = target.shadowRoot(); root && !root->delegatesFocus())
        return nullptr;

    for (Ref element : descendantsOfType<Element>(target)) {
        if (!element->hasAttributeWithoutSynchronization(HTMLNames::autofocusAttr))
            continue;
        if (auto root = shadowRootWithDelegatesFocus(element)) {
            if (RefPtr target = Element::findFocusDelegateForTarget(*root, trigger))
                return target;
        }
        switch (trigger) {
        case FocusTrigger::Click:
            if (element->isMouseFocusable())
                return element;
            break;
        case FocusTrigger::Other:
        case FocusTrigger::Bindings:
            if (isProgramaticallyFocusable(element))
                return element;
            break;
        }
    }
    return nullptr;
}

// https://html.spec.whatwg.org/multipage/interaction.html#focus-delegate
RefPtr<Element> Element::findFocusDelegateForTarget(ContainerNode& target, FocusTrigger trigger)
{
    if (auto* root = target.shadowRoot(); root && !root->delegatesFocus())
        return nullptr;
    if (RefPtr element = autoFocusDelegate(target, trigger))
        return element;
    for (Ref element : descendantsOfType<Element>(target)) {
        if (is<HTMLDialogElement>(&target) && element->isKeyboardFocusable({ }))
            return element;

        switch (trigger) {
        case FocusTrigger::Click:
            if (element->isMouseFocusable())
                return element;
            break;
        case FocusTrigger::Other:
        case FocusTrigger::Bindings:
            if (isProgramaticallyFocusable(element))
                return element;
            break;
        }
        if (RefPtr root = shadowRootWithDelegatesFocus(element)) {
            if (RefPtr target = findFocusDelegateForTarget(*root, trigger))
                return target;
        }
    }
    return nullptr;
}

// https://html.spec.whatwg.org/multipage/interaction.html#autofocus-delegate
RefPtr<Element> Element::findAutofocusDelegate(FocusTrigger trigger)
{
    return autoFocusDelegate(*this, trigger);
}

// https://html.spec.whatwg.org/multipage/interaction.html#focus-delegate
RefPtr<Element> Element::findFocusDelegate(FocusTrigger trigger)
{
    return findFocusDelegateForTarget(*this, trigger);
}

void Element::focus(const FocusOptions& options)
{
    if (!isConnected())
        return;

    Ref document { this->document() };
    if (document->focusedElement() == this)
        return;

    RefPtr newTarget { this };

    if (RefPtr root = shadowRootWithDelegatesFocus(*this)) {
        if (root->isShadowIncludingInclusiveAncestorOf(document->focusedElement()))
            return;

        newTarget = findFocusDelegateForTarget(*root, options.trigger);
        if (!newTarget)
            return;
    } else if (!isProgramaticallyFocusable(*newTarget)) {
        if (this == document->documentElement())
            document->setFocusedElement(nullptr);
        return;
    }

    FocusOptions optionsWithVisibility = options;
    if (options.focusVisible)
        optionsWithVisibility.visibility = *options.focusVisible ? FocusVisibility::Visible : FocusVisibility::ForceInvisible;
    else if (options.trigger == FocusTrigger::Bindings && document->wasLastFocusByClick())
        optionsWithVisibility.visibility = FocusVisibility::Invisible;
    else if (options.trigger != FocusTrigger::Click)
        optionsWithVisibility.visibility = FocusVisibility::Visible;

    // Focus and change event handlers can cause us to lose our last ref.
    // If a focus event handler changes the focus to a different node it
    // does not make sense to continue and update appearence.
    if (!document->setFocusedElement(newTarget.get(), optionsWithVisibility))
        return;

    newTarget->findTargetAndUpdateFocusAppearance(options.selectionRestorationMode);
}

void Element::focusForBindings(FocusOptions&& options)
{
    options.trigger = FocusTrigger::Bindings;
    focus(WTF::move(options));
}

void Element::findTargetAndUpdateFocusAppearance(SelectionRestorationMode selectionMode)
{
    RefPtr target = focusAppearanceUpdateTarget();
    if (!target)
        return;

    target->updateFocusAppearance(selectionMode);
}

// https://html.spec.whatwg.org/#focus-processing-model
RefPtr<Element> Element::focusAppearanceUpdateTarget()
{
    return this;
}

void Element::updateFocusAppearance(SelectionRestorationMode)
{
}

void Element::blur()
{
    if (treeScope().focusedElementInScope() == this)
        protect(document())->setFocusedElement(nullptr);
}

void Element::runFocusingStepsForAutofocus()
{
    focus();
}

void Element::dispatchFocusInEventIfNeeded(RefPtr<Element>&& oldFocusedElement)
{
    Ref document = this->document();
    if (!document->hasListenerType(Document::ListenerType::FocusIn))
        return;
    RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(ScriptDisallowedScope::InMainThread::isScriptAllowed());
    dispatchScopedEvent(FocusEvent::create(eventNames().focusinEvent, Event::CanBubble::Yes, Event::IsCancelable::No, document->window(), 0, WTF::move(oldFocusedElement)));
}

void Element::dispatchFocusOutEventIfNeeded(RefPtr<Element>&& newFocusedElement)
{
    Ref document = this->document();
    if (!document->hasListenerType(Document::ListenerType::FocusOut))
        return;
    RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(ScriptDisallowedScope::InMainThread::isScriptAllowed());
    dispatchScopedEvent(FocusEvent::create(eventNames().focusoutEvent, Event::CanBubble::Yes, Event::IsCancelable::No, document->window(), 0, WTF::move(newFocusedElement)));
}

void Element::dispatchFocusEvent(RefPtr<Element>&& oldFocusedElement, const FocusOptions&)
{
    dispatchEvent(FocusEvent::create(eventNames().focusEvent, Event::CanBubble::No, Event::IsCancelable::No, document().window(), 0, WTF::move(oldFocusedElement)));
}

void Element::dispatchBlurEvent(RefPtr<Element>&& newFocusedElement)
{
    dispatchEvent(FocusEvent::create(eventNames().blurEvent, Event::CanBubble::No, Event::IsCancelable::No, document().window(), 0, WTF::move(newFocusedElement)));
}

ExceptionOr<void> Element::replaceChildrenWithMarkup(const String& markup, OptionSet<ParserContentPolicy> parserContentPolicy)
{
    auto policy = OptionSet<ParserContentPolicy> { ParserContentPolicy::AllowScriptingContent } | parserContentPolicy;

    Ref container = [this]() -> Ref<ContainerNode> {
        if (auto* templateElement = dynamicDowncast<HTMLTemplateElement>(*this))
            return templateElement->content();
        return *this;
    }();

    // Parsing empty string creates additional elements only inside <html> container
    // https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inhtml
    if (markup.isEmpty() && !is<HTMLHtmlElement>(container)) {
        ChildListMutationScope mutation(container);
        container->removeChildren();
        return { };
    }

    auto fragment = createFragmentForInnerOuterHTML(*this, markup, policy, protect(CustomElementRegistry::registryForNodeOrTreeScope(container, protect(container->treeScope()))), container->usesNullCustomElementRegistry() ? CustomElementRegistryKind::Null : CustomElementRegistryKind::Window);
    if (fragment.hasException())
        return fragment.releaseException();

    bool usedFastPath = fragment.returnValue()->hasWasParsedWithFastPath();
    auto result = replaceChildrenWithFragment(container, fragment.releaseReturnValue());
    if (!result.hasException() && usedFastPath)
        protect(document())->updateCachedSetInnerHTML(markup, container.get(), *this);
    return result;
}

ExceptionOr<void> Element::setHTMLUnsafe(String&& html)
{
    return replaceChildrenWithMarkup(WTF::move(html), { ParserContentPolicy::AllowDeclarativeShadowRoots, ParserContentPolicy::AlwaysParseAsHTML });
}

String Element::getHTML(GetHTMLOptions&& options) const
{
    return serializeFragment(*this, SerializedNodes::SubtreesOfChildren, nullptr, ResolveURLs::NoExcludingURLsForPrivacy, SerializationSyntax::HTML, options.serializableShadowRoots ? SerializeShadowRoots::Serializable : SerializeShadowRoots::Explicit, WTF::move(options.shadowRoots));
}

ExceptionOr<void> Element::mergeWithNextTextNode(Text& node)
{
    RefPtr textNext = dynamicDowncast<Text>(node.nextSibling());
    if (!textNext)
        return { };
    node.appendData(textNext->data());
    return textNext->remove();
}

String Element::innerHTML() const
{
    return serializeFragment(*this, SerializedNodes::SubtreesOfChildren, nullptr, ResolveURLs::NoExcludingURLsForPrivacy);
}

String Element::outerHTML() const
{
    return serializeFragment(*this, SerializedNodes::SubtreeIncludingNode, nullptr, ResolveURLs::NoExcludingURLsForPrivacy);
}

ExceptionOr<void> Element::setOuterHTML(String&& html)
{
    // https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-element-outerhtml
    RefPtr parent = parentNode();
    if (!parent)
        return { };
    if (is<Document>(*parent))
        return Exception { ExceptionCode::NoModificationAllowedError, "Cannot set outerHTML on element because its parent is a Document"_s };

    RefPtr contextElement = dynamicDowncast<Element>(parent);
    if (!contextElement)
        contextElement = HTMLBodyElement::create(protect(document()));

    RefPtr previous = previousSibling();
    RefPtr next = nextSibling();

    auto fragment = createFragmentForInnerOuterHTML(*contextElement, WTF::move(html), { ParserContentPolicy::AllowScriptingContent }, protect(CustomElementRegistry::registryForElement(*contextElement)), contextElement->usesNullCustomElementRegistry() ? CustomElementRegistryKind::Null : CustomElementRegistryKind::Window);
    if (fragment.hasException())
        return fragment.releaseException();

    auto replaceResult = parent->replaceChild(fragment.releaseReturnValue().get(), *this);
    if (replaceResult.hasException())
        return replaceResult.releaseException();

    // The following is not part of the specification but matches Blink's behavior as of June 2021.
    if (RefPtr nodeText = next ? dynamicDowncast<Text>(next->previousSibling()) : nullptr) {
        auto result = mergeWithNextTextNode(*nodeText);
        if (result.hasException())
            return result.releaseException();
    }
    if (RefPtr previousText = dynamicDowncast<Text>(WTF::move(previous))) {
        auto result = mergeWithNextTextNode(*previousText);
        if (result.hasException())
            return result.releaseException();
    }
    return { };
}

ExceptionOr<void> Element::setInnerHTML(String&& html)
{
    return replaceChildrenWithMarkup(WTF::move(html), { });
}

String Element::innerText()
{
    return textContent(true);
}

String Element::outerText()
{
    // Getting outerText is the same as getting innerText, only
    // setting is different. You would think this should get the plain
    // text for the outer range, but this is wrong, <br> for instance
    // would return different values for inner and outer text by such
    // a rule, but it doesn't in WinIE, and we want to match that.
    return innerText();
}

String Element::title() const
{
    return String();
}

const AtomString& Element::userAgentPart() const
{
    ASSERT(isInUserAgentShadowTree());
    return attributeWithoutSynchronization(useragentpartAttr);
}

void Element::setUserAgentPart(const AtomString& value)
{
    // We may set the useragentpart attribute on elements before appending them to the shadow tree.
    ASSERT(!isConnected() || isInUserAgentShadowTree());
    setAttributeWithoutSynchronization(useragentpartAttr, value);
}

static void propagateFocusWithinToAncestors(Element& element, bool value)
{
    for (Ref ancestor : composedTreeAncestors(element)) {
        ancestor->setHasFocusWithin(value);
        if (value && ancestor->isInTopLayer())
            break;
    }
}

void Element::addToTopLayer()
{
    RELEASE_ASSERT(!isInTopLayer());
    RELEASE_ASSERT(isConnected());
    ScriptDisallowedScope::InMainThread scriptDisallowedScope;

    Ref document = this->document();
    document->addTopLayerElement(*this);
    setEventTargetFlag(EventTargetFlag::IsInTopLayer);

    // User-action pseudo-classes should not propagate past top layer boundaries.
    if (hasFocusWithin())
        propagateFocusWithinToAncestors(*this, false);
}

void Element::removeFromTopLayer()
{
    RELEASE_ASSERT(isInTopLayer());
    ScriptDisallowedScope::InMainThread scriptDisallowedScope;

    // Unable to protect the document as it may have started destruction.
    document().removeTopLayerElement(*this);
    clearEventTargetFlag(EventTargetFlag::IsInTopLayer);

    // User-action pseudo-classes should now propagate past this element since it is
    // no longer a top layer boundary.
    if (hasFocusWithin())
        propagateFocusWithinToAncestors(*this, true);
}

const AtomString& Element::effectiveLang() const
{
    if (effectiveLangKnownToMatchDocumentElement() && isConnected())
        return document().effectiveDocumentElementLanguage();

    if (hasRareData()) {
        if (auto& lang = elementRareData()->effectiveLang(); !lang.isNull())
            return lang;
    }

    if (isConnected())
        return document().effectiveDocumentElementLanguage();

    for (SUPPRESS_UNCHECKED_LOCAL auto* ancestor = this; ancestor; ancestor = ancestor->parentOrShadowHostElement()) {
        if (ancestor->hasLanguageAttribute())
            return ancestor->langFromAttribute();
    }
    return nullAtom();
}

const AtomString& Element::langFromAttribute() const
{
    // Spec: xml:lang takes precedence over html:lang -- http://www.w3.org/TR/xhtml1/#C_7
    if (hasXMLLangAttr())
        return getAttribute(XMLNames::langAttr);
    if (hasLangAttr())
        return getAttribute(HTMLNames::langAttr);
    return nullAtom();
}

void Element::normalizeAttributes()
{
    if (!hasAttributes())
        return;

    auto* attrNodeList = attrNodeListForElement(*this);
    if (!attrNodeList)
        return;

    // Copy the Attr Vector because Node::normalize() can fire synchronous JS
    // events (e.g. DOMSubtreeModified) and a JS listener could add / remove
    // attributes while we are iterating.
    auto copyOfAttrNodeList = *attrNodeList;
    for (auto& attrNode : copyOfAttrNodeList)
        attrNode->normalize();
}

bool Element::matchesValidPseudoClass() const
{
    return false;
}

bool Element::matchesInvalidPseudoClass() const
{
    return false;
}

bool Element::matchesUserValidPseudoClass() const
{
    return false;
}

bool Element::matchesUserInvalidPseudoClass() const
{
    return false;
}

bool Element::matchesReadWritePseudoClass() const
{
    return false;
}

bool Element::matchesIndeterminatePseudoClass() const
{
    return false;
}

bool Element::matchesDefaultPseudoClass() const
{
    return false;
}

ExceptionOr<bool> Element::matches(const String& selector)
{
    auto query = protect(document())->selectorQueryForString(selector);
    if (query.hasException())
        return query.releaseException();
    return query.releaseReturnValue().matches(*this);
}

ExceptionOr<RefPtr<Element>> Element::closest(const String& selector)
{
    auto query = protect(document())->selectorQueryForString(selector);
    if (query.hasException())
        return query.releaseException();
    return query.releaseReturnValue().closest(*this);
}

DOMTokenList& Element::classList()
{
    ElementRareData& data = ensureElementRareData();
    if (!data.classList())
        data.setClassList(makeUniqueWithoutRefCountedCheck<DOMTokenList>(*this, HTMLNames::classAttr));
    return *data.classList();
}

SpaceSplitString Element::partNames() const
{
    return hasRareData() ? elementRareData()->partNames() : SpaceSplitString();
}

DOMTokenList& Element::part()
{
    auto& data = ensureElementRareData();
    if (!data.partList())
        data.setPartList(makeUniqueWithoutRefCountedCheck<DOMTokenList>(*this, HTMLNames::partAttr));
    return *data.partList();
}

DatasetDOMStringMap& Element::dataset()
{
    ElementRareData& data = ensureElementRareData();
    if (!data.dataset())
        data.setDataset(makeUniqueWithoutRefCountedCheck<DatasetDOMStringMap>(*this));
    return *data.dataset();
}

URL Element::getURLAttribute(const QualifiedName& name) const
{
#if ASSERT_ENABLED
    if (elementData()) {
        if (const Attribute* attribute = findAttributeByName(name))
            ASSERT(isURLAttribute(*attribute));
    }
#endif
    return protect(document())->encodingParseURL(getAttribute(name));
}

URL Element::getNonEmptyURLAttribute(const QualifiedName& name) const
{
#if ASSERT_ENABLED
    if (elementData()) {
        if (const Attribute* attribute = findAttributeByName(name))
            ASSERT(isURLAttribute(*attribute));
    }
#endif
    auto value = getAttribute(name).string().trim(isASCIIWhitespace);
    if (value.isEmpty())
        return URL();
    return protect(document())->encodingParseURL(value);
}

int Element::integralAttribute(const QualifiedName& attributeName) const
{
    return parseHTMLInteger(attributeWithoutSynchronization(attributeName)).value_or(0);
}

void Element::setIntegralAttribute(const QualifiedName& attributeName, int value)
{
    setAttributeWithoutSynchronization(attributeName, AtomString::number(value));
}

unsigned Element::unsignedIntegralAttribute(const QualifiedName& attributeName) const
{
    return parseHTMLNonNegativeInteger(attributeWithoutSynchronization(attributeName)).value_or(0);
}

void Element::setUnsignedIntegralAttribute(const QualifiedName& attributeName, unsigned value)
{
    setAttributeWithoutSynchronization(attributeName, AtomString::number(limitToOnlyHTMLNonNegative(value)));
}

ExceptionOr<void> Element::setPointerCapture(int32_t)
{
    return { };
}

ExceptionOr<void> Element::releasePointerCapture(int32_t)
{
    return { };
}

bool Element::hasPointerCapture(int32_t)
{
    return false;
}

bool Element::isSpellCheckingEnabled() const
{
    for (SUPPRESS_UNCHECKED_LOCAL auto* ancestor = this; ancestor; ancestor = ancestor->parentOrShadowHostElement()) {
        auto& value = ancestor->attributeWithoutSynchronization(HTMLNames::spellcheckAttr);
        if (value.isNull())
            continue;
        if (value.isEmpty() || equalLettersIgnoringASCIICase(value, "true"_s))
            return true;
        if (equalLettersIgnoringASCIICase(value, "false"_s))
            return false;
    }
    return true;
}

bool Element::computedWritingSuggestionsValue() const
{
    for (Ref ancestor : composedTreeLineage(*this)) {
        auto& value = ancestor->attributeWithoutSynchronization(HTMLNames::writingsuggestionsAttr);
        if (value.isNull())
            continue;
        if (equalLettersIgnoringASCIICase(value, "false"_s))
            return false;
        return true;
    }
    return true;
}

#if ASSERT_ENABLED
bool Element::fastAttributeLookupAllowed(const QualifiedName& name) const
{
    return name != HTMLNames::styleAttr;
}

bool Element::fastAttributeLookupAllowed(StaticQualifiedName name) const
{
    return name != HTMLNames::styleAttr;
}
#endif

#if DUMP_NODE_STATISTICS
bool Element::hasNamedNodeMap() const
{
    return hasRareData() && elementRareData()->attributeMap();
}
#endif

inline void Element::updateName(const AtomString& oldName, const AtomString& newName)
{
    if (!isInTreeScope())
        return;

    if (oldName == newName)
        return;

    updateNameForTreeScope(protect(treeScope()), oldName, newName);

    if (!isInDocumentTree())
        return;
    if (RefPtr htmlDocument = dynamicDowncast<HTMLDocument>(document()))
        updateNameForDocument(*htmlDocument, oldName, newName);
}

void Element::updateNameForTreeScope(TreeScope& scope, const AtomString& oldName, const AtomString& newName)
{
    ASSERT(oldName != newName);

    if (!oldName.isEmpty())
        scope.removeElementByName(oldName, *this);
    if (!newName.isEmpty())
        scope.addElementByName(newName, *this);
}

void Element::updateNameForDocument(HTMLDocument& document, const AtomString& oldName, const AtomString& newName)
{
    ASSERT(oldName != newName);

    if (WindowNameCollection::elementMatchesIfNameAttributeMatch(*this)) {
        const AtomString& id = WindowNameCollection::elementMatchesIfIdAttributeMatch(*this) ? getIdAttribute() : nullAtom();
        if (!oldName.isEmpty() && oldName != id)
            document.removeWindowNamedItem(oldName, *this);
        if (!newName.isEmpty() && newName != id)
            document.addWindowNamedItem(newName, *this);
    }

    if (DocumentNameCollection::elementMatchesIfNameAttributeMatch(*this)) {
        const AtomString& id = DocumentNameCollection::elementMatchesIfIdAttributeMatch(*this) ? getIdAttribute() : nullAtom();
        if (!oldName.isEmpty() && oldName != id)
            document.removeDocumentNamedItem(oldName, *this);
        if (!newName.isEmpty() && newName != id)
            document.addDocumentNamedItem(newName, *this);
    }
}

inline void Element::updateId(const AtomString& oldId, const AtomString& newId, NotifyObservers notifyObservers)
{
    if (!isInTreeScope())
        return;

    if (oldId == newId)
        return;

    updateIdForTreeScope(protect(treeScope()), oldId, newId, notifyObservers);

    if (!isInDocumentTree())
        return;
    if (RefPtr htmlDocument = dynamicDowncast<HTMLDocument>(document()))
        updateIdForDocument(*htmlDocument, oldId, newId, HTMLDocumentNamedItemMapsUpdatingCondition::UpdateOnlyIfDiffersFromNameAttribute);
}

void Element::updateIdForTreeScope(TreeScope& scope, const AtomString& oldId, const AtomString& newId, NotifyObservers notifyObservers)
{
    ASSERT(oldId != newId);

    if (!oldId.isEmpty())
        scope.removeElementById(oldId, *this, notifyObservers == NotifyObservers::Yes);
    if (!newId.isEmpty())
        scope.addElementById(newId, *this, notifyObservers == NotifyObservers::Yes);
}

void Element::updateIdForDocument(HTMLDocument& document, const AtomString& oldId, const AtomString& newId, HTMLDocumentNamedItemMapsUpdatingCondition condition)
{
    ASSERT(oldId != newId);

    if (WindowNameCollection::elementMatchesIfIdAttributeMatch(*this)) {
        const AtomString& name = condition == HTMLDocumentNamedItemMapsUpdatingCondition::UpdateOnlyIfDiffersFromNameAttribute && WindowNameCollection::elementMatchesIfNameAttributeMatch(*this) ? getNameAttribute() : nullAtom();
        if (!oldId.isEmpty() && oldId != name)
            document.removeWindowNamedItem(oldId, *this);
        if (!newId.isEmpty() && newId != name)
            document.addWindowNamedItem(newId, *this);
    }

    if (DocumentNameCollection::elementMatchesIfIdAttributeMatch(*this)) {
        const AtomString& name = condition == HTMLDocumentNamedItemMapsUpdatingCondition::UpdateOnlyIfDiffersFromNameAttribute && DocumentNameCollection::elementMatchesIfNameAttributeMatch(*this) ? getNameAttribute() : nullAtom();
        if (!oldId.isEmpty() && oldId != name)
            document.removeDocumentNamedItem(oldId, *this);
        if (!newId.isEmpty() && newId != name)
            document.addDocumentNamedItem(newId, *this);
    }
}

inline void Element::addToIdAndNameMaps(TreeScope& treeScope, HTMLDocument* htmlDocument)
{
    if (auto& idValue = getIdAttribute(); !idValue.isEmpty()) {
        treeScope.addElementById(idValue, *this);
        if (htmlDocument)
            updateIdForDocument(*htmlDocument, nullAtom(), idValue, HTMLDocumentNamedItemMapsUpdatingCondition::Always);
    }
    if (auto& nameValue = getNameAttribute(); !nameValue.isEmpty()) {
        treeScope.addElementByName(nameValue, *this);
        if (htmlDocument)
            updateNameForDocument(*htmlDocument, nullAtom(), nameValue);
    }
}

inline void Element::removeFromIdAndNameMaps(TreeScope& treeScope, HTMLDocument* htmlDocument)
{
    if (auto& idValue = getIdAttribute(); !idValue.isEmpty()) {
        treeScope.removeElementById(idValue, *this);
        if (htmlDocument)
            updateIdForDocument(*htmlDocument, idValue, nullAtom(), HTMLDocumentNamedItemMapsUpdatingCondition::Always);
    }
    if (auto& nameValue = getNameAttribute(); !nameValue.isEmpty()) {
        treeScope.removeElementByName(nameValue, *this);
        if (htmlDocument)
            updateNameForDocument(*htmlDocument, nameValue, nullAtom());
    }
}

void Element::willModifyAttribute(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue)
{
    if (name == HTMLNames::idAttr)
        updateId(oldValue, newValue, NotifyObservers::No); // Will notify observers after the attribute is actually changed.
    else if (name == HTMLNames::nameAttr)
        updateName(oldValue, newValue);

    if (auto recipients = MutationObserverInterestGroup::createForAttributesMutation(*this, name))
        recipients->enqueueMutationRecord(MutationRecord::createAttributes(*this, name, oldValue));
}

void Element::didAddAttribute(const QualifiedName& name, const AtomString& value)
{
    notifyAttributeChanged(name, nullAtom(), value);
}

void Element::didModifyAttribute(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue)
{
    notifyAttributeChanged(name, oldValue, newValue);
}

void Element::didRemoveAttribute(const QualifiedName& name, const AtomString& oldValue)
{
    notifyAttributeChanged(name, oldValue, nullAtom());
}

RefPtr<Attr> Element::attrIfExists(const QualifiedName& name)
{
    if (auto* attrNodeList = attrNodeListForElement(*this))
        return findAttrNodeInList(*attrNodeList, name);
    return nullptr;
}

Ref<Attr> Element::ensureAttr(const QualifiedName& name)
{
    auto& attrNodeList = ensureAttrNodeListForElement(*this);
    if (RefPtr attrNode = findAttrNodeInList(attrNodeList, name))
        return attrNode.releaseNonNull();

    Ref attrNode = Attr::create(*this, name);
    attrNode->setTreeScopeRecursively(protect(treeScope()));
    attrNodeList.append(attrNode);
    return attrNode;
}

void Element::detachAttrNodeFromElementWithValue(Attr* attrNode, const AtomString& value)
{
    ASSERT(hasSyntheticAttrChildNodes());
    attrNode->detachFromElementWithValue(value);

    auto& attrNodeList = *attrNodeListForElement(*this);
    bool found = attrNodeList.removeFirstMatching([attrNode](auto& attribute) {
        return attribute->qualifiedName() == attrNode->qualifiedName();
    });
    ASSERT_UNUSED(found, found);
    if (attrNodeList.isEmpty())
        removeAttrNodeListForElement(*this);
}

void Element::detachAllAttrNodesFromElement()
{
    auto* attrNodeList = attrNodeListForElement(*this);
    ASSERT(attrNodeList);

    for (auto& attribute : attributes()) {
        if (RefPtr<Attr> attrNode = findAttrNodeInList(*attrNodeList, attribute.name()))
            attrNode->detachFromElementWithValue(attribute.value());
    }

    removeAttrNodeListForElement(*this);
}

void Element::cloneAttributesFromElement(const Element& other)
{
    if (hasSyntheticAttrChildNodes())
        detachAllAttrNodesFromElement();

    other.synchronizeAllAttributes();
    if (!other.m_elementData) {
        m_elementData = nullptr;
        if (auto* inputElement = dynamicDowncast<HTMLInputElement>(*this)) {
            DelayedUpdateValidityScope delayedUpdateValidityScope(*inputElement);
            inputElement->initializeInputTypeAfterParsingOrCloning();
        }
        return;
    }

    // We can't update window and document's named item maps since the presence of image and object elements depend on other attributes and children.
    // Fortunately, those named item maps are only updated when this element is in the document, which should never be the case.
    ASSERT(!isConnected());

    const AtomString& oldID = getIdAttribute();
    const AtomString& newID = other.getIdAttribute();

    if (!oldID.isNull() || !newID.isNull())
        updateId(oldID, newID, NotifyObservers::No); // Will notify observers after the attribute is actually changed.

    const AtomString& oldName = getNameAttribute();
    const AtomString& newName = other.getNameAttribute();

    if (!oldName.isNull() || !newName.isNull())
        updateName(oldName, newName);

    // If 'other' has a mutable ElementData, convert it to an immutable one so we can share it between both elements.
    // We can only do this if there is no CSSOM wrapper for other's inline style.
    RefPtr uniqueElementData = dynamicDowncast<UniqueElementData>(*other.m_elementData);
    if (uniqueElementData
        && (!uniqueElementData->inlineStyle() || !uniqueElementData->inlineStyle()->hasCSSOMWrapper()))
        const_cast<Element&>(other).m_elementData = uniqueElementData->makeShareableCopy();

    bool canShareElementData = !other.m_elementData->isUnique()
        && (document().inQuirksMode() == other.document().inQuirksMode()); // Case folding in quirks mode documents can mutate element data.

    if (canShareElementData)
        m_elementData = other.m_elementData;
    else
        m_elementData = protect(other.m_elementData)->makeUniqueCopy();

    if (auto* inputElement = dynamicDowncast<HTMLInputElement>(*this)) {
        DelayedUpdateValidityScope delayedUpdateValidityScope(*inputElement);
        inputElement->initializeInputTypeAfterParsingOrCloning();
    }

    for (auto& attribute : attributes())
        notifyAttributeChanged(attribute.name(), nullAtom(), attribute.value(), AttributeModificationReason::ByCloning);

    setNonce(other.nonce());
}

void Element::cloneDataFromElement(const Element& other)
{
    cloneAttributesFromElement(other);
    copyNonAttributePropertiesFromElement(other);
#if ASSERT_ENABLED
    if (auto* input = dynamicDowncast<HTMLInputElement>(*this))
        ASSERT(!input->userAgentShadowRoot());
#endif
}

void Element::createUniqueElementData()
{
    if (!m_elementData)
        m_elementData = UniqueElementData::create();
    else
        m_elementData = protect(uncheckedDowncast<ShareableElementData>(*m_elementData))->makeUniqueCopy();
}

bool Element::canContainRangeEndPoint() const
{
    return !equalLettersIgnoringASCIICase(attributeWithoutSynchronization(roleAttr), "img"_s);
}

String Element::resolveURLStringIfNeeded(const String& urlString, ResolveURLs resolveURLs, const URL& base) const
{
    switch (resolveURLs) {
    case ResolveURLs::No:
    case ResolveURLs::NoExcludingURLsForPrivacy:
        return urlString;
    case ResolveURLs::Yes:
    case ResolveURLs::YesExcludingURLsForPrivacy:
        break;
    }
    URL completeURL = base.isNull() ? protect(document())->encodingParseURL(urlString) : URL(base, urlString);
    return completeURL.string();
}

String Element::completeURLsInAttributeValue(const URL& base, const Attribute& attribute, ResolveURLs resolveURLs) const
{
    return resolveURLStringIfNeeded(attribute.value(), resolveURLs, base);
}

ExceptionOr<Node*> Element::insertAdjacent(const String& where, Ref<Node>&& newChild)
{
    // In Internet Explorer if the element has no parent and where is "beforeBegin" or "afterEnd",
    // a document fragment is created and the elements appended in the correct order. This document
    // fragment isn't returned anywhere.
    //
    // This is impossible for us to implement as the DOM tree does not allow for such structures,
    // Opera also appears to disallow such usage.

    if (equalLettersIgnoringASCIICase(where, "beforebegin"_s)) {
        RefPtr parent = this->parentNode();
        if (!parent)
            return nullptr;
        auto result = parent->insertBefore(newChild, this);
        if (result.hasException())
            return result.releaseException();
        return newChild.ptr();
    }

    if (equalLettersIgnoringASCIICase(where, "afterbegin"_s)) {
        auto result = insertBefore(newChild, protect(firstChild()));
        if (result.hasException())
            return result.releaseException();
        return newChild.ptr();
    }

    if (equalLettersIgnoringASCIICase(where, "beforeend"_s)) {
        auto result = appendChild(newChild);
        if (result.hasException())
            return result.releaseException();
        return newChild.ptr();
    }

    if (equalLettersIgnoringASCIICase(where, "afterend"_s)) {
        RefPtr parent = this->parentNode();
        if (!parent)
            return nullptr;
        auto result = parent->insertBefore(newChild, protect(nextSibling()));
        if (result.hasException())
            return result.releaseException();
        return newChild.ptr();
    }

    return Exception { ExceptionCode::SyntaxError };
}

ExceptionOr<Element*> Element::insertAdjacentElement(const String& where, Element& newChild)
{
    auto result = insertAdjacent(where, newChild);
    if (result.hasException())
        return result.releaseException();
    return downcast<Element>(result.releaseReturnValue());
}

// Step 1 of https://w3c.github.io/DOM-Parsing/#dom-element-insertadjacenthtml.
static ExceptionOr<ContainerNode&> contextNodeForInsertion(const String& where, Element& element)
{
    if (equalLettersIgnoringASCIICase(where, "beforebegin"_s) || equalLettersIgnoringASCIICase(where, "afterend"_s)) {
        RefPtr parent = element.parentNode();
        if (!parent || is<Document>(*parent))
            return Exception { ExceptionCode::NoModificationAllowedError };
        return *parent;
    }
    if (equalLettersIgnoringASCIICase(where, "afterbegin"_s) || equalLettersIgnoringASCIICase(where, "beforeend"_s))
        return element;
    return Exception { ExceptionCode::SyntaxError };
}

// Step 2 of https://w3c.github.io/DOM-Parsing/#dom-element-insertadjacenthtml.
static ExceptionOr<Ref<Element>> contextElementForInsertion(const String& where, Element& element)
{
    auto contextNodeResult = contextNodeForInsertion(where, element);
    if (contextNodeResult.hasException())
        return contextNodeResult.releaseException();
    CheckedRef contextNode = contextNodeResult.releaseReturnValue();
    RefPtr contextElement = dynamicDowncast<Element>(contextNode.get());
    if (!contextElement || (contextNode->document().isHTMLDocument() && is<HTMLHtmlElement>(contextNode.get()))) {
        Ref bodyElement = HTMLBodyElement::create(protect(contextNode->document()));
        if (contextNode->usesNullCustomElementRegistry())
            bodyElement->setUsesNullCustomElementRegistry();
        return Ref<Element> { WTF::move(bodyElement) };
    }
    return contextElement.releaseNonNull();
}

// https://w3c.github.io/DOM-Parsing/#dom-element-insertadjacenthtml
ExceptionOr<void> Element::insertAdjacentHTML(const String& where, const String& markup, NodeVector* addedNodes)
{
    // Steps 1 and 2.
    auto contextElement = contextElementForInsertion(where, *this);
    if (contextElement.hasException())
        return contextElement.releaseException();
    // Step 3.
    RefPtr registry = CustomElementRegistry::registryForElement(contextElement.returnValue());
    auto registryKind = contextElement.returnValue()->usesNullCustomElementRegistry() ? CustomElementRegistryKind::Null : CustomElementRegistryKind::Window;
    auto fragment = createFragmentForInnerOuterHTML(contextElement.releaseReturnValue(), markup, { ParserContentPolicy::AllowScriptingContent }, registry.get(), registryKind);
    if (fragment.hasException())
        return fragment.releaseException();

    if (addedNodes) [[unlikely]] {
        // Must be called before insertAdjacent, as otherwise the children of fragment will be moved
        // to their new parent and will be harder to keep track of.
        collectChildNodes(fragment.returnValue(), *addedNodes);
    }

    // Step 4.
    auto result = insertAdjacent(where, fragment.releaseReturnValue());
    if (result.hasException())
        return result.releaseException();
    return { };
}

ExceptionOr<void> Element::insertAdjacentHTML(const String& where, String&& markup)
{
    return insertAdjacentHTML(where, WTF::move(markup), nullptr);
}

ExceptionOr<void> Element::insertAdjacentText(const String& where, String&& text)
{
    auto result = insertAdjacent(where, protect(document())->createTextNode(WTF::move(text)));
    if (result.hasException())
        return result.releaseException();
    return { };
}

void Element::ensureFormAssociatedCustomElement()
{
    auto& customElement = downcast<HTMLMaybeFormAssociatedCustomElement>(*this);
    auto& data = ensureElementRareData();
    if (!data.formAssociatedCustomElement())
        data.initializeFormAssociatedCustomElement(makeUniqueWithoutRefCountedCheck<FormAssociatedCustomElement>(customElement));
}

FormAssociatedCustomElement& Element::formAssociatedCustomElementUnsafe() const
{
    RELEASE_ASSERT(is<HTMLMaybeFormAssociatedCustomElement>(*this));
    ASSERT(hasRareData());
    auto* customElement = elementRareData()->formAssociatedCustomElement();
    ASSERT(customElement);
    return *customElement;
}

bool Element::hasDuplicateAttribute() const
{
    return hasEventTargetFlag(EventTargetFlag::HasDuplicateAttribute);
}

void Element::setHasDuplicateAttribute(bool hasDuplicateAttribute)
{
    setEventTargetFlag(EventTargetFlag::HasDuplicateAttribute, hasDuplicateAttribute);
}

bool Element::isPopoverShowing() const
{
    return popoverData() && popoverData()->visibilityState() == PopoverVisibilityState::Showing;
}

PopoverState Element::popoverState() const
{
    return popoverData() ? popoverData()->popoverState() : PopoverState::None;
}

AtomString Element::makeTargetBlankIfHasDanglingMarkup(const AtomString& target)
{
    if ((target.contains('\n') || target.contains('\r') || target.contains('\t')) && target.contains('<'))
        return "_blank"_s;
    return target;
}

bool Element::hasCustomState(const AtomString& state) const
{
    if (hasRareData()) {
        auto* customStates = elementRareData()->customStateSet();
        return customStates && customStates->has(state);
    }

    return false;
}

CustomStateSet& Element::ensureCustomStateSet()
{
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST auto& rareData = const_cast<Element*>(this)->ensureElementRareData();
    if (!rareData.customStateSet())
        rareData.initializeCustomStateSet(CustomStateSet::create());
    return *rareData.customStateSet();
}

// https://html.spec.whatwg.org/#topmost-popover-ancestor
// Consider both DOM ancestors and popovers where the given popover was invoked from as ancestors.
// Use top layer positions to disambiguate the topmost one when both exist.
RefPtr<HTMLElement> Element::topmostPopoverAncestor(TopLayerElementType topLayerType)
{
    // Hint popovers only participate in the popover stack when computing the ancestor for another
    // popover being shown. For dialog/fullscreen top-layer nesting, only auto popovers are
    // considered (matching the behavior before popover=hint).
    bool considerHints = topLayerType == TopLayerElementType::Popover;

    // Store positions to avoid having to do O(n) search for every popover invoker, ordered by
    // position in the top layer.
    HashMap<Ref<const Element>, size_t> topLayerPositions;
    size_t i = 0;
    for (auto& element : document().topLayerElements()) {
        if (RefPtr htmlElement = dynamicDowncast<HTMLElement>(element.get())) {
            if (htmlElement->popoverData() && htmlElement->popoverData()->visibilityState() == PopoverVisibilityState::Showing
                && (htmlElement->popoverState() == PopoverState::Auto || (considerHints && htmlElement->popoverState() == PopoverState::Hint)))
                topLayerPositions.add(element, i++);
        }
    }

    if (topLayerType == TopLayerElementType::Popover)
        topLayerPositions.add(*this, i);

    i++;

    RefPtr<HTMLElement> topmostAncestor;

    auto checkAncestor = [&](Element* candidate) {
        if (!candidate)
            return;

        // https://html.spec.whatwg.org/#nearest-inclusive-open-popover
        auto nearestInclusiveOpenPopover = [&](Element& candidate) -> HTMLElement* {
            for (Ref element : composedTreeLineage(candidate)) {
                if (auto* htmlElement = dynamicDowncast<HTMLElement>(element.get())) {
                    if ((htmlElement->popoverState() == PopoverState::Auto || (considerHints && htmlElement->popoverState() == PopoverState::Hint))
                        && htmlElement->popoverData()->visibilityState() == PopoverVisibilityState::Showing)
                        return htmlElement;
                }
            }
            return nullptr;
        };

        RefPtr candidateAncestor = nearestInclusiveOpenPopover(*candidate);
        if (!candidateAncestor)
            return;
        if (!topmostAncestor || topLayerPositions.get(*topmostAncestor) < topLayerPositions.get(*candidateAncestor))
            topmostAncestor = WTF::move(candidateAncestor);
    };

    checkAncestor(protect(parentElementInComposedTree()));

    if (topLayerType == TopLayerElementType::Popover)
        checkAncestor(protect(popoverData()->invoker()));

    return topmostAncestor;
}

void Element::setNumericAttribute(const QualifiedName& attributeName, double value)
{
    setAttributeWithoutSynchronization(attributeName, AtomString::number(value));
}

const AtomString& Element::ariaAtomic() const
{
    return getAttribute(aria_atomicAttr);
}

const AtomString& Element::ariaAutoComplete() const
{
    return getAttribute(aria_autocompleteAttr);
}

const AtomString& Element::ariaBusy() const
{
    return getAttribute(aria_busyAttr);
}

const AtomString& Element::ariaChecked() const
{
    return getAttribute(aria_checkedAttr);
}

const AtomString& Element::ariaCurrent() const
{
    return getAttribute(aria_currentAttr);
}

const AtomString& Element::ariaDisabled() const
{
    return getAttribute(aria_disabledAttr);
}

const AtomString& Element::ariaExpanded() const
{
    return getAttribute(aria_expandedAttr);
}

const AtomString& Element::ariaHasPopup() const
{
    return getAttribute(aria_haspopupAttr);
}

const AtomString& Element::ariaHidden() const
{
    return getAttribute(aria_hiddenAttr);
}

const AtomString& Element::ariaInvalid() const
{
    return getAttribute(aria_invalidAttr);
}

const AtomString& Element::ariaLive() const
{
    return getAttribute(aria_liveAttr);
}

const AtomString& Element::ariaModal() const
{
    return getAttribute(aria_modalAttr);
}

const AtomString& Element::ariaMultiLine() const
{
    return getAttribute(aria_multilineAttr);
}

const AtomString& Element::ariaMultiSelectable() const
{
    return getAttribute(aria_multiselectableAttr);
}

const AtomString& Element::ariaOrientation() const
{
    return getAttribute(aria_orientationAttr);
}

const AtomString& Element::ariaPressed() const
{
    return getAttribute(aria_pressedAttr);
}

const AtomString& Element::ariaReadOnly() const
{
    return getAttribute(aria_readonlyAttr);
}

const AtomString& Element::ariaRequired() const
{
    return getAttribute(aria_requiredAttr);
}

const AtomString& Element::ariaSelected() const
{
    return getAttribute(aria_selectedAttr);
}

const AtomString& Element::ariaSort() const
{
    return getAttribute(aria_sortAttr);
}

} // namespace WebCore

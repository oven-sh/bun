/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Peter Kelly (pmk@post.com)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2003-2026 Apple Inc. All rights reserved.
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

#include <JavaScriptCore/Forward.h>
#include "ContainerNode.h"
#include "EventOptions.h"
#include "FocusOptions.h"
#include "QualifiedName.h"
#include "SimulatedClickOptions.h"

#define DUMP_NODE_STATISTICS 0

namespace JSC {
class JSGlobalObject;
class JSValue;
}

namespace WebCore {

class Attr;
class Attribute;
class AttributeIteratorAccessor;
class CustomElementDefaultARIA;
class CustomElementReactionQueue;
class CustomStateSet;
class DatasetDOMStringMap;
class DOMRect;
class DOMRectList;
class DOMTokenList;
class Document;
class ElementData;
class ElementRareData;
class FormAssociatedCustomElement;
class FormListedElement;
class HTMLButtonElement;
class HTMLDocument;
class HTMLElement;
class JSCustomElementInterface;
class PopoverData;
class ShadowRoot;
class SpaceSplitString;
class Text;
class UniqueElementData;
class ValidatedFormListedElement;

#if ENABLE(ATTACHMENT_ELEMENT)
class AttachmentAssociatedElement;
#endif

enum class ParserContentPolicy : uint8_t;
enum class PopoverState : uint8_t { None, Auto, Manual, Hint };
enum class ResolveURLs : uint8_t { No, NoExcludingURLsForPrivacy, Yes, YesExcludingURLsForPrivacy };
enum class SelectionRestorationMode : uint8_t;
enum class ShadowRootDelegatesFocus : bool { No, Yes };
enum class ShadowRootMode : uint8_t;
enum class ShadowRootClonable : bool { No, Yes };
enum class ShadowRootSerializable : bool { No, Yes };
enum class SlotAssignmentMode : bool;

// https://github.com/whatwg/html/pull/9841
enum class CommandType: uint8_t {
    Invalid,

    Custom,

    TogglePopover,
    HidePopover,
    ShowPopover,

    ShowModal,
    Close,
    RequestClose,
};

struct FocusEventData;
struct GetHTMLOptions;
struct ScrollIntoViewOptions;
struct ScrollToOptions;
struct ShadowRootInit;

using ElementName = NodeName;
using ExplicitlySetAttrElementsMap = HashMap<QualifiedName, Vector<WeakPtr<Element, WeakPtrImplWithEventTargetData>>>;

class Element : public ContainerNode {
    WTF_MAKE_TZONE_ALLOCATED(Element);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(Element);
public:
    static Ref<Element> create(const QualifiedName&, Document&);
    WEBCORE_EXPORT virtual ~Element();

    WEBCORE_EXPORT bool hasAttribute(const QualifiedName&) const;
    WEBCORE_EXPORT bool hasAttribute(StaticQualifiedName) const;
    WEBCORE_EXPORT const AtomString& getAttribute(const QualifiedName&) const;
    WEBCORE_EXPORT const AtomString& getAttribute(StaticQualifiedName) const;
    AtomString getAttributeForBindings(const QualifiedName&, ResolveURLs = ResolveURLs::NoExcludingURLsForPrivacy) const;
    template<typename... QualifiedNames>
    inline const AtomString& getAttribute(const QualifiedName&, const QualifiedNames&...) const;
    WEBCORE_EXPORT void setAttribute(const QualifiedName&, const AtomString& value);
    void setAttributeWithoutOverwriting(const QualifiedName&, const AtomString& value);
    WEBCORE_EXPORT void setAttributeWithoutSynchronization(const QualifiedName&, const AtomString& value);
    void setSynchronizedLazyAttribute(const QualifiedName&, const AtomString& value);
    bool removeAttribute(const QualifiedName&);
    Vector<String> getAttributeNames() const;

    // Typed getters and setters for language bindings.
    WEBCORE_EXPORT int integralAttribute(const QualifiedName& attributeName) const;
    WEBCORE_EXPORT unsigned unsignedIntegralAttribute(const QualifiedName& attributeName) const;
    WEBCORE_EXPORT void setBooleanAttribute(const QualifiedName& attributeName, bool);
    WEBCORE_EXPORT void setIntegralAttribute(const QualifiedName& attributeName, int value);
    WEBCORE_EXPORT void setNumericAttribute(const QualifiedName& attributeName, double value);
    WEBCORE_EXPORT void setUnsignedIntegralAttribute(const QualifiedName& attributeName, unsigned value);
    WEBCORE_EXPORT RefPtr<Element> getElementAttributeForBindings(const QualifiedName& attributeName) const;
    WEBCORE_EXPORT void setElementAttribute(const QualifiedName& attributeName, Element* value);
    WEBCORE_EXPORT std::optional<Vector<Ref<Element>>> getElementsArrayAttributeForBindings(const QualifiedName& attributeName) const;
    WEBCORE_EXPORT void setElementsArrayAttribute(const QualifiedName& attributeName, std::optional<Vector<Ref<Element>>>&& value);
    static bool LEGACY_NODELETE isElementReflectionAttribute(const QualifiedName&);
    static bool LEGACY_NODELETE isElementsArrayReflectionAttribute(const QualifiedName&);

    // Call this to get the value of an attribute that is known not to be the style
    // attribute or one of the SVG animatable attributes.
    inline bool LEGACY_NODELETE hasAttributeWithoutSynchronization(const QualifiedName&) const;
    inline bool LEGACY_NODELETE hasAttributeWithoutSynchronization(StaticQualifiedName) const;
    inline const AtomString& attributeWithoutSynchronization(const QualifiedName&) const;
    inline const AtomString& attributeWithoutSynchronization(StaticQualifiedName) const;
    inline const AtomString& attributeWithDefaultARIA(const QualifiedName&) const;
    inline String attributeTrimmedWithDefaultARIA(const QualifiedName&) const;

    enum class TopLayerElementType : bool { Other, Popover };
    RefPtr<HTMLElement> topmostPopoverAncestor(TopLayerElementType topLayerType);

    // https://github.com/w3c/aria/pull/2484
    // These ARIA attributes will become enumerated. Currently, they use [ReflectSetter] with custom getters
    // rather than [Reflect, Enumerated] to facilitate testing behind the EnumeratedARIAAttributeReflectionEnabled flag.
    const AtomString& ariaAtomic() const;
    const AtomString& ariaAutoComplete() const;
    const AtomString& ariaBusy() const;
    const AtomString& ariaChecked() const;
    const AtomString& ariaCurrent() const;
    const AtomString& ariaDisabled() const;
    const AtomString& ariaExpanded() const;
    const AtomString& ariaHasPopup() const;
    const AtomString& ariaHidden() const;
    const AtomString& ariaInvalid() const;
    const AtomString& ariaLive() const;
    const AtomString& ariaModal() const;
    const AtomString& ariaMultiLine() const;
    const AtomString& ariaMultiSelectable() const;
    const AtomString& ariaOrientation() const;
    const AtomString& ariaPressed() const;
    const AtomString& ariaReadOnly() const;
    const AtomString& ariaRequired() const;
    const AtomString& ariaSelected() const;
    const AtomString& ariaSort() const;

#if DUMP_NODE_STATISTICS
    bool hasNamedNodeMap() const;
#endif

    WEBCORE_EXPORT bool hasAttributes() const;

    // This variant will not update the potentially invalid attributes. To be used when not interested
    // in style attribute or one of the SVG animation attributes.
    bool hasAttributesWithoutUpdate() const;

    WEBCORE_EXPORT bool hasAttribute(const AtomString& qualifiedName) const;
    WEBCORE_EXPORT bool hasAttributeNS(const AtomString& namespaceURI, const AtomString& localName) const;

    WEBCORE_EXPORT const AtomString& getAttribute(const AtomString& qualifiedName) const;
    WEBCORE_EXPORT const AtomString& getAttributeNS(const AtomString& namespaceURI, const AtomString& localName) const;
    AtomString getAttributeForBindings(const AtomString& qualifiedName, ResolveURLs = ResolveURLs::NoExcludingURLsForPrivacy) const;
    inline AtomString getAttributeNSForBindings(const AtomString& namespaceURI, const AtomString& localName, ResolveURLs = ResolveURLs::NoExcludingURLsForPrivacy) const;
    RefPtr<Element> elementForAttributeInternal(const QualifiedName& attributeName) const;
    std::optional<Vector<Ref<Element>>> elementsArrayForAttributeInternal(const QualifiedName& attributeName) const;

    WEBCORE_EXPORT ExceptionOr<void> setAttribute(const AtomString& qualifiedName, const AtomString& value);
    WEBCORE_EXPORT ExceptionOr<void> setAttributeNS(const AtomString& namespaceURI, const AtomString& qualifiedName, const AtomString& value);

    ExceptionOr<bool> toggleAttribute(const AtomString& qualifiedName, std::optional<bool> force);

    inline const AtomString& getIdAttribute() const;
    inline void setIdAttribute(const AtomString&);

    inline const AtomString& getNameAttribute() const;

    // Call this to get the value of the id attribute for style resolution purposes.
    // The value will already be lowercased if the document is in compatibility mode,
    // so this function is not suitable for non-style uses.
    inline const AtomString& idForStyleResolution() const;

    // Internal methods that assume the existence of attribute storage, one should use hasAttributes()
    // before calling them.
    inline std::span<const Attribute> LEGACY_NODELETE attributes() const;
    inline unsigned LEGACY_NODELETE attributeCount() const;
    inline const Attribute& LEGACY_NODELETE attributeAt(unsigned index) const;
    inline const Attribute* LEGACY_NODELETE findAttributeByName(const QualifiedName&) const;
    inline const Attribute* LEGACY_NODELETE findAttributeByName(StaticQualifiedName) const;
    inline unsigned LEGACY_NODELETE findAttributeIndexByName(const QualifiedName&) const;
    inline unsigned LEGACY_NODELETE findAttributeIndexByName(StaticQualifiedName) const;
    inline unsigned LEGACY_NODELETE findAttributeIndexByName(const AtomString&, bool shouldIgnoreAttributeCase) const;

    WEBCORE_EXPORT void scrollIntoView(Variant<bool, ScrollIntoViewOptions>&&);
    WEBCORE_EXPORT void scrollIntoView(bool alignToTop = true);
    WEBCORE_EXPORT void scrollIntoViewIfNeeded(bool centerIfNeeded = true);

    void scrollBy(const ScrollToOptions&);
    void scrollBy(double x, double y);
    virtual void scrollTo(const ScrollToOptions&);
    void scrollTo(double x, double y);

    WEBCORE_EXPORT int offsetLeftForBindings();
    WEBCORE_EXPORT int offsetTopForBindings();
    WEBCORE_EXPORT int offsetWidth();
    WEBCORE_EXPORT int offsetHeight();

    WEBCORE_EXPORT RefPtr<Element> offsetParentForBindings();

    inline const Element* rootElement() const;

    WEBCORE_EXPORT int clientLeft();
    WEBCORE_EXPORT int clientTop();
    WEBCORE_EXPORT int clientWidth();
    WEBCORE_EXPORT int clientHeight();
    double currentCSSZoom();

    virtual int scrollLeft();
    virtual int scrollTop();
    virtual void setScrollLeft(int);
    virtual void setScrollTop(int);
    virtual int scrollWidth();
    virtual int scrollHeight();

    WEBCORE_EXPORT Ref<DOMRectList> getClientRects();
    Ref<DOMRect> getBoundingClientRect();

    WEBCORE_EXPORT bool removeAttribute(const AtomString& qualifiedName);
    WEBCORE_EXPORT bool removeAttributeNS(const AtomString& namespaceURI, const AtomString& localName);
    void removeAttributeForBindings(const AtomString& qualifiedName) { removeAttribute(qualifiedName); }
    void removeAttributeNSForBindings(const AtomString& namespaceURI, const AtomString& localName) { removeAttributeNS(namespaceURI, localName); }

    Ref<Attr> detachAttribute(unsigned index);

    WEBCORE_EXPORT RefPtr<Attr> getAttributeNode(const AtomString& qualifiedName);
    WEBCORE_EXPORT RefPtr<Attr> getAttributeNodeNS(const AtomString& namespaceURI, const AtomString& localName);
    WEBCORE_EXPORT ExceptionOr<RefPtr<Attr>> setAttributeNode(Attr&);
    WEBCORE_EXPORT ExceptionOr<RefPtr<Attr>> setAttributeNodeNS(Attr&);
    WEBCORE_EXPORT ExceptionOr<Ref<Attr>> removeAttributeNode(Attr&);

    RefPtr<Attr> LEGACY_NODELETE attrIfExists(const QualifiedName&);
    Ref<Attr> ensureAttr(const QualifiedName&);

    const Vector<Ref<Attr>>& LEGACY_NODELETE attrNodeList();

    const QualifiedName& tagQName() const LIFETIME_BOUND { return m_tagName; }
#if ENABLE(JIT)
    static constexpr ptrdiff_t tagQNameMemoryOffset() { return OBJECT_OFFSETOF(Element, m_tagName); }
#endif
    String tagName() const { return nodeName(); }
    bool hasTagName(const QualifiedName& tagName) const { return m_tagName.matches(tagName); }
    bool hasTagName(StaticQualifiedName tagName) const { return m_tagName.matches(tagName); }
    bool hasTagName(const HTMLQualifiedName& tagName) const { return ContainerNode::hasTagName(tagName); }

    bool hasLocalName(const AtomString& other) const { return m_tagName.localName() == other; }

    const AtomString& LEGACY_NODELETE localName() const LIFETIME_BOUND final { return m_tagName.localName(); }
    const AtomString& LEGACY_NODELETE prefix() const LIFETIME_BOUND final { return m_tagName.prefix(); }
    const AtomString& LEGACY_NODELETE namespaceURI() const LIFETIME_BOUND final { return m_tagName.namespaceURI(); }

    const AtomString& localNameLowercase() const LIFETIME_BOUND { return m_tagName.localNameLowercase(); }

    ElementName elementName() const { return m_tagName.nodeName(); }
    Namespace nodeNamespace() const { return m_tagName.nodeNamespace(); }

    void setPrefixForCustomElementUpgrade(const AtomString&);

    String nodeName() const override;

    Ref<Element> cloneElementWithChildren(Document&, CustomElementRegistry*) const;
    Ref<Element> cloneElementWithoutChildren(Document&, CustomElementRegistry*) const;

    void normalizeAttributes();

    // For exposing to DOM only.
    WEBCORE_EXPORT NamedNodeMap& attributesMap() const;

    enum class AttributeModificationReason : uint8_t { Directly, ByCloning, Parser, ParserFastPath };
    // This function is called whenever an attribute is added, changed or removed.
    // Do not call this function directly. notifyAttributeChanged() should be used instead
    // in order to update state dependent on attribute changes.
    virtual void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason = AttributeModificationReason::Directly);

    // Only called by the parser immediately after element construction.
    void parserSetAttributes(std::span<const Attribute>, AttributeModificationReason = AttributeModificationReason::Parser);

    bool isEventHandlerAttribute(const Attribute&) const;
    virtual FormListedElement* LEGACY_NODELETE asFormListedElement();
    virtual ValidatedFormListedElement* LEGACY_NODELETE asValidatedFormListedElement();
    virtual bool attributeContainsJavaScriptURL(const Attribute&) const;

#if ENABLE(ATTACHMENT_ELEMENT)
    virtual AttachmentAssociatedElement* LEGACY_NODELETE asAttachmentAssociatedElement();
#endif

    // Remove attributes that might introduce scripting from the vector leaving the element unchanged.
    void stripScriptingAttributes(Vector<Attribute>&) const;

    const ElementData* elementData() const { return m_elementData.get(); }
    static constexpr ptrdiff_t elementDataMemoryOffset() { return OBJECT_OFFSETOF(Element, m_elementData); }
    inline UniqueElementData& ensureUniqueElementData();

    void synchronizeAllAttributes() const;

    // Clones attributes only.
    void cloneAttributesFromElement(const Element&);

    // Clones all attribute-derived data, including subclass specifics (through copyNonAttributeProperties.)
    void cloneDataFromElement(const Element&);

    virtual void didMoveToNewDocument(Document& oldDocument, Document& newDocument);

    bool hasEquivalentAttributes(const Element& other) const;

    virtual void copyNonAttributePropertiesFromElement(const Element&) { }

    virtual bool isReplaced() const { return false; }

    inline ShadowRoot* shadowRoot() const;
    RefPtr<ShadowRoot> shadowRootForBindings(JSC::JSGlobalObject&) const;
    RefPtr<Element> resolveReferenceTarget() const;
    RefPtr<Element> retargetReferenceTargetForBindings(RefPtr<Element>) const;

    enum class CustomElementRegistryKind : bool { Window, Null };

    WEBCORE_EXPORT ExceptionOr<ShadowRoot&> attachShadow(const ShadowRootInit&, std::optional<CustomElementRegistryKind> = std::nullopt);
    ExceptionOr<ShadowRoot&> attachDeclarativeShadow(ShadowRootMode, ShadowRootDelegatesFocus, ShadowRootClonable, ShadowRootSerializable, SlotAssignmentMode, CustomElementRegistryKind);

    WEBCORE_EXPORT ShadowRoot* LEGACY_NODELETE userAgentShadowRoot() const;
    WEBCORE_EXPORT ShadowRoot& ensureUserAgentShadowRoot();
    WEBCORE_EXPORT ShadowRoot& createUserAgentShadowRoot();

    void setIsDefinedCustomElement(JSCustomElementInterface&);
    void setIsFailedCustomElement();
    void setIsFailedOrPrecustomizedCustomElementWithoutClearingReactionQueue();
    void clearReactionQueueFromFailedCustomElement();
    void setIsCustomElementUpgradeCandidate();
    void enqueueToUpgrade(JSCustomElementInterface&);
    CustomElementReactionQueue* LEGACY_NODELETE reactionQueue() const;
    CustomElementRegistry* customElementRegistry() const;
    CustomElementRegistry* LEGACY_NODELETE scopedCustomElementRegistry() const;
    void setScopedCustomElementRegistry(RefPtr<CustomElementRegistry>&&);

    CustomElementDefaultARIA& customElementDefaultARIA();
    CustomElementDefaultARIA* LEGACY_NODELETE customElementDefaultARIAIfExists() const;

    inline bool isInActiveChain() const;
    inline bool active() const;
    inline bool hovered() const;
    inline bool focused() const;
    inline bool hasFocusVisible() const;
    inline bool hasFocusWithin() const;

    virtual void setActive(bool = true);
    virtual void setHovered(bool = true);
    virtual void setFocus(bool, FocusVisibility = FocusVisibility::Invisible);
    void setHasFocusVisible(bool);
    void setHasFocusWithin(bool);
    void setHasTentativeFocus(bool);

    std::optional<int> LEGACY_NODELETE tabIndexSetExplicitly() const;
    bool shouldBeIgnoredInSequentialFocusNavigation() const { return defaultTabIndex() < 0 && !supportsFocus(); }
    virtual bool supportsFocus() const;
    virtual bool isFocusable() const;
    virtual bool isKeyboardFocusable(const FocusEventData&) const;
    virtual bool isMouseFocusable() const;

    WEBCORE_EXPORT int tabIndexForBindings() const;
    WEBCORE_EXPORT void setTabIndexForBindings(int);

    // Used by the HTMLElement and SVGElement IDLs.
    WEBCORE_EXPORT const AtomString& nonce() const;
    WEBCORE_EXPORT void setNonce(const AtomString&);

    ExceptionOr<void> insertAdjacentHTML(const String& where, const String& html, NodeVector* addedNodes);

    WEBCORE_EXPORT ExceptionOr<Element*> insertAdjacentElement(const String& where, Element& newChild);
    WEBCORE_EXPORT ExceptionOr<void> insertAdjacentHTML(const String& where, String&&);
    WEBCORE_EXPORT ExceptionOr<void> insertAdjacentText(const String& where, String&& text);

    const AtomString& effectiveLang() const;
    const AtomString& langFromAttribute() const;
    bool effectiveLangKnownToMatchDocumentElement() const { return hasStateFlag(StateFlag::EffectiveLangKnownToMatchDocumentElement); }

    void updateEffectiveLangStateAndPropagateToDescendants();

    virtual bool accessKeyAction(bool /*sendToAnyEvent*/) { return false; }

    virtual bool LEGACY_NODELETE isURLAttribute(const Attribute&) const { return false; }
    virtual bool LEGACY_NODELETE attributeContainsURL(const Attribute& attribute) const { return isURLAttribute(attribute); }
    String resolveURLStringIfNeeded(const String& urlString, ResolveURLs = ResolveURLs::YesExcludingURLsForPrivacy, const URL& base = URL()) const;
    virtual String completeURLsInAttributeValue(const URL& base, const Attribute&, ResolveURLs = ResolveURLs::YesExcludingURLsForPrivacy) const;
    virtual bool LEGACY_NODELETE isHTMLContentAttribute(const Attribute&) const { return false; }

    WEBCORE_EXPORT URL getURLAttribute(const QualifiedName&) const;
    inline URL getURLAttributeForBindings(const QualifiedName&) const;
    URL getNonEmptyURLAttribute(const QualifiedName&) const;

    virtual AtomString target() const { return nullAtom(); }

    static RefPtr<Element> findFocusDelegateForTarget(ContainerNode&, FocusTrigger);
    RefPtr<Element> findFocusDelegate(FocusTrigger = FocusTrigger::Other);
    RefPtr<Element> findAutofocusDelegate(FocusTrigger = FocusTrigger::Other);

    virtual void focus(const FocusOptions& = { });
    virtual void focusForBindings(FocusOptions&&);
    void findTargetAndUpdateFocusAppearance(SelectionRestorationMode);
    virtual RefPtr<Element> focusAppearanceUpdateTarget();
    virtual void updateFocusAppearance(SelectionRestorationMode);
    virtual void blur();
    virtual void runFocusingStepsForAutofocus();

    ExceptionOr<void> setHTMLUnsafe(String&&);
    String getHTML(GetHTMLOptions&&) const;

    WEBCORE_EXPORT String innerHTML() const;
    WEBCORE_EXPORT String outerHTML() const;
    WEBCORE_EXPORT ExceptionOr<void> setInnerHTML(String&&);
    WEBCORE_EXPORT ExceptionOr<void> setOuterHTML(String&&);
    WEBCORE_EXPORT String innerText();
    WEBCORE_EXPORT String outerText();

    virtual String title() const;

    WEBCORE_EXPORT const AtomString& LEGACY_NODELETE userAgentPart() const;
    WEBCORE_EXPORT void setUserAgentPart(const AtomString&);

    bool isFinishedParsingChildren() const { return isParsingChildrenFinished(); }
    // Overriding these functions to make parsing a special case should be avoided if possible
    // as that could lead to elements responding differently to the parser vs. other kinds of DOM mutations.
    void beginParsingChildren() { clearIsParsingChildrenFinished(); }
    virtual void finishParsingChildren();

    virtual bool matchesValidPseudoClass() const;
    virtual bool matchesInvalidPseudoClass() const;
    virtual bool matchesUserValidPseudoClass() const;
    virtual bool matchesUserInvalidPseudoClass() const;
    virtual bool matchesReadWritePseudoClass() const;
    virtual bool matchesIndeterminatePseudoClass() const;
    virtual bool matchesDefaultPseudoClass() const;
    WEBCORE_EXPORT ExceptionOr<bool> matches(const String& selectors);
    WEBCORE_EXPORT ExceptionOr<RefPtr<Element>> closest(const String& selectors);

    WEBCORE_EXPORT DOMTokenList& classList();

    SpaceSplitString LEGACY_NODELETE partNames() const;
    DOMTokenList& part();

    DatasetDOMStringMap& dataset();

    virtual bool LEGACY_NODELETE isFormListedElement() const { return false; }
    virtual bool LEGACY_NODELETE isValidatedFormListedElement() const { return false; }
    virtual bool LEGACY_NODELETE isMaybeFormAssociatedCustomElement() const { return false; }
    virtual bool LEGACY_NODELETE isSpinButtonElement() const { return false; }
    virtual bool LEGACY_NODELETE isTextFormControlElement() const { return false; }
    virtual bool LEGACY_NODELETE isTextField() const { return false; }
    virtual bool LEGACY_NODELETE isTextPlaceholderElement() const { return false; }
    virtual bool LEGACY_NODELETE isOptionalFormControl() const { return false; }
    virtual bool LEGACY_NODELETE isRequiredFormControl() const { return false; }
    virtual bool LEGACY_NODELETE isSliderContainerElement() const { return false; }
    virtual bool LEGACY_NODELETE isSliderThumbElement() const { return false; }
    virtual bool LEGACY_NODELETE isHTMLTablePartElement() const { return false; }

    virtual bool isInRange() const { return false; }
    virtual bool isOutOfRange() const { return false; }

    bool canContainRangeEndPoint() const override;

    // Used for disabled form elements; if true, prevents mouse events from being dispatched
    // to event listeners, and prevents DOMActivate events from being sent at all.
    virtual bool isDisabledFormControl() const { return false; }

    bool isLink() const { return hasStateFlag(StateFlag::IsLink); }
    void setIsLink(bool flag);

    bool isInTopLayer() const { return hasEventTargetFlag(EventTargetFlag::IsInTopLayer); }
    void addToTopLayer();
    void removeFromTopLayer();

    PopoverData* LEGACY_NODELETE popoverData() const LIFETIME_BOUND;
    PopoverData& ensurePopoverData() LIFETIME_BOUND;
    void clearPopoverData();
    bool LEGACY_NODELETE isPopoverShowing() const;
    PopoverState LEGACY_NODELETE popoverState() const;

    Element* LEGACY_NODELETE invokedPopover() const;
    void setInvokedPopover(RefPtr<Element>&&);

    virtual bool isValidCommandType(const CommandType) { return false; }
    virtual bool handleCommandInternal(HTMLButtonElement&, const CommandType&) { return false; }

    ExceptionOr<void> setPointerCapture(int32_t);
    ExceptionOr<void> releasePointerCapture(int32_t);
    bool hasPointerCapture(int32_t);

    bool isSpellCheckingEnabled() const;
    bool computedWritingSuggestionsValue() const;

    inline bool hasID() const;
    inline bool hasClass() const;
    inline bool hasName() const;
    inline const SpaceSplitString& classNames() const;
    inline bool hasClassName(const AtomString& className) const;
    inline bool hasClassNamePrefix(StringView prefix) const;

    bool dispatchSimulatedClick(Event* underlyingEvent, SimulatedClickMouseEventOptions = SendNoEvents, SimulatedClickVisualOptions = ShowPressedLook);

    // FIXME: Consider changing signature to accept Element* because all callers perform copyRef().
    void dispatchFocusInEventIfNeeded(RefPtr<Element>&& oldFocusedElement);
    void dispatchFocusOutEventIfNeeded(RefPtr<Element>&& newFocusedElement);
    virtual void dispatchFocusEvent(RefPtr<Element>&& oldFocusedElement, const FocusOptions&);
    virtual void dispatchBlurEvent(RefPtr<Element>&& newFocusedElement);

    using ContainerNode::setAttributeEventListener;
    void setAttributeEventListener(const AtomString& eventType, const QualifiedName& attributeName, const AtomString& value);

    String description() const override;
    String debugDescription() const override;
    String attributesForDescription() const;

    bool LEGACY_NODELETE hasDuplicateAttribute() const;
    void LEGACY_NODELETE setHasDuplicateAttribute(bool);

    virtual void updateUserAgentShadowTree() { }

    ExplicitlySetAttrElementsMap& explicitlySetAttrElementsMap() LIFETIME_BOUND;
    ExplicitlySetAttrElementsMap* LEGACY_NODELETE explicitlySetAttrElementsMapIfExists() const LIFETIME_BOUND;

    bool hasCustomState(const AtomString& state) const;
    CustomStateSet& ensureCustomStateSet();

    bool hasValidTextDirectionState() const;
    bool hasAutoTextDirectionState() const;

    void updateEffectiveTextDirection();
    void updateEffectiveTextDirectionIfNeeded();

    void addShadowRoot(Ref<ShadowRoot>&&);

protected:
    Element(const QualifiedName&, Document&, OptionSet<TypeFlag>);

    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) override;
    void removingSteps(RemovalType, ContainerNode&) override;
    void movingSteps(MovingType, ContainerNode&) override;
    void childrenChanged(const ChildChange&) override;
    void removeAllEventListeners() override;

    void setTabIndexExplicitly(std::optional<int>);

    void classAttributeChanged(const AtomString& newClassString, AttributeModificationReason);
    void partAttributeChanged(const AtomString& newValue);

    ExceptionOr<void> replaceChildrenWithMarkup(const String&, OptionSet<ParserContentPolicy>);

    static ExceptionOr<void> mergeWithNextTextNode(Text&);

    FormAssociatedCustomElement& LEGACY_NODELETE formAssociatedCustomElementUnsafe() const;
    void ensureFormAssociatedCustomElement();

    static AtomString makeTargetBlankIfHasDanglingMarkup(const AtomString& target);

private:
    Element(ClangVTableWorkaroundTag, const QualifiedName&, Document&);

    bool LEGACY_NODELETE isUserActionElementInActiveChain() const;
    bool LEGACY_NODELETE isUserActionElementActive() const;
    bool LEGACY_NODELETE isUserActionElementFocused() const;
    bool LEGACY_NODELETE isUserActionElementHovered() const;
    bool LEGACY_NODELETE isUserActionElementHasFocusVisible() const;
    bool LEGACY_NODELETE isUserActionElementHasFocusWithin() const;

    bool isNonceable() const;

    virtual void didAddUserAgentShadowRoot(ShadowRoot&) { }

    void didAddAttribute(const QualifiedName&, const AtomString&);
    void willModifyAttribute(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue);
    void didModifyAttribute(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue);
    void didRemoveAttribute(const QualifiedName&, const AtomString& oldValue);

    void synchronizeAttribute(const QualifiedName&) const;
    void synchronizeAttribute(StaticQualifiedName) const;
    void synchronizeAttribute(const AtomString& localName) const;

    inline const Attribute* getAttributeInternal(const QualifiedName&) const;
    inline const Attribute* getAttributeInternal(StaticQualifiedName) const;
    inline const Attribute* getAttributeInternal(const AtomString& qualifiedName) const;

    void updateName(const AtomString& oldName, const AtomString& newName);
    void updateNameForTreeScope(TreeScope&, const AtomString& oldName, const AtomString& newName);
    void updateNameForDocument(HTMLDocument&, const AtomString& oldName, const AtomString& newName);

    enum class NotifyObservers : bool { No, Yes };
    void updateId(const AtomString& oldId, const AtomString& newId, NotifyObservers = NotifyObservers::Yes);
    void updateIdForTreeScope(TreeScope&, const AtomString& oldId, const AtomString& newId, NotifyObservers = NotifyObservers::Yes);

    enum class HTMLDocumentNamedItemMapsUpdatingCondition : bool { Always, UpdateOnlyIfDiffersFromNameAttribute };
    void updateIdForDocument(HTMLDocument&, const AtomString& oldId, const AtomString& newId, HTMLDocumentNamedItemMapsUpdatingCondition);

    void addToIdAndNameMaps(TreeScope&, HTMLDocument*);
    void removeFromIdAndNameMaps(TreeScope&, HTMLDocument*);

    ExceptionOr<Node*> insertAdjacent(const String& where, Ref<Node>&& newChild);

    bool LEGACY_NODELETE childTypeAllowed(NodeType) const final;

    void notifyAttributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason = AttributeModificationReason::Directly);
    void parserNotifyAttributeAdded(const QualifiedName&, const AtomString& value, AttributeModificationReason = AttributeModificationReason::Directly);
    void notifyAttributeChangedCommon(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason);
    enum class InSynchronizationOfLazyAttribute : bool { No, Yes };
    void setAttributeInternal(unsigned index, const QualifiedName&, const AtomString& value, InSynchronizationOfLazyAttribute);
    void addAttributeInternal(const QualifiedName&, const AtomString& value, InSynchronizationOfLazyAttribute);
    void removeAttributeInternal(unsigned index, InSynchronizationOfLazyAttribute);

    // The cloneNode function is private so that non-virtual cloneElementWith/WithoutChildren are used instead.
    Ref<Node> cloneNodeInternal(Document&, CloningOperation, CustomElementRegistry*) const override;
    void cloneShadowTreeIfPossible(Element& newHost) const;
    virtual Ref<Element> cloneElementWithoutAttributesAndChildren(Document&, CustomElementRegistry*) const;

    inline void removeShadowRoot();
    void removeShadowRootSlow(ShadowRoot&);

    void createUniqueElementData();

    inline ElementRareData* elementRareData() const LIFETIME_BOUND;
    ElementRareData& ensureElementRareData() LIFETIME_BOUND;

    virtual int defaultTabIndex() const;

    static Vector<Ref<Attr>>* LEGACY_NODELETE attrNodeListForElement(Element&);
    static Vector<Ref<Attr>>& ensureAttrNodeListForElement(Element&);
    static void removeAttrNodeListForElement(Element&);
    void detachAllAttrNodesFromElement();
    void detachAttrNodeFromElementWithValue(Attr*, const AtomString& value);

    // Anyone thinking of using this should call document instead of ownerDocument.
    void ownerDocument() const = delete;

    void attachAttributeNodeIfNeeded(Attr&);

#if ASSERT_ENABLED
    WEBCORE_EXPORT bool fastAttributeLookupAllowed(const QualifiedName&) const;
    WEBCORE_EXPORT bool fastAttributeLookupAllowed(StaticQualifiedName) const;
#endif

    void dirAttributeChanged(const AtomString& newValue);

    bool LEGACY_NODELETE hasEffectiveLangState() const;
    void updateEffectiveLangState();
    void updateEffectiveLangStateFromParent();
    void setEffectiveLangStateOnOldDocumentElement();
    void clearEffectiveLangStateOnNewDocumentElement();

    bool hasLangAttr() const { return hasEventTargetFlag(EventTargetFlag::HasLangAttr); }
    void setHasLangAttr(bool has) { setEventTargetFlag(EventTargetFlag::HasLangAttr, has); }

    bool hasXMLLangAttr() const { return hasEventTargetFlag(EventTargetFlag::HasXMLLangAttr); }
    void setHasXMLLangAttr(bool has) { setEventTargetFlag(EventTargetFlag::HasXMLLangAttr, has); }

    void setEffectiveLangKnownToMatchDocumentElement(bool matches) { setStateFlag(StateFlag::EffectiveLangKnownToMatchDocumentElement, matches); }

    bool hasLanguageAttribute() const { return hasLangAttr() || hasXMLLangAttr(); }
    bool hasLangAttrKnownToMatchDocumentElement() const { return hasLanguageAttribute() && effectiveLangKnownToMatchDocumentElement(); }

    void parentOrShadowHostNode() const = delete; // Call parentNode() instead.

    QualifiedName m_tagName;
    RefPtr<ElementData> m_elementData;
    RefPtr<ShadowRoot> m_shadowRoot;
};

inline ShadowRoot* Node::shadowRoot() const
{
    return is<Element>(*this) ? uncheckedDowncast<Element>(*this).shadowRoot() : nullptr;
}

inline ShadowRoot* Element::shadowRoot() const
{
    return m_shadowRoot.get();
}

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::Element)
    static bool isType(const WebCore::Node& node) { return node.isElementNode(); }
    static bool isType(const WebCore::EventTarget& target)
    {
        auto* node = dynamicDowncast<WebCore::Node>(target);
        return node && isType(*node);
    }
SPECIALIZE_TYPE_TRAITS_END()

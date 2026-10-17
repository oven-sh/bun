/*
 * Copyright (C) 2010 Google, Inc. All rights reserved.
 * Copyright (C) 2011-2025 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY GOOGLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL GOOGLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "HTMLConstructionSite.h"

#include "Comment.h"
#include "ContainerNodeInlines.h"
#include "CustomElementRegistry.h"
#include "Document.h"
#include "DocumentFragment.h"
#include "DocumentType.h"
#include "FormAssociatedElement.h"
#include "HTMLElementFactory.h"
#include "HTMLFormElement.h"
#include "HTMLHtmlElement.h"
#include "HTMLMaybeFormAssociatedCustomElement.h"
#include "HTMLParserIdioms.h"
#include "HTMLScriptElement.h"
#include "HTMLTemplateElement.h"
#include "HTMLTreeBuilder.h"
#include "HTMLUnknownElement.h"
#include "JSCustomElementInterface.h"
#include "NodeName.h"
#include "ShadowRoot.h"
#include "ShadowRootMode.h"
#include "SlotAssignmentMode.h"
#include "Text.h"
#if __has_include(<unicode/ubrk.h>)
#include <unicode/ubrk.h>
#else
// macOS: libicucore has these, under these names, and the SDK has no header for them.
#include <unicode/utypes.h>
extern "C" {
typedef struct UBreakIterator UBreakIterator;
typedef enum { UBRK_CHARACTER = 0 } UBreakIteratorType;
UBreakIterator* ubrk_open(UBreakIteratorType type, const char* locale, const UChar* text, int32_t textLength, UErrorCode* status);
void ubrk_close(UBreakIterator* bi);
UBool ubrk_isBoundary(UBreakIterator* bi, int32_t offset);
int32_t ubrk_preceding(UBreakIterator* bi, int32_t offset);
}
#endif

namespace WebCore {

using namespace ElementNames;
using namespace HTMLNames;

enum class HasDuplicateAttribute : bool { No, Yes };
static inline void setAttributes(Element& element, Vector<Attribute>& attributes, HasDuplicateAttribute hasDuplicateAttribute, OptionSet<ParserContentPolicy> parserContentPolicy)
{
    if (!scriptingContentIsAllowed(parserContentPolicy))
        element.stripScriptingAttributes(attributes);
    element.parserSetAttributes(attributes.span());
    element.setHasDuplicateAttribute(hasDuplicateAttribute == HasDuplicateAttribute::Yes);
}

static inline void setAttributes(Element& element, AtomHTMLToken& token, OptionSet<ParserContentPolicy> parserContentPolicy)
{
    setAttributes(element, token.attributes(), token.hasDuplicateAttribute() ? HasDuplicateAttribute::Yes : HasDuplicateAttribute::No, parserContentPolicy);
}

static bool LEGACY_NODELETE hasImpliedEndTag(const HTMLStackItem& item)
{
    switch (item.elementName()) {
    case HTML::dd:
    case HTML::dt:
    case HTML::li:
    case HTML::option:
    case HTML::optgroup:
    case HTML::p:
    case HTML::rb:
    case HTML::rp:
    case HTML::rt:
    case HTML::rtc:
        return true;
    default:
        return false;
    }
}

static bool LEGACY_NODELETE shouldUseLengthLimit(const ContainerNode& node)
{
    auto* element = dynamicDowncast<Element>(node);
    if (!element)
        return true;

    switch (element->elementName()) {
    case HTML::script:
    case HTML::style:
    case SVG::script:
        return false;
    default:
        return true;
    }
}

static inline bool LEGACY_NODELETE causesFosterParenting(const HTMLStackItem& item)
{
    switch (item.elementName()) {
    case HTML::table:
    case HTML::tbody:
    case HTML::tfoot:
    case HTML::thead:
    case HTML::tr:
        return true;
    default:
        return false;
    }
}

// Resolves the DOM-derived part of the foster site recorded by recordFosterSite(): script can move
// or remove the table before the task runs.
static inline void resolveFosterSite(HTMLConstructionSiteTask& task)
{
    if (!task.nextChild) [[likely]]
        return;

    if (RefPtr referenceParent = task.nextChild->parentNode())
        task.parent = WTF::move(referenceParent);
    else
        task.nextChild = nullptr;
}

static inline void insert(HTMLConstructionSiteTask& task)
{
    resolveFosterSite(task);

    if (RefPtr templateElement = dynamicDowncast<HTMLTemplateElement>(task.parent)) [[unlikely]] {
        task.parent = templateElement->fragmentForInsertion();
        task.nextChild = nullptr;
    } else if (RefPtr document = dynamicDowncast<Document>(task.parent)) [[unlikely]] {
        if (!document->canAcceptChild(*task.child, task.nextChild, AcceptChildOperation::InsertOrAdd))
            return;
    }

    Ref child = *task.child;
    Ref parent = *task.parent;

    if (containsIncludingHostElements(child, parent)) [[unlikely]]
        return;

    ASSERT(!child->parentNode());
    if (task.nextChild)
        parent->parserInsertBefore(child, protect(*task.nextChild));
    else
        parent->parserAppendChild(child);
}

static inline void executeInsertTask(HTMLConstructionSiteTask& task)
{
    ASSERT(task.operation == HTMLConstructionSiteTask::Insert);

    insert(task);

    RefPtr element = dynamicDowncast<Element>(task.child);
    if (!element)
        return;

    element->beginParsingChildren();
    if (task.selfClosing)
        element->finishParsingChildren();
}

static inline void executeReparentTask(HTMLConstructionSiteTask& task)
{
    ASSERT(task.operation == HTMLConstructionSiteTask::Reparent);
    ASSERT(!task.nextChild);

    if (RefPtr parent = task.child->parentNode())
        parent->parserRemoveChild(protect(*task.child));

    if (task.child->parentNode() || task.child->contains(task.parent.get()))
        return;

    protect(task.parent)->parserAppendChild(protect(*task.child));
}

static inline void executeInsertAlreadyParsedChildTask(HTMLConstructionSiteTask& task)
{
    ASSERT(task.operation == HTMLConstructionSiteTask::InsertAlreadyParsedChild);

    Ref child = *task.child;
    if (RefPtr parent = child->parentNode())
        parent->parserRemoveChild(child);

    if (child->parentNode())
        return;

    insert(task);
}

static inline void executeTakeAllChildrenAndReparentTask(HTMLConstructionSiteTask& task)
{
    ASSERT(task.operation == HTMLConstructionSiteTask::TakeAllChildrenAndReparent);
    ASSERT(!task.nextChild);

    RefPtr furthestBlock = task.oldParent();
    protect(task.parent)->takeAllChildrenFrom(furthestBlock.get());

    RELEASE_ASSERT(!task.parent->parentNode());
    furthestBlock->parserAppendChild(protect(*task.parent));
}

static inline void executeTask(HTMLConstructionSiteTask& task)
{
    switch (task.operation) {
    case HTMLConstructionSiteTask::Insert:
        executeInsertTask(task);
        return;
    // All the cases below this point are only used by the adoption agency.
    case HTMLConstructionSiteTask::InsertAlreadyParsedChild:
        executeInsertAlreadyParsedChildTask(task);
        return;
    case HTMLConstructionSiteTask::Reparent:
        executeReparentTask(task);
        return;
    case HTMLConstructionSiteTask::TakeAllChildrenAndReparent:
        executeTakeAllChildrenAndReparentTask(task);
        return;
    }
    ASSERT_NOT_REACHED();
}

void HTMLConstructionSite::attachLater(Ref<ContainerNode>&& parent, Ref<Node>&& child, bool selfClosing)
{
    ASSERT(scriptingContentIsAllowed(m_parserContentPolicy) || !is<Element>(child) || !isScriptElement(downcast<Element>(child.get())));

    if (shouldFosterParent()) {
        fosterParent(WTF::move(child));
        return;
    }

    HTMLConstructionSiteTask task(HTMLConstructionSiteTask::Insert);
    task.parent = WTF::move(parent);
    task.child = WTF::move(child);
    task.selfClosing = selfClosing;

    // Close the last open tag and add as a sibling of the parent if we have reached the maximum depth allowed.
    if (m_openElements.stackDepth() >= m_maximumDOMTreeDepth && task.parent->parentNode()) {
        m_openElements.pop();
        task.parent = task.parent->parentNode();
        m_hasReachedMaxDOMTreeDepth = true;
    }

    ASSERT(task.parent);
    m_taskQueue.append(WTF::move(task));
}

void HTMLConstructionSite::executeQueuedTasks()
{
    if (m_taskQueue.isEmpty())
        return;

    // Copy the task queue into a local variable in case executeTask
    // re-enters the parser.
    TaskQueue queue = WTF::move(m_taskQueue);

    for (auto& task : queue)
        executeTask(task);

    // We might be detached now.
}

HTMLConstructionSite::HTMLConstructionSite(Document& document, OptionSet<ParserContentPolicy> parserContentPolicy, unsigned maximumDOMTreeDepth)
    : m_document(document)
    , m_attachmentRoot(document)
    , m_parserContentPolicy(parserContentPolicy)
    , m_isParsingFragment(false)
    , m_redirectAttachToFosterParent(false)
    , m_maximumDOMTreeDepth(maximumDOMTreeDepth)
    , m_inQuirksMode(document.inQuirksMode())
{
}

HTMLConstructionSite::HTMLConstructionSite(DocumentFragment& fragment, OptionSet<ParserContentPolicy> parserContentPolicy, unsigned maximumDOMTreeDepth, CustomElementRegistry* registry)
    : m_document(fragment.document())
    , m_attachmentRoot(fragment)
    , m_parserContentPolicy(parserContentPolicy)
    , m_registry(registry)
    , m_isParsingFragment(true)
    , m_redirectAttachToFosterParent(false)
    , m_maximumDOMTreeDepth(maximumDOMTreeDepth)
    , m_inQuirksMode(fragment.document().inQuirksMode())
{
}

HTMLConstructionSite::~HTMLConstructionSite() = default;

void HTMLConstructionSite::setForm(HTMLFormElement* form)
{
    // This method should only be needed for HTMLTreeBuilder in the fragment case.
    ASSERT(!m_form);
    m_form = form;
}

RefPtr<HTMLFormElement> HTMLConstructionSite::takeForm()
{
    return WTF::move(m_form);
}

void HTMLConstructionSite::insertHTMLHtmlStartTagBeforeHTML(AtomHTMLToken&& token)
{
    auto element = HTMLHtmlElement::create(protect(m_document));
    setAttributes(element, token, m_parserContentPolicy);
    attachLater(protect(m_attachmentRoot), element.copyRef());
    m_openElements.pushHTMLHtmlElement(HTMLStackItem(element.copyRef(), WTF::move(token)));

    executeQueuedTasks();
}

void HTMLConstructionSite::mergeAttributesFromTokenIntoElement(AtomHTMLToken&& token, Element& element)
{
    if (!scriptingContentIsAllowed(m_parserContentPolicy))
        element.stripScriptingAttributes(token.attributes());

    for (auto& tokenAttribute : token.attributes())
        element.setAttributeWithoutOverwriting(tokenAttribute.name(), tokenAttribute.value());
}

void HTMLConstructionSite::insertHTMLHtmlStartTagInBody(AtomHTMLToken&& token)
{
    // Fragments do not have a root HTML element, so any additional HTML elements
    // encountered during fragment parsing should be ignored.
    if (m_isParsingFragment)
        return;

    mergeAttributesFromTokenIntoElement(WTF::move(token), protect(m_openElements.htmlElement()));
}

void HTMLConstructionSite::insertHTMLBodyStartTagInBody(AtomHTMLToken&& token)
{
    mergeAttributesFromTokenIntoElement(WTF::move(token), protect(m_openElements.bodyElement()));
}

void HTMLConstructionSite::setDefaultCompatibilityMode()
{
    if (m_isParsingFragment)
        return;
    if (document().isSrcdocDocument())
        return;
    setCompatibilityMode(DocumentCompatibilityMode::QuirksMode);
}

void HTMLConstructionSite::setCompatibilityMode(DocumentCompatibilityMode mode)
{
    m_inQuirksMode = (mode == DocumentCompatibilityMode::QuirksMode);
    protect(m_document)->setCompatibilityMode(mode);
}

void HTMLConstructionSite::setCompatibilityModeFromDoctype(const AtomString& name, const String& publicId, const String& systemId)
{
    // There are three possible compatibility modes:
    // Quirks - quirks mode emulates WinIE and NS4. CSS parsing is also relaxed in this mode, e.g., unit types can
    // be omitted from numbers.
    // Limited Quirks - This mode is identical to no-quirks mode except for its treatment of line-height in the inline box model.  
    // No Quirks - no quirks apply. Web pages will obey the specifications to the letter.

    bool isNameHTML = name == HTMLNames::htmlTag->localName();
    if (isNameHTML && publicId.isEmpty() && systemId.isEmpty()) [[likely]] {
        setCompatibilityMode(DocumentCompatibilityMode::NoQuirksMode);
        return;
    }

    // Check for Quirks Mode.
    if (!isNameHTML
        || startsWithLettersIgnoringASCIICase(publicId, "+//silmaril//dtd html pro v0r11 19970101//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//advasoft ltd//dtd html 3.0 aswedit + extensions//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//as//dtd html 3.0 aswedit + extensions//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html 2.0 level 1//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html 2.0 level 2//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html 2.0 strict level 1//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html 2.0 strict level 2//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html 2.0 strict//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html 2.0//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html 2.1e//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html 3.0//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html 3.2 final//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html 3.2//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html 3//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html level 0//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html level 1//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html level 2//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html level 3//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html strict level 0//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html strict level 1//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html strict level 2//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html strict level 3//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html strict//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//ietf//dtd html//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//metrius//dtd metrius presentational//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//microsoft//dtd internet explorer 2.0 html strict//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//microsoft//dtd internet explorer 2.0 html//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//microsoft//dtd internet explorer 2.0 tables//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//microsoft//dtd internet explorer 3.0 html strict//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//microsoft//dtd internet explorer 3.0 html//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//microsoft//dtd internet explorer 3.0 tables//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//netscape comm. corp.//dtd html//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//netscape comm. corp.//dtd strict html//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//o'reilly and associates//dtd html 2.0//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//o'reilly and associates//dtd html extended 1.0//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//o'reilly and associates//dtd html extended relaxed 1.0//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//softquad software//dtd hotmetal pro 6.0::19990601::extensions to html 4.0//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//softquad//dtd hotmetal pro 4.0::19971010::extensions to html 4.0//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//spyglass//dtd html 2.0 extended//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//sq//dtd html 2.0 hotmetal + extensions//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//sun microsystems corp.//dtd hotjava html//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//sun microsystems corp.//dtd hotjava strict html//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html 3 1995-03-24//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html 3.2 draft//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html 3.2 final//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html 3.2//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html 3.2s draft//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html 4.0 frameset//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html 4.0 transitional//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html experimental 19960712//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html experimental 970421//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd w3 html//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//w3o//dtd w3 html 3.0//"_s)
        || equalLettersIgnoringASCIICase(publicId, "-//w3o//dtd w3 html strict 3.0//en//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//webtechs//dtd mozilla html 2.0//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//webtechs//dtd mozilla html//"_s)
        || equalLettersIgnoringASCIICase(publicId, "-/w3c/dtd html 4.0 transitional/en"_s)
        || equalLettersIgnoringASCIICase(publicId, "html"_s)
        || equalLettersIgnoringASCIICase(systemId, "http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd"_s)
        || (systemId.isEmpty() && startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html 4.01 frameset//"_s))
        || (systemId.isEmpty() && startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html 4.01 transitional//"_s))) {
        setCompatibilityMode(DocumentCompatibilityMode::QuirksMode);
        return;
    }

    // Check for Limited Quirks Mode.
    if (startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd xhtml 1.0 frameset//"_s)
        || startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd xhtml 1.0 transitional//"_s)
        || (!systemId.isEmpty() && startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html 4.01 frameset//"_s))
        || (!systemId.isEmpty() && startsWithLettersIgnoringASCIICase(publicId, "-//w3c//dtd html 4.01 transitional//"_s))) {
        setCompatibilityMode(DocumentCompatibilityMode::LimitedQuirksMode);
        return;
    }

    // Otherwise we are No Quirks Mode.
    setCompatibilityMode(DocumentCompatibilityMode::NoQuirksMode);
}

void HTMLConstructionSite::finishedParsing()
{
    m_textNodeBuffer = nullptr;
    m_currentTextNode = nullptr;
    protect(m_document)->finishedParsing();
}

void HTMLConstructionSite::insertDoctype(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::DOCTYPE);

    String publicId = token.publicIdentifier();
    String systemId = token.systemIdentifier();

    Ref document = m_document.get();
    attachLater(protect(m_attachmentRoot), DocumentType::create(document, token.name(), publicId, systemId));

    // DOCTYPE nodes are only processed when parsing fragments w/o contextElements, which
    // never occurs.  However, if we ever chose to support such, this code is subtly wrong,
    // because context-less fragments can determine their own quirks mode, and thus change
    // parsing rules (like <p> inside <table>).  For now we ASSERT that we never hit this code
    // in a fragment, as changing the owning document's compatibility mode would be wrong.
    ASSERT(!m_isParsingFragment);
    if (m_isParsingFragment)
        return;

    if (token.forceQuirks())
        setCompatibilityMode(DocumentCompatibilityMode::QuirksMode);
    else
        setCompatibilityModeFromDoctype(token.name(), publicId, systemId);
}

void HTMLConstructionSite::insertComment(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::Comment);
    attachLater(protect(currentNode()), Comment::create(protect(ownerDocumentForCurrentNode()), WTF::move(token.comment())));
}

void HTMLConstructionSite::insertCommentOnDocument(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::Comment);
    attachLater(protect(m_attachmentRoot), Comment::create(protect(m_document), WTF::move(token.comment())));
}

void HTMLConstructionSite::insertCommentOnHTMLHtmlElement(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::Comment);
    Ref parent = m_openElements.rootNode();
    Ref parentDocument = parent->document();
    attachLater(WTF::move(parent), Comment::create(parentDocument, WTF::move(token.comment())));
}

void HTMLConstructionSite::insertHTMLHeadElement(AtomHTMLToken&& token)
{
    ASSERT(!shouldFosterParent());
    m_head = HTMLStackItem(createHTMLElement(token), WTF::move(token));
    attachLater(protect(currentNode()), m_head.element());
    m_openElements.pushHTMLHeadElement(HTMLStackItem(m_head));
}

void HTMLConstructionSite::insertHTMLBodyElement(AtomHTMLToken&& token)
{
    ASSERT(!shouldFosterParent());
    auto body = createHTMLElement(token);
    attachLater(protect(currentNode()), body.copyRef());
    m_openElements.pushHTMLBodyElement(HTMLStackItem(WTF::move(body), WTF::move(token)));
}

void HTMLConstructionSite::insertHTMLFormElement(AtomHTMLToken&& token, bool isParsingTemplateContents)
{
    auto formElement = downcast<HTMLFormElement>(createHTMLElement(token));
    // If the parser is not parsing template contents, set the form element pointer to point to the
    // element created.
    if (!isParsingTemplateContents)
        m_form = formElement.ptr();
    attachLater(protect(currentNode()), formElement.copyRef());
    m_openElements.push(HTMLStackItem(WTF::move(formElement), WTF::move(token)));
}

void HTMLConstructionSite::insertHTMLElement(AtomHTMLToken&& token)
{
    auto element = createHTMLElement(token);
    attachLater(protect(currentNode()), element.copyRef());
    m_openElements.push(HTMLStackItem(WTF::move(element), WTF::move(token)));
}

void HTMLConstructionSite::insertHTMLTemplateElement(AtomHTMLToken&& token)
{
    if (m_parserContentPolicy.contains(ParserContentPolicy::AllowDeclarativeShadowRoots)) {
        std::optional<ShadowRootMode> mode;
        auto delegatesFocus = ShadowRootDelegatesFocus::No;
        auto clonable = ShadowRootClonable::No;
        auto serializable = ShadowRootSerializable::No;
        auto slotAssignment = SlotAssignmentMode::Named;
        auto registryKind = Element::CustomElementRegistryKind::Window;
        for (auto& attribute : token.attributes()) {
            if (attribute.name() == HTMLNames::shadowrootmodeAttr)
                mode = parseShadowRootMode(attribute.value());
            else if (attribute.name() == HTMLNames::shadowrootdelegatesfocusAttr)
                delegatesFocus = ShadowRootDelegatesFocus::Yes;
            else if (attribute.name() == HTMLNames::shadowrootclonableAttr)
                clonable = ShadowRootClonable::Yes;
            else if (attribute.name() == HTMLNames::shadowrootserializableAttr)
                serializable = ShadowRootSerializable::Yes;
            else if (attribute.name() == HTMLNames::shadowrootslotassignmentAttr)
                slotAssignment = parseSlotAssignmentMode(attribute.value());
            else if (attribute.name() == HTMLNames::shadowrootcustomelementregistryAttr)
                registryKind = Element::CustomElementRegistryKind::Null;
        }
        if (mode && is<Element>(currentNode())) {
            auto exceptionOrShadowRoot = protect(currentElement())->attachDeclarativeShadow(*mode, delegatesFocus, clonable, serializable, slotAssignment, registryKind);
            if (!exceptionOrShadowRoot.hasException()) {
                Ref shadowRoot = exceptionOrShadowRoot.releaseReturnValue();
                auto element = createHTMLElement(token);
                downcast<HTMLTemplateElement>(element.get()).setDeclarativeShadowRoot(shadowRoot);
                m_openElements.push(HTMLStackItem(WTF::move(element), WTF::move(token)));
                return;
            }
        }
    }
    insertHTMLElement(WTF::move(token));
}

std::unique_ptr<CustomElementConstructionData> HTMLConstructionSite::insertHTMLElementOrFindCustomElementInterface(AtomHTMLToken&& token)
{
    auto [element, elementInterface, registry] = createHTMLElementOrFindCustomElementInterface(token);
    if (elementInterface) [[unlikely]] {
        RELEASE_ASSERT(registry);
        return makeUnique<CustomElementConstructionData>(elementInterface.releaseNonNull(), registry.releaseNonNull(), token.name(), WTF::move(token.attributes()));
    }
    attachLater(protect(currentNode()), *element);
    m_openElements.push(HTMLStackItem(element.releaseNonNull(), WTF::move(token)));
    return nullptr;
}

void HTMLConstructionSite::insertCustomElement(Ref<Element>&& element, Vector<Attribute>&& attributes)
{
    setAttributes(element, attributes, HasDuplicateAttribute::No, m_parserContentPolicy);
    attachLater(protect(currentNode()), element.copyRef());
    m_openElements.push(HTMLStackItem(WTF::move(element), WTF::move(attributes)));
    executeQueuedTasks();
}

void HTMLConstructionSite::insertSelfClosingHTMLElement(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::StartTag);
    // Normally HTMLElementStack is responsible for calling finishParsingChildren,
    // but self-closing elements are never in the element stack so the stack
    // doesn't get a chance to tell them that we're done parsing their children.
    attachLater(protect(currentNode()), createHTMLElement(token), true);
    // FIXME: Do we want to acknowledge the token's self-closing flag?
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/tokenization.html#acknowledge-self-closing-flag
}

void HTMLConstructionSite::insertFormattingElement(AtomHTMLToken&& token)
{
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html#the-stack-of-open-elements
    // Possible active formatting elements include:
    // a, b, big, code, em, font, i, nobr, s, small, strike, strong, tt, and u.
    ASSERT(isFormattingTag(token.tagName()));
    insertHTMLElement(WTF::move(token));
    m_activeFormattingElements.append(HTMLStackItem(currentStackItem()));
}

void HTMLConstructionSite::insertScriptElement(AtomHTMLToken&& token)
{
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/scripting-1.html#already-started
    // http://html5.org/specs/dom-parsing.html#dom-range-createcontextualfragment
    // For createContextualFragment, the specifications say to mark it parser-inserted and already-started and later unmark them.
    // However, we short circuit that logic to avoid the subtree traversal to find script elements since scripts can never see
    // those flags or effects thereof.
    const bool parserInserted = !m_parserContentPolicy.contains(ParserContentPolicy::DoNotMarkAlreadyStarted);
    const bool alreadyStarted = m_isParsingFragment && parserInserted;
    SUPPRESS_UNCOUNTED_ARG auto element = HTMLScriptElement::create(scriptTag, ownerDocumentForCurrentNode(), parserInserted, alreadyStarted);
    setAttributes(element, token, m_parserContentPolicy);
    if (scriptingContentIsAllowed(m_parserContentPolicy))
        attachLater(protect(currentNode()), element.copyRef());
    m_openElements.push(HTMLStackItem(WTF::move(element), WTF::move(token)));
}

void HTMLConstructionSite::insertForeignElement(AtomHTMLToken&& token, const AtomString& namespaceURI)
{
    ASSERT(token.type() == HTMLToken::Type::StartTag);

    auto element = createElement(token, namespaceURI);
    if (scriptingContentIsAllowed(m_parserContentPolicy) || !isScriptElement(element.get()))
        attachLater(protect(currentNode()), element.copyRef(), token.selfClosing());
    if (!token.selfClosing())
        m_openElements.push(HTMLStackItem(WTF::move(element), WTF::move(token)));
}

static NEVER_INLINE unsigned findBreakIndexSlow(const String& string, unsigned currentPosition, unsigned proposedBreakIndex)
{
    unsigned stringLength = string.length();
    // Check that we are not on an unbreakable boundary.
    // Some text break iterator implementations work best if the passed buffer is as small as possible,
    // see <https://bugs.webkit.org/show_bug.cgi?id=29092>.
    // We need at least two characters look-ahead to account for UTF-16 surrogates.
    unsigned breakSearchLength = std::min(proposedBreakIndex - currentPosition + 2, stringLength - currentPosition);
    auto characters = string.span16().subspan(currentPosition, breakSearchLength);
    UErrorCode status = U_ZERO_ERROR;
    std::unique_ptr<UBreakIterator, decltype(&ubrk_close)> it(ubrk_open(UBRK_CHARACTER, "", characters.data(), characters.size(), &status), ubrk_close);
    if (U_FAILURE(status))
        return proposedBreakIndex;

    unsigned stringLengthLimit = proposedBreakIndex - currentPosition;
    if (ubrk_isBoundary(it.get(), stringLengthLimit))
        return proposedBreakIndex;

    unsigned breakIndexInSubstring = ubrk_preceding(it.get(), stringLengthLimit);
    return currentPosition + breakIndexInSubstring;
}

static ALWAYS_INLINE unsigned findBreakIndex(const String& string, unsigned currentPosition, unsigned proposedBreakIndex)
{
    ASSERT(currentPosition < proposedBreakIndex);
    ASSERT(proposedBreakIndex <= string.length());

    if (proposedBreakIndex == string.length() || string.is8Bit()) [[likely]]
        return proposedBreakIndex;

    return findBreakIndexSlow(string, currentPosition, proposedBreakIndex);
}

void HTMLConstructionSite::insertTextNode(const String& characters)
{
    HTMLConstructionSiteTask task(HTMLConstructionSiteTask::Insert);
    task.parent = currentNode();

    if (shouldFosterParent()) {
        recordFosterSite(task);
        // The parent is read below and these tasks run inline, so resolve now rather than in insert().
        resolveFosterSite(task);
    }

    unsigned currentPosition = 0;
    unsigned lengthLimit = shouldUseLengthLimit(*task.parent) ? Text::defaultLengthLimit : std::numeric_limits<unsigned>::max();

    // FIXME: Splitting text nodes into smaller chunks contradicts HTML5 spec, but is currently necessary
    // for performance, see <https://bugs.webkit.org/show_bug.cgi?id=55898>.

    RefPtr<Node> previousChild;
    if (task.nextChild)
        previousChild = task.nextChild->previousSibling();
    else {
        if (RefPtr templateParent = dynamicDowncast<HTMLTemplateElement>(task.parent.get()); templateParent) [[unlikely]] {
            RefPtr parentNode = templateParent->contentIfAvailable();
            previousChild = parentNode ? parentNode->lastChild() : nullptr;
        } else
            previousChild = task.parent->lastChild();
    }
    if (RefPtr previousTextChild = dynamicDowncast<Text>(previousChild.get()); previousTextChild && previousTextChild->length() < lengthLimit) {
        // FIXME: We're only supposed to append to this text node if it was the last text node inserted by the parser.
        unsigned proposedBreakIndex = std::min(characters.length(), lengthLimit - previousTextChild->length());
        if (unsigned breakIndex = findBreakIndex(characters, 0, proposedBreakIndex)) {
            if (previousTextChild != m_currentTextNode) {
                if (!m_textNodeBuffer)
                    m_textNodeBuffer = makeUnique<StringBuilder>();
                else
                    m_textNodeBuffer->clear();
                m_currentTextNode = previousTextChild;
            }
            previousTextChild->parserAppendData(StringView(characters).left(breakIndex), *m_textNodeBuffer);
            currentPosition = breakIndex;
        }
    }

    while (currentPosition < characters.length()) {
        unsigned proposedBreakIndex = std::min(currentPosition + lengthLimit, characters.length());
        unsigned breakIndex = findBreakIndex(characters, currentPosition, proposedBreakIndex);
        // If we couldn't find a break index (due to unbreakable characters), then we just don't split.
        if (breakIndex == currentPosition) [[unlikely]]
            breakIndex = characters.length();

        unsigned substringLength = breakIndex - currentPosition;
        auto substring = characters.substring(currentPosition, substringLength);
        auto textNode = Text::create(protect(task.parent->document()), WTF::move(substring));

        currentPosition += textNode->length();
        ASSERT(currentPosition <= characters.length());
        task.child = WTF::move(textNode);

        executeTask(task);
    }
}

void HTMLConstructionSite::reparent(HTMLElementStack::ElementRecord& newParent, HTMLElementStack::ElementRecord& child)
{
    HTMLConstructionSiteTask task(HTMLConstructionSiteTask::Reparent);
    task.parent = newParent.node();
    task.child = child.element();
    m_taskQueue.append(WTF::move(task));
}

void HTMLConstructionSite::insertAlreadyParsedChild(HTMLStackItem& newParent, HTMLElementStack::ElementRecord& child)
{
    HTMLConstructionSiteTask task(HTMLConstructionSiteTask::InsertAlreadyParsedChild);
    if (causesFosterParenting(newParent)) {
        recordFosterSite(task);
        ASSERT(task.parent);
    } else
        task.parent = newParent.node();
    task.child = child.element();
    m_taskQueue.append(WTF::move(task));
}

void HTMLConstructionSite::takeAllChildrenAndReparent(HTMLStackItem& newParent, HTMLElementStack::ElementRecord& oldParent)
{
    HTMLConstructionSiteTask task(HTMLConstructionSiteTask::TakeAllChildrenAndReparent);
    task.parent = newParent.node();
    task.child = oldParent.node();
    m_taskQueue.append(WTF::move(task));
}

static inline QualifiedName qualifiedNameForTag(AtomHTMLToken& token, const AtomString& namespaceURI)
{
    auto nodeNamespace = findNamespace(namespaceURI);
    auto elementName = elementNameForTag(nodeNamespace, token.tagName());
    if (elementName != ElementName::Unknown) [[likely]]
        return qualifiedNameForNodeName(elementName);
    return { nullAtom(), token.name(), namespaceURI, nodeNamespace, elementName };
}

static inline QualifiedName qualifiedNameForHTMLTag(const AtomHTMLToken& token)
{
    auto elementName = elementNameForTag(Namespace::HTML, token.tagName());
    if (elementName != ElementName::Unknown) [[likely]]
        return qualifiedNameForNodeName(elementName);
    return { nullAtom(), token.name(), xhtmlNamespaceURI, Namespace::HTML, elementName };
}

Ref<Element> HTMLConstructionSite::createElement(AtomHTMLToken& token, const AtomString& namespaceURI)
{
    SUPPRESS_UNCOUNTED_ARG auto element = ownerDocumentForCurrentNode().createElement(qualifiedNameForTag(token, namespaceURI), true);
    setAttributes(element, token, m_parserContentPolicy);
    return element;
}

inline TreeScope& HTMLConstructionSite::treeScopeForCurrentNode()
{
    if (RefPtr templateElement = dynamicDowncast<HTMLTemplateElement>(currentNode()))
        return templateElement->fragmentForInsertion().treeScope();
    return currentNode().treeScope();
}

inline ContainerNode& HTMLConstructionSite::containerForCurrentNode()
{
    if (RefPtr templateElement = dynamicDowncast<HTMLTemplateElement>(currentNode()))
        return templateElement->fragmentForInsertion();
    return currentNode();
}

inline Document& HTMLConstructionSite::ownerDocumentForCurrentNode()
{
    if (RefPtr templateElement = dynamicDowncast<HTMLTemplateElement>(currentNode()))
        return templateElement->fragmentForInsertion().document();
    return currentNode().document();
}

static CustomElementRegistry* registryForCurrentNode(Node& currentNode, TreeScope& treeScope)
{
    if (auto* templateElement = dynamicDowncast<HTMLTemplateElement>(currentNode)) {
        Ref templateFragmentTreeScope = templateElement->fragmentForInsertion().treeScope();
        if (templateFragmentTreeScope->rootNode().usesNullCustomElementRegistry())
            return nullptr;
    }
    return CustomElementRegistry::registryForNodeOrTreeScope(currentNode, treeScope);
}

std::tuple<RefPtr<HTMLElement>, RefPtr<JSCustomElementInterface>, RefPtr<CustomElementRegistry>> HTMLConstructionSite::createHTMLElementOrFindCustomElementInterface(AtomHTMLToken& token)
{
    Ref treeScope = treeScopeForCurrentNode();
    Ref ownerDocument = treeScope->documentScope();
    RefPtr element = HTMLElementFactory::createKnownElement(token.tagName(), ownerDocument, true);
    RefPtr<CustomElementRegistry> registry = m_openElements.stackDepth() > 1 ? RefPtr { registryForCurrentNode(protect(currentNode()), treeScope) } : m_registry;
    if (!element) [[unlikely]] {
        RefPtr elementInterface = registry ? registry->findInterface(token.name()) : nullptr;
        if (elementInterface) [[unlikely]] {
            bool shouldUseNullCustomElementRegistry = false;
            for (auto& attribute : token.attributes()) {
                if (attribute.name() == HTMLNames::customelementregistryAttr) {
                    shouldUseNullCustomElementRegistry = true;
                    break;
                }
            }
            if (!shouldUseNullCustomElementRegistry) {
                if (!m_isParsingFragment)
                    return { nullptr, elementInterface, WTF::move(registry) };
                ASSERT(qualifiedNameForHTMLTag(token) == elementInterface->name());
                element = elementInterface->createElement(ownerDocument);
                element->setIsCustomElementUpgradeCandidate();
                element->enqueueToUpgrade(*elementInterface);
            }
        }
        if (!element) {
            auto qualifiedName = qualifiedNameForHTMLTag(token);
            if (Document::validateCustomElementName(token.name()) == CustomElementNameValidationStatus::Valid) {
                element = HTMLMaybeFormAssociatedCustomElement::create(qualifiedName, ownerDocument);
                element->setIsCustomElementUpgradeCandidate();
            } else
                element = HTMLUnknownElement::create(qualifiedName, ownerDocument);
        }
    }
    ASSERT(element);
    if (!registry && containerForCurrentNode().usesNullCustomElementRegistry())
        element->setUsesNullCustomElementRegistry();
    if (registry && registry->isScoped() && registry != treeScope->customElementRegistry()) [[unlikely]]
        CustomElementRegistry::addToScopedCustomElementRegistryMap(*element, *registry);

    if (form() && !m_openElements.containsTemplateElement()) {
        if (auto* formAssociated = element->asFormAssociatedElement())
            formAssociated->setFormSetByParser(form());
    }

    setAttributes(*element, token, m_parserContentPolicy);
    return { element, nullptr, nullptr };
}

Ref<HTMLElement> HTMLConstructionSite::createHTMLElement(AtomHTMLToken& token)
{
    auto [element, jsInterface, registry] = createHTMLElementOrFindCustomElementInterface(token);
    ASSERT(element);
    ASSERT_UNUSED(jsInterface, !jsInterface);
    ASSERT_UNUSED(registry, !registry);
    return element.releaseNonNull();
}

HTMLStackItem HTMLConstructionSite::createElementFromSavedToken(const HTMLStackItem& item)
{
    // NOTE: Moving from item -> token -> item copies the Attribute vector twice!
    auto tagName = tagNameForElementName(item.elementName());
    AtomHTMLToken fakeToken(HTMLToken::Type::StartTag, tagName, item.localName(), Vector<Attribute>(item.attributes()));
    ASSERT(item.namespaceURI() == HTMLNames::xhtmlNamespaceURI);
    ASSERT(isFormattingTag(tagName));
    return HTMLStackItem(createHTMLElement(fakeToken), WTF::move(fakeToken));
}

std::optional<unsigned> HTMLConstructionSite::indexOfFirstUnopenFormattingElement() const
{
    if (m_activeFormattingElements.isEmpty())
        return std::nullopt;
    unsigned index = m_activeFormattingElements.size();
    do {
        --index;
        const auto& entry = m_activeFormattingElements.at(index);
        if (entry.isMarker() || m_openElements.contains(entry.element())) {
            unsigned firstUnopenElementIndex = index + 1;
            return firstUnopenElementIndex < m_activeFormattingElements.size() ? firstUnopenElementIndex : std::optional<unsigned>(std::nullopt);
        }
    } while (index);

    return index;
}

void HTMLConstructionSite::reconstructTheActiveFormattingElements()
{
    std::optional<unsigned> firstUnopenElementIndex = indexOfFirstUnopenFormattingElement();
    if (!firstUnopenElementIndex)
        return;

    ASSERT(firstUnopenElementIndex.value() < m_activeFormattingElements.size());
    for (unsigned unopenEntryIndex = firstUnopenElementIndex.value(); unopenEntryIndex < m_activeFormattingElements.size(); ++unopenEntryIndex) {
        auto& unopenedEntry = m_activeFormattingElements.at(unopenEntryIndex);
        ASSERT(!unopenedEntry.stackItem().isNull());
        auto reconstructed = createElementFromSavedToken(unopenedEntry.stackItem());
        attachLater(protect(currentNode()), reconstructed.node());
        m_openElements.push(HTMLStackItem(reconstructed));
        unopenedEntry.replaceElement(WTF::move(reconstructed));
    }
}

void HTMLConstructionSite::generateImpliedEndTagsWithExclusion(ElementName elementName)
{
    ASSERT(elementName != ElementName::Unknown);
    while (hasImpliedEndTag(currentStackItem()) && currentStackItem().elementName() != elementName)
        m_openElements.pop();
}

void HTMLConstructionSite::generateImpliedEndTagsWithExclusion(const AtomString& tagName)
{
    while (hasImpliedEndTag(currentStackItem()) && !currentStackItem().matchesHTMLTag(tagName))
        m_openElements.pop();
}

void HTMLConstructionSite::generateImpliedEndTags()
{
    while (hasImpliedEndTag(currentStackItem()))
        m_openElements.pop();
}

// Records the stack-derived part of the "adjusted insertion location" for foster parenting, the
// substeps of step 3 of https://html.spec.whatwg.org/#appropriate-place-for-inserting-a-node
// resolveFosterSite() derives the rest from the DOM, so task.parent is not final here.
void HTMLConstructionSite::recordFosterSite(HTMLConstructionSiteTask& task)
{
    // If the last template or table element on the stack of open elements is a template, that
    // element is the foster parent, not its parent.
    auto* lastTemplate = m_openElements.topmost(HTML::template_);
    auto* lastTable = m_openElements.topmost(HTML::table);
    if (lastTemplate && (!lastTable || lastTemplate->isAbove(*lastTable))) {
        task.parent = lastTemplate->element();
        return;
    }

    if (!lastTable) {
        // Fragment case
        task.parent = m_openElements.rootNode();
        return;
    }

    // The table's parent is read when the task runs, so record the element immediately above the
    // table in the stack of open elements as the fallback for when it has no parent by then.
    ASSERT(lastTable->next());
    task.parent = lastTable->next()->node();
    task.nextChild = lastTable->element();
}

bool HTMLConstructionSite::shouldFosterParent() const
{
    return m_redirectAttachToFosterParent && causesFosterParenting(currentStackItem());
}

void HTMLConstructionSite::fosterParent(Ref<Node>&& node)
{
    HTMLConstructionSiteTask task(HTMLConstructionSiteTask::Insert);
    recordFosterSite(task);
    task.child = WTF::move(node);
    ASSERT(task.parent);

    m_taskQueue.append(WTF::move(task));
}

} // namespace WebCore

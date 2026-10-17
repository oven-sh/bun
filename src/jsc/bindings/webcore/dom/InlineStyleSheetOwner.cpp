#include "config.h"
#include "InlineStyleSheetOwner.h"

#include "Document.h"
#include "ElementInlines.h"
#include "MediaList.h"
#include "StyleScope.h"
#include "StyleSheetContents.h"
#include "TextNodeTraversal.h"

namespace WebCore {

InlineStyleSheetOwner::InlineStyleSheetOwner(Document&, bool createdByParser)
    : m_isParsingChildren(createdByParser)
{
}

InlineStyleSheetOwner::~InlineStyleSheetOwner()
{
    if (m_sheet)
        clearSheet();
}

void InlineStyleSheetOwner::sheetNeedsUpdate(Element& element)
{
    ASSERT_UNUSED(element, element.isConnected());
    if (m_sheet)
        clearSheet();
    m_sheetNeedsUpdate = true;
    if (m_styleScope)
        m_styleScope->didChangeActiveStyleSheetCandidates();
}

void InlineStyleSheetOwner::setContentType(Element& element, const AtomString& contentType)
{
    m_contentType = contentType;
    if (element.isConnected() && !m_isParsingChildren)
        sheetNeedsUpdate(element);
}

void InlineStyleSheetOwner::setMedia(Element& element, const AtomString& media)
{
    m_media = media;
    if (m_sheet)
        m_sheet->setMediaQueries(MediaQueries::parse(media));
    UNUSED_PARAM(element);
}

CSSStyleSheet* InlineStyleSheetOwner::sheet(Element& element)
{
    if (m_sheetNeedsUpdate) {
        m_sheetNeedsUpdate = false;
        createSheetFromTextContents(element);
    }
    return m_sheet.get();
}

void InlineStyleSheetOwner::insertedIntoDocument(Element& element)
{
    m_styleScope = Style::Scope::forNode(element);
    protect(m_styleScope)->addStyleSheetCandidateNode(element, m_isParsingChildren);

    if (m_isParsingChildren)
        return;
    sheetNeedsUpdate(element);
}

void InlineStyleSheetOwner::removedFromDocument(Element& element)
{
    if (m_styleScope)
        m_styleScope->removeStyleSheetCandidateNode(element);
    m_sheetNeedsUpdate = false;
    if (m_sheet)
        clearSheet();
}

void InlineStyleSheetOwner::clearDocumentData(Element& element)
{
    if (RefPtr sheet = m_sheet)
        sheet->clearOwnerNode();

    if (m_styleScope)
        m_styleScope->removeStyleSheetCandidateNode(element);
}

void InlineStyleSheetOwner::childrenChanged(Element& element)
{
    if (m_isParsingChildren)
        return;
    if (!element.isConnected())
        return;
    sheetNeedsUpdate(element);
}

void InlineStyleSheetOwner::finishParsingChildren(Element& element)
{
    if (element.isConnected())
        sheetNeedsUpdate(element);
    m_isParsingChildren = false;
}

void InlineStyleSheetOwner::createSheetFromTextContents(Element& element)
{
    createSheet(element, TextNodeTraversal::childTextContent(element));
}

void InlineStyleSheetOwner::clearSheet()
{
    ASSERT(m_sheet);
    RefPtr sheet = std::exchange(m_sheet, nullptr);
    sheet->clearOwnerNode();
}

inline bool isValidCSSContentType(const AtomString& type)
{
    // https://html.spec.whatwg.org/multipage/semantics.html#update-a-style-block
    if (type.isEmpty())
        return true;
    return equalLettersIgnoringASCIICase(type, "text/css"_s);
}

void InlineStyleSheetOwner::createSheet(Element& element, const String& text)
{
    ASSERT(element.isConnected());
    if (m_sheet)
        clearSheet();

    if (!isValidCSSContentType(m_contentType))
        return;

    Ref contents = StyleSheetContents::create(strictToCSSParserMode(!element.document().inQuirksMode()));
    contents->parseString(text);

    Ref sheet = CSSStyleSheet::createInline(WTF::move(contents), element);
    if (!m_media.isEmpty())
        sheet->setMediaQueries(MediaQueries::parse(m_media));
    if (!element.isInShadowTree())
        sheet->setTitle(element.attributeWithoutSynchronization(HTMLNames::titleAttr));
    m_sheet = WTF::move(sheet);
}

}

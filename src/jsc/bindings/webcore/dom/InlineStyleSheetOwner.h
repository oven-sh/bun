#pragma once

#include "CSSStyleSheet.h"
#include "StyleScope.h"

namespace WebCore {

class Document;
class Element;

// What a <style> element has. The text is parsed when somebody asks for the sheet, not when it changes.
class InlineStyleSheetOwner {
public:
    InlineStyleSheetOwner(Document&, bool createdByParser);
    ~InlineStyleSheetOwner();

    void setContentType(Element&, const AtomString& contentType);
    void setMedia(Element&, const AtomString& media);

    CSSStyleSheet* sheet(Element&);

    void insertedIntoDocument(Element&);
    void removedFromDocument(Element&);
    void clearDocumentData(Element&);
    void childrenChanged(Element&);
    void finishParsingChildren(Element&);

private:
    void createSheet(Element&, const String& text);
    void createSheetFromTextContents(Element&);
    void clearSheet();
    void sheetNeedsUpdate(Element&);

    bool m_isParsingChildren;
    bool m_sheetNeedsUpdate { false };
    AtomString m_contentType;
    AtomString m_media;
    RefPtr<CSSStyleSheet> m_sheet;
    WeakPtr<Style::Scope> m_styleScope;
};

} // namespace WebCore

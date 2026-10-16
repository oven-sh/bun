/*
 *  Copyright (C) 2003, 2006, 2008 Apple Inc. All rights reserved.
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#include "config.h"
#include "DOMParser.h"

#include "CommonAtomStrings.h"
#include "ExceptionOr.h"
#include "HTMLDocument.h"
#include "ScriptExecutionContext.h"
#include "XMLDocument.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(DOMParser);

inline DOMParser::DOMParser(ScriptExecutionContext& context, Document* contextDocument)
    : m_scriptExecutionContext(context)
    , m_contextDocument(contextDocument)
{
}

DOMParser::~DOMParser() = default;

Ref<DOMParser> DOMParser::create(Document& contextDocument)
{
    return adoptRef(*new DOMParser(*contextDocument.scriptExecutionContext(), &contextDocument));
}

Ref<DOMParser> DOMParser::create(ScriptExecutionContext& context)
{
    return adoptRef(*new DOMParser(context, nullptr));
}

ExceptionOr<Ref<Document>> DOMParser::parseFromString(String&& string, const AtomString& contentType)
{
    RefPtr<Document> document;
    if (contentType == textHTMLContentTypeAtom())
        document = HTMLDocument::create(m_scriptExecutionContext, URL { });
    else if (contentType == applicationXHTMLContentTypeAtom())
        document = XMLDocument::createXHTML(m_scriptExecutionContext, URL { });
    else if (contentType == imageSVGContentTypeAtom())
        document = XMLDocument::createSVG(m_scriptExecutionContext, URL { });
    else if (contentType == textXMLContentTypeAtom() || contentType == applicationXMLContentTypeAtom()) {
        document = XMLDocument::create(m_scriptExecutionContext, URL { });
        document->overrideMIMEType(contentType);
    } else
        return Exception { ExceptionCode::TypeError };

    document->setMarkupUnsafe(WTF::move(string), { });
    if (m_contextDocument)
        document->setURL(URL { protect(m_contextDocument)->url() });
    return document.releaseNonNull();
}

} // namespace WebCore

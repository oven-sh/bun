#include "config.h"
#include "StyleSheetList.h"

#include "CSSStyleSheet.h"
#include "Document.h"
#include "ShadowRoot.h"
#include "StyleScope.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(StyleSheetList);

StyleSheetList::StyleSheetList(Document& document)
    : m_document(document)
{
}

StyleSheetList::StyleSheetList(ShadowRoot& shadowRoot)
    : m_shadowRoot(shadowRoot)
{
}

StyleSheetList::~StyleSheetList() = default;

Vector<Ref<CSSStyleSheet>> StyleSheetList::styleSheets() const
{
    const TreeScope* treeScope = m_document ? static_cast<const TreeScope*>(m_document.get()) : m_shadowRoot.get();
    auto* scope = treeScope ? Style::Scope::forTreeScopeIfExists(*treeScope) : nullptr;
    if (!scope)
        return { };
    return scope->styleSheetsForStyleSheetList();
}

Node* StyleSheetList::ownerNode() const
{
    if (m_document)
        return m_document.get();
    return m_shadowRoot.get();
}

unsigned StyleSheetList::length() const
{
    return styleSheets().size();
}

RefPtr<StyleSheet> StyleSheetList::item(unsigned index) const
{
    auto sheets = styleSheets();
    if (index < sheets.size())
        return RefPtr<StyleSheet> { sheets[index].ptr() };
    return nullptr;
}

} // namespace WebCore

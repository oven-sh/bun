#include "config.h"
#include "StyleScope.h"

#include "CSSStyleSheet.h"
#include "DOMClientData.h"
#include "HTMLStyleElement.h"
#include "Node.h"
#include "RuleSet.h"
#include "TreeScope.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {
namespace Style {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Scope);

Scope::Scope(const TreeScope& treeScope)
    : m_treeScope(treeScope)
{
}

Scope::~Scope() = default;

Scope& Scope::forNode(const Node& node)
{
    auto& treeScope = node.treeScope();
    return *domClientData().styleScopes().ensure(&treeScope, [&] {
        return makeUnique<Scope>(treeScope);
    }).iterator->value;
}

Scope* Scope::forTreeScopeIfExists(const TreeScope& treeScope)
{
    auto& scopes = domClientData().styleScopes();
    if (scopes.isEmpty())
        return nullptr;
    return scopes.get(&treeScope);
}

Scope* Scope::forNodeIfExists(const Node& node)
{
    return forTreeScopeIfExists(node.treeScope());
}

void Scope::didChangeActiveStyleSheetCandidates()
{
    m_ruleSet = nullptr;
}

void Scope::didChangeStyleSheetContents()
{
    m_ruleSet = nullptr;
}

void Scope::addStyleSheetCandidateNode(Node& node, bool createdByParser)
{
    didChangeActiveStyleSheetCandidates();

    // Until the <body> exists, we have no choice but to compare document positions,
    // but later on, we can assume that most style sheets are added at the end.
    if (createdByParser || m_styleSheetCandidateNodes.isEmpty()) {
        m_styleSheetCandidateNodes.append(&node);
        return;
    }

    // Determine an appropriate insertion point.
    size_t index = m_styleSheetCandidateNodes.size();
    while (index) {
        unsigned short position = m_styleSheetCandidateNodes[index - 1]->compareDocumentPosition(node);
        if (position & Node::DOCUMENT_POSITION_FOLLOWING)
            break;
        --index;
    }
    m_styleSheetCandidateNodes.insert(index, &node);
}

void Scope::removeStyleSheetCandidateNode(Node& node)
{
    if (!m_styleSheetCandidateNodes.removeFirst(&node))
        return;
    didChangeActiveStyleSheetCandidates();
    if (m_styleSheetCandidateNodes.isEmpty())
        domClientData().styleScopes().remove(&m_treeScope);
}

Vector<Ref<CSSStyleSheet>> Scope::styleSheetsForStyleSheetList() const
{
    Vector<Ref<CSSStyleSheet>> sheets;
    for (auto* node : m_styleSheetCandidateNodes) {
        if (auto* styleElement = dynamicDowncast<HTMLStyleElement>(*node)) {
            if (RefPtr sheet = styleElement->sheet())
                sheets.append(sheet.releaseNonNull());
        }
    }
    return sheets;
}

const RuleSet& Scope::ruleSet()
{
    if (!m_ruleSet) {
        auto ruleSet = makeUnique<RuleSet>();
        for (auto& sheet : styleSheetsForStyleSheetList()) {
            if (sheet->isActive())
                ruleSet->addRulesFromSheet(sheet);
        }
        ruleSet->didAddAllRules();
        m_ruleSet = WTF::move(ruleSet);
    }
    return *m_ruleSet;
}

} // namespace Style
} // namespace WebCore

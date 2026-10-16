#pragma once

#include "ElementInlines.h"
#include "RuleSet.h"

namespace WebCore {
namespace Style {

template<typename Function> void RuleSet::forEachCandidate(const Element& element, NOESCAPE const Function& function) const
{
    auto visit = [&](const RuleDataVector* rules) {
        if (!rules)
            return;
        for (auto& ruleData : *rules)
            function(ruleData);
    };
    auto find = [](auto& map, const AtomString& key) -> const RuleDataVector* {
        auto it = map.find(key);
        return it == map.end() ? nullptr : &it->value;
    };

    if (!m_idRules.isEmpty()) {
        if (auto& id = element.idForStyleResolution(); !id.isNull())
            visit(find(m_idRules, id));
    }
    if (!m_classRules.isEmpty() && element.hasClass()) {
        for (auto& className : element.classNames())
            visit(find(m_classRules, className));
    }
    if (!m_tagLowercaseLocalNameRules.isEmpty())
        visit(find(m_tagLowercaseLocalNameRules, element.tagQName().localNameLowercase()));
    visit(&m_universalRules);
}

} // namespace Style
} // namespace WebCore

#include "config.h"
#include "CSSStyleSheet.h"

#include "CSSParser.h"
#include "CSSRule.h"
#include "CSSRuleList.h"
#include "Element.h"
#include "JSNodeCustom.h"
#include "JSNodeCustomInlines.h"
#include "StyleRule.h"
#include "StyleScope.h"
#include "StyleSheetContents.h"
#include "WebCoreOpaqueRootInlines.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CSSStyleSheet);

class StyleSheetCSSRuleList final : public CSSRuleList {
    WTF_MAKE_TZONE_ALLOCATED_INLINE(StyleSheetCSSRuleList);
public:
    StyleSheetCSSRuleList(CSSStyleSheet* sheet)
        : m_styleSheet(sheet)
    {
    }

private:
    void ref() const final { m_styleSheet->ref(); }
    void deref() const final { m_styleSheet->deref(); }

    unsigned length() const final { return m_styleSheet->length(); }
    CSSRule* item(unsigned index) const final { return m_styleSheet->item(index); }

    CSSStyleSheet* styleSheet() const final { return m_styleSheet; }

    CSSStyleSheet* m_styleSheet;
};

Ref<CSSStyleSheet> CSSStyleSheet::createInline(Ref<StyleSheetContents>&& sheet, Element& owner)
{
    return adoptRef(*new CSSStyleSheet(WTF::move(sheet), &owner));
}

Ref<CSSStyleSheet> CSSStyleSheet::create(Init&& options)
{
    Ref sheet = adoptRef(*new CSSStyleSheet(StyleSheetContents::create(HTMLStandardMode), nullptr));
    sheet->m_wasConstructedByJS = true;
    sheet->m_isDisabled = options.disabled;
    WTF::switchOn(WTF::move(options.media), [&](Ref<MediaList>&& mediaList) {
        sheet->m_mediaQueries = MediaQueries::parse(mediaList->mediaText());
    }, [&](String&& mediaString) {
        sheet->m_mediaQueries = MediaQueries::parse(mediaString);
    });
    return sheet;
}

CSSStyleSheet::CSSStyleSheet(Ref<StyleSheetContents>&& contents, Node* ownerNode)
    : m_contents(WTF::move(contents))
    , m_ownerNode(ownerNode)
{
}

CSSStyleSheet::~CSSStyleSheet()
{
    // For style rules outside the document, .parentStyleSheet can become null even if the style rule
    // is still observable from JavaScript. This matches the behavior of .parentNode for nodes, but
    // it's not ideal because it makes the CSSOM's behavior depend on the timing of garbage collection.
    for (auto& wrapper : m_childRuleCSSOMWrappers) {
        if (wrapper)
            wrapper->setParentStyleSheet(nullptr);
    }
    if (m_mediaCSSOMWrapper)
        m_mediaCSSOMWrapper->detachFromParent();
}

// Only this thread writes it, so it may read without the lock.
Node* CSSStyleSheet::ownerNode() const WTF_IGNORES_THREAD_SAFETY_ANALYSIS
{
    return m_ownerNode;
}

void CSSStyleSheet::clearOwnerNode()
{
    Locker locker { m_opaqueRootLockForGC };
    m_ownerNode = nullptr;
}

WebCoreOpaqueRoot CSSStyleSheet::opaqueRootForGCThread()
{
    Locker locker { m_opaqueRootLockForGC };
    if (m_ownerNode)
        return root(m_ownerNode);
    return WebCoreOpaqueRoot { this };
}

Style::Scope* CSSStyleSheet::styleScope()
{
    auto* owner = ownerNode();
    return owner ? Style::Scope::forNodeIfExists(*owner) : nullptr;
}

void CSSStyleSheet::didMutateRules()
{
    if (auto* scope = styleScope())
        scope->didChangeStyleSheetContents();
}

void CSSStyleSheet::setDisabled(bool disabled)
{
    if (disabled == m_isDisabled)
        return;
    m_isDisabled = disabled;
    didMutateRules();
}

void CSSStyleSheet::setMediaQueries(MediaQueries&& mediaQueries)
{
    m_mediaQueries = WTF::move(mediaQueries);
    didMutateRules();
}

void CSSStyleSheet::clearChildRuleCSSOMWrappers()
{
    for (auto& wrapper : m_childRuleCSSOMWrappers) {
        if (wrapper)
            wrapper->setParentStyleSheet(nullptr);
    }
    m_childRuleCSSOMWrappers.clear();
}

unsigned CSSStyleSheet::length() const
{
    return m_contents->ruleCount();
}

CSSRule* CSSStyleSheet::item(unsigned index)
{
    unsigned ruleCount = length();
    if (index >= ruleCount)
        return nullptr;

    if (m_childRuleCSSOMWrappers.isEmpty())
        m_childRuleCSSOMWrappers.grow(ruleCount);
    ASSERT(m_childRuleCSSOMWrappers.size() == ruleCount);

    auto& cssRule = m_childRuleCSSOMWrappers[index];
    if (!cssRule)
        cssRule = m_contents->ruleAt(index)->createCSSOMWrapper(*this);
    return cssRule.get();
}

CSSRuleList& CSSStyleSheet::cssRules()
{
    if (!m_ruleListCSSOMWrapper)
        lazyInitialize(m_ruleListCSSOMWrapper, makeUniqueWithoutRefCountedCheck<StyleSheetCSSRuleList, CSSRuleList>(this));
    return *m_ruleListCSSOMWrapper;
}

ExceptionOr<unsigned> CSSStyleSheet::insertRule(const String& ruleString, unsigned index)
{
    ASSERT(m_childRuleCSSOMWrappers.isEmpty() || m_childRuleCSSOMWrappers.size() == m_contents->ruleCount());

    if (index > length())
        return Exception { ExceptionCode::IndexSizeError };
    RefPtr rule = CSSParser::parseRule(ruleString, m_contents->parserMode());
    if (!rule)
        return Exception { ExceptionCode::SyntaxError };

    if (m_wasConstructedByJS && rule->type() == StyleRuleType::Import)
        return Exception { ExceptionCode::SyntaxError, "Cannot inserted an @import rule in a constructed CSSStyleSheet object"_s };

    RuleMutationScope mutationScope(this);

    bool isNamespace = rule->type() == StyleRuleType::Namespace;
    bool success = m_contents->wrapperInsertRule(rule.releaseNonNull(), index);
    if (!success) {
        if (isNamespace)
            return Exception { ExceptionCode::InvalidStateError };
        return Exception { ExceptionCode::HierarchyRequestError };
    }

    if (!m_childRuleCSSOMWrappers.isEmpty())
        m_childRuleCSSOMWrappers.insert(index, RefPtr<CSSRule>());

    return index;
}

ExceptionOr<void> CSSStyleSheet::deleteRule(unsigned index)
{
    ASSERT(m_childRuleCSSOMWrappers.isEmpty() || m_childRuleCSSOMWrappers.size() == m_contents->ruleCount());

    if (index >= length())
        return Exception { ExceptionCode::IndexSizeError };
    RuleMutationScope mutationScope(this);

    bool success = m_contents->wrapperDeleteRule(index);
    if (!success)
        return Exception { ExceptionCode::InvalidStateError };
    if (!m_childRuleCSSOMWrappers.isEmpty()) {
        if (m_childRuleCSSOMWrappers[index])
            m_childRuleCSSOMWrappers[index]->setParentStyleSheet(nullptr);
        m_childRuleCSSOMWrappers.removeAt(index);
    }

    return { };
}

ExceptionOr<int> CSSStyleSheet::addRule(const String& selector, const String& style, std::optional<unsigned> index)
{
    auto text = makeString(selector, " { "_s, style, !style.isEmpty() ? " "_s : ""_s, '}');
    auto insertRuleResult = insertRule(text, index.value_or(length()));
    if (insertRuleResult.hasException())
        return insertRuleResult.releaseException();

    // As per Microsoft documentation, always return -1.
    return -1;
}

ExceptionOr<void> CSSStyleSheet::replaceSync(String&& text)
{
    if (!m_wasConstructedByJS)
        return Exception { ExceptionCode::NotAllowedError, "This CSSStyleSheet object was not constructed by JavaScript"_s };

    RuleMutationScope mutationScope(this);
    clearChildRuleCSSOMWrappers();
    m_contents->clearRules();
    m_contents->parseString(text);
    return { };
}

MediaList* CSSStyleSheet::media() const
{
    if (!m_mediaCSSOMWrapper)
        m_mediaCSSOMWrapper = MediaList::create(const_cast<CSSStyleSheet*>(this));
    return m_mediaCSSOMWrapper.get();
}

CSSStyleSheet::RuleMutationScope::RuleMutationScope(CSSStyleSheet* sheet)
    : m_styleSheet(sheet)
{
    ASSERT(m_styleSheet);
}

CSSStyleSheet::RuleMutationScope::RuleMutationScope(CSSRule* rule)
    : m_styleSheet(rule ? rule->parentStyleSheet() : nullptr)
{
}

CSSStyleSheet::RuleMutationScope::~RuleMutationScope()
{
    if (m_styleSheet)
        m_styleSheet->didMutateRules();
}

} // namespace WebCore

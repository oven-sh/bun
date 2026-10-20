#pragma once

#include "ExceptionOr.h"
#include "MediaList.h"
#include "StyleSheet.h"
#include <memory>
#include <wtf/Lock.h>
#include <wtf/Noncopyable.h>
#include <wtf/TypeCasts.h>
#include <wtf/WeakPtr.h>

namespace WebCore {

class CSSRule;
class CSSRuleList;
class Element;
class StyleSheetContents;
class WebCoreOpaqueRoot;

namespace Style {
class Scope;
}

class CSSStyleSheet final : public StyleSheet, public CanMakeSingleThreadWeakPtr<CSSStyleSheet> {
    WTF_MAKE_TZONE_ALLOCATED(CSSStyleSheet);
public:
    struct Init {
        String baseURL;
        Variant<Ref<MediaList>, String> media { emptyString() };
        bool disabled { false };
    };
    static Ref<CSSStyleSheet> createInline(Ref<StyleSheetContents>&&, Element& owner);
    static Ref<CSSStyleSheet> create(Init&&);

    virtual ~CSSStyleSheet();

    Node* ownerNode() const final;
    MediaList* media() const final;
    String href() const final { return { }; }
    String title() const final { return !m_title.isEmpty() ? m_title : String(); }
    bool disabled() const final { return m_isDisabled; }
    void setDisabled(bool) final;

    CSSRule* ownerRule() const { return nullptr; }

    WEBCORE_EXPORT CSSRuleList& cssRules();
    CSSRuleList& cssRulesForBindings() { return cssRules(); }
    CSSRuleList& rules() { return cssRules(); }

    WEBCORE_EXPORT ExceptionOr<unsigned> insertRule(const String& rule, unsigned index);
    WEBCORE_EXPORT ExceptionOr<void> deleteRule(unsigned index);

    WEBCORE_EXPORT ExceptionOr<int> addRule(const String& selector, const String& style, std::optional<unsigned> index);
    ExceptionOr<void> removeRule(unsigned index) { return deleteRule(index); }

    ExceptionOr<void> replaceSync(String&&);

    // For CSSRuleList.
    unsigned length() const;
    CSSRule* item(unsigned index);
    CSSStyleSheet* parentStyleSheet() const final { return nullptr; }

    void clearOwnerNode() final;

    Style::Scope* styleScope();

    const MediaQueries& mediaQueries() const LIFETIME_BOUND { return m_mediaQueries; }
    void setMediaQueries(MediaQueries&&);
    void setTitle(const String& title) { m_title = title; }

    class RuleMutationScope {
        WTF_MAKE_NONCOPYABLE(RuleMutationScope);
    public:
        RuleMutationScope(CSSStyleSheet*);
        RuleMutationScope(CSSRule*);
        ~RuleMutationScope();

    private:
        const RefPtr<CSSStyleSheet> m_styleSheet;
    };

    void didMutateRules();

    void clearChildRuleCSSOMWrappers();

    StyleSheetContents& contents() { return m_contents; }

    // Whether its rules take part in the cascade.
    bool isActive() const { return !m_isDisabled && m_mediaQueries.matches; }

    WebCoreOpaqueRoot opaqueRootForGCThread() final;

private:
    CSSStyleSheet(Ref<StyleSheetContents>&&, Node* ownerNode);

    bool isCSSStyleSheet() const final { return true; }
    String type() const final { return "text/css"_s; }

    const Ref<StyleSheetContents> m_contents;
    bool m_isDisabled { false };
    bool m_wasConstructedByJS { false };
    String m_title;
    MediaQueries m_mediaQueries;

    // The collector asks for the opaque root from its own threads.
    mutable Lock m_opaqueRootLockForGC;
    Node* m_ownerNode WTF_GUARDED_BY_LOCK(m_opaqueRootLockForGC);

    mutable RefPtr<MediaList> m_mediaCSSOMWrapper;
    mutable Vector<RefPtr<CSSRule>> m_childRuleCSSOMWrappers;
    const std::unique_ptr<CSSRuleList> m_ruleListCSSOMWrapper;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::CSSStyleSheet)
    static bool isType(const WebCore::StyleSheet& styleSheet) { return styleSheet.isCSSStyleSheet(); }
SPECIALIZE_TYPE_TRAITS_END()

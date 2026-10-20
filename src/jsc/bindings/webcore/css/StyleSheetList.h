#pragma once

#include "ScriptWrappable.h"
#include <wtf/Forward.h>
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>
#include <wtf/WeakPtr.h>

namespace WebCore {

class CSSStyleSheet;
class Document;
class Node;
class ShadowRoot;
class StyleSheet;
class WeakPtrImplWithEventTargetData;

class StyleSheetList final : public ScriptWrappable, public RefCounted<StyleSheetList> {
    WTF_MAKE_TZONE_ALLOCATED(StyleSheetList);
public:
    static Ref<StyleSheetList> create(Document& document) { return adoptRef(*new StyleSheetList(document)); }
    static Ref<StyleSheetList> create(ShadowRoot& shadowRoot) { return adoptRef(*new StyleSheetList(shadowRoot)); }
    WEBCORE_EXPORT ~StyleSheetList();

    bool isSupportedPropertyIndex(unsigned index) const { return index < length(); }
    WEBCORE_EXPORT unsigned length() const;
    WEBCORE_EXPORT RefPtr<StyleSheet> item(unsigned index) const;

    Node* ownerNode() const;

private:
    StyleSheetList(Document&);
    StyleSheetList(ShadowRoot&);

    Vector<Ref<CSSStyleSheet>> styleSheets() const;

    WeakPtr<Document, WeakPtrImplWithEventTargetData> m_document;
    WeakPtr<ShadowRoot, WeakPtrImplWithEventTargetData> m_shadowRoot;
};

} // namespace WebCore

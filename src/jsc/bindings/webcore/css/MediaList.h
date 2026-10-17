#pragma once

#include "ScriptWrappable.h"
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class CSSMediaRule;
class CSSRule;
class CSSStyleSheet;

template<typename> class ExceptionOr;

// A media query list, as Bun's CSS parser serializes and judges it.
struct MediaQueries {
    String text;
    // There is no viewport: only the media type counts. A query with a feature in it is false, as in jsdom.
    bool matches { true };

    static MediaQueries parse(const String&);
};

class MediaList final : public ScriptWrappable, public RefCounted<MediaList> {
    WTF_MAKE_TZONE_ALLOCATED(MediaList);
public:
    static Ref<MediaList> create(CSSStyleSheet* parentSheet) { return adoptRef(*new MediaList(parentSheet)); }
    static Ref<MediaList> create(CSSMediaRule* parentRule) { return adoptRef(*new MediaList(parentRule)); }
    WEBCORE_EXPORT ~MediaList();

    WEBCORE_EXPORT unsigned length() const;
    bool isSupportedPropertyIndex(unsigned index) const { return index < length(); }
    WEBCORE_EXPORT String item(unsigned index) const;
    WEBCORE_EXPORT ExceptionOr<void> deleteMedium(const String& oldMedium);
    WEBCORE_EXPORT void appendMedium(const String& newMedium);

    WEBCORE_EXPORT String mediaText() const;
    WEBCORE_EXPORT void setMediaText(const String&);

    CSSRule* parentRule() const;
    CSSStyleSheet* parentStyleSheet() const { return m_parentStyleSheet; }
    void detachFromParent();

private:
    explicit MediaList(CSSStyleSheet* parentSheet);
    explicit MediaList(CSSMediaRule* parentRule);

    Vector<String> queries() const;

    CSSStyleSheet* m_parentStyleSheet { nullptr };
    CSSMediaRule* m_parentRule { nullptr };
    String m_detachedText;
};

} // namespace WebCore

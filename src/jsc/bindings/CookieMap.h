#pragma once
#include "root.h"

#include "Cookie.h"
#include "ExceptionOr.h"
#include <wtf/HashMap.h>
#include <wtf/Vector.h>
#include <wtf/RefCounted.h>
#include <wtf/text/WTFString.h>
#include <variant>

namespace WebCore {

struct CookieStoreGetOptions {
    String name {};
    String url {};
};

struct CookieStoreDeleteOptions {
    String name {};
    String domain {};
    String path {};
};

class CookieMap : public RefCounted<CookieMap> {
public:
    ~CookieMap();

    static ExceptionOr<Ref<CookieMap>> create(std::variant<Vector<Vector<String>>, HashMap<String, String>, String>&& init, bool throwOnInvalidCookieString = true);

    std::optional<String> get(const String& name) const;
    Vector<Ref<Cookie>> getAllChanges() const;

    bool has(const String& name) const;

    void set(Ref<Cookie>);

    Ref<CookieMap> clone();

    ExceptionOr<void> remove(const CookieStoreDeleteOptions& options);

    JSC::JSValue toJSON(JSC::JSGlobalObject*) const;
    size_t size() const;
    size_t memoryCost() const;

    class Iterator {
    public:
        explicit Iterator(CookieMap&);

        std::optional<KeyValuePair<String, String>> next();

    private:
        Ref<CookieMap> m_target;
        size_t m_modifiedIndex { 0 };
        size_t m_originalIndex { 0 };
    };

    Iterator createIterator() { return Iterator { *this }; }
    Iterator createIterator(const void*) { return Iterator { *this }; }

private:
    CookieMap();
    CookieMap(Vector<KeyValuePair<String, String>>&& cookies);

    void removeOriginal(const String& name);
    void setModified(const String& name, RefPtr<Cookie>&&);

    // Ordered storage; removed originals are tombstoned (null key) so indices stay valid.
    Vector<KeyValuePair<String, String>> m_originalCookies;
    Vector<RefPtr<Cookie>> m_modifiedCookies;

    // Name -> index. Originals may repeat a name (get() = first, remove() evicts all).
    HashMap<String, Vector<size_t>> m_originalIndex;
    HashMap<String, size_t> m_modifiedIndex;
};

} // namespace WebCore

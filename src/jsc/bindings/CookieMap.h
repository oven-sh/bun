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

    void removeInternal(const String& name);
    void appendModified(Ref<Cookie>&&);

    // Insertion-ordered storage. removeInternal() tombstones in place (null key / null
    // RefPtr) so the hashed indices below stay valid; readers skip tombstones.
    Vector<KeyValuePair<String, String>> m_originalCookies;
    Vector<RefPtr<Cookie>> m_modifiedCookies;

    // Name -> indices in m_originalCookies. A Cookie header may legally repeat a name;
    // get() returns the first, remove() evicts all.
    HashMap<String, Vector<size_t>> m_originalIndex;
    // Name -> index in m_modifiedCookies. set()/remove() keep at most one live entry
    // per name.
    HashMap<String, size_t> m_modifiedIndex;
};

} // namespace WebCore

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

    // Define a simple struct to hold the key-value pair

    static ExceptionOr<Ref<CookieMap>> create(std::variant<Vector<Vector<String>>, HashMap<String, String>, String>&& init, bool throwOnInvalidCookieString = true);

    std::optional<String> get(const String& name) const;
    Vector<KeyValuePair<String, String>> getAll() const;
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
        bool m_inOriginals { false };
    };

    Iterator createIterator() { return Iterator { *this }; }
    Iterator createIterator(const void*) { return Iterator { *this }; }

private:
    CookieMap();
    CookieMap(Vector<KeyValuePair<String, String>>&& cookies);

    void buildOriginalIndex();
    void removeInternal(const String& name);
    void appendModified(Ref<Cookie>&&);
    void compactModified();

    // Holes are marked with key.isNull().
    Vector<KeyValuePair<String, String>> m_originalCookies;
    // Holes are marked with nullptr.
    Vector<RefPtr<Cookie>> m_modifiedCookies;

    // name -> first index; duplicates chained via m_originalNext (empty when none).
    HashMap<String, size_t> m_originalIndex;
    Vector<size_t> m_originalNext;
    size_t m_originalHoles { 0 };

    // name -> index; unique because set()/remove() clear the prior entry first.
    HashMap<String, size_t> m_modifiedIndex;
};

} // namespace WebCore

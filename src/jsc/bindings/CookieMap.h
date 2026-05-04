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
    Vector<Ref<Cookie>> getAllChanges() const { return m_modifiedCookies; }

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
        size_t m_index { 0 };
    };

    Iterator createIterator() { return Iterator { *this }; }
    Iterator createIterator(const void*) { return Iterator { *this }; }

private:
    CookieMap();
    CookieMap(Vector<Ref<Cookie>>&& cookies);
    CookieMap(Vector<KeyValuePair<String, String>>&& cookies);

    void removeInternal(const String& name);

    Vector<KeyValuePair<String, String>> m_originalCookies;
    Vector<Ref<Cookie>> m_modifiedCookies;
};

} // namespace WebCore

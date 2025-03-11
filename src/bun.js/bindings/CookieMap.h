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
    String name;
    String url;
};

struct CookieStoreDeleteOptions {
    String name;
    String domain;
    String path;
};

class CookieMap : public RefCounted<CookieMap> {
public:
    ~CookieMap();

    static ExceptionOr<Ref<CookieMap>> create(std::variant<Vector<Vector<String>>, HashMap<String, String>, String>&& init);

    RefPtr<Cookie> get(const String& name) const;
    RefPtr<Cookie> get(const CookieStoreGetOptions& options) const;

    Vector<Ref<Cookie>> getAll(const String& name) const;
    Vector<Ref<Cookie>> getAll(const CookieStoreGetOptions& options) const;

    bool has(const String& name, const String& value = String()) const;

    void set(const String& name, const String& value);
    void set(RefPtr<Cookie>);

    void remove(const String& name);
    void remove(const CookieStoreDeleteOptions& options);

    String toString() const;
    size_t size() const { return m_cookies.size(); }
    size_t memoryCost() const;

    // Define a simple struct to hold the key-value pair
    struct KeyValuePair {
        KeyValuePair(const String& k, const String& v)
            : key(k)
            , value(v)
        {
        }

        String key;
        String value;
    };

    class Iterator {
    public:
        explicit Iterator(CookieMap&);

        std::optional<KeyValuePair> next();

    private:
        Ref<CookieMap> m_target;
        size_t m_index { 0 };
    };

    Iterator createIterator() { return Iterator { *this }; }
    Iterator createIterator(const void*) { return Iterator { *this }; }

private:
    CookieMap();
    CookieMap(const String& cookieString);
    CookieMap(const HashMap<String, String>& pairs);
    CookieMap(const Vector<Vector<String>>& pairs);

    Vector<Ref<Cookie>> getCookiesMatchingDomain(const String& domain) const;
    Vector<Ref<Cookie>> getCookiesMatchingPath(const String& path) const;

    Vector<Ref<Cookie>> m_cookies;
};

} // namespace WebCore

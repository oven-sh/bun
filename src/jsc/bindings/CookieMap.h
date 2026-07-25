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
    CookieMap(Vector<KeyValuePair<String, String>>&& cookies);

    // An entry is either an original cookie from construction (name/value pair) or one backed
    // by a Cookie object from set(). For the latter, value() reads through the Cookie so that
    // mutating the Cookie after set() is observable.
    struct Entry {
        KeyValuePair<String, String> pair;
        RefPtr<Cookie> cookie;

        Entry(KeyValuePair<String, String>&& p)
            : pair(WTF::move(p))
        {
        }
        Entry(Ref<Cookie>&& c)
            : cookie(WTF::move(c))
        {
        }
        const String& name() const { return cookie ? cookie->name() : pair.key; }
        const String& value() const { return cookie ? cookie->value() : pair.value; }
    };

    // Live entries in insertion order; drives iteration, get()/has()/size()/toJSON().
    Vector<Entry> m_entries;
    // Cookies to emit as Set-Cookie headers (from set() and delete()).
    Vector<Ref<Cookie>> m_modifiedCookies;
};

} // namespace WebCore

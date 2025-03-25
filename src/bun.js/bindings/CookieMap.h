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
    RefPtr<Cookie> getModifiedEntry(const String& name) const;
    Vector<KeyValuePair<String, String>> getAll() const;
    HashMap<String, Ref<Cookie>> getAllModifiedItems() const { return m_modifiedCookies; }

    bool has(const String& name) const;

    void set(const String& name, const String& value, bool httpOnly, bool partitioned, double maxAge);
    void set(const String& name, const String& value);
    void set(Ref<Cookie>);

    void remove(const String& name);
    void remove(const CookieStoreDeleteOptions& options);

    JSC::JSValue toJSON(JSC::JSGlobalObject*) const;
    size_t size() const;
    size_t memoryCost() const;

    class Iterator {
    public:
        explicit Iterator(CookieMap&);

        std::optional<KeyValuePair<String, String>> next();

    private:
        Ref<CookieMap> m_target;
        Vector<KeyValuePair<String, String>> m_items;
        size_t m_index { 0 };
    };

    Iterator createIterator() { return Iterator { *this }; }
    Iterator createIterator(const void*) { return Iterator { *this }; }

private:
    CookieMap();
    CookieMap(WTF::Vector<Ref<Cookie>>&& cookies);
    CookieMap(HashMap<String, String>&& cookies);

    HashMap<String, String> m_originalCookies;
    HashMap<String, Ref<Cookie>> m_modifiedCookies;
};

} // namespace WebCore

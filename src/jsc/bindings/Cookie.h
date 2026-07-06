#pragma once
#include "root.h"

#include "ExceptionOr.h"
#include <wtf/RefCounted.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

enum class CookieSameSite : uint8_t {
    Strict,
    Lax,
    None
};

JSC::JSValue toJS(JSC::JSGlobalObject*, CookieSameSite);

struct CookieInit {
    String name = String();
    String value = String();
    String domain = String();
    String path = "/"_s;

    int64_t expires = emptyExpiresAtValue;
    bool secure = false;
    CookieSameSite sameSite = CookieSameSite::Lax;
    bool httpOnly = false;
    double maxAge = std::numeric_limits<double>::quiet_NaN();
    bool partitioned = false;
    static constexpr int64_t emptyExpiresAtValue = std::numeric_limits<int64_t>::min();

    static std::optional<CookieInit> fromJS(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue value);
    static std::optional<CookieInit> fromJS(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue input, String name, String cookieValue);
};

class Cookie : public RefCounted<Cookie> {
public:
    ~Cookie();
    static constexpr int64_t emptyExpiresAtValue = std::numeric_limits<int64_t>::min();
    static ExceptionOr<Ref<Cookie>> create(const String& name, const String& value,
        const String& domain, const String& path,
        int64_t expires, bool secure, CookieSameSite sameSite,
        bool httpOnly, double maxAge, bool partitioned);

    // "Set a cookie": additionally enforces the __Secure-/__Host- name prefix rules.
    static ExceptionOr<Ref<Cookie>> create(const CookieInit& init);

    static ExceptionOr<Ref<Cookie>> parse(StringView cookieString);

    static String serialize(JSC::VM& vm, const std::span<const Ref<Cookie>> cookies);

    const String& name() const { return m_name; }

    const String& value() const { return m_value; }
    void setValue(const String& value) { m_value = value; }

    const String& domain() const { return m_domain; }
    ExceptionOr<void> setDomain(const String& domain)
    {
        if (!isValidCookieDomain(domain)) {
            return Exception { TypeError, "Invalid cookie domain: contains invalid characters"_s };
        }
        if (auto validation = validatePrefixDomain(m_name, domain); validation.hasException()) {
            return validation.releaseException();
        }
        m_domain = domain;
        return {};
    }

    const String& path() const { return m_path; }
    ExceptionOr<void> setPath(const String& path)
    {
        if (auto validation = validateCookiePath(path); validation.hasException()) {
            return validation.releaseException();
        }
        if (auto validation = validatePrefixPath(m_name, path); validation.hasException()) {
            return validation.releaseException();
        }
        m_path = path;
        return {};
    }

    int64_t expires() const { return m_expires; }
    void setExpires(int64_t ms) { m_expires = ms; }
    bool hasExpiry() const { return m_expires != emptyExpiresAtValue; }

    bool secure() const { return m_secure; }
    ExceptionOr<void> setSecure(bool secure)
    {
        if (auto validation = validatePrefixSecure(m_name, secure); validation.hasException()) {
            return validation.releaseException();
        }
        m_secure = secure;
        return {};
    }

    CookieSameSite sameSite() const { return m_sameSite; }
    void setSameSite(CookieSameSite sameSite) { m_sameSite = sameSite; }

    bool httpOnly() const { return m_httpOnly; }
    void setHttpOnly(bool httpOnly) { m_httpOnly = httpOnly; }

    double maxAge() const { return m_maxAge; }
    void setMaxAge(double maxAge) { m_maxAge = maxAge; }

    bool partitioned() const { return m_partitioned; }
    void setPartitioned(bool partitioned) { m_partitioned = partitioned; }

    bool isExpired() const;

    void appendTo(JSC::VM& vm, StringBuilder& builder) const;
    String toString(JSC::VM& vm) const;
    JSC::JSValue toJSON(JSC::VM& vm, JSC::JSGlobalObject*) const;
    size_t memoryCost() const;

    static bool isValidCookieName(const String& name);
    static bool isValidCookieValue(const String& value); // values are uri component encoded, so this isn't needed
    static bool isValidCookiePath(const String& path);
    static bool isValidCookieDomain(const String& domain);

    static ExceptionOr<void> validateCookiePath(const String& path);
    static ExceptionOr<void> validateNamePrefix(const String& name, const String& domain, const String& path, bool secure);

private:
    // A cookie's name is immutable, so each attribute the name's prefix constrains is checked
    // on its own: at creation, when it is set on a CookieMap, and whenever it is mutated.
    static ExceptionOr<void> validatePrefixSecure(const String& name, bool secure);
    static ExceptionOr<void> validatePrefixDomain(const String& name, const String& domain);
    static ExceptionOr<void> validatePrefixPath(const String& name, const String& path);

    Cookie(const String& name, const String& value,
        const String& domain, const String& path,
        int64_t expires, bool secure, CookieSameSite sameSite,
        bool httpOnly, double maxAge, bool partitioned);

    String m_name;
    String m_value;
    String m_domain;
    String m_path;
    int64_t m_expires = Cookie::emptyExpiresAtValue;
    bool m_secure = false;
    CookieSameSite m_sameSite = CookieSameSite::Lax;
    bool m_httpOnly = false;
    double m_maxAge = std::numeric_limits<double>::quiet_NaN();
    bool m_partitioned = false;
};

} // namespace WebCore

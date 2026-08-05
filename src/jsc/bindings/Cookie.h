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

    static ExceptionOr<Ref<Cookie>> create(const CookieInit& init)
    {
        if (!isValidCookieName(init.name)) {
            return Exception { TypeError, "Invalid cookie name: contains invalid characters"_s };
        }
        if (!isValidCookiePath(init.path)) {
            return Exception { TypeError, "Invalid cookie path: contains invalid characters"_s };
        }
        if (!isValidCookieDomain(init.domain)) {
            return Exception { TypeError, "Invalid cookie domain: contains invalid characters"_s };
        }
        if (auto validation = validateAttributes(init.name, init.domain, init.path, init.secure, init.sameSite, init.partitioned); validation.hasException()) {
            return validation.releaseException();
        }

        return create(init.name, init.value, init.domain, init.path, init.expires, init.secure, init.sameSite, init.httpOnly, init.maxAge, init.partitioned);
    }

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
        if (!domain.isEmpty() && hasHostPrefix(m_name)) {
            return Exception { TypeError, hostPrefixDomainMessage };
        }
        m_domain = domain;
        return {};
    }

    const String& path() const { return m_path; }
    ExceptionOr<void> setPath(const String& path)
    {
        if (!isValidCookiePath(path)) {
            return Exception { TypeError, "Invalid cookie path: contains invalid characters"_s };
        }
        if (path != "/"_s && hasHostPrefix(m_name)) {
            return Exception { TypeError, hostPrefixPathMessage };
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
        if (!secure) {
            if (auto validation = validateSecureRequired(m_name, m_sameSite, m_partitioned); validation.hasException()) {
                return validation.releaseException();
            }
        }
        m_secure = secure;
        return {};
    }

    CookieSameSite sameSite() const { return m_sameSite; }
    ExceptionOr<void> setSameSite(CookieSameSite sameSite)
    {
        if (sameSite == CookieSameSite::None && !m_secure) {
            return Exception { TypeError, sameSiteNoneSecureMessage };
        }
        m_sameSite = sameSite;
        return {};
    }

    bool httpOnly() const { return m_httpOnly; }
    void setHttpOnly(bool httpOnly) { m_httpOnly = httpOnly; }

    double maxAge() const { return m_maxAge; }
    void setMaxAge(double maxAge) { m_maxAge = maxAge; }

    bool partitioned() const { return m_partitioned; }
    ExceptionOr<void> setPartitioned(bool partitioned)
    {
        if (partitioned && !m_secure) {
            return Exception { TypeError, partitionedSecureMessage };
        }
        m_partitioned = partitioned;
        return {};
    }

    bool isExpired() const;

    void appendTo(JSC::VM& vm, StringBuilder& builder) const;
    String toString(JSC::VM& vm) const;
    JSC::JSValue toJSON(JSC::VM& vm, JSC::JSGlobalObject*) const;
    size_t memoryCost() const;

    static bool isValidCookieName(const String& name);
    static bool isValidCookiePath(const String& path);
    static bool isValidCookieDomain(const String& domain);

    static bool hasHostPrefix(const String& name);
    static bool hasSecurePrefix(const String& name);

    static ExceptionOr<void> validateAttributes(const String& name, const String& domain, const String& path, bool secure, CookieSameSite sameSite, bool partitioned);

    static constexpr auto sameSiteNoneSecureMessage = "Invalid cookie: \"sameSite: none\" requires secure: true"_s;
    static constexpr auto partitionedSecureMessage = "Invalid cookie: \"partitioned: true\" requires secure: true"_s;
    static constexpr auto hostPrefixSecureMessage = "Invalid cookie: \"__Host-\" name prefix requires secure: true"_s;
    static constexpr auto securePrefixSecureMessage = "Invalid cookie: \"__Secure-\" name prefix requires secure: true"_s;
    static constexpr auto hostPrefixDomainMessage = "Invalid cookie: \"__Host-\" name prefix does not allow a domain"_s;
    static constexpr auto hostPrefixPathMessage = "Invalid cookie: \"__Host-\" name prefix requires path: \"/\""_s;

private:
    static ExceptionOr<void> validateSecureRequired(const String& name, CookieSameSite sameSite, bool partitioned);

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

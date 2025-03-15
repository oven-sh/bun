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

class Cookie : public RefCounted<Cookie> {
public:
    ~Cookie();

    static Ref<Cookie> create(const String& name, const String& value,
        const String& domain, const String& path,
        double expires, bool secure, CookieSameSite sameSite,
        bool httpOnly, double maxAge, bool partitioned);

    static ExceptionOr<Ref<Cookie>> parse(const String& cookieString);
    static Ref<Cookie> from(const String& name, const String& value,
        const String& domain, const String& path,
        double expires, bool secure, CookieSameSite sameSite,
        bool httpOnly, double maxAge, bool partitioned);

    static String serialize(JSC::VM& vm, const Vector<Ref<Cookie>>& cookies);

    const String& name() const { return m_name; }
    void setName(const String& name) { m_name = name; }

    const String& value() const { return m_value; }
    void setValue(const String& value) { m_value = value; }

    const String& domain() const { return m_domain; }
    void setDomain(const String& domain) { m_domain = domain; }

    const String& path() const { return m_path; }
    void setPath(const String& path) { m_path = path; }

    double expires() const { return m_expires; }
    void setExpires(double expires) { m_expires = expires; }

    bool secure() const { return m_secure; }
    void setSecure(bool secure) { m_secure = secure; }

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

private:
    Cookie(const String& name, const String& value,
        const String& domain, const String& path,
        double expires, bool secure, CookieSameSite sameSite,
        bool httpOnly, double maxAge, bool partitioned);

    String m_name;
    String m_value;
    String m_domain;
    String m_path;
    double m_expires;
    bool m_secure;
    CookieSameSite m_sameSite;
    bool m_httpOnly;
    double m_maxAge;
    bool m_partitioned;
};

} // namespace WebCore

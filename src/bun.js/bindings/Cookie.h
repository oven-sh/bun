#pragma once
#include "root.h"

#include "ExceptionOr.h"
#include <wtf/RefCounted.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

enum class CookieSameSite {
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
        double expires, bool secure, CookieSameSite sameSite);

    static ExceptionOr<Ref<Cookie>> parse(const String& cookieString);
    static Ref<Cookie> from(const String& name, const String& value,
        const String& domain, const String& path,
        double expires, bool secure, CookieSameSite sameSite);

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

    void appendTo(StringBuilder& builder) const;
    String toString() const;
    JSC::JSValue toJSON(JSC::JSGlobalObject*) const;
    size_t memoryCost() const;

private:
    Cookie(const String& name, const String& value,
        const String& domain, const String& path,
        double expires, bool secure, CookieSameSite sameSite);

    String m_name;
    String m_value;
    String m_domain;
    String m_path;
    double m_expires;
    bool m_secure;
    CookieSameSite m_sameSite;
};

} // namespace WebCore

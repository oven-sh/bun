#include "Cookie.h"
#include "JSCookie.h"
#include "helpers.h"

namespace WebCore {

extern "C" JSC::EncodedJSValue Cookie__create(JSDOMGlobalObject* globalObject, const ZigString* name, const ZigString* value, const ZigString* domain, const ZigString* path, double expires, bool secure, int32_t sameSite)
{
    String nameStr = Zig::toString(*name);
    String valueStr = Zig::toString(*value);
    String domainStr = Zig::toString(*domain);
    String pathStr = Zig::toString(*path);

    CookieSameSite sameSiteEnum;
    switch (sameSite) {
    case 0:
        sameSiteEnum = CookieSameSite::Strict;
        break;
    case 1:
        sameSiteEnum = CookieSameSite::Lax;
        break;
    case 2:
        sameSiteEnum = CookieSameSite::None;
        break;
    default:
        sameSiteEnum = CookieSameSite::Strict;
    }

    auto result = Cookie::create(nameStr, valueStr, domainStr, pathStr, expires, secure, sameSiteEnum);
    return JSC::JSValue::encode(WebCore::toJSNewlyCreated(globalObject, globalObject, WTFMove(result)));
}

extern "C" WebCore::Cookie* Cookie__fromJS(JSC::EncodedJSValue value)
{
    return WebCoreCast<WebCore::JSCookie, WebCore::Cookie>(value);
}

Cookie::~Cookie() = default;

Cookie::Cookie(const String& name, const String& value,
    const String& domain, const String& path,
    double expires, bool secure, CookieSameSite sameSite)
    : m_name(name)
    , m_value(value)
    , m_domain(domain)
    , m_path(path.isEmpty() ? "/"_s : path)
    , m_expires(expires)
    , m_secure(secure)
    , m_sameSite(sameSite)
{
}

Ref<Cookie> Cookie::create(const String& name, const String& value,
    const String& domain, const String& path,
    double expires, bool secure, CookieSameSite sameSite)
{
    return adoptRef(*new Cookie(name, value, domain, path, expires, secure, sameSite));
}

Ref<Cookie> Cookie::from(const String& name, const String& value,
    const String& domain, const String& path,
    double expires, bool secure, CookieSameSite sameSite)
{
    return create(name, value, domain, path, expires, secure, sameSite);
}

ExceptionOr<Ref<Cookie>> Cookie::parse(const String& cookieString)
{
    // TODO: Implement cookie string parsing logic
    // This is left as a TODO per instructions in CLAUDE.md

    // For now, return a dummy cookie
    return adoptRef(*new Cookie("name"_s, "value"_s, String(), "/"_s, 0, false, CookieSameSite::Strict));
}

String Cookie::toString() const
{
    StringBuilder builder;
    appendTo(builder);
    return builder.toString();
}

void Cookie::appendTo(StringBuilder& builder) const
{
    // Name=Value is the basic format
    builder.append(m_name);
    builder.append('=');
    builder.append(m_value);

    // Add domain if present
    if (!m_domain.isEmpty()) {
        builder.append("; Domain="_s);
        builder.append(m_domain);
    }

    // Add path
    builder.append("; Path="_s);
    builder.append(m_path);

    // Add expires if present (not 0)
    if (m_expires != 0) {
        builder.append("; Expires="_s);
        // Note: In a real implementation, this would convert the timestamp to a proper date string
        builder.append(String::number(m_expires));
    }

    // Add secure flag if true
    if (m_secure)
        builder.append("; Secure"_s);

    // Add SameSite directive
    builder.append("; SameSite="_s);
    switch (m_sameSite) {
    case CookieSameSite::Strict:
        builder.append("Strict"_s);
        break;
    case CookieSameSite::Lax:
        builder.append("Lax"_s);
        break;
    case CookieSameSite::None:
        builder.append("None"_s);
        break;
    }
}

size_t Cookie::memoryCost() const
{
    size_t cost = sizeof(Cookie);
    cost += m_name.sizeInBytes();
    cost += m_value.sizeInBytes();
    cost += m_domain.sizeInBytes();
    cost += m_path.sizeInBytes();
    return cost;
}

} // namespace WebCore

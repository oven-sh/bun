#include "CookieMap.h"
#include "JSCookieMap.h"
#include "helpers.h"
#include <wtf/text/ParsingUtilities.h>

namespace WebCore {

extern "C" JSC::EncodedJSValue CookieMap__create(JSDOMGlobalObject* globalObject, const ZigString* initStr)
{
    String str = Zig::toString(*initStr);
    auto result = CookieMap::create(std::variant<Vector<Vector<String>>, HashMap<String, String>, String>(str));
    return JSC::JSValue::encode(WebCore::toJSNewlyCreated(globalObject, globalObject, result.releaseReturnValue()));
}

extern "C" WebCore::CookieMap* CookieMap__fromJS(JSC::EncodedJSValue value)
{
    return WebCoreCast<WebCore::JSCookieMap, WebCore::CookieMap>(value);
}

CookieMap::~CookieMap() = default;

CookieMap::CookieMap()
{
}

CookieMap::CookieMap(const String& cookieString)
{
    if (cookieString.isEmpty())
        return;

    // Parse cookie string and add each cookie to the map
    // For now, this is a simple implementation that splits on semicolons
    Vector<String> pairs = cookieString.split(';');
    for (auto& pair : pairs) {
        pair = pair.trim(isASCIIWhitespace<UChar>);
        size_t equalsPos = pair.find('=');
        if (equalsPos != notFound) {
            String name = pair.substring(0, equalsPos);
            String value = pair.substring(equalsPos + 1);
            if (!name.isEmpty()) {
                auto cookie = Cookie::create(name, value, String(), "/"_s, 0, false, CookieSameSite::Strict);
                m_cookies.append(cookie.ptr());
            }
        }
    }
}

CookieMap::CookieMap(const HashMap<String, String>& pairs)
{
    for (auto& entry : pairs) {
        auto cookie = Cookie::create(entry.key, entry.value, String(), "/"_s, 0, false, CookieSameSite::Strict);
        m_cookies.append(cookie.ptr());
    }
}

CookieMap::CookieMap(const Vector<Vector<String>>& pairs)
{
    for (const auto& pair : pairs) {
        if (pair.size() == 2) {
            auto cookie = Cookie::create(pair[0], pair[1], String(), "/"_s, 0, false, CookieSameSite::Strict);
            m_cookies.append(cookie.ptr());
        }
    }
}

ExceptionOr<Ref<CookieMap>> CookieMap::create(std::variant<Vector<Vector<String>>, HashMap<String, String>, String>&& variant)
{
    auto visitor = WTF::makeVisitor(
        [&](const Vector<Vector<String>>& pairs) -> ExceptionOr<Ref<CookieMap>> {
            return adoptRef(*new CookieMap(pairs));
        },
        [&](const HashMap<String, String>& pairs) -> ExceptionOr<Ref<CookieMap>> {
            return adoptRef(*new CookieMap(pairs));
        },
        [&](const String& cookieString) -> ExceptionOr<Ref<CookieMap>> {
            return adoptRef(*new CookieMap(cookieString));
        });

    return std::visit(visitor, variant);
}

RefPtr<Cookie> CookieMap::get(const String& name) const
{
    // Return the first cookie with the matching name
    for (auto& cookie : m_cookies) {
        if (cookie->name() == name)
            return cookie;
    }
    return nullptr;
}

RefPtr<Cookie> CookieMap::get(const CookieStoreGetOptions& options) const
{
    // If name is provided, use that for lookup
    if (!options.name.isEmpty())
        return get(options.name);

    // If url is provided, use that for lookup
    if (!options.url.isEmpty()) {
        // TODO: Implement URL-based cookie lookup
        // This would involve parsing the URL, extracting the domain, and
        // finding the first cookie that matches that domain
    }

    return nullptr;
}

Vector<Ref<Cookie>> CookieMap::getAll(const String& name) const
{
    // Return all cookies with the matching name
    Vector<Ref<Cookie>> result;
    for (auto& cookie : m_cookies) {
        if (cookie->name() == name)
            result.append(cookie);
    }
    return result;
}

Vector<Ref<Cookie>> CookieMap::getAll(const CookieStoreGetOptions& options) const
{
    // If name is provided, use that for lookup
    if (!options.name.isEmpty())
        return getAll(options.name);

    // If url is provided, use that for lookup
    if (!options.url.isEmpty()) {
        // TODO: Implement URL-based cookie lookup
        // This would involve parsing the URL, extracting the domain, and
        // finding all cookies that match that domain
    }

    return Vector<Ref<Cookie>>();
}

bool CookieMap::has(const String& name, const String& value) const
{
    for (auto& cookie : m_cookies) {
        if (cookie->name() == name && (value.isEmpty() || cookie->value() == value))
            return true;
    }
    return false;
}

void CookieMap::set(const String& name, const String& value)
{
    // Remove any existing cookies with the same name
    remove(name);

    // Add the new cookie
    auto cookie = Cookie::create(name, value, String(), "/"_s, 0, false, CookieSameSite::Strict);
    m_cookies.append(cookie.ptr());
}

void CookieMap::set(RefPtr<Cookie> cookie)
{
    if (!cookie)
        return;

    // Remove any existing cookies with the same name
    remove(cookie->name());

    // Add the new cookie
    m_cookies.append(cookie);
}

void CookieMap::remove(const String& name)
{
    m_cookies.removeAllMatching([&name](const auto& cookie) {
        return cookie->name() == name;
    });
}

void CookieMap::remove(const CookieStoreDeleteOptions& options)
{
    String name = options.name;
    String domain = options.domain;
    String path = options.path;

    m_cookies.removeAllMatching([&](const auto& cookie) {
        if (cookie->name() != name)
            return false;

        // If domain is specified, it must match
        if (!domain.isNull() && cookie->domain() != domain)
            return false;

        // If path is specified, it must match
        if (!path.isNull() && cookie->path() != path)
            return false;

        return true;
    });
}

Vector<Ref<Cookie>> CookieMap::getCookiesMatchingDomain(const String& domain) const
{
    Vector<Ref<Cookie>> result;
    for (auto& cookie : m_cookies) {
        if (cookie->domain().isEmpty() || cookie->domain() == domain) {
            result.append(cookie);
        }
    }
    return result;
}

Vector<Ref<Cookie>> CookieMap::getCookiesMatchingPath(const String& path) const
{
    Vector<Ref<Cookie>> result;
    for (auto& cookie : m_cookies) {
        // Simple path matching logic - a cookie matches if its path is a prefix of the requested path
        if (path.startsWith(cookie->path())) {
            result.append(cookie);
        }
    }
    return result;
}

String CookieMap::toString() const
{
    if (m_cookies.isEmpty())
        return emptyString();

    StringBuilder builder;
    bool first = true;

    for (auto& cookie : m_cookies) {
        if (!first)
            builder.append("; "_s);

        builder.append(cookie->name());
        builder.append('=');
        builder.append(cookie->value());

        first = false;
    }

    return builder.toString();
}

size_t CookieMap::memoryCost() const
{
    size_t cost = sizeof(CookieMap);
    for (auto& cookie : m_cookies) {
        cost += cookie->memoryCost();
    }
    return cost;
}

std::optional<CookieMap::KeyValuePair> CookieMap::Iterator::next()
{
    auto& cookies = m_target->m_cookies;
    if (m_index >= cookies.size())
        return std::nullopt;

    auto& cookie = cookies[m_index++];
    return KeyValuePair(cookie->name(), cookie->value());
}

CookieMap::Iterator::Iterator(CookieMap& cookieMap)
    : m_target(cookieMap)
{
}

} // namespace WebCore

#include "CookieMap.h"
#include "JSCookieMap.h"
#include "helpers.h"
#include <wtf/text/ParsingUtilities.h>
#include <JavaScriptCore/ObjectConstructor.h>

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

    Vector<String> pairs = cookieString.split(';');
    for (auto& pair : pairs) {
        pair = pair.trim(isASCIIWhitespace<UChar>);
        if (pair.isEmpty())
            continue;
            
        size_t equalsPos = pair.find('=');
        if (equalsPos == notFound)
            continue;
            
        String name = pair.substring(0, equalsPos).trim(isASCIIWhitespace<UChar>);
        String value = pair.substring(equalsPos + 1).trim(isASCIIWhitespace<UChar>);
        
        auto cookie = Cookie::create(name, value, String(), "/"_s, 0, false, CookieSameSite::Lax, false, 0, false);
        m_cookies.append(WTFMove(cookie));
    }
}

CookieMap::CookieMap(const HashMap<String, String>& pairs)
{
    for (auto& entry : pairs) {
        auto cookie = Cookie::create(entry.key, entry.value, String(), "/"_s, 0, false, CookieSameSite::Lax,
            false, 0, false);
        m_cookies.append(WTFMove(cookie));
    }
}

CookieMap::CookieMap(const Vector<Vector<String>>& pairs)
{
    for (const auto& pair : pairs) {
        if (pair.size() == 2) {
            auto cookie = Cookie::create(pair[0], pair[1], String(), "/"_s, 0, false, CookieSameSite::Lax, false, 0, false);
            m_cookies.append(WTFMove(cookie));
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
            return RefPtr<Cookie>(cookie.ptr());
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

void CookieMap::set(const String& name, const String& value, bool httpOnly, bool partitioned, double maxAge)
{
    // Remove any existing cookies with the same name
    remove(name);

    // Add the new cookie with proper settings
    auto cookie = Cookie::create(name, value, String(), "/"_s, 0, false, CookieSameSite::Strict,
        httpOnly, maxAge, partitioned);
    m_cookies.append(WTFMove(cookie));
}

// Maintain backward compatibility with code that uses the old signature
void CookieMap::set(const String& name, const String& value)
{
    // Remove any existing cookies with the same name
    remove(name);

    // Add the new cookie
    auto cookie = Cookie::create(name, value, String(), "/"_s, 0, false, CookieSameSite::Strict, false, 0, false);
    m_cookies.append(WTFMove(cookie));
}

void CookieMap::set(Ref<Cookie> cookie)
{
    // Remove any existing cookies with the same name
    remove(cookie->name());

    // Add the new cookie
    m_cookies.append(WTFMove(cookie));
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
        const auto& cookieDomain = cookie->domain();
        if (cookieDomain.isEmpty() || cookieDomain == domain) {
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

String CookieMap::toString(JSC::VM& vm) const
{
    if (m_cookies.isEmpty())
        return emptyString();

    StringBuilder builder;
    bool first = true;

    for (auto& cookie : m_cookies) {
        if (!first)
            builder.append("; "_s);

        cookie->appendTo(vm, builder);

        first = false;
    }

    return builder.toString();
}

JSC::JSValue CookieMap::toJSON(JSC::JSGlobalObject* globalObject) const
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Create an array of cookie entries
    auto* array = JSC::constructEmptyArray(globalObject, nullptr, m_cookies.size());
    RETURN_IF_EXCEPTION(scope, JSC::jsNull());

    unsigned index = 0;
    for (const auto& cookie : m_cookies) {
        // For each cookie, create a [name, cookie JSON] entry
        auto* entryArray = JSC::constructEmptyArray(globalObject, nullptr, 2);
        RETURN_IF_EXCEPTION(scope, JSC::jsNull());

        entryArray->putDirectIndex(globalObject, 0, JSC::jsString(vm, cookie->name()));
        RETURN_IF_EXCEPTION(scope, JSC::jsNull());

        entryArray->putDirectIndex(globalObject, 1, cookie->toJSON(vm, globalObject));
        RETURN_IF_EXCEPTION(scope, JSC::jsNull());

        array->putDirectIndex(globalObject, index++, entryArray);
        RETURN_IF_EXCEPTION(scope, JSC::jsNull());
    }

    return array;
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
    return KeyValuePair(cookie->name(), cookie.ptr());
}

CookieMap::Iterator::Iterator(CookieMap& cookieMap)
    : m_target(cookieMap)
{
}

} // namespace WebCore

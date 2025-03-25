#include "CookieMap.h"
#include "JSCookieMap.h"
#include <bun-uws/src/App.h>
#include "helpers.h"
#include <wtf/text/ParsingUtilities.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "HTTPParsers.h"
#include "decodeURIComponentSIMD.h"
#include "BunString.h"
namespace WebCore {

template<bool isSSL>
void CookieMap__writeFetchHeadersToUWSResponse(CookieMap* cookie_map, JSC::JSGlobalObject* global_this, uWS::HttpResponse<isSSL>* res)
{
    // Loop over modified cookies and write Set-Cookie headers to the response
    for (auto& cookie : cookie_map->getAllChanges()) {
        auto utf8 = cookie->toString(global_this->vm()).utf8();
        res->writeHeader("Set-Cookie", utf8.data());
    }
}
extern "C" void CookieMap__write(CookieMap* cookie_map, JSC::JSGlobalObject* global_this, bool ssl_enabled, void* arg2)
{
    if (ssl_enabled) {
        CookieMap__writeFetchHeadersToUWSResponse<true>(cookie_map, global_this, reinterpret_cast<uWS::HttpResponse<true>*>(arg2));
    } else {
        CookieMap__writeFetchHeadersToUWSResponse<false>(cookie_map, global_this, reinterpret_cast<uWS::HttpResponse<false>*>(arg2));
    }
}

extern "C" void CookieMap__ref(CookieMap* cookie_map)
{
    cookie_map->ref();
}

extern "C" void CookieMap__deref(CookieMap* cookie_map)
{
    cookie_map->deref();
}

CookieMap::~CookieMap() = default;

CookieMap::CookieMap()
{
}

CookieMap::CookieMap(Vector<Ref<Cookie>>&& cookies)
    : m_modifiedCookies(WTFMove(cookies))
{
}

CookieMap::CookieMap(Vector<KeyValuePair<String, String>>&& cookies)
    : m_originalCookies(WTFMove(cookies))
{
}

ExceptionOr<Ref<CookieMap>> CookieMap::create(std::variant<Vector<Vector<String>>, HashMap<String, String>, String>&& variant, bool throwOnInvalidCookieString)
{
    auto visitor = WTF::makeVisitor(
        [&](const Vector<Vector<String>>& pairs) -> ExceptionOr<Ref<CookieMap>> {
            Vector<Ref<Cookie>> cookies;
            for (const auto& pair : pairs) {
                if (pair.size() == 2) {
                    if (!pair[1].isEmpty() && !isValidHTTPHeaderValue(pair[1])) {
                        if (throwOnInvalidCookieString) {
                            return Exception { TypeError, "Invalid cookie string: cookie value is not valid"_s };
                        } else {
                            continue;
                        }
                    }

                    auto cookie = Cookie::create(pair[0], pair[1], String(), "/"_s, Cookie::emptyExpiresAtValue, false, CookieSameSite::Lax, false, 0, false);
                    cookies.append(WTFMove(cookie));
                } else if (throwOnInvalidCookieString) {
                    return Exception { TypeError, "Invalid cookie string: expected name=value pair"_s };
                }
            }
            return adoptRef(*new CookieMap(WTFMove(cookies)));
        },
        [&](const HashMap<String, String>& pairs) -> ExceptionOr<Ref<CookieMap>> {
            Vector<Ref<Cookie>> cookies;
            for (const auto& entry : pairs) {
                if (!entry.value.isEmpty() && !isValidHTTPHeaderValue(entry.value)) {
                    if (throwOnInvalidCookieString) {
                        return Exception { TypeError, "Invalid cookie string: cookie value is not valid"_s };
                    } else {
                        continue;
                    }
                }
                auto cookie = Cookie::create(entry.key, entry.value, String(), "/"_s, Cookie::emptyExpiresAtValue, false, CookieSameSite::Lax, false, 0, false);
                cookies.append(WTFMove(cookie));
            }

            return adoptRef(*new CookieMap(WTFMove(cookies)));
        },
        [&](const String& cookieString) -> ExceptionOr<Ref<CookieMap>> {
            StringView forCookieHeader = cookieString;
            if (forCookieHeader.isEmpty()) {
                return adoptRef(*new CookieMap());
            }

            auto pairs = forCookieHeader.split(';');
            Vector<KeyValuePair<String, String>> cookies;

            bool hasAnyPercentEncoded = forCookieHeader.find('%') != notFound;
            for (auto pair : pairs) {
                String name = ""_s;
                String value = ""_s;

                auto equalsPos = pair.find('=');
                if (equalsPos == notFound) {
                    continue;
                }

                auto nameView = pair.substring(0, equalsPos).trim(isASCIIWhitespace<UChar>);
                auto valueView = pair.substring(equalsPos + 1).trim(isASCIIWhitespace<UChar>);

                if (nameView.isEmpty()) {
                    continue;
                }

                if (hasAnyPercentEncoded) {
                    Bun::UTF8View utf8View(nameView);
                    name = Bun::decodeURIComponentSIMD(utf8View.bytes());
                } else {
                    name = nameView.toString();
                }

                if (hasAnyPercentEncoded) {
                    Bun::UTF8View utf8View(valueView);
                    value = Bun::decodeURIComponentSIMD(utf8View.bytes());
                } else {
                    value = valueView.toString();
                }

                cookies.append(KeyValuePair<String, String>(name, value));
            }

            return adoptRef(*new CookieMap(WTFMove(cookies)));
        });

    return std::visit(visitor, variant);
}

std::optional<String> CookieMap::get(const String& name) const
{
    auto modifiedCookieIndex = m_modifiedCookies.findIf([&](auto& cookie) {
        return cookie->name() == name;
    });
    if (modifiedCookieIndex != notFound) {
        // a set cookie with an empty value is treated as not existing, because that is what delete() sets
        if (m_modifiedCookies[modifiedCookieIndex]->value().isEmpty()) {
            return std::nullopt;
        }
        return std::optional<String>(m_modifiedCookies[modifiedCookieIndex]->value());
    }
    auto originalCookieIndex = m_originalCookies.findIf([&](auto& cookie) {
        return cookie.key == name;
    });
    if (originalCookieIndex != notFound) {
        return std::optional<String>(m_originalCookies[originalCookieIndex].value);
    }
    return std::nullopt;
}

std::optional<Ref<Cookie>> CookieMap::getModifiedEntry(const String& name) const
{
    auto modifiedCookieIndex = m_modifiedCookies.findIf([&](auto& cookie) {
        return cookie->name() == name;
    });
    if (modifiedCookieIndex != notFound) {
        return m_modifiedCookies[modifiedCookieIndex];
    }
    return std::nullopt;
}

Vector<KeyValuePair<String, String>> CookieMap::getAll() const
{
    Vector<KeyValuePair<String, String>> all;
    for (const auto& cookie : m_modifiedCookies) {
        if (cookie->value().isEmpty()) continue;
        all.append(KeyValuePair<String, String>(cookie->name(), cookie->value()));
    }
    for (const auto& cookie : m_originalCookies) {
        all.append(KeyValuePair<String, String>(cookie.key, cookie.value));
    }
    return all;
}

bool CookieMap::has(const String& name) const
{
    return get(name).has_value();
}

void CookieMap::removeInternal(const String& name)
{
    // Remove any existing matching cookies
    m_originalCookies.removeAllMatching([&](auto& cookie) {
        return cookie.key == name;
    });
    m_modifiedCookies.removeAllMatching([&](auto& cookie) {
        return cookie->name() == name;
    });
}

void CookieMap::set(const String& name, const String& value, bool httpOnly, bool partitioned, double maxAge)
{
    removeInternal(name);

    // Add the new cookie with proper settings
    auto cookie = Cookie::create(name, value, String(), "/"_s, Cookie::emptyExpiresAtValue, false, CookieSameSite::Strict,
        httpOnly, maxAge, partitioned);
    m_modifiedCookies.append(WTFMove(cookie));
}

void CookieMap::set(const String& name, const String& value)
{
    // Add the new cookie
    auto cookie = Cookie::create(name, value, String(), "/"_s, Cookie::emptyExpiresAtValue, false, CookieSameSite::Strict, false, std::numeric_limits<double>::quiet_NaN(), false);
    m_modifiedCookies.append(WTFMove(cookie));
}

void CookieMap::set(Ref<Cookie> cookie)
{
    removeInternal(cookie->name());
    // Add the new cookie
    m_modifiedCookies.append(WTFMove(cookie));
}

void CookieMap::remove(const String& name)
{
    removeInternal(name);

    // Add the new cookie
    auto cookie = Cookie::create(name, ""_s, String(), "/"_s, 1, false, CookieSameSite::Lax, false, std::numeric_limits<double>::quiet_NaN(), false);
    m_modifiedCookies.append(WTFMove(cookie));
}

void CookieMap::remove(const CookieStoreDeleteOptions& options)
{
    String name = options.name;
    String domain = options.domain;
    String path = options.path;

    // Add the new cookie
    auto cookie = Cookie::create(name, ""_s, domain, path, 1, false, CookieSameSite::Lax, false, std::numeric_limits<double>::quiet_NaN(), false);
    m_modifiedCookies.append(WTFMove(cookie));
}

size_t CookieMap::size() const
{
    size_t size = 0;
    for (const auto& cookie : m_modifiedCookies) {
        if (cookie->value().isEmpty()) continue;
        size += 1;
    }
    size += m_originalCookies.size();
    return size;
}

JSC::JSValue CookieMap::toJSON(JSC::JSGlobalObject* globalObject) const
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Create an array of cookie entries
    auto* array = JSC::constructEmptyArray(globalObject, nullptr, size());
    RETURN_IF_EXCEPTION(scope, JSC::jsNull());

    unsigned index = 0;
    for (const auto& cookie : m_modifiedCookies) {
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
    for (const auto& cookie : m_originalCookies) {
        auto* entryArray = JSC::constructEmptyArray(globalObject, nullptr, 2);
        RETURN_IF_EXCEPTION(scope, JSC::jsNull());

        entryArray->putDirectIndex(globalObject, 0, JSC::jsString(vm, cookie.key));
        RETURN_IF_EXCEPTION(scope, JSC::jsNull());

        entryArray->putDirectIndex(globalObject, 1, JSC::jsString(vm, cookie.value));
        RETURN_IF_EXCEPTION(scope, JSC::jsNull());

        array->putDirectIndex(globalObject, index++, entryArray);
    }

    return array;
}

size_t CookieMap::memoryCost() const
{
    size_t cost = sizeof(CookieMap);
    for (auto& cookie : m_originalCookies) {
        cost += cookie.key.sizeInBytes();
        cost += cookie.value.sizeInBytes();
    }
    for (auto& cookie : m_modifiedCookies) {
        cost += cookie->name().sizeInBytes();
        cost += cookie->value().sizeInBytes();
    }
    return cost;
}

std::optional<KeyValuePair<String, String>> CookieMap::Iterator::next()
{
    if (m_index >= m_items.size())
        return std::nullopt;

    return m_items[m_index++];
}

CookieMap::Iterator::Iterator(CookieMap& cookieMap)
    : m_target(cookieMap)
    , m_items(cookieMap.getAll())
{
}

} // namespace WebCore

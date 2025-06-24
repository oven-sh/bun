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
            Vector<KeyValuePair<String, String>> cookies;
            for (const auto& pair : pairs) {
                if (pair.size() == 2) {
                    cookies.append(KeyValuePair<String, String>(pair[0], pair[1]));
                } else if (throwOnInvalidCookieString) {
                    return Exception { TypeError, "Invalid cookie string: expected name=value pair"_s };
                }
            }
            return adoptRef(*new CookieMap(WTFMove(cookies)));
        },
        [&](const HashMap<String, String>& pairs) -> ExceptionOr<Ref<CookieMap>> {
            Vector<KeyValuePair<String, String>> cookies;
            for (const auto& entry : pairs) {
                cookies.append(KeyValuePair<String, String>(entry.key, entry.value));
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

                auto nameView = pair.substring(0, equalsPos).trim(isASCIIWhitespace<char16_t>);
                auto valueView = pair.substring(equalsPos + 1).trim(isASCIIWhitespace<char16_t>);

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

void CookieMap::set(Ref<Cookie> cookie)
{
    removeInternal(cookie->name());
    // Add the new cookie
    m_modifiedCookies.append(WTFMove(cookie));
}

ExceptionOr<void> CookieMap::remove(const CookieStoreDeleteOptions& options)
{
    removeInternal(options.name);

    String name = options.name;
    String domain = options.domain;
    String path = options.path;

    // Add the new cookie
    auto cookie_exception = Cookie::create(name, ""_s, domain, path, 1, false, CookieSameSite::Lax, false, std::numeric_limits<double>::quiet_NaN(), false);
    if (cookie_exception.hasException()) {
        return cookie_exception.releaseException();
    }
    auto cookie = cookie_exception.releaseReturnValue();
    m_modifiedCookies.append(WTFMove(cookie));
    return {};
}

Ref<CookieMap> CookieMap::clone()
{
    auto clone = adoptRef(*new CookieMap());
    clone->m_originalCookies = m_originalCookies;
    clone->m_modifiedCookies = m_modifiedCookies;
    return clone;
}

size_t
CookieMap::size() const
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

    // Create an object to hold cookie key-value pairs
    auto* object = JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Add modified cookies to the object
    for (const auto& cookie : m_modifiedCookies) {
        if (!cookie->value().isEmpty()) {
            object->putDirect(vm, JSC::Identifier::fromString(vm, cookie->name()), JSC::jsString(vm, cookie->value()));
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    // Add original cookies to the object
    for (const auto& cookie : m_originalCookies) {
        // Skip if this cookie name was already added from modified cookies
        if (!object->hasProperty(globalObject, JSC::Identifier::fromString(vm, cookie.key))) {
            object->putDirect(vm, JSC::Identifier::fromString(vm, cookie.key), JSC::jsString(vm, cookie.value));
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    return object;
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
    while (m_index < m_target->m_modifiedCookies.size() + m_target->m_originalCookies.size()) {
        if (m_index >= m_target->m_modifiedCookies.size()) {
            return m_target->m_originalCookies[(m_index++) - m_target->m_modifiedCookies.size()];
        }

        auto result = m_target->m_modifiedCookies[m_index++];
        if (result->value().isEmpty()) {
            continue; // deleted; skip
        }

        return KeyValuePair<String, String>(result->name(), result->value());
    }
    return std::nullopt;
}

CookieMap::Iterator::Iterator(CookieMap& cookieMap)
    : m_target(cookieMap)
{
}

} // namespace WebCore

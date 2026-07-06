#include "CookieMap.h"
#include "JSCookieMap.h"
#include <bun-uws/src/App.h>
#include <bun-uws/src/Http3Response.h>
#include "helpers.h"
#include <wtf/text/ParsingUtilities.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "HTTPParsers.h"
#include "decodeURIComponentSIMD.h"
#include "BunString.h"
#include <wtf/HashSet.h>
namespace WebCore {

template<typename Res>
static void CookieMap__writeFetchHeadersToUWSResponse(CookieMap* cookie_map, JSC::JSGlobalObject* global_this, Res* res)
{
    auto& vm = JSC::getVM(global_this);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // Loop over modified cookies and write Set-Cookie headers to the response
    for (auto& cookie : cookie_map->getAllChanges()) {
        auto utf8 = cookie->toString(global_this->vm()).utf8();
        RETURN_IF_EXCEPTION(scope, );
        res->writeHeader("Set-Cookie", utf8.data());
    }
}
extern "C" void CookieMap__write(CookieMap* cookie_map, JSC::JSGlobalObject* global_this, UWSResponseKind kind, void* arg2)
{
    switch (kind) {
    case UWSResponseKind::TCP:
        CookieMap__writeFetchHeadersToUWSResponse(cookie_map, global_this, reinterpret_cast<uWS::HttpResponse<false>*>(arg2));
        break;
    case UWSResponseKind::SSL:
        CookieMap__writeFetchHeadersToUWSResponse(cookie_map, global_this, reinterpret_cast<uWS::HttpResponse<true>*>(arg2));
        break;
    case UWSResponseKind::H3:
        CookieMap__writeFetchHeadersToUWSResponse(cookie_map, global_this, reinterpret_cast<uWS::Http3Response*>(arg2));
        break;
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

CookieMap::CookieMap(Vector<KeyValuePair<String, String>>&& cookies)
    : m_originalCookies(WTF::move(cookies))
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
            return adoptRef(*new CookieMap(WTF::move(cookies)));
        },
        [&](const HashMap<String, String>& pairs) -> ExceptionOr<Ref<CookieMap>> {
            Vector<KeyValuePair<String, String>> cookies;
            for (const auto& entry : pairs) {
                cookies.append(KeyValuePair<String, String>(entry.key, entry.value));
            }

            return adoptRef(*new CookieMap(WTF::move(cookies)));
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

                name = nameView.toString();

                if (hasAnyPercentEncoded) {
                    Bun::UTF8View utf8View(valueView);
                    value = Bun::decodeURIComponentSIMD(utf8View.bytes());
                } else {
                    value = valueView.toString();
                }

                cookies.append(KeyValuePair<String, String>(name, value));
            }

            return adoptRef(*new CookieMap(WTF::move(cookies)));
        });

    return std::visit(visitor, variant);
}

std::optional<String> CookieMap::get(const String& name) const
{
    auto modifiedCookieIndex = m_modifiedCookies.findIf([&](auto& entry) {
        return entry.cookie->name() == name;
    });
    if (modifiedCookieIndex != notFound) {
        if (m_modifiedCookies[modifiedCookieIndex].isRemoval) {
            return std::nullopt;
        }
        return std::optional<String>(m_modifiedCookies[modifiedCookieIndex].cookie->value());
    }
    auto originalCookieIndex = m_originalCookies.findIf([&](auto& cookie) {
        return cookie.key == name;
    });
    if (originalCookieIndex != notFound) {
        return std::optional<String>(m_originalCookies[originalCookieIndex].value);
    }
    return std::nullopt;
}

Vector<Ref<Cookie>> CookieMap::getAllChanges() const
{
    Vector<Ref<Cookie>> changes;
    changes.reserveInitialCapacity(m_modifiedCookies.size());
    for (const auto& entry : m_modifiedCookies) {
        changes.append(entry.cookie);
    }
    return changes;
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
    m_modifiedCookies.removeAllMatching([&](auto& entry) {
        return entry.cookie->name() == name;
    });
}

void CookieMap::set(Ref<Cookie> cookie)
{
    removeInternal(cookie->name());
    // Add the new cookie
    m_modifiedCookies.append(ModifiedCookie { WTF::move(cookie), false });
}

ExceptionOr<void> CookieMap::remove(const CookieStoreDeleteOptions& options)
{
    removeInternal(options.name);

    String name = options.name;
    String domain = options.domain;
    String path = options.path;
    bool secure = name.startsWithIgnoringASCIICase("__Secure-"_s) || name.startsWithIgnoringASCIICase("__Host-"_s);

    // Add the new cookie
    auto cookie_exception = Cookie::create(name, ""_s, domain, path, 1, secure, CookieSameSite::Lax, false, std::numeric_limits<double>::quiet_NaN(), false);
    if (cookie_exception.hasException()) {
        return cookie_exception.releaseException();
    }
    auto cookie = cookie_exception.releaseReturnValue();
    m_modifiedCookies.append(ModifiedCookie { WTF::move(cookie), true });
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
    for (const auto& entry : m_modifiedCookies) {
        if (entry.isRemoval) continue;
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

    HashSet<String> seenKeys;

    // Add modified cookies to the object
    for (const auto& entry : m_modifiedCookies) {
        if (!entry.isRemoval) {
            seenKeys.add(entry.cookie->name());
            object->putDirectMayBeIndex(globalObject, JSC::Identifier::fromString(vm, entry.cookie->name()), JSC::jsString(vm, entry.cookie->value()));
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    // Add original cookies to the object
    for (const auto& cookie : m_originalCookies) {
        // Skip if this cookie name was already added from modified cookies
        if (seenKeys.add(cookie.key).isNewEntry) {
            object->putDirectMayBeIndex(globalObject, JSC::Identifier::fromString(vm, cookie.key), JSC::jsString(vm, cookie.value));
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
    for (auto& entry : m_modifiedCookies) {
        cost += entry.cookie->name().sizeInBytes();
        cost += entry.cookie->value().sizeInBytes();
    }
    return cost;
}

std::optional<KeyValuePair<String, String>> CookieMap::Iterator::next()
{
    while (m_index < m_target->m_modifiedCookies.size() + m_target->m_originalCookies.size()) {
        if (m_index >= m_target->m_modifiedCookies.size()) {
            return m_target->m_originalCookies[(m_index++) - m_target->m_modifiedCookies.size()];
        }

        const auto& entry = m_target->m_modifiedCookies[m_index++];
        if (entry.isRemoval) {
            continue;
        }

        return KeyValuePair<String, String>(entry.cookie->name(), entry.cookie->value());
    }
    return std::nullopt;
}

CookieMap::Iterator::Iterator(CookieMap& cookieMap)
    : m_target(cookieMap)
{
}

} // namespace WebCore

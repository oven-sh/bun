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
    for (size_t i = 0; i < m_originalCookies.size(); ++i) {
        m_originalIndex.add(m_originalCookies[i].key, Vector<size_t> {}).iterator->value.append(i);
    }
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
    if (name.isNull())
        return std::nullopt;

    if (auto it = m_modifiedIndex.find(name); it != m_modifiedIndex.end()) {
        const auto& cookie = m_modifiedCookies[it->value];
        // delete() queues an empty-value tombstone; treat it as absent.
        if (cookie->value().isEmpty())
            return std::nullopt;
        return cookie->value();
    }

    if (auto it = m_originalIndex.find(name); it != m_originalIndex.end()) {
        return m_originalCookies[it->value.first()].value;
    }

    return std::nullopt;
}

Vector<Ref<Cookie>> CookieMap::getAllChanges() const
{
    Vector<Ref<Cookie>> result;
    result.reserveInitialCapacity(m_modifiedIndex.size());
    for (auto& cookie : m_modifiedCookies) {
        if (cookie)
            result.append(*cookie);
    }
    return result;
}

bool CookieMap::has(const String& name) const
{
    return get(name).has_value();
}

void CookieMap::removeOriginal(const String& name)
{
    if (auto indices = m_originalIndex.takeOptional(name)) {
        for (auto i : *indices)
            m_originalCookies[i].key = String();
    }
}

void CookieMap::setModified(const String& name, RefPtr<Cookie>&& cookie)
{
    if (auto it = m_modifiedIndex.find(name); it != m_modifiedIndex.end()) {
        m_modifiedCookies[it->value] = WTF::move(cookie);
        if (!m_modifiedCookies[it->value])
            m_modifiedIndex.remove(it);
        return;
    }
    if (!cookie)
        return;
    m_modifiedIndex.set(name, m_modifiedCookies.size());
    m_modifiedCookies.append(WTF::move(cookie));
}

void CookieMap::set(Ref<Cookie> cookie)
{
    const String& name = cookie->name();
    removeOriginal(name);
    setModified(name, WTF::move(cookie));
}

ExceptionOr<void> CookieMap::remove(const CookieStoreDeleteOptions& options)
{
    const String& name = options.name;
    const String& domain = options.domain;
    const String& path = options.path;

    if (!Cookie::isValidCookiePath(path))
        return Exception { TypeError, "Invalid cookie path: contains invalid characters"_s };
    if (!Cookie::isValidCookieDomain(domain))
        return Exception { TypeError, "Invalid cookie domain: contains invalid characters"_s };

    // Names the parser accepts but the Set-Cookie grammar rejects: evict, queue nothing.
    if (!Cookie::isValidCookieName(name)) {
        removeOriginal(name);
        setModified(name, nullptr);
        return {};
    }

    bool secure = name.startsWithIgnoringASCIICase("__Secure-"_s) || name.startsWithIgnoringASCIICase("__Host-"_s);
    auto cookieOr = Cookie::create(name, ""_s, domain, path, 1, secure, CookieSameSite::Lax, false, std::numeric_limits<double>::quiet_NaN(), false);
    if (cookieOr.hasException()) [[unlikely]]
        return cookieOr.releaseException();

    removeOriginal(name);
    setModified(name, cookieOr.releaseReturnValue());
    return {};
}

Ref<CookieMap> CookieMap::clone()
{
    auto clone = adoptRef(*new CookieMap());
    clone->m_originalCookies = m_originalCookies;
    clone->m_modifiedCookies = m_modifiedCookies;
    clone->m_originalIndex = m_originalIndex;
    clone->m_modifiedIndex = m_modifiedIndex;
    return clone;
}

size_t CookieMap::size() const
{
    size_t size = 0;
    for (const auto& cookie : m_originalCookies) {
        if (!cookie.key.isNull())
            size += 1;
    }
    for (const auto& entry : m_modifiedIndex) {
        if (!m_modifiedCookies[entry.value]->value().isEmpty())
            size += 1;
    }
    return size;
}

JSC::JSValue CookieMap::toJSON(JSC::JSGlobalObject* globalObject) const
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* object = JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    HashSet<String> seenKeys;

    for (const auto& cookie : m_modifiedCookies) {
        if (cookie && !cookie->value().isEmpty()) {
            seenKeys.add(cookie->name());
            object->putDirectMayBeIndex(globalObject, JSC::Identifier::fromString(vm, cookie->name()), JSC::jsString(vm, cookie->value()));
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    for (const auto& cookie : m_originalCookies) {
        if (cookie.key.isNull())
            continue;
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
    for (auto& cookie : m_modifiedCookies) {
        if (!cookie)
            continue;
        cost += cookie->name().sizeInBytes();
        cost += cookie->value().sizeInBytes();
    }
    cost += m_originalIndex.capacity() * (sizeof(String) + sizeof(Vector<size_t>));
    cost += m_modifiedIndex.capacity() * (sizeof(String) + sizeof(size_t));
    return cost;
}

std::optional<KeyValuePair<String, String>> CookieMap::Iterator::next()
{
    while (m_modifiedIndex < m_target->m_modifiedCookies.size()) {
        const auto& cookie = m_target->m_modifiedCookies[m_modifiedIndex++];
        if (!cookie || cookie->value().isEmpty())
            continue;
        return KeyValuePair<String, String>(cookie->name(), cookie->value());
    }
    while (m_originalIndex < m_target->m_originalCookies.size()) {
        const auto& pair = m_target->m_originalCookies[m_originalIndex++];
        if (pair.key.isNull())
            continue;
        return pair;
    }
    return std::nullopt;
}

CookieMap::Iterator::Iterator(CookieMap& cookieMap)
    : m_target(cookieMap)
{
}

} // namespace WebCore

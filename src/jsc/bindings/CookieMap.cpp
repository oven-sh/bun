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
    buildOriginalIndex();
}

void CookieMap::buildOriginalIndex()
{
    const size_t n = m_originalCookies.size();
    if (n == 0)
        return;
    m_originalIndex.reserveInitialCapacity(n);
    HashMap<String, size_t> tails;
    for (size_t i = 0; i < n; ++i) {
        const auto& key = m_originalCookies[i].key;
        if (key.isNull())
            continue;
        auto result = m_originalIndex.add(key, i);
        if (result.isNewEntry) [[likely]]
            continue;
        if (m_originalNext.isEmpty()) {
            m_originalNext.grow(n);
            for (auto& slot : m_originalNext)
                slot = notFound;
        }
        auto tail = tails.find(key);
        size_t prev = (tail == tails.end()) ? result.iterator->value : tail->value;
        m_originalNext[prev] = i;
        tails.set(key, i);
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

    auto modified = m_modifiedIndex.find(name);
    if (modified != m_modifiedIndex.end()) {
        const auto& cookie = m_modifiedCookies[modified->value];
        // a set cookie with an empty value is treated as not existing, because that is what delete() sets
        if (cookie->value().isEmpty())
            return std::nullopt;
        return std::optional<String>(cookie->value());
    }

    auto original = m_originalIndex.find(name);
    if (original != m_originalIndex.end())
        return std::optional<String>(m_originalCookies[original->value].value);

    return std::nullopt;
}

Vector<KeyValuePair<String, String>> CookieMap::getAll() const
{
    Vector<KeyValuePair<String, String>> all;
    for (const auto& cookie : m_modifiedCookies) {
        if (!cookie || cookie->value().isEmpty()) continue;
        all.append(KeyValuePair<String, String>(cookie->name(), cookie->value()));
    }
    for (const auto& cookie : m_originalCookies) {
        if (cookie.key.isNull()) continue;
        all.append(KeyValuePair<String, String>(cookie.key, cookie.value));
    }
    return all;
}

Vector<Ref<Cookie>> CookieMap::getAllChanges() const
{
    Vector<Ref<Cookie>> changes;
    changes.reserveInitialCapacity(m_modifiedIndex.size());
    for (const auto& cookie : m_modifiedCookies) {
        if (!cookie) continue;
        changes.append(*cookie);
    }
    return changes;
}

bool CookieMap::has(const String& name) const
{
    return get(name).has_value();
}

void CookieMap::removeInternal(const String& name)
{
    if (name.isNull())
        return;

    auto original = m_originalIndex.find(name);
    if (original != m_originalIndex.end()) {
        size_t i = original->value;
        m_originalIndex.remove(original);
        do {
            m_originalCookies[i].key = String();
            m_originalCookies[i].value = String();
            ++m_originalHoles;
            i = m_originalNext.isEmpty() ? notFound : m_originalNext[i];
        } while (i != notFound);
    }

    auto modified = m_modifiedIndex.find(name);
    if (modified != m_modifiedIndex.end()) {
        m_modifiedCookies[modified->value] = nullptr;
        m_modifiedIndex.remove(modified);
        while (!m_modifiedCookies.isEmpty() && !m_modifiedCookies.last())
            m_modifiedCookies.removeLast();
    }
}

void CookieMap::compactModified()
{
    size_t write = 0;
    for (size_t read = 0; read < m_modifiedCookies.size(); ++read) {
        if (!m_modifiedCookies[read])
            continue;
        if (read != write)
            m_modifiedCookies[write] = WTF::move(m_modifiedCookies[read]);
        const auto& name = m_modifiedCookies[write]->name();
        if (!name.isNull())
            m_modifiedIndex.set(name, write);
        ++write;
    }
    m_modifiedCookies.shrink(write);
}

void CookieMap::appendModified(Ref<Cookie>&& cookie)
{
    String name = cookie->name();
    m_modifiedCookies.append(WTF::move(cookie));
    if (!name.isNull())
        m_modifiedIndex.set(WTF::move(name), m_modifiedCookies.size() - 1);

    if (m_modifiedCookies.size() >= 16 && m_modifiedCookies.size() >= 2 * m_modifiedIndex.size())
        compactModified();
}

void CookieMap::set(Ref<Cookie> cookie)
{
    const String& name = cookie->name();
    if (!name.isNull()) {
        auto it = m_modifiedIndex.find(name);
        if (it != m_modifiedIndex.end()) {
            m_modifiedCookies[it->value] = WTF::move(cookie);
            return;
        }
    }
    removeInternal(name);
    appendModified(WTF::move(cookie));
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
    appendModified(cookie_exception.releaseReturnValue());
    return {};
}

Ref<CookieMap> CookieMap::clone()
{
    auto clone = adoptRef(*new CookieMap());
    clone->m_originalCookies = m_originalCookies;
    clone->m_originalIndex = m_originalIndex;
    clone->m_originalNext = m_originalNext;
    clone->m_originalHoles = m_originalHoles;
    clone->m_modifiedCookies = m_modifiedCookies;
    clone->m_modifiedIndex = m_modifiedIndex;
    return clone;
}

size_t
CookieMap::size() const
{
    size_t size = 0;
    for (const auto& cookie : m_modifiedCookies) {
        if (!cookie || cookie->value().isEmpty()) continue;
        size += 1;
    }
    size += m_originalCookies.size() - m_originalHoles;
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
    for (const auto& cookie : m_modifiedCookies) {
        if (cookie && !cookie->value().isEmpty()) {
            seenKeys.add(cookie->name());
            object->putDirectMayBeIndex(globalObject, JSC::Identifier::fromString(vm, cookie->name()), JSC::jsString(vm, cookie->value()));
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    // Add original cookies to the object
    for (const auto& cookie : m_originalCookies) {
        if (cookie.key.isNull())
            continue;
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
    cost += m_originalIndex.capacity() * (sizeof(String) + sizeof(size_t));
    cost += m_originalNext.capacity() * sizeof(size_t);
    cost += m_modifiedIndex.capacity() * (sizeof(String) + sizeof(size_t));
    for (auto& cookie : m_originalCookies) {
        cost += cookie.key.sizeInBytes();
        cost += cookie.value.sizeInBytes();
    }
    for (auto& cookie : m_modifiedCookies) {
        if (!cookie) continue;
        cost += cookie->name().sizeInBytes();
        cost += cookie->value().sizeInBytes();
    }
    return cost;
}

std::optional<KeyValuePair<String, String>> CookieMap::Iterator::next()
{
    if (!m_inOriginals) {
        while (m_modifiedIndex < m_target->m_modifiedCookies.size()) {
            const auto& cookie = m_target->m_modifiedCookies[m_modifiedIndex++];
            if (!cookie || cookie->value().isEmpty())
                continue;
            return KeyValuePair<String, String>(cookie->name(), cookie->value());
        }
        m_inOriginals = true;
    }
    while (m_originalIndex < m_target->m_originalCookies.size()) {
        const auto& cookie = m_target->m_originalCookies[m_originalIndex++];
        if (cookie.key.isNull())
            continue;
        return cookie;
    }
    return std::nullopt;
}

CookieMap::Iterator::Iterator(CookieMap& cookieMap)
    : m_target(cookieMap)
{
}

} // namespace WebCore

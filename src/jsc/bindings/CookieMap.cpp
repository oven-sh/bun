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
{
    m_entries.reserveInitialCapacity(cookies.size());
    for (auto& pair : cookies)
        m_entries.append(Entry { WTF::move(pair) });
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
    auto index = m_entries.findIf([&](auto& entry) { return entry.name() == name; });
    if (index == notFound)
        return std::nullopt;
    const auto& entry = m_entries[index];
    // A cookie set via set() whose value is empty is treated as absent, because that is how
    // delete() marks its Set-Cookie tombstone. Original (parsed) entries with an empty value
    // are still visible.
    if (entry.cookie && entry.cookie->value().isEmpty())
        return std::nullopt;
    return entry.value();
}

bool CookieMap::has(const String& name) const
{
    return get(name).has_value();
}

void CookieMap::set(Ref<Cookie> cookie)
{
    const auto& name = cookie->name();

    m_modifiedCookies.removeAllMatching([&](auto& c) { return c->name() == name; });

    // Map-like insertion order: update the existing entry in place, or append a new one.
    // An empty value is stored like any other; the empty-value skip in get()/size()/iteration
    // hides it, and a later mutation of the Cookie object surfaces it on every path.
    auto index = m_entries.findIf([&](auto& entry) { return entry.name() == name; });
    if (index == notFound) {
        m_entries.append(Entry { cookie.copyRef() });
    } else {
        m_entries[index].pair = {};
        m_entries[index].cookie = cookie.copyRef();
        for (size_t i = m_entries.size(); i-- > index + 1;) {
            if (m_entries[i].name() == name)
                m_entries.removeAt(i);
        }
    }

    m_modifiedCookies.append(WTF::move(cookie));
}

ExceptionOr<void> CookieMap::remove(const CookieStoreDeleteOptions& options)
{
    String name = options.name;
    String domain = options.domain;
    String path = options.path;
    bool secure = name.startsWithIgnoringASCIICase("__Secure-"_s) || name.startsWithIgnoringASCIICase("__Host-"_s);

    m_entries.removeAllMatching([&](auto& entry) { return entry.name() == name; });
    m_modifiedCookies.removeAllMatching([&](auto& c) { return c->name() == name; });

    auto cookie_exception = Cookie::create(name, ""_s, domain, path, 1, secure, CookieSameSite::Lax, false, std::numeric_limits<double>::quiet_NaN(), false);
    if (cookie_exception.hasException()) {
        return cookie_exception.releaseException();
    }
    auto cookie = cookie_exception.releaseReturnValue();
    m_modifiedCookies.append(WTF::move(cookie));
    return {};
}

Ref<CookieMap> CookieMap::clone()
{
    auto clone = adoptRef(*new CookieMap());
    clone->m_entries = m_entries;
    clone->m_modifiedCookies = m_modifiedCookies;
    return clone;
}

size_t
CookieMap::size() const
{
    size_t count = 0;
    for (const auto& entry : m_entries) {
        if (entry.cookie && entry.cookie->value().isEmpty())
            continue;
        count++;
    }
    return count;
}

JSC::JSValue CookieMap::toJSON(JSC::JSGlobalObject* globalObject) const
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* object = JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    HashSet<String> seenKeys;
    for (const auto& entry : m_entries) {
        if (entry.cookie && entry.cookie->value().isEmpty())
            continue;
        if (!seenKeys.add(entry.name()).isNewEntry)
            continue;
        object->putDirectMayBeIndex(globalObject, JSC::Identifier::fromString(vm, entry.name()), JSC::jsString(vm, entry.value()));
        RETURN_IF_EXCEPTION(scope, {});
    }

    return object;
}

size_t CookieMap::memoryCost() const
{
    size_t cost = sizeof(CookieMap);
    for (auto& entry : m_entries) {
        cost += entry.pair.key.sizeInBytes();
        cost += entry.pair.value.sizeInBytes();
    }
    for (auto& cookie : m_modifiedCookies) {
        cost += cookie->name().sizeInBytes();
        cost += cookie->value().sizeInBytes();
    }
    return cost;
}

std::optional<KeyValuePair<String, String>> CookieMap::Iterator::next()
{
    while (m_index < m_target->m_entries.size()) {
        const auto& entry = m_target->m_entries[m_index++];
        if (entry.cookie && entry.cookie->value().isEmpty())
            continue;
        return KeyValuePair<String, String>(entry.name(), entry.value());
    }
    return std::nullopt;
}

CookieMap::Iterator::Iterator(CookieMap& cookieMap)
    : m_target(cookieMap)
{
}

} // namespace WebCore

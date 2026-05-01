#include "Cookie.h"
#include "EncodeURIComponent.h"
#include "JSCookie.h"
#include "helpers.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/WallTime.h>
#include <wtf/text/StringToIntegerConversion.h>
#include <JavaScriptCore/DateInstance.h>
#include "HTTPParsers.h"
namespace WebCore {

extern "C" WebCore::Cookie* Cookie__fromJS(JSC::EncodedJSValue value)
{
    return WebCoreCast<WebCore::JSCookie, WebCore::Cookie>(value);
}

Cookie::~Cookie() = default;

Cookie::Cookie(const String& name, const String& value,
    const String& domain, const String& path,
    int64_t expires, bool secure, CookieSameSite sameSite,
    bool httpOnly, double maxAge, bool partitioned)
    : m_name(name)
    , m_value(value)
    , m_domain(domain)
    , m_path(path)
    , m_expires(expires)
    , m_secure(secure)
    , m_sameSite(sameSite)
    , m_httpOnly(httpOnly)
    , m_maxAge(maxAge)
    , m_partitioned(partitioned)
{
}

ExceptionOr<Ref<Cookie>> Cookie::create(const String& name, const String& value,
    const String& domain, const String& path,
    int64_t expires, bool secure, CookieSameSite sameSite,
    bool httpOnly, double maxAge, bool partitioned)
{
    if (!isValidCookieName(name)) {
        return Exception { TypeError, "Invalid cookie name: contains invalid characters"_s };
    }
    if (!isValidCookiePath(path)) {
        return Exception { TypeError, "Invalid cookie path: contains invalid characters"_s };
    }
    if (!isValidCookieDomain(domain)) {
        return Exception { TypeError, "Invalid cookie domain: contains invalid characters"_s };
    }
    return adoptRef(*new Cookie(name, value, domain, path, expires, secure, sameSite, httpOnly, maxAge, partitioned));
}

String Cookie::serialize(JSC::VM& vm, const std::span<const Ref<Cookie>> cookies)
{
    if (cookies.empty())
        return emptyString();

    StringBuilder builder;
    bool first = true;

    for (const auto& cookie : cookies) {
        if (!first)
            builder.append("; "_s);

        cookie->appendTo(vm, builder);
        first = false;
    }

    return builder.toString();
}

ExceptionOr<Ref<Cookie>> Cookie::parse(StringView cookieString)
{
    // RFC 6265 sec 4.1.1, RFC 2616 2.2 defines a cookie name consists of one char minimum, plus '='.
    if (cookieString.length() < 2) [[unlikely]] {
        return Exception { TypeError, "Invalid cookie string: empty"_s };
    }

    // Find the first name-value pair
    size_t firstSemicolonPos = cookieString.find(';');
    StringView cookiePair = firstSemicolonPos == notFound ? cookieString : cookieString.substring(0, firstSemicolonPos);

    size_t firstEqualsPos = cookiePair.find('=');
    if (firstEqualsPos == notFound) [[unlikely]] {
        return Exception { TypeError, "Invalid cookie string: no '=' found"_s };
    }

    String name = cookiePair.substring(0, firstEqualsPos).trim(isASCIIWhitespace<char16_t>).toString();
    if (name.isEmpty())
        return Exception { TypeError, "Invalid cookie string: name cannot be empty"_s };

    ASSERT(isValidHTTPHeaderValue(name));
    String value = cookiePair.substring(firstEqualsPos + 1).trim(isASCIIWhitespace<char16_t>).toString();

    // Default values
    String domain;
    String path = "/"_s;
    int64_t expires = Cookie::emptyExpiresAtValue;
    bool secure = false;
    CookieSameSite sameSite = CookieSameSite::Lax;
    bool httpOnly = false;
    double maxAge = std::numeric_limits<double>::quiet_NaN();
    bool partitioned = false;
    bool hasMaxAge = false;
    ASSERT(value.isEmpty() || isValidHTTPHeaderValue(value));
    // Parse attributes if there are any
    if (firstSemicolonPos != notFound) {
        auto attributesString = cookieString.substring(firstSemicolonPos + 1);

        for (auto attribute : attributesString.split(';')) {
            auto trimmedAttribute = attribute.trim(isASCIIWhitespace<char16_t>);
            size_t assignmentPos = trimmedAttribute.find('=');

            String attributeName;
            String attributeValue;

            if (assignmentPos != notFound) {
                attributeName = trimmedAttribute.substring(0, assignmentPos).trim(isASCIIWhitespace<char16_t>).convertToASCIILowercase();
                attributeValue = trimmedAttribute.substring(assignmentPos + 1).trim(isASCIIWhitespace<char16_t>).toString();
            } else {
                attributeName = trimmedAttribute.convertToASCIILowercase();
                attributeValue = emptyString();
            }

            if (attributeName == "domain"_s) {
                if (!attributeValue.isEmpty()) {
                    domain = attributeValue.convertToASCIILowercase();
                }
            } else if (attributeName == "path"_s) {
                if (!attributeValue.isEmpty() && attributeValue.startsWith('/'))
                    path = attributeValue;
            } else if (attributeName == "expires"_s && !hasMaxAge && !attributeValue.isEmpty()) {
                if (!attributeValue.is8Bit()) [[unlikely]] {
                    auto asLatin1 = attributeValue.latin1();
                    double parsed = WTF::parseDate({ reinterpret_cast<const Latin1Character*>(asLatin1.data()), asLatin1.length() });
                    if (std::isfinite(parsed)) {
                        expires = static_cast<int64_t>(parsed);
                    }
                } else {
                    auto nullTerminated = attributeValue.utf8();
                    double parsed = WTF::parseDate(std::span<const Latin1Character>(reinterpret_cast<const Latin1Character*>(nullTerminated.data()), nullTerminated.length()));
                    if (std::isfinite(parsed)) {
                        expires = static_cast<int64_t>(parsed);
                    }
                }
            } else if (attributeName == "max-age"_s) {
                if (auto parsed = WTF::parseIntegerAllowingTrailingJunk<int64_t>(attributeValue); parsed.has_value()) {
                    maxAge = static_cast<double>(parsed.value());
                    hasMaxAge = true;
                }
            } else if (attributeName == "secure"_s) {
                secure = true;
            } else if (attributeName == "httponly"_s) {
                httpOnly = true;
            } else if (attributeName == "partitioned"_s) {
                partitioned = true;
            } else if (attributeName == "samesite"_s) {
                if (WTF::equalIgnoringASCIICase(attributeValue, "strict"_s))
                    sameSite = CookieSameSite::Strict;
                else if (WTF::equalIgnoringASCIICase(attributeValue, "lax"_s))
                    sameSite = CookieSameSite::Lax;
                else if (WTF::equalIgnoringASCIICase(attributeValue, "none"_s))
                    sameSite = CookieSameSite::None;
            }
        }
    }

    return Cookie::create(name, value, domain, path, expires, secure, sameSite, httpOnly, maxAge, partitioned);
}

bool Cookie::isExpired() const
{
    if (m_expires == Cookie::emptyExpiresAtValue)
        return false; // Session cookie

    auto currentTime = WTF::WallTime::now().secondsSinceEpoch().seconds() * 1000.0;
    return currentTime > m_expires;
}

String Cookie::toString(JSC::VM& vm) const
{
    StringBuilder builder;
    appendTo(vm, builder);
    return builder.toString();
}

static inline bool isValidCharacterInCookieName(char16_t c)
{
    return (c >= 0x21 && c <= 0x3A) || (c == 0x3C) || (c >= 0x3E && c <= 0x7E);
}
bool Cookie::isValidCookieName(const String& name)
{
    // /^[\u0021-\u003A\u003C\u003E-\u007E]+$/
    if (name.length() == 0) return false; // disallow empty name
    if (name.is8Bit()) {
        for (auto c : name.span8()) {
            if (!isValidCharacterInCookieName(c)) return false;
        }
    } else {
        for (auto c : name.span16()) {
            if (!isValidCharacterInCookieName(c)) return false;
        }
    }
    return true;
}
static inline bool isValidCharacterInCookiePath(char16_t c)
{
    return (c >= 0x20 && c <= 0x3A) || (c >= 0x3D && c <= 0x7E);
}
bool Cookie::isValidCookiePath(const String& path)
{
    // /^[\u0020-\u003A\u003D-\u007E]*$/
    if (path.is8Bit()) {
        for (auto c : path.span8()) {
            if (!isValidCharacterInCookiePath(c)) return false;
        }
    } else {
        for (auto c : path.span16()) {
            if (!isValidCharacterInCookiePath(c)) return false;
        }
    }
    return true;
}

static inline bool isValidCharacterInCookieDomain(char16_t c)
{
    return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-';
}
bool Cookie::isValidCookieDomain(const String& domain)
{
    // TODO: /^([.]?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i
    // for now, require all characters to be [a-z0-9.-]
    if (domain.is8Bit()) {
        for (auto c : domain.span8()) {
            if (!isValidCharacterInCookieDomain(c)) return false;
        }
    } else {
        for (auto c : domain.span16()) {
            if (!isValidCharacterInCookieDomain(c)) return false;
        }
    }
    return true;
}

void Cookie::appendTo(JSC::VM& vm, StringBuilder& builder) const
{
    // Name=Value is the basic format
    builder.append(m_name);
    builder.append('=');
    auto result = encodeURIComponent(vm, m_value, builder);
    if (result.hasException()) {
        // m_value contained unpaired surrogate. oops!
        // fortunately, this never happens because the string has already had invalid surrogate pairs converted to the replacement character
    }

    // Add domain if present
    if (!m_domain.isEmpty()) {
        builder.append("; Domain="_s);
        builder.append(m_domain);
    }

    if (!m_path.isEmpty()) {
        builder.append("; Path="_s);
        builder.append(m_path);
    }

    // Add expires if present
    if (hasExpiry()) {
        builder.append("; Expires="_s);
        // In a real implementation, this would convert the timestamp to a proper date string
        // For now, just use a numeric timestamp
        WTF::GregorianDateTime dateTime;
        vm.dateCache.msToGregorianDateTime(m_expires, WTF::TimeType::UTCTime, dateTime);
        builder.append(WTF::makeRFC2822DateString(dateTime.weekDay(), dateTime.monthDay(), dateTime.month(), dateTime.year(), dateTime.hour(), dateTime.minute(), dateTime.second(), dateTime.utcOffsetInMinute()));
    }

    // Add Max-Age if present
    if (!std::isnan(m_maxAge)) {
        builder.append("; Max-Age="_s);
        builder.append(String::number(m_maxAge));
    }

    // Add secure flag if true
    if (m_secure)
        builder.append("; Secure"_s);

    // Add HttpOnly flag if true
    if (m_httpOnly)
        builder.append("; HttpOnly"_s);

    // Add Partitioned flag if true
    if (m_partitioned)
        builder.append("; Partitioned"_s);

    // Add SameSite directive

    switch (m_sameSite) {
    case CookieSameSite::Strict:
        builder.append("; SameSite=Strict"_s);
        break;
    case CookieSameSite::Lax:
        // lax is the default. but we still need to set it explicitly.
        // https://groups.google.com/a/chromium.org/g/blink-dev/c/AknSSyQTGYs/m/YKBxPCScCwAJ
        builder.append("; SameSite=Lax"_s);
        break;
    case CookieSameSite::None:
        builder.append("; SameSite=None"_s);
        break;
    }
}

JSC::JSValue Cookie::toJSON(JSC::VM& vm, JSC::JSGlobalObject* globalObject) const
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    RETURN_IF_EXCEPTION(scope, JSC::jsNull());

    auto& builtinNames = Bun::builtinNames(vm);

    object->putDirect(vm, vm.propertyNames->name, JSC::jsString(vm, m_name));
    object->putDirect(vm, vm.propertyNames->value, JSC::jsString(vm, m_value));

    if (!m_domain.isEmpty())
        object->putDirect(vm, builtinNames.domainPublicName(), JSC::jsString(vm, m_domain));

    object->putDirect(vm, builtinNames.pathPublicName(), JSC::jsString(vm, m_path));

    if (hasExpiry())
        object->putDirect(vm, builtinNames.expiresPublicName(), JSC::DateInstance::create(vm, globalObject->dateStructure(), m_expires));

    if (!std::isnan(m_maxAge))
        object->putDirect(vm, builtinNames.maxAgePublicName(), JSC::jsNumber(m_maxAge));

    object->putDirect(vm, builtinNames.securePublicName(), JSC::jsBoolean(m_secure));
    object->putDirect(vm, builtinNames.sameSitePublicName(), toJS(globalObject, m_sameSite));
    object->putDirect(vm, builtinNames.httpOnlyPublicName(), JSC::jsBoolean(m_httpOnly));
    object->putDirect(vm, builtinNames.partitionedPublicName(), JSC::jsBoolean(m_partitioned));

    return object;
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

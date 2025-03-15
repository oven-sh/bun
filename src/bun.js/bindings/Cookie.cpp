#include "Cookie.h"
#include "JSCookie.h"
#include "helpers.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/WallTime.h>
#include <wtf/text/StringToIntegerConversion.h>
namespace WebCore {

extern "C" JSC::EncodedJSValue Cookie__create(JSDOMGlobalObject* globalObject, const ZigString* name, const ZigString* value, const ZigString* domain, const ZigString* path, double expires, bool secure, int32_t sameSite, bool httpOnly, double maxAge, bool partitioned)
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

    auto result = Cookie::create(nameStr, valueStr, domainStr, pathStr, expires, secure, sameSiteEnum, httpOnly, maxAge, partitioned);
    return JSC::JSValue::encode(WebCore::toJSNewlyCreated(globalObject, globalObject, WTFMove(result)));
}

extern "C" WebCore::Cookie* Cookie__fromJS(JSC::EncodedJSValue value)
{
    return WebCoreCast<WebCore::JSCookie, WebCore::Cookie>(value);
}

Cookie::~Cookie() = default;

Cookie::Cookie(const String& name, const String& value,
    const String& domain, const String& path,
    double expires, bool secure, CookieSameSite sameSite,
    bool httpOnly, double maxAge, bool partitioned)
    : m_name(name)
    , m_value(value)
    , m_domain(domain)
    , m_path(path.isEmpty() ? "/"_s : path)
    , m_expires(expires)
    , m_secure(secure)
    , m_sameSite(sameSite)
    , m_httpOnly(httpOnly)
    , m_maxAge(maxAge)
    , m_partitioned(partitioned)
{
}

Ref<Cookie> Cookie::create(const String& name, const String& value,
    const String& domain, const String& path,
    double expires, bool secure, CookieSameSite sameSite,
    bool httpOnly, double maxAge, bool partitioned)
{
    return adoptRef(*new Cookie(name, value, domain, path, expires, secure, sameSite, httpOnly, maxAge, partitioned));
}

Ref<Cookie> Cookie::from(const String& name, const String& value,
    const String& domain, const String& path,
    double expires, bool secure, CookieSameSite sameSite,
    bool httpOnly, double maxAge, bool partitioned)
{
    return create(name, value, domain, path, expires, secure, sameSite, httpOnly, maxAge, partitioned);
}

String Cookie::serialize(JSC::VM& vm, const Vector<Ref<Cookie>>& cookies)
{
    if (cookies.isEmpty())
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

ExceptionOr<Ref<Cookie>> Cookie::parse(const String& cookieString)
{
    // Split the cookieString by semicolons
    Vector<String> parts = cookieString.split(';');

    if (parts.isEmpty())
        return Exception { TypeError, "Invalid cookie string: empty string"_s };

    // First part is the name-value pair
    String nameValueStr = parts[0].trim(isASCIIWhitespace<UChar>);
    size_t equalsPos = nameValueStr.find('=');

    if (equalsPos == notFound)
        return Exception { TypeError, "Invalid cookie string: missing '=' in name-value pair"_s };

    String name = nameValueStr.substring(0, equalsPos).trim(isASCIIWhitespace<UChar>);
    String value = nameValueStr.substring(equalsPos + 1).trim(isASCIIWhitespace<UChar>);

    if (name.isEmpty())
        return Exception { TypeError, "Invalid cookie string: name cannot be empty"_s };

    // Default values
    String domain;
    String path = "/"_s;
    double expires = 0;
    double maxAge = 0;
    bool secure = false;
    bool httpOnly = false;
    bool partitioned = false;
    CookieSameSite sameSite = CookieSameSite::Lax;

    // Parse attributes
    for (size_t i = 1; i < parts.size(); i++) {
        String part = parts[i].trim(isASCIIWhitespace<UChar>);
        size_t attrEqualsPos = part.find('=');

        String attrName;
        String attrValue;

        if (attrEqualsPos == notFound) {
            // Flag attribute like "Secure"
            attrName = part.convertToASCIILowercase();
            attrValue = emptyString();
        } else {
            attrName = part.substring(0, attrEqualsPos).trim(isASCIIWhitespace<UChar>).convertToASCIILowercase();
            attrValue = part.substring(attrEqualsPos + 1).trim(isASCIIWhitespace<UChar>);
        }

        if (attrName == "domain"_s)
            domain = attrValue;
        else if (attrName == "path"_s)
            path = attrValue;
        else if (attrName == "expires"_s) {
            if (!attrValue.containsOnlyLatin1())
                return Exception { TypeError, "Invalid cookie string: expires is not a valid date"_s };

            if (UNLIKELY(!attrValue.is8Bit())) {
                auto asLatin1 = attrValue.latin1();
                if (auto parsed = WTF::parseDate({ reinterpret_cast<const LChar*>(asLatin1.data()), asLatin1.length() })) {
                    expires = parsed;
                } else {
                    return Exception { TypeError, "Invalid cookie string: expires is not a valid date"_s };
                }
            } else {
                if (auto parsed = WTF::parseDate(attrValue.span<LChar>())) {
                    expires = parsed;
                } else {
                    return Exception { TypeError, "Invalid cookie string: expires is not a valid date"_s };
                }
            }
        } else if (attrName == "max-age"_s) {
            if (auto parsed = WTF::parseIntegerAllowingTrailingJunk<int64_t>(attrValue); parsed.has_value()) {
                maxAge = static_cast<double>(parsed.value());
            } else {
                return Exception { TypeError, "Invalid cookie string: max-age is not a number"_s };
            }
        } else if (attrName == "secure"_s)
            secure
                = true;
        else if (attrName == "httponly"_s)
            httpOnly
                = true;
        else if (attrName == "partitioned"_s)
            partitioned
                = true;
        else if (attrName == "samesite"_s) {
            if (WTF::equalIgnoringASCIICase(attrValue, "strict"_s))
                sameSite = CookieSameSite::Strict;
            else if (WTF::equalIgnoringASCIICase(attrValue, "lax"_s))
                sameSite = CookieSameSite::Lax;
            else if (WTF::equalIgnoringASCIICase(attrValue, "none"_s))
                sameSite = CookieSameSite::None;
        }
    }

    return adoptRef(*new Cookie(name, value, domain, path, expires, secure, sameSite, httpOnly, maxAge, partitioned));
}

bool Cookie::isExpired() const
{
    if (m_expires == 0)
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

void Cookie::appendTo(JSC::VM& vm, StringBuilder& builder) const
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

    if (!m_path.isEmpty() && m_path != "/"_s) {
        builder.append("; Path="_s);
        builder.append(m_path);
    }

    // Add expires if present (not 0)
    if (m_expires != 0) {
        builder.append("; Expires="_s);
        // In a real implementation, this would convert the timestamp to a proper date string
        // For now, just use a numeric timestamp
        WTF::GregorianDateTime dateTime;
        vm.dateCache.msToGregorianDateTime(m_expires * 1000, WTF::TimeType::UTCTime, dateTime);
        builder.append(WTF::makeRFC2822DateString(dateTime.weekDay(), dateTime.monthDay(), dateTime.month(), dateTime.year(), dateTime.hour(), dateTime.minute(), dateTime.second(), dateTime.utcOffsetInMinute()));
    }

    // Add Max-Age if present
    if (m_maxAge != 0) {
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
        builder.append("; SameSite=strict"_s);
        break;
    case CookieSameSite::Lax:
        // lax is the default.
        break;
    case CookieSameSite::None:
        builder.append("; SameSite=none"_s);
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

    if (m_expires != 0)
        object->putDirect(vm, builtinNames.expiresPublicName(), JSC::jsNumber(m_expires));

    if (m_maxAge != 0)
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

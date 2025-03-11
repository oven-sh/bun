#include "Cookie.h"
#include "JSCookie.h"
#include "helpers.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/WallTime.h>

namespace WebCore {

extern "C" JSC::EncodedJSValue Cookie__create(JSDOMGlobalObject* globalObject, const ZigString* name, const ZigString* value, const ZigString* domain, const ZigString* path, double expires, bool secure, int32_t sameSite)
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

    auto result = Cookie::create(nameStr, valueStr, domainStr, pathStr, expires, secure, sameSiteEnum);
    return JSC::JSValue::encode(WebCore::toJSNewlyCreated(globalObject, globalObject, WTFMove(result)));
}

extern "C" WebCore::Cookie* Cookie__fromJS(JSC::EncodedJSValue value)
{
    return WebCoreCast<WebCore::JSCookie, WebCore::Cookie>(value);
}

Cookie::~Cookie() = default;

Cookie::Cookie(const String& name, const String& value,
    const String& domain, const String& path,
    double expires, bool secure, CookieSameSite sameSite)
    : m_name(name)
    , m_value(value)
    , m_domain(domain)
    , m_path(path.isEmpty() ? "/"_s : path)
    , m_expires(expires)
    , m_secure(secure)
    , m_sameSite(sameSite)
{
}

Ref<Cookie> Cookie::create(const String& name, const String& value,
    const String& domain, const String& path,
    double expires, bool secure, CookieSameSite sameSite)
{
    return adoptRef(*new Cookie(name, value, domain, path, expires, secure, sameSite));
}

Ref<Cookie> Cookie::from(const String& name, const String& value,
    const String& domain, const String& path,
    double expires, bool secure, CookieSameSite sameSite)
{
    return create(name, value, domain, path, expires, secure, sameSite);
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
    bool secure = false;
    CookieSameSite sameSite = CookieSameSite::Strict;

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
            // Simple expires handling
            // In a real implementation, this would parse the date format
            // For now, we'll just use current time + 1 day as a placeholder
            expires = WTF::WallTime::now().secondsSinceEpoch().seconds() * 1000.0 + 86400000; // 24 hours in milliseconds
        } else if (attrName == "max-age"_s) {
            // Simple parsing for max-age - just take the numeric value
            // In a real implementation, this would handle negative values and errors
            bool isValid = true;
            for (unsigned i = 0; i < attrValue.length(); i++) {
                if (attrValue[i] < '0' || attrValue[i] > '9') {
                    isValid = false;
                    break;
                }
            }

            if (isValid && attrValue.length() > 0) {
                // Simple numeric conversion
                int maxAge = 0;
                for (unsigned i = 0; i < attrValue.length(); i++) {
                    maxAge = maxAge * 10 + (attrValue[i] - '0');
                }

                if (maxAge > 0)
                    expires = WTF::WallTime::now().secondsSinceEpoch().seconds() * 1000.0 + (maxAge * 1000.0); // Convert seconds to milliseconds
            }
        } else if (attrName == "secure"_s)
            secure = true;
        else if (attrName == "samesite"_s) {
            String sameSiteValue = attrValue.convertToASCIILowercase();
            if (sameSiteValue == "strict"_s)
                sameSite = CookieSameSite::Strict;
            else if (sameSiteValue == "lax"_s)
                sameSite = CookieSameSite::Lax;
            else if (sameSiteValue == "none"_s)
                sameSite = CookieSameSite::None;
        }
    }

    return adoptRef(*new Cookie(name, value, domain, path, expires, secure, sameSite));
}

String Cookie::toString() const
{
    StringBuilder builder;
    appendTo(builder);
    return builder.toString();
}

void Cookie::appendTo(StringBuilder& builder) const
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

    // Add path
    builder.append("; Path="_s);
    builder.append(m_path);

    // Add expires if present (not 0)
    if (m_expires != 0) {
        builder.append("; Expires="_s);
        // Note: In a real implementation, this would convert the timestamp to a proper date string
        builder.append(String::number(m_expires));
    }

    // Add secure flag if true
    if (m_secure)
        builder.append("; Secure"_s);

    // Add SameSite directive
    builder.append("; SameSite="_s);
    switch (m_sameSite) {
    case CookieSameSite::Strict:
        builder.append("strict"_s);
        break;
    case CookieSameSite::Lax:
        builder.append("lax"_s);
        break;
    case CookieSameSite::None:
        builder.append("none"_s);
        break;
    }
}

JSC::JSValue Cookie::toJSON(JSC::JSGlobalObject* globalObject) const
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* object = JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, JSC::jsNull());

    auto& builtinNames = Bun::builtinNames(vm);

    object->putDirect(vm, vm.propertyNames->name, JSC::jsString(vm, m_name));
    object->putDirect(vm, vm.propertyNames->value, JSC::jsString(vm, m_value));

    if (!m_domain.isEmpty())
        object->putDirect(vm, builtinNames.domainPublicName(), JSC::jsString(vm, m_domain));

    object->putDirect(vm, builtinNames.pathPublicName(), JSC::jsString(vm, m_path));

    if (m_expires != 0)
        object->putDirect(vm, builtinNames.expiresPublicName(), JSC::jsNumber(m_expires));

    object->putDirect(vm, builtinNames.securePublicName(), JSC::jsBoolean(m_secure));
    object->putDirect(vm, builtinNames.sameSitePublicName(), toJS(globalObject, m_sameSite));

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

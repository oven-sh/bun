#pragma once
#include "BunIDLTypes.h"
#include "BunIDLConvertBase.h"
#include "ErrorCode.h"
#include <openssl/ssl.h>
#include <initializer_list>

namespace Bun {

enum class TLSProtocolBound : bool {
    Minimum,
    Maximum,
};

// node's "TLSv1" .. "TLSv1.3", or the `TLS1_*_VERSION` code that node:tls passes. 0 means unset.
template<TLSProtocolBound Bound>
struct IDLTLSProtocolVersion : WebCore::IDLType<std::int32_t> {};

namespace Detail {
inline std::optional<std::int32_t> tlsProtocolVersionFromJS(
    JSC::JSGlobalObject& globalObject,
    JSC::JSValue value)
{
    auto& vm = JSC::getVM(&globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (value.isNumber()) {
        double number = value.asNumber();
        for (std::int32_t version : { 0, TLS1_VERSION, TLS1_1_VERSION, TLS1_2_VERSION, TLS1_3_VERSION }) {
            if (number == version)
                return version;
        }
        return std::nullopt;
    }
    if (!value.isString())
        return std::nullopt;
    auto name = JSC::asString(value)->view(&globalObject);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    if (name == "TLSv1"_s)
        return TLS1_VERSION;
    if (name == "TLSv1.1"_s)
        return TLS1_1_VERSION;
    if (name == "TLSv1.2"_s)
        return TLS1_2_VERSION;
    if (name == "TLSv1.3"_s)
        return TLS1_3_VERSION;
    return std::nullopt;
}

inline void throwInvalidTLSProtocolVersion(
    JSC::JSGlobalObject& globalObject,
    JSC::ThrowScope& scope,
    JSC::JSValue value,
    WTF::ASCIILiteral bound)
{
    MessageBuilder message;
    // Node formats the value with %j. For a string that is its JSON form, quoted and escaped.
    if (value.isString()) {
        auto string = JSC::asString(value)->value(&globalObject);
        RETURN_IF_EXCEPTION(scope, );
        message.appendQuotedJSONString(string);
    } else {
        JSValueToStringSafe(&globalObject, message, value, false);
        RETURN_IF_EXCEPTION(scope, );
    }
    message.append(" is not a valid "_s, bound, " TLS protocol version"_s);
    throwError(&globalObject, scope, ErrorCode::ERR_TLS_INVALID_PROTOCOL_VERSION, message);
}
}

}

template<Bun::TLSProtocolBound Bound>
struct WebCore::Converter<Bun::IDLTLSProtocolVersion<Bound>>
    : Bun::DefaultContextConverter<Bun::IDLTLSProtocolVersion<Bound>> {

    template<Bun::IDLConversionContext Ctx>
    static std::int32_t convert(JSC::JSGlobalObject& globalObject, JSC::JSValue value, Ctx&)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto version = Bun::Detail::tlsProtocolVersionFromJS(globalObject, value);
        RETURN_IF_EXCEPTION(scope, {});
        if (version)
            return *version;
        Bun::Detail::throwInvalidTLSProtocolVersion(
            globalObject,
            scope,
            value,
            Bound == Bun::TLSProtocolBound::Minimum ? "minimum"_s : "maximum"_s);
        return {};
    }
};

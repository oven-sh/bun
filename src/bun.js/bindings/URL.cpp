#include "root.h"

#include "helpers.h"

using namespace JSC;

extern "C" BunString URL__getFileURLString(BunString* filePath)
{
    return Bun::toStringRef(WTF::URL::fileURLWithFileSystemPath(filePath->toWTFString()).stringWithoutFragmentIdentifier());
}

extern "C" size_t URL__originLength(const char* latin1_slice, size_t len)
{
    WTF::String string = WTF::StringView(latin1_slice, len, true).toString();
    if (!string)
        return 0;
    WTF::URL url(string);
    if (!url.isValid())
        return 0;
    return url.pathStart();
}

extern "C" WTF::URL* URL__fromJS(EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject)
{
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    auto str = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, nullptr);
    if (str.isEmpty()) {
        return nullptr;
    }

    auto url = WTF::URL(str);
    if (!url.isValid() || url.isNull())
        return nullptr;

    return new WTF::URL(WTFMove(url));
}

extern "C" BunString URL__getHrefFromJS(EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject)
{
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    auto str = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, { BunStringTag::Dead });
    if (str.isEmpty()) {
        return { BunStringTag::Dead };
    }

    auto url = WTF::URL(str);
    if (!url.isValid() || url.isEmpty())
        return { BunStringTag::Dead };

    return Bun::toStringRef(url.string());
}

extern "C" BunString URL__getHref(BunString* input)
{
    auto&& str = input->toWTFString();
    auto url = WTF::URL(str);
    if (!url.isValid() || url.isEmpty())
        return { BunStringTag::Dead };

    return Bun::toStringRef(url.string());
}

extern "C" BunString URL__pathFromFileURL(BunString* input)
{
    auto&& str = input->toWTFString();
    auto url = WTF::URL(str);
    if (!url.isValid() || url.isEmpty())
        return { BunStringTag::Dead };

    return Bun::toStringRef(url.fileSystemPath());
}

extern "C" BunString URL__getHrefJoin(BunString* baseStr, BunString* relativeStr)
{
    auto base = baseStr->toWTFString();
    auto relative = relativeStr->toWTFString();
    auto url = WTF::URL(WTF::URL(base), relative);
    if (!url.isValid() || url.isEmpty())
        return { BunStringTag::Dead };

    return Bun::toStringRef(url.string());
}

extern "C" WTF::URL* URL__fromString(BunString* input)
{
    auto&& str = input->toWTFString();
    auto url = WTF::URL(str);
    if (!url.isValid())
        return nullptr;

    return new WTF::URL(WTFMove(url));
}

extern "C" BunString URL__protocol(WTF::URL* url)
{
    return Bun::toStringRef(url->protocol().toStringWithoutCopying());
}

extern "C" void URL__setProtocol(WTF::URL* url, BunString newProtocol)
{
    String newProtocolStr = newProtocol.toWTFString(BunString::ZeroCopy);
    url->setProtocol(newProtocolStr);
}

extern "C" void URL__deinit(WTF::URL* url)
{
    delete url;
}

extern "C" BunString URL__href(WTF::URL* url)
{
    return Bun::toStringRef(url->string());
}

extern "C" BunString URL__username(WTF::URL* url)
{
    return Bun::toStringRef(url->user());
}

extern "C" BunString URL__password(WTF::URL* url)
{
    return Bun::toStringRef(url->password());
}

extern "C" BunString URL__search(WTF::URL* url)
{
    return Bun::toStringRef(url->query().toStringWithoutCopying());
}

extern "C" BunString URL__host(WTF::URL* url)
{
    return Bun::toStringRef(url->host().toStringWithoutCopying());
}
extern "C" BunString URL__hostname(WTF::URL* url)
{
    return Bun::toStringRef(url->hostAndPort());
}

extern "C" uint32_t URL__port(WTF::URL* url)
{
    auto port = url->port();

    if (port.has_value()) {
        return port.value();
    }

    return std::numeric_limits<uint32_t>::max();
}

extern "C" BunString URL__pathname(WTF::URL* url)
{
    return Bun::toStringRef(url->path().toStringWithoutCopying());
}

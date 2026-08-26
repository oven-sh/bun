/*
 * Copyright (C) 2019 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "ClipboardItem.h"

#include "BunString.h"
#include "ClipboardBlob.h"
#include "ClipboardItemBindingsDataSource.h"
#include "ClipboardItemDataSource.h"
#include "ClipboardItemPlatformDataSource.h"
#include "ClipboardPlatform.h"
#include "ExceptionCode.h"
#include "ExceptionOr.h"
#include "HTTPParsers.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMPromise.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/StringToIntegerConversion.h>

namespace WebCore {

ClipboardItem::ClipboardItem(Vector<KeyValuePair<String, Ref<DOMPromise>>>&& items, const Options& options)
    : m_dataSource(makeUniqueRef<ClipboardItemBindingsDataSource>(*this, WTF::move(items)))
    , m_presentationStyle(options.presentationStyle)
{
}

ClipboardItem::ClipboardItem(ClipboardItemData&& data)
    : m_dataSource(makeUniqueRef<ClipboardItemPlatformDataSource>(*this, WTF::move(data)))
{
}

ClipboardItem::~ClipboardItem() = default;

ExceptionOr<Ref<ClipboardItem>> ClipboardItem::create(Vector<KeyValuePair<String, Ref<DOMPromise>>>&& items, const Options& options)
{
    // https://w3c.github.io/clipboard-apis/#dom-clipboarditem-clipboarditem — an
    // item with no representations is not constructible.
    if (items.isEmpty())
        return Exception { ExceptionCode::TypeError, "ClipboardItem requires at least one representation"_s };

    return adoptRef(*new ClipboardItem(WTF::move(items), options));
}

Ref<ClipboardItem> ClipboardItem::create(ClipboardItemData&& data)
{
    return adoptRef(*new ClipboardItem(WTF::move(data)));
}

Vector<String> ClipboardItem::types() const
{
    return m_dataSource->types();
}

void ClipboardItem::getType(const String& type, Ref<DeferredPromise>&& promise)
{
    m_dataSource->getType(type, WTF::move(promise));
}

void ClipboardItem::collectDataForWriting(Clipboard& destination, CompletionHandler<void(std::optional<ClipboardItemData>, JSC::JSValue)>&& completion)
{
    m_dataSource->collectDataForWriting(destination, WTF::move(completion));
}

void ClipboardItem::cancelDataCollection()
{
    m_dataSource->cancelCollect();
}

bool ClipboardItem::supports(const String& type)
{
    // The spec also answers true for a "web " custom format. Bun does not
    // implement web custom formats, so it does not claim to support them: a
    // caller that feature-detects here and then writes one would fail.
    auto essence = parseMIMETypeEssence(type);
    return !essence.isEmpty() && clipboardSupportsType(essence);
}

String ClipboardItem::parseMIMETypeEssence(const String& type)
{
    auto view = StringView(type).trim(isHTTPSpace);
    size_t semicolon = view.find(';');
    if (semicolon != notFound)
        view = view.left(semicolon).trim(isHTTPSpace);
    size_t slash = view.find('/');
    if (slash == notFound)
        return {};
    if (!isValidHTTPToken(view.left(slash)) || !isValidHTTPToken(view.substring(slash + 1)))
        return {};
    return view.convertToASCIILowercase();
}

// mimesniff §4.4.4 parameter parsing + §4.5 serialization. `position` is the
// first character after the ';' that ended the subtype.
static void appendSerializedMIMEParameters(StringBuilder& result, StringView view, size_t position)
{
    auto isQuotedStringToken = [](char16_t c) {
        return c == 0x09 || (c >= 0x20 && c <= 0x7E) || (c >= 0x80 && c <= 0xFF);
    };
    Vector<String, 2> seenNames;
    size_t length = view.length();
    while (position < length) {
        while (position < length && isHTTPSpace(view[position]))
            ++position;
        size_t nameStart = position;
        while (position < length && view[position] != ';' && view[position] != '=')
            ++position;
        String name = view.substring(nameStart, position - nameStart).convertToASCIILowercase();
        if (position >= length)
            break;
        if (view[position] == ';') {
            ++position;
            continue;
        }
        ++position; // '='
        String value;
        bool quoted = position < length && view[position] == '"';
        if (quoted) {
            ++position;
            StringBuilder collected;
            while (position < length && view[position] != '"') {
                if (view[position] == '\\' && position + 1 < length)
                    ++position;
                collected.append(view[position]);
                ++position;
            }
            if (position < length)
                ++position; // closing '"'
            value = collected.toString();
            while (position < length && view[position] != ';')
                ++position;
        } else {
            size_t valueStart = position;
            while (position < length && view[position] != ';')
                ++position;
            auto raw = view.substring(valueStart, position - valueStart);
            size_t end = raw.length();
            while (end && isHTTPSpace(raw[end - 1]))
                --end;
            value = raw.left(end).toString();
        }
        if (position < length)
            ++position; // ';'
        if (name.isEmpty() || !isValidHTTPToken(name) || seenNames.contains(name))
            continue;
        if (value.isEmpty() && !quoted)
            continue;
        bool valueValid = true;
        for (char16_t c : StringView(value).codeUnits()) {
            if (!isQuotedStringToken(c)) {
                valueValid = false;
                break;
            }
        }
        if (!valueValid)
            continue;
        seenNames.append(name);
        result.append(';', name, '=');
        if (!value.isEmpty() && isValidHTTPToken(value))
            result.append(value);
        else {
            result.append('"');
            for (char16_t c : StringView(value).codeUnits()) {
                if (c == '"' || c == '\\')
                    result.append('\\');
                result.append(c);
            }
            result.append('"');
        }
    }
}

String ClipboardItem::parseAndSerializeMIMEType(const String& type)
{
    String essence = parseMIMETypeEssence(type);
    if (essence.isEmpty())
        return {};
    auto view = StringView(type).trim(isHTTPSpace);
    size_t semicolon = view.find(';');
    if (semicolon == notFound)
        return essence;
    StringBuilder result;
    result.append(essence);
    appendSerializedMIMEParameters(result, view, semicolon + 1);
    return result.toString();
}

bool ClipboardItem::essenceMatches(const String& serializedKey, const String& essence)
{
    size_t semicolon = serializedKey.find(';');
    if (semicolon == notFound)
        return serializedKey == essence;
    return StringView(serializedKey).left(semicolon) == essence;
}

Ref<Blob> ClipboardItem::blobFromString(JSC::JSGlobalObject* globalObject, const String& stringData, const String& type)
{
    Bun::UTF8View utf8(stringData);
    return createClipboardBlob(globalObject, utf8.bytes(), type);
}

RefPtr<Blob> ClipboardItem::blobFromSettledValue(JSC::JSGlobalObject* globalObject, JSC::JSValue value, const String& type)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (RefPtr blob = Blob::create(value)) {
        // A Blob already declaring the requested type is handed back untouched,
        // even if its bytes are not resident — getType() callers can read it,
        // and the write path pulls bytes in before the platform transaction.
        if (clipboardBlobTypeMatches(clipboardBlobContentType(*blob), type))
            return blob;
        // Re-wrapping copies bytes a file- or network-backed Blob does not
        // have in memory; pass it through instead. The write path reads it
        // under the representation's key, and getType() surfaces it as a lazy
        // Blob, matching the spec's "resolve p with v".
        if (clipboardBlobNeedsToReadFile(*blob))
            return blob;
        // A Blob declaring some other type still carries the bytes the caller
        // meant; re-wrap them rather than stringifying the Blob object.
        return createClipboardBlob(globalObject, clipboardBlobBytes(*blob), type);
    }

    auto string = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_AND_RETURN(scope, ClipboardItem::blobFromString(globalObject, string, type));
}

} // namespace WebCore

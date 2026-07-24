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
#include "JSDOMExceptionHandling.h"
#include "JSDOMPromise.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/text/MakeString.h>
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

bool ClipboardItem::supports(const String& type)
{
    return clipboardSupportsType(type);
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
        // and the write path checks residency before the platform transaction.
        if (clipboardBlobTypeMatches(clipboardBlobContentType(*blob), type))
            return blob;
        // Re-wrapping copies the source Blob's bytes, which a file- or
        // network-backed Blob does not have in memory; doing it anyway would
        // silently produce an empty representation.
        if (clipboardBlobNeedsToReadFile(*blob)) {
            throwTypeError(globalObject, scope, makeString("Cannot use a file-backed Blob as a \""_s, type, "\" representation. Read it into memory first (`await blob.bytes()`)."_s));
            return nullptr;
        }
        // A Blob declaring some other type still carries the bytes the caller
        // meant; re-wrap them rather than stringifying the Blob object.
        return createClipboardBlob(globalObject, clipboardBlobBytes(*blob), type);
    }

    auto string = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_AND_RETURN(scope, ClipboardItem::blobFromString(globalObject, string, type));
}

} // namespace WebCore

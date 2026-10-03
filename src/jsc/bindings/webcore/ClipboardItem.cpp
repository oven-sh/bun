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
#include "ClipboardPlatform.h"
#include "ExceptionCode.h"
#include "ExceptionOr.h"
#include "HTTPParsers.h"
#include "JSDOMPromise.h"
#include "JSDOMPromiseDeferred.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

ClipboardItem::ClipboardItem(Vector<KeyValuePair<String, Ref<DOMPromise>>>&& promises, const Options& options)
    : m_promises(WTF::move(promises))
    , m_presentationStyle(options.presentationStyle)
{
}

ClipboardItem::ClipboardItem(ClipboardItemData&& data)
    : m_data(WTF::move(data))
{
}

ClipboardItem::~ClipboardItem() = default;

ExceptionOr<Ref<ClipboardItem>> ClipboardItem::create(Vector<KeyValuePair<String, Ref<DOMPromise>>>&& items, const Options& options)
{
    // https://w3c.github.io/clipboard-apis/#dom-clipboarditem-clipboarditem
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
    if (!m_promises.isEmpty())
        return m_promises.map([](auto& entry) { return entry.key; });
    return m_data.map([](auto& entry) { return entry.key; });
}

// The exact serialization first, so same-essence entries stay reachable.
template<typename Entries>
static size_t findType(const Entries& entries, const String& type)
{
    auto index = entries.findIf([&](auto& entry) { return entry.key == type; });
    if (index != notFound)
        return index;
    auto essence = ClipboardItem::parseMIMETypeEssence(type);
    return entries.findIf([&](auto& entry) { return ClipboardItem::essenceMatches(entry.key, essence); });
}

void ClipboardItem::getType(const String& type, Ref<DeferredPromise>&& promise)
{
    auto index = m_promises.isEmpty() ? findType(m_data, type) : findType(m_promises, type);
    if (index == notFound) {
        promise->reject(ExceptionCode::NotFoundError, makeString("The type \""_s, type, "\" was not found"_s));
        return;
    }

    if (m_promises.isEmpty()) {
        promise->resolveWithCallback([&](JSDOMGlobalObject& globalObject) {
            return clipboardBlobToJS(&globalObject, m_data[index].value.get(), type);
        });
        return;
    }

    auto* promiseGlobalObject = m_promises[index].value->globalObject();
    auto* typePromise = dynamicDowncast<JSC::JSPromise>(promise->promise());
    if (!promiseGlobalObject || !typePromise) {
        promise->reject(ExceptionCode::InvalidStateError);
        return;
    }
    auto scope = DECLARE_THROW_SCOPE(promiseGlobalObject->vm());
    // The coercion runs user JS, so it runs as a reaction of the representation
    // with getType()'s promise as the derived one: JSC rejects that with what
    // the coercion throws, or with the representation's own rejection.
    auto registered = m_promises[index].value->whenFulfilled(*typePromise, [type](JSDOMGlobalObject& globalObject, JSC::JSValue value) -> JSC::JSValue {
        auto throwScope = DECLARE_THROW_SCOPE(globalObject.vm());
        RefPtr blob = blobFromSettledValue(&globalObject, value, type);
        if (throwScope.exception()) [[unlikely]]
            return {};
        if (!blob) [[unlikely]] {
            throwOutOfMemoryError(&globalObject, throwScope);
            return {};
        }
        throwScope.release();
        return clipboardBlobToJS(&globalObject, *blob, type);
    });
    RETURN_IF_EXCEPTION(scope, void());
    if (registered == DOMPromise::IsCallbackRegistered::No) {
        scope.release();
        promise->reject(ExceptionCode::InvalidStateError);
    }
}

bool ClipboardItem::supports(const String& type)
{
    return clipboardMIMETypeFromEssence(parseMIMETypeEssence(type)).has_value();
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

// https://mimesniff.spec.whatwg.org/#parse-a-mime-type step 11 onward and
// https://mimesniff.spec.whatwg.org/#serialize-a-mime-type
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

RefPtr<Blob> ClipboardItem::blobFromSettledValue(JSC::JSGlobalObject* globalObject, JSC::JSValue value, const String& type)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (RefPtr blob = Blob::create(value)) {
        // A file- or network-backed Blob has no bytes to rewrap: getType()
        // hands it out lazily and write() reads it in before the transaction.
        if (clipboardBlobTypeMatches(clipboardBlobContentType(*blob), type) || clipboardBlobNeedsToReadFile(*blob))
            return blob;
        return Blob::create(clipboardBlobBytes(*blob), type, globalObject);
    }

    auto string = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto utf8 = Bun::UTF8View::tryCreate(globalObject, scope, string);
    if (!utf8) [[unlikely]]
        return nullptr;
    scope.release();
    return Blob::create(utf8->bytes(), type, globalObject);
}

void ClipboardItem::collectDataForWriting(CollectCompletionHandler&& completion)
{
    // One item can be handed to two overlapping write()s; retire the older collect.
    cancelDataCollection();
    if (m_promises.isEmpty()) {
        completion(ClipboardItemData { m_data }, {});
        return;
    }

    m_completionHandler = WTF::move(completion);
    auto* globalObject = m_promises[0].value->globalObject();
    if (!globalObject) {
        finishCollect(std::nullopt);
        return;
    }
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    m_collected = Vector<RefPtr<Blob>>(m_promises.size());
    m_pendingCount = m_promises.size();
    auto generation = m_collectGeneration;
    for (size_t index = 0; index < m_promises.size(); ++index) {
        // The coercion runs user JS, so it runs as a reaction of the
        // representation: what it throws rejects `coerced`, as a throwing `then`
        // callback would, and nothing here catches. A collect the coercion made
        // stale (it can start another write of this item) drops the result.
        // WeakPtr: a strong back-edge would let a never-settling promise keep the item alive.
        auto* coerced = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        auto registered = m_promises[index].value->whenFulfilled(*coerced, [weakThis = WeakPtr { *this }, generation, index, type = m_promises[index].key](JSDOMGlobalObject& globalObject, JSC::JSValue value) -> JSC::JSValue {
            auto throwScope = DECLARE_THROW_SCOPE(globalObject.vm());
            RefPtr blob = blobFromSettledValue(&globalObject, value, type);
            if (throwScope.exception()) [[unlikely]]
                return {};
            if (!blob) [[unlikely]] {
                throwOutOfMemoryError(&globalObject, throwScope);
                return {};
            }
            RefPtr protectedThis = weakThis.get();
            if (protectedThis && generation == protectedThis->m_collectGeneration)
                protectedThis->m_collected[index] = WTF::move(blob);
            return JSC::jsUndefined();
        });
        RETURN_IF_EXCEPTION(scope, void());
        if (registered == DOMPromise::IsCallbackRegistered::Yes) {
            registered = DOMPromise::create(*globalObject, *coerced)->whenSettledWithResult([weakThis = WeakPtr { *this }, generation, index](JSDOMGlobalObject*, bool isFulfilled, JSC::JSValue result) {
                RefPtr protectedThis = weakThis.get();
                if (protectedThis && generation == protectedThis->m_collectGeneration)
                    protectedThis->didSettle(index, isFulfilled, result);
            });
            // With an exception pending the collect stays armed until the writer retires it.
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (registered == DOMPromise::IsCallbackRegistered::No) {
            scope.release();
            finishCollect(std::nullopt);
            return;
        }
    }
}

void ClipboardItem::cancelDataCollection()
{
    ++m_collectGeneration;
    finishCollect(std::nullopt);
}

// `result` is the representation's own rejection, or what its coercion threw.
void ClipboardItem::didSettle(size_t index, bool isFulfilled, JSC::JSValue result)
{
    if (!isFulfilled) {
        finishCollect(std::nullopt, result);
        return;
    }

    ASSERT_UNUSED(index, m_collected[index]);
    if (--m_pendingCount)
        return;
    ClipboardItemData data;
    data.reserveInitialCapacity(m_promises.size());
    for (size_t i = 0; i < m_promises.size(); ++i)
        data.append({ m_promises[i].key, m_collected[i].releaseNonNull() });
    finishCollect(WTF::move(data));
}

void ClipboardItem::finishCollect(std::optional<ClipboardItemData>&& data, JSC::JSValue failureReason)
{
    m_collected.clear();
    m_pendingCount = 0;
    if (auto completion = std::exchange(m_completionHandler, {}))
        completion(WTF::move(data), failureReason);
}

size_t ClipboardItem::memoryCost() const
{
    size_t cost = 0;
    for (auto& entry : m_data)
        cost += entry.value->memoryCost();
    return cost;
}

} // namespace WebCore

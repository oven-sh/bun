/*
 * Copyright (C) 2019-2022 Apple Inc. All rights reserved.
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
#include "ClipboardItemBindingsDataSource.h"

#include "ClipboardBlob.h"
#include "ClipboardItem.h"
#include "ExceptionCode.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMPromise.h"
#include "JSDOMPromiseDeferred.h"
#include "blob.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/text/MakeString.h>

// clang-format off
#include <wtf/TZoneMallocInlines.h>
// clang-format on

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(ClipboardItemBindingsDataSource);

ClipboardItemBindingsDataSource::ClipboardItemBindingsDataSource(ClipboardItem& item, Vector<KeyValuePair<String, Ref<DOMPromise>>>&& itemPromises)
    : ClipboardItemDataSource(item)
    , m_itemPromises(WTF::move(itemPromises))
{
}

ClipboardItemBindingsDataSource::~ClipboardItemBindingsDataSource() = default;

Vector<String> ClipboardItemBindingsDataSource::types() const
{
    return m_itemPromises.map([](auto& typeAndItem) {
        return typeAndItem.key;
    });
}

// One settled representation -> Blob of `type`; `outError` carries the thrown
// coercion value so the caller can reject with it.
static RefPtr<Blob> blobFromResolvedValue(JSC::JSGlobalObject& globalObject, JSC::JSValue value, const String& type, JSC::JSValue& outError, bool& outTerminated)
{
    outError = {};
    outTerminated = false;

    auto& vm = globalObject.vm();
    // Runs from a promise reaction, the top of its own call.
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    RefPtr blob = ClipboardItem::blobFromSettledValue(&globalObject, value, type);
    if (auto* exception = catchScope.exception()) [[unlikely]] {
        JSC::JSValue thrown = exception->value();
        // A termination keeps unwinding rather than becoming a rejection.
        if (catchScope.clearExceptionExceptTermination())
            outError = thrown;
        else
            outTerminated = true;
        return nullptr;
    }
    return blob;
}

void ClipboardItemBindingsDataSource::getType(const String& type, Ref<DeferredPromise>&& promise)
{
    // Exact serialization first (spec record equality), so same-essence
    // entries stay individually reachable; essence as the lenient fallback.
    auto matchIndex = m_itemPromises.findIf([&](auto& item) {
        return item.key == type;
    });
    if (matchIndex == notFound) {
        auto essence = ClipboardItem::parseMIMETypeEssence(type);
        matchIndex = m_itemPromises.findIf([&](auto& item) {
            return ClipboardItem::essenceMatches(item.key, essence);
        });
    }

    if (matchIndex == notFound) {
        promise->reject(ExceptionCode::NotFoundError, makeString("The type \""_s, type, "\" was not found"_s));
        return;
    }

    // Strong-ref the item so m_itemPromises outlives the async gap (a
    // never-settling representation pins it: bounded per-call cost).
    m_itemPromises[matchIndex].value->whenSettled([this, protectedItem = Ref { m_item.get() }, matchIndex, promise = WTF::move(promise), type]() mutable {
        Ref itemPromise = m_itemPromises[matchIndex].value;
        if (itemPromise->status() != DOMPromise::Status::Fulfilled) {
            // Forward the caller's own rejection reason, like the write path.
            if (JSC::JSValue reason = itemPromise->result())
                promise->reject(reason);
            else
                promise->reject(ExceptionCode::AbortError);
            return;
        }

        auto* globalObject = itemPromise->globalObject();
        if (!globalObject) {
            promise->reject(ExceptionCode::InvalidStateError);
            return;
        }

        JSC::JSValue error;
        bool terminated = false;
        RefPtr blob = blobFromResolvedValue(*globalObject, itemPromise->result(), type, error, terminated);
        if (terminated)
            return;
        if (blob) {
            promise->resolveWithCallback([&](JSDOMGlobalObject& promiseGlobalObject) {
                return clipboardBlobToJS(&promiseGlobalObject, *blob, type);
            });
            return;
        }
        if (error) {
            promise->reject(error);
            return;
        }
        promise->reject(ExceptionCode::TypeError);
    });
}

void ClipboardItemBindingsDataSource::collectDataForWriting(Clipboard&, CollectCompletionHandler&& completion)
{
    // The same item can be written twice concurrently; retire the superseded
    // collect before taking this one.
    if (m_completionHandler)
        invokeCompletionHandler(std::nullopt);
    auto generation = ++m_collectGeneration;
    m_completionHandler = WTF::move(completion);
    m_pendingTypeCount = m_itemPromises.size();

    if (!m_pendingTypeCount) {
        invokeCompletionHandler(ClipboardItemData {});
        return;
    }

    for (size_t index = 0; index < m_itemPromises.size(); ++index) {
        // One reaction per representation, registered through the private
        // @then as getType() does, so no replaceable Promise method runs.
        // WeakPtr back-edge: a strong Ref would close a native<->GC cycle (the
        // guarded promise's reaction would own the item) that never-settling
        // user data makes uncollectable.
        auto registered = m_itemPromises[index].value->whenSettled([this, weakItem = WeakPtr { m_item.get() }, generation, index] {
            RefPtr protectedItem = weakItem.get();
            if (!protectedItem || generation != m_collectGeneration)
                return;
            didSettleType(index);
        });
        // Only a terminating VM refuses a reaction. The termination stays
        // pending for the caller, and the bump retires the reactions already
        // registered.
        if (registered == DOMPromise::IsCallbackRegistered::No) {
            ++m_collectGeneration;
            invokeCompletionHandler(std::nullopt);
            return;
        }
    }
}

void ClipboardItemBindingsDataSource::cancelCollect()
{
    // Bump first so an in-flight reaction sees itself superseded.
    ++m_collectGeneration;
    invokeCompletionHandler(std::nullopt);
}

void ClipboardItemBindingsDataSource::didSettleType(size_t index)
{
    Ref promise = m_itemPromises[index].value;
    if (promise->status() != DOMPromise::Status::Fulfilled) {
        // As with Promise.all, the first rejection fails the collect with its
        // own reason. The bump retires the reactions still to come.
        ++m_collectGeneration;
        invokeCompletionHandler(std::nullopt, promise->result());
        return;
    }
    ASSERT(m_pendingTypeCount);
    if (!--m_pendingTypeCount)
        didFulfillAllTypes();
}

void ClipboardItemBindingsDataSource::didFulfillAllTypes()
{
    // Take ownership up front: the conversions below run user JS that can
    // re-enter collectDataForWriting and swap m_completionHandler.
    auto completionHandler = std::exchange(m_completionHandler, {});
    if (!completionHandler)
        return;

    ClipboardItemData data;
    data.reserveInitialCapacity(m_itemPromises.size());
    for (auto& typeAndPromise : m_itemPromises) {
        // The guarded promise roots its result for the conversion.
        Ref promise = typeAndPromise.value;
        auto* globalObject = promise->globalObject();
        if (!globalObject) {
            completionHandler(std::nullopt, {});
            return;
        }
        JSC::JSValue error;
        bool terminated = false;
        RefPtr blob = blobFromResolvedValue(*globalObject, promise->result(), typeAndPromise.key, error, terminated);
        // A representation that could not become a Blob fails the whole item,
        // so a partial write never reaches the clipboard. A termination leaves
        // `error` empty.
        if (!blob) {
            completionHandler(std::nullopt, error);
            return;
        }
        data.append({ typeAndPromise.key, blob.releaseNonNull() });
    }

    completionHandler(WTF::move(data), {});
}

void ClipboardItemBindingsDataSource::invokeCompletionHandler(std::optional<ClipboardItemData>&& data, JSC::JSValue failureReason)
{
    if (auto completionHandler = std::exchange(m_completionHandler, {}))
        completionHandler(WTF::move(data), failureReason);
}

} // namespace WebCore

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
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSPromiseConstructor.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
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

// Turns one settled representation into a Blob of `type`, or null if the
// WebIDL coercion threw. `outError` carries a thrown coercion failure back out
// so getType() can reject with it; the write path discards it and fails the
// item instead.
static RefPtr<Blob> blobFromResolvedValue(JSC::JSGlobalObject& globalObject, JSC::JSValue value, const String& type, JSC::JSValue& outError, bool& outTerminated)
{
    outError = {};
    outTerminated = false;

    auto& vm = globalObject.vm();
    // This runs from a promise reaction, so it is the top of its own call: a
    // coercion failure becomes a rejection here rather than propagating into
    // JSC's microtask drain.
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    RefPtr blob = ClipboardItem::blobFromSettledValue(&globalObject, value, type);
    if (catchScope.exception()) [[unlikely]] {
        // A termination has to keep unwinding rather than become a rejection.
        if (vm.hasPendingTerminationException()) {
            outTerminated = true;
            return nullptr;
        }
        outError = catchScope.exception()->value();
        catchScope.clearException();
        return nullptr;
    }
    return blob;
}

void ClipboardItemBindingsDataSource::getType(const String& type, Ref<DeferredPromise>&& promise)
{
    auto matchIndex = m_itemPromises.findIf([&](auto& item) {
        return type == item.key;
    });

    if (matchIndex == notFound) {
        promise->reject(ExceptionCode::NotFoundError, makeString("The type \""_s, type, "\" was not found"_s));
        return;
    }

    // The item is the only thing keeping m_itemPromises alive across the async
    // gap, so the reaction holds it strongly. It does not, however, hold a
    // strong Ref<DOMPromise> — that would close a native<->GC cycle through
    // guardedObjects for a never-settling representation. The reaction drops
    // its captures when it fires (whenPromiseIsSettled's std::exchange), so a
    // source that does settle releases the item then.
    m_itemPromises[matchIndex].value->whenSettled([this, protectedItem = Ref { m_item.get() }, matchIndex, promise = WTF::move(promise), type]() mutable {
        Ref itemPromise = m_itemPromises[matchIndex].value;
        if (itemPromise->status() != DOMPromise::Status::Fulfilled) {
            // Forward the caller's own rejection reason, as the write path does
            // with the same failure, rather than flattening it to an AbortError.
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
            promise->resolve<IDLInterface<Blob>>(*blob);
            return;
        }
        if (error) {
            promise->reject(error);
            return;
        }
        promise->reject(ExceptionCode::TypeError);
    });
}

// `Promise.all(promises)`. The representations are values the caller supplied,
// so resolving them through the realm's own Promise.all grants nothing the
// caller does not already have.
static JSC::JSPromise* promiseAll(JSC::JSGlobalObject& globalObject, JSC::JSArray* promises)
{
    auto& vm = globalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* promiseConstructor = globalObject.promiseConstructor();
    JSC::JSValue allFunction = promiseConstructor->get(&globalObject, JSC::Identifier::fromString(vm, "all"_s));
    RETURN_IF_EXCEPTION(scope, nullptr);

    auto callData = JSC::getCallData(allFunction);
    if (callData.type == JSC::CallData::Type::None) [[unlikely]]
        return nullptr;

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(promises);
    if (arguments.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(&globalObject, scope);
        return nullptr;
    }

    JSC::JSValue result = JSC::call(&globalObject, allFunction, callData, promiseConstructor, arguments);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return dynamicDowncast<JSC::JSPromise>(result);
}

void ClipboardItemBindingsDataSource::collectDataForWriting(Clipboard&, CollectCompletionHandler&& completion)
{
    // The same item can be written twice concurrently; the earlier write has
    // already been invalidated, so retire its collect before taking this one.
    if (m_completionHandler)
        invokeCompletionHandler(std::nullopt);
    m_allTypesSettled = nullptr;
    ++m_collectGeneration;
    m_completionHandler = WTF::move(completion);

    if (m_itemPromises.isEmpty()) {
        invokeCompletionHandler(ClipboardItemData {});
        return;
    }

    auto* globalObject = m_itemPromises[0].value->globalObject();
    if (!globalObject) {
        invokeCompletionHandler(std::nullopt);
        return;
    }

    auto& vm = globalObject->vm();
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSC::JSArray* promises = JSC::constructEmptyArray(globalObject, nullptr, m_itemPromises.size());
    if (catchScope.exception()) [[unlikely]] {
        catchScope.clearException();
        invokeCompletionHandler(std::nullopt);
        return;
    }
    for (unsigned index = 0; index < m_itemPromises.size(); ++index) {
        promises->putDirectIndex(globalObject, index, m_itemPromises[index].value->promise());
        if (catchScope.exception()) [[unlikely]] {
            catchScope.clearException();
            invokeCompletionHandler(std::nullopt);
            return;
        }
    }

    // One reaction for the whole item: everything is settled before anything is
    // converted, so no state has to be carried between reactions.
    auto* allPromise = promiseAll(*globalObject, promises);
    if (catchScope.exception()) [[unlikely]]
        catchScope.clearException();
    if (!allPromise) {
        invokeCompletionHandler(std::nullopt);
        return;
    }

    // A WeakPtr back-edge: a strong Ref here would close a native<->GC cycle
    // (guardedObjects roots the aggregate, whose reaction would own the item)
    // that never-settling user data would make uncollectable.
    m_allTypesSettled = DOMPromise::create(*globalObject, *allPromise);
    m_allTypesSettled->whenSettled([this, weakItem = WeakPtr { m_item.get() }, generation = m_collectGeneration] {
        RefPtr protectedItem = weakItem.get();
        if (!protectedItem || generation != m_collectGeneration)
            return;
        didSettleAllTypes();
    });
    // whenSettled only throws for termination, in which case no reaction was
    // registered and nothing else will discharge the handler.
    if (catchScope.exception()) [[unlikely]] {
        catchScope.clearException();
        invokeCompletionHandler(std::nullopt);
    }
}

void ClipboardItemBindingsDataSource::cancelCollect()
{
    // Bump the generation first so the in-flight reaction, if it ever runs,
    // recognises itself as superseded and does not settle anything.
    ++m_collectGeneration;
    m_allTypesSettled = nullptr;
    invokeCompletionHandler(std::nullopt);
}

void ClipboardItemBindingsDataSource::didSettleAllTypes()
{
    // Take ownership up front: toWTFString/.get() below run user JS, which can
    // re-enter collectDataForWriting and swap m_completionHandler. Firing the
    // local keeps this generation's handler paired with this generation's data.
    auto completionHandler = std::exchange(m_completionHandler, {});
    auto invoke = [&](std::optional<ClipboardItemData>&& data, JSC::JSValue reason = {}) {
        if (completionHandler)
            completionHandler(WTF::move(data), reason);
    };

    RefPtr allTypesSettled = std::exchange(m_allTypesSettled, nullptr);
    if (!allTypesSettled) {
        invoke(std::nullopt);
        return;
    }
    if (allTypesSettled->status() != DOMPromise::Status::Fulfilled) {
        // One representation rejected, so the item as a whole has no data. The
        // aggregate carries that representation's own reason, which is what
        // write() should reject with.
        invoke(std::nullopt, allTypesSettled->result());
        return;
    }

    auto* globalObject = allTypesSettled->globalObject();
    if (!globalObject) {
        invoke(std::nullopt);
        return;
    }

    auto& vm = globalObject->vm();
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // Promise.all resolves with the representations in order. Copy them into a
    // MarkedArgumentBuffer so every element stays rooted while it is converted.
    JSC::MarkedArgumentBuffer resolvedValues;
    resolvedValues.ensureCapacity(m_itemPromises.size());
    JSC::JSValue resolved = allTypesSettled->result();
    // Promise.all is an ordinary property of the realm's Promise, so a caller
    // can replace it. Anything but an array of the expected length means the
    // representations were not actually collected — fail rather than write
    // whatever it handed back.
    auto* resolvedArray = dynamicDowncast<JSC::JSArray>(resolved);
    if (!resolvedArray || resolvedArray->length() < m_itemPromises.size()) {
        invoke(std::nullopt);
        return;
    }
    for (unsigned index = 0; index < m_itemPromises.size(); ++index) {
        JSC::JSValue value = resolved.get(globalObject, index);
        if (catchScope.exception()) [[unlikely]] {
            catchScope.clearException();
            invoke(std::nullopt);
            return;
        }
        resolvedValues.append(value);
    }
    if (resolvedValues.hasOverflowed()) [[unlikely]] {
        invoke(std::nullopt);
        return;
    }

    // Now everything is in hand: convert each one to the refcounted Blob the
    // platform transaction will read from.
    ClipboardItemData data;
    data.reserveInitialCapacity(m_itemPromises.size());
    for (unsigned index = 0; index < m_itemPromises.size(); ++index) {
        JSC::JSValue error;
        bool terminated = false;
        RefPtr blob = blobFromResolvedValue(*globalObject, resolvedValues.at(index), m_itemPromises[index].key, error, terminated);
        if (terminated) {
            invoke(std::nullopt);
            return;
        }
        // A representation that could not become a Blob fails the whole item,
        // so a partial write never reaches the clipboard. `error` is the
        // exception its WebIDL coercion threw, if any.
        if (!blob) {
            invoke(std::nullopt, error);
            return;
        }
        data.append({ m_itemPromises[index].key, blob.releaseNonNull() });
    }

    invoke(WTF::move(data));
}

void ClipboardItemBindingsDataSource::invokeCompletionHandler(std::optional<ClipboardItemData>&& data, JSC::JSValue failureReason)
{
    if (auto completionHandler = std::exchange(m_completionHandler, {}))
        completionHandler(WTF::move(data), failureReason);
}

} // namespace WebCore

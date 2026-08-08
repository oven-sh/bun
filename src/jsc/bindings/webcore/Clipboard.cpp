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
#include "Clipboard.h"

#include "ClipboardBlob.h"
#include "ClipboardEvent.h"
#include "ClipboardItem.h"
#include "ClipboardPlatform.h"
#include "JSClipboardItem.h"
#include "JSDOMConvertSequences.h"
#include "JSDOMConvertStrings.h"
#include "EventNames.h"
#include "JSDOMPromiseDeferred.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Clipboard);

Clipboard::Clipboard(ScriptExecutionContext* context)
    : ContextDestructionObserver(context)
{
}

Clipboard::~Clipboard()
{
    if (RefPtr itemWriter = std::exchange(m_activeItemWriter, nullptr))
        itemWriter->invalidate();
}

void Clipboard::fireClipboardEvent(const AtomString& type)
{
    dispatchEvent(ClipboardEvent::create(type, EventInit {}, Event::IsTrusted::Yes));
}

void Clipboard::readText(Ref<DeferredPromise>&& promise)
{
    auto* globalObject = promise->globalObject();
    if (!globalObject) {
        promise->reject(ExceptionCode::InvalidStateError);
        return;
    }

    auto request = ClipboardRequest::create([promise, protectedThis = Ref { *this }](JSC::JSGlobalObject&, std::span<const ClipboardRepresentation> representations, const String& failureMessage) mutable {
        if (!failureMessage.isNull()) {
            promise->reject(ExceptionCode::NotAllowedError, failureMessage);
            return;
        }
        // An empty clipboard reads as "", and foreign bytes are not trusted UTF-8.
        String text = emptyString();
        if (!representations.empty())
            text = String::fromUTF8ReplacingInvalidSequences({ representations[0].bytes, representations[0].length });
        promise->resolve<IDLDOMString>(text);
        protectedThis->fireClipboardEvent(eventNames().pasteEvent);
    });

    scheduleClipboardReadText(*globalObject, WTF::move(request));
}

void Clipboard::writeText(const String& data, Ref<DeferredPromise>&& promise)
{
    auto* globalObject = promise->globalObject();
    if (!globalObject) {
        promise->reject(ExceptionCode::InvalidStateError);
        return;
    }

    // Upstream supersedes implicitly via the pasteboard changeCount check;
    // there is none here, so invalidate explicitly or the earlier
    // still-collecting write() lands after this one.
    if (RefPtr previousItemWriter = std::exchange(m_activeItemWriter, nullptr))
        previousItemWriter->invalidate();

    auto request = ClipboardRequest::create([promise, protectedThis = Ref { *this }](JSC::JSGlobalObject&, std::span<const ClipboardRepresentation>, const String& failureMessage) mutable {
        if (!failureMessage.isNull()) {
            promise->reject(ExceptionCode::NotAllowedError, failureMessage);
            return;
        }
        promise->resolve();
        protectedThis->fireClipboardEvent(eventNames().copyEvent);
    });

    scheduleClipboardWriteText(*globalObject, WTF::move(request), data);
}

void Clipboard::read(Ref<DeferredPromise>&& promise)
{
    auto* globalObject = promise->globalObject();
    if (!globalObject) {
        promise->reject(ExceptionCode::InvalidStateError);
        return;
    }

    auto request = ClipboardRequest::create([promise, protectedThis = Ref { *this }](JSC::JSGlobalObject& globalObject, std::span<const ClipboardRepresentation> representations, const String& failureMessage) mutable {
        if (!failureMessage.isNull()) {
            promise->reject(ExceptionCode::NotAllowedError, failureMessage);
            return;
        }

        // Everything the platform had becomes one item.
        Vector<RefPtr<ClipboardItem>> items;
        if (!representations.empty()) {
            ClipboardItemData data;
            data.reserveInitialCapacity(representations.size());
            for (auto& representation : representations) {
                auto type = String::fromUTF8({ representation.type, representation.typeLength });
                data.append({ type, createClipboardBlob(&globalObject, { representation.bytes, representation.length }, type, MimeNormalization::Exact) });
            }
            items.append(ClipboardItem::create(WTF::move(data)));
        }

        promise->resolve<IDLSequence<IDLInterface<ClipboardItem>>>(items);
        protectedThis->fireClipboardEvent(eventNames().pasteEvent);
    });

    scheduleClipboardRead(*globalObject, WTF::move(request));
}

void Clipboard::write(const Vector<RefPtr<ClipboardItem>>& data, Ref<DeferredPromise>&& promise)
{
    // Supersede before the early-outs so write([]) aborts an in-flight write
    // the same way writeText() and write([item]) do.
    if (RefPtr previousItemWriter = std::exchange(m_activeItemWriter, nullptr))
        previousItemWriter->invalidate();

    // Per spec (and Chrome), an empty list resolves without touching the
    // clipboard; it does not clear it.
    if (data.isEmpty()) {
        promise->resolve();
        return;
    }

    // One pasteboard transaction per write; reject rather than silently
    // collapse to data[0].
    if (data.size() > 1) {
        promise->reject(ExceptionCode::NotAllowedError, "Writing multiple ClipboardItems is not supported."_s);
        return;
    }

    Ref itemWriter = ItemWriter::create(*this, WTF::move(promise));
    m_activeItemWriter = itemWriter.copyRef();
    itemWriter->write(data);
}

// MARK: - ItemWriter

Clipboard::ItemWriter::ItemWriter(Clipboard& clipboard, Ref<DeferredPromise>&& promise)
    : m_clipboard(clipboard)
    , m_promise(WTF::move(promise))
{
}

Clipboard::ItemWriter::~ItemWriter() = default;

void Clipboard::ItemWriter::write(const Vector<RefPtr<ClipboardItem>>& items)
{
    RefPtr clipboard = m_clipboard.get();
    if (!clipboard) {
        reject(ExceptionCode::InvalidStateError, "The clipboard is no longer available."_s);
        return;
    }

    // Per spec, a representation this platform cannot write fails the whole
    // write before anything reaches the clipboard.
    for (auto& item : items) {
        auto types = item->types();
        Vector<String> essences;
        essences.reserveInitialCapacity(types.size());
        for (auto& type : types) {
            if (!clipboardSupportsType(type)) {
                reject(ExceptionCode::NotAllowedError, makeString("The type \""_s, type, "\" is not supported on this platform."_s));
                return;
            }
            // Platform formats carry no MIME parameters, so two same-essence
            // representations would silently overwrite each other.
            auto essence = ClipboardItem::parseMIMETypeEssence(type);
            if (essences.contains(essence)) {
                reject(ExceptionCode::NotAllowedError, makeString("Writing two \""_s, essence, "\" representations is not supported."_s));
                return;
            }
            essences.append(WTF::move(essence));
        }
        if (clipboardWritesSingleRepresentation() && types.size() > 1) {
            reject(ExceptionCode::NotAllowedError, "Writing more than one representation per item is not supported on this platform."_s);
            return;
        }
    }

    m_items = items;
    m_dataToWrite.fill(std::nullopt, items.size());
    m_pendingItemCount = items.size();

    for (size_t index = 0; index < items.size(); ++index) {
        Ref { *items[index] }->collectDataForWriting(*clipboard, [this, protectedThis = Ref { *this }, index](std::optional<ClipboardItemData> data, JSC::JSValue failureReason) mutable {
            // A failed representation rejects with its own reason; later
            // completions see the promise already gone.
            if (!data) {
                protectedThis->rejectWithValue(failureReason);
                return;
            }
            protectedThis->setData(WTF::move(data), index);
            ASSERT(m_pendingItemCount);
            if (!--m_pendingItemCount)
                protectedThis->didSetAllData();
        });
        // A synchronous failure released our items; stop arming collects.
        if (!m_promise)
            break;
    }

    // Not keyed on m_pendingItemCount: all-synchronous completion would fire
    // didSetAllData a second time.
    if (items.isEmpty())
        didSetAllData();
}

void Clipboard::ItemWriter::setData(std::optional<ClipboardItemData>&& data, size_t index)
{
    if (index >= m_dataToWrite.size()) {
        ASSERT_NOT_REACHED();
        return;
    }
    m_dataToWrite[index] = WTF::move(data);
}

void Clipboard::ItemWriter::didSetAllData()
{
    RefPtr promise = m_promise;
    if (!promise)
        return;

    auto* globalObject = promise->globalObject();
    if (!globalObject) {
        reject(ExceptionCode::InvalidStateError, "The clipboard is no longer available."_s);
        return;
    }

    auto dataToWrite = std::exchange(m_dataToWrite, {});

    ClipboardItemData representations;
    Vector<size_t> pendingReadIndices;
    for (auto& itemData : dataToWrite) {
        // A missing entry means the writer was invalidated underneath us.
        if (!itemData) {
            reject(ExceptionCode::NotAllowedError, "A ClipboardItem representation could not be read."_s);
            return;
        }
        for (auto& representation : *itemData) {
            // Non-resident bytes (Bun.file, S3) are read in first.
            if (clipboardBlobNeedsToReadFile(representation.value.get()))
                pendingReadIndices.append(representations.size());
            representations.append(representation);
        }
    }

    if (pendingReadIndices.isEmpty()) {
        schedulePlatformWrite(WTF::move(representations));
        return;
    }

    m_representationsToWrite = WTF::move(representations);
    m_pendingBlobReads = pendingReadIndices.size();
    for (auto index : pendingReadIndices) {
        // A synchronous failure (detached Blob, terminating VM) rejects and
        // clears the staged representations mid-loop.
        if (!m_promise)
            return;
        clipboardBlobReadAsync(*globalObject, m_representationsToWrite[index].value.get(), [protectedThis = Ref { *this }, index](std::span<const uint8_t> bytes, const String& failureMessage) mutable {
            protectedThis->didReadBlobForWrite(index, bytes, failureMessage);
        });
    }
}

void Clipboard::ItemWriter::didReadBlobForWrite(size_t index, std::span<const uint8_t> bytes, const String& failureMessage)
{
    RefPtr promise = m_promise;
    if (!promise)
        return; // Superseded, or a sibling read already rejected.

    if (!failureMessage.isNull()) {
        reject(ExceptionCode::NotAllowedError, failureMessage);
        return;
    }

    auto* globalObject = promise->globalObject();
    if (!globalObject) {
        reject(ExceptionCode::InvalidStateError, "The clipboard is no longer available."_s);
        return;
    }

    // The span dies with this call; snapshot under the representation's key.
    m_representationsToWrite[index].value = createClipboardBlob(globalObject, bytes, m_representationsToWrite[index].key, MimeNormalization::Exact);
    ASSERT(m_pendingBlobReads);
    if (!--m_pendingBlobReads)
        schedulePlatformWrite(std::exchange(m_representationsToWrite, {}));
}

void Clipboard::ItemWriter::schedulePlatformWrite(ClipboardItemData&& representations)
{
    RefPtr promise = m_promise;
    auto* globalObject = promise ? promise->globalObject() : nullptr;
    if (!globalObject) {
        reject(ExceptionCode::InvalidStateError, "The clipboard is no longer available."_s);
        return;
    }

    auto request = ClipboardRequest::create([protectedThis = Ref { *this }](JSC::JSGlobalObject&, std::span<const ClipboardRepresentation>, const String& failureMessage) mutable {
        protectedThis->didFinishPlatformWrite(failureMessage);
    });
    m_platformWriteRequest = request.copyRef();

    scheduleClipboardWrite(*globalObject, WTF::move(request), representations);
}

void Clipboard::ItemWriter::didFinishPlatformWrite(const String& failureMessage)
{
    RefPtr promise = std::exchange(m_promise, nullptr);
    RefPtr clipboard = m_clipboard.get();
    // Detach first: a `copy` listener may synchronously start another write
    // over the same items, whose collect this writer must not retire.
    detachFromClipboard();
    if (!promise)
        return;

    if (!failureMessage.isNull())
        promise->reject(ExceptionCode::NotAllowedError, failureMessage);
    else {
        promise->resolve();
        if (clipboard)
            clipboard->fireClipboardEvent(eventNames().copyEvent);
    }
}

void Clipboard::ItemWriter::reject(ExceptionCode code, const String& message)
{
    if (RefPtr promise = std::exchange(m_promise, nullptr))
        promise->reject(code, message);
    detachFromClipboard();
}

void Clipboard::ItemWriter::rejectWithValue(JSC::JSValue failureReason)
{
    RefPtr promise = std::exchange(m_promise, nullptr);
    if (promise) {
        if (failureReason)
            promise->reject(failureReason);
        else
            promise->reject(ExceptionCode::NotAllowedError, "A ClipboardItem representation could not be read."_s);
    }
    detachFromClipboard();
}

void Clipboard::ItemWriter::invalidate()
{
    // A platform write already queued on the work pool would otherwise still
    // land, making the AbortError below a lie.
    if (RefPtr request = std::exchange(m_platformWriteRequest, nullptr))
        request->cancel();
    if (RefPtr promise = std::exchange(m_promise, nullptr))
        promise->reject(ExceptionCode::AbortError);
    // Null m_clipboard first: releaseItems re-enters detachFromClipboard,
    // which must not ref a Clipboard mid-destruction.
    m_clipboard = nullptr;
    releaseItems();
}

// Retiring a collect re-enters detachFromClipboard, so iterate a taken copy.
void Clipboard::ItemWriter::releaseItems()
{
    auto items = std::exchange(m_items, {});
    for (auto& item : items) {
        if (item)
            item->cancelDataCollection();
    }
}

// Callers hold their own reference, so dropping the clipboard's back-pointer
// cannot destroy `this` underneath them.
void Clipboard::ItemWriter::detachFromClipboard()
{
    releaseItems();
    // An in-flight read's completion bails on the nulled promise before
    // indexing into this.
    m_representationsToWrite = {};
    m_platformWriteRequest = nullptr;
    RefPtr clipboard = m_clipboard.get();
    if (clipboard && clipboard->m_activeItemWriter.get() == this)
        clipboard->m_activeItemWriter = nullptr;
    m_clipboard = nullptr;
}

} // namespace WebCore

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
        // A clipboard holding no text reads as the empty string, per the spec.
        // Other processes own these bytes, so they are not trusted to be UTF-8.
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

        // Everything the platform had becomes one item, which is what a
        // single-pasteboard runtime can honestly report.
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
    // Writing nothing succeeds without touching the platform clipboard.
    if (data.isEmpty()) {
        promise->resolve();
        return;
    }

    // Every engine today writes a single item, and Bun's backends own one
    // pasteboard transaction, so more than one is rejected rather than
    // silently collapsed.
    if (data.size() > 1) {
        promise->reject(ExceptionCode::NotAllowedError, "Writing multiple ClipboardItems is not supported."_s);
        return;
    }

    if (RefPtr previousItemWriter = std::exchange(m_activeItemWriter, nullptr))
        previousItemWriter->invalidate();

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
        for (auto& type : types) {
            if (!clipboardSupportsType(type)) {
                reject(ExceptionCode::NotAllowedError, makeString("The type \""_s, type, "\" is not supported on this platform."_s));
                return;
            }
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
            // A representation that failed rejects the write immediately with
            // its own reason. Nothing has reached the clipboard yet, and any
            // later completion sees the promise already gone.
            if (!data) {
                protectedThis->rejectWithValue(failureReason);
                return;
            }
            protectedThis->setData(WTF::move(data), index);
            ASSERT(m_pendingItemCount);
            if (!--m_pendingItemCount)
                protectedThis->didSetAllData();
        });
        // A data source that completed synchronously may already have failed
        // the write and released our items; arming the remaining collects
        // would leave their completions with no owner to discharge them.
        if (!m_promise)
            break;
    }

    // Only for a list that never entered the loop. Keying this on
    // m_pendingItemCount would fire a second time whenever every item
    // completed synchronously — which is what a platform-sourced item does.
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
    for (auto& itemData : dataToWrite) {
        // Failures already rejected in the collect completion; a missing entry
        // here means the writer was invalidated underneath us.
        if (!itemData) {
            reject(ExceptionCode::NotAllowedError, "A ClipboardItem representation could not be read."_s);
            return;
        }
        for (auto& representation : *itemData) {
            // The platform transaction snapshots memory, so a Blob whose bytes
            // are not resident would silently become an empty representation.
            if (clipboardBlobNeedsToReadFile(representation.value.get())) {
                reject(ExceptionCode::TypeError, "Cannot write a file-backed Blob to the clipboard. Read it into memory first (`await blob.bytes()`)."_s);
                return;
            }
            representations.append(representation);
        }
    }

    auto request = ClipboardRequest::create([protectedThis = Ref { *this }](JSC::JSGlobalObject&, std::span<const ClipboardRepresentation>, const String& failureMessage) mutable {
        protectedThis->didFinishPlatformWrite(failureMessage);
    });

    scheduleClipboardWrite(*globalObject, WTF::move(request), representations);
}

void Clipboard::ItemWriter::didFinishPlatformWrite(const String& failureMessage)
{
    RefPtr promise = std::exchange(m_promise, nullptr);
    RefPtr clipboard = m_clipboard.get();
    // Detach before settling or dispatching. A `copy` listener runs
    // synchronously and may start another write over the same items; if this
    // writer still held them it would then retire the collect that new write
    // just armed, rejecting it for no reason.
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
    if (RefPtr promise = std::exchange(m_promise, nullptr))
        promise->reject(ExceptionCode::AbortError);
    releaseItems();
    m_clipboard = nullptr;
}

// Retires any collect still outstanding on our items and drops them. Both are
// required: the collect completion holds a Ref back to this writer, so merely
// dropping the items would leave that reference (and the item, and its
// GC-guarded aggregate promise) alive forever; and merely retiring without
// dropping would keep the items past the write. Retiring re-enters
// detachFromClipboard, so the vector is taken first and the loop runs over the
// local copy.
void Clipboard::ItemWriter::releaseItems()
{
    auto items = std::exchange(m_items, {});
    for (auto& item : items) {
        if (item)
            item->cancelDataCollection();
    }
}

// Clears the clipboard's pointer back to this writer. The callers all hold a
// reference of their own, so dropping the clipboard's does not destroy `this`
// underneath them.
void Clipboard::ItemWriter::detachFromClipboard()
{
    releaseItems();
    RefPtr clipboard = m_clipboard.get();
    if (clipboard && clipboard->m_activeItemWriter.get() == this)
        clipboard->m_activeItemWriter = nullptr;
    m_clipboard = nullptr;
}

} // namespace WebCore

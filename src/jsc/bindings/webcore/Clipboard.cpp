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
#include "EventNames.h"
#include "JSClipboardItem.h"
#include "JSDOMConvertSequences.h"
#include "JSDOMConvertStrings.h"
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

ClipboardCompletion Clipboard::writeCompletion(Ref<DeferredPromise>&& promise)
{
    return [promise = WTF::move(promise), protectedThis = Ref { *this }](JSC::JSGlobalObject&, std::span<const ClipboardRepresentation>, const String& failureMessage) {
        if (!failureMessage.isNull()) {
            promise->reject(ExceptionCode::NotAllowedError, failureMessage);
            return;
        }
        promise->resolve();
        protectedThis->fireClipboardEvent(eventNames().copyEvent);
    };
}

void Clipboard::readText(Ref<DeferredPromise>&& promise)
{
    auto* globalObject = promise->globalObject();
    if (!globalObject) {
        promise->reject(ExceptionCode::InvalidStateError);
        return;
    }

    scheduleClipboardReadText(*globalObject, [promise = WTF::move(promise), protectedThis = Ref { *this }](JSC::JSGlobalObject&, std::span<const ClipboardRepresentation> representations, const String& failureMessage) {
        if (!failureMessage.isNull()) {
            promise->reject(ExceptionCode::NotAllowedError, failureMessage);
            return;
        }
        String text = emptyString();
        if (!representations.empty())
            text = String::fromUTF8ReplacingInvalidSequences({ representations[0].bytes, representations[0].length });
        promise->resolve<IDLDOMString>(text);
        protectedThis->fireClipboardEvent(eventNames().pasteEvent);
    });
}

void Clipboard::writeText(const String& data, Ref<DeferredPromise>&& promise)
{
    auto* globalObject = promise->globalObject();
    if (!globalObject) {
        promise->reject(ExceptionCode::InvalidStateError);
        return;
    }

    if (RefPtr previousItemWriter = std::exchange(m_activeItemWriter, nullptr))
        previousItemWriter->invalidate();

    scheduleClipboardWriteText(*globalObject, data, writeCompletion(WTF::move(promise)));
}

void Clipboard::read(Ref<DeferredPromise>&& promise)
{
    auto* globalObject = promise->globalObject();
    if (!globalObject) {
        promise->reject(ExceptionCode::InvalidStateError);
        return;
    }

    scheduleClipboardRead(*globalObject, [promise = WTF::move(promise), protectedThis = Ref { *this }](JSC::JSGlobalObject& globalObject, std::span<const ClipboardRepresentation> representations, const String& failureMessage) {
        if (!failureMessage.isNull()) {
            promise->reject(ExceptionCode::NotAllowedError, failureMessage);
            return;
        }

        Vector<RefPtr<ClipboardItem>> items;
        if (!representations.empty()) {
            ClipboardItemData data;
            data.reserveInitialCapacity(representations.size());
            for (auto& representation : representations) {
                String type = clipboardMIMETypeString(representation.type);
                data.append({ type, Blob::create({ representation.bytes, representation.length }, type, &globalObject).releaseNonNull() });
            }
            items.append(ClipboardItem::create(WTF::move(data)));
        }

        promise->resolve<IDLSequence<IDLInterface<ClipboardItem>>>(items);
        protectedThis->fireClipboardEvent(eventNames().pasteEvent);
    });
}

void Clipboard::write(const Vector<RefPtr<ClipboardItem>>& data, Ref<DeferredPromise>&& promise)
{
    if (RefPtr previousItemWriter = std::exchange(m_activeItemWriter, nullptr))
        previousItemWriter->invalidate();

    // https://w3c.github.io/clipboard-apis/#dom-clipboard-write: the clipboard is written per item.
    if (data.isEmpty()) {
        promise->resolve();
        return;
    }

    if (data.size() > 1) {
        promise->reject(ExceptionCode::NotAllowedError, "Writing multiple ClipboardItems is not supported."_s);
        return;
    }

    Ref itemWriter = ItemWriter::create(*this, Ref { *data[0] }, WTF::move(promise));
    m_activeItemWriter = itemWriter.copyRef();
    itemWriter->write();
}

Clipboard::ItemWriter::ItemWriter(Clipboard& clipboard, Ref<ClipboardItem>&& item, Ref<DeferredPromise>&& promise)
    : m_clipboard(clipboard)
    , m_item(WTF::move(item))
    , m_promise(WTF::move(promise))
{
}

Clipboard::ItemWriter::~ItemWriter() = default;

void Clipboard::ItemWriter::write()
{
    Ref item = *m_item;
    Vector<String> essences;
    for (auto& type : item->types()) {
        auto essence = ClipboardItem::parseMIMETypeEssence(type);
        if (!clipboardMIMETypeFromEssence(essence)) {
            reject(ExceptionCode::NotAllowedError, makeString("The type \""_s, type, "\" is not supported on this platform."_s));
            return;
        }
        // Platform formats carry no parameters, so the second would overwrite the first.
        if (essences.contains(essence)) {
            reject(ExceptionCode::NotAllowedError, makeString("Writing two \""_s, essence, "\" representations is not supported."_s));
            return;
        }
        essences.append(WTF::move(essence));
    }
    if (!clipboardWritesMultipleRepresentations && essences.size() > 1) {
        reject(ExceptionCode::NotAllowedError, "Writing more than one representation per item is not supported on this platform."_s);
        return;
    }

    item->collectDataForWriting([protectedThis = Ref { *this }](std::optional<ClipboardItemData> data, JSC::JSValue failureReason) {
        if (!data) {
            protectedThis->rejectWithValue(failureReason);
            return;
        }
        protectedThis->didCollect(WTF::move(*data));
    });
}

void Clipboard::ItemWriter::didCollect(ClipboardItemData&& data)
{
    RefPtr promise = m_promise;
    if (!promise)
        return;
    // Collected: nothing on the item is armed any more, so a later write of it is independent.
    m_item = nullptr;
    m_data = WTF::move(data);

    Vector<size_t> pendingReads;
    for (size_t index = 0; index < m_data.size(); ++index) {
        if (clipboardBlobNeedsToReadFile(m_data[index].value))
            pendingReads.append(index);
    }
    if (pendingReads.isEmpty()) {
        schedulePlatformWrite();
        return;
    }

    auto* globalObject = promise->globalObject();
    if (!globalObject) {
        reject(ExceptionCode::InvalidStateError, "The clipboard is no longer available."_s);
        return;
    }
    m_pendingBlobReads = pendingReads.size();
    for (auto index : pendingReads) {
        // A synchronous failure has already rejected.
        if (!m_promise)
            return;
        clipboardBlobReadAsync(*globalObject, m_data[index].value, [protectedThis = Ref { *this }, index](std::span<const uint8_t> bytes, const String& failureMessage) {
            protectedThis->didReadBlob(index, bytes, failureMessage);
        });
    }
}

void Clipboard::ItemWriter::didReadBlob(size_t index, std::span<const uint8_t> bytes, const String& failureMessage)
{
    RefPtr promise = m_promise;
    if (!promise)
        return;
    if (!failureMessage.isNull()) {
        reject(ExceptionCode::NotAllowedError, failureMessage);
        return;
    }
    auto* globalObject = promise->globalObject();
    if (!globalObject) {
        reject(ExceptionCode::InvalidStateError, "The clipboard is no longer available."_s);
        return;
    }

    m_data[index].value = Blob::create(bytes, m_data[index].key, globalObject).releaseNonNull();
    ASSERT(m_pendingBlobReads);
    if (!--m_pendingBlobReads)
        schedulePlatformWrite();
}

void Clipboard::ItemWriter::schedulePlatformWrite()
{
    Ref promise = m_promise.releaseNonNull();
    RefPtr clipboard = m_clipboard.get();
    auto data = std::exchange(m_data, {});
    // Scheduled writes are not superseded; they land in whatever order the platform runs them.
    detach();

    auto* globalObject = promise->globalObject();
    if (!clipboard || !globalObject) {
        promise->reject(ExceptionCode::InvalidStateError, "The clipboard is no longer available."_s);
        return;
    }
    scheduleClipboardWrite(*globalObject, data, clipboard->writeCompletion(WTF::move(promise)));
}

void Clipboard::ItemWriter::reject(ExceptionCode code, const String& message)
{
    if (RefPtr promise = std::exchange(m_promise, nullptr))
        promise->reject(code, message);
    detach();
}

void Clipboard::ItemWriter::rejectWithValue(JSC::JSValue failureReason)
{
    if (RefPtr promise = std::exchange(m_promise, nullptr)) {
        if (failureReason)
            promise->reject(failureReason);
        else
            promise->reject(ExceptionCode::NotAllowedError, "A ClipboardItem representation could not be read."_s);
    }
    detach();
}

void Clipboard::ItemWriter::invalidate()
{
    if (RefPtr promise = std::exchange(m_promise, nullptr))
        promise->reject(ExceptionCode::AbortError);
    // The clipboard may be mid-destruction; detach() must not reference it.
    m_clipboard = nullptr;
    detach();
}

// Callers hold their own reference: clearing the clipboard's may drop the last other one.
void Clipboard::ItemWriter::detach()
{
    m_data = {};
    // Retiring the collect re-enters rejectWithValue(), which finds m_item already cleared.
    if (RefPtr item = std::exchange(m_item, nullptr))
        item->cancelDataCollection();
    if (RefPtr clipboard = m_clipboard.get(); clipboard && clipboard->m_activeItemWriter == this)
        clipboard->m_activeItemWriter = nullptr;
    m_clipboard = nullptr;
}

} // namespace WebCore

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

#pragma once

#include "root.h"
#include "ClipboardItemData.h"
#include "ContextDestructionObserver.h"
#include "EventTarget.h"
#include "ExceptionCode.h"
#include <span>
#include <wtf/RefCounted.h>
#include <wtf/RefPtr.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>
#include <wtf/WeakPtr.h>

namespace WebCore {

class ClipboardItem;
class ClipboardRequest;
class DeferredPromise;
class ScriptExecutionContext;

// https://w3c.github.io/clipboard-apis/#clipboard-interface — ported from WebCore's Clipboard.
// Bun diff: no Pasteboard/Document/permissions; the platform transaction is Bun's async Rust
// backend, so ItemWriter schedules a request and settles on its callback rather than inline.
class Clipboard final : public RefCounted<Clipboard>, public ContextDestructionObserver, public EventTarget {
    WTF_MAKE_TZONE_ALLOCATED(Clipboard);

public:
    static Ref<Clipboard> create(ScriptExecutionContext* context) { return adoptRef(*new Clipboard(context)); }
    ~Clipboard();

    void readText(Ref<DeferredPromise>&&);
    void writeText(const String& data, Ref<DeferredPromise>&&);
    void read(Ref<DeferredPromise>&&);
    // Upstream takes Vector<Ref<ClipboardItem>>; Bun's IDLInterface converter
    // yields RefPtr, and entries are non-null because the sequence conversion
    // already rejected anything that was not a ClipboardItem.
    void write(const Vector<RefPtr<ClipboardItem>>& data, Ref<DeferredPromise>&&);

    // The runtime projection of the spec's clipboard events: there is no
    // document or focused element, so a successful operation fires at this
    // EventTarget (`navigator.clipboard`).
    void fireClipboardEvent(const AtomString& type);

    ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }
    EventTargetInterface eventTargetInterface() const final { return ClipboardEventTargetInterfaceType; }

    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }
    USING_CAN_MAKE_WEAKPTR(EventTarget);

private:
    explicit Clipboard(ScriptExecutionContext*);

    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    // Collects every item's representations into refcounted Blobs, then runs one
    // platform transaction once they have all arrived. Mirrors WebCore's
    // Clipboard::ItemWriter, pending-item countdown included.
    class ItemWriter : public RefCounted<ItemWriter> {
    public:
        static Ref<ItemWriter> create(Clipboard& clipboard, Ref<DeferredPromise>&& promise)
        {
            return adoptRef(*new ItemWriter(clipboard, WTF::move(promise)));
        }

        ~ItemWriter();

        void write(const Vector<RefPtr<ClipboardItem>>&);
        void invalidate();

    private:
        ItemWriter(Clipboard&, Ref<DeferredPromise>&&);

        void setData(std::optional<ClipboardItemData>&&, size_t index);
        void didSetAllData();
        void didReadBlobForWrite(size_t index, std::span<const uint8_t> bytes, const String& failureMessage);
        void schedulePlatformWrite(ClipboardItemData&&);
        void didFinishPlatformWrite(const String& failureMessage);
        void reject(ExceptionCode, const String& message);
        // Rejects with the value a representation failed with, so the caller
        // sees its own rejection reason rather than a generic NotAllowedError.
        void rejectWithValue(JSC::JSValue failureReason);
        void releaseItems();
        void detachFromClipboard();

        WeakPtr<Clipboard, WeakPtrImplWithEventTargetData> m_clipboard;
        // The writer is the only strong owner of the items during a write (the reaction holds
        // a WeakPtr back-edge to avoid a native<->GC cycle); without this, an item collected
        // mid-write destroys its data source with the collect completion still armed.
        Vector<RefPtr<ClipboardItem>> m_items;
        RefPtr<DeferredPromise> m_promise;
        Vector<std::optional<ClipboardItemData>> m_dataToWrite;
        unsigned m_pendingItemCount { 0 };
        // Representations staged for the platform transaction while the bytes
        // of non-resident Blobs (Bun.file, S3) are read in.
        ClipboardItemData m_representationsToWrite;
        unsigned m_pendingBlobReads { 0 };
        // The scheduled platform write, so invalidate() can cancel it before
        // the backend job commits it to the OS.
        RefPtr<ClipboardRequest> m_platformWriteRequest;
    };

    RefPtr<ItemWriter> m_activeItemWriter;
};

} // namespace WebCore

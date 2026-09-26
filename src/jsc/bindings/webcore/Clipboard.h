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
#include "ClipboardItem.h"
#include "ClipboardPlatform.h"
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

class DeferredPromise;
class ScriptExecutionContext;

// https://w3c.github.io/clipboard-apis/#clipboard-interface
class Clipboard final : public RefCounted<Clipboard>, public ContextDestructionObserver, public EventTarget {
    WTF_MAKE_TZONE_ALLOCATED(Clipboard);

public:
    static Ref<Clipboard> create(ScriptExecutionContext* context) { return adoptRef(*new Clipboard(context)); }
    ~Clipboard();

    void readText(Ref<DeferredPromise>&&);
    void writeText(const String& data, Ref<DeferredPromise>&&);
    void read(Ref<DeferredPromise>&&);
    void write(const Vector<RefPtr<ClipboardItem>>& data, Ref<DeferredPromise>&&);

    ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }
    EventTargetInterface eventTargetInterface() const final { return ClipboardEventTargetInterfaceType; }

    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }
    USING_CAN_MAKE_WEAKPTR(EventTarget);

private:
    explicit Clipboard(ScriptExecutionContext*);

    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    // There is no document or focused element: successful operations fire at navigator.clipboard.
    void fireClipboardEvent(const AtomString& type);
    ClipboardCompletion writeCompletion(Ref<DeferredPromise>&&);

    // Collects one item into Blobs, then schedules one platform write.
    class ItemWriter : public RefCounted<ItemWriter> {
    public:
        static Ref<ItemWriter> create(Clipboard& clipboard, Ref<ClipboardItem>&& item, Ref<DeferredPromise>&& promise)
        {
            return adoptRef(*new ItemWriter(clipboard, WTF::move(item), WTF::move(promise)));
        }

        ~ItemWriter();

        void write();
        void invalidate();

    private:
        ItemWriter(Clipboard&, Ref<ClipboardItem>&&, Ref<DeferredPromise>&&);

        void didCollect(ClipboardItemData&&);
        void didReadBlob(size_t index, std::span<const uint8_t> bytes, const String& failureMessage);
        void schedulePlatformWrite();
        void reject(ExceptionCode, const String& message);
        void rejectWithValue(JSC::JSValue failureReason);
        void detach();

        WeakPtr<Clipboard, WeakPtrImplWithEventTargetData> m_clipboard;
        // The only strong owner of the item while it is collected.
        RefPtr<ClipboardItem> m_item;
        RefPtr<DeferredPromise> m_promise;
        ClipboardItemData m_data;
        unsigned m_pendingBlobReads { 0 };
    };

    // The writer still collecting; a later write supersedes it.
    RefPtr<ItemWriter> m_activeItemWriter;
};

} // namespace WebCore

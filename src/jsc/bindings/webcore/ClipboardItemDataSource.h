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
#include <wtf/CompletionHandler.h>
#include <wtf/Vector.h>
#include <wtf/WeakRef.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class Clipboard;
class ClipboardItem;
class DeferredPromise;

// Where one ClipboardItem's representations come from (bindings vs platform). Mirrors
// WebCore's ClipboardItemDataSource; yields ClipboardItemData instead of PasteboardCustomData.
class ClipboardItemDataSource {
public:
    ClipboardItemDataSource(ClipboardItem& item)
        : m_item(item)
    {
    }

    virtual ~ClipboardItemDataSource() = default;

    // Bun adds `failureReason` to upstream's CompletionHandler<void(std::optional<PasteboardCustomData>)>
    // so write() can reject with the caller's own rejection/coercion exception instead of a
    // generic NotAllowedError. Read synchronously by the completion, so no separate GC root.
    using CollectCompletionHandler = CompletionHandler<void(std::optional<ClipboardItemData>, JSC::JSValue failureReason)>;

    virtual Vector<String> types() const = 0;
    virtual void getType(const String&, Ref<DeferredPromise>&&) = 0;
    virtual void collectDataForWriting(Clipboard& destination, CollectCompletionHandler&&) = 0;

    // Retire an outstanding collect. The completion holds a Ref to the writer, so a writer
    // going away must call this or that Ref (and the GC-guarded aggregate) is never released.
    virtual void cancelCollect() = 0;

protected:
    WeakRef<ClipboardItem> m_item;
};

} // namespace WebCore

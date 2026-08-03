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
#include "ClipboardItemDataSource.h"
#include <wtf/TZoneMalloc.h>
#include <wtf/CompletionHandler.h>
#include <wtf/KeyValuePair.h>
#include <wtf/Ref.h>
#include <wtf/RefPtr.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class Blob;
class Clipboard;
class DeferredPromise;
class DOMPromise;

// Ported from WebCore's ClipboardItemBindingsDataSource. Bun diff: no ClipboardItemTypeLoader
// (Bun's in-memory Blob is already collected, so one Promise.all reaction converts everything)
// and no markup/SVG/PNG sanitization (needs a Document/Page, which a runtime lacks).
class ClipboardItemBindingsDataSource final : public ClipboardItemDataSource {
    WTF_MAKE_TZONE_ALLOCATED(ClipboardItemBindingsDataSource);

public:
    ClipboardItemBindingsDataSource(ClipboardItem&, Vector<KeyValuePair<String, Ref<DOMPromise>>>&&);
    ~ClipboardItemBindingsDataSource();

private:
    Vector<String> types() const final;
    void getType(const String&, Ref<DeferredPromise>&&) final;
    void collectDataForWriting(Clipboard& destination, CollectCompletionHandler&&) final;
    void cancelCollect() final;

    // Runs once, when every representation has settled.
    void didSettleAllTypes();
    void invokeCompletionHandler(std::optional<ClipboardItemData>&&, JSC::JSValue failureReason = {});

    Vector<KeyValuePair<String, Ref<DOMPromise>>> m_itemPromises;

    // The Promise.all covering m_itemPromises, held only while a write is in
    // flight so the reaction has something to read its result from.
    RefPtr<DOMPromise> m_allTypesSettled;
    CollectCompletionHandler m_completionHandler;
    // One ClipboardItem can be handed to two overlapping write()s. Each collect
    // stamps its reaction, so a reaction left over from a superseded write
    // cannot settle the current one.
    unsigned m_collectGeneration { 0 };
};

} // namespace WebCore

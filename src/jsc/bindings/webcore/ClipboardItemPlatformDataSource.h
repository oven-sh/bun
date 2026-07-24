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

namespace WebCore {

// The data source for an item read() produced. Bun's counterpart to WebCore's
// ClipboardItemPasteboardDataSource: upstream keeps a Clipboard back-pointer and
// re-reads the Pasteboard lazily per type, whereas one Bun read() already
// returned every supported representation, so this just owns them.
class ClipboardItemPlatformDataSource final : public ClipboardItemDataSource {
    WTF_MAKE_TZONE_ALLOCATED(ClipboardItemPlatformDataSource);

public:
    ClipboardItemPlatformDataSource(ClipboardItem&, ClipboardItemData&&);
    ~ClipboardItemPlatformDataSource();

private:
    Vector<String> types() const final;
    void getType(const String&, Ref<DeferredPromise>&&) final;
    void collectDataForWriting(Clipboard& destination, CollectCompletionHandler&&) final;
    void cancelCollect() final { }

    ClipboardItemData m_data;
};

} // namespace WebCore

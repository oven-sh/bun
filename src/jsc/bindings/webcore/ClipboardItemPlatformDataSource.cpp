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

#include "config.h"
#include "ClipboardItemPlatformDataSource.h"

#include "ClipboardItem.h"
#include "ExceptionCode.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMPromiseDeferred.h"
#include "blob.h"
#include <wtf/CompletionHandler.h>
#include <wtf/text/MakeString.h>

// clang-format off
#include <wtf/TZoneMallocInlines.h>
// clang-format on

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(ClipboardItemPlatformDataSource);

ClipboardItemPlatformDataSource::ClipboardItemPlatformDataSource(ClipboardItem& item, ClipboardItemData&& data)
    : ClipboardItemDataSource(item)
    , m_data(WTF::move(data))
{
}

ClipboardItemPlatformDataSource::~ClipboardItemPlatformDataSource() = default;

Vector<String> ClipboardItemPlatformDataSource::types() const
{
    return m_data.map([](auto& representation) {
        return representation.key;
    });
}

void ClipboardItemPlatformDataSource::getType(const String& type, Ref<DeferredPromise>&& promise)
{
    auto matchIndex = m_data.findIf([&](auto& representation) {
        return type == representation.key;
    });

    if (matchIndex == notFound) {
        promise->reject(ExceptionCode::NotFoundError, makeString("The type \""_s, type, "\" was not found"_s));
        return;
    }

    // The read already produced a Blob of exactly this type.
    promise->resolve<IDLInterface<Blob>>(m_data[matchIndex].value.get());
}

void ClipboardItemPlatformDataSource::collectDataForWriting(Clipboard&, CollectCompletionHandler&& completion)
{
    // Nothing to await: writing an item that came off the clipboard just puts
    // the same Blobs back.
    completion(ClipboardItemData { m_data }, JSC::JSValue {});
}

} // namespace WebCore

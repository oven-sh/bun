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
#include "blob.h"
#include <wtf/CompletionHandler.h>
#include <wtf/KeyValuePair.h>
#include <wtf/Ref.h>
#include <wtf/RefCountedAndCanMakeWeakPtr.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class DeferredPromise;
class DOMPromise;
template<typename> class ExceptionOr;

// One item's representations, keyed by serialized MIME type.
using ClipboardItemData = Vector<KeyValuePair<String, Ref<Blob>>>;

// https://w3c.github.io/clipboard-apis/#clipboarditem
class ClipboardItem : public RefCountedAndCanMakeWeakPtr<ClipboardItem> {
public:
    ~ClipboardItem();

    enum class PresentationStyle : uint8_t { Unspecified,
        Inline,
        Attachment };

    struct Options {
        PresentationStyle presentationStyle { PresentationStyle::Unspecified };
    };

    static ExceptionOr<Ref<ClipboardItem>> create(Vector<KeyValuePair<String, Ref<DOMPromise>>>&&, const Options&);
    static Ref<ClipboardItem> create(ClipboardItemData&&);

    // WebIDL `(DOMString or Blob)`: a Blob declaring `type` passes through,
    // another Blob is rewrapped, anything else is ToString'd. Null with an
    // exception pending when the coercion throws.
    static RefPtr<Blob> blobFromSettledValue(JSC::JSGlobalObject*, JSC::JSValue, const String& type);

    Vector<String> types() const;
    void getType(const String&, Ref<DeferredPromise>&&);
    static bool supports(const String& type);

    // The lowercased mimesniff essence (`type/subtype`), or empty when `type` does not parse.
    static String parseMIMETypeEssence(const String&);
    // mimesniff parse + serialize, parameters kept; empty on failure.
    static String parseAndSerializeMIMEType(const String&);
    static bool essenceMatches(const String& serializedKey, const String& essence);

    // `failureReason` is the representation's own rejection or coercion error, if any.
    using CollectCompletionHandler = CompletionHandler<void(std::optional<ClipboardItemData>, JSC::JSValue failureReason)>;
    void collectDataForWriting(CollectCompletionHandler&&);
    void cancelDataCollection();

    PresentationStyle presentationStyle() const { return m_presentationStyle; }
    size_t memoryCost() const;

private:
    ClipboardItem(Vector<KeyValuePair<String, Ref<DOMPromise>>>&&, const Options&);
    explicit ClipboardItem(ClipboardItemData&&);

    void didSettle(JSC::JSGlobalObject&, size_t index, bool isFulfilled, JSC::JSValue);
    void finishCollect(std::optional<ClipboardItemData>&&, JSC::JSValue failureReason = {});

    // Constructed items hold the caller's promises; read() items hold the platform's Blobs.
    Vector<KeyValuePair<String, Ref<DOMPromise>>> m_promises;
    ClipboardItemData m_data;
    PresentationStyle m_presentationStyle { PresentationStyle::Unspecified };

    CollectCompletionHandler m_completionHandler;
    Vector<RefPtr<Blob>> m_collected;
    size_t m_pendingCount { 0 };
    // Stamps each collect so a settle callback left over from a retired one is ignored.
    unsigned m_collectGeneration { 0 };
};

} // namespace WebCore

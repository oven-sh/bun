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
#include <wtf/KeyValuePair.h>
#include <wtf/Ref.h>
#include <wtf/RefCountedAndCanMakeWeakPtr.h>
#include <wtf/UniqueRef.h>
#include <wtf/Vector.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class JSGlobalObject;
}

namespace WebCore {

class Blob;
class Clipboard;
class ClipboardItemDataSource;
class DeferredPromise;
class DOMPromise;
class ScriptExecutionContext;
template<typename> class ExceptionOr;

// https://w3c.github.io/clipboard-apis/#clipboarditem — ported from WebCore's ClipboardItem
// with its two-data-source split (constructor items hold Ref<DOMPromise>s, read() items hold
// Blobs). Bun diff: no Pasteboard, so the platform source owns its data up front.
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
    static Ref<Blob> blobFromString(JSC::JSGlobalObject*, const String& stringData, const String& type);

    // Normalizes a settled value to a Blob of `type` per WebIDL `(DOMString or Blob)`:
    // matching Blob passes through, other Blob is rewrapped, anything else is ToString'd.
    // Returns null with an exception pending when the coercion throws.
    static RefPtr<Blob> blobFromSettledValue(JSC::JSGlobalObject*, JSC::JSValue, const String& type);

    Vector<String> types() const;
    void getType(const String&, Ref<DeferredPromise>&&);
    static bool supports(const String& type);

    // The lowercased mimesniff §4.4 essence (`type/subtype`), or empty for an
    // input that does not parse. Every MIME-type comparison site normalizes
    // through this so validation and storage cannot drift apart.
    static String parseMIMETypeEssence(const String&);
    // mimesniff §4.4 parse + §4.5 serialize (parameters kept); empty on failure.
    static String parseAndSerializeMIMEType(const String&);
    // Whether a stored (serialized) key's essence is `essence`.
    static bool essenceMatches(const String& serializedKey, const String& essence);

    void collectDataForWriting(Clipboard& destination, CompletionHandler<void(std::optional<ClipboardItemData>, JSC::JSValue failureReason)>&&);
    void cancelDataCollection();

    PresentationStyle presentationStyle() const { return m_presentationStyle; }

private:
    ClipboardItem(Vector<KeyValuePair<String, Ref<DOMPromise>>>&&, const Options&);
    explicit ClipboardItem(ClipboardItemData&&);

    const UniqueRef<ClipboardItemDataSource> m_dataSource;
    PresentationStyle m_presentationStyle { PresentationStyle::Unspecified };
};

} // namespace WebCore

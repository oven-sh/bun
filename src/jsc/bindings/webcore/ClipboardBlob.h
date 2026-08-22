#pragma once

// Blob access the clipboard needs against the refcounted impl (blob.h's
// getters take a JS value).

#include "root.h"
#include "blob.h"
#include <span>
#include <wtf/Function.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

// The Blob's resident bytes; empty for a file-/S3-backed Blob, so ask
// clipboardBlobNeedsToReadFile() first.
std::span<const uint8_t> clipboardBlobBytes(Blob&);

// Whether reading this Blob would have to touch a file or the network.
bool clipboardBlobNeedsToReadFile(Blob&);

// `failureMessage` is null on success; the span does not outlive the call.
using ClipboardBlobReadCompletion = Function<void(std::span<const uint8_t>, const String& failureMessage)>;

// Reads the Blob's bytes wherever they live (memory, file, S3) and delivers
// them on the JS thread exactly once, synchronously when resident.
void clipboardBlobReadAsync(JSC::JSGlobalObject&, Blob&, ClipboardBlobReadCompletion&&);

String clipboardBlobContentType(Blob&);

// JS-built values normalize like `new Blob([...], { type })` (Bun appends
// `;charset=utf-8` to text types); platform-read values stay exact.
enum class MimeNormalization : bool { Exact,
    LikeBlobConstructor };

// `new Blob([bytes], { type })` without going through the JS constructor.
Ref<Blob> createClipboardBlob(JSC::JSGlobalObject*, std::span<const uint8_t>, const String& type, MimeNormalization = MimeNormalization::LikeBlobConstructor);

// Whether `declared` already satisfies a request for `requested`: an exact
// match, or `requested` plus a parameter.
bool clipboardBlobTypeMatches(const String& declared, const String& requested);

// A plain-Blob wrapper for getType()'s "a new Blob"
// (https://w3c.github.io/clipboard-apis/#dom-clipboarditem-gettype); blob.h's
// toJS(Blob&) was written for FormData and flips is_jsdom_file. A lazy
// pass-through declaring a different type is stamped with `type`.
JSC::JSValue clipboardBlobToJS(JSC::JSGlobalObject*, Blob&, const String& type);

} // namespace WebCore

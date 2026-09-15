#pragma once

// Blob access the clipboard needs against the refcounted impl (blob.h's
// getters take a JS value).

#include "root.h"
#include "blob.h"
#include <span>
#include <wtf/Function.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

// Empty for a file- or S3-backed Blob; check clipboardBlobNeedsToReadFile() first.
std::span<const uint8_t> clipboardBlobBytes(Blob&);
bool clipboardBlobNeedsToReadFile(Blob&);

// `failureMessage` is null on success; the span does not outlive the call.
using ClipboardBlobReadCompletion = Function<void(std::span<const uint8_t>, const String& failureMessage)>;

// Delivers the Blob's bytes (memory, file, S3) on the JS thread exactly once,
// synchronously when they are resident.
void clipboardBlobReadAsync(JSC::JSGlobalObject&, Blob&, ClipboardBlobReadCompletion&&);

String clipboardBlobContentType(Blob&);

// Whether `declared` satisfies a request for `requested`: equal, or `requested` plus parameters.
bool clipboardBlobTypeMatches(const String& declared, const String& requested);

// getType()'s "a new Blob" (https://w3c.github.io/clipboard-apis/#dom-clipboarditem-gettype):
// a plain Blob sharing the bytes, reporting `type`.
JSC::JSValue clipboardBlobToJS(JSC::JSGlobalObject*, Blob&, const String& type);

} // namespace WebCore

#pragma once

// Blob access the clipboard needs but blob.h does not expose: its getters take a
// JS value, while everything here works from the refcounted impl the clipboard
// collects into.

#include "root.h"
#include "blob.h"
#include <span>
#include <wtf/Function.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

// The Blob's resident bytes. Empty for a Blob backed by a file or S3 — ask
// clipboardBlobNeedsToReadFile() first, because an empty span is otherwise
// indistinguishable from a genuinely empty Blob.
std::span<const uint8_t> clipboardBlobBytes(Blob&);

// Whether reading this Blob would have to touch a file or the network, in
// which case clipboardBlobBytes() is empty and the write path pulls the bytes
// in with clipboardBlobReadAsync() before its platform transaction.
bool clipboardBlobNeedsToReadFile(Blob&);

// `failureMessage` is null on success; the span does not outlive the call.
using ClipboardBlobReadCompletion = Function<void(std::span<const uint8_t>, const String& failureMessage)>;

// Reads the Blob's bytes wherever they live (memory, file, S3) and delivers
// them on the JS thread exactly once — synchronously when they are resident.
void clipboardBlobReadAsync(JSC::JSGlobalObject&, Blob&, ClipboardBlobReadCompletion&&);

String clipboardBlobContentType(Blob&);

// Whether to normalize `type` like the `Blob` constructor (Bun adds `;charset=utf-8` to
// text types). JS-built values normalize to match `new Blob([...], { type })`; values
// read off the platform stay exact so a Blob's `type` matches its ClipboardItem entry.
enum class MimeNormalization : bool { Exact,
    LikeBlobConstructor };

// `new Blob([bytes], { type })` without going through the JS constructor.
Ref<Blob> createClipboardBlob(JSC::JSGlobalObject*, std::span<const uint8_t>, const String& type, MimeNormalization = MimeNormalization::LikeBlobConstructor);

// Whether a Blob declaring `declared` already satisfies a request for
// `requested`: an exact match, or `requested` plus a parameter.
bool clipboardBlobTypeMatches(const String& declared, const String& requested);

// A plain-Blob JS wrapper for getType()'s resolution. blob.h's toJS(Blob&) was
// written for FormData, whose spec'd return is a File, and unconditionally
// flips is_jsdom_file; the spec for getType() says "a new Blob", and browsers
// agree. `type` is the representation key; a lazy pass-through that declared a
// different type is stamped with it, like the resident re-wrap path.
JSC::JSValue clipboardBlobToJS(JSC::JSGlobalObject*, Blob&, const String& type);

} // namespace WebCore

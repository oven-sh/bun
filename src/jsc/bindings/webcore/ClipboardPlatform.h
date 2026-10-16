#pragma once

// Boundary to the platform backend (src/runtime/webcore/clipboard.rs): WebCore owns
// every promise and JS value; the backend sees byte ranges and an opaque request.

#include "root.h"
#include "ClipboardItem.h"
#include <span>
#include <wtf/Function.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

// Mirrors `Mime` in clipboard.rs.
enum class ClipboardMIMEType : uint8_t {
    TextPlain,
    TextHtml,
    ImagePng,
};

std::optional<ClipboardMIMEType> clipboardMIMETypeFromEssence(StringView);
ASCIILiteral clipboardMIMETypeString(ClipboardMIMEType);

// The POSIX helper programs own one representation per invocation.
#if OS(DARWIN) || OS(WINDOWS)
constexpr bool clipboardWritesMultipleRepresentations = true;
#else
constexpr bool clipboardWritesMultipleRepresentations = false;
#endif

// Mirrors `Representation` in clipboard.rs; the bytes are borrowed for the call.
struct ClipboardRepresentation {
    ClipboardMIMEType type;
    const uint8_t* bytes;
    size_t length;
};

// Runs once on the JS thread. Empty `representations` is not an error; `failureMessage` is null on success.
using ClipboardCompletion = Function<void(JSC::JSGlobalObject&, std::span<const ClipboardRepresentation>, const String& failureMessage)>;

void scheduleClipboardReadText(JSC::JSGlobalObject&, ClipboardCompletion&&);
void scheduleClipboardRead(JSC::JSGlobalObject&, ClipboardCompletion&&);
void scheduleClipboardWriteText(JSC::JSGlobalObject&, const String& text, ClipboardCompletion&&);
// Every key must have passed clipboardMIMETypeFromEssence().
void scheduleClipboardWrite(JSC::JSGlobalObject&, const ClipboardItemData&, ClipboardCompletion&&);

} // namespace WebCore

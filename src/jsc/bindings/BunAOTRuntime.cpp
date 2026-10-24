#include "root.h"

#include "BunAOTCompile.h"
#include "headers-handwritten.h"
#include "helpers.h"
#include <JavaScriptCore/AOTBuiltinTableBindings.h>
#include <JavaScriptCore/AOTHost.h>
#include <JavaScriptCore/AOTImageLoading.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/MarkedBlockCage.h>
#include <JavaScriptCore/Options.h>
#include <array>
#include <cstdlib>
#include <cstring>
#include <optional>
#include <span>
#include <string_view>
#include <wtf/DataLog.h>
#include <wtf/text/CString.h>
#include <wtf/text/WTFString.h>

#if ENABLE(AOT)
static_assert(sizeof(JSC::AOT::Wire::ImageVerdict) == sizeof(uint32_t));
static_assert(sizeof(JSC::AOT::Wire::AdmittedCode) == sizeof(uint32_t));
#endif
static_assert(sizeof(size_t) == sizeof(void*));

namespace Bun {

[[noreturn]] static void exitForCageError(JSC::MarkedBlockCage::Error error)
{
    using Error = JSC::MarkedBlockCage::Error;

    unsigned size = JSC::Options::markedBlockCageSizeInMB();
    switch (error) {
    case Error::Disabled:
        dataLogLn("error: this executable can't run with BUN_JSC_markedBlockCageSizeInMB=0. Build it with --aot-huge-heap to run it without a heap limit.");
        break;
    case Error::InvalidSize:
        dataLogLn("markedBlockCageSizeInMB is not 0 or a power of two of at most 32768: ", size);
        break;
    case Error::BlocksOutsideCage:
        dataLogLn("error: the objects created before this executable's code was loaded don't fit in BUN_JSC_markedBlockCageSizeInMB=", size, ". Raise it, or build with --aot-huge-heap.");
        break;
    case Error::ReservationFailed: {
        auto [sizeWithinBudget, smallestSize] = JSC::MarkedBlockCage::reservationFailure();
        if (sizeWithinBudget < smallestSize)
            dataLogLn("error: this executable needs ", smallestSize / MB, " MB of address space for its JavaScript heap, and the limit on address space (ulimit -v) leaves ", sizeWithinBudget / MB, " MB for it. Raise the limit, or build with --aot-huge-heap.");
        else
            dataLogLn("error: this executable could not reserve address space for its JavaScript heap. It asked for ", sizeWithinBudget / MB, " MB and then for less, down to ", smallestSize / MB, " MB. Raise the limit on address space (ulimit -v), or build with --aot-huge-heap.");
        break;
    }
    }
    exit(EXIT_FAILURE);
}

void initializeCellCage()
{
    if (auto result = JSC::MarkedBlockCage::initialize(); !result)
        exitForCageError(result.error());
}

void requireCellCage()
{
#if ENABLE(AOT)
    const JSC::AOT::Image* image = JSC::AOT::Image::current();
    if (!image || image->header().options.useWideReferences())
        return;
    if (auto result = JSC::MarkedBlockCage::require(); !result)
        exitForCageError(result.error());
#endif
}

// B3 and Air take every knob from the policy of the build. The WebAssembly front end sets this one from the process.
static constinit std::optional<unsigned> defaultWasmOMGOptimizationLevel;

void saveBackEndOptionDefaults()
{
    defaultWasmOMGOptimizationLevel = JSC::Options::wasmOMGOptimizationLevel();
}

void discardBackEndOptionsOfEnvironment()
{
#ifndef BUN_DEBUG
    JSC::Options::wasmOMGOptimizationLevel() = *defaultWasmOMGOptimizationLevel;
#endif
}

} // namespace Bun

#if ENABLE(AOT)

extern "C" void Bun__ThreadPool__exitWithoutAnyThread();

extern "C" JSC::AOT::Wire::ImageVerdict Bun__AOT__useImage(BunAOTBytes image, BunAOTBytes allImages, const BunAOTImageFile* fileOrNull, const uint8_t identity[16])
{
    if (!JSC::AOT::BuiltinBindings::hasHost())
        Bun__AOT__registerHostBindings();
    std::array<uint8_t, 16> id;
    memcpy(id.data(), identity, id.size());
    auto file = fileOrNull ? std::optional(JSC::AOT::ImageFile { fileOrNull->descriptor, fileOrNull->offset }) : std::nullopt;
    auto verdict = JSC::AOT::useImage({ image.ptr, image.len }, file, id, { allImages.ptr, allImages.len });
    if (verdict == JSC::AOT::Wire::ImageVerdict::NeedsCellCage) {
        auto result = JSC::MarkedBlockCage::require();
        RELEASE_ASSERT(!result);
        Bun::exitForCageError(result.error());
    }
    if (JSC::AOT::Image::isRegistered())
        Bun__ThreadPool__exitWithoutAnyThread();
    return verdict;
}

extern "C" bool Bun__AOT__admittedCode(BunAOTBytes image, JSC::AOT::Wire::AdmittedCode* admitted)
{
    auto found = JSC::AOT::Image::admittedCode({ image.ptr, image.len });
    if (!found)
        return false;
    *admitted = *found;
    return true;
}

extern "C" bool Bun__AOT__admitsUnknownJavaScript(BunAOTBytes image)
{
    auto flags = JSC::AOT::Image::flags({ image.ptr, image.len });
    return !flags || flags->contains(JSC::AOT::ImageFlag::AdmitsUnknownJavaScript);
}

extern "C" bool Bun__AOT__loadsCodeOutsideImage(BunAOTBytes image)
{
    auto flags = JSC::AOT::Image::flags({ image.ptr, image.len });
    return !JSC::AOT::runsOnlyCodeOfImage && flags && flags->contains(JSC::AOT::ImageFlag::LoadsCodeOutsideImage);
}

extern "C" BunAOTBytes Bun__AOT__imageCode()
{
    const JSC::AOT::Image* image = JSC::AOT::Image::current();
    if (!image)
        return { nullptr, 0 };
    std::span code = image->code();
    return { code.data(), code.size() };
}

extern "C" void Bun__AOT__setMismatchLog(intptr_t descriptor, bool isJSON)
{
    JSC::AOT::setMismatchLog(descriptor, isJSON);
}

extern "C" void Bun__AOT__setMismatchLogFormat(bool isJSON)
{
    JSC::AOT::setMismatchLogFormat(isJSON);
}

extern "C" void Bun__AOT__recordRefusedChange(const BunString* refusal, const BunString* sourceURL, unsigned line, unsigned column);
extern "C" void Bun__CallFrame__getCallerSrcLoc(JSC::CallFrame*, JSC::JSGlobalObject*, BunString* outSourceURL, unsigned* outLine, unsigned* outColumn);

static void recordRefusedChange(JSC::JSGlobalObject* globalObject, const String& refusal)
{
    JSC::CallFrame* callFrame = globalObject->vm().topCallFrame;
    if (!callFrame)
        return;
    BunString sourceURL = Bun::BunStringEmpty;
    unsigned line = 0;
    unsigned column = 0;
    Bun__CallFrame__getCallerSrcLoc(callFrame, globalObject, &sourceURL, &line, &column);
    BunString text = Bun::toStringRef(refusal);
    Bun__AOT__recordRefusedChange(&text, &sourceURL, line, column);
    text.deref();
    sourceURL.deref();
}

extern "C" void Bun__AOT__listRefusedChanges()
{
    JSC::AOT::setRefusedChangeListener(recordRefusedChange);
}

extern "C" void Bun__AOT__setVerbose(bool isVerbose)
{
    JSC::AOT::setVerbose(isVerbose);
}

extern "C" int64_t Bun__AOT__offsetInCode(const void* address)
{
    auto offset = JSC::AOT::imageCodeOffset(address);
    return offset ? static_cast<int64_t>(*offset) : -1;
}

// As CompiledFrame::decode in src/bun_core/debug.rs reads it. Negative outside compiled code.
extern "C" int64_t Bun__AOT__frameAtReturnAddress(const void* returnAddress)
{
    auto frame = JSC::AOT::imageFrameAtReturnAddress(returnAddress);
    if (!frame)
        return -1;
    int64_t result = static_cast<int64_t>(frame->frameSizeInBytes()) << 16;
    result |= frame->hasFrameRecord() ? 1 : 0;
    result |= frame->isEmpty() ? 2 : 0;
    result |= frame->liesBelowSpilledArguments() ? 4 : 0;
    result |= JSC::AOT::Image::current()->locate(returnAddress).kind == JSC::AOT::CodeKind::Stub ? 8 : 0;
    return result;
}

extern "C" size_t Bun__AOT__addressOfOffsetInCode(size_t offset)
{
    return JSC::AOT::imageCodeStart() + offset;
}

extern "C" size_t Bun__AOT__describeAddresses(const size_t* addresses, size_t count, uint8_t* buffer, size_t capacity)
{
    String text = JSC::AOT::describeCodeAddresses(std::span { reinterpret_cast<const void* const*>(addresses), count });
    CString utf8 = text.utf8();
    std::u8string_view bytes { utf8.data(), utf8.length() };
    size_t length = bytes.size();
    if (length > capacity) {
        size_t lastNewline = bytes.substr(0, capacity).rfind(u8'\n');
        length = lastNewline == std::u8string_view::npos ? 0 : lastNewline + 1;
    }
    if (length)
        memcpy(buffer, bytes.data(), length);
    return length;
}

#else // ENABLE(AOT)

// ImageVerdict::Unsupported.
extern "C" uint32_t Bun__AOT__useImage(BunAOTBytes, BunAOTBytes, const BunAOTImageFile*, const uint8_t*) { return 0; }
extern "C" bool Bun__AOT__admittedCode(BunAOTBytes, uint32_t*) { return false; }
extern "C" bool Bun__AOT__admitsUnknownJavaScript(BunAOTBytes) { return true; }
extern "C" bool Bun__AOT__loadsCodeOutsideImage(BunAOTBytes) { return true; }
extern "C" BunAOTBytes Bun__AOT__imageCode() { return { nullptr, 0 }; }
extern "C" void Bun__AOT__setMismatchLog(intptr_t, bool) {}
extern "C" void Bun__AOT__setMismatchLogFormat(bool) {}
extern "C" void Bun__AOT__listRefusedChanges() {}
extern "C" void Bun__AOT__setVerbose(bool) {}
extern "C" int64_t Bun__AOT__offsetInCode(const void*) { return -1; }
extern "C" int64_t Bun__AOT__frameAtReturnAddress(const void*) { return -1; }
extern "C" size_t Bun__AOT__addressOfOffsetInCode(size_t offset) { return offset; }
extern "C" size_t Bun__AOT__describeAddresses(const size_t*, size_t, uint8_t*, size_t) { return 0; }

// JavaScriptCore's aot/runtime/AOTExpectedRows.cpp, where the realm runs no compiled program. src/sql_jsc/shared/RowDecoder.rs decodes the row itself then.
extern "C" uint32_t JSC__AOT__expectedResultType(JSC::JSGlobalObject*, JSC::EncodedJSValue) { return 0; }
extern "C" void* JSC__AOT__ObjectBuilderPlan__create(JSC::JSGlobalObject*, uint32_t, const void*, uint32_t) { return nullptr; }
extern "C" void JSC__AOT__ObjectBuilderPlan__destroy(void*) {}
extern "C" JSC::EncodedJSValue JSC__AOT__ObjectBuilderPlan__createObject(JSC::JSGlobalObject*, const void*, const void*) { return JSC::JSValue::encode({}); }

#endif // ENABLE(AOT)

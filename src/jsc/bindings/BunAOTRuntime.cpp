#include "root.h"

#include "BunAOTCompile.h"
#include "headers-handwritten.h"
#include "helpers.h"
#include <JavaScriptCore/AOTBuiltinTableBindings.h>
#include <JavaScriptCore/AOTHost.h>
#include <JavaScriptCore/AOTImageLoading.h>
#include <JavaScriptCore/AOTModuleHost.h>
#include <JavaScriptCore/AOTRealmStartup.h>
#include <JavaScriptCore/AOTRuntimeDescription.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/MarkedBlockCage.h>
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/WasmStreamingParser.h>
#include <array>
#include <cstdlib>
#include <cstring>
#include <openssl/sha.h>
#include <optional>
#include <span>
#include <string_view>
#include <wtf/DataLog.h>
#include <wtf/ScopedLambda.h>
#include <wtf/text/CString.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/StringView.h>
#include <wtf/text/WTFString.h>

#if ENABLE(AOT) && OS(LINUX)
#include <mimalloc.h>
#include <unistd.h>
#endif

#if ENABLE(AOT)
static_assert(sizeof(JSC::AOT::Wire::ImageVerdict) == sizeof(uint32_t));
static_assert(sizeof(JSC::AOT::Wire::AdmittedCode) == sizeof(uint32_t));
#endif
static_assert(sizeof(size_t) == sizeof(void*));

static constexpr uint32_t leftOutOfThisBuild = 0
#if defined(BUN_DISABLE_FFI)
    | 1 << 0
#endif
#if defined(BUN_DISALLOW_CODE_GENERATION_FROM_STRINGS)
    | 1 << 1
#endif
    ;

extern "C" uint32_t Bun__AOT__whatThisBuildLeavesOut() { return leftOutOfThisBuild; }

#if ENABLE(AOT)
struct alignas(8) DescribedBuild {
    char kind[8];
    uint32_t size;
    uint32_t leftOut;
};
extern "C" AOT_IN_RUNTIME_DESCRIPTION_SECTION const DescribedBuild Bun__AOT__describedBuild;
extern "C" AOT_KEPT_BY_EVERY_LINKER constinit const DescribedBuild Bun__AOT__describedBuild = { { 'B', 'U', 'N', 'A', 'O', 'T', 'L', 'O' }, sizeof(DescribedBuild), leftOutOfThisBuild };
#endif

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

#if OS(LINUX)
extern "C" uint64_t* Bun__getStandaloneModuleGraphELFVaddr();
extern "C" size_t Bun__sizeOfPayloadWithCompiledProgram();

// Called before the first allocation of the process, which is where the allocator reserves its first arena.
extern "C" void Bun__askForAddressSpaceToStart()
{
    if (!*Bun__getStandaloneModuleGraphELFVaddr())
        return;
    size_t sizeOfProgram = Bun__sizeOfPayloadWithCompiledProgram();
    if (!sizeOfProgram)
        return;
    // An arena has the size of the option. If that is refused and the option is larger, it has the second size.
    static constexpr size_t sizesOfArena[] = { GB, 128 * MB };
    auto [needed, left, largestArena, isRefused] = JSC::AOT::askForAddressSpaceToStart(sizeOfProgram, sizesOfArena);
    if (isRefused) {
        char message[256];
        int length = snprintf(message, sizeof(message), "error: this executable needs %zu MB of address space to start, and the limit on address space (ulimit -v) leaves %zu MB. Raise the limit.\n", (needed + MB - 1) / MB, left / MB);
        if (length > 0)
            (void)!write(STDERR_FILENO, message, length);
        _exit(EXIT_FAILURE);
    }
    if (largestArena < sizesOfArena[0])
        mi_option_set_default(mi_option_arena_reserve, largestArena / KB);
}
#endif

extern "C" void Bun__AOT__takePagesForTablesOfFirstThread()
{
    JSC::AOT::PagesForNewThread result = JSC::AOT::tryReservePagesForFirstThread();
    if (result.isRefused) {
        dataLogLn("error: the limit on address space (ulimit -v) leaves no room for the tables of this executable's program. Raise the limit.");
        exit(EXIT_FAILURE);
    }
    JSC::AOT::adoptPagesForNewThread(result.pages);
}

extern "C" bool mi_on_thread_idle_start(void) noexcept;
extern "C" void mi_on_thread_idle_end(void) noexcept;

// mimalloc starts the thread that gives freed memory back when a second thread comes or a thread first parks. A compiled program may do neither for as long as it runs.
extern "C" void Bun__didFinishFirstCollectionOfCompiledProgram()
{
    if (mi_on_thread_idle_start())
        mi_on_thread_idle_end();
}

static_assert(sizeof(SHA_CTX) <= JSC::Wasm::SourceHasher::contextSize && alignof(SHA_CTX) <= 8);

extern "C" void Bun__initializeSHA1(void* context)
{
    SHA1_Init(static_cast<SHA_CTX*>(context));
}

extern "C" void Bun__updateSHA1(void* context, std::span<const uint8_t> bytes)
{
    SHA1_Update(static_cast<SHA_CTX*>(context), bytes.data(), bytes.size());
}

extern "C" void Bun__finishSHA1(void* context, std::array<uint8_t, 20>& digest)
{
    SHA1_Final(digest.data(), static_cast<SHA_CTX*>(context));
}

extern "C" void Bun__ThreadPool__exitWithoutAnyThread();

extern "C" JSC::AOT::Wire::ImageVerdict Bun__AOT__useImage(BunAOTBytes image, const BunAOTImageFile* fileOrNull, const uint8_t identity[16])
{
    if (!JSC::AOT::BuiltinBindings::hasHost())
        Bun__AOT__registerHostBindings();
    JSC::AOT::setBufferStructureProvider([](JSC::JSGlobalObject* realm) {
        return defaultGlobalObject(realm)->JSBufferSubclassStructure();
    });
    std::array<uint8_t, 16> id;
    memcpy(id.data(), identity, id.size());
    auto file = fileOrNull ? std::optional(JSC::AOT::ImageFile { fileOrNull->descriptor, fileOrNull->offset }) : std::nullopt;
    auto verdict = JSC::AOT::useImage({ image.ptr, image.len }, file, id);
    if (verdict == JSC::AOT::Wire::ImageVerdict::NeedsCellCage) {
        auto result = JSC::MarkedBlockCage::require();
        RELEASE_ASSERT(!result);
        Bun::exitForCageError(result.error());
    }
    if (JSC::AOT::Image::isRegistered())
        Bun__ThreadPool__exitWithoutAnyThread();
    return verdict;
}

extern "C" bool Bun__AOT__useNoImageOnThisThread(BunAOTBytes specifier)
{
    if (JSC::AOT::isHardenedBuild)
        return false;
    // All that the thread runs from here on is bytecode.
    if (JSC::Options::crashIfInterpreterIsUsed()) [[unlikely]] {
        dataLogLn("crashIfInterpreterIsUsed: Worker ", WTF::String::fromUTF8ReplacingInvalidSequences(std::span { specifier.ptr, specifier.len }));
        CRASH();
    }
    JSC::AOT::Image::disableOnThisThread();
    return true;
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
    return !JSC::AOT::isHardenedBuild && flags && flags->contains(JSC::AOT::ImageFlag::LoadsCodeOutsideImage);
}

extern "C" BunAOTBytes Bun__AOT__imageCode()
{
    const JSC::AOT::Image* image = JSC::AOT::Image::current();
    if (!image)
        return { nullptr, 0 };
    std::span code = image->code();
    return { code.data(), code.size() };
}

extern "C" void Bun__AOT__recordRefusedChange(const BunString* refusal, const BunString* sourceURL, unsigned line, unsigned column);
extern "C" void Bun__CallFrame__getCallerSrcLoc(JSC::CallFrame*, JSC::JSGlobalObject*, BunString* outSourceURL, unsigned* outLine, unsigned* outColumn);

static void recordRefusedChange(JSC::JSGlobalObject* globalObject, const String& refusal)
{
    JSC::CallFrame* callFrame = globalObject->vm().topCallFrame;
    // The loader starts a module from no frame, and what is said of a file that runs names no place.
    bool namesPlace = !refusal.startsWith("Ran from source "_s) && !refusal.startsWith("Kept the run of "_s);
    if (!callFrame && namesPlace)
        return;
    BunString sourceURL = Bun::BunStringEmpty;
    unsigned line = 0;
    unsigned column = 0;
    if (namesPlace)
        Bun__CallFrame__getCallerSrcLoc(callFrame, globalObject, &sourceURL, &line, &column);
    BunString text = Bun::toStringRef(refusal);
    Bun__AOT__recordRefusedChange(&text, &sourceURL, line, column);
    text.deref();
    sourceURL.deref();
}

extern "C" void Bun__AOT__recordMissingExport(const BunString* name, const BunString* exporter, const BunString* importer);

static void recordMissingExport(const String& name, const String& exporter, const String& importer)
{
    BunString texts[] = { Bun::toStringRef(name), Bun::toStringRef(exporter), Bun::toStringRef(importer) };
    Bun__AOT__recordMissingExport(&texts[0], &texts[1], &texts[2]);
    for (BunString& text : texts)
        text.deref();
}

static bool listsRefusedChanges;

extern "C" void Bun__AOT__listRefusedChanges()
{
    listsRefusedChanges = true;
    JSC::AOT::setRejectedChangeListener(recordRefusedChange);
    JSC::AOT::setMissingExportListener(recordMissingExport);
}

extern "C" void Bun__AOT__openNameWithoutImage(uint32_t holder, const uint8_t* name, size_t length)
{
    JSC::AOT::unlockNameWithoutImage(holder, std::span { name, length });
}

namespace Bun {

void recordRefusedLoad(JSC::JSGlobalObject* globalObject, const String& path)
{
    if (listsRefusedChanges)
        recordRefusedChange(globalObject, makeString("Cannot load '"_s, path, '\''));
}

void recordFileRunFromSource(JSC::JSGlobalObject* globalObject, const String& path, ASCIILiteral why)
{
    if (listsRefusedChanges)
        recordRefusedChange(globalObject, makeString("Ran from source '"_s, path, "': "_s, why));
}

bool recordAddonLoadedFromDisk(JSC::JSGlobalObject* globalObject, const String& path)
{
    if (listsRefusedChanges)
        recordRefusedChange(globalObject, makeString("Loaded '"_s, path, '\''));
    return listsRefusedChanges;
}

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
    result |= JSC::AOT::isInImageStub(returnAddress) ? 8 : 0;
    return result;
}

extern "C" size_t Bun__AOT__addressOfOffsetInCode(size_t offset)
{
    return JSC::AOT::imageCodeStart() + offset;
}

static void appendCompiledFrame(StringBuilder& text, const JSC::AOT::Image& image, const JSC::AOT::TraceFrame& frame)
{
    if (image.isObfuscated()) {
        JSC::LineColumn position = JSC::AOT::obfuscatedPositionOf(frame);
        text.append("    at "_s, position.line, ':', position.column, '\n');
        return;
    }
    // A built-in function whose steps compiled code runs itself has a number behind the functions of the program. The image holds no name for it.
    if (JSC::AOT::builtinOfFunctionInFrames(frame.function))
        return;
    auto position = JSC::AOT::positionOf(frame);
    String place = position && position->source ? makeString(JSC::AOT::displayPathOf(position->source), ':', position->lineColumn.line, ':', position->lineColumn.column) : String();
    if (JSC::AOT::FunctionDescription(frame.function).codeType() == JSC::ModuleCode) {
        text.append("    at "_s, place, '\n');
        return;
    }
    std::optional<uint32_t> writtenName = image.programTables().nameOfFunction(frame.function.index());
    StringView name = writtenName && image.text().hasText(JSC::AOT::StringID(*writtenName)) ? image.text().view(JSC::AOT::StringID(*writtenName)) : StringView();
    if (name.isEmpty())
        name = StringView("<anonymous>"_s);
    if (place.isEmpty())
        text.append("    at "_s, name, '\n');
    else
        text.append("    at "_s, name, " ("_s, place, ")\n"_s);
}

// For a process that is crashing, too: it asks no VM.
extern "C" size_t Bun__AOT__describeAddresses(const size_t* addresses, size_t count, uint8_t* buffer, size_t capacity)
{
    const JSC::AOT::Image* image = JSC::AOT::Image::current();
    if (!image)
        return 0;
    StringBuilder text;
    JSC::AOT::ShownFrameFilter filter;
    std::span codeAddresses { reinterpret_cast<const void* const*>(addresses), count };
    for (const void* const& address : codeAddresses) {
        JSC::AOT::CodeLocation location = image->locate(address);
        if (location.kind != JSC::AOT::CodeKind::Function)
            continue;
        // Where the function has no site for the address, the frame is reported at the start of the function.
        JSC::AOT::CallSiteRecord site = image->returnSiteInfoAt(location.function, location.offset).site.value_or(JSC::AOT::CallSiteRecord { JSC::CallSiteIndex(0), 0 });
        // Every address but the first is a return address, so its callee has started. A tail call that was compiled as a plain call hides its caller, as in Error.stack.
        // forEachShownFrame() assumes that the callee was not entered, and reads nothing from the kind except whether the caller has left.
        bool calleeWasEntered = &address != codeAddresses.data();
        if (site.isTailDeleted(calleeWasEntered))
            site.kind = JSC::AOT::CallSiteKind::InsideCallee;
        JSC::AOT::forEachShownFrame(JSC::AOT::CompiledFunctionID(location.function), site, filter, [&](const JSC::AOT::TraceFrame& frame) {
            appendCompiledFrame(text, *image, frame);
        });
    }
    CString utf8 = text.toString().utf8();
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
extern "C" uint32_t Bun__AOT__useImage(BunAOTBytes, const BunAOTImageFile*, const uint8_t*) { return 0; }
extern "C" bool Bun__AOT__useNoImageOnThisThread(BunAOTBytes) { return false; }
extern "C" bool Bun__AOT__admittedCode(BunAOTBytes, uint32_t*) { return false; }
extern "C" bool Bun__AOT__admitsUnknownJavaScript(BunAOTBytes) { return true; }
extern "C" bool Bun__AOT__loadsCodeOutsideImage(BunAOTBytes) { return true; }
extern "C" BunAOTBytes Bun__AOT__imageCode() { return { nullptr, 0 }; }
extern "C" void Bun__AOT__takePagesForTablesOfFirstThread() {}
#if OS(LINUX)
extern "C" void Bun__askForAddressSpaceToStart() {}
#endif
extern "C" void Bun__AOT__listRefusedChanges() {}
extern "C" void Bun__AOT__openNameWithoutImage(uint32_t, const uint8_t*, size_t) {}
extern "C" void Bun__AOT__setVerbose(bool) {}
extern "C" int64_t Bun__AOT__offsetInCode(const void*) { return -1; }
extern "C" int64_t Bun__AOT__frameAtReturnAddress(const void*) { return -1; }
extern "C" size_t Bun__AOT__addressOfOffsetInCode(size_t offset) { return offset; }
extern "C" size_t Bun__AOT__describeAddresses(const size_t*, size_t, uint8_t*, size_t) { return 0; }

#endif // ENABLE(AOT)

#include "root.h"

#if ENABLE(AOT)

#include "BunAOTCompile.h"

#include "AOTSchemaHash.h"
#include <JavaScriptCore/AOTBuiltinTableBindings.h>
#include <JavaScriptCore/AOTCompile.h>
#include <JavaScriptCore/AOTCompileOptionWords.h>
#include <JavaScriptCore/AOTOpcode.h>
#include <JavaScriptCore/AOTPassID.h>
#include <JavaScriptCore/AOTRemovableFeature.h>
#include <JavaScriptCore/AOTRuntimeDescription.h>
#include <JavaScriptCore/AOTRuntimeTable.h>
#include <algorithm>
#include <array>
#include <cstring>
#include <memory>
#include <mutex>
#include <optional>
#include <span>
#include <wtf/BitSet.h>
#include <wtf/MainThread.h>
#include <wtf/StdLibExtras.h>
#include <wtf/Threading.h>
#include <wtf/Vector.h>
#include <wtf/text/CString.h>
#include <wtf/text/WTFString.h>

#if OS(WINDOWS)
#include <fcntl.h>
#include <io.h>
#include <stdlib.h>
#endif

static_assert(JSC::AOT::Wire::schemaHash == BUN_AOT_SCHEMA_HASH, "the Rust half of the compiler and JavaScriptCore's AOTWire.h were generated from different schemas");
static_assert(sizeof(JSC::AOT::Wire::ResultSection) == sizeof(uint32_t));
static_assert(sizeof(JSC::AOT::Wire::PassID) == sizeof(uint32_t));

namespace Typed = JSC::AOT::Typed;
namespace Wire = JSC::AOT::Wire;

static constexpr size_t sectionAlignment = 8;
static constexpr BunAOTBytes noBytes { nullptr, 0 };

struct BunAOTResult {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(BunAOTResult);

    std::unique_ptr<JSC::AOT::CompileOutput> output;
    JSC::AOT::Vector<uint8_t> text;
    JSC::AOT::Vector<Wire::UserDiagnosticRecord> userDiagnostics;
    JSC::AOT::Vector<Wire::InternalErrorRecord> internalErrors;
    JSC::AOT::Vector<Wire::FeatureUseRecord> featuresUsed;
    JSC::AOT::Vector<Wire::LocaleUseRecord> localesUsed;
    JSC::AOT::Vector<Wire::WorkerEntryRecord> workerEntries;
    JSC::AOT::Vector<Wire::AllocationRemarkRecord> allocationRemarks;
    JSC::AOT::Vector<Wire::ObfuscatedSiteRecord> obfuscatedSites;
    JSC::AOT::Vector<Wire::FunctionReportRecord> functions;
    JSC::AOT::Vector<Wire::OperationCountRecord> operationCounts;
    JSC::AOT::Vector<Wire::PassTimeRecord> passTimes;
    JSC::AOT::Vector<uint64_t> statistics;
    JSC::AOT::Vector<uint64_t> limitValues;
};

static Wire::TextRange appendText(JSC::AOT::Vector<uint8_t>& text, std::span<const uint8_t> utf8)
{
    static_assert(!WTF::isValidCapacityForVector<uint8_t>(UINT32_MAX));

    size_t offset = text.size();
    if (!text.tryAppend(utf8))
        return { 0, 0 };
    return { static_cast<uint32_t>(offset), static_cast<uint32_t>(utf8.size()) };
}

static Wire::TextRange appendText(JSC::AOT::Vector<uint8_t>& text, const String& string)
{
    return appendText(text, byteCast<uint8_t>(string.utf8().span()));
}

template<typename Record>
static JSC::AOT::Vector<Record> rebaseTextRanges(JSC::AOT::Vector<uint8_t>& text, std::span<const uint8_t> recordText, JSC::AOT::Vector<Record> records, Wire::TextRange Record::* member)
{
    Wire::TextRange appended = appendText(text, recordText);
    bool didAppend = appended.length == recordText.size();
    for (Record& record : records) {
        Wire::TextRange& range = record.*member;
        range = didAppend ? Wire::TextRange { appended.offset + range.offset, range.length } : Wire::TextRange { 0, 0 };
    }
    return records;
}

template<typename E>
class EnumeratorNames {
public:
    explicit EnumeratorNames(JSC::AOT::Vector<uint8_t>& text)
        : m_text(text)
    {
    }

    Wire::TextRange ensure(E enumerator)
    {
        std::optional<Wire::TextRange>& name = m_names[static_cast<size_t>(enumerator)];
        if (!name)
            name = appendText(m_text, byteCast<uint8_t>(nameOf(enumerator).span8()));
        return *name;
    }

private:
    JSC::AOT::Vector<uint8_t>& m_text;
    std::array<std::optional<Wire::TextRange>, JSC::AOT::numberOfEnumerators<E>> m_names;
};

using OperationNames = EnumeratorNames<Typed::Opcode>;

template<typename T>
static BunAOTBytes bytesOf(const JSC::AOT::Vector<T>& vector)
{
    static_assert(alignof(T) <= sectionAlignment);
    std::span<const uint8_t> bytes = asByteSpan(vector.span());
    return { bytes.data(), bytes.size() };
}

extern "C" BunAOTBytes Bun__AOT__resultSection(const BunAOTResult* result, Wire::ResultSection section)
{
    const JSC::AOT::CompileOutput* output = result->output.get();

    switch (section) {
    case Wire::ResultSection::Image:
        return output ? bytesOf(output->image) : noBytes;
    case Wire::ResultSection::Text:
        return bytesOf(result->text);
    case Wire::ResultSection::UserDiagnostics:
        return bytesOf(result->userDiagnostics);
    case Wire::ResultSection::InternalErrors:
        return bytesOf(result->internalErrors);
    case Wire::ResultSection::EntryModuleIds:
        return output ? bytesOf(output->entryModuleIDs) : noBytes;
    case Wire::ResultSection::UnseenCode:
        return output ? bytesOf(output->flowReport.unseenCode) : noBytes;
    case Wire::ResultSection::BuiltinsUsed:
        return output ? bytesOf(output->flowReport.builtinsUsed) : noBytes;
    case Wire::ResultSection::FeaturesUsed:
        return bytesOf(result->featuresUsed);
    case Wire::ResultSection::LocalesUsed:
        return bytesOf(result->localesUsed);
    case Wire::ResultSection::WorkerEntries:
        return bytesOf(result->workerEntries);
    case Wire::ResultSection::Accesses:
        return output ? bytesOf(output->flowReport.accesses) : noBytes;
    case Wire::ResultSection::AccessCounts:
        return output ? bytesOf(output->flowReport.accessCounts) : noBytes;
    case Wire::ResultSection::TypeTests:
        return output ? bytesOf(output->flowReport.typeTests) : noBytes;
    case Wire::ResultSection::RemainingChecks:
        return output ? bytesOf(output->flowReport.remainingChecks) : noBytes;
    case Wire::ResultSection::Declines:
        return output ? bytesOf(output->declines) : noBytes;
    case Wire::ResultSection::AllocationRemarks:
        return bytesOf(result->allocationRemarks);
    case Wire::ResultSection::Losses:
        return output ? bytesOf(output->losses) : noBytes;
    case Wire::ResultSection::Functions:
        return bytesOf(result->functions);
    case Wire::ResultSection::OperationCounts:
        return bytesOf(result->operationCounts);
    case Wire::ResultSection::PassTimes:
        return bytesOf(result->passTimes);
    case Wire::ResultSection::Statistics:
        return bytesOf(result->statistics);
    case Wire::ResultSection::LimitValues:
        return bytesOf(result->limitValues);
    case Wire::ResultSection::Symbols:
        return output ? bytesOf(output->symbols) : noBytes;
    case Wire::ResultSection::ObfuscatedSites:
        return bytesOf(result->obfuscatedSites);
    case Wire::ResultSection::ArrivalSites:
    case Wire::ResultSection::ArrivalSiteLayouts:
    case Wire::ResultSection::ArrivalLayouts:
    case Wire::ResultSection::ArrivalLayoutFields:
        return noBytes;
    }
    return noBytes;
}

extern "C" void Bun__AOT__freeResult(BunAOTResult* result)
{
    delete result;
}

static String stringFromUTF8(BunAOTBytes bytes)
{
    return String::fromUTF8ReplacingInvalidSequences(std::span { bytes.ptr, bytes.len });
}

static void encodeDiagnostics(BunAOTResult& result)
{
    const JSC::AOT::Diagnostics& diagnostics = result.output->diagnostics;

    const JSC::AOT::Vector<JSC::AOT::UserDiagnostic>& userDiagnostics = diagnostics.userDiagnostics();
    result.userDiagnostics = JSC::AOT::Vector<Wire::UserDiagnosticRecord>(userDiagnostics.size(), [&](size_t index) {
        const JSC::AOT::UserDiagnostic& diagnostic = userDiagnostics[index];
        return Wire::UserDiagnosticRecord {
            .kind = diagnostic.kind,
            .function = diagnostic.function.index(),
            .block = diagnostic.block.index(),
            .value = diagnostic.value.index(),
            .layout = diagnostic.layout.index(),
            .limit = diagnostic.limit,
            .count = diagnostic.count,
            .location = diagnostic.location,
            .message = appendText(result.text, diagnostics.messageOfUserDiagnostic(index)),
            .origin = diagnostic.origin,
            .siteKind = static_cast<uint32_t>(diagnostic.siteKind),
            .minimum = diagnostic.minimum,
            .maximum = diagnostic.maximum,
        };
    });

    const JSC::AOT::Vector<JSC::AOT::InternalError>& internalErrors = diagnostics.internalErrors();
    result.internalErrors = JSC::AOT::Vector<Wire::InternalErrorRecord>(internalErrors.size(), [&](size_t index) {
        const JSC::AOT::InternalError& error = internalErrors[index];
        return Wire::InternalErrorRecord {
            .kind = error.kind,
            .function = error.function.index(),
            .block = error.block.index(),
            .value = error.value.index(),
            .layout = error.layout.index(),
            .limit = error.limit,
            .pass = error.pass,
            .count = error.count,
            .location = error.location,
            .message = appendText(result.text, diagnostics.messageOfInternalError(index)),
        };
    });
}

static void encodeFeatureUse(BunAOTResult& result)
{
    const JSC::AOT::CompileOutput& output = *result.output;
    result.featuresUsed = output.flowReport.featuresUsed;
    if (output.image.isEmpty())
        return;

    using FeatureSet = WTF::BitSet<JSC::removableFeatureIndexLimit>;

    FeatureSet imageFeatures;
    auto add = [&](JSC::RemovableFeature feature) {
        imageFeatures.set(static_cast<size_t>(feature));
    };

    output.entriesUsed.forEachSetBit([&](size_t index) {
        if (auto feature = JSC::AOT::featureOf(static_cast<JSC::AOT::Entry>(index)))
            add(*feature);
    });

    const JSC::AOT::ImageContents& contents = output.contents;
    if (contents.numberOfRegExpsWithCode || contents.numberOfRegExpsWithoutCode)
        add(JSC::RemovableFeature::RegExp);
    if (contents.numberOfRegExpsWithUnicodePropertyLookup)
        add(JSC::RemovableFeature::RegExpUnicodeProperties);
    if (contents.numberOfWebAssemblyModules)
        add(JSC::RemovableFeature::WebAssembly);

    FeatureSet flowFeatures;
    for (const Wire::FeatureUseRecord& record : result.featuresUsed) {
        if (record.feature < FeatureSet::size())
            flowFeatures.set(record.feature);
    }
    imageFeatures.exclude(flowFeatures);

    imageFeatures.forEachSetBit([&](size_t feature) {
        result.featuresUsed.append(Wire::FeatureUseRecord {
            .feature = static_cast<uint32_t>(feature),
            .builtin = Wire::none,
            .witness = {},
        });
    });
    std::ranges::stable_sort(result.featuresUsed, {}, &Wire::FeatureUseRecord::feature);
}

static void encodeLocaleUse(BunAOTResult& result)
{
    Typed::FlowReport& report = result.output->flowReport;
    result.localesUsed = rebaseTextRanges(result.text, report.localeTags.span(), WTF::move(report.localesUsed), &Wire::LocaleUseRecord::tag);
    result.workerEntries = rebaseTextRanges(result.text, report.workerEntryPaths.span(), WTF::move(report.workerEntries), &Wire::WorkerEntryRecord::path);
}

static Typed::AllocationSiteReport findAllocationSite(const Typed::FlowReport& report, Typed::AllocationSiteID site)
{
    if (site.index() >= report.allocationSites.size())
        return {};
    return report.allocationSites[site.index()];
}

static void encodeAllocationRemarks(BunAOTResult& result, OperationNames& operationNames)
{
    const Typed::FlowReport& report = result.output->flowReport;

    result.allocationRemarks = result.output->allocationRemarks.map([&](const JSC::AOT::AllocationRemark& remark) {
        Wire::TextRange forcingOperation { 0, 0 };
        if (remark.forcingOpcode)
            forcingOperation = operationNames.ensure(*remark.forcingOpcode);
        Typed::AllocationSiteReport site = findAllocationSite(report, remark.site);
        return Wire::AllocationRemarkRecord {
            .location = remark.location,
            .forcedBy = remark.forcedBy,
            .outcome = remark.outcome,
            .copies = remark.copies,
            .forcingOperation = forcingOperation,
            .reasons = remark.reasons,
            .limit = remark.limit,
            .function = site.function.index(),
            .kind = site.kind,
            .cause = remark.cause,
        };
    });
}

static void encodeObfuscatedSites(BunAOTResult& result)
{
    JSC::AOT::ObfuscatedSites& sites = result.output->obfuscatedSites;
    result.obfuscatedSites = rebaseTextRanges(result.text, sites.names.span(), WTF::move(sites.records), &Wire::ObfuscatedSiteRecord::name);
}

static void encodeFunctionReports(BunAOTResult& result, OperationNames& operationNames)
{
    EnumeratorNames<Typed::FunctionRole> roleNames(result.text);

    result.functions = result.output->functionReports.map([&](const JSC::AOT::FunctionReport& report) {
        size_t firstOperation = result.operationCounts.size();
        for (auto [opcode, count] : report.operations)
            result.operationCounts.append(Wire::OperationCountRecord { .name = operationNames.ensure(opcode), .count = count });
        return Wire::FunctionReportRecord {
            .source = report.source.index(),
            .role = roleNames.ensure(report.role),
            .codeBytes = report.codeBytes,
            .accesses = report.accesses,
            .calls = report.calls,
            .firstOperation = static_cast<uint32_t>(firstOperation),
            .operationCount = static_cast<uint32_t>(report.operations.size()),
            .accessCosts = report.accessCosts,
        };
    });
}

static void encodePassTimes(BunAOTResult& result)
{
    const JSC::AOT::Vector<JSC::AOT::Statistics::PassTime>& passTimes = result.output->statistics.passTimes();
    if (passTimes.isEmpty())
        return;

    for (Wire::PassID pass : JSC::AOT::allMembersOf<Wire::PassID>) {
        const JSC::AOT::Statistics::PassTime& passTime = passTimes[static_cast<size_t>(pass)];
        if (!passTime.runs)
            continue;
        result.passTimes.append(Wire::PassTimeRecord {
            .pass = pass,
            .reserved = 0,
            .runs = passTime.runs,
            .wallNanoseconds = passTime.wall.nanosecondsAs<uint64_t>(),
            .cpuNanoseconds = passTime.cpu.nanosecondsAs<uint64_t>(),
        });
    }
}

extern "C" void Bun__AOT__initializeOptions(Wire::CompileOptions* options)
{
    WTF::initialize();

    *options = JSC::AOT::makeDefaultCompileOptions();
}

extern "C" size_t Bun__AOT__applyOptionWord(Wire::CompileOptions* options, BunAOTBytes word, uint8_t* message, size_t capacity)
{
    WTF::initialize();

    Wire::CompileOptions changedOptions = *options;
    auto error = JSC::AOT::applyOptionWord(changedOptions, stringFromUTF8(word));
    if (!error) {
        *options = changedOptions;
        return 0;
    }

    UTF8CString utf8 = error->utf8();
    RELEASE_ASSERT(utf8.length());
    if (size_t copiedLength = std::min(capacity, utf8.length()))
        memcpy(message, utf8.data(), copiedLength);
    return utf8.length();
}

static void ensureHostBindings()
{
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [] {
        if (!JSC::AOT::BuiltinBindings::hasHost())
            Bun__AOT__registerHostBindings();
    });
}

extern "C" BunAOTResult* Bun__AOT__compile(BunAOTBytes program, const JSC::AOT::ExternalFunctionBodies* externalBodies, void (*releaseProgram)(void* owner), void* programOwner, const Wire::CompileOptions* options, const JSC::AOT::HostThreadPool* threadPool)
{
    ensureHostBindings();

#if OS(WINDOWS)
    _setmode(2, _O_BINARY);
    _set_fmode(_O_BINARY);
#endif

    auto* result = new BunAOTResult;
    result->output = JSC::callRemovable<JSC::RemovableFeature::ImageCompiler, JSC::RemovedFeatureStub::Abort, JSC::AOT::compileProgram>(std::span { program.ptr, program.len }, *options, threadPool, JSC::AOT::ProgramOwner { releaseProgram, programOwner, externalBodies });

    OperationNames operationNames(result->text);
    encodeDiagnostics(*result);
    encodeFeatureUse(*result);
    encodeLocaleUse(*result);
    encodeAllocationRemarks(*result, operationNames);
    encodeObfuscatedSites(*result);
    encodeFunctionReports(*result, operationNames);
    encodePassTimes(*result);
    result->statistics = result->output->statistics.values();
    result->limitValues = result->output->limitValues;
    return result;
}

extern "C" size_t Bun__AOT__describeDifferenceOfRuntime(const uint8_t* description, size_t size, uint8_t* message, size_t capacity)
{
    std::optional<JSC::AOT::RuntimeDifference> difference = JSC::AOT::findDifferenceFromThisRuntime({ description, size });
    if (!difference)
        return 0;

    WTF::initialize();
    String sentence = difference->name.isNull()
        ? "its description of the run time can't be read"_str
        : makeString(difference->name, " is "_s, difference->there, " there and "_s, difference->here, " here"_s);
    UTF8CString utf8 = sentence.utf8();
    if (size_t copiedLength = std::min(capacity, utf8.length()))
        memcpy(message, utf8.data(), copiedLength);
    return utf8.length();
}

extern "C" size_t Bun__AOT__imageAlignment()
{
    return JSC::AOT::imageAlignment();
}

extern "C" void Bun__AOT__relocateImage(uint8_t* image, size_t size, uint64_t address)
{
    JSC::AOT::relocateImage({ image, size }, address);
}

extern "C" size_t Bun__AOT__operationCount()
{
    return Typed::numberOfOpcodes;
}

extern "C" BunAOTBytes Bun__AOT__operationName(size_t index)
{
    if (index >= Typed::numberOfOpcodes)
        return noBytes;
    std::span<const uint8_t> name = byteCast<uint8_t>(nameOf(static_cast<Typed::Opcode>(index)).span8());
    return { name.data(), name.size() };
}

extern "C" bool Bun__AOT__isOptionalPass(Wire::PassID pass)
{
    return static_cast<uint32_t>(pass) < JSC::AOT::numberOfPasses && JSC::AOT::isOptionalPass(pass);
}

extern "C" size_t Bun__AOT__describeWhereThisThreadStopped(uint8_t* buffer, size_t capacity)
{
    return JSC::AOT::describeWhereThisThreadStopped({ reinterpret_cast<char*>(buffer), capacity });
}

extern "C" size_t Bun__AOT__describeWhatThreadsAreCompiling(uint8_t* buffer, size_t capacity)
{
    return JSC::AOT::describeWhatThreadsAreCompiling({ reinterpret_cast<char*>(buffer), capacity });
}

#else // ENABLE(AOT)

#include <cstddef>
#include <cstdint>

// What src/aot/engine/shared.rs asks. Nothing else of this file has a caller in a Bun without the compiler.
extern "C" size_t Bun__AOT__imageAlignment() { return 1; }
extern "C" void Bun__AOT__relocateImage(uint8_t*, size_t, uint64_t) {}
extern "C" size_t Bun__AOT__describeDifferenceOfRuntime(const uint8_t*, size_t, uint8_t*, size_t) { return 0; }
// What src/runtime/cli/compile_command/build.rs names.
extern "C" size_t Bun__AOT__describeWhereThisThreadStopped(uint8_t*, size_t) { return 0; }
extern "C" size_t Bun__AOT__describeWhatThreadsAreCompiling(uint8_t*, size_t) { return 0; }

#endif // ENABLE(AOT)

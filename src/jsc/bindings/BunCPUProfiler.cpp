#include "root.h"
#include "BunCPUProfiler.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include "BunString.h"
#include <JavaScriptCore/SamplingProfiler.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ScriptExecutable.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/SourceProvider.h>
#include <wtf/Stopwatch.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/JSONValues.h>
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/URL.h>
#include <algorithm>
#include <limits>
#include <memory>

extern "C" void Bun__startCPUProfiler(JSC::VM* vm, bool collectMarkdown);
extern "C" void Bun__drainCPUProfilerIfNeeded(JSC::VM* vm);
extern "C" void Bun__stopCPUProfilerIfRunning(JSC::VM* vm);
extern "C" void Bun__stopCPUProfiler(JSC::VM* vm, BunString* outJSON, BunString* outText);
extern "C" void Bun__setSamplingInterval(int intervalMicroseconds);

void Bun__setSamplingInterval(int intervalMicroseconds)
{
    Bun::setSamplingInterval(intervalMicroseconds);
}

namespace Bun {

// Store the profiling start time in microseconds since Unix epoch
static thread_local double s_profilingStartTime = 0.0;
// Set sampling interval to 1ms (1000 microseconds) to match Node.js
static thread_local int s_samplingInterval = 1000;
static thread_local bool s_isProfilerRunning = false;

void setSamplingInterval(int intervalMicroseconds)
{
    s_samplingInterval = intervalMicroseconds;
}

bool isCPUProfilerRunning()
{
    return s_isProfilerRunning;
}

struct ProfileNode {
    int id;
    WTF::String functionName;
    WTF::String url;
    int scriptId;
    // lineNumber/columnNumber are the location where the function is DEFINED
    // (matching Node/Deno/Chrome DevTools), stored as 0-indexed values ready
    // for JSON emission. -1 means "unknown".
    int lineNumber;
    int columnNumber;
    int hitCount;
    WTF::Vector<int> children;
    // Per-line sample counts for this node, keyed by 1-indexed source line.
    // Emitted as `positionTicks` in the JSON output when non-empty, matching
    // the Chrome DevTools CPU profile format used by Node and Deno.
    // Lines are guaranteed non-zero, so the default IntHashTraits (which reserve
    // 0 and -1 as empty/deleted sentinels) are safe here.
    WTF::HashMap<int, int, WTF::IntHash<int>> positionTicks;
};

// ============================================================================
// TEXT FORMAT OUTPUT (grep-friendly, designed for LLM analysis)
// ============================================================================

// Structure to hold aggregated function statistics for text output
struct FunctionStats {
    WTF::String functionName;
    WTF::String location; // file:line format
    long long selfTimeUs = 0; // microseconds where this function was at top of stack
    long long totalTimeUs = 0; // microseconds including children
    int selfSamples = 0; // samples where this function was at top
    int totalSamples = 0; // samples where this function appeared anywhere
    WTF::HashMap<WTF::String, int> callers; // caller location -> count
    WTF::HashMap<WTF::String, int> callees; // callee location -> count
};

// Helper to format a function name properly
// - Empty names become "(anonymous)"
// - Async functions get "async " prefix
static WTF::String formatFunctionName(const WTF::String& name, const JSC::SamplingProfiler::StackFrame& frame)
{
    WTF::String displayName = name.isEmpty() ? "(anonymous)"_s : name;

    // Check if this is an async function and add prefix if needed
    if (frame.frameType == JSC::SamplingProfiler::FrameType::Executable && frame.executable) {
        if (auto* functionExecutable = dynamicDowncast<JSC::FunctionExecutable>(frame.executable)) {
            if (JSC::isAsyncFunctionParseMode(functionExecutable->parseMode())) {
                if (!displayName.startsWith("async "_s)) {
                    return makeString("async "_s, displayName);
                }
            }
        }
    }

    return displayName;
}

// Helper to format time in human-readable form
static WTF::String formatTime(double microseconds)
{
    WTF::StringBuilder sb;
    if (microseconds >= 1000000.0) {
        // Format as seconds with 2 decimal places
        double seconds = microseconds / 1000000.0;
        sb.append(static_cast<int>(seconds));
        sb.append('.');
        int frac = static_cast<int>((seconds - static_cast<int>(seconds)) * 100);
        if (frac < 10) sb.append('0');
        sb.append(frac);
        sb.append('s');
        return sb.toString();
    }
    if (microseconds >= 1000.0) {
        // Format as milliseconds with 1 decimal place
        double ms = microseconds / 1000.0;
        sb.append(static_cast<int>(ms));
        sb.append('.');
        int frac = static_cast<int>((ms - static_cast<int>(ms)) * 10);
        sb.append(frac);
        sb.append("ms"_s);
        return sb.toString();
    }
    sb.append(static_cast<int>(microseconds));
    sb.append("us"_s);
    return sb.toString();
}

// Helper to format percentage
static WTF::String formatPercent(double value, double total)
{
    if (total <= 0)
        return "0.0%"_s;
    double pct = (value / total) * 100.0;
    // Cap at 100% for display purposes (can exceed 100% due to rounding or overlapping time accounting)
    if (pct > 100.0)
        pct = 100.0;
    WTF::StringBuilder sb;
    // Format as XX.X% with 1 decimal place
    sb.append(static_cast<int>(pct));
    sb.append('.');
    int frac = static_cast<int>((pct - static_cast<int>(pct)) * 10);
    sb.append(frac);
    sb.append('%');
    return sb.toString();
}

// Key separator for building composite keys (function name + location)
// Using ASCII control character SOH (0x01) which won't appear in function names or URLs
static constexpr auto kKeySeparator = "\x01"_s;

// Helper to escape pipe characters for markdown table cells (non-code cells)
static WTF::String escapeMarkdownTableCell(const WTF::String& str)
{
    bool needsEscape = false;
    for (unsigned i = 0; i < str.length(); i++) {
        if (str[i] == '|') {
            needsEscape = true;
            break;
        }
    }
    if (!needsEscape)
        return str;

    WTF::StringBuilder sb;
    for (unsigned i = 0; i < str.length(); i++) {
        UChar c = str[i];
        if (c == '|')
            sb.append("\\|"_s);
        else
            sb.append(c);
    }
    return sb.toString();
}

// Helper to format a string as an inline code span that handles backticks properly
// Uses the CommonMark spec: use N+1 backticks as delimiter where N is the longest run of backticks in the string
static WTF::String formatCodeSpan(const WTF::String& str)
{
    // Also escape pipes since this will be used in table cells
    WTF::String escaped = escapeMarkdownTableCell(str);

    // Find the longest run of backticks in the string
    int maxBackticks = 0;
    int currentRun = 0;
    for (unsigned i = 0; i < escaped.length(); i++) {
        if (escaped[i] == '`') {
            currentRun++;
            if (currentRun > maxBackticks)
                maxBackticks = currentRun;
        } else {
            currentRun = 0;
        }
    }

    // If no backticks, use simple single backtick delimiters
    if (maxBackticks == 0) {
        WTF::StringBuilder sb;
        sb.append('`');
        sb.append(escaped);
        sb.append('`');
        return sb.toString();
    }

    // Use N+1 backticks as delimiter
    int delimiterLength = maxBackticks + 1;
    WTF::StringBuilder sb;
    for (int i = 0; i < delimiterLength; i++)
        sb.append('`');

    // Add space padding if content starts or ends with backtick (CommonMark requirement)
    bool startsWithBacktick = !escaped.isEmpty() && escaped[0] == '`';
    bool endsWithBacktick = !escaped.isEmpty() && escaped[escaped.length() - 1] == '`';

    if (startsWithBacktick || endsWithBacktick)
        sb.append(' ');
    sb.append(escaped);
    if (startsWithBacktick || endsWithBacktick)
        sb.append(' ');

    for (int i = 0; i < delimiterLength; i++)
        sb.append('`');

    return sb.toString();
}

// Helper to generate a minimal valid cpuprofile JSON with no samples
static WTF::String generateEmptyProfileJSON()
{
    // Return a minimal valid Chrome DevTools CPU profile format
    // Use s_profilingStartTime if available, otherwise fall back to current time
    long long timestamp;
    if (s_profilingStartTime > 0)
        timestamp = static_cast<long long>(s_profilingStartTime);
    else
        timestamp = static_cast<long long>(WTF::WallTime::now().secondsSinceEpoch().value() * 1000000.0);

    WTF::StringBuilder sb;
    sb.append("{\"nodes\":[{\"id\":1,\"callFrame\":{\"functionName\":\"(root)\",\"scriptId\":\"0\",\"url\":\"\",\"lineNumber\":-1,\"columnNumber\":-1},\"hitCount\":0,\"children\":[]}],\"startTime\":"_s);
    sb.append(timestamp);
    sb.append(",\"endTime\":"_s);
    sb.append(timestamp);
    sb.append(",\"samples\":[],\"timeDeltas\":[]}"_s);
    return sb.toString();
}

// Profile output folded in one batch of samples at a time. Holds no JS objects.
struct ProfileData {
    // Chrome DevTools format: call tree keyed by parent id + function identity.
    WTF::HashMap<WTF::String, int> nodeMap;
    WTF::Vector<ProfileNode> nodes;
    int nextNodeId { 2 };
    WTF::Vector<int> samples;
    WTF::Vector<long long> timeDeltas;

    // Markdown format: per-function aggregates. Only built when requested.
    bool collectMarkdown { false };
    WTF::HashMap<WTF::String, FunctionStats> functionStatsMap;
    long long totalTimeUs { 0 };
    int totalSamples { 0 };

    // Wall clock microseconds of the last sample folded in.
    double lastTime { 0.0 };

    // URL parsing dominates the per-frame cost, so both conversions are memoized.
    WTF::HashMap<WTF::String, WTF::String> normalizedURLs;
    WTF::HashMap<WTF::String, WTF::String> fileSystemPaths;
};

static thread_local ProfileData* s_profileData = nullptr;
static thread_local WTF::MonotonicTime s_lastDrainTime;
static constexpr WTF::Seconds kDrainInterval = WTF::Seconds::fromMilliseconds(100);

void startCPUProfiler(JSC::VM& vm, bool collectMarkdown)
{
    // The profile's startTime.
    s_profilingStartTime = MonotonicTime::now().approximate<WTF::WallTime>().secondsSinceEpoch().value() * 1000000.0;

    delete s_profileData;
    s_profileData = new ProfileData();
    s_profileData->collectMarkdown = collectMarkdown;
    s_profileData->lastTime = s_profilingStartTime;

    ProfileNode rootNode;
    rootNode.id = 1;
    rootNode.functionName = "(root)"_s;
    rootNode.url = ""_s;
    rootNode.scriptId = 0;
    rootNode.lineNumber = -1;
    rootNode.columnNumber = -1;
    rootNode.hitCount = 0;
    s_profileData->nodes.append(WTF::move(rootNode));

    // Create a stopwatch and start it
    auto stopwatch = WTF::Stopwatch::create();
    stopwatch->start();

    JSC::SamplingProfiler& samplingProfiler = vm.ensureSamplingProfiler(WTF::move(stopwatch));
    samplingProfiler.setTimingInterval(WTF::Seconds::fromMicroseconds(s_samplingInterval));
    samplingProfiler.noticeCurrentThreadAsJSCExecutionThread();
    samplingProfiler.start();
    s_lastDrainTime = MonotonicTime::now();
    s_isProfilerRunning = true;
}

// Helper to format a location string from URL and line number
static WTF::String formatLocation(ProfileData& data, const WTF::String& url, int lineNumber)
{
    if (url.isEmpty())
        return "[native code]"_s;

    // Extract path from file:// URL using WTF::URL
    auto cached = data.fileSystemPaths.ensure(url, [&] {
        WTF::URL parsedUrl { url };
        if (parsedUrl.isValid() && parsedUrl.protocolIsFile())
            return parsedUrl.fileSystemPath();
        return url;
    });
    const WTF::String& path = cached.iterator->value;

    if (lineNumber >= 0) {
        WTF::StringBuilder sb;
        sb.append(path);
        sb.append(':');
        sb.append(lineNumber);
        return sb.toString();
    }
    return path;
}

// Absolute file path to `file://` URL, as Chrome DevTools expects (#29240).
static void normalizeURL(ProfileData& data, WTF::String& u)
{
    if (u.isEmpty())
        return;
    auto cached = data.normalizedURLs.find(u);
    if (cached != data.normalizedURLs.end()) {
        u = cached->value;
        return;
    }
    WTF::String input = u;
    bool isAbsolutePath = false;
    if (u[0] == '/') {
        isAbsolutePath = true;
    } else if (u.length() >= 2 && u[1] == ':') {
        char firstChar = u[0];
        if ((firstChar >= 'A' && firstChar <= 'Z') || (firstChar >= 'a' && firstChar <= 'z'))
            isAbsolutePath = true;
    } else if (u.length() >= 2 && u[0] == '\\' && u[1] == '\\') {
        isAbsolutePath = true;
    }
    if (isAbsolutePath)
        u = WTF::URL::fileURLWithFileSystemPath(u).string();
    data.normalizedURLs.add(input, u);
}

// The caller holds the JSLock and defers GC: the frames carry raw heap pointers.
static void appendStackTraces(JSC::VM& vm, ProfileData& data, WTF::Vector<JSC::SamplingProfiler::StackTrace>&& stackTraces)
{
    // Sort traces by timestamp once for both formats
    WTF::Vector<size_t> sortedIndices;
    sortedIndices.reserveInitialCapacity(stackTraces.size());
    for (size_t i = 0; i < stackTraces.size(); i++) {
        sortedIndices.append(i);
    }
    std::sort(sortedIndices.begin(), sortedIndices.end(), [&stackTraces](size_t a, size_t b) {
        return stackTraces[a].timestamp < stackTraces[b].timestamp;
    });

    data.totalSamples += static_cast<int>(stackTraces.size());

    for (size_t idx : sortedIndices) {
        auto& stackTrace = stackTraces[idx];

        double currentTime = stackTrace.timestamp.approximate<WTF::WallTime>().secondsSinceEpoch().value() * 1000000.0;
        long long deltaUs = static_cast<long long>(std::max(0.0, currentTime - data.lastTime));
        data.lastTime = currentTime;
        data.totalTimeUs += deltaUs;
        data.timeDeltas.append(deltaUs);

        if (stackTrace.frames.isEmpty()) {
            data.samples.append(1);
            continue;
        }

        // displayName() reads properties on the callee, so resolve it once per frame.
        WTF::Vector<WTF::String> frameNames;
        frameNames.reserveInitialCapacity(stackTrace.frames.size());
        for (auto& frame : stackTrace.frames)
            frameNames.append(frame.displayName(vm));

        // JSON format: call tree from the outermost frame.
        {
            int currentParentId = 1;

            for (int i = stackTrace.frames.size() - 1; i >= 0; i--) {
                auto& frame = stackTrace.frames[i];

                WTF::String functionName = frameNames[i];
                WTF::String url;
                int scriptId = 0;
                // Function-definition line/column (0-indexed) for callFrame.
                int functionDefLine = -1;
                int functionDefColumn = -1;
                // Current-sample line (1-indexed) for positionTicks.
                int sampleLine = 0;

                if (frame.frameType == JSC::SamplingProfiler::FrameType::Executable && frame.executable) {
                    auto sourceProviderAndID = frame.sourceProviderAndID();
                    auto* provider = std::get<0>(sourceProviderAndID);
                    if (provider) {
                        url = provider->sourceURL();
                        scriptId = static_cast<int>(provider->asID());
                    }

                    // The sourcemap callback resets `url` to the raw provider URL, so normalizeURL runs after it (#29240).

                    // Function definition location. JSC returns these 1-based;
                    // Node/Deno/Chrome DevTools emit them 0-based in the JSON.
                    // The definition (not the sample position) is remapped
                    // through the sourcemap callback so callFrame.url and
                    // callFrame.line/column agree on the function's source.
                    int rawFunctionStartLine = frame.functionStartLine();
                    unsigned rawFunctionStartColumn = frame.functionStartColumn();
                    if (rawFunctionStartLine > 0 && rawFunctionStartColumn != std::numeric_limits<unsigned>::max()) {
                        JSC::LineColumn functionStartLineColumn {
                            static_cast<unsigned>(rawFunctionStartLine),
                            rawFunctionStartColumn,
                        };
                        if (provider) {
#if USE(BUN_JSC_ADDITIONS)
                            auto& fn = vm.computeLineColumnWithSourcemap();
                            if (fn) {
                                // `url` is the out-param — on a successful
                                // remap it becomes the original-source URL.
                                fn(vm, provider, functionStartLineColumn, url);
                            }
#endif
                        }
                        functionDefLine = functionStartLineColumn.line > 0
                            ? static_cast<int>(functionStartLineColumn.line) - 1
                            : 0;
                        functionDefColumn = functionStartLineColumn.column > 0
                            ? static_cast<int>(functionStartLineColumn.column) - 1
                            : 0;
                    }

                    // Normalize `url` to a `file://` URL now that any
                    // sourcemap rewriting is done.
                    normalizeURL(data, url);

                    if (frame.hasExpressionInfo()) {
                        // Sample position for positionTicks. Use a throwaway
                        // out-param so the sample remap can't clobber `url`
                        // with a different file than the function definition.
                        // We also drop the sample line entirely if the sample
                        // maps back to a DIFFERENT original source file than
                        // the definition (cross-module inlining in bundled
                        // code) — attaching a line number from one file to a
                        // ProfileNode whose callFrame.url is a different file
                        // would mislocate the tick in Chrome DevTools.
                        JSC::LineColumn sourceMappedLineColumn = frame.semanticLocation.lineColumn;
                        // Seed with the raw provider URL (NOT empty). If the
                        // sourcemap callback is a no-op — BUN_JSC_ADDITIONS
                        // off, fn null, or the provider has no sourcemap —
                        // sampleURL stays at this seed, and normalizeURL()
                        // below converts it to the same `file://` form as
                        // `url`, letting the `sampleURL == url` guard pass
                        // for plain .js files. Seeding empty would silently
                        // suppress positionTicks for every non-sourcemapped
                        // script.
                        WTF::String sampleURL = provider ? WTF::String(provider->sourceURL()) : WTF::String();
                        if (provider) {
#if USE(BUN_JSC_ADDITIONS)
                            auto& fn = vm.computeLineColumnWithSourcemap();
                            if (fn) {
                                fn(vm, provider, sourceMappedLineColumn, sampleURL);
                            }
#endif
                        }
                        normalizeURL(data, sampleURL);
                        if (sourceMappedLineColumn.line > 0 && sampleURL == url)
                            sampleLine = static_cast<int>(sourceMappedLineColumn.line);
                    }
                }

                // line/column here identify the function's DEFINITION, so all
                // samples of the same function under the same parent collapse.
                WTF::StringBuilder keyBuilder;
                keyBuilder.append(currentParentId);
                keyBuilder.append(':');
                keyBuilder.append(functionName);
                keyBuilder.append(':');
                keyBuilder.append(url);
                keyBuilder.append(':');
                keyBuilder.append(scriptId);
                keyBuilder.append(':');
                keyBuilder.append(functionDefLine);
                keyBuilder.append(':');
                keyBuilder.append(functionDefColumn);

                WTF::String key = keyBuilder.toString();

                int nodeId;
                auto it = data.nodeMap.find(key);
                if (it == data.nodeMap.end()) {
                    nodeId = data.nextNodeId++;
                    data.nodeMap.add(key, nodeId);

                    ProfileNode node;
                    node.id = nodeId;
                    node.functionName = functionName;
                    node.url = url;
                    node.scriptId = scriptId;
                    node.lineNumber = functionDefLine;
                    node.columnNumber = functionDefColumn;
                    node.hitCount = 0;

                    data.nodes.append(WTF::move(node));

                    if (currentParentId > 0)
                        data.nodes[currentParentId - 1].children.append(nodeId);
                } else {
                    nodeId = it->value;
                }

                currentParentId = nodeId;

                if (i == 0) {
                    data.nodes[nodeId - 1].hitCount++;
                    if (sampleLine > 0)
                        data.nodes[nodeId - 1].positionTicks.add(sampleLine, 0).iterator->value++;
                }
            }

            data.samples.append(currentParentId);
        }

        // Markdown format: per-function self/total time and caller/callee counts.
        if (data.collectMarkdown) {
            WTF::String previousKey;

            for (int i = stackTrace.frames.size() - 1; i >= 0; i--) {
                auto& frame = stackTrace.frames[i];

                WTF::String functionName = formatFunctionName(frameNames[i], frame);
                WTF::String url;
                int lineNumber = -1;

                if (frame.frameType == JSC::SamplingProfiler::FrameType::Executable && frame.executable) {
                    auto sourceProviderAndID = frame.sourceProviderAndID();
                    auto* provider = std::get<0>(sourceProviderAndID);
                    if (provider) {
                        url = provider->sourceURL();
                        normalizeURL(data, url);
                    }

                    if (frame.hasExpressionInfo()) {
                        JSC::LineColumn sourceMappedLineColumn = frame.semanticLocation.lineColumn;
                        if (provider) {
#if USE(BUN_JSC_ADDITIONS)
                            auto& fn = vm.computeLineColumnWithSourcemap();
                            if (fn)
                                fn(vm, provider, sourceMappedLineColumn, url);
#endif
                        }
                        lineNumber = static_cast<int>(sourceMappedLineColumn.line);
                    }
                }

                WTF::String location = formatLocation(data, url, lineNumber);
                // Key uses zero-width space separator internally (not shown in output)
                WTF::StringBuilder keyBuilder;
                keyBuilder.append(functionName);
                keyBuilder.append(kKeySeparator);
                keyBuilder.append(location);
                WTF::String key = keyBuilder.toString();

                auto result = data.functionStatsMap.add(key, FunctionStats());
                FunctionStats& stats = result.iterator->value;
                if (result.isNewEntry) {
                    stats.functionName = functionName;
                    stats.location = location;
                }

                stats.totalSamples++;
                stats.totalTimeUs += deltaUs;

                if (i == 0) {
                    stats.selfSamples++;
                    stats.selfTimeUs += deltaUs;
                }

                if (!previousKey.isEmpty()) {
                    stats.callers.add(previousKey, 0).iterator->value++;

                    auto prevIt = data.functionStatsMap.find(previousKey);
                    if (prevIt != data.functionStatsMap.end())
                        prevIt->value.callees.add(key, 0).iterator->value++;
                }

                previousKey = key;
            }
        }
    }
}

void drainCPUProfilerIfNeeded(JSC::VM& vm)
{
    if (!s_isProfilerRunning || !s_profileData)
        return;

    auto now = MonotonicTime::now();
    if (now - s_lastDrainTime < kDrainInterval)
        return;
    s_lastDrainTime = now;

    JSC::SamplingProfiler* profiler = vm.samplingProfiler();
    if (!profiler)
        return;

    JSC::JSLockHolder locker(vm);
    JSC::DeferGC deferGC(vm);

    WTF::Vector<JSC::SamplingProfiler::StackTrace> stackTraces;
    {
        // The sampling thread takes the same lock, so hold it only for the release.
        auto& lock = profiler->getLock();
        WTF::Locker profilerLocker { lock };
        // releaseStackTraces() clears the profiler's live cell set: the sampled callees stop being GC roots here.
        stackTraces = profiler->releaseStackTraces();
    }
    if (!stackTraces.isEmpty())
        appendStackTraces(vm, *s_profileData, WTF::move(stackTraces));
}

// Unified function that stops the profiler and generates requested output formats
void stopCPUProfiler(JSC::VM& vm, WTF::String* outJSON, WTF::String* outText)
{
    s_isProfilerRunning = false;

    std::unique_ptr<ProfileData> data(s_profileData);
    s_profileData = nullptr;

    JSC::SamplingProfiler* profiler = vm.samplingProfiler();
    if (!profiler) {
        if (outJSON) *outJSON = WTF::String();
        if (outText) *outText = WTF::String();
        return;
    }

    // JSLock is re-entrant, so always acquiring it handles both JS and shutdown contexts
    JSC::JSLockHolder locker(vm);

    // Defer GC while we're working with stack traces
    JSC::DeferGC deferGC(vm);

    // Pause the profiler while holding the lock
    auto& lock = profiler->getLock();
    WTF::Locker profilerLocker { lock };
    profiler->pause();

    // releaseStackTraces() calls processUnverifiedStackTraces() internally
    auto stackTraces = profiler->releaseStackTraces();
    profiler->clearData();

    // If neither output is requested, we're done
    if (!outJSON && !outText)
        return;

    if (data && !stackTraces.isEmpty())
        appendStackTraces(vm, *data, WTF::move(stackTraces));

    if (!data || data->totalSamples == 0) {
        if (outJSON) *outJSON = generateEmptyProfileJSON();
        if (outText) *outText = "No samples collected.\n"_s;
        return;
    }

    // Generate JSON format if requested
    if (outJSON) {
        double startTime = s_profilingStartTime;
        double endTime = data->lastTime;

        // Build JSON
        using namespace WTF;
        auto json = JSON::Object::create();

        auto nodesArray = JSON::Array::create();
        for (const auto& node : data->nodes) {
            auto nodeObj = JSON::Object::create();
            nodeObj->setInteger("id"_s, node.id);

            auto callFrame = JSON::Object::create();
            callFrame->setString("functionName"_s, node.functionName);
            callFrame->setString("scriptId"_s, WTF::String::number(node.scriptId));
            callFrame->setString("url"_s, node.url);
            callFrame->setInteger("lineNumber"_s, node.lineNumber);
            callFrame->setInteger("columnNumber"_s, node.columnNumber);

            nodeObj->setValue("callFrame"_s, callFrame);
            nodeObj->setInteger("hitCount"_s, node.hitCount);

            if (!node.children.isEmpty()) {
                auto childrenArray = JSON::Array::create();
                WTF::HashSet<int> seenChildren;
                for (int childId : node.children) {
                    if (seenChildren.add(childId).isNewEntry)
                        childrenArray->pushInteger(childId);
                }
                nodeObj->setValue("children"_s, childrenArray);
            }

            // Per-line sample counts (Chrome DevTools format). Emit sorted by
            // line for deterministic output.
            if (!node.positionTicks.isEmpty()) {
                WTF::Vector<std::pair<int, int>> sortedTicks;
                sortedTicks.reserveInitialCapacity(node.positionTicks.size());
                for (auto& entry : node.positionTicks)
                    sortedTicks.append({ entry.key, entry.value });
                std::sort(sortedTicks.begin(), sortedTicks.end(), [](const auto& a, const auto& b) {
                    return a.first < b.first;
                });
                auto positionTicksArray = JSON::Array::create();
                for (auto& [line, ticks] : sortedTicks) {
                    auto tickObj = JSON::Object::create();
                    tickObj->setInteger("line"_s, line);
                    tickObj->setInteger("ticks"_s, ticks);
                    positionTicksArray->pushValue(tickObj);
                }
                nodeObj->setValue("positionTicks"_s, positionTicksArray);
            }

            nodesArray->pushValue(nodeObj);
        }
        json->setValue("nodes"_s, nodesArray);

        json->setDouble("startTime"_s, startTime);
        json->setDouble("endTime"_s, endTime);

        auto samplesArray = JSON::Array::create();
        for (int sample : data->samples)
            samplesArray->pushInteger(sample);
        json->setValue("samples"_s, samplesArray);

        auto timeDeltasArray = JSON::Array::create();
        for (long long delta : data->timeDeltas)
            timeDeltasArray->pushInteger(delta);
        json->setValue("timeDeltas"_s, timeDeltasArray);

        *outJSON = json->toJSONString();
    }

    // Generate text format if requested
    if (outText) {
        double startTime = s_profilingStartTime;
        double endTime = data->lastTime;

        WTF::HashMap<WTF::String, FunctionStats>& functionStatsMap = data->functionStatsMap;
        long long totalTimeUs = data->totalTimeUs;
        int totalSamples = data->totalSamples;

        // Sort functions by self time
        WTF::Vector<std::pair<WTF::String, FunctionStats*>> sortedBySelf;
        for (auto& entry : functionStatsMap)
            sortedBySelf.append({ entry.key, &entry.value });
        std::sort(sortedBySelf.begin(), sortedBySelf.end(), [](const auto& a, const auto& b) {
            return a.second->selfTimeUs > b.second->selfTimeUs;
        });

        // Sort functions by total time
        WTF::Vector<std::pair<WTF::String, FunctionStats*>> sortedByTotal;
        for (auto& entry : functionStatsMap)
            sortedByTotal.append({ entry.key, &entry.value });
        std::sort(sortedByTotal.begin(), sortedByTotal.end(), [](const auto& a, const auto& b) {
            return a.second->totalTimeUs > b.second->totalTimeUs;
        });

        // Build the text output (Markdown format optimized for GitHub rendering + LLM analysis)
        WTF::StringBuilder output;
        int numFunctions = static_cast<int>(functionStatsMap.size());

        // Header with key metrics
        output.append("# CPU Profile\n\n"_s);
        output.append("| Duration | Samples | Interval | Functions |\n"_s);
        output.append("|----------|---------|----------|----------|\n"_s);
        output.append("| "_s);
        output.append(formatTime(endTime - startTime));
        output.append(" | "_s);
        output.append(totalSamples);
        output.append(" | "_s);
        output.append(formatTime(s_samplingInterval));
        output.append(" | "_s);
        output.append(numFunctions);
        output.append(" |\n\n"_s);

        // Top 10 summary for quick orientation
        output.append("**Top 10:** "_s);
        int topCount = 0;
        for (auto& [key, stats] : sortedBySelf) {
            if (stats->selfTimeUs == 0 || topCount >= 10)
                break;
            if (topCount > 0) output.append(", "_s);
            output.append(formatCodeSpan(stats->functionName));
            output.append(' ');
            output.append(formatPercent(stats->selfTimeUs, totalTimeUs));
            topCount++;
        }
        output.append("\n\n"_s);

        // Hot functions by self time (where time is actually spent)
        output.append("## Hot Functions (Self Time)\n\n"_s);
        output.append("| Self% | Self | Total% | Total | Function | Location |\n"_s);
        output.append("|------:|-----:|-------:|------:|----------|----------|\n"_s);

        for (auto& [key, stats] : sortedBySelf) {
            // Skip functions with 0 self time
            if (stats->selfTimeUs == 0)
                continue;
            output.append("| "_s);
            output.append(formatPercent(stats->selfTimeUs, totalTimeUs));
            output.append(" | "_s);
            output.append(formatTime(stats->selfTimeUs));
            output.append(" | "_s);
            output.append(formatPercent(stats->totalTimeUs, totalTimeUs));
            output.append(" | "_s);
            output.append(formatTime(stats->totalTimeUs));
            output.append(" | "_s);
            output.append(formatCodeSpan(stats->functionName));
            output.append(" | "_s);
            output.append(formatCodeSpan(stats->location));
            output.append(" |\n"_s);
        }
        output.append('\n');

        // Call tree (total time) - shows the call hierarchy
        output.append("## Call Tree (Total Time)\n\n"_s);
        output.append("| Total% | Total | Self% | Self | Function | Location |\n"_s);
        output.append("|-------:|------:|------:|-----:|----------|----------|\n"_s);

        for (auto& [key, stats] : sortedByTotal) {
            output.append("| "_s);
            output.append(formatPercent(stats->totalTimeUs, totalTimeUs));
            output.append(" | "_s);
            output.append(formatTime(stats->totalTimeUs));
            output.append(" | "_s);
            output.append(formatPercent(stats->selfTimeUs, totalTimeUs));
            output.append(" | "_s);
            output.append(formatTime(stats->selfTimeUs));
            output.append(" | "_s);
            output.append(formatCodeSpan(stats->functionName));
            output.append(" | "_s);
            output.append(formatCodeSpan(stats->location));
            output.append(" |\n"_s);
        }
        output.append('\n');

        // Function details with call relationships
        output.append("## Function Details\n\n"_s);

        for (auto& [key, stats] : sortedBySelf) {
            // Skip functions with no self time and no interesting relationships
            if (stats->selfTimeUs == 0 && stats->callers.isEmpty() && stats->callees.isEmpty())
                continue;

            // Header: ### `functionName`
            output.append("### "_s);
            output.append(formatCodeSpan(stats->functionName));
            output.append("\n"_s);

            // Location and stats on one line for density
            output.append(formatCodeSpan(stats->location));
            output.append(" | Self: "_s);
            output.append(formatPercent(stats->selfTimeUs, totalTimeUs));
            output.append(" ("_s);
            output.append(formatTime(stats->selfTimeUs));
            output.append(") | Total: "_s);
            output.append(formatPercent(stats->totalTimeUs, totalTimeUs));
            output.append(" ("_s);
            output.append(formatTime(stats->totalTimeUs));
            output.append(") | Samples: "_s);
            output.append(stats->selfSamples);
            output.append('\n');

            if (!stats->callers.isEmpty()) {
                output.append("\n**Called by:**\n"_s);
                WTF::Vector<std::pair<WTF::String, int>> sortedCallers;
                for (auto& c : stats->callers)
                    sortedCallers.append({ c.key, c.value });
                std::sort(sortedCallers.begin(), sortedCallers.end(), [](const auto& a, const auto& b) {
                    return a.second > b.second;
                });
                for (auto& [callerKey, count] : sortedCallers) {
                    output.append("- "_s);
                    // Extract just the function name from "funcName<separator>location"
                    size_t sepPos = callerKey.find(kKeySeparator);
                    WTF::String callerName = (sepPos != WTF::notFound) ? callerKey.left(sepPos) : callerKey;
                    output.append(formatCodeSpan(callerName));
                    output.append(" ("_s);
                    output.append(count);
                    output.append(")\n"_s);
                }
            }

            if (!stats->callees.isEmpty()) {
                output.append("\n**Calls:**\n"_s);
                WTF::Vector<std::pair<WTF::String, int>> sortedCallees;
                for (auto& c : stats->callees)
                    sortedCallees.append({ c.key, c.value });
                std::sort(sortedCallees.begin(), sortedCallees.end(), [](const auto& a, const auto& b) {
                    return a.second > b.second;
                });
                for (auto& [calleeKey, count] : sortedCallees) {
                    output.append("- "_s);
                    // Extract just the function name from "funcName<separator>location"
                    size_t sepPos = calleeKey.find(kKeySeparator);
                    WTF::String calleeName = (sepPos != WTF::notFound) ? calleeKey.left(sepPos) : calleeKey;
                    output.append(formatCodeSpan(calleeName));
                    output.append(" ("_s);
                    output.append(count);
                    output.append(")\n"_s);
                }
            }

            output.append('\n');
        }

        // Source files breakdown
        WTF::HashMap<WTF::String, long long> fileTimesUs;
        for (auto& [key, stats] : functionStatsMap) {
            WTF::String file = stats.location;
            size_t colonPos = file.reverseFind(':');
            if (colonPos != WTF::notFound && colonPos > 0) {
                bool isLineNumber = true;
                for (size_t i = colonPos + 1; i < file.length(); i++) {
                    if (file[i] < '0' || file[i] > '9') {
                        isLineNumber = false;
                        break;
                    }
                }
                if (isLineNumber)
                    file = file.left(colonPos);
            }
            fileTimesUs.add(file, 0).iterator->value += stats.selfTimeUs;
        }

        WTF::Vector<std::pair<WTF::String, long long>> sortedFiles;
        for (auto& f : fileTimesUs)
            sortedFiles.append({ f.key, f.value });
        std::sort(sortedFiles.begin(), sortedFiles.end(), [](const auto& a, const auto& b) {
            return a.second > b.second;
        });

        output.append("## Files\n\n"_s);
        output.append("| Self% | Self | File |\n"_s);
        output.append("|------:|-----:|------|\n"_s);

        for (auto& [file, timeUs] : sortedFiles) {
            if (timeUs == 0)
                continue;
            output.append("| "_s);
            output.append(formatPercent(timeUs, totalTimeUs));
            output.append(" | "_s);
            output.append(formatTime(timeUs));
            output.append(" | "_s);
            output.append(formatCodeSpan(file));
            output.append(" |\n"_s);
        }

        *outText = output.toString();
    }
}

} // namespace Bun

extern "C" void Bun__startCPUProfiler(JSC::VM* vm, bool collectMarkdown)
{
    Bun::startCPUProfiler(*vm, collectMarkdown);
}

extern "C" void Bun__stopCPUProfilerIfRunning(JSC::VM* vm)
{
    if (Bun::isCPUProfilerRunning())
        Bun::stopCPUProfiler(*vm, nullptr, nullptr);
}

extern "C" void Bun__drainCPUProfilerIfNeeded(JSC::VM* vm)
{
    Bun::drainCPUProfilerIfNeeded(*vm);
}

extern "C" void Bun__stopCPUProfiler(JSC::VM* vm, BunString* outJSON, BunString* outText)
{
    WTF::String jsonResult;
    WTF::String textResult;
    Bun::stopCPUProfiler(*vm, outJSON ? &jsonResult : nullptr, outText ? &textResult : nullptr);
    if (outJSON)
        *outJSON = Bun::toStringRef(jsonResult);
    if (outText)
        *outText = Bun::toStringRef(textResult);
}

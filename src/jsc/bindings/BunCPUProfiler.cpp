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

extern "C" void Bun__startCPUProfiler(JSC::VM* vm);
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
static thread_local int s_profilerRefCount = 0;

// GC-safe copy of a SamplingProfiler::StackFrame: releaseStackTraces() clears
// m_liveCellPointers, so the raw ExecutableBase* in a StackTrace is only valid
// under DeferGC; owned strings/ints here survive across consumers.
struct RetainedFrame {
    WTF::String functionName;
    WTF::String url;
    int scriptId { 0 };
    int functionDefLine { -1 };
    int functionDefColumn { -1 };
    int sampleLine { 0 };
    bool isAsync { false };
};

struct RetainedSample {
    double timestampUs { 0 };
    WTF::Vector<RetainedFrame> frames;
};

static thread_local std::unique_ptr<WTF::Vector<RetainedSample>> s_retainedSamples;

static WTF::Vector<RetainedSample>& retainedSamples()
{
    if (!s_retainedSamples)
        s_retainedSamples = std::make_unique<WTF::Vector<RetainedSample>>();
    return *s_retainedSamples;
}

void setSamplingInterval(int intervalMicroseconds)
{
    s_samplingInterval = intervalMicroseconds;
}

bool isCPUProfilerRunning()
{
    return s_profilerRefCount > 0;
}

double startCPUProfiler(JSC::VM& vm)
{
    double now = MonotonicTime::now().approximate<WTF::WallTime>().secondsSinceEpoch().value() * 1000000.0;

    if (s_profilerRefCount++ == 0) {
        s_profilingStartTime = now;

        auto stopwatch = WTF::Stopwatch::create();
        stopwatch->start();

        JSC::SamplingProfiler& samplingProfiler = vm.ensureSamplingProfiler(WTF::move(stopwatch));
        samplingProfiler.setTimingInterval(WTF::Seconds::fromMicroseconds(s_samplingInterval));
        samplingProfiler.noticeCurrentThreadAsJSCExecutionThread();
        samplingProfiler.start();
    }

    return now;
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
static WTF::String formatFunctionName(const WTF::String& name, bool isAsync)
{
    WTF::String displayName = name.isEmpty() ? "(anonymous)"_s : name;
    if (isAsync && !displayName.startsWith("async "_s))
        return makeString("async "_s, displayName);
    return displayName;
}

// Helper to format a location string from URL and line number
static WTF::String formatLocation(const WTF::String& url, int lineNumber)
{
    if (url.isEmpty())
        return "[native code]"_s;

    // Extract path from file:// URL using WTF::URL
    WTF::String path = url;
    WTF::URL parsedUrl { url };
    if (parsedUrl.isValid() && parsedUrl.protocolIsFile())
        path = parsedUrl.fileSystemPath();

    if (lineNumber >= 0) {
        WTF::StringBuilder sb;
        sb.append(path);
        sb.append(':');
        sb.append(lineNumber);
        return sb.toString();
    }
    return path;
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

// Absolute file path → `file://` URL. Chrome DevTools expects `callFrame.url`
// to be a proper URL; leaving the raw path breaks source-view resolution.
static void normalizeURL(WTF::String& u)
{
    if (u.isEmpty())
        return;
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
}

// Extract GC-safe frame info from a StackFrame. Must be called under DeferGC
// since frame.executable is a raw heap pointer.
static RetainedFrame extractFrame(JSC::VM& vm, JSC::SamplingProfiler::StackFrame& frame)
{
    RetainedFrame out;
    out.functionName = frame.displayName(vm);

    if (frame.frameType == JSC::SamplingProfiler::FrameType::Executable && frame.executable) {
        if (auto* functionExecutable = dynamicDowncast<JSC::FunctionExecutable>(frame.executable))
            out.isAsync = JSC::isAsyncFunctionParseMode(functionExecutable->parseMode());
        auto sourceProviderAndID = frame.sourceProviderAndID();
        auto* provider = std::get<0>(sourceProviderAndID);
        if (provider) {
            out.url = provider->sourceURL();
            out.scriptId = static_cast<int>(provider->asID());
        }

        // Function definition location. JSC returns these 1-based; Chrome
        // DevTools emits them 0-based. Remapped through the sourcemap callback
        // so callFrame.url and callFrame.line/column agree on the function's
        // source. The callback (see FormatStackTraceForJS.cpp) unconditionally
        // rewrites its out-param back to the raw provider URL when no sourcemap
        // is found, so normalizeURL runs AFTER it (see #29240).
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
                if (fn)
                    fn(vm, provider, functionStartLineColumn, out.url);
#endif
            }
            out.functionDefLine = functionStartLineColumn.line > 0
                ? static_cast<int>(functionStartLineColumn.line) - 1
                : 0;
            out.functionDefColumn = functionStartLineColumn.column > 0
                ? static_cast<int>(functionStartLineColumn.column) - 1
                : 0;
        }

        normalizeURL(out.url);

        if (frame.hasExpressionInfo()) {
            // Sample position for positionTicks. Use a throwaway out-param so
            // the sample remap can't clobber `url` with a different file than
            // the function definition, and drop the sample line entirely if it
            // maps to a different original source file (cross-module inlining
            // in bundled code would otherwise mislocate the tick).
            JSC::LineColumn sourceMappedLineColumn = frame.semanticLocation.lineColumn;
            // Seed with the raw provider URL so that when the sourcemap
            // callback is a no-op, the `sampleURL == url` guard below still
            // passes for plain .js files. Seeding empty would silently suppress
            // positionTicks for every non-sourcemapped script.
            WTF::String sampleURL = provider ? WTF::String(provider->sourceURL()) : WTF::String();
            if (provider) {
#if USE(BUN_JSC_ADDITIONS)
                auto& fn = vm.computeLineColumnWithSourcemap();
                if (fn)
                    fn(vm, provider, sourceMappedLineColumn, sampleURL);
#endif
            }
            normalizeURL(sampleURL);
            if (sourceMappedLineColumn.line > 0 && sampleURL == out.url)
                out.sampleLine = static_cast<int>(sourceMappedLineColumn.line);
        }
    }

    return out;
}

static void drainSamplesFromProfiler(JSC::VM& vm, JSC::SamplingProfiler& profiler)
{
    JSC::JSLockHolder locker(vm);
    JSC::DeferGC deferGC(vm);

    auto& lock = profiler.getLock();
    WTF::Locker profilerLocker { lock };

    auto stackTraces = profiler.releaseStackTraces();
    if (stackTraces.isEmpty())
        return;

    auto& retained = retainedSamples();
    retained.reserveCapacity(retained.size() + stackTraces.size());
    for (auto& stackTrace : stackTraces) {
        RetainedSample sample;
        sample.timestampUs = stackTrace.timestamp.approximate<WTF::WallTime>().secondsSinceEpoch().value() * 1000000.0;
        sample.frames.reserveInitialCapacity(stackTrace.frames.size());
        for (auto& frame : stackTrace.frames)
            sample.frames.append(extractFrame(vm, frame));
        retained.append(WTF::move(sample));
    }
}

// Helper to generate a minimal valid cpuprofile JSON with no samples
static WTF::String generateEmptyProfileJSON(double startTimeUs)
{
    long long timestamp;
    if (startTimeUs > 0)
        timestamp = static_cast<long long>(startTimeUs);
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

void stopCPUProfiler(JSC::VM& vm, WTF::String* outJSON, WTF::String* outText, double sinceTimestampUs)
{
    if (s_profilerRefCount > 0)
        s_profilerRefCount--;
    bool isLastConsumer = s_profilerRefCount == 0;

    JSC::SamplingProfiler* profiler = vm.samplingProfiler();
    if (!profiler) {
        if (outJSON) *outJSON = WTF::String();
        if (outText) *outText = WTF::String();
        if (isLastConsumer && s_retainedSamples) {
            s_retainedSamples->clear();
            s_profilingStartTime = 0.0;
        }
        return;
    }

    drainSamplesFromProfiler(vm, *profiler);

    if (isLastConsumer) {
        auto& lock = profiler->getLock();
        WTF::Locker profilerLocker { lock };
        profiler->pause();
        profiler->clearData();
    }

    double startTime = sinceTimestampUs > 0 ? sinceTimestampUs : s_profilingStartTime;

    auto cleanup = [&]() {
        if (isLastConsumer) {
            if (s_retainedSamples)
                s_retainedSamples->clear();
            s_profilingStartTime = 0.0;
        }
    };

    if (!outJSON && !outText) {
        cleanup();
        return;
    }

    auto& retained = retainedSamples();

    // Samples for this consumer, sorted by timestamp. Samples are drained in
    // batches so the retained vector is not globally sorted.
    WTF::Vector<size_t> sortedIndices;
    sortedIndices.reserveInitialCapacity(retained.size());
    for (size_t i = 0; i < retained.size(); i++) {
        if (retained[i].timestampUs >= startTime)
            sortedIndices.append(i);
    }
    std::sort(sortedIndices.begin(), sortedIndices.end(), [&retained](size_t a, size_t b) {
        return retained[a].timestampUs < retained[b].timestampUs;
    });

    if (sortedIndices.isEmpty()) {
        if (outJSON) *outJSON = generateEmptyProfileJSON(startTime);
        if (outText) *outText = "No samples collected.\n"_s;
        cleanup();
        return;
    }

    // Generate JSON format if requested
    if (outJSON) {
        // Map from stack frame signature to node ID
        WTF::HashMap<WTF::String, int> nodeMap;
        WTF::Vector<ProfileNode> nodes;

        // Create root node
        ProfileNode rootNode;
        rootNode.id = 1;
        rootNode.functionName = "(root)"_s;
        rootNode.url = ""_s;
        rootNode.scriptId = 0;
        rootNode.lineNumber = -1;
        rootNode.columnNumber = -1;
        rootNode.hitCount = 0;
        nodes.append(WTF::move(rootNode));

        int nextNodeId = 2;
        WTF::Vector<int> samples;
        WTF::Vector<long long> timeDeltas;

        double lastTime = startTime;

        for (size_t idx : sortedIndices) {
            auto& sample = retained[idx];
            double currentTime = sample.timestampUs;

            if (sample.frames.isEmpty()) {
                samples.append(1);
                double delta = std::max(0.0, currentTime - lastTime);
                timeDeltas.append(static_cast<long long>(delta));
                lastTime = currentTime;
                continue;
            }

            int currentParentId = 1;

            for (int i = sample.frames.size() - 1; i >= 0; i--) {
                const auto& frame = sample.frames[i];

                // line/column here identify the function's DEFINITION, so all
                // samples of the same function under the same parent collapse.
                WTF::StringBuilder keyBuilder;
                keyBuilder.append(currentParentId);
                keyBuilder.append(':');
                keyBuilder.append(frame.functionName);
                keyBuilder.append(':');
                keyBuilder.append(frame.url);
                keyBuilder.append(':');
                keyBuilder.append(frame.scriptId);
                keyBuilder.append(':');
                keyBuilder.append(frame.functionDefLine);
                keyBuilder.append(':');
                keyBuilder.append(frame.functionDefColumn);

                WTF::String key = keyBuilder.toString();

                int nodeId;
                auto it = nodeMap.find(key);
                if (it == nodeMap.end()) {
                    nodeId = nextNodeId++;
                    nodeMap.add(key, nodeId);

                    ProfileNode node;
                    node.id = nodeId;
                    node.functionName = frame.functionName;
                    node.url = frame.url;
                    node.scriptId = frame.scriptId;
                    node.lineNumber = frame.functionDefLine;
                    node.columnNumber = frame.functionDefColumn;
                    node.hitCount = 0;

                    nodes.append(WTF::move(node));

                    if (currentParentId > 0)
                        nodes[currentParentId - 1].children.append(nodeId);
                } else {
                    nodeId = it->value;
                }

                currentParentId = nodeId;

                if (i == 0) {
                    nodes[nodeId - 1].hitCount++;
                    if (frame.sampleLine > 0)
                        nodes[nodeId - 1].positionTicks.add(frame.sampleLine, 0).iterator->value++;
                }
            }

            samples.append(currentParentId);

            double delta = std::max(0.0, currentTime - lastTime);
            timeDeltas.append(static_cast<long long>(delta));
            lastTime = currentTime;
        }

        double endTime = lastTime;

        // Build JSON
        using namespace WTF;
        auto json = JSON::Object::create();

        auto nodesArray = JSON::Array::create();
        for (const auto& node : nodes) {
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
        for (int sample : samples)
            samplesArray->pushInteger(sample);
        json->setValue("samples"_s, samplesArray);

        auto timeDeltasArray = JSON::Array::create();
        for (long long delta : timeDeltas)
            timeDeltasArray->pushInteger(delta);
        json->setValue("timeDeltas"_s, timeDeltasArray);

        *outJSON = json->toJSONString();
    }

    // Generate text format if requested
    if (outText) {
        double lastTime = startTime;
        double endTime = startTime;

        WTF::HashMap<WTF::String, FunctionStats> functionStatsMap;

        long long totalTimeUs = 0;
        int totalSamples = static_cast<int>(sortedIndices.size());

        for (size_t idx : sortedIndices) {
            auto& sample = retained[idx];

            double currentTime = sample.timestampUs;
            long long deltaUs = static_cast<long long>(std::max(0.0, currentTime - lastTime));
            totalTimeUs += deltaUs;
            lastTime = currentTime;
            endTime = currentTime;

            if (sample.frames.isEmpty())
                continue;

            WTF::String previousKey;

            for (int i = sample.frames.size() - 1; i >= 0; i--) {
                const auto& frame = sample.frames[i];

                WTF::String functionName = formatFunctionName(frame.functionName, frame.isAsync);
                int lineNumber = frame.sampleLine > 0 ? frame.sampleLine : -1;
                WTF::String location = formatLocation(frame.url, lineNumber);
                WTF::StringBuilder keyBuilder;
                keyBuilder.append(functionName);
                keyBuilder.append(kKeySeparator);
                keyBuilder.append(location);
                WTF::String key = keyBuilder.toString();

                auto result = functionStatsMap.add(key, FunctionStats());
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

                    auto prevIt = functionStatsMap.find(previousKey);
                    if (prevIt != functionStatsMap.end())
                        prevIt->value.callees.add(key, 0).iterator->value++;
                }

                previousKey = key;
            }
        }

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

    cleanup();
}

} // namespace Bun

extern "C" void Bun__startCPUProfiler(JSC::VM* vm)
{
    Bun::startCPUProfiler(*vm);
}

extern "C" void Bun__stopCPUProfiler(JSC::VM* vm, BunString* outJSON, BunString* outText)
{
    WTF::String jsonResult;
    WTF::String textResult;
    Bun::stopCPUProfiler(*vm, outJSON ? &jsonResult : nullptr, outText ? &textResult : nullptr, 0.0);
    if (outJSON)
        *outJSON = Bun::toStringRef(jsonResult);
    if (outText)
        *outText = Bun::toStringRef(textResult);
}

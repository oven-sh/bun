#include "V8CpuProfiler.h"
#include "V8String.h"
#include "V8HandleScope.h"
#include "shim/CpuProfiler.h"

#include <JavaScriptCore/SamplingProfiler.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ScriptExecutable.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/DeferGC.h>
#include <wtf/Stopwatch.h>
#include <wtf/MonotonicTime.h>
#include <wtf/WallTime.h>
#include <wtf/HashMap.h>
#include <wtf/text/StringBuilder.h>
#include <algorithm>
#include <limits>

// node/v8-profiler.h is not reachable via real_v8.h (v8.h does not include it),
// so ASSERT_V8_TYPE_LAYOUT_MATCHES cannot be used for the types below. Their
// signatures are hand-matched against v8-profiler.h so the exported mangled
// names line up with what native addons import.

namespace v8 {

namespace shim {

static int64_t nowMicroseconds()
{
    return static_cast<int64_t>(
        WTF::MonotonicTime::now().secondsSinceEpoch().microseconds());
}

uint32_t CpuProfilerImpl::start(WTF::String&& title, bool recordSamples)
{
    uint32_t id = m_nextId++;
    m_sessions.append(Session { id, WTF::move(title), nowMicroseconds(), recordSamples });

    if (m_sessions.size() == 1) {
        auto& vm = m_isolate->vm();
        auto stopwatch = WTF::Stopwatch::create();
        stopwatch->start();
        JSC::SamplingProfiler& sampler = vm.ensureSamplingProfiler(WTF::move(stopwatch));
        sampler.setTimingInterval(WTF::Seconds::fromMicroseconds(m_samplingIntervalUs));
        sampler.noticeCurrentThreadAsJSCExecutionThread();
        sampler.start();
    }

    return id;
}

const CpuProfilerImpl::Session* CpuProfilerImpl::sessionWithTitle(const WTF::String& title) const
{
    for (const Session& session : m_sessions) {
        if (session.title == title)
            return &session;
    }
    return nullptr;
}

// Build the top-down call tree from JSC::SamplingProfiler stack traces. Mirrors
// the tree-building pass in BunCPUProfiler.cpp (which emits JSON), but targets
// the V8 CpuProfileNode/CpuProfile object model instead.
static void buildProfileTree(JSC::VM& vm, CpuProfileImpl& profile, int64_t startTime, bool recordSamples)
{
    JSC::SamplingProfiler* sampler = vm.samplingProfiler();

    auto makeRoot = [&]() -> CpuProfileNodeImpl* {
        auto root = makeUnique<CpuProfileNodeImpl>();
        root->id = 1;
        root->functionName = "(root)";
        root->scriptResourceName = "";
        CpuProfileNodeImpl* ptr = root.get();
        profile.m_nodes.append(WTF::move(root));
        profile.m_root = ptr;
        return ptr;
    };

    profile.m_startTime = startTime;

    if (!sampler) {
        makeRoot();
        profile.m_endTime = nowMicroseconds();
        return;
    }

    JSC::JSLockHolder jsLock(vm);
    JSC::DeferGC deferGC(vm);

    WTF::Vector<JSC::SamplingProfiler::StackTrace> stackTraces;
    {
        WTF::Locker locker { sampler->getLock() };
        stackTraces = sampler->releaseStackTraces();
    }

    CpuProfileNodeImpl* root = makeRoot();

    if (stackTraces.isEmpty()) {
        profile.m_endTime = nowMicroseconds();
        return;
    }

    WTF::Vector<size_t> order;
    order.reserveInitialCapacity(stackTraces.size());
    for (size_t i = 0; i < stackTraces.size(); ++i)
        order.append(i);
    std::sort(order.begin(), order.end(), [&stackTraces](size_t a, size_t b) {
        return stackTraces[a].timestamp < stackTraces[b].timestamp;
    });

    WTF::HashMap<WTF::String, CpuProfileNodeImpl*> nodeByKey;
    unsigned nextNodeId = 2;
    int64_t lastTimestamp = startTime;

    for (size_t idx : order) {
        auto& trace = stackTraces[idx];

        int64_t ts = static_cast<int64_t>(
            trace.timestamp.secondsSinceEpoch().microseconds());
        // Traces taken before this session started belong to an earlier,
        // overlapping session (see CpuProfiler::Start); drop them.
        if (ts < startTime)
            continue;
        if (ts < lastTimestamp)
            ts = lastTimestamp;
        lastTimestamp = ts;

        if (trace.frames.isEmpty()) {
            root->hitCount++;
            if (recordSamples) {
                profile.m_samples.append(root);
                profile.m_sampleTimestamps.append(ts);
            }
            continue;
        }

        CpuProfileNodeImpl* current = root;

        for (int i = static_cast<int>(trace.frames.size()) - 1; i >= 0; --i) {
            auto& frame = trace.frames[i];

            // JSC's SamplingProfiler names the top-level script frame
            // "(program)"/"(module)" and reports it as the outermost ancestor
            // of every call. V8's tree shape is different: those names are
            // reserved for leaf nodes directly under (root), and real function
            // calls are siblings of them — so consumers like @datadog/pprof
            // drop any top-level "(program)" subtree wholesale. Collapse the
            // script-level frame while it would sit at the root so function
            // calls become direct children of (root); if it is the leaf frame
            // (i == 0) it falls through and becomes the expected "(program)"
            // leaf node with a hit.
            if (current == root && i > 0
                && frame.frameType == JSC::SamplingProfiler::FrameType::Executable
                && frame.executable
                && !frame.executable->isFunctionExecutable()
                && !frame.executable->isHostFunction()) {
                continue;
            }

            WTF::String functionName = frame.displayName(vm);
            WTF::String url;
            int scriptId = 0;
            int line = CpuProfileNode::kNoLineNumberInfo;
            int column = CpuProfileNode::kNoColumnNumberInfo;
            int sampleLine = 0;

            if (frame.frameType == JSC::SamplingProfiler::FrameType::Executable && frame.executable) {
                auto providerAndId = frame.sourceProviderAndID();
                auto* provider = std::get<0>(providerAndId);
                if (provider) {
                    url = provider->sourceURL();
                    scriptId = static_cast<int>(provider->asID());
                }
                int rawLine = frame.functionStartLine();
                unsigned rawColumn = frame.functionStartColumn();
                bool definitionRemapped = false;
                if (rawLine > 0 && rawColumn != std::numeric_limits<unsigned>::max()) {
                    JSC::LineColumn lc { static_cast<unsigned>(rawLine), rawColumn };
#if USE(BUN_JSC_ADDITIONS)
                    if (provider) {
                        auto& remap = vm.computeLineColumnWithSourcemap();
                        if (remap) {
                            remap(vm, provider, lc, url);
                            definitionRemapped = true;
                        }
                    }
#endif
                    line = lc.line > 0 ? static_cast<int>(lc.line) : CpuProfileNode::kNoLineNumberInfo;
                    column = lc.column != std::numeric_limits<unsigned>::max()
                        ? static_cast<int>(lc.column)
                        : CpuProfileNode::kNoColumnNumberInfo;
                } else {
                    if (rawLine > 0)
                        line = rawLine;
                    if (rawColumn != std::numeric_limits<unsigned>::max())
                        column = static_cast<int>(rawColumn);
                }
                if (frame.hasExpressionInfo()) {
                    JSC::LineColumn sampleLc = frame.semanticLocation.lineColumn;
#if USE(BUN_JSC_ADDITIONS)
                    if (provider && definitionRemapped) {
                        auto& remap = vm.computeLineColumnWithSourcemap();
                        WTF::String sampleUrl = provider->sourceURL();
                        if (remap)
                            remap(vm, provider, sampleLc, sampleUrl);
                        // Drop the tick if it maps to a different source file
                        // than the function definition (cross-module inlining).
                        if (sampleUrl != url)
                            sampleLc.line = 0;
                    }
#endif
                    sampleLine = static_cast<int>(sampleLc.line);
                }
                (void)definitionRemapped;
            }

            WTF::StringBuilder keyBuilder;
            keyBuilder.append(current->id);
            keyBuilder.append(':');
            keyBuilder.append(functionName);
            keyBuilder.append(':');
            keyBuilder.append(url);
            keyBuilder.append(':');
            keyBuilder.append(scriptId);
            keyBuilder.append(':');
            keyBuilder.append(line);
            keyBuilder.append(':');
            keyBuilder.append(column);
            WTF::String key = keyBuilder.toString();

            CpuProfileNodeImpl* child;
            auto it = nodeByKey.find(key);
            if (it == nodeByKey.end()) {
                auto owned = makeUnique<CpuProfileNodeImpl>();
                owned->id = nextNodeId++;
                owned->functionName = functionName.utf8();
                owned->scriptResourceName = url.utf8();
                owned->scriptId = scriptId;
                owned->lineNumber = line;
                owned->columnNumber = column;
                child = owned.get();
                profile.m_nodes.append(WTF::move(owned));
                current->children.append(child);
                nodeByKey.add(key, child);
            } else {
                child = it->value;
            }

            current = child;

            if (i == 0) {
                current->hitCount++;
                if (sampleLine > 0) {
                    bool found = false;
                    for (auto& tick : current->lineTicks) {
                        if (tick.line == sampleLine) {
                            tick.hit_count++;
                            found = true;
                            break;
                        }
                    }
                    if (!found)
                        current->lineTicks.append(CpuProfileNodeImpl::LineTick { sampleLine, 1 });
                }
            }
        }

        if (recordSamples) {
            profile.m_samples.append(current);
            profile.m_sampleTimestamps.append(ts);
        }
    }

    profile.m_endTime = lastTimestamp > startTime ? lastTimestamp : nowMicroseconds();
}

CpuProfileImpl* CpuProfilerImpl::stop(uint32_t id)
{
    size_t index = WTF::notFound;
    for (size_t i = 0; i < m_sessions.size(); ++i) {
        if (m_sessions[i].id == id) {
            index = i;
            break;
        }
    }
    if (index == WTF::notFound)
        return nullptr;

    Session session = WTF::move(m_sessions[index]);
    m_sessions.removeAt(index);

    auto& vm = m_isolate->vm();
    auto* profile = new CpuProfileImpl();
    profile->m_title = WTF::move(session.title);
    buildProfileTree(vm, *profile, session.startTime, session.recordSamples);

    if (m_sessions.isEmpty()) {
        if (JSC::SamplingProfiler* sampler = vm.samplingProfiler()) {
            WTF::Locker locker { sampler->getLock() };
            sampler->pause();
            sampler->clearData();
        }
    }

    return profile;
}

} // namespace shim

// --- CpuProfileNode ---------------------------------------------------------

static inline const shim::CpuProfileNodeImpl* toImpl(const CpuProfileNode* n)
{
    return reinterpret_cast<const shim::CpuProfileNodeImpl*>(n);
}

Local<String> CpuProfileNode::GetFunctionName() const
{
    Isolate* isolate = Isolate::GetCurrent();
    auto& vm = isolate->vm();
    const auto& name = toImpl(this)->functionName;
    JSC::JSString* js = JSC::jsString(vm, WTF::String::fromUTF8(name.span()));
    return isolate->currentHandleScope()->createLocal<String>(vm, js);
}

const char* CpuProfileNode::GetFunctionNameStr() const
{
    return toImpl(this)->functionName.data();
}

int CpuProfileNode::GetScriptId() const
{
    return toImpl(this)->scriptId;
}

Local<String> CpuProfileNode::GetScriptResourceName() const
{
    Isolate* isolate = Isolate::GetCurrent();
    auto& vm = isolate->vm();
    const auto& name = toImpl(this)->scriptResourceName;
    JSC::JSString* js = JSC::jsString(vm, WTF::String::fromUTF8(name.span()));
    return isolate->currentHandleScope()->createLocal<String>(vm, js);
}

int CpuProfileNode::GetLineNumber() const
{
    return toImpl(this)->lineNumber;
}

int CpuProfileNode::GetColumnNumber() const
{
    return toImpl(this)->columnNumber;
}

unsigned int CpuProfileNode::GetHitLineCount() const
{
    return static_cast<unsigned>(toImpl(this)->lineTicks.size());
}

bool CpuProfileNode::GetLineTicks(LineTick* entries, unsigned int length) const
{
    const auto& ticks = toImpl(this)->lineTicks;
    if (length < ticks.size())
        return false;
    for (unsigned i = 0; i < ticks.size(); ++i) {
        entries[i].line = ticks[i].line;
        entries[i].column = 0;
        entries[i].hit_count = ticks[i].hit_count;
    }
    return true;
}

unsigned CpuProfileNode::GetHitCount() const
{
    return toImpl(this)->hitCount;
}

int CpuProfileNode::GetChildrenCount() const
{
    return static_cast<int>(toImpl(this)->children.size());
}

const CpuProfileNode* CpuProfileNode::GetChild(int index) const
{
    const auto& children = toImpl(this)->children;
    if (index < 0 || static_cast<unsigned>(index) >= children.size())
        return nullptr;
    return reinterpret_cast<const CpuProfileNode*>(children[index]);
}

// --- CpuProfile -------------------------------------------------------------

static inline const shim::CpuProfileImpl* toImpl(const CpuProfile* p)
{
    return reinterpret_cast<const shim::CpuProfileImpl*>(p);
}

Local<String> CpuProfile::GetTitle() const
{
    Isolate* isolate = Isolate::GetCurrent();
    auto& vm = isolate->vm();
    JSC::JSString* js = JSC::jsString(vm, toImpl(this)->m_title);
    return isolate->currentHandleScope()->createLocal<String>(vm, js);
}

const CpuProfileNode* CpuProfile::GetTopDownRoot() const
{
    return reinterpret_cast<const CpuProfileNode*>(toImpl(this)->m_root);
}

int CpuProfile::GetSamplesCount() const
{
    return static_cast<int>(toImpl(this)->m_samples.size());
}

const CpuProfileNode* CpuProfile::GetSample(int index) const
{
    const auto& samples = toImpl(this)->m_samples;
    if (index < 0 || static_cast<unsigned>(index) >= samples.size())
        return nullptr;
    return reinterpret_cast<const CpuProfileNode*>(samples[index]);
}

int64_t CpuProfile::GetSampleTimestamp(int index) const
{
    const auto& ts = toImpl(this)->m_sampleTimestamps;
    if (index < 0 || static_cast<unsigned>(index) >= ts.size())
        return 0;
    return ts[index];
}

int64_t CpuProfile::GetStartTime() const
{
    return toImpl(this)->m_startTime;
}

int64_t CpuProfile::GetEndTime() const
{
    return toImpl(this)->m_endTime;
}

void CpuProfile::Delete()
{
    delete reinterpret_cast<shim::CpuProfileImpl*>(this);
}

// --- CpuProfiler ------------------------------------------------------------

static inline shim::CpuProfilerImpl* toImpl(CpuProfiler* p)
{
    return reinterpret_cast<shim::CpuProfilerImpl*>(p);
}

CpuProfiler* CpuProfiler::New(Isolate* isolate, CpuProfilingNamingMode, CpuProfilingLoggingMode)
{
    return reinterpret_cast<CpuProfiler*>(new shim::CpuProfilerImpl(isolate));
}

void CpuProfiler::CollectSample(Isolate*, const std::optional<uint64_t>)
{
    // JSC's SamplingProfiler samples from its own timer thread; there is no
    // safe public entry point to force a synchronous sample here.
}

void CpuProfiler::Dispose()
{
    auto* impl = toImpl(this);
    if (!impl->m_sessions.isEmpty()) {
        if (JSC::SamplingProfiler* sampler = impl->m_isolate->vm().samplingProfiler()) {
            WTF::Locker locker { sampler->getLock() };
            sampler->pause();
            sampler->clearData();
        }
    }
    delete impl;
}

void CpuProfiler::SetSamplingInterval(int us)
{
    toImpl(this)->m_samplingIntervalUs = us > 0 ? us : 1000;
}

static WTF::String titleString(shim::CpuProfilerImpl* impl, Local<String> title)
{
    return title->localToJSString()->value(impl->m_isolate->globalObject());
}

CpuProfilingResult CpuProfiler::Start(Local<String> title, CpuProfilingMode, bool record_samples, unsigned)
{
    auto* impl = toImpl(this);
    WTF::String name = titleString(impl, title);

    // Like V8, a second Start() with the title of a running session is ignored
    // and reports that session. StopProfiling(title) relies on titles being
    // unique among running sessions.
    if (const auto* running = impl->sessionWithTitle(name))
        return CpuProfilingResult { running->id, CpuProfilingStatus::kAlreadyStarted };

    // Sessions with different titles may overlap. JSC::SamplingProfiler is a
    // single VM-global consumer and Stop() drains all traces via
    // releaseStackTraces(), so a session that overlaps a Stop() of another
    // session loses the samples taken before that Stop(). In practice the only
    // overlapping caller is @datadog/pprof's restart path, which calls
    // Start(new) immediately followed by Stop(old), so the window is
    // microseconds. Refusing the overlap is worse: pprof ignores
    // kAlreadyStarted, later calls Stop(0), gets nullptr, and dereferences it.
    uint32_t id = impl->start(WTF::move(name), record_samples);
    return CpuProfilingResult { id, CpuProfilingStatus::kStarted };
}

CpuProfilingStatus CpuProfiler::StartProfiling(Local<String> title, CpuProfilingMode mode, bool record_samples, unsigned max_samples)
{
    return Start(title, mode, record_samples, max_samples).status;
}

CpuProfilingStatus CpuProfiler::StartProfiling(Local<String> title, bool record_samples)
{
    return Start(title, kLeafNodeLineNumbers, record_samples).status;
}

CpuProfile* CpuProfiler::Stop(ProfilerId id)
{
    return reinterpret_cast<CpuProfile*>(toImpl(this)->stop(id));
}

CpuProfile* CpuProfiler::StopProfiling(Local<String> title)
{
    auto* impl = toImpl(this);
    WTF::String name = titleString(impl, title);

    // Like V8, an empty title stops the most recently started session.
    if (name.isEmpty()) {
        if (impl->m_sessions.isEmpty())
            return nullptr;
        return Stop(impl->m_sessions.last().id);
    }

    const auto* session = impl->sessionWithTitle(name);
    if (!session)
        return nullptr;
    return Stop(session->id);
}

} // namespace v8

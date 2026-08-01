#pragma once

#include "v8.h"
#include "V8Local.h"
#include "V8Isolate.h"
#include <optional>

namespace v8 {

class String;

using ProfilerId = uint32_t;

enum CpuProfilingMode {
    kLeafNodeLineNumbers,
    kCallerLineNumbers,
};

enum CpuProfilingNamingMode {
    kStandardNaming,
    kDebugNaming,
};

enum CpuProfilingLoggingMode {
    kLazyLogging,
    kEagerLogging,
};

enum class CpuProfilingStatus {
    kStarted,
    kAlreadyStarted,
    kErrorTooManyProfilers,
};

struct CpuProfilingResult {
    const ProfilerId id;
    const CpuProfilingStatus status;
};

class CpuProfileNode {
public:
    struct LineTick {
        int line;
        int column;
        unsigned int hit_count;
    };

    BUN_EXPORT Local<String> GetFunctionName() const;
    BUN_EXPORT const char* GetFunctionNameStr() const;
    BUN_EXPORT int GetScriptId() const;
    BUN_EXPORT Local<String> GetScriptResourceName() const;
    BUN_EXPORT int GetLineNumber() const;
    BUN_EXPORT int GetColumnNumber() const;
    BUN_EXPORT unsigned int GetHitLineCount() const;
    BUN_EXPORT bool GetLineTicks(LineTick* entries, unsigned int length) const;
    BUN_EXPORT unsigned GetHitCount() const;
    BUN_EXPORT int GetChildrenCount() const;
    BUN_EXPORT const CpuProfileNode* GetChild(int index) const;

    static const int kNoLineNumberInfo = 0;
    static const int kNoColumnNumberInfo = 0;
};

class CpuProfile {
public:
    BUN_EXPORT const CpuProfileNode* GetTopDownRoot() const;
    BUN_EXPORT int GetSamplesCount() const;
    BUN_EXPORT const CpuProfileNode* GetSample(int index) const;
    BUN_EXPORT int64_t GetSampleTimestamp(int index) const;
    BUN_EXPORT int64_t GetStartTime() const;
    BUN_EXPORT int64_t GetEndTime() const;
    BUN_EXPORT void Delete();
};

class CpuProfiler {
public:
    BUN_EXPORT static CpuProfiler* New(Isolate* isolate,
        CpuProfilingNamingMode = kDebugNaming,
        CpuProfilingLoggingMode = kLazyLogging);

    BUN_EXPORT static void CollectSample(Isolate* isolate,
        const std::optional<uint64_t> trace_id = std::nullopt);

    BUN_EXPORT void Dispose();
    BUN_EXPORT void SetSamplingInterval(int us);

    BUN_EXPORT CpuProfilingResult Start(Local<String> title, CpuProfilingMode mode,
        bool record_samples = false,
        unsigned max_samples = UINT_MAX);

    BUN_EXPORT CpuProfile* Stop(ProfilerId id);

private:
    CpuProfiler();
    ~CpuProfiler();
    CpuProfiler(const CpuProfiler&);
    CpuProfiler& operator=(const CpuProfiler&);
};

} // namespace v8

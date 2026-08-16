#pragma once

#include "root.h"
#include <wtf/text/CString.h>

namespace JSC {
class SamplingProfiler;
class VM;
}

namespace Bun {

// Report-at-exit support for jsc.startSamplingProfiler(directory). JSC's own
// registerForReportAtExit() reads Options::samplingProfilerPath(), which is
// frozen read-only after startup, and relies on libc atexit, which Bun's
// quick_exit path never runs; the directory is kept on the Bun side instead.
void registerSamplingProfilerReportAtExit(JSC::VM&, JSC::SamplingProfiler&, WTF::CString&& directory);

// Writes the pending report for this VM (if any) and drops its entry. Must
// run on the VM's owner thread, before the deref that runs ~VM.
void reportSamplingProfilerBeforeVMTeardown(JSC::VM&);

} // namespace Bun

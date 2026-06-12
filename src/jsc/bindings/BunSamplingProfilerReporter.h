#pragma once

#include "root.h"
#include <wtf/text/CString.h>

namespace JSC {
class SamplingProfiler;
class VM;
}

namespace Bun {

// Report-at-exit support for jsc.startSamplingProfiler(directory).
//
// JSC's own mechanism (SamplingProfiler::registerForReportAtExit) reads the
// directory from Options::samplingProfilerPath(), but JSC option storage
// lives in the Config pages that Config::permanentlyFreeze() mprotects
// read-only during startup, so assigning that option at runtime segfaults.
// The directory is stored on the Bun side instead, and reports are written:
// - for VMs torn down before process exit (workers, and the main VM under
//   Zig__GlobalObject__destructOnExit), by
//   reportSamplingProfilerBeforeVMTeardown;
// - for VMs still alive at process exit, through Bun__atexit, which runs on
//   every Bun exit path (libc atexit does not: on Linux Bun exits via
//   quick_exit).
void registerSamplingProfilerReportAtExit(JSC::VM&, JSC::SamplingProfiler&, WTF::CString&& directory);

// Writes the pending report for this VM (if any) and drops its registration,
// releasing the refs that keep the VM alive. Must run on the VM's owner
// thread, before the deref that runs ~VM (which shuts the profiler down).
void reportSamplingProfilerBeforeVMTeardown(JSC::VM&);

} // namespace Bun

#include "root.h"
#include "BunSamplingProfilerReporter.h"

#include <JavaScriptCore/JSLock.h>
#include <JavaScriptCore/SamplingProfiler.h>
#include <JavaScriptCore/VM.h>
#include <wtf/FilePrintStream.h>
#include <wtf/Lock.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/StringPrintStream.h>
#include <wtf/Vector.h>

extern "C" void Bun__atexit(void (*func)(void));

namespace Bun {

namespace {

struct SamplingProfilerExitReporter {
    struct Entry {
        Ref<JSC::SamplingProfiler> profiler;
        // SamplingProfiler::m_vm is a bare VM&; this Ref keeps it valid
        // until the entry is dropped.
        Ref<JSC::VM> vm;
        CString directory;
    };

    Lock lock;
    Vector<Entry> entries WTF_GUARDED_BY_LOCK(lock);

    static SamplingProfilerExitReporter& singleton()
    {
        static NeverDestroyed<SamplingProfilerExitReporter> reporter;
        return reporter.get();
    }

    void add(JSC::VM& vm, JSC::SamplingProfiler& profiler, CString&& directory)
    {
        {
            Locker locker { lock };
            for (auto& entry : entries) {
                if (entry.profiler.ptr() == &profiler) {
                    entry.directory = WTF::move(directory);
                    return;
                }
            }
            entries.append(Entry { profiler, vm, WTF::move(directory) });
        }
        // Deduplicated by Bun__atexit, so registering on every add is fine.
        Bun__atexit([] {
            SamplingProfilerExitReporter::singleton().reportStillRegisteredAtExit();
        });
    }

    // Mirrors SamplingProfiler::reportDataToOptionFile() minus the
    // frozen-Options read; callers already own the VM's API lock.
    void writeReport(Entry& entry) WTF_REQUIRES_LOCK(lock)
    {
        JSC::JSLockHolder holder(entry.vm.get());
        StringPrintStream pathOut;
        pathOut.print(entry.directory.data(), "/JSCSamplingProfile-", reinterpret_cast<uintptr_t>(entry.profiler.ptr()), ".txt");
        auto out = FilePrintStream::open(pathOut.toCString().data(), "w");
        if (!out) {
            SAFE_FPRINTF(stderr, "could not open sampling profiler report file %s\n", pathOut.toCString());
            return;
        }
        entry.profiler->reportTopFunctions(*out);
        entry.profiler->reportTopBytecodes(*out);
    }

    void reportStillRegisteredAtExit()
    {
        Locker locker { lock };
        for (auto& entry : entries) {
            // Another thread's VM cannot be locked or sampled here without
            // hanging the exit (its owner holds the API lock for the
            // thread's lifetime); those VMs report at their own teardown.
            if (!entry.vm->currentThreadIsHoldingAPILock())
                continue;
            writeReport(entry);
        }
        // Entries stay registered so no VM teardown starts inside the exit
        // callback.
    }

    void reportAndRemove(JSC::VM& vm)
    {
        Locker locker { lock };
        for (size_t i = 0; i < entries.size(); i++) {
            if (entries[i].vm.ptr() == &vm) {
                writeReport(entries[i]);
                entries.removeAt(i);
                return;
            }
        }
    }
};

} // namespace

void registerSamplingProfilerReportAtExit(JSC::VM& vm, JSC::SamplingProfiler& profiler, WTF::CString&& directory)
{
    SamplingProfilerExitReporter::singleton().add(vm, profiler, WTF::move(directory));
}

void reportSamplingProfilerBeforeVMTeardown(JSC::VM& vm)
{
    SamplingProfilerExitReporter::singleton().reportAndRemove(vm);
}

} // namespace Bun

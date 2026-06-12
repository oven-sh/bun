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
        // Keeps the profiler's VM alive while registered
        // (SamplingProfiler::m_vm is a bare VM&), so reporting can never
        // touch a freed VM. reportSamplingProfilerBeforeVMTeardown releases
        // it so ~VM can run during teardown.
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

    // Mirrors SamplingProfiler::reportDataToOptionFile(), minus the
    // frozen-Options read. Both callers run on the thread that owns the
    // VM's API lock, so the JSLockHolder acquisition is recursive and
    // cannot block.
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
            // A Bun VM's API lock is held by its owner thread for that
            // thread's whole lifetime (see WebWorker::thread_main), so a VM
            // whose lock this thread does not hold belongs to another,
            // possibly already-exited, thread: locking it or sampling it
            // here would hang the exit. Those VMs report in
            // reportSamplingProfilerBeforeVMTeardown instead.
            if (!entry.vm->currentThreadIsHoldingAPILock())
                continue;
            writeReport(entry);
        }
        // Entries are deliberately kept: the singleton is NeverDestroyed, so
        // the Refs never release during exit and no VM teardown can start
        // inside the exit callback.
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

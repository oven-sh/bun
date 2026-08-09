#ifndef _GNU_SOURCE
#define _GNU_SOURCE 1 // dl_iterate_phdr / dl_phdr_info (Linux)
#endif
#include "root.h"
#include "Snapshot.h"
#include "JSEnvironmentVariableMap.h"
// Snapshots are built and mapped on macOS and (glibc/musl) Linux; elsewhere the entry points exist so the rest of the runtime
// links, and report the feature as absent.
#if BUN_SNAPSHOT_SUPPORTED
#include <wtf/CryptographicallyRandomNumber.h>

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/ExecutableAllocator.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <wtf/text/AtomStringTable.h>
#include <wtf/RefCounted.h>
#include <JavaScriptCore/VMInlines.h>
#include <JavaScriptCore/StackAlignment.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/HeapIterationScope.h>
#include <JavaScriptCore/MarkedSpaceInlines.h>
#include <JavaScriptCore/JSCellInlines.h>
#include <JavaScriptCore/UnlinkedCodeBlock.h>
#include <JavaScriptCore/MarkedBlockInlines.h>
#include <JavaScriptCore/BlockDirectoryInlines.h>
#include <JavaScriptCore/Subspace.h>
#include <JavaScriptCore/JSModuleRecord.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/StructureInlines.h>
#include <JavaScriptCore/ButterflyInlines.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSFunctionInlines.h>
#include <JavaScriptCore/SourceProvider.h>
#include <vector>
#include <unordered_map>
#include <span>
#include <algorithm>
#include <string>
#include <chrono>
#include <map>
#include <functional>
#include <set>
#include <JavaScriptCore/UnlinkedMetadataTable.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/InstructionStream.h>
#include <wtf/HashSet.h>
#include <wtf/FastMalloc.h>
#include <wtf/HashMap.h>
#include <wtf/text/CString.h>
#include <atomic>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <sys/mman.h>
#include <fcntl.h>
#if OS(DARWIN)
#include <mach/mach.h>
#include <sys/sysctl.h>
#include <crt_externs.h>
#include <spawn.h>
#include <termios.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <sys/ucontext.h>
#include <signal.h>
#include <libkern/OSCacheControl.h>
#include <pthread.h>
#include <mach/mach_vm.h>
#include <mach-o/dyld.h>
#include <uuid/uuid.h>
#include <mach-o/loader.h>
#include <mach-o/getsect.h>
#include <pthread.h>
#include <wtf/Threading.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSLock.h>
#include <JavaScriptCore/MachineStackMarker.h>
#endif
#if OS(LINUX)
#include <sys/personality.h>
#include <sys/auxv.h>
#include <link.h>
#include <elf.h>
#include <dirent.h>
#include <ucontext.h>
#endif
#ifndef MAP_JIT
#define MAP_JIT 0
#endif
#include <JavaScriptCore/Completion.h>
#include <zstd.h>
#include <dlfcn.h>
#include <hwy/targets.h>
#include "wtf/SIMDUTF.h"
#pragma clang diagnostic ignored "-Wformat" // uint64_t is unsigned long on Linux, unsigned long long on Darwin; this file prints a lot of addresses
#include <signal.h>
#include <sys/mman.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <termios.h>
#include <unistd.h>
#if OS(DARWIN)
extern "C" uint64_t* Bun__getStandaloneModuleGraphMachoLength();
#endif

extern "C" int mi_prof_dump_to_file(const char*) noexcept;
extern "C" void mi_prof_enable(size_t) noexcept;
typedef void(mi_output_fun)(const char* msg, void* arg);
extern "C" void mi_stats_print_out(mi_output_fun* out, void* arg) noexcept;
extern "C" void mi_arenas_print(void) noexcept;
extern "C" void mi_collect(bool force) noexcept;
extern "C" size_t mi_usable_size(const void*) noexcept;
extern "C" int mi_heap_snapshot_to_file(const char* path, unsigned flags) noexcept;
extern "C" void mi_arenas_freeze_pages() noexcept;
extern "C" void mi_prof_visit_live(bool (*cb)(uintptr_t addr, size_t size, const uintptr_t* frames, uint8_t nframes, void* arg), void* arg) noexcept;
#include <mimalloc.h>
#include "ZigGlobalObject.h"
namespace Bun::Snapshot {
std::vector<std::pair<uintptr_t, uintptr_t>> frozenRanges; // sorted [start,end)
std::vector<FrozenRun> snapshotRuns;
int snapshotFd = -1;
::mi_heap_s* freshHeap = nullptr;
off_t snapshotBaseOff = 0;
ssize_t ipread(int fd, void* buf, size_t n, off_t off) { return ::pread(fd, buf, n, off + snapshotBaseOff); }
} // namespace Bun::Snapshot
using namespace Bun::Snapshot;
#if OS(DARWIN)
#define OS_DARWIN_ONLY(x) x
#else
#define OS_DARWIN_ONLY(x) 0
#endif
// Snapshot bytes may live at an offset inside a bigger file (embedded in the executable's __BUN/.bun section): all snapshot-file reads/maps add this.
static void* immap(void* addr, size_t len, int prot, int flags, int fd, off_t off) { return ::mmap(addr, len, prot, flags, fd, off + snapshotBaseOff); }

static void snapshotRestoreAndRun(const char* path);
extern "C" struct mach_header_64 _mh_execute_header;
// Snapshots (building or restoring one) need the executable at its link-time address. If dyld slid us, replace this process
// with an unslid copy of ourselves (macOS private posix_spawn flag) — same argv/env, no external launcher needed.
// The allocator / JIT placement and JSC tiering options a snapshot depends on; applied (via the re-exec env) whenever a snapshot is built or used.
extern "C" int bun_is_compiled_executable(void);
extern "C" bool Bun__isCompiledExecutable() { return bun_is_compiled_executable(); }
extern "C" bool Bun__snapshotMode() { return bun_is_compiled_executable() || getenv("BUN_SNAPSHOT_IN") || getenv("BUN_SNAPSHOT_OUT"); }
// Restore epoch, readable by any statically linked C/C++ (vendored libraries included): 0 in the process that boots normally or builds
// a snapshot, N after the Nth restore. A lazily-initialised static that caches process/OS/CPU state keys its once-token on this
// (`if (token != bun_snapshot_epoch + 1) { init(); token = bun_snapshot_epoch + 1; }`) instead of a plain bool.
extern "C" uint32_t bun_snapshot_epoch; // defined (exported, unmangled) in bun_core::snapshot; std::atomic<u32> layout == uint32_t

namespace bssl {
void OPENSSL_cpuid_setup();
}
// CPU-dispatch latches in vendored code chose an implementation on the build machine. The header's feature-superset check makes those
// choices valid here; re-probing lets a more capable CPU pick its best paths.
static void snapshotReprobeCPUDispatch()
{
    hwy::GetChosenTarget().DeInit(); // next HWY_DYNAMIC_DISPATCH re-detects
    simdutf::get_active_implementation() = simdutf::get_available_implementations().detect_best_supported();
    bssl::OPENSSL_cpuid_setup(); // refills OPENSSL_ia32cap_P / OPENSSL_armcap_P
}

static bool s_snapshotActive = false; // set once this process is building a snapshot or has restored one (decided in Bun__snapshotMaybeRestore, before VM init)
// A launch that resumes from its snapshot, or declines it and boots normally, says nothing unless asked (BUN_SNAPSHOT_VERBOSE=1).
static bool snapshotVerbose()
{
    static const bool verbose = !!getenv("BUN_SNAPSHOT_VERBOSE");
    return verbose;
}
extern "C" bool Bun__snapshotActive() { return s_snapshotActive; }

extern "C" bool Bun__isCompiledExecutable();
static void setSnapshotEnvDefaults()
{
    bool building = getenv("BUN_SNAPSHOT_OUT");
    if (Bun__isCompiledExecutable() && !building)
        return; // compiled executables configure the allocator/JIT from BUN_COMPILED before main: nothing to pass through the environment
    setenv("MIMALLOC_DETERMINISTIC_HINT", "1", 0);
    // Builder and restorer must not share addresses for their *own* early allocations: the builder's heap (the snapshot) starts at mimalloc's
    // default 2TiB base; a process that is going to restore starts its ordinary early heap 64GiB higher so it never sits where snapshot regions go.
    if (getenv("BUN_SNAPSHOT_OUT"))
        unsetenv("MIMALLOC_HINT_FLOOR");
    else
        setenv("MIMALLOC_HINT_FLOOR", "0x21000000000", 0);
    setenv("BUN_SNAPSHOT_JIT_ADDR", "0x3c0000000", 0);
}
static bool snapshotEnvIsSet()
{
    bool building = getenv("BUN_SNAPSHOT_OUT");
    if (Bun__isCompiledExecutable() && !building) return true; // compiled executables configure allocator/JIT from BUN_COMPILED before main: nothing to inject
    return getenv("MIMALLOC_DETERMINISTIC_HINT") && getenv("BUN_SNAPSHOT_JIT_ADDR") && (building || getenv("MIMALLOC_HINT_FLOOR"));
}

static void reexecWithoutASLRIfSlid()
{
    // Hard cap independent of the environment: the re-exec'd generation is tagged in argv[0] (survives env scrubbing),
    // and a tagged process never re-execs again.
    static constexpr const char* kReexecTag = " [snapshot-reexec]";
#if OS(DARWIN)
    const bool alreadyReexeced = (*_NSGetArgv())[0] && strstr((*_NSGetArgv())[0], kReexecTag);
#else
    const bool alreadyReexeced = false;
#endif
    if (getenv("BUN_SNAPSHOT_REEXECED") || alreadyReexeced)
        return;
    bool needEnv = !snapshotEnvIsSet();
#if OS(DARWIN)
    constexpr uintptr_t linkBase = 0x100000000ull;
    if (((uintptr_t)&_mh_execute_header == linkBase && !needEnv) || getenv("BUN_SNAPSHOT_REEXECED"))
        return;
    setenv("BUN_SNAPSHOT_REEXECED", "1", 1);
    setSnapshotEnvDefaults();
    char exe[4096];
    uint32_t len = sizeof exe;
    if (_NSGetExecutablePath(exe, &len) != 0)
        return;
    posix_spawnattr_t attr;
    posix_spawnattr_init(&attr);
    short flags = 0;
    posix_spawnattr_getflags(&attr, &flags);
    posix_spawnattr_setflags(&attr, flags | 0x0100 /* _POSIX_SPAWN_DISABLE_ASLR */ | POSIX_SPAWN_SETEXEC);
    char** oargv = *_NSGetArgv();
    int argc = 0;
    while (oargv[argc])
        argc++;
    std::vector<char*> nargv(oargv, oargv + argc + 1);
    std::string tagged = std::string(oargv[0] ? oargv[0] : exe) + kReexecTag;
    nargv[0] = tagged.data();
    posix_spawn(nullptr, exe, nullptr, &attr, nargv.data(), *_NSGetEnviron()); // SETEXEC: only returns on failure
    fprintf(stderr, "[snapshot] could not re-exec without ASLR; continuing slid (snapshot build/restore will not work)\n");
#elif OS(LINUX)
    // Linux: the executable is non-PIE (never slides) and system libraries may slide (extern-library fixups), so ASLR stays on;
    // we only re-exec to get the allocator/JIT/JSC options into the environment before they are read at startup.
    if (getenv("BUN_SNAPSHOT_REEXECED") || !needEnv)
        return;
    setenv("BUN_SNAPSHOT_REEXECED", "1", 1);
    setSnapshotEnvDefaults();
    setenv("BUN_SNAPSHOT_LIB_FIXUPS", "1", 0);
    {
        extern char** environ;
        // argv: read our own cmdline
        std::vector<std::string> args;
        {
            FILE* f = fopen("/proc/self/cmdline", "r");
            std::string cur;
            int c;
            while (f && (c = fgetc(f)) != EOF) {
                if (!c) {
                    args.push_back(cur);
                    cur.clear();
                } else
                    cur += (char)c;
            }
            if (f) fclose(f);
        }
        std::vector<char*> argv;
        for (auto& a : args)
            argv.push_back(a.data());
        argv.push_back(nullptr);
        execve("/proc/self/exe", argv.data(), environ);
    }
    fprintf(stderr, "[snapshot] could not re-exec without ASLR; continuing (snapshot build/restore will not work)\n");
#endif
}

// `<executable>.snapshot` next to the binary is used automatically (BUN_SNAPSHOT=0 opts out; BUN_SNAPSHOT_IN overrides).
static bool snapshotInflateZstd(const char* zpath, const char* outPath);
static uint64_t platformLibsBase();
static uint64_t platformSystemLibsId();
static uint64_t platformBuildId();
static bool snapshotInflateZstdBuffer(const void* src, size_t srcLen, const char* outPath);
static bool snapshotCacheDir(char* dir, size_t cap) // ~/.cache/bun/snapshots (or $XDG_CACHE_HOME/bun/snapshots), created on demand
{
    const char* cacheHome = getenv("XDG_CACHE_HOME");
    const char* home = getenv("HOME");
    if (cacheHome && *cacheHome)
        snprintf(dir, cap, "%s/bun/snapshots", cacheHome);
    else if (home)
        snprintf(dir, cap, "%s/.cache/bun/snapshots", home);
    else
        return false;
    char partial[4200];
    snprintf(partial, sizeof partial, "%s", dir);
    for (char* q = partial + 1; *q; q++)
        if (*q == '/') {
            *q = 0;
            mkdir(partial, 0755);
            *q = '/';
        }
    mkdir(partial, 0755);
    return true;
}
static bool findSiblingSnapshot(char* out, size_t cap)
{
    const char* off = getenv("BUN_SNAPSHOT");
    if (off && (!strcmp(off, "0") || !strcmp(off, "false")))
        return false;
    char exe[4096];
#if OS(DARWIN)
    uint32_t len = sizeof exe;
    if (_NSGetExecutablePath(exe, &len) != 0) return false;
#else
    ssize_t n = readlink("/proc/self/exe", exe, sizeof exe - 1);
    if (n <= 0) return false;
    exe[n] = 0;
#endif
    snprintf(out, cap, "%s.snapshot", exe);
    if (access(out, R_OK) == 0)
        return true;
    char zpath[4300];
    snprintf(zpath, sizeof zpath, "%s.snapshot.zst", exe);
    struct stat zst, est;
    if (stat(zpath, &zst) || stat(exe, &est)) return false;
    // Inflate once into the user cache, keyed by the executable + compressed snapshot identity.
    char dir[4200];
    if (!snapshotCacheDir(dir, sizeof dir)) return false;
    uint64_t keyExtra = platformSystemLibsId() ^ platformBuildId(); // libraries may slide (extern-library fixups); their contents are part of the identity
    snprintf(out, cap, "%s/%llx-%llx-%llx-%llx-%llx.snapshot", dir, (unsigned long long)est.st_size, (unsigned long long)est.st_mtime, (unsigned long long)zst.st_size, (unsigned long long)zst.st_mtime, (unsigned long long)keyExtra);
    if (access(out, R_OK) == 0)
        return true;
    if (getenv("BUN_SNAPSHOT_VERBOSE")) fprintf(stderr, "[snapshot] inflating %s -> %s\n", zpath, out);
    return snapshotInflateZstd(zpath, out);
}

static bool siblingSnapshotExists() // cheap pre-check (no inflate): is there an <exe>.snapshot or <exe>.snapshot.zst at all?
{
    const char* off = getenv("BUN_SNAPSHOT");
    if (off && (!strcmp(off, "0") || !strcmp(off, "false"))) return false;
    char exe[4096], p[4300];
#if OS(DARWIN)
    uint32_t len = sizeof exe;
    if (_NSGetExecutablePath(exe, &len) != 0) return false;
#else
    ssize_t n = readlink("/proc/self/exe", exe, sizeof exe - 1);
    if (n <= 0) return false;
    exe[n] = 0;
#endif
    snprintf(p, sizeof p, "%s.snapshot", exe);
    if (!access(p, R_OK)) return true;
    snprintf(p, sizeof p, "%s.snapshot.zst", exe);
    return !access(p, R_OK);
}

extern "C" bool Bun__standaloneEmbeddedSnapshot(const uint8_t** outPtr, size_t* outLen);
static bool embeddedSnapshotExists()
{
    const char* off = getenv("BUN_SNAPSHOT");
    if (off && (!strcmp(off, "0") || !strcmp(off, "false"))) return false;
    const uint8_t* p;
    size_t n;
    return Bun__standaloneEmbeddedSnapshot(&p, &n);
}
// "<own executable>@<file offset>" for a snapshot embedded in the __BUN/.bun section (in-memory pointer -> segment -> file offset).
static bool findEmbeddedSnapshot(char* out, size_t cap)
{
    const char* off = getenv("BUN_SNAPSHOT");
    if (off && (!strcmp(off, "0") || !strcmp(off, "false"))) return false;
    const uint8_t* p = nullptr;
    size_t n = 0;
    if (!Bun__standaloneEmbeddedSnapshot(&p, &n)) return false;
    char exe[4096];
    int64_t fileOff = -1;
    uintptr_t a = (uintptr_t)p;
#if OS(DARWIN)
    uint32_t len = sizeof exe;
    if (_NSGetExecutablePath(exe, &len) != 0) return false;
    const struct mach_header_64* mh = &_mh_execute_header;
    intptr_t slide = 0;
    for (uint32_t i = 0; i < _dyld_image_count(); i++)
        if ((const struct mach_header_64*)_dyld_get_image_header(i) == mh) {
            slide = _dyld_get_image_vmaddr_slide(i);
            break;
        }
    const uint8_t* lc = (const uint8_t*)(mh + 1);
    for (uint32_t i = 0; i < mh->ncmds; i++) {
        const struct load_command* c = (const struct load_command*)lc;
        if (c->cmd == LC_SEGMENT_64) {
            const struct segment_command_64* sc = (const struct segment_command_64*)c;
            uintptr_t lo = sc->vmaddr + slide;
            if (a >= lo && a < lo + sc->vmsize && (a - lo) < sc->filesize) {
                fileOff = (int64_t)(sc->fileoff + (a - lo));
                break;
            }
        }
        lc += c->cmdsize;
    }
#elif OS(LINUX)
    ssize_t r = readlink("/proc/self/exe", exe, sizeof exe - 1);
    if (r <= 0) return false;
    exe[r] = 0;
    { // the appended payload is mapped by a PT_LOAD the ELF writer adds: pointer -> that segment's file offset
        struct Ctx {
            uintptr_t a;
            int64_t off;
        } ctx { a, -1 };
        dl_iterate_phdr([](struct dl_phdr_info* info, size_t, void* arg) -> int {
            if (info->dlpi_name && *info->dlpi_name) return 0; // main executable only
            Ctx* c = (Ctx*)arg;
            for (int i = 0; i < info->dlpi_phnum; i++) {
                const ElfW(Phdr) & ph = info->dlpi_phdr[i];
                if (ph.p_type != PT_LOAD) continue;
                uintptr_t lo = info->dlpi_addr + ph.p_vaddr;
                if (c->a >= lo && c->a < lo + ph.p_memsz && (c->a - lo) < ph.p_filesz) {
                    c->off = (int64_t)(ph.p_offset + (c->a - lo));
                    return 1;
                }
            }
            return 0;
        },
            &ctx);
        fileOff = ctx.off;
    }
#else
    return false;
#endif
    if (n >= 4 && p[0] == 0x28 && p[1] == 0xB5 && p[2] == 0x2F && p[3] == 0xFD) { // zstd frame: what ships (a CC snapshot is ~33 MB compressed vs ~210 MB raw)
        struct stat est;
        if (stat(exe, &est)) return false;
        char dir[4200];
        if (!snapshotCacheDir(dir, sizeof dir)) return false;
        uint64_t keyExtra = platformSystemLibsId() ^ platformBuildId();
        snprintf(out, cap, "%s/%llx-%llx-%llx-%llx.snapshot", dir, (unsigned long long)est.st_size, (unsigned long long)est.st_mtime, (unsigned long long)n, (unsigned long long)keyExtra);
        if (access(out, R_OK) == 0) return true;
        if (getenv("BUN_SNAPSHOT_VERBOSE")) fprintf(stderr, "[snapshot] inflating the embedded snapshot (%llu KB) -> %s\n", (unsigned long long)(n / 1024), out); // no %f before the restore: libc dtoa keeps malloc'd scratch that the overlay would invalidate
        return snapshotInflateZstdBuffer(p, n, out);
    }
    if (fileOff < 0 || (fileOff & (getpagesize() - 1))) {
        fprintf(stderr, "[snapshot] embedded snapshot is not page-aligned in the file (offset %lld); ignoring\n", (long long)fileOff);
        return false;
    }
    snprintf(out, cap, "%s@%lld", exe, (long long)fileOff);
    return true;
}

extern "C" void Bun__snapshotMaybeRestore()
{
    // Only compiled executables carry or sit next to snapshots; a plain `bun` takes part only when asked to through the environment.
    if (!bun_is_compiled_executable() && !getenv("BUN_SNAPSHOT_IN") && !getenv("BUN_SNAPSHOT_OUT"))
        return;
    // No setenv()/heap use in a process that is about to restore: environ would be reallocated into memory the snapshot overlays.
    bool wantSnapshot = getenv("BUN_SNAPSHOT_IN") || getenv("BUN_SNAPSHOT_OUT") || siblingSnapshotExists() || embeddedSnapshotExists();
    if (wantSnapshot)
        reexecWithoutASLRIfSlid(); // returns only once we are the unslid process with the snapshot env in place
    char path[4200] = "";
    if (const char* in = getenv("BUN_SNAPSHOT_IN"))
        snprintf(path, sizeof path, "%s", in); // explicit file (debugging / dev loop)
    else if (!getenv("BUN_SNAPSHOT_OUT")) {
        if (!findSiblingSnapshot(path, sizeof path)) {
            path[0] = 0;
            findEmbeddedSnapshot(path, sizeof path);
        } // sibling .img[.zst] (debugging), else the snapshot embedded in this executable
    }
    s_snapshotActive = path[0] || getenv("BUN_SNAPSHOT_OUT");
    if (path[0])
        snapshotRestoreAndRun(path); // returns only if the snapshot was declined (then we boot normally, still with snapshot-compatible options so a rebuild can snapshot)
}
extern "C" void Bun__snapshotSetBuilding(bool);
extern "C" void mi_prof_reinit_lock(void);
extern "C" void mi_os_hint_floor(void*) noexcept;
extern "C" bool mi_prof_lock_is_free(void);
extern "C" void Bun__requestSnapshot(JSC::VM*, const char* path);
static void snapshotDump(JSC::VM& vm, const char* path);
// envGate (Bun.unsafe.snapshot option): NUL-separated names, stored in the snapshot after the region data; hashed together with
// their values so a launch whose environment differs in any of them declines the snapshot before touching it.
static std::string s_envGateNames;
extern "C" void Bun__snapshotSetEnvGate(const uint8_t* names, size_t len) { s_envGateNames.assign((const char*)names, len); }
static uint64_t envGateHash(const char* names, size_t len)
{
    uint64_t h = 1469598103934665603ull;
    auto mix = [&](const char* p, size_t n) { for (size_t i = 0; i < n; i++) { h ^= (uint8_t)p[i]; h *= 1099511628211ull; } h ^= 0xff; h *= 1099511628211ull; };
    for (size_t i = 0; i < len;) {
        const char* name = names + i;
        size_t nl = strnlen(name, len - i);
        mix(name, nl);
        if (const char* v = getenv(name))
            mix(v, strlen(v));
        else
            mix("\x01unset", 6);
        i += nl + 1;
    }
    return h ? h : 1;
}
extern "C" void Bun__snapshotUnwindJS(JSC::VM* vm) { vm->notifyNeedTermination(); }
extern "C" void Bun__snapshotClearTerminationRequest(JSC::VM* vm) { vm->clearHasTerminationRequest(); }
extern "C" void Bun__snapshotDumpNow(JSC::VM* vm, const char* path)
{
    mi_scavenger_stop(); // joins mimalloc's background thread: nothing may hold allocator locks while we freeze
#if OS(DARWIN)
    // Pool workers were told to exit; give them (bounded) time to actually be gone, and any straggler inside the allocator time to leave it.
    for (int attempt = 0; attempt < 200; attempt++) {
        thread_act_array_t threads;
        mach_msg_type_number_t count = 0;
        unsigned pool = 0;
        if (task_threads(mach_task_self(), &threads, &count) == KERN_SUCCESS) {
            for (mach_msg_type_number_t i = 0; i < count; i++) {
                pthread_t pt = pthread_from_mach_thread_np(threads[i]);
                char name[64] = "";
                if (pt) pthread_getname_np(pt, name, sizeof name);
                if (!strncmp(name, "Bun Pool", 8)) pool++;
                mach_port_deallocate(mach_task_self(), threads[i]);
            }
            vm_deallocate(mach_task_self(), (vm_address_t)threads, count * sizeof(thread_act_t));
        }
        if (!pool && mi_prof_lock_is_free()) break;
        usleep(10000);
    }
    { // who else is alive right now? every one of them is a potential holder of some lock we are about to freeze
        thread_act_array_t threads;
        mach_msg_type_number_t count = 0;
        if (task_threads(mach_task_self(), &threads, &count) == KERN_SUCCESS) {
            fprintf(stderr, "[snapshot] %u threads at snapshot time:", count);
            for (mach_msg_type_number_t i = 0; i < count; i++) {
                pthread_t pt = pthread_from_mach_thread_np(threads[i]);
                char name[64] = "?";
                if (pt) pthread_getname_np(pt, name, sizeof name);
                fprintf(stderr, " [%s]", name[0] ? name : "unnamed");
                mach_port_deallocate(mach_task_self(), threads[i]);
            }
            fprintf(stderr, "\n");
            vm_deallocate(mach_task_self(), (vm_address_t)threads, count * sizeof(thread_act_t));
        }
    }
#else
    // Pool workers were told to exit; give them (bounded) time to actually be gone, and any straggler inside the allocator time to leave it.
    for (int attempt = 0; attempt < 200; attempt++) {
        unsigned pool = 0;
        if (DIR* d = opendir("/proc/self/task")) {
            while (struct dirent* e = readdir(d)) {
                if (e->d_name[0] == '.') continue;
                char pth[128], name[64] = "";
                snprintf(pth, sizeof pth, "/proc/self/task/%s/comm", e->d_name);
                if (FILE* f = fopen(pth, "r")) {
                    if (fgets(name, sizeof name, f) && !strncmp(name, "Bun Pool", 8)) pool++;
                    fclose(f);
                }
            }
            closedir(d);
        }
        if (!pool && mi_prof_lock_is_free()) break;
        usleep(10000);
    }
#endif
    if (!mi_prof_lock_is_free()) fprintf(stderr, "[snapshot] WARNING: mimalloc profiler lock is held at snapshot time (some thread is mid-free)\n");
    { // the termination that unwound JS to get us here is done with; none of it may persist into the snapshot (it would read as "terminating" forever on restore)
        JSC::JSLockHolder lock(*vm);
        vm->clearHasTerminationRequest();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(*vm);
        scope.clearException();
        vm->traps().clearTrap(JSC::VMTraps::NeedTermination);
    }
    snapshotDump(*vm, path);
}
extern "C" void Bun__snapshotInit()
{
    if (getenv("BUN_SNAPSHOT_OUT"))
        Bun__snapshotSetBuilding(true); // building: network use is refused so the process can become quiet (see throw_disabled_in_snapshot_error_if_needed)
    snapshotToolingInstall();
}

namespace Bun::Snapshot {
// Snapshot pages this process wrote and then put back to their original bytes (refcounts, transient flags) are handed back to
// the clean file mapping. Called by the application when it goes idle (Bun.unsafe.recleanSnapshotPages()).
void recleanFrozenPages(JSC::VM& vm)
{
#if OS(DARWIN)
    JSC::JSLockHolder lock(vm);
    if (snapshotFd < 0)
        return;
    const size_t pg = getpagesize();
    std::vector<uint8_t> orig(pg);
    std::vector<int> disp;
    size_t dirty = 0, remapped = 0;
    auto pageIsDirty = [&](size_t i) { return (disp[i] & (VM_PAGE_QUERY_PAGE_DIRTY | VM_PAGE_QUERY_PAGE_COPIED)) != 0; };
    auto pageIsPristine = [&](const FrozenRun& run, size_t i) {
        return ipread(snapshotFd, orig.data(), pg, run.fileOff + i * pg) == (ssize_t)pg && !memcmp((const void*)(run.start + i * pg), orig.data(), pg);
    };
    for (auto& run : snapshotRuns) {
        const size_t n = run.len / pg;
        disp.assign(n, 0);
        mach_vm_size_t cnt = n;
        if (mach_vm_page_range_query(mach_task_self(), run.start, run.len, (mach_vm_address_t)disp.data(), &cnt) != KERN_SUCCESS)
            continue;
        for (size_t i = 0; i < n;) {
            if (!pageIsDirty(i)) {
                i++;
                continue;
            }
            dirty++;
            if (!pageIsPristine(run, i)) {
                i++;
                continue;
            }
            size_t j = i + 1; // coalesce a run of pristine dirty pages into one mapping
            while (j < n && pageIsDirty(j) && pageIsPristine(run, j)) {
                dirty++;
                j++;
            }
            if (immap((void*)(run.start + i * pg), (j - i) * pg, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_FIXED, snapshotFd, run.fileOff + i * pg) != MAP_FAILED)
                remapped += j - i;
            i = j;
        }
    }
    if (getenv("BUN_SNAPSHOT_VERBOSE"))
        fprintf(stderr, "[snapshot] reclean: %zu dirty snapshot pages, %zu were pristine and are file-backed again\n", dirty, remapped);
#else
    UNUSED_PARAM(vm);
#endif
}
} // namespace Bun::Snapshot
extern "C" void Bun__snapshotRecleanPages(JSC::VM* vm) { Bun::Snapshot::recleanFrozenPages(*vm); }

struct us_loop_t;
extern "C" void us_loop_reinit_for_snapshot(struct us_loop_t*);
extern "C" struct us_loop_t* uws_get_loop();
extern "C" void Bun__snapshotContinueEventLoop();
extern "C" void uws_adopt_loop_for_current_thread(struct us_loop_t*);
void _mi_scavenger_forked_child(void); // C++-mangled (mimalloc is built as C++ here)
void _mi_scavenger_start_if_forked(void);
extern "C" void Bun__snapshotAdoptMainThreadVM();
struct BunLaunchContext {
    size_t argc;
    const char* const* argv;
};
extern "C" void bun_launch_context_capture(BunLaunchContext*);
extern "C" void bun_launch_context_restore(const BunLaunchContext*);
extern "C" void Bun__VM__refreshStackBoundsAfterSnapshotRestore(JSC::VM* vm)
{
    if (getenv("BUN_SNAPSHOT_VERBOSE")) fprintf(stderr, "[snapshot] refreshing VM stack bounds: lastStackTop=%p thread stack=[%p,%p)\n", vm->lastStackTop(), WTF::Thread::currentSingleton().stack().end(), WTF::Thread::currentSingleton().stack().origin());
    vm->refreshStackBoundsAfterSnapshotRestore();
    if (getenv("BUN_SNAPSHOT_VERBOSE")) fprintf(stderr, "[snapshot] refreshed: lastStackTop=%p\n", vm->lastStackTop());
}
// "Snapshot-capable" = a `bun build --compile` executable (BUN_COMPILED, the __BUN/.bun section header, has a non-zero size in those and is
// readable before main by anything statically linked) or explicitly requested via env. Drives deterministic allocator hints, the fixed JIT
// pool address and (when a snapshot is actually built/used) the LLInt+DFG tier defaults — so a compiled app needs no environment for snapshots.

extern "C" char** environ;

#if OS(LINUX)
#include <elf.h>
// Linker/loader-owned data in our own snapshot (.got, .got.plt, .init_array, .fini_array): process-specific, never program state — keep this process's copy across the overlay.
static size_t platformLinkerOwnedRanges(uint64_t (*out)[2], size_t cap)
{
    size_t n = 0;
    int fd = open("/proc/self/exe", O_RDONLY);
    if (fd < 0) return 0;
    Elf64_Ehdr eh;
    if (::pread(fd, &eh, sizeof eh, 0) != (ssize_t)sizeof eh || !eh.e_shnum) {
        close(fd);
        return 0;
    }
    std::vector<Elf64_Shdr> sh(eh.e_shnum);
    ::pread(fd, sh.data(), eh.e_shnum * sizeof(Elf64_Shdr), eh.e_shoff);
    std::vector<char> names(sh[eh.e_shstrndx].sh_size);
    ::pread(fd, names.data(), names.size(), sh[eh.e_shstrndx].sh_offset);
    for (auto& sec : sh) {
        if (sec.sh_name >= names.size() || !sec.sh_addr) continue;
        const char* nm = names.data() + sec.sh_name;
        if (!strcmp(nm, ".got") || !strcmp(nm, ".got.plt") || !strcmp(nm, ".init_array") || !strcmp(nm, ".fini_array") || !strcmp(nm, ".preinit_array")) {
            if (n < cap) {
                out[n][0] = sec.sh_addr;
                out[n][1] = sec.sh_addr + sec.sh_size;
                n++;
            }
        }
    }
    close(fd);
    return n;
}
#else
extern "C" __attribute__((weak)) size_t mi_malloc_zone_process_owned_ranges(uintptr_t (*out)[2], size_t cap); // absent when mimalloc is built without the zone override
static size_t platformLinkerOwnedRanges(uint64_t (*out)[2], size_t cap) // Darwin: the malloc zone libsystem registered for this process (see alloc-override-zone.c)
{
    if (!mi_malloc_zone_process_owned_ranges) return 0;
    uintptr_t tmp[8][2];
    size_t n = mi_malloc_zone_process_owned_ranges(tmp, std::min<size_t>(cap, 8));
    for (size_t i = 0; i < n; i++) {
        out[i][0] = tmp[i][0];
        out[i][1] = tmp[i][1];
    }
    return n;
}
#endif
// ===== v0 snapshot experiment (macOS, no-ASLR, JIT off): dump all mimalloc/JSC memory + __DATA at idle; a fresh process maps it back and runs JS on the snapshot VM.

// ---- platform seam for the snapshot product path (region walk, residency, data segments, JIT copy) ----
struct PlatformRegion {
    uint64_t addr, size;
    bool writable, executable, anon, shared, isStack, isMallocZone, isGuard;
    int tag;
    unsigned pagesResident, pagesDirtied, pagesSwapped;
};
#if OS(DARWIN)
template<typename F> static void platformEnumerateRegions(F&& f)
{
    mach_vm_address_t addr = 0;
    for (;;) {
        mach_vm_size_t size = 0;
        vm_region_extended_info_data_t info;
        mach_msg_type_number_t count = VM_REGION_EXTENDED_INFO_COUNT;
        mach_port_t objName;
        if (mach_vm_region(mach_task_self(), &addr, &size, VM_REGION_EXTENDED_INFO, (vm_region_info_t)&info, &count, &objName) != KERN_SUCCESS) break;
        int tag = info.user_tag;
        PlatformRegion r { addr, size, !!(info.protection & VM_PROT_WRITE), !!(info.protection & VM_PROT_EXECUTE), info.external_pager == 0, info.share_mode == SM_SHARED,
            tag == VM_MEMORY_STACK, tag >= VM_MEMORY_MALLOC && tag <= VM_MEMORY_MALLOC_NANO, tag == VM_MEMORY_GUARD || tag == 22, tag, info.pages_resident, info.pages_dirtied, info.pages_swapped_out };
        f(r);
        addr += size;
    }
}
static bool platformResidentPages(uint64_t addr, uint64_t size, std::vector<int>& disp)
{
    size_t pg = getpagesize();
    disp.assign(size / pg, 0);
    mach_vm_size_t dispCount = disp.size();
    return mach_vm_page_range_query(mach_task_self(), addr, size, (mach_vm_address_t)disp.data(), &dispCount) == KERN_SUCCESS;
}
template<typename F> static void platformDataSegments(F&& f)
{
    const struct mach_header_64* mh = (const struct mach_header_64*)_dyld_get_image_header(0);
    for (const char* seg : { "__DATA_CONST", "__DATA", "__DATA_DIRTY", "__AUTH", "__AUTH_CONST" }) {
        unsigned long segSize = 0;
        uint8_t* segData = getsegmentdata(mh, seg, &segSize);
        if (segData && segSize) f((uint64_t)segData, (uint64_t)segSize);
    }
}
static void platformWriteJIT(void* dst, const void* src, size_t len)
{
    pthread_jit_write_protect_np(0);
    memcpy(dst, src, len);
    pthread_jit_write_protect_np(1);
    sys_icache_invalidate(dst, len);
}
static bool platformIsJITRegion(const PlatformRegion& r) { return r.tag == 64 && r.executable && r.anon; }
static uint64_t platformTextBase() { return (uint64_t)&_mh_execute_header; }
extern "C" const void* _dyld_get_shared_cache_range(size_t* length);
extern "C" bool _dyld_get_shared_cache_uuid(uuid_t uuid);
// System libraries' load address: snapshot words that point into them (ICU vtables, pthread main-thread handle, ...) are only valid while this matches.
static uint64_t platformLibsBase()
{
    size_t len = 0;
    return (uint64_t)_dyld_get_shared_cache_range(&len);
}
static uint64_t platformSystemLibsId()
{
    uuid_t u;
    if (!_dyld_get_shared_cache_uuid(u)) return 0;
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < sizeof u; i++) {
        h ^= u[i];
        h *= 1099511628211ull;
    }
    return h ? h : 1;
} // identity of the OS's dyld shared cache: same across reboots (it only slides), different after an OS update
// Identity of this exact executable (a snapshot is only valid for the binary that produced it): LC_UUID folded to 64 bits.
static uint64_t platformBuildId()
{
    const struct mach_header_64* mh = &_mh_execute_header;
    const uint8_t* p = (const uint8_t*)(mh + 1);
    for (uint32_t i = 0; i < mh->ncmds; i++) {
        const struct load_command* lc = (const struct load_command*)p;
        if (lc->cmd == LC_UUID) {
            uint64_t a, b;
            memcpy(&a, ((const struct uuid_command*)lc)->uuid, 8);
            memcpy(&b, ((const struct uuid_command*)lc)->uuid + 8, 8);
            return a ^ b;
        }
        p += lc->cmdsize;
    }
    return 0;
}
#elif OS(LINUX)
extern "C" char __executable_start[];
extern "C" char __data_start[], _edata[], __bss_start[], _end[];
template<typename F> static void platformEnumerateRegions(F&& f)
{
    FILE* maps = fopen("/proc/self/maps", "r");
    if (!maps) return;
    char line[512];
    while (fgets(line, sizeof line, maps)) {
        unsigned long lo, hi, off, inode = 0;
        char perms[8] = "", dev[16] = "";
        char path[256] = "";
        if (sscanf(line, "%lx-%lx %7s %lx %15s %lu %255s", &lo, &hi, perms, &off, dev, &inode, path) < 6) continue;
        bool anon = inode == 0 && (path[0] == 0 || path[0] == '[');
        PlatformRegion r { lo, hi - lo, perms[1] == 'w', perms[2] == 'x', anon, perms[3] == 's', !strncmp(path, "[stack", 6), false, perms[0] == '-' && perms[1] == '-', 0, 1, 1, 0 };
        // Linux has no VM tags: callers identify "ours" by address windows; JIT by the fixed pool address.
        f(r);
    }
    fclose(maps);
}
static bool platformResidentPages(uint64_t addr, uint64_t size, std::vector<int>& disp)
{
    size_t pg = getpagesize();
    std::vector<unsigned char> vec(size / pg);
    disp.assign(size / pg, 0);
    if (mincore((void*)addr, size, vec.data())) return false;
    for (size_t i = 0; i < vec.size(); i++)
        disp[i] = vec[i] & 1;
    return true;
}
template<typename F> static void platformDataSegments(F&& f)
{
    size_t pg = getpagesize();
    uint64_t lo = (uint64_t)__data_start & ~(pg - 1), hi = ((uint64_t)_end + pg - 1) & ~(pg - 1);
    f(lo, hi - lo); // .data + .bss (relro/.got would need dl_iterate_phdr; the writable PT_LOAD covers what we mutate)
}
static void platformWriteJIT(void* dst, const void* src, size_t len)
{
    memcpy(dst, src, len);
    __builtin___clear_cache((char*)dst, (char*)dst + len);
}
static bool platformIsJITRegion(const PlatformRegion& r) { return r.executable && r.anon && r.addr >= 0x3c0000000ull && r.addr < 0x400000000ull; } // BUN_SNAPSHOT_JIT_ADDR window
static uint64_t platformTextBase() { return (uint64_t)__executable_start; }
static uint64_t platformLibsBase() { return (uint64_t)dlsym(RTLD_DEFAULT, "getpid"); } // libc's slide stands in for all system libs
static uint64_t platformSystemLibsId() { return 0; } // Linux: per-library name+size matching in the fixup table is the identity
extern "C" char __etext[] __attribute__((weak));
extern "C" char etext[];
static uint64_t platformBuildId() // the ELF NT_GNU_BUILD_ID note (identity of this exact link), folded to 64 bits; falls back to the text extent
{
    struct Ctx {
        uint64_t id;
    } ctx { 0 };
    dl_iterate_phdr([](struct dl_phdr_info* info, size_t, void* arg) -> int {
        if (info->dlpi_name && *info->dlpi_name) return 0; // main executable only
        for (int i = 0; i < info->dlpi_phnum; i++) {
            const ElfW(Phdr) & ph = info->dlpi_phdr[i];
            if (ph.p_type != PT_NOTE) continue;
            const uint8_t* p = (const uint8_t*)(info->dlpi_addr + ph.p_vaddr);
            const uint8_t* end = p + ph.p_memsz;
            while (p + sizeof(ElfW(Nhdr)) <= end) {
                const ElfW(Nhdr)* nh = (const ElfW(Nhdr)*)p;
                const uint8_t* name = p + sizeof *nh;
                const uint8_t* desc = name + ((nh->n_namesz + 3) & ~3u);
                if (nh->n_type == NT_GNU_BUILD_ID && nh->n_namesz == 4 && !memcmp(name, "GNU", 4) && desc + nh->n_descsz <= end) {
                    uint64_t h = 1469598103934665603ull;
                    for (uint32_t k = 0; k < nh->n_descsz; k++) {
                        h ^= desc[k];
                        h *= 1099511628211ull;
                    }
                    ((Ctx*)arg)->id = h;
                    return 1;
                }
                p = desc + ((nh->n_descsz + 3) & ~3u);
            }
        }
        return 0;
    },
        &ctx);
    return ctx.id ? ctx.id : (uint64_t)((char*)etext - (char*)__executable_start);
}
#endif

// Loaded system libraries as (base, end, nameHash): snapshot words pointing into them are recorded at dump and rebased at restore.
struct PlatformLib {
    uint64_t base, end, nameHash;
    uint64_t flags;
    char path[232];
    char seg[16];
}; // flags bit 0: lives in the dyld shared cache (slides with it as a unit; needs no dlopen to know where it went) // path: what to dlopen when the restoring process has not loaded the library yet (apps dlopen e.g. libsqlite3 lazily); matching uses nameHash + size
static void platformLibSetName(PlatformLib& l, const char* path, const char* seg)
{
    snprintf(l.path, sizeof l.path, "%s", path ? path : "");
    snprintf(l.seg, sizeof l.seg, "%s", seg ? seg : "");
}
static uint64_t fnv1a(const char* p)
{
    uint64_t h = 1469598103934665603ull;
    for (; *p; p++) {
        h ^= (uint8_t)*p;
        h *= 1099511628211ull;
    }
    return h;
}
#if OS(LINUX)
static std::vector<PlatformLib> platformSystemLibs()
{
    std::vector<PlatformLib> libs;
    dl_iterate_phdr([](struct dl_phdr_info* info, size_t, void* arg) -> int {
        auto* libs = static_cast<std::vector<PlatformLib>*>(arg);
        const char* name = info->dlpi_name;
        if (!name || !*name) return 0; // main executable: fixed (non-PIE)
        uint64_t lo = UINT64_MAX, hi = 0;
        for (int i = 0; i < info->dlpi_phnum; i++)
            if (info->dlpi_phdr[i].p_type == PT_LOAD) {
                uint64_t a = info->dlpi_addr + info->dlpi_phdr[i].p_vaddr;
                lo = std::min(lo, a);
                hi = std::max(hi, a + info->dlpi_phdr[i].p_memsz);
            }
        if (hi > lo) {
            const char* slash = strrchr(name, '/');
            const char* bn = slash ? slash + 1 : name;
            PlatformLib l { lo, hi, fnv1a(bn), 0, {}, {} };
            platformLibSetName(l, name, nullptr);
            libs->push_back(l);
        }
        return 0;
    },
        &libs);
    return libs;
}
#else
static std::vector<PlatformLib> platformSystemLibs() // Darwin: every segment of every loaded dylib (they all live in the dyld shared cache, which slides as a unit per boot; per-segment ranges keep the pointer scan tight)
{
    std::vector<PlatformLib> libs;
    for (uint32_t i = 0, n = _dyld_image_count(); i < n; i++) {
        const struct mach_header_64* mh = (const struct mach_header_64*)_dyld_get_image_header(i);
        if (!mh || mh == &_mh_execute_header) continue;
        intptr_t slide = _dyld_get_image_vmaddr_slide(i);
        const char* name = _dyld_get_image_name(i);
        const char* slash = name ? strrchr(name, '/') : nullptr;
        uint64_t nameHash = fnv1a(slash ? slash + 1 : (name ? name : "?"));
        bool inCache = (mh->flags & MH_DYLIB_IN_CACHE) != 0;
        const uint8_t* lc = (const uint8_t*)(mh + 1);
        for (uint32_t j = 0; j < mh->ncmds; j++) {
            const struct load_command* c = (const struct load_command*)lc;
            if (c->cmd == LC_SEGMENT_64) {
                const struct segment_command_64* sc = (const struct segment_command_64*)c;
                if (sc->vmsize && strcmp(sc->segname, "__PAGEZERO")) {
                    uint64_t base = sc->vmaddr + (uint64_t)slide, end = base + sc->vmsize;
                    bool dup = false;
                    for (auto& l : libs)
                        if (l.base == base && l.end == end) {
                            dup = true;
                            break;
                        }
                    if (!dup) {
                        PlatformLib l { base, end, nameHash ^ fnv1a(sc->segname), inCache ? 1ull : 0ull, {}, {} };
                        platformLibSetName(l, name, sc->segname);
                        libs.push_back(l);
                    }
                }
            }
            lc += c->cmdsize;
        }
    }
    return libs;
}
#endif
struct SnapshotFixup {
    uint64_t addr;
    uint64_t lib;
};
struct SnapshotFixupHeader {
    char magic[8];
    uint64_t nlibs;
    uint64_t nfixups;
}; // then PlatformLib[nlibs] (base/end/nameHash as recorded), SnapshotFixup[nfixups]

// CPU feature word for the snapshot header: a snapshot may hold state that latched CPU-dependent code paths (SIMD dispatch tables in vendored
// libraries), so it is only used on a CPU that has at least the features of the machine that built it.
static uint64_t platformCpuFeatures()
{
    uint64_t f = 0;
#if CPU(X86_64)
    unsigned a, b, c, d;
    auto cpuid = [&](unsigned leaf, unsigned sub) { __asm__ volatile("cpuid" : "=a"(a), "=b"(b), "=c"(c), "=d"(d) : "a"(leaf), "c"(sub)); };
    cpuid(1, 0);
    f |= (uint64_t)(c & ((1u << 0) | (1u << 9) | (1u << 19) | (1u << 20) | (1u << 23) | (1u << 25) | (1u << 28))); // sse3 ssse3 sse4.1 sse4.2 popcnt aes avx
    cpuid(7, 0);
    f |= (uint64_t)(b & ((1u << 3) | (1u << 5) | (1u << 8) | (1u << 16) | (1u << 17) | (1u << 30) | (1u << 31))) << 32; // bmi1 avx2 bmi2 avx512f avx512dq avx512bw avx512vl
    f |= 1ull << 63; // "x86-64" tag
#elif CPU(ARM64)
#if OS(DARWIN)
    const char* keys[] = { "hw.optional.arm.FEAT_AES", "hw.optional.arm.FEAT_SHA256", "hw.optional.arm.FEAT_CRC32", "hw.optional.arm.FEAT_LSE", "hw.optional.arm.FEAT_DotProd", "hw.optional.arm.FEAT_SHA3", "hw.optional.arm.FEAT_I8MM", "hw.optional.arm.FEAT_BF16", "hw.optional.arm.FEAT_SME", "hw.optional.arm.FEAT_SVE" };
    for (unsigned i = 0; i < sizeof keys / sizeof *keys; i++) {
        int v = 0;
        size_t n = sizeof v;
        if (!sysctlbyname(keys[i], &v, &n, nullptr, 0) && v) f |= 1ull << i;
    }
#elif OS(LINUX)
    f = getauxval(AT_HWCAP) & 0xffffffffull;
    f |= (getauxval(AT_HWCAP2) & 0x7fffffffull) << 32;
#endif
    f |= 1ull << 62; // "arm64" tag
#endif
    return f;
}

// Invocation shape recorded in the snapshot: a snapshot is only valid for the argv it was built with (a compiled CLI's
// subcommands / fast paths must boot normally, or a restored REPL would answer `exe some-subcommand`).
static uint64_t snapshotArgvKey()
{
    uint64_t h = 1469598103934665603ull;
    int argc = 0;
    char** argv = nullptr;
#if OS(DARWIN)
    argc = *_NSGetArgc();
    argv = *_NSGetArgv();
#elif OS(LINUX)
    static std::vector<std::string> args;
    static std::vector<char*> ptrs;
    if (ptrs.empty()) {
        FILE* f = fopen("/proc/self/cmdline", "r");
        std::string cur;
        int c;
        while (f && (c = fgetc(f)) != EOF) {
            if (!c) {
                args.push_back(cur);
                cur.clear();
            } else
                cur.push_back((char)c);
        }
        if (f) fclose(f);
        for (auto& a : args)
            ptrs.push_back(a.data());
    }
    argc = (int)ptrs.size();
    argv = ptrs.data();
#endif
    for (int i = 1; i < argc; i++) {
        for (const char* p = argv[i]; *p; p++) {
            h ^= (uint8_t)*p;
            h *= 1099511628211ull;
        }
        h ^= 0xff;
        h *= 1099511628211ull;
    }
    return h ^ ((uint64_t)(argc > 0 ? argc - 1 : 0) << 56) ^ 0x5a5a; // never 0
}

struct SnapshotHeader {
    char magic[8];
    uint64_t textBase;
    uint64_t vm;
    uint64_t globalObject;
    uint64_t mainThread;
    uint64_t nregions;
    uint64_t reserved[8];
    uint64_t libsBase;
    uint64_t spare[7];
}; // 176 bytes; region table follows
struct SnapshotRegion {
    uint64_t addr;
    uint64_t len;
    uint64_t fileOff;
    uint64_t kind;
}; // kind: 0 heap(anon), 1 __DATA segment

// First-writer trap: snapshot pages are made read-only; the fault handler records the writer's stack, unprotects the page and resumes.
struct TrapRec {
    uintptr_t page;
    uintptr_t pcs[10];
};
static TrapRec* s_trapRecs = nullptr;
static std::atomic<size_t> s_trapCount { 0 };
static size_t s_trapCap = 0;
static struct sigaction s_prevBus, s_prevSegv;

static struct termios s_snapshotTermios;
static int s_snapshotTermiosFd = -1; // lives in __DATA, so it travels inside the snapshot
static uint64_t s_snapshotOpenFds[16]; // fds 0..1023 open in the build process: the restored process parks /dev/null on them so stale closes are harmless and new fds never alias them
// <img>.zst next to the snapshot: what ships. Restoring inflates it once into a per-user cache (see findSiblingSnapshot).
static void snapshotWriteZstd(const char* path)
{
    int in = open(path, O_RDONLY);
    if (in < 0) return;
    struct stat st;
    if (fstat(in, &st)) {
        close(in);
        return;
    }
    void* src = mmap(nullptr, st.st_size, PROT_READ, MAP_PRIVATE, in, 0);
    close(in);
    if (src == MAP_FAILED) return;
    size_t cap = ZSTD_compressBound(st.st_size);
    void* dst = mmap(nullptr, cap, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
    size_t n = ZSTD_compress(dst, cap, src, st.st_size, 3);
    munmap(src, st.st_size);
    if (!ZSTD_isError(n)) {
        char zpath[1100];
        snprintf(zpath, sizeof zpath, "%s.zst", path);
        int out = open(zpath, O_WRONLY | O_CREAT | O_TRUNC, 0644);
        if (out >= 0) {
            if (write(out, dst, n) == (ssize_t)n) fprintf(stderr, "[snapshot] wrote %s (%.1fMB)\n", zpath, n / 1048576.0);
            close(out);
        }
    }
    munmap(dst, cap);
}
static bool snapshotInflateZstdBuffer(const void* src, size_t srcLen, const char* outPath) // atomically (tmp + rename) so concurrent launches never observe a partial snapshot
{
    unsigned long long full = ZSTD_getFrameContentSize(src, srcLen);
    if (full == ZSTD_CONTENTSIZE_ERROR || full == ZSTD_CONTENTSIZE_UNKNOWN) return false;
    char tmp[1100];
    snprintf(tmp, sizeof tmp, "%s.tmp.%d", outPath, getpid());
    int out = open(tmp, O_RDWR | O_CREAT | O_TRUNC, 0600);
    if (out < 0) return false;
    bool ok = false;
    if (!ftruncate(out, full)) {
        void* dst = mmap(nullptr, full, PROT_READ | PROT_WRITE, MAP_SHARED, out, 0);
        if (dst != MAP_FAILED) {
            size_t n = ZSTD_decompress(dst, full, src, srcLen);
            ok = !ZSTD_isError(n) && n == full;
            munmap(dst, full);
        }
    }
    close(out);
    if (ok)
        ok = !rename(tmp, outPath);
    else
        unlink(tmp);
    return ok;
}
static bool snapshotInflateZstd(const char* zpath, const char* outPath)
{
    int in = open(zpath, O_RDONLY);
    if (in < 0) return false;
    struct stat st;
    if (fstat(in, &st)) {
        close(in);
        return false;
    }
    void* src = mmap(nullptr, st.st_size, PROT_READ, MAP_PRIVATE, in, 0);
    close(in);
    if (src == MAP_FAILED) return false;
    bool ok = snapshotInflateZstdBuffer(src, st.st_size, outPath);
    munmap(src, st.st_size);
    return ok;
}
struct SnapshotFileFd {
    int fd;
    int flags;
    char path[1000];
};
static SnapshotFileFd s_snapshotFileFds[32];
static int s_snapshotFileFdCount = 0; // writable regular files (logs) get reopened O_APPEND at the same fd number
static void snapshotDump(JSC::VM& vm, const char* path)
{
#if OS(DARWIN) || OS(LINUX)
    JSC::JSLockHolder lock(vm);
    {
        Vector<String> gated;
        for (size_t start = 0; start < s_envGateNames.size();) {
            size_t end = s_envGateNames.find('\0', start);
            if (end == std::string::npos)
                end = s_envGateNames.size();
            gated.append(String::fromUTF8(std::span { s_envGateNames.data() + start, end - start }));
            start = end + 1;
        }
        Bun::printEnvReadsBeforeSnapshot(defaultGlobalObject(), gated);
    }
    s_snapshotTermiosFd = -1;
    for (int fd = 0; fd < 3; fd++)
        if (isatty(fd) && !tcgetattr(fd, &s_snapshotTermios)) {
            s_snapshotTermiosFd = fd;
            break;
        }
    memset(s_snapshotOpenFds, 0, sizeof s_snapshotOpenFds);
    s_snapshotFileFdCount = 0;
    for (int fd = 3; fd < 1024; fd++) {
        if (fcntl(fd, F_GETFD) == -1) continue;
        s_snapshotOpenFds[fd / 64] |= 1ull << (fd % 64);
        struct stat st;
        if (s_snapshotFileFdCount < 32 && !fstat(fd, &st) && S_ISREG(st.st_mode)) {
            SnapshotFileFd& f = s_snapshotFileFds[s_snapshotFileFdCount];
            f.fd = fd;
            f.flags = fcntl(fd, F_GETFL);
#if OS(DARWIN)
            if ((f.flags & O_ACCMODE) != O_RDONLY && fcntl(fd, F_GETPATH, f.path) != -1) s_snapshotFileFdCount++;
#else
            {
                char lnk[64];
                snprintf(lnk, sizeof lnk, "/proc/self/fd/%d", fd);
                ssize_t n = readlink(lnk, f.path, sizeof f.path - 1);
                if ((f.flags & O_ACCMODE) != O_RDONLY && n > 0) {
                    f.path[n] = 0;
                    s_snapshotFileFdCount++;
                }
            }
#endif
        }
    }
    size_t settledStrings = 0;
    { // Error objects keep raw StackFrames (CodeBlock pointers) until .stack is first read; resolve them now so nothing in the snapshot points at code we drop or re-link
        JSC::HeapIterationScope scope(vm.heap);
        vm.heap.objectSpace().forEachLiveCell(scope, [&](JSC::HeapCell* heapCell, JSC::HeapCell::Kind kind) {
            if (isJSCellKind(kind)) {
                JSC::JSCell* cell = static_cast<JSC::JSCell*>(heapCell);
                if (auto* error = dynamicDowncast<JSC::ErrorInstance>(cell)) error->materializeErrorInfoIfNeeded(vm);
                // Lazy one-time StringImpl header writes (hash, did-report-cost) would otherwise dirty snapshot pages the first time a string is used after restore.
                if (auto* str = dynamicDowncast<JSC::JSString>(cell)) {
                    if (!str->isRope())
                        if (auto* impl = str->tryGetValueImpl()) {
                            impl->settleLazyHeaderWritesForSnapshot();
                            settledStrings++;
                        }
                }
            }
            return IterationStatus::Continue;
        });
    }
    if (auto* table = vm.atomStringTable())
        for (auto& packed : table->table())
            if (auto* impl = packed.get()) {
                impl->settleLazyHeaderWritesForSnapshot();
                settledStrings++;
            }
    if (getenv("BUN_SNAPSHOT_VERBOSE")) fprintf(stderr, "[snapshot] settled %zu StringImpl headers\n", settledStrings);
    { // linked CodeBlocks, metadata (value profiles/ICs), UnlinkedCodeBlocks and JIT code are per-run hot state: measured 11-17MB cheaper to re-create them fresh than to dirty them in the snapshot
        const char* dc = getenv("BUN_SNAPSHOT_DELETE_CODE"); // =0 keep all, =linked keep unlinked; default: drop everything
        vm.completeAllJITPlansBeforeSnapshotSnapshot(); // drain in-flight DFG/FTL plans first: nothing compiles or installs code while we walk/delete/freeze (results are discarded below anyway)
        JSC::sanitizeStackForVM(vm);
        if (dc && !strcmp(dc, "0")) {
        } else if (dc && !strcmp(dc, "linked"))
            vm.deleteAllLinkedCode(JSC::DeleteAllCodeIfNotCollecting);
        else
            vm.deleteAllCode(JSC::DeleteAllCodeIfNotCollecting);
    }
    vm.heap.freezeCurrentHeapAsImmortalSnapshot(); // GC never writes snapshot blocks again (frozen marks = liveness, side remembered set)
    mi_option_set(mi_option_purge_delay, 0);
    mi_collect(true); // free spans get decommitted so "resident" below means "snapshot payload"
    size_t pg = getpagesize();
    snapshotToolingIndexAtFreeze(vm, pg);
    std::vector<std::pair<uintptr_t, uintptr_t>> freeRanges; // arena slices in no page: free memory, whatever the kernel says about residency
    mi_arenas_visit_free_ranges(mi_heap_main(), [](void* start, size_t size, void* arg) { static_cast<std::vector<std::pair<uintptr_t, uintptr_t>>*>(arg)->push_back({ (uintptr_t)start, (uintptr_t)start + size }); }, &freeRanges);
    std::sort(freeRanges.begin(), freeRanges.end());
    if (getenv("BUN_SNAPSHOT_VERBOSE")) {
        size_t fb = 0;
        for (auto& r : freeRanges)
            fb += r.second - r.first;
        fprintf(stderr, "[snapshot] arena free ranges: %zu, %.1fMB\n", freeRanges.size(), fb / 1048576.0);
    }
    auto inFreeRange = [&](uintptr_t a) { auto it = std::upper_bound(freeRanges.begin(), freeRanges.end(), std::make_pair(a, UINTPTR_MAX)); return it != freeRanges.begin() && a < std::prev(it)->second; };
    std::vector<SnapshotRegion> regions;
    // 1. anonymous writable regions we own (mimalloc arenas + page map, JSC/WTF OS allocations in the hint windows) + the JIT pool
    platformEnumerateRegions([&](const PlatformRegion& r) {
        uint64_t addr = r.addr, size = r.size;
        int tag = r.tag;
        // Only memory we own and place deterministically. Kernel-placed libSystem regions belong to the *new* process and must not be overlaid.
        bool ours = tag == 240 || tag == 63 || tag == 65 || (addr >= 0x1f000000000ull && addr < 0x30000000000ull) || (addr >= 0x2e0000000000ull && addr < 0x2f0000000000ull);
        if (platformIsJITRegion(r)) {
            regions.push_back({ addr, size, 0, ((uint64_t)tag << 8) | 3 }); // reservation, no data
            std::vector<int> disp;
            if (platformResidentPages(addr, size, disp)) {
                { // freed JIT pages are MADV_FREE'd and may still read as present; keep only pages the executable allocator has handed out
                    Locker locker { JSC::ExecutableAllocator::singleton().getLock() };
                    for (size_t i = 0; i < disp.size(); i++)
                        if (disp[i] && !JSC::ExecutableAllocator::singleton().isValidExecutableMemory(locker, (void*)(addr + i * pg)) && !JSC::ExecutableAllocator::singleton().isValidExecutableMemory(locker, (void*)(addr + i * pg + pg / 2))) disp[i] = 0;
                }
                for (size_t i = 0; i < disp.size();) {
                    if (!disp[i]) {
                        i++;
                        continue;
                    }
                    size_t j = i;
                    while (j < disp.size() && disp[j])
                        j++;
                    regions.push_back({ addr + i * pg, (j - i) * pg, 0, ((uint64_t)tag << 8) | 2 });
                    i = j;
                }
            }
            if (getenv("BUN_SNAPSHOT_VERBOSE")) fprintf(stderr, "[snapshot] JIT region %llx+%llx resident=%u dirty=%u\n", (unsigned long long)addr, (unsigned long long)size, r.pagesResident, r.pagesDirtied);
        } else if (ours && r.writable && !r.executable && r.anon && !r.isStack && !r.isMallocZone && !r.isGuard && !r.shared && (r.pagesResident > 0 || r.pagesDirtied > 0 || r.pagesSwapped > 0)) {
            regions.push_back({ addr, size, 0, ((uint64_t)tag << 8) | 4 }); // anonymous reserve, then resident runs as file-backed data
            std::vector<int> disp;
            if (platformResidentPages(addr, size, disp)) {
                auto live = [&](size_t k) { return disp[k] && !inFreeRange(addr + k * pg); }; // purged spans can still read as present; mimalloc knows they are free
                for (size_t i = 0; i < disp.size();) {
                    if (!live(i)) {
                        i++;
                        continue;
                    }
                    size_t j = i;
                    while (j < disp.size() && live(j))
                        j++;
                    regions.push_back({ addr + i * pg, (j - i) * pg, 0, (uint64_t)tag << 8 });
                    i = j;
                }
            } else
                regions.back().kind = (uint64_t)tag << 8;
            if (getenv("BUN_SNAPSHOT_VERBOSE")) fprintf(stderr, "[snapshot] region %llx+%llx tag=%d resident=%u dirty=%u\n", (unsigned long long)addr, (unsigned long long)size, tag, r.pagesResident, r.pagesDirtied);
        }
    });
    // 2. main binary data segments (globals of Bun/JSC/WTF/mimalloc)
    platformDataSegments([&](uint64_t a, uint64_t len) { regions.push_back({ a, (len + pg - 1) & ~(uint64_t)(pg - 1), 0, 1 }); });
    // drop anon regions overlapping __DATA entries (region scan sees them as file-backed anyway) and our own stack
    uintptr_t sp = (uintptr_t)__builtin_frame_address(0);
    std::vector<SnapshotRegion> out;
    for (auto& r : regions) {
        if (r.kind == 0 && sp >= r.addr && sp < r.addr + r.len) continue;
        out.push_back(r);
    }
    int fd = open(path, O_RDWR | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) {
        fprintf(stderr, "[snapshot] open %s failed\n", path);
        return;
    }
    SnapshotHeader hdr {};
    memcpy(hdr.magic, "BUNIMG2", 8);
    hdr.textBase = platformTextBase();
    hdr.libsBase = platformLibsBase();
    hdr.spare[0] = platformBuildId();
    hdr.spare[2] = platformCpuFeatures();
    hdr.spare[3] = snapshotArgvKey();
    hdr.spare[4] = platformSystemLibsId();
    hdr.vm = (uint64_t)&vm;
    hdr.globalObject = (uint64_t)defaultGlobalObject();
    hdr.mainThread = (uint64_t)&WTF::Thread::currentSingleton();
    hdr.reserved[0] = (uint64_t)mi_theap_get_default(); // main thread's mimalloc theap (TLS-referenced, lives in the heap)
    hdr.reserved[7] = (uint64_t)uws_get_loop(); // main thread's uWS loop (TLS-referenced)
    {
        pthread_key_t k = 0;
        if (!pthread_key_create(&k, nullptr)) {
            hdr.reserved[1] = (uint64_t)k;
            pthread_key_delete(k);
        }
    } // high-water mark of pthread TLS keys
    { // fds that are the controlling TTY (dup'd stdin/stdout readers): the restoring process recreates them from its own 0/1/2
        struct stat st[3];
        bool have[3];
        for (int i = 0; i < 3; i++)
            have[i] = !fstat(i, &st[i]) && S_ISCHR(st[i].st_mode);
        int n = 0;
        for (int fd = 3; fd < 256 && n < 5; fd++) {
            struct stat fs;
            if (fstat(fd, &fs) || !S_ISCHR(fs.st_mode)) continue;
            int fl = fcntl(fd, F_GETFL);
            int src = -1;
            for (int i = 0; i < 3; i++)
                if (have[i] && fs.st_rdev == st[i].st_rdev) {
                    src = ((fl & O_ACCMODE) == O_RDONLY) ? 0 : (i == 0 ? 1 : i);
                    break;
                }
            if (src < 0) continue;
            hdr.reserved[2 + n++] = ((uint64_t)fd << 16) | ((uint64_t)(fl & 0xffff) << 4) | (uint64_t)(src + 1);
            if (getenv("BUN_SNAPSHOT_VERBOSE")) fprintf(stderr, "[snapshot] tty fd %d (flags %x) <- std%d\n", fd, fl, src);
        }
    }
    hdr.nregions = out.size();
    size_t tableOff = sizeof(SnapshotHeader);
    size_t dataOff = (tableOff + out.size() * sizeof(SnapshotRegion) + pg - 1) & ~(pg - 1);
    size_t fileOff = dataOff, total = 0;
    for (auto& r : out) {
        size_t used = ((r.kind & 0xff) == 3 || (r.kind & 0xff) == 4) ? 0 : r.len;
        r.fileOff = fileOff;
        fileOff += used;
    }
    mi_arenas_freeze_pages(); // from here on nothing frees into a page that is going into the snapshot (this process's remaining frees are dropped too)
    { // extern-library fixups: words in the snapshot that point into a loaded system library get rebased at restore (lets libraries slide)
        std::vector<PlatformLib> libs = platformSystemLibs();
        std::vector<SnapshotFixup> fixups;
        if (!libs.empty()) {
            uint64_t minB = UINT64_MAX, maxE = 0;
            for (auto& l : libs) {
                minB = std::min(minB, l.base);
                maxE = std::max(maxE, l.end);
            }
            for (auto& r : out) {
                unsigned k = r.kind & 0xff;
                if (k == 2 || k == 3 || k == 4) continue;
                const uint64_t* w = (const uint64_t*)r.addr;
                size_t n = r.len / 8;
                for (size_t i = 0; i < n; i++) {
                    uint64_t v = w[i];
                    if (v < minB || v >= maxE) continue;
                    for (size_t li = 0; li < libs.size(); li++)
                        if (v >= libs[li].base && v < libs[li].end) {
                            fixups.push_back({ r.addr + i * 8, li });
                            break;
                        }
                }
            }
        }
        { // Keep only the segments something actually points into (a process has ~1.7K loaded segments; a snapshot references a few dozen).
            std::vector<uint64_t> newIndex(libs.size(), UINT64_MAX);
            std::vector<PlatformLib> used;
            for (auto& f : fixups) {
                if (newIndex[f.lib] == UINT64_MAX) {
                    newIndex[f.lib] = used.size();
                    used.push_back(libs[f.lib]);
                }
                f.lib = newIndex[f.lib];
            }
            libs.swap(used);
        }
        SnapshotFixupHeader fh {};
        memcpy(fh.magic, "BUNFIX3", 8);
        fh.nlibs = libs.size();
        fh.nfixups = fixups.size();
        size_t fixOff = (fileOff + 4095) & ~4095ull;
        hdr.spare[1] = fixOff;
        pwrite(fd, &fh, sizeof fh, fixOff);
        pwrite(fd, libs.data(), libs.size() * sizeof(PlatformLib), fixOff + sizeof fh);
        pwrite(fd, fixups.data(), fixups.size() * sizeof(SnapshotFixup), fixOff + sizeof fh + libs.size() * sizeof(PlatformLib));
        if (getenv("BUN_SNAPSHOT_VERBOSE") || !fixups.empty()) {
            size_t pages = 0;
            uint64_t last = ~0ull;
            for (auto& f : fixups) {
                uint64_t pg = f.addr >> 14;
                if (pg != last) {
                    pages++;
                    last = pg;
                }
            }
            fprintf(stderr, "[snapshot] %zu extern-library fixups across %zu library segments, touching %zu 16K pages (%.1f MB dirtied at restore if libraries slid)\n", fixups.size(), libs.size(), pages, pages * 16384.0 / 1048576.0);
        }
    }
    for (auto& r : out) {
        // write region contents; non-resident anon pages read as zero which is what a fresh mapping would give anyway
        size_t used = ((r.kind & 0xff) == 3 || (r.kind & 0xff) == 4) ? 0 : r.len;
        if (pwrite(fd, (void*)r.addr, used, r.fileOff) != (ssize_t)used) {
            fprintf(stderr, "[snapshot] pwrite failed for %llx+%llx errno %d\n", r.addr, (unsigned long long)used, errno);
        }
        total += used;
    }
    if (!s_envGateNames.empty()) {
        struct stat cur;
        fstat(fd, &cur);
        size_t gateOff = ((size_t)cur.st_size + 4095) & ~4095ull;
        pwrite(fd, s_envGateNames.data(), s_envGateNames.size(), gateOff);
        hdr.spare[5] = (uint64_t)gateOff | ((uint64_t)s_envGateNames.size() << 40);
        hdr.spare[6] = envGateHash(s_envGateNames.data(), s_envGateNames.size());
    }
    pwrite(fd, &hdr, sizeof hdr, 0);
    pwrite(fd, out.data(), out.size() * sizeof(SnapshotRegion), tableOff);
    close(fd);
    snapshotWriteZstd(path);
    fprintf(stderr, "[snapshot] wrote %s: %zu regions, %.1fMB (vm=%p global=%p thread=%p text=%p)\n", path, out.size(), total / 1048576.0, (void*)hdr.vm, (void*)hdr.globalObject, (void*)hdr.mainThread, (void*)hdr.textBase);
#endif
}

// Restore: called from Bun__snapshotMaybeRestore (very early in main) when BUN_SNAPSHOT_IN is set. Never returns.
static void snapshotRestoreAndRun(const char* path)
{
#if OS(DARWIN) || OS(LINUX)
    char filePath[4200];
    snprintf(filePath, sizeof filePath, "%s", path);
    if (getenv("BUN_SNAPSHOT_VERBOSE")) {
        void* probe = malloc(64);
        if (snapshotVerbose()) fprintf(stderr, "[snapshot] pre-restore heap probe=%p (expected >= 0x21000000000, above where snapshot regions go)\n", probe);
        free(probe);
    }
    snapshotBaseOff = 0;
    if (char* at = strrchr(filePath, '@')) {
        char* end = nullptr;
        long long o = strtoll(at + 1, &end, 10);
        if (end && !*end && o > 0) {
            *at = 0;
            snapshotBaseOff = (off_t)o;
        }
    } // "<file>@<offset>": snapshot embedded in a bigger file (our own executable)
    int fd = open(filePath, O_RDONLY);
    if (fd < 0) {
        fprintf(stderr, "[snapshot] cannot open %s\n", path);
        _exit(2);
    }
    SnapshotHeader hdr;
    ipread(fd, &hdr, sizeof hdr, 0);
    if (getenv("BUN_SNAPSHOT_VERBOSE")) fprintf(stderr, "[snapshot] source %s base=%lld magic=%.7s nregions=%llu text=%llx libs=%llx build=%llx\n", filePath, (long long)snapshotBaseOff, hdr.magic, (unsigned long long)hdr.nregions, (unsigned long long)hdr.textBase, (unsigned long long)hdr.libsBase, (unsigned long long)hdr.spare[0]);
    if (memcmp(hdr.magic, "BUNIMG2", 8) || hdr.spare[0] != platformBuildId()) {
        if (snapshotVerbose()) fprintf(stderr, "[snapshot] %s was not produced by this build of the executable; booting normally\n", path);
        close(fd);
        return;
    }
    if (hdr.spare[5]) {
        size_t gateOff = hdr.spare[5] & ((1ull << 40) - 1), gateLen = hdr.spare[5] >> 40;
        char names[4096];
        if (gateLen == 0 || gateLen > sizeof names || ipread(fd, names, gateLen, gateOff) != (ssize_t)gateLen) {
            if (snapshotVerbose()) fprintf(stderr, "[snapshot] unreadable environment gate; booting normally\n");
            close(fd);
            return;
        }
        if (envGateHash(names, gateLen) != hdr.spare[6]) {
            if (getenv("BUN_SNAPSHOT_VERBOSE")) fprintf(stderr, "[snapshot] environment differs from the build in a gated variable; booting normally\n");
            close(fd);
            return;
        }
    }
    if (hdr.spare[3] && hdr.spare[3] != snapshotArgvKey() && !getenv("BUN_SNAPSHOT_IN")) {
        if (getenv("BUN_SNAPSHOT_VERBOSE")) fprintf(stderr, "[snapshot] argv differs from the build invocation; booting normally\n");
        close(fd);
        return;
    }
    {
        uint64_t need = hdr.spare[2], have = platformCpuFeatures();
        if (need && (have & need) != need) {
            if (snapshotVerbose()) fprintf(stderr, "[snapshot] %s was built on a CPU with features this one lacks (%llx vs %llx); booting normally\n", path, (unsigned long long)need, (unsigned long long)have);
            close(fd);
            return;
        }
    }
    if (hdr.textBase != platformTextBase()) {
        if (snapshotVerbose()) fprintf(stderr, "[snapshot] ASLR slide differs (snapshot text %llx vs ours %llx); booting normally\n", (unsigned long long)hdr.textBase, (unsigned long long)platformTextBase());
        close(fd);
        return;
    }
    if (false) {
        if (snapshotVerbose()) fprintf(stderr, "[snapshot] %s was produced by a different build of this executable; booting normally\n", path);
        close(fd);
        return;
    }
    // Extern-library fixup table. Storage is anonymous mmap, not heap: the allocator's memory is about to be overlaid by the snapshot.
    constexpr size_t kMaxPendingLibs = 64;
    const char* pendingLibs[kMaxPendingLibs];
    size_t nPendingLibs = 0;
    bool haveFixups = false;
    int64_t* libDelta = nullptr;
    size_t nLibDelta = 0;
    SnapshotFixup* fixups = nullptr;
    size_t nFixups = 0;
    if (hdr.spare[1]) {
        SnapshotFixupHeader fh;
        if (ipread(fd, &fh, sizeof fh, hdr.spare[1]) == (ssize_t)sizeof fh && !memcmp(fh.magic, "BUNFIX3", 8) && fh.nlibs < 4096 && fh.nfixups < (1u << 24)) {
            size_t bytes = (fh.nlibs * (sizeof(PlatformLib) + sizeof(int64_t)) + fh.nfixups * sizeof(SnapshotFixup) + 16383) & ~16383ull;
            uint8_t* buf = (uint8_t*)mmap(nullptr, bytes ? bytes : 16384, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
            PlatformLib* recorded = (PlatformLib*)buf;
            libDelta = (int64_t*)(recorded + fh.nlibs);
            fixups = (SnapshotFixup*)(libDelta + fh.nlibs);
            nLibDelta = fh.nlibs;
            nFixups = fh.nfixups;
            ipread(fd, recorded, fh.nlibs * sizeof(PlatformLib), hdr.spare[1] + sizeof fh);
            ipread(fd, fixups, fh.nfixups * sizeof(SnapshotFixup), hdr.spare[1] + sizeof fh + fh.nlibs * sizeof(PlatformLib));
            std::vector<PlatformLib> now = platformSystemLibs(); // heap use is fine up to here (before the overlay)
            // Libraries the builder loaded during its run (dlopen: CoreFoundation/CoreServices for fs.watch, libsqlite3, …) whose
            // initializers therefore never ran in this process. Their code is mapped either way (shared cache) and the snapshot's
            // pointers into them are rebased below, but they must be dlopen'd here too — after the overlay, in the same
            // position in process history the builder loaded them — so their per-process state (CF allocators, ObjC classes)
            // exists when snapshotted code calls into them. Paths are collected now (heap is still ours), opened after the overlay.
            for (size_t i = 0; i < fh.nlibs && nPendingLibs < kMaxPendingLibs; i++) {
                recorded[i].path[sizeof recorded[i].path - 1] = 0;
                if (!recorded[i].path[0]) continue;
                bool present = false;
                for (auto& l : now)
                    if (l.nameHash == recorded[i].nameHash) {
                        present = true;
                        break;
                    }
                if (present) continue;
                if (!(recorded[i].flags & 1)) { // not part of the shared cache: load it now so its segments have addresses to match against below (its initializers run here, before the overlay, exactly as they would have if it were linked)
                    bool used = false;
                    for (size_t k = 0; k < fh.nfixups; k++)
                        if (fixups[k].lib == i) {
                            used = true;
                            break;
                        }
                    if (used && dlopen(recorded[i].path, RTLD_NOW | RTLD_GLOBAL)) {
                        now = platformSystemLibs();
                    }
                    continue;
                }
                bool dup = false;
                for (size_t j = 0; j < nPendingLibs; j++)
                    if (!strcmp(pendingLibs[j], recorded[i].path)) {
                        dup = true;
                        break;
                    }
                if (!dup) pendingLibs[nPendingLibs++] = recorded[i].path; // points into `buf`, which stays mapped through the restore
            }
            haveFixups = true;
            for (size_t i = 0; i < fh.nlibs; i++) {
                libDelta[i] = 0;
                bool found = false;
                for (auto& l : now)
                    if (l.nameHash == recorded[i].nameHash && (l.end - l.base) == (recorded[i].end - recorded[i].base)) {
                        libDelta[i] = (int64_t)l.base - (int64_t)recorded[i].base;
                        found = true;
                        break;
                    }
                if (!found && (recorded[i].flags & 1) && hdr.libsBase) {
                    libDelta[i] = (int64_t)platformLibsBase() - (int64_t)hdr.libsBase;
                    found = true;
                } // not loaded here (the builder dlopen'd it); it is mapped with the cache regardless, at the cache's current slide
                if (!found) {
                    bool used = false;
                    for (size_t k = 0; k < nFixups; k++)
                        if (fixups[k].lib == i) {
                            used = true;
                            break;
                        }
                    if (used) {
                        bool present = false;
                        for (auto& l : now)
                            if (l.nameHash == recorded[i].nameHash) {
                                present = true;
                                break;
                            }
                        if (snapshotVerbose()) fprintf(stderr, "[snapshot] system library %s (%s) the snapshot points into %s; booting normally\n", recorded[i].path, recorded[i].seg, present ? "changed size" : "could not be loaded");
                        close(fd);
                        return;
                    }
                }
            }
        }
    }
    bool fixupsWanted = haveFixups && !(getenv("BUN_SNAPSHOT_LIB_FIXUPS") && !strcmp(getenv("BUN_SNAPSHOT_LIB_FIXUPS"), "0")); // system libraries may slide between boots (Darwin: the dyld shared cache; Linux: ASLR per exec)
    if (fixupsWanted && hdr.spare[4] && hdr.spare[4] != platformSystemLibsId()) {
        if (snapshotVerbose()) fprintf(stderr, "[snapshot] %s was built against a different OS build (system library contents changed); booting normally\n", path);
        close(fd);
        return;
    }
    if (!fixupsWanted && hdr.libsBase && hdr.libsBase != platformLibsBase()) {
        if (snapshotVerbose()) fprintf(stderr, "[snapshot] %s was built against system libraries at %llx, now at %llx (reboot / OS update); booting normally\n", path, (unsigned long long)hdr.libsBase, (unsigned long long)platformLibsBase());
        close(fd);
        return;
    }
    mi_scavenger_stop(); // this process's scavenger thread must not touch allocator state while/after we overlay it
    // No heap use from here until the overlay is done: with malloc routed to mimalloc, this process's heap sits at the same VA as the snapshot's.
    if (hdr.nregions > 8192) {
        fprintf(stderr, "[snapshot] too many regions\n");
        _exit(2);
    }
    SnapshotRegion* regionsBuf = (SnapshotRegion*)mmap(nullptr, (hdr.nregions * sizeof(SnapshotRegion) + 16383) & ~16383ull, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0); // not heap, not __DATA: both get overlaid below
    ipread(fd, regionsBuf, hdr.nregions * sizeof(SnapshotRegion), sizeof(SnapshotHeader));
    std::span<SnapshotRegion> regions(regionsBuf, hdr.nregions);
    { // this process's own (pre-overlay) allocator must not place anything where the snapshot goes: push mimalloc's hint pointer above the snapshot
        uint64_t top = 0;
        for (auto& r : regions)
            if (r.addr >= 0x20000000000ull && r.addr < 0x2e0000000000ull) top = std::max<uint64_t>(top, r.addr + r.len);
        if (top) mi_os_hint_floor((void*)(top + (1ull << 30)));
    }
    const off_t savedBaseOff = snapshotBaseOff; // snapshotBaseOff lives in __DATA, which the overlay below rewrites with the builder's value
    BunLaunchContext launch;
    bun_launch_context_capture(&launch); // this process's raw argc/argv (our statics get the builder's below)
    uint64_t hintFloorAfterOverlay = 0;
    {
        uint64_t top = 0;
        for (auto& r : regions)
            if (r.addr >= 0x20000000000ull && r.addr < 0x2e0000000000ull) top = std::max<uint64_t>(top, r.addr + r.len);
        hintFloorAfterOverlay = (top ? top : 0x20000000000ull) + (1ull << 30);
    }
    size_t mapped = 0, copied = 0;
    struct DataSeg {
        uint64_t* dst;
        const uint64_t* src;
        size_t words;
    };
    DataSeg dataSegs[16];
    size_t nDataSegs = 0; // no heap here: the allocator's state is being overlaid
    bool useLibFixups = fixupsWanted;
    uint64_t linkerRanges[8][2];
    size_t nLinkerRanges = platformLinkerOwnedRanges(linkerRanges, 8);
    const bool deferDataCopy = useLibFixups || nLinkerRanges > 0; // words this process owns inside our data segments are skipped by the deferred copy
    bool verbose = !!getenv("BUN_SNAPSHOT_VERBOSE");
    for (auto& r : regions) {
        if (verbose) {
            fprintf(stderr, "[snapshot] restoring %llx+%llx kind=%llu tag=%llu\n", r.addr, r.len, r.kind & 0xff, r.kind >> 8);
        }
        if ((r.kind & 0xff) == 3) {
            void* m = mmap((void*)r.addr, r.len, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE | MAP_ANON | MAP_JIT, -1, 0); // MAP_JIT|MAP_FIXED is EINVAL; rely on the hint
            if (m != (void*)r.addr) {
                fprintf(stderr, "[snapshot] mmap JIT %llx+%llx landed at %p errno %d\n", r.addr, r.len, m, errno);
                _exit(3);
            }
            continue;
        }
        if ((r.kind & 0xff) == 2) {
            void* buf = mmap(nullptr, r.len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
            if (ipread(fd, buf, r.len, r.fileOff) != (ssize_t)r.len) {
                fprintf(stderr, "[snapshot] pread JIT failed errno %d\n", errno);
                _exit(3);
            }
            platformWriteJIT((void*)r.addr, buf, r.len);
            munmap(buf, r.len);
            copied += r.len;
            continue;
        }
        if ((r.kind & 0xff) == 4) {
            munmap((void*)r.addr, r.len);
            void* m = mmap((void*)r.addr, r.len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON | MAP_FIXED, -1, 0);
            if (m == MAP_FAILED) {
                fprintf(stderr, "[snapshot] mmap reserve %llx+%llx failed errno %d\n", r.addr, r.len, errno);
                _exit(3);
            }
            continue;
        }
        if ((r.kind & 0xff) == 1) {
            // Data segments of the running binary are copied last (below): once they are overwritten our GOT/stdio state is the builder's,
            // so nothing may call into libc between that copy and the extern-library fixups.
            if (mprotect((void*)r.addr, r.len, PROT_READ | PROT_WRITE)) {
                fprintf(stderr, "[snapshot] mprotect __DATA %llx failed errno %d\n", r.addr, errno);
                _exit(3);
            }
            if (!deferDataCopy) { // copy in place now (nothing to skip or rebase)
                if (ipread(fd, (void*)r.addr, r.len, r.fileOff) != (ssize_t)r.len) {
                    fprintf(stderr, "[snapshot] pread __DATA failed errno %d\n", errno);
                    _exit(3);
                }
                snapshotBaseOff = savedBaseOff; // just overwritten along with the rest of our __DATA
                mi_os_hint_floor((void*)hintFloorAfterOverlay); // the builder's allocator hint pointer just arrived with __DATA; keep fresh OS memory above the snapshot
                copied += r.len;
                continue;
            }
            void* scratch = mmap(nullptr, r.len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
            if (scratch == MAP_FAILED || ipread(fd, scratch, r.len, r.fileOff) != (ssize_t)r.len) {
                fprintf(stderr, "[snapshot] pread __DATA failed errno %d\n", errno);
                _exit(3);
            }
            if (nDataSegs < 16) dataSegs[nDataSegs++] = { (uint64_t*)r.addr, (const uint64_t*)scratch, r.len / 8 };
            copied += r.len;
            continue;
        } else {
            void* m = immap((void*)r.addr, r.len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_FIXED, fd, r.fileOff);
            if (m == MAP_FAILED) {
                // e.g. a reservation with restrictive max_prot already sits there: deallocate the range and retry
                int e1 = errno;
                munmap((void*)r.addr, r.len);
                m = immap((void*)r.addr, r.len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_FIXED, fd, r.fileOff);
                if (m == MAP_FAILED) {
                    fprintf(stderr, "[snapshot] mmap %llx+%llx (tag %llu) failed errno %d then %d — skipping\n", r.addr, r.len, r.kind >> 8, e1, errno);
                    continue;
                }
            }
            mapped += r.len;
        }
    }
    // Re-seat allocator TLS: this thread's default theap must be the snapshot's main theap, not whatever this process created before the overlay.
    { // libc-free critical section: overwrite our data segments with the builder's, then rebase extern-library pointers. Plain loops only (no PLT calls).
        // Process-owned libc globals that live in *our* data segment (copy relocations in a non-PIE executable): keep this process's values.
        char** volatile* environSlot = (char** volatile*)&environ;
        char** savedEnviron = *environSlot; // volatile: the overlay below rewrites it behind the compiler's back
        for (size_t di = 0; di < nDataSegs; di++) {
            DataSeg& d = dataSegs[di];
            volatile uint64_t* dst = d.dst;
            const uint64_t* src = d.src;
            for (size_t k = 0; k < d.words; k++) {
                uint64_t a = (uint64_t)(d.dst + k);
                bool linkerOwned = false;
                for (size_t q = 0; q < nLinkerRanges; q++)
                    if (a >= linkerRanges[q][0] && a < linkerRanges[q][1]) {
                        linkerOwned = true;
                        break;
                    }
                if (!linkerOwned) dst[k] = src[k];
            }
        }
        if (useLibFixups)
            for (size_t k = 0; k < nFixups; k++) {
                SnapshotFixup& f = fixups[k];
                bool linkerOwned = false;
                for (size_t q = 0; q < nLinkerRanges; q++)
                    if (f.addr >= linkerRanges[q][0] && f.addr < linkerRanges[q][1]) {
                        linkerOwned = true;
                        break;
                    }
                if (!linkerOwned && f.lib < nLibDelta && libDelta[f.lib]) *(volatile uint64_t*)f.addr += libDelta[f.lib];
            }
        if (deferDataCopy) *environSlot = savedEnviron;
        *(volatile off_t*)&snapshotBaseOff = savedBaseOff;
        mi_os_hint_floor((void*)hintFloorAfterOverlay);
    }
    for (size_t di = 0; di < nDataSegs; di++)
        munmap((void*)dataSegs[di].src, dataSegs[di].words * 8);
    bun_launch_context_restore(&launch); // everything derived from it (process.argv, Bun.argv, …) is ProcessDerived and recomputes this epoch
    if (hdr.reserved[0]) {
        mi_theap_set_default((mi_theap_t*)hdr.reserved[0]);
        mi_theap_adopt_current_thread((mi_theap_t*)hdr.reserved[0]); // the fresh heap below binds to this thread state; it must name this thread
    }
    _mi_scavenger_forked_child(); // same situation as a fork child: the snapshot says a scavenger runs, but no such thread exists here
    mi_prof_reinit_lock(); // and any allocator-internal lock a build-process thread was holding is nobody's now
    { // park /dev/null on every fd number the snapshot thinks it owns (the snapshot file fd itself gets moved out of the way first)
        int hi = 1023;
        while (hi > 2 && !(s_snapshotOpenFds[hi / 64] & (1ull << (hi % 64))))
            hi--;
        if (fd <= hi) {
            int moved = fcntl(fd, F_DUPFD_CLOEXEC, hi + 1);
            if (moved >= 0) {
                close(fd);
                fd = moved;
            }
        }
        for (int i = 0; i < s_snapshotFileFdCount; i++) {
            SnapshotFileFd& f = s_snapshotFileFds[i];
            if (fcntl(f.fd, F_GETFD) != -1) continue;
            int nfd = open(f.path, (f.flags & ~(O_CREAT | O_TRUNC | O_EXCL)) | O_APPEND | O_CLOEXEC);
            if (nfd < 0) continue;
            if (nfd != f.fd) {
                dup2(nfd, f.fd);
                close(nfd);
            }
            if (verbose) fprintf(stderr, "[snapshot] reopened log fd %d -> %s\n", f.fd, f.path);
        }
        int devnull = open("/dev/null", O_RDWR | O_CLOEXEC);
        int parked = 0;
        for (int k = 3; k <= hi; k++)
            if ((s_snapshotOpenFds[k / 64] & (1ull << (k % 64))) && fcntl(k, F_GETFD) == -1 && dup2(devnull, k) == k) parked++;
        if (devnull > hi) close(devnull);
        if (verbose) fprintf(stderr, "[snapshot] parked /dev/null on %d stale fd numbers (max %d)\n", parked, hi);
    }
    if (s_snapshotTermiosFd >= 0 && isatty(s_snapshotTermiosFd)) tcsetattr(s_snapshotTermiosFd, TCSANOW, &s_snapshotTermios); // raw mode etc. as the build process left it
    for (int i = 2; i < 7 && hdr.reserved[i]; i++) { // recreate TTY fds at their old numbers from our own stdio
        int fd = (int)(hdr.reserved[i] >> 16), fl = (int)((hdr.reserved[i] >> 4) & 0xfff), src = (int)(hdr.reserved[i] & 0xf) - 1;
        if (isatty(src) && dup2(src, fd) == fd) {
            if (fl & O_NONBLOCK) fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
            if (verbose) fprintf(stderr, "[snapshot] dup2(%d, %d)\n", src, fd);
        }
    }
    setvbuf(stderr, nullptr, _IONBF, 0);
    setvbuf(stdout, nullptr, _IOLBF, 0); // stdio buffering mode was decided in the builder (whose fds may have been files)
    { // Snapshot payload pages are immortal: never free into them (that would dirty a clean file-backed page for allocator metadata); allocate from fresh pages.
        frozenRanges.clear();
        snapshotRuns.clear();
        for (auto& r : regions)
            if ((r.kind & 0xff) == 0) {
                frozenRanges.push_back({ r.addr, r.addr + r.len });
                snapshotRuns.push_back({ (uintptr_t)r.addr, (size_t)r.len, (size_t)r.fileOff });
            }
        std::sort(frozenRanges.begin(), frozenRanges.end());
        std::sort(snapshotRuns.begin(), snapshotRuns.end(), [](const FrozenRun& x, const FrozenRun& y) { return x.start < y.start; });
        snapshotFd = fd; // stays open: reclean remaps pristine pages from it (and the tooling diffs against it)
        { // Watchpoint.cpp asks whether an object is snapshotted; the snapshotted allocator arenas are one contiguous span
            uintptr_t lo = UINTPTR_MAX, hi = 0;
            for (auto& r : regions)
                if ((r.kind & 0xff) == 0 && (r.kind >> 8) == 240) {
                    lo = std::min<uintptr_t>(lo, r.addr);
                    hi = std::max<uintptr_t>(hi, r.addr + r.len);
                }
            if (hi > lo) {
                WTF::g_snapshotImmortalRangeLo = lo;
                WTF::g_snapshotImmortalRangeSpan = hi - lo;
            }
        }
        if (hdr.reserved[0]) mi_theap_freeze((mi_theap_t*)hdr.reserved[0]);
        mi_arenas_seal_existing(); // every arena that exists now is snapshot memory: nobody (any thread) allocates into its free space again
        uint64_t snapshottedTop = 0; // the overlay brought the builder's hint pointer (or none): fresh OS memory goes above everything snapshotted
        for (auto& r : regions)
            if (r.addr >= 0x20000000000ull && r.addr < 0x2e0000000000ull) snapshottedTop = std::max<uint64_t>(snapshottedTop, r.addr + r.len);
        if (snapshottedTop) mi_os_hint_floor((void*)(snapshottedTop + (1ull << 30)));
        mi_heap_t* fresh = nullptr;
#if OS(DARWIN)
        { // This process's allocations get their own arena, placed explicitly 1GiB above the snapshot rather than wherever the allocator's
          // (just overlaid) hint state would put them. Linux relies on the sealed arenas + hint floor until exclusive-arena binding is sorted out.
            mi_arena_id_t freshArena = 0;
            void* want = (void*)((snapshottedTop + (1ull << 30)) & ~((1ull << 30) - 1));
            size_t sz = 1ull << 30;
            void* got = mmap(want, sz, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON | MAP_NORESERVE, -1, 0);
            if (got != MAP_FAILED && got != want) {
                munmap(got, sz);
                got = MAP_FAILED;
            }
            if (got != MAP_FAILED && mi_manage_os_memory_ex(got, sz, /*committed*/ false, /*large*/ false, /*zero*/ true, /*numa*/ -1, /*exclusive*/ true, &freshArena))
                fresh = mi_heap_new_in_arena(freshArena);
            else if (mi_reserve_os_memory_ex(sz, false, false, true, &freshArena) == 0)
                fresh = mi_heap_new_in_arena(freshArena);
            mi_os_hint_floor((void*)((uintptr_t)want + 2 * sz));
        }
#endif
        if (!fresh)
            fresh = mi_heap_new();
        freshHeap = fresh;
        mi_theap_set_default(mi_heap_theap(fresh));
        {
            void* probe = mi_malloc(64);
            if (verbose) fprintf(stderr, "[snapshot] fresh heap: own arena=%d probe=%p\n", (int)(fresh != nullptr), probe);
            if (WTF::isInSnapshotImmortalRange(probe)) { // cannot happen with the floor above; if it ever does, misclassifying new objects as snapshotted would be worse than the rule it serves
                fprintf(stderr, "[snapshot] fresh heap overlaps the snapshot span; not tracking snapshot objects\n");
                WTF::g_snapshotImmortalRangeSpan = 0;
            }
            mi_free(probe);
        }
    }
    // The snapshot's scavenger thread died with the build process; without one, nothing sweeps this thread's heaps while it is
    // parked, and everything the app frees after resuming stays resident. Same restart a fork child gets, done eagerly.
    _mi_scavenger_start_if_forked();
    snapshotToolingAfterRestore();
    snapshotToolingArmTraps();
    // pthread TLS keys created by the build process (WTF::ThreadSpecific etc.) must exist here too, or setspecific silently fails; burn keys up to the snapshot's high-water mark.
    if (hdr.reserved[1]) {
        for (int i = 0; i < 1024; i++) {
            pthread_key_t k = 0;
            if (pthread_key_create(&k, nullptr)) break;
            if ((uint64_t)k + 1 >= hdr.reserved[1]) break;
        }
    }
    for (size_t i = 0; i < nPendingLibs; i++) { // see the note where these were collected
        if (!dlopen(pendingLibs[i], RTLD_NOW | RTLD_GLOBAL))
            fprintf(stderr, "[snapshot] warning: could not load %s, which the snapshot uses: %s\n", pendingLibs[i], dlerror());
        else if (verbose)
            fprintf(stderr, "[snapshot] loaded %s (the builder had it loaded)\n", pendingLibs[i]);
    }
    if (useLibFixups && verbose) fprintf(stderr, "[snapshot] rebased %zu extern-library pointers\n", nFixups);
    if (snapshotVerbose()) fprintf(stderr, "[snapshot] restored %zu regions: %.1fMB mapped clean, %.1fMB __DATA copied\n", regions.size(), mapped / 1048576.0, copied / 1048576.0);
    // From here on all globals/heap are the build process's. Adopt the snapshot's main Thread object for this OS thread.
    WTF::Thread* mainThread = (WTF::Thread*)hdr.mainThread;
    mainThread->adoptCurrentThreadForSnapshot();
    JSC::VM* vm = (JSC::VM*)hdr.vm;
    if (snapshotVerbose()) fprintf(stderr, "[snapshot] thread: snapshot main=%p currentSingleton=%p currentMayBeNull=%p apiLock owner=%p held=%d\n", mainThread, &WTF::Thread::currentSingleton(), WTF::Thread::currentMayBeNull(), vm->apiLock().ownerThread() ? vm->apiLock().ownerThread()->get() : nullptr, (int)vm->apiLock().currentThreadIsHoldingLock());
    JSC::JSGlobalObject* globalObject = (JSC::JSGlobalObject*)hdr.globalObject;
    uws_adopt_loop_for_current_thread((struct us_loop_t*)hdr.reserved[8 - 1]); // main thread's uWS::Loop TLS -> the snapshot's loop object (else uws_get_loop() would make a second loop)
    us_loop_reinit_for_snapshot(uws_get_loop());
    __atomic_add_fetch(&bun_snapshot_epoch, 1, __ATOMIC_ACQ_REL);
    snapshotReprobeCPUDispatch();
    Bun__snapshotAdoptMainThreadVM();
    JSC::JSLockHolder restoreLock(*vm); // held until 'restore' has been emitted: releasing a JSLock drains microtasks, and snapshotted continuations must not run before the app hears about the restore
    vm->refreshStackBoundsAfterSnapshotRestore(); // before any JSLock/sanitizeStack: the VM still holds the builder's stack addresses (asserts once the stack lands elsewhere, i.e. with ASLR)
    {
        JSC::JSLockHolder lock(*vm);
        vm->didRestoreFromSnapshot();
        if (snapshotVerbose()) fprintf(stderr, "[snapshot] termination state: request=%d pendingTermException=%d exception=%p trapsNeedTermination=%d\n", (int)vm->hasTerminationRequest(), (int)vm->hasPendingTerminationException(), vm->exceptionForInspection(), (int)vm->traps().needHandling(JSC::VMTraps::NeedTermination));
        if (vm->hasPendingTerminationException() || vm->hasTerminationRequest()) {
            vm->clearHasTerminationRequest();
            {
                auto scope = DECLARE_TOP_EXCEPTION_SCOPE(*vm);
                scope.clearException();
            }
            vm->traps().clearTrap(JSC::VMTraps::NeedTermination);
            if (verbose) fprintf(stderr, "[snapshot] cleared stale termination state\n");
        }
    }

    {
        JSC::JSLockHolder lock(*vm);
        NakedPtr<JSC::Exception> exception;
        globalObject->weakRandom().setSeed(WTF::cryptographicallyRandomNumber<unsigned>()); // Math.random's stream came from the builder
        // chdir('.') refreshes libc's idea of the cwd for code that cached it. Once the app's own startup work has settled, one full
        // collection frees what that burst left behind and the reclean hands back the snapshot pages it only wrote transiently.
        JSC::evaluate(globalObject, JSC::makeSource("try { process.chdir('.'); } catch {} process.emit('restore'); setTimeout(() => { Bun.gc(true); Bun.unsafe.recleanSnapshotPages(); }, 2000).unref();"_s, JSC::SourceOrigin {}, JSC::SourceTaintedOrigin::Untainted), JSC::JSValue(), exception);
        if (exception) fprintf(stderr, "[snapshot] a 'restore' listener threw: %s\n", exception->value().toWTFString(globalObject).utf8().data());
    }
    Bun__snapshotContinueEventLoop(); // never returns
#endif
}

#else // !BUN_SNAPSHOT_SUPPORTED

#include <stdio.h>
#include <stdlib.h>
namespace JSC {
class VM;
}
extern "C" int bun_is_compiled_executable(void);
extern "C" bool Bun__isCompiledExecutable() { return bun_is_compiled_executable(); }
extern "C" bool Bun__snapshotMode() { return false; }
extern "C" bool Bun__snapshotActive() { return false; }
extern "C" void Bun__snapshotMaybeRestore() {}
extern "C" void Bun__snapshotInit() {}
extern "C" void Bun__snapshotSetEnvGate(const uint8_t*, size_t) {}
extern "C" void Bun__snapshotRecleanPages(JSC::VM*) {}
extern "C" void Bun__VM__refreshStackBoundsAfterSnapshotRestore(JSC::VM*) {}
extern "C" void Bun__snapshotUnwindJS(JSC::VM*) {}
extern "C" void Bun__snapshotClearTerminationRequest(JSC::VM*) {}
extern "C" void Bun__snapshotDumpNow(JSC::VM*, const char*)
{
    fprintf(stderr, "error: snapshots are not supported on this platform\n");
    exit(1);
}

#endif // BUN_SNAPSHOT_SUPPORTED

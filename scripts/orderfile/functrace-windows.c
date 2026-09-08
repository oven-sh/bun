// Function-entry tracer for scripts/orderfile/generate.ts on Windows: what
// functrace.c and ptyrun.c do on linux and macOS, as one program.
//
// Produces functrace.c's record — the functions a run enters, in first-entry
// order — the way a debugger would. The binary under trace is started as this
// program's debuggee, and while it is still stopped at its creation event, with
// nothing of it run yet, the first instruction of every function is overwritten
// with a breakpoint (x86-64 INT3, arm64 BRK). Each breakpoint exception puts the
// instruction back, records the address and resumes the thread at it, so every
// function traps exactly once and runs at full speed afterwards. Nothing is
// loaded into the traced process, and its children are not debugged
// (DEBUG_ONLY_THIS_PROCESS), which is what functrace.c has to arrange by
// scrubbing itself out of the environment.
//
// With BUN_FUNCTRACE_TTY set, the debuggee is started on a pseudo console
// rather than our stdio, as ptyrun.c starts its child on a pty: our stdin is
// typed into it and whatever it writes is forwarded to our stdout. Console
// stdio is a different path through bun (libuv's tty layer, console modes,
// WriteConsole) than a pipe, and the only way to reach it is to be a console.
//
// Function starts arrive as link-time addresses (a PE carries no symbol table;
// generate.ts gets them from the link's maps, see windows-symbols.ts). ASLR
// relocates the image, so they are shifted by the load slide on the way in and
// back on the way out. The trace file layout is functrace.c's.
//
//   clang-cl /O2 -fuse-ld=lld functrace-windows.c    (or: cl /O2 functrace-windows.c)
//   set BUN_FUNCTRACE_STARTS=starts.bin
//   set BUN_FUNCTRACE_OUT=trace.bin
//   functrace-windows build\release\bun-profile.exe -e "console.log(1)"
//
// Exits with the debuggee's exit code; 2 if the trace itself could not be set up.
#if !defined(_M_X64) && !defined(_M_ARM64)
#error "functrace-windows.c builds for x64 or arm64 Windows"
#endif

#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#pragma comment(lib, "kernel32.lib")

#if defined(_M_X64)
typedef uint8_t insn_t;
#define BREAKPOINT ((insn_t)0xcc) // INT3
#define MACHINE IMAGE_FILE_MACHINE_AMD64
#define MACHINE_NAME "x64"
#define PC(context) ((context)->Rip)
static int is_breakpoint(insn_t insn) { return insn == BREAKPOINT; }
#else
typedef uint32_t insn_t;
#define BREAKPOINT ((insn_t)0xd43e0000) // BRK #0xf000, the immediate Windows uses for a debug break
#define MACHINE IMAGE_FILE_MACHINE_ARM64
#define MACHINE_NAME "arm64"
#define PC(context) ((context)->Pc)
static int is_breakpoint(insn_t insn) { return (insn & 0xffe0001fu) == 0xd4200000u; } // BRK with any immediate
#endif

#define MAX_REGIONS 8
#define STARTS_HEADER_WORDS 3 // u64 magic, version, count
#define TRACE_HEADER_WORDS 5  // u64 magic, version, slide, starts, count
#define STARTS_MAGIC UINT64_C(0x4e55425354525453) // "STRTSBUN" little-endian
#define TRACE_MAGIC UINT64_C(0x4e55424543415254)  // "TRACEBUN" little-endian
#define FILE_VERSION UINT64_C(1)

static struct {
    uintptr_t start, end;
} regions[MAX_REGIONS];
static int region_count;

static HANDLE process;      // the debuggee
static uintptr_t slide;     // where the image landed, minus where it was linked to land
static uintptr_t *starts;   // runtime addresses, sorted
static insn_t *originals;   // instruction that was at starts[i]
static uint8_t *seen;
static size_t start_count;
static uint64_t *record;    // header words, then one entry per function recorded so far

static __declspec(noreturn) void die(const char *format, ...)
{
    va_list args;
    va_start(args, format);
    fputs("functrace: ", stderr);
    vfprintf(stderr, format, args);
    fputc('\n', stderr);
    va_end(args);
    // The debuggee dies with us: a debugger's exit kills its debuggees unless
    // it asked otherwise, and a half-armed process is not worth keeping.
    exit(2);
}

static int region_of(uintptr_t a)
{
    for (int i = 0; i < region_count; i++)
        if (a >= regions[i].start && a + sizeof(insn_t) <= regions[i].end) return i;
    return -1;
}

static size_t find_start(uintptr_t a)
{
    size_t lo = 0, hi = start_count;
    while (lo < hi) {
        size_t mid = lo + (hi - lo) / 2;
        if (starts[mid] < a) lo = mid + 1;
        else hi = mid;
    }
    return (lo < start_count && starts[lo] == a) ? lo : SIZE_MAX;
}

/** Writes into the debuggee's code, which is mapped read-execute. */
static void write_code(uintptr_t at, const void *bytes, size_t n)
{
    DWORD protection = 0;
    SIZE_T written = 0;
    if (!VirtualProtectEx(process, (void *)at, n, PAGE_EXECUTE_READWRITE, &protection))
        die("cannot unprotect %zu bytes of code at %p (error %lu)", n, (void *)at, GetLastError());
    BOOL ok = WriteProcessMemory(process, (void *)at, bytes, n, &written);
    DWORD error = GetLastError();
    VirtualProtectEx(process, (void *)at, n, protection, &protection);
    if (!ok || written != n) die("cannot write %zu bytes of code at %p (error %lu)", n, (void *)at, error);
    FlushInstructionCache(process, (void *)at, n);
}

// ─── the image ──────────────────────────────────────────────────────────────

/**
 * The load slide and the executable sections, from the image file the creation
 * event hands over. The file, not the mapping: the mapping's headers belong to
 * the loader, and which of them it rewrites while relocating is its business.
 */
static void map_image(HANDLE file, uintptr_t base)
{
    // lld-link's headers are about 1 KB: DOS stub, PE header and a dozen sections.
    static __declspec(align(16)) uint8_t header[4096];
    DWORD got = 0;
    OVERLAPPED from_start;
    memset(&from_start, 0, sizeof from_start);
    if (!ReadFile(file, header, sizeof header, &got, &from_start) &&
        (GetLastError() != ERROR_IO_PENDING || !GetOverlappedResult(file, &from_start, &got, TRUE)))
        die("cannot read the image file (error %lu)", GetLastError());

    const IMAGE_DOS_HEADER *dos = (const IMAGE_DOS_HEADER *)header;
    if (got < sizeof *dos || dos->e_magic != IMAGE_DOS_SIGNATURE || dos->e_lfanew < 0 ||
        (DWORD)dos->e_lfanew + sizeof(IMAGE_NT_HEADERS64) > got)
        die("the command is not a 64-bit PE image");
    const IMAGE_NT_HEADERS64 *nt = (const IMAGE_NT_HEADERS64 *)(header + dos->e_lfanew);
    if (nt->Signature != IMAGE_NT_SIGNATURE || nt->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC)
        die("the command is not a 64-bit PE image");
    if (nt->FileHeader.Machine != MACHINE)
        die("the command is built for machine type 0x%x, but this tracer is " MACHINE_NAME
            " — a debugger has to be the architecture of what it debugs",
            (unsigned)nt->FileHeader.Machine);

    const IMAGE_SECTION_HEADER *sections = IMAGE_FIRST_SECTION(nt);
    unsigned count = nt->FileHeader.NumberOfSections;
    if ((const uint8_t *)(sections + count) > header + got) die("the image's section table does not fit in %zu bytes", sizeof header);

    slide = base - (uintptr_t)nt->OptionalHeader.ImageBase;
    for (unsigned i = 0; i < count && region_count < MAX_REGIONS; i++) {
        if (!(sections[i].Characteristics & IMAGE_SCN_MEM_EXECUTE)) continue;
        regions[region_count].start = base + sections[i].VirtualAddress;
        regions[region_count].end = regions[region_count].start + sections[i].Misc.VirtualSize;
        region_count++;
    }
    if (!region_count) die("the image has no executable section");
}

static int cmp_uintptr(const void *a, const void *b)
{
    uintptr_t x = *(const uintptr_t *)a, y = *(const uintptr_t *)b;
    return (x > y) - (x < y);
}

static void read_starts(const wchar_t *path)
{
    FILE *f = _wfopen(path, L"rb");
    if (!f) die("cannot open %ls", path);
    if (fseek(f, 0, SEEK_END) != 0) die("cannot read %ls", path);
    long size = ftell(f);
    rewind(f);
    if (size < (long)(STARTS_HEADER_WORDS * 8)) die("%ls is not a starts file", path);
    uint64_t *words = malloc((size_t)size);
    if (!words || fread(words, 1, (size_t)size, f) != (size_t)size) die("cannot read %ls", path);
    fclose(f);

    uint64_t n = words[2];
    if (words[0] != STARTS_MAGIC || words[1] != FILE_VERSION || n == 0 || n > (uint64_t)size / 8 - STARTS_HEADER_WORDS)
        die("%ls is not a starts file", path);
    starts = malloc((size_t)n * sizeof *starts);
    if (!starts) die("out of memory");
    for (size_t i = 0; i < (size_t)n; i++) {
        // Drop anything outside the image's own code — a symbol the linker
        // dropped, say — and anything a breakpoint cannot be planted on.
        uintptr_t a = (uintptr_t)words[STARTS_HEADER_WORDS + i] + slide;
        if (region_of(a) < 0 || a % sizeof(insn_t) != 0) continue;
        starts[start_count++] = a;
    }
    free(words);
    if (!start_count) die("none of the %llu function starts in %ls fall inside the command's code — is it the binary they were read from?", (unsigned long long)n, path);

    qsort(starts, start_count, sizeof *starts, cmp_uintptr);
    size_t unique = 0;
    for (size_t i = 0; i < start_count; i++)
        if (unique == 0 || starts[unique - 1] != starts[i]) starts[unique++] = starts[i];
    start_count = unique;
}

/** Runs at the creation event: the image is mapped and none of it has executed. */
static void arm(HANDLE image_file, uintptr_t image_base, const wchar_t *starts_path)
{
    map_image(image_file, image_base);
    read_starts(starts_path);

    // Each executable section in one round trip: copy it out, plant every
    // breakpoint in the copy, write it back. One protection change and one
    // cache flush, instead of one of each per function.
    uint8_t *code[MAX_REGIONS];
    for (int r = 0; r < region_count; r++) {
        size_t n = regions[r].end - regions[r].start;
        SIZE_T got = 0;
        code[r] = malloc(n);
        if (!code[r]) die("out of memory");
        if (!ReadProcessMemory(process, (const void *)regions[r].start, code[r], n, &got) || got != n)
            die("cannot read the command's code (error %lu)", GetLastError());
    }

    // A function whose first instruction already is a breakpoint — JSC's LLInt
    // puts one at labels that must never be reached — stays unarmed: restoring
    // it would raise again at the same address, and the exception would be
    // indistinguishable from ours.
    size_t kept = 0;
    for (size_t i = 0; i < start_count; i++) {
        int r = region_of(starts[i]);
        insn_t insn;
        memcpy(&insn, code[r] + (starts[i] - regions[r].start), sizeof insn);
        if (!is_breakpoint(insn)) starts[kept++] = starts[i];
    }
    start_count = kept;

    originals = calloc(start_count, sizeof *originals);
    seen = calloc(start_count, sizeof *seen);
    record = calloc(TRACE_HEADER_WORDS + start_count, sizeof *record);
    if (!originals || !seen || !record) die("out of memory");
    record[0] = TRACE_MAGIC;
    record[1] = FILE_VERSION;
    record[2] = slide;
    record[3] = start_count;

    for (size_t i = 0; i < start_count; i++) {
        int r = region_of(starts[i]);
        uint8_t *p = code[r] + (starts[i] - regions[r].start);
        memcpy(&originals[i], p, sizeof originals[i]);
        const insn_t breakpoint = BREAKPOINT;
        memcpy(p, &breakpoint, sizeof breakpoint);
    }
    for (int r = 0; r < region_count; r++) {
        write_code(regions[r].start, code[r], regions[r].end - regions[r].start);
        free(code[r]);
    }
}

// ─── breakpoints ────────────────────────────────────────────────────────────

/**
 * INT3 is reported with the thread already past it; BRK with the thread still
 * on it. Either way the thread is to re-execute the restored instruction, so
 * point it there rather than knowing which.
 */
static void resume_at(DWORD thread_id, uintptr_t at)
{
    HANDLE thread = OpenThread(THREAD_GET_CONTEXT | THREAD_SET_CONTEXT, FALSE, thread_id);
    if (!thread) die("cannot open thread %lu (error %lu)", thread_id, GetLastError());
    CONTEXT context; // CONTEXT declares its own 16-byte alignment
    memset(&context, 0, sizeof context);
    context.ContextFlags = CONTEXT_CONTROL;
    if (!GetThreadContext(thread, &context)) die("cannot read thread %lu's registers (error %lu)", thread_id, GetLastError());
    PC(&context) = (DWORD64)at;
    if (!SetThreadContext(thread, &context)) die("cannot resume thread %lu at %p (error %lu)", thread_id, (void *)at, GetLastError());
    CloseHandle(thread);
}

/** Returns whether the exception was one of our breakpoints, now dealt with. */
static int on_exception(const DEBUG_EVENT *event)
{
    const EXCEPTION_RECORD *exception = &event->u.Exception.ExceptionRecord;
    if (exception->ExceptionCode != EXCEPTION_BREAKPOINT) return 0;
    uintptr_t at = (uintptr_t)exception->ExceptionAddress;
    size_t i = find_start(at);
    if (i == SIZE_MAX) return 0;

    // Another thread may have executed the breakpoint before the first one's
    // restore landed; it arrives here too, and only needs pointing back.
    if (!seen[i]) {
        seen[i] = 1;
        write_code(at, &originals[i], sizeof originals[i]);
        record[TRACE_HEADER_WORDS + record[4]] = at - slide;
        record[4]++;
    }
    resume_at(event->dwThreadId, at);
    return 1;
}

static void write_record(const wchar_t *path)
{
    FILE *f = _wfopen(path, L"wb");
    if (!f) die("cannot create %ls", path);
    size_t words = TRACE_HEADER_WORDS + (size_t)record[4];
    if (fwrite(record, sizeof *record, words, f) != words || fclose(f) != 0) die("cannot write %ls", path);
}

// ─── pseudo console ─────────────────────────────────────────────────────────

static HANDLE our_stdin, our_stdout; // what gets typed into the console, and where its screen output goes
static HANDLE console_input;         // our end of the console's input: bytes written here arrive as keystrokes
static HANDLE console_output;        // our end of its output: everything the debuggee writes to the screen

static DWORD WINAPI type_stdin(LPVOID unused)
{
    (void)unused;
    char buffer[4096];
    DWORD n = 0, written = 0;
    while (ReadFile(our_stdin, buffer, sizeof buffer, &n, NULL) && n > 0) {
        // The input has the pipe workload's line feeds; a terminal's Enter key is a carriage return.
        for (DWORD i = 0; i < n; i++)
            if (buffer[i] == '\n') buffer[i] = '\r';
        if (!WriteFile(console_input, buffer, n, &written, NULL)) break;
    }
    return 0;
}

static volatile ULONGLONG last_output_at; // GetTickCount64() when the console last produced output

static DWORD WINAPI forward_output(LPVOID unused)
{
    (void)unused;
    char buffer[8192];
    DWORD n = 0, written = 0;
    // Ends with a broken pipe once the console is closed. Reading continuously
    // also matters while the debuggee runs: a console whose output nobody drains
    // eventually blocks the process writing to it.
    while (ReadFile(console_output, buffer, sizeof buffer, &n, NULL) && n > 0) {
        last_output_at = GetTickCount64();
        if (our_stdout && !WriteFile(our_stdout, buffer, n, &written, NULL)) our_stdout = NULL;
    }
    return 0;
}

/**
 * The console renders what the debuggee wrote on its own schedule, and closing
 * it discards whatever it has not rendered yet — on Windows Server 2019 that is
 * routinely the debuggee's last lines, written just before it exited. Nothing
 * announces that it has caught up, so give it a moment after the exit, and
 * longer for as long as output keeps arriving.
 */
static void close_console(HPCON console, HANDLE output_thread)
{
    const ULONGLONG quiet_ms = 250, at_most_ms = 3000;
    ULONGLONG exited_at = GetTickCount64();
    for (;;) {
        ULONGLONG now = GetTickCount64(), latest = last_output_at > exited_at ? last_output_at : exited_at;
        if (now - latest >= quiet_ms || now - exited_at >= at_most_ms) break;
        Sleep(25);
    }
    ClosePseudoConsole(console); // ends the output, which is what lets the forwarder finish
    WaitForSingleObject(output_thread, 5000);
}

/** Creates the console the debuggee is to be started on, as a process attribute for CreateProcess. */
static HPCON create_console(LPPROC_THREAD_ATTRIBUTE_LIST *attributes)
{
    HANDLE input_read, output_write;
    if (!CreatePipe(&input_read, &console_input, NULL, 0) || !CreatePipe(&console_output, &output_write, NULL, 0))
        die("cannot create the console's pipes (error %lu)", GetLastError());
    COORD size = { 80, 24 }; // ptyrun.c's window
    HPCON console = NULL;
    HRESULT result = CreatePseudoConsole(size, input_read, output_write, 0, &console);
    if (FAILED(result)) die("cannot create a pseudo console (0x%08lx)", (unsigned long)result);
    // The console holds its own references to its ends of the pipes.
    CloseHandle(input_read);
    CloseHandle(output_write);

    SIZE_T bytes = 0;
    InitializeProcThreadAttributeList(NULL, 1, 0, &bytes);
    *attributes = malloc(bytes);
    if (!*attributes || !InitializeProcThreadAttributeList(*attributes, 1, 0, &bytes) ||
        !UpdateProcThreadAttribute(*attributes, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, console, sizeof console, NULL, NULL))
        die("cannot attach the pseudo console to the command (error %lu)", GetLastError());

    // A new process is handed its parent's standard handle numbers, and is only
    // given handles to its console in the slots that are empty. Ours are pipes
    // to whoever ran us, meaningless in the debuggee, so it would start with
    // those numbers as its stdio rather than the console. The threads above
    // keep the handles themselves; our own stderr is the CRT's, and unaffected.
    our_stdin = GetStdHandle(STD_INPUT_HANDLE);
    our_stdout = GetStdHandle(STD_OUTPUT_HANDLE);
    if (our_stdout == INVALID_HANDLE_VALUE) our_stdout = NULL;
    SetStdHandle(STD_INPUT_HANDLE, NULL);
    SetStdHandle(STD_OUTPUT_HANDLE, NULL);
    SetStdHandle(STD_ERROR_HANDLE, NULL);
    return console;
}

// ─── the debuggee ───────────────────────────────────────────────────────────

/** Appends one argument the way the CRT's argv parsing (CommandLineToArgvW) undoes. */
static wchar_t *append_argument(wchar_t *out, const wchar_t *arg)
{
    if (*arg && !wcspbrk(arg, L" \t\"")) {
        size_t n = wcslen(arg);
        memcpy(out, arg, n * sizeof *arg);
        return out + n;
    }
    *out++ = L'"';
    for (;;) {
        size_t backslashes = 0;
        while (*arg == L'\\') {
            backslashes++;
            arg++;
        }
        // Backslashes only escape when they precede a quote — including the
        // closing one we are about to add — so double them just there.
        size_t emit = *arg == L'\0' || *arg == L'"' ? backslashes * 2 : backslashes;
        for (size_t i = 0; i < emit; i++) *out++ = L'\\';
        if (*arg == L'\0') break;
        if (*arg == L'"') *out++ = L'\\';
        *out++ = *arg++;
    }
    *out++ = L'"';
    return out;
}

static wchar_t *command_line(int argc, wchar_t **argv)
{
    size_t bound = 1;
    for (int i = 0; i < argc; i++) bound += wcslen(argv[i]) * 2 + 3; // every character escaped, quoted, and a separator
    wchar_t *line = malloc(bound * sizeof *line), *out = line;
    if (!line) die("out of memory");
    for (int i = 0; i < argc; i++) {
        if (i) *out++ = L' ';
        out = append_argument(out, argv[i]);
    }
    *out = L'\0';
    return line;
}

/** A copy of a variable's value, with the variable itself removed from what the debuggee will inherit. */
static wchar_t *take_variable(const wchar_t *name)
{
    const wchar_t *value = _wgetenv(name);
    wchar_t *copy = value && *value ? _wcsdup(value) : NULL;
    SetEnvironmentVariableW(name, NULL);
    return copy;
}

int wmain(int argc, wchar_t **argv)
{
    if (argc < 2) {
        fputs("usage: BUN_FUNCTRACE_STARTS=<starts.bin> BUN_FUNCTRACE_OUT=<trace.bin> functrace-windows <command> [args...]\n", stderr);
        return 2;
    }
    wchar_t *starts_path = take_variable(L"BUN_FUNCTRACE_STARTS");
    wchar_t *out_path = take_variable(L"BUN_FUNCTRACE_OUT");
    wchar_t *tty = take_variable(L"BUN_FUNCTRACE_TTY");
    if (!starts_path || !out_path) die("BUN_FUNCTRACE_STARTS and BUN_FUNCTRACE_OUT must both be set");
    // Being debugged switches a process's heaps into their checked mode, which
    // is slow and not what a release binary does when it runs for real.
    SetEnvironmentVariableW(L"_NO_DEBUG_HEAP", L"1");

    STARTUPINFOEXW startup;
    memset(&startup, 0, sizeof startup);
    startup.StartupInfo.cb = sizeof startup.StartupInfo;
    DWORD flags = DEBUG_ONLY_THIS_PROCESS;
    HPCON console = NULL;
    if (tty) {
        console = create_console(&startup.lpAttributeList);
        startup.StartupInfo.cb = sizeof startup;
        flags |= EXTENDED_STARTUPINFO_PRESENT;
    } else {
        // The debuggee shares our stdio, the same as it would have had it been
        // started directly.
        HANDLE *handles[] = { &startup.StartupInfo.hStdInput, &startup.StartupInfo.hStdOutput, &startup.StartupInfo.hStdError };
        DWORD ids[] = { STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE };
        for (int i = 0; i < 3; i++) {
            *handles[i] = GetStdHandle(ids[i]);
            SetHandleInformation(*handles[i], HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
        }
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    }

    PROCESS_INFORMATION info;
    wchar_t *line = command_line(argc - 1, argv + 1);
    if (!CreateProcessW(argv[1], line, NULL, NULL, !tty, flags, NULL, NULL, &startup.StartupInfo, &info))
        die("cannot start %ls (error %lu)", argv[1], GetLastError());
    process = info.hProcess;
    CloseHandle(info.hThread);

    HANDLE output_thread = NULL;
    if (tty) {
        output_thread = CreateThread(NULL, 0, forward_output, NULL, 0, NULL);
        HANDLE input_thread = CreateThread(NULL, 0, type_stdin, NULL, 0, NULL);
        if (!output_thread || !input_thread) die("cannot start the console threads (error %lu)", GetLastError());
        CloseHandle(input_thread);
    }

    DWORD exit_code = 0;
    for (int exited = 0; !exited;) {
        DEBUG_EVENT event;
        if (!WaitForDebugEvent(&event, INFINITE)) die("lost the debuggee (error %lu)", GetLastError());
        DWORD disposition = DBG_CONTINUE;
        switch (event.dwDebugEventCode) {
        case CREATE_PROCESS_DEBUG_EVENT:
            if (!event.u.CreateProcessInfo.hFile) die("the creation event came without the image file");
            arm(event.u.CreateProcessInfo.hFile, (uintptr_t)event.u.CreateProcessInfo.lpBaseOfImage, starts_path);
            CloseHandle(event.u.CreateProcessInfo.hFile);
            break;
        case LOAD_DLL_DEBUG_EVENT:
            if (event.u.LoadDll.hFile) CloseHandle(event.u.LoadDll.hFile);
            break;
        case EXCEPTION_DEBUG_EVENT:
            // Every exception that is not one of our breakpoints — the loader's
            // own initial breakpoint, whatever the program raises and handles
            // itself, a real crash — goes on to the program's handlers and plays
            // out as it would untraced.
            if (!on_exception(&event)) disposition = DBG_EXCEPTION_NOT_HANDLED;
            break;
        case EXIT_PROCESS_DEBUG_EVENT:
            exit_code = event.u.ExitProcess.dwExitCode;
            exited = 1;
            break;
        }
        ContinueDebugEvent(event.dwProcessId, event.dwThreadId, disposition);
    }
    CloseHandle(process);

    if (console) close_console(console, output_thread);
    write_record(out_path);
    return (int)exit_code;
}

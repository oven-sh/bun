// A library may hand a program memory whose pages it fills when they are first touched: it maps them without access, or behind the end of a file, sets an action for
// SIGSEGV and SIGBUS, and makes the page good in that action. A fault of compiled code that is none of its own null checks or polls went to the report of a crash, whoever
// had set an action: the process died where `bun <file>` and an executable without --aot go on.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { locksEnvironment } from "./hardened";
import { without } from "./harness/capabilities";
import { afterAll } from "./harness/default-timeout";
import { compiler } from "./harness/reads-of-null";
import { withoutCoreDump } from "./harness/without-core-dump";
import { describe, test } from "./supported";

const library = `#define _GNU_SOURCE
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

static unsigned char* region;
static size_t region_size, page_bytes;
static int file = -1;
static volatile int served;

static void serve(int n, siginfo_t* info, void* context)
{
    uintptr_t address = (uintptr_t)info->si_addr, start = (uintptr_t)region;
    if (address >= start && address < start + region_size) {
        unsigned char* page = (unsigned char*)(address & ~(uintptr_t)(page_bytes - 1));
        if (file >= 0) ftruncate(file, page - region + page_bytes);
        else mprotect(page, page_bytes, PROT_READ | PROT_WRITE);
        page[0] = 42;
        served++;
        return;
    }
    signal(n, SIG_DFL);
}
static void set_actions(int flags)
{
    struct sigaction action;
    memset(&action, 0, sizeof action);
    action.sa_sigaction = serve;
    action.sa_flags = SA_SIGINFO | flags;
    sigaction(SIGSEGV, &action, 0);
    sigaction(SIGBUS, &action, 0);
}
int page_size(void) { return page_bytes = sysconf(_SC_PAGESIZE); }
int pages_served(void) { return served; }
void* pages_without_access(int pages, int only_once)
{
    region_size = pages * page_bytes;
    region = mmap(0, region_size, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    set_actions(only_once ? SA_RESETHAND : 0);
    return region;
}
void* pages_behind_the_end_of_a_file(int pages)
{
    char name[] = "/tmp/pages-XXXXXX";
    file = mkstemp(name);
    unlink(name);
    region_size = pages * page_bytes;
    region = mmap(0, region_size, PROT_READ | PROT_WRITE, MAP_SHARED, file, 0);
    set_actions(0);
    return region;
}
void* page_that_nobody_serves(void) { return mmap(0, page_bytes, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0); }
`;

const program = `import { dlopen, toArrayBuffer } from "bun:ffi";
const { symbols } = dlopen(process.argv[2], {
  page_size: { args: [], returns: "i32" },
  pages_served: { args: [], returns: "i32" },
  pages_without_access: { args: ["i32", "i32"], returns: "ptr" },
  pages_behind_the_end_of_a_file: { args: ["i32"], returns: "ptr" },
  page_that_nobody_serves: { args: [], returns: "ptr" },
});
const how = process.argv[3];
const size = symbols.page_size();
const pages = how === "a file" ? symbols.pages_behind_the_end_of_a_file(4) : symbols.pages_without_access(4, how === "only once" ? 1 : 0);
const buffer = toArrayBuffer(pages!, 0, 4 * size);
const bytes = new Uint8Array(buffer);
let sum = 0;
if (how === "a store") for (let page = 0; page < 4; page++) bytes[page * size + 1] = page + 1;
if (how === "a store") for (let page = 0; page < 4; page++) sum += bytes[page * size + 1];
if (how === "a read" || how === "a file") for (let page = 0; page < 4; page++) sum += bytes[page * size];
if (how === "only once") for (let page = 0; page < 4; page++) console.log("page", page, bytes[page * size]);
if (how === "a listener") process.on("SIGSEGV", () => {});
if (how === "a listener") sum += bytes[0];
if (how === "nobody") {
  const lost = new Uint8Array(toArrayBuffer(symbols.page_that_nobody_serves()!, 0, size));
  console.log("reads");
  sum += lost[8];
}
console.log(how, sum, symbols.pages_served());
`;

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({
    cmd: withoutCoreDump(cmd),
    cwd,
    env: { ...bunEnv, ...(!locksEnvironment && { BUN_CRASH_REPORT_URL: "" }), BUN_ENABLE_CRASH_REPORTING: "0" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

// On Linux the executable keeps the action that a library sets. A sanitizer's run time defines sigaction() itself.
describe
  .skipIf(!isLinux || isASAN || !!without("a C compiler"))
  .concurrent("a fault of compiled code on memory of a library", () => {
    const shared = tempDir("aot-a-library-serves-faults", { "pages.ts": program, "library.c": library });
    afterAll(() => shared[Symbol.dispose]());
    const directory = String(shared);
    let made: Promise<[executable: string, path: string]> | undefined;
    const build = () =>
      (made ??= (async () => {
        const [executable, path] = [join(directory, "pages"), join(directory, "libpages.so")];
        const built = await Promise.all([
          run([bunExe(), "build", "--compile", "--aot", "pages.ts", "--outfile", executable], directory),
          run([compiler!, "-shared", "-fPIC", "-w", "-o", path, "library.c"], directory),
        ]);
        expect(built.map(({ stderr, exitCode }) => ({ stderr: exitCode ? stderr : "", exitCode }))).toEqual([
          { stderr: "", exitCode: 0 },
          { stderr: "", exitCode: 0 },
        ]);
        return [executable, path];
      })());

    test.each([
      ["a read", "a read 168 4\n"],
      ["a store", "a store 10 4\n"],
      ["a file", "a file 168 4\n"],
    ])("is served by the library's action: %s", async (how, stdout) => {
      const [executable, path] = await build();
      const compiled = await run([executable, path, how], directory);
      expect(compiled).toEqual({ stdout, stderr: "", exitCode: 0, signalCode: null });
      expect(await run([bunExe(), "pages.ts", path, how], directory)).toEqual(compiled);
    });

    test("an action that is set for one signal serves one", async () => {
      const [executable, path] = await build();
      const { stdout, signalCode } = await run([executable, path, "only once"], directory);
      expect({ stdout, signalCode }).toEqual({ stdout: "page 0 42\n", signalCode: "SIGSEGV" });
      expect(await run([bunExe(), "pages.ts", path, "only once"], directory)).toMatchObject({ stdout, signalCode });
    });

    test("that the library leaves to the default action ends in the report", async () => {
      const [executable, path] = await build();
      const { stdout, stderr, signalCode } = await run([executable, path, "nobody"], directory);
      expect({ stdout, signalCode }).toEqual({ stdout: "reads\n", signalCode: "SIGSEGV" });
      expect(stderr).toContain("Segmentation fault at address 0x");
    });

    // Whoever sets the action last has it. Bun's handler for a signal that JavaScript listens for notes the signal and returns: onto the instruction that raised it, for ever.
    test("under a listener that the program adds behind the library's action ends in the report", async () => {
      const [executable, path] = await build();
      const { stdout, stderr, signalCode } = await run([executable, path, "a listener"], directory);
      expect({ stdout, signalCode }).toEqual({ stdout: "", signalCode: "SIGSEGV" });
      expect(stderr).toContain("Segmentation fault at address 0x");
    });
  });

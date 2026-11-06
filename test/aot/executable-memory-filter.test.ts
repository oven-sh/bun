import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { isHardened } from "./hardened";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

const compiler = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const isX64 = process.arch === "x64";

const intruder = /* c */ `
#define _GNU_SOURCE
#include <fcntl.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/personality.h>
#include <sys/prctl.h>
#include <sys/ptrace.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

static const unsigned char answer_42[] = { 0xb8, 0x2a, 0x00, 0x00, 0x00, 0xc3 };
static FILE *report;

static int is_filtered(void)
{
    char text[4096];
    int file = open("/proc/self/status", O_RDONLY);
    ssize_t size = read(file, text, sizeof text - 1);
    close(file);
    if (size <= 0) return 0;
    text[size] = 0;
    return strstr(text, "\\nSeccomp:\\t2") != NULL;
}

static void say(const char *what, int works) { fprintf(report, "%s: %s\\n", what, works ? "works" : "refused"); }
static int runs(void *code) { return code != MAP_FAILED && ((int (*)(void))code)() == 42; }

static int two_views_of_shared_memory(void)
{
    void *code = mmap(NULL, 4096, PROT_READ | PROT_EXEC, MAP_SHARED | MAP_ANONYMOUS, -1, 0);
    if (code == MAP_FAILED) return 0;
    void *view = mremap(code, 0, 4096, MREMAP_MAYMOVE);
    if (view == MAP_FAILED || mprotect(view, 4096, PROT_READ | PROT_WRITE)) return 0;
    memcpy(view, answer_42, sizeof answer_42);
    return runs(code);
}

static int memory_that_becomes_code(void)
{
    void *memory = mmap(NULL, 4096, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    memcpy(memory, answer_42, sizeof answer_42);
    return !mprotect(memory, 4096, PROT_READ | PROT_EXEC) && runs(memory);
}

static int second_view(void)
{
    void *memory = mmap(NULL, 4096, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_ANONYMOUS, -1, 0);
    return mremap(memory, 0, 4096, MREMAP_MAYMOVE) != MAP_FAILED;
}

static int file_written_just_now(int flags)
{
    int file = memfd_create("code", 0);
    if (file < 0 || write(file, answer_42, sizeof answer_42) != sizeof answer_42 || ftruncate(file, 4096)) return 0;
    return runs(mmap(NULL, 4096, PROT_READ | PROT_EXEC, flags, file, 0));
}

__attribute__((noinline, aligned(64))) static int answer_1(void)
{
    __asm__ volatile("nop; nop; nop; nop; nop; nop; nop; nop; nop; nop; nop; nop");
    return 1;
}

static int code_poked_into_a_forked_child(void)
{
    int status = 0;
    long word = 0;
    pid_t child = fork();
    if (!child) {
        if (ptrace(PTRACE_TRACEME, 0, 0, 0)) _exit(2);
        raise(SIGSTOP);
        _exit(answer_1());
    }
    memcpy(&word, answer_42, sizeof answer_42);
    waitpid(child, &status, WUNTRACED);
    if (WIFSTOPPED(status)) {
        ptrace(PTRACE_POKETEXT, child, (void *)answer_1, (void *)word);
        ptrace(PTRACE_DETACH, child, 0, 0);
        kill(child, SIGCONT);
        waitpid(child, &status, 0);
    }
    return WIFEXITED(status) && WEXITSTATUS(status) == 42;
}

static int another_filter(void)
{
    struct sock_filter allow = BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
    struct sock_fprog program = { 1, &allow };
    return !prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) && !syscall(SYS_seccomp, SECCOMP_SET_MODE_FILTER, 0, &program);
}

static int started_program(int with_an_intruder_of_its_own)
{
    int status = 0;
    pid_t child = fork();
    if (!child) {
        if (with_an_intruder_of_its_own) {
            setenv("LD_PRELOAD", getenv("INTRUDER_LIBRARY"), 1);
            setenv("INTRUDER_IN_A_STARTED_PROGRAM", "1", 1);
        }
        execl("/bin/sh", "sh", "-c", "exit 7", (char *)NULL);
        _exit(1);
    }
    return waitpid(child, &status, 0) == child && WIFEXITED(status) && WEXITSTATUS(status) == (with_an_intruder_of_its_own ? 9 : 7);
}

static void *try_everything(void *unused)
{
    char unfinished[4096];
    const char *path = getenv("INTRUDER_REPORT");
    for (int waited = 0; waited < atoi(getenv("INTRUDER_PATIENCE")) && !is_filtered(); waited++) usleep(1000);
    snprintf(unfinished, sizeof unfinished, "%s.unfinished", path);
    report = fopen(unfinished, "w");
    say("a filter", is_filtered());
    say("two views of shared memory, one to write and one to run", two_views_of_shared_memory());
    say("anonymous memory as code", mmap(NULL, 4096, PROT_READ | PROT_EXEC, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0) != MAP_FAILED);
    say("memory that becomes code", memory_that_becomes_code());
    say("a second view of shared memory", second_view());
    say("a shared file as code", file_written_just_now(MAP_SHARED));
    say("a file written just now as code", file_written_just_now(MAP_PRIVATE));
    say("code poked into a forked child", code_poked_into_a_forked_child());
    say("reading implies executing", personality(READ_IMPLIES_EXEC) != -1);
    say("another filter", another_filter());
    say("a program that is started", started_program(0));
    say("a program that is started and makes code", started_program(1));
    fclose(report);
    rename(unfinished, path);
    return unused;
}

__attribute__((constructor)) static void start(void)
{
    pthread_t thread;
    unsetenv("LD_PRELOAD");
    if (getenv("INTRUDER_IN_A_STARTED_PROGRAM")) _exit(memory_that_becomes_code() && two_views_of_shared_memory() ? 9 : 8);
    pthread_create(&thread, NULL, try_everything, NULL);
}
`;

const waits = `import { existsSync } from "node:fs";
for (let i = 0; i < 2000 && !existsSync(process.env.INTRUDER_REPORT!); i++) await Bun.sleep(5);
console.log("done");
`;
const waitsAndMayLoadALibrary = `import { dlopen } from "bun:ffi";
if (process.argv.length > 9) dlopen(process.argv[9], {});
${waits}`;

async function run(cmd: string[], env: Record<string, string | undefined> = bunEnv) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, undefined, env);
  return { stdout, stderr, exitCode };
}

async function whatAnIntruderCanDo(dir: string, cmd: string[], patience: number) {
  const library = join(dir, "intruder.so");
  expect(
    await run([compiler!, "-shared", "-fPIC", "-O1", "-o", library, join(dir, "intruder.c"), "-lpthread"]),
  ).toMatchObject({ exitCode: 0 });
  const report = join(dir, "report.txt");
  const env = {
    ...bunEnv,
    LD_PRELOAD: library,
    INTRUDER_LIBRARY: library,
    INTRUDER_REPORT: report,
    INTRUDER_PATIENCE: String(patience),
  };
  expect(await run(cmd, env)).toEqual({ stdout: "done\n", stderr: "", exitCode: 0 });
  return Object.fromEntries(
    readFileSync(report, "utf8")
      .trim()
      .split("\n")
      .map(line => line.split(": ")),
  );
}

async function build(dir: string, ...flags: string[]) {
  const executable = join(dir, "program");
  const built = await run([
    bunExe(),
    "build",
    "--compile",
    "--aot",
    ...flags,
    join(dir, "program.ts"),
    "--outfile",
    executable,
  ]);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  return executable;
}

const refusedEverywhere = {
  "a filter": "works",
  "two views of shared memory, one to write and one to run": "refused",
  "anonymous memory as code": "refused",
  "memory that becomes code": "refused",
  "a second view of shared memory": "refused",
  "a shared file as code": "refused",
  "code poked into a forked child": "refused",
  "reading implies executing": "refused",
  "another filter": "works",
  "a program that is started": "works",
  "a program that is started and makes code": "refused",
};

describe.skipIf(!isHardened || !isX64 || !compiler)("an executable of a Bun built with --hardened=on", () => {
  test("without the filter every one of the intruder's ways works, so the cases below test something", async () => {
    using dir = tempDir("aot-executable-memory-filter", { "intruder.c": intruder, "program.ts": waits });
    const found = await whatAnIntruderCanDo(String(dir), [bunExe(), join(String(dir), "program.ts")], 0);
    expect(found).toEqual({
      ...Object.fromEntries(Object.keys(refusedEverywhere).map(way => [way, "works"])),
      "a filter": "refused",
      "a file written just now as code": "works",
    });
  }, 120_000);

  test("makes no new executable memory but from a file, where the program may load libraries", async () => {
    using dir = tempDir("aot-executable-memory-filter", {
      "intruder.c": intruder,
      "program.ts": waitsAndMayLoadALibrary,
    });
    const found = await whatAnIntruderCanDo(String(dir), [await build(String(dir))], 5000);
    expect(found).toEqual({ ...refusedEverywhere, "a file written just now as code": "works" });
  }, 120_000);

  test.skipIf(!canTrim)(
    "makes no new executable memory at all, where nothing that loads libraries is in the executable",
    async () => {
      using dir = tempDir("aot-executable-memory-filter", { "intruder.c": intruder, "program.ts": waits });
      const found = await whatAnIntruderCanDo(String(dir), [await build(String(dir), "--trim")], 5000);
      expect(found).toEqual({ ...refusedEverywhere, "a file written just now as code": "refused" });
    },
    120_000,
  );
});

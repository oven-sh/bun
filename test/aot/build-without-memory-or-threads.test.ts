// The system can refuse a build memory or a thread. The build then goes on with fewer threads, or prints one error and exits with code 1.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isGlibc, tempDir } from "harness";
import { join } from "node:path";
import { describe, test } from "./supported";

// REFUSE=<function>:<n> makes the n-th call of that function fail. Mappings count on the threads that the process starts: those do the compiling.
const shim = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <unistd.h>

static atomic_long calls;

static int is_refused(const char *name) {
  const char *request = getenv("REFUSE");
  size_t length = strlen(name);
  if (!request || strncmp(request, name, length) || request[length] != ':') return 0;
  return atomic_fetch_add(&calls, 1) + 1 == atol(request + length + 1);
}

static int is_main_thread(void) {
  return syscall(SYS_gettid) == getpid();
}

void *mmap(void *address, size_t length, int protection, int flags, int file, off_t offset) {
  if (!is_main_thread() && is_refused("mmap")) {
    errno = ENOMEM;
    return MAP_FAILED;
  }
  return ((void *(*)(void *, size_t, int, int, int, off_t)) dlsym(RTLD_NEXT, "mmap"))(address, length, protection, flags, file, offset);
}

void *mmap64(void *address, size_t length, int protection, int flags, int file, off_t offset) {
  return mmap(address, length, protection, flags, file, offset);
}

int munmap(void *address, size_t length) {
  if (!is_main_thread() && is_refused("munmap")) {
    errno = ENOMEM;
    return -1;
  }
  return ((int (*)(void *, size_t)) dlsym(RTLD_NEXT, "munmap"))(address, length);
}

int pthread_create(pthread_t *thread, const pthread_attr_t *attributes, void *(*start)(void *), void *argument) {
  if (is_refused("pthread_create")) return EAGAIN;
  return ((int (*)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *)) dlsym(RTLD_NEXT, "pthread_create"))(thread, attributes, start, argument);
}
`;

const outOfMemory = "error: Out of memory while compiling";
const noCompilerThread = "error: Failed to start a compiler thread";
const noPoolThread =
  "error: Failed to start a thread of the thread pool: Resource temporarily unavailable (os error 11)";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
describe.skipIf(!isGlibc || isASAN || !cc)("a build that the system refuses memory or a thread", () => {
  const folder = tempDir("aot-build-refused", {
    "shim.c": shim,
    "program.ts": `const words: string[] = ["it", "runs"];\nconsole.log(words.join(" "));\n`,
  });
  const cwd = String(folder);
  const numbers = Array.from({ length: 30 }, (_, index) => index + 1);

  async function run(cmd: string[], env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd,
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stdout,
      errors: stderr.split("\n").filter(line => /^(error|panic)\b/.test(line)),
      exitCode,
      signal: proc.signalCode,
    };
  }

  // What each build said, or what its executable prints.
  async function buildWithEachCallRefused(name: string) {
    const ends: string[] = [];
    const next = numbers.values();
    const buildInTurn = async () => {
      for (const number of next) {
        const executable = join(cwd, `${name}-${number}`);
        const build = [bunExe(), "build", "--compile", "--aot", "program.ts", "--outfile", executable];
        const built = await run(build, { ...bunEnv, LD_PRELOAD: join(cwd, "shim.so"), REFUSE: `${name}:${number}` });
        const end = built.exitCode === 0 ? await run([executable], bunEnv) : built;
        expect({ number, ...end }).toEqual({
          number,
          stdout: built.exitCode === 0 ? "it runs\n" : "",
          errors: built.exitCode === 0 ? [] : [expect.any(String)],
          exitCode: built.exitCode === 0 ? 0 : 1,
          signal: null,
        });
        ends.push(end.errors[0] ?? end.stdout);
        await Bun.file(executable)
          .delete()
          .catch(() => {});
      }
    };
    await Promise.all(Array.from({ length: 6 }, buildInTurn));
    return [...new Set(ends)].sort();
  }

  test("the shim compiles", () => {
    const compiled = Bun.spawnSync({
      cmd: [cc!, "-shared", "-fPIC", "-o", "shim.so", "shim.c", "-ldl"],
      cwd,
      stderr: "pipe",
    });
    expect(compiled.stderr.toString()).toBe("");
  });

  test("a small program builds within 4 GB of address space", async () => {
    const executable = join(cwd, "within-a-limit");
    const build = [bunExe(), "build", "--compile", "--aot", "program.ts", "--outfile", executable];
    expect(await run(["sh", "-c", 'ulimit -v 4194304 && exec "$0" "$@"', ...build], bunEnv)).toEqual({
      stdout: expect.any(String),
      errors: [],
      exitCode: 0,
      signal: null,
    });
    expect((await run([executable], bunEnv)).stdout).toBe("it runs\n");
  }, 120_000);

  test("a refused mapping ends the build with an error", async () => {
    expect(await buildWithEachCallRefused("mmap")).toEqual([outOfMemory, "it runs\n"]);
  }, 300_000);

  test("a mapping that stays does not end the build", async () => {
    expect(await buildWithEachCallRefused("munmap")).toEqual(["it runs\n"]);
  }, 300_000);

  test("a refused thread ends the build with an error where nothing else does its work", async () => {
    expect(await buildWithEachCallRefused("pthread_create")).toEqual([noCompilerThread, noPoolThread, "it runs\n"]);
  }, 300_000);
});

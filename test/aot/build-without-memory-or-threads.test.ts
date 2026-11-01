// Runs alone: it judges by the memory and the threads that a build is given.
// The system can refuse a build memory or a thread. The build then goes on with fewer threads, or prints one error and exits with code 1.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isGlibc, tempDir } from "harness";
import { join } from "node:path";
import { describe, test } from "./supported";

// REFUSE=<call>:<n> makes the n-th such call fail. Mappings count on the threads that the process starts: those do the compiling.
// Starting a thread is the call pthread_create/<start routine>/<stack size>, so threads that do the same work count together.
// THREADS=<file> lists that call for each thread that starts, and again with the name that the thread gives itself.
const shim = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/prctl.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
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

struct thread {
  void *(*start)(void *);
  void *argument;
  char call[64];
};

static atomic_long unnamed_threads;
static __thread struct thread *unnamed_self;

static void list(const char *call, const char *name) {
  char line[128];
  int length = snprintf(line, sizeof line, "%s %s\\n", call, name);
  int file = open(getenv("THREADS"), O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0644);
  if (write(file, line, length) != length) abort();
  close(file);
}

static void list_own_name(const char *name) {
  if (!unnamed_self) return;
  list(unnamed_self->call, name);
  unnamed_self = NULL;
  atomic_fetch_sub(&unnamed_threads, 1);
}

static void *run_listed_thread(void *listed) {
  struct thread thread = *(struct thread *) listed;
  unnamed_self = listed;
  void *result = thread.start(thread.argument);
  if (unnamed_self) atomic_fetch_sub(&unnamed_threads, 1);
  free(listed);
  return result;
}

int pthread_create(pthread_t *handle, const pthread_attr_t *attributes, void *(*start)(void *), void *argument) {
  int (*create)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *) = dlsym(RTLD_NEXT, "pthread_create");
  struct thread thread = { start, argument };
  Dl_info code = { 0 };
  size_t stack_size = 0;
  dladdr((void *) start, &code);
  if (attributes) pthread_attr_getstacksize(attributes, &stack_size);
  snprintf(thread.call, sizeof thread.call, "pthread_create/%zx/%zu", (size_t) ((char *) start - (char *) code.dli_fbase), stack_size);
  if (is_refused(thread.call)) return EAGAIN;
  if (!getenv("THREADS")) return create(handle, attributes, start, argument);
  struct thread *listed = malloc(sizeof thread);
  *listed = thread;
  list(thread.call, "");
  atomic_fetch_add(&unnamed_threads, 1);
  int error = create(handle, attributes, run_listed_thread, listed);
  if (error) atomic_fetch_sub(&unnamed_threads, 1);
  return error;
}

int pthread_setname_np(pthread_t thread, const char *name) {
  if (pthread_equal(thread, pthread_self())) list_own_name(name);
  return ((int (*)(pthread_t, const char *)) dlsym(RTLD_NEXT, "pthread_setname_np"))(thread, name);
}

int prctl(int option, unsigned long a, unsigned long b, unsigned long c, unsigned long d) {
  if (option == PR_SET_NAME) list_own_name((const char *) a);
  return ((int (*)(int, unsigned long, unsigned long, unsigned long, unsigned long)) dlsym(RTLD_NEXT, "prctl"))(option, a, b, c, d);
}

// A thread that has started gets to name itself before the process ends.
void quick_exit(int code) {
  for (int milliseconds = 0; atomic_load(&unnamed_threads) && milliseconds < 10000; milliseconds++) usleep(1000);
  ((void (*)(int)) dlsym(RTLD_NEXT, "quick_exit"))(code);
  __builtin_unreachable();
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

  const build = [bunExe(), "build", "--compile", "--aot", "program.ts", "--outfile"];
  const shimEnv = { ...bunEnv, LD_PRELOAD: join(cwd, "shim.so") };
  const distinct = (ends: string[]) => [...new Set(ends)].sort();

  // What each build said, or what its executable prints.
  async function buildWithEachCallRefused(refusals: { call: string; count: number }[], ...flags: string[]) {
    const ends: string[] = [];
    const requests = refusals.flatMap(({ call, count }) =>
      Array.from({ length: count }, (_, index) => `${call}:${index + 1}`),
    );
    const next = requests.entries();
    const buildInTurn = async () => {
      for (const [index, request] of next) {
        const executable = join(cwd, `refused-${index}`);
        const built = await run([...build, executable, ...flags], { ...shimEnv, REFUSE: request });
        const end = built.exitCode === 0 ? await run([executable], bunEnv) : built;
        expect({ request, ...end }).toEqual({
          request,
          stdout: built.exitCode === 0 ? "it runs\n" : "",
          errors: built.exitCode === 0 ? [] : [expect.any(String)],
          exitCode: built.exitCode === 0 ? 0 : 1,
          signal: null,
        });
        ends[index] = end.errors[0] ?? end.stdout;
        await Bun.file(executable)
          .delete()
          .catch(() => {});
      }
    };
    await Promise.all(Array.from({ length: 6 }, buildInTurn));
    return ends;
  }

  async function listThreadsOfBuild(...flags: string[]) {
    const list = join(cwd, "threads");
    const executable = join(cwd, "listed");
    expect(await run([...build, executable, ...flags], { ...shimEnv, THREADS: list })).toEqual({
      stdout: expect.any(String),
      errors: [],
      exitCode: 0,
      signal: null,
    });
    await Bun.file(executable).delete();
    const threads = new Map<string, { count: number; names: Set<string> }>();
    for (const line of (await Bun.file(list).text()).trimEnd().split("\n")) {
      const [call, name] = line.split(/ (.*)/);
      if (!threads.has(call)) threads.set(call, { count: 0, names: new Set() });
      if (name) threads.get(call)!.names.add(name.replace(/ \d+$/, ""));
      else threads.get(call)!.count++;
    }
    // The next build may start one more.
    return [...threads]
      .map(([call, { count, names }]) => ({ call, count: Math.min(count + 1, 4), name: [...names].sort().join(", ") }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
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
    expect(await run(["sh", "-c", 'ulimit -v 4194304 && exec "$0" "$@"', ...build, executable], bunEnv)).toEqual({
      stdout: expect.any(String),
      errors: [],
      exitCode: 0,
      signal: null,
    });
    expect((await run([executable], bunEnv)).stdout).toBe("it runs\n");
  }, 120_000);

  test("a refused mapping ends the build with an error", async () => {
    expect(distinct(await buildWithEachCallRefused([{ call: "mmap", count: 12 }]))).toEqual([outOfMemory, "it runs\n"]);
  }, 300_000);

  test("a mapping that stays does not end the build", async () => {
    expect(distinct(await buildWithEachCallRefused([{ call: "munmap", count: 6 }]))).toEqual(["it runs\n"]);
  }, 300_000);

  test("a refused thread ends the build with an error where nothing else does its work", async () => {
    // A program this small is otherwise compiled on one thread, which frees what it leaves by itself.
    const threads = await listThreadsOfBuild("--aot-threads=2");
    const ends = await buildWithEachCallRefused(threads, "--aot-threads=2");
    const endsByThread = threads.map(({ name, count }) => {
      const [first, ...later] = ends.splice(0, count);
      return { name, first, later: distinct(later) };
    });
    expect(endsByThread).toEqual([
      { name: "AOT build", first: noCompilerThread, later: ["it runs\n"] },
      { name: "AOT destroyer", first: "it runs\n", later: ["it runs\n"] },
      { name: "AOT memory", first: "it runs\n", later: ["it runs\n"] },
      { name: "Bun Compile", first: noPoolThread, later: ["it runs\n"] },
      { name: "mi-scavenger", first: "it runs\n", later: ["it runs\n"] },
    ]);
  }, 300_000);
});

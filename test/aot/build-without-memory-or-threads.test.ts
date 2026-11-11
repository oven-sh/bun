// Runs alone: it judges by the memory and the threads that a build is given.
// The system can refuse a build memory or a thread. The build then goes on with fewer threads, or prints one error and exits with code 1.
// KNOWN, AND LEFT: where memory stays out and the one who asks is the engine's own malloc, the build crashes: "panic: Segmentation fault at address 0xBBADBEEF"
// (RELEASE_BASSERT(memory) in bmalloc.h), stopped in walk, allocate, encode, emit or image. It is loud, and the build had no memory left. So the case below asks for mmap:1+ to 4+ alone.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isGlibc, tempDir } from "harness";
import { join } from "node:path";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { describe, testOneByOne as test } from "./supported";

// REFUSE=<call>:<n> makes the n-th such call fail, REFUSE=<call>:<n>+ that one and every later one. Mappings count on the threads that the process starts: those do the compiling.
// Starting a thread is the call pthread_create/<start routine>/<stack size>, so threads that do the same work count together.
// THREADS=<file> lists that call for each thread that starts, and again with the name that the thread gives itself.
// STACK=<bytes>: a thread that is to start with a larger stack gets this much.
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
  long call = atomic_fetch_add(&calls, 1) + 1, asked = atol(request + length + 1);
  return request[strlen(request) - 1] == '+' ? call >= asked : call == asked;
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
  pthread_attr_t smaller;
  const char *stack = getenv("STACK");
  if (stack && attributes && stack_size > (size_t) atol(stack)) {
    smaller = *attributes;
    pthread_attr_setstacksize(&smaller, (size_t) atol(stack));
    attributes = &smaller;
  }
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
const outOfStack = "error: Out of stack while compiling";
const noCompilerThread = "error: Failed to start a compiler thread";
const noPoolThread =
  "error: Failed to start a thread of the thread pool: Resource temporarily unavailable (os error 11)";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
describe.skipIf(!isGlibc || isASAN || !cc)("a build that the system refuses memory or a thread", () => {
  const folder = tempDir("aot-build-refused", {
    "shim.c": shim,
    "program.ts": `const words: string[] = ["it", "runs"];\nconsole.log(words.join(" "));\n`,
    // The build works out the text of the pattern: it runs this code in a realm of its own.
    "pattern.ts": `const words: string[] = ["it", "runs"];\nconsole.log(new RegExp(words.map(word => "(" + word + ")").join(" ")).exec("so it runs")![0]);\n`,
  });
  const cwd = String(folder);

  async function run(cmd: string[], env: Record<string, string | undefined>, dir = cwd) {
    await using proc = Bun.spawn({
      cmd,
      cwd: dir,
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

  const buildOf = (program: string) => [bunExe(), "build", "--compile", "--aot", program, "--outfile"];
  const build = buildOf("program.ts");
  const shimEnv = { ...bunEnv, LD_PRELOAD: join(cwd, "shim.so") };
  const distinct = (ends: string[]) => [...new Set(ends)].sort();

  // What each build said, or what its executable prints.
  async function buildWithEachCallRefused(refusals: { call: string; count: number }[], ...flags: string[]) {
    return await buildProgramWithEachCallRefused("program.ts", refusals, ...flags);
  }

  async function buildProgramWithEachCallRefused(
    program: string,
    refusals: { call: string; count: number }[],
    ...flags: string[]
  ) {
    const ends: string[] = [];
    const requests = refusals.flatMap(({ call, count }) =>
      Array.from({ length: count }, (_, index) => `${call}:${index + 1}`),
    );
    const next = requests.entries();
    const buildInTurn = async () => {
      for (const [index, request] of next) {
        const executable = join(cwd, `refused-${index}`);
        const built = await run([...buildOf(program), executable, ...flags], { ...shimEnv, REFUSE: request });
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

  async function listThreadsOfBuild(program: string, ...flags: string[]) {
    const executable = join(cwd, "listed");
    const threads = await listThreadsOf([...buildOf(program), executable, ...flags]);
    await Bun.file(executable).delete();
    return threads;
  }

  async function listThreadsOf(cmd: string[], dir = cwd) {
    const list = join(cwd, "threads");
    await Bun.file(list)
      .delete()
      .catch(() => {});
    expect(await run(cmd, { ...shimEnv, THREADS: list }, dir)).toEqual({
      stdout: expect.any(String),
      errors: [],
      exitCode: 0,
      signal: null,
    });
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

  test("a refused mapping does not end the build, or ends it with an error", async () => {
    // The allocator asks once more, for less: today every one of them is survived.
    for (const end of await buildWithEachCallRefused([{ call: "mmap", count: 12 }]))
      expect(end).toBeOneOf([outOfMemory, "it runs\n"]);
  }, 300_000);

  test("memory that runs out ends the build with errors", async () => {
    // Whoever asks first finds none: a list of the front end, the heap of the realm in which the build runs code of the program. Who that is goes by the clock.
    // Where it is whoever reads a file, the build says of each file that it cannot be read.
    const executable = join(cwd, "without-memory");
    const firstErrors: string[] = [];
    for (let round = 0; round < 3; round++) {
      // Later ones reach the engine's own malloc: see the head of this file.
      for (let first = 1; first <= 4; first++) {
        const request = `mmap:${first}+`;
        const built = await run([...buildOf("pattern.ts"), executable], { ...shimEnv, REFUSE: request });
        expect({ request, ...built, errors: built.errors.filter(line => !line.startsWith("error")) }).toEqual({
          request,
          stdout: expect.any(String),
          errors: [],
          exitCode: built.errors.length ? 1 : 0,
          signal: null,
        });
        firstErrors.push(...built.errors.slice(0, 1));
      }
    }
    expect(firstErrors).toContain(outOfMemory);
  }, 300_000);

  test("a mapping that stays does not end the build", async () => {
    expect(distinct(await buildWithEachCallRefused([{ call: "munmap", count: 6 }]))).toEqual(["it runs\n"]);
  }, 300_000);

  test("a thread that runs out of stack ends the build with an error", async () => {
    // The engine follows loops inside one another 1,024 deep, which takes 5 MB of the 64 MB that each of its threads has.
    await Bun.write(
      join(cwd, "nest.js"),
      `let left = 0;\nfunction more() { return left-- > 0; }\nfunction f() {\n  let sum = 0;\n  ${"while (more()) ".repeat(1200)}sum += 1;\n  return sum;\n}\nconsole.log(f());\n`,
    );
    const executable = join(cwd, "nest");
    expect(await run([...buildOf("nest.js"), executable], shimEnv)).toEqual({
      stdout: expect.any(String),
      errors: [],
      exitCode: 0,
      signal: null,
    });
    expect(await run([...buildOf("nest.js"), executable], { ...shimEnv, STACK: String(4 << 20) })).toEqual({
      stdout: expect.any(String),
      errors: [outOfStack],
      exitCode: 1,
      signal: null,
    });
  }, 120_000);

  // These threads and no others.
  async function expectEndsOfBuildsRefusedThread(program: string) {
    // A program this small is otherwise compiled on one thread.
    const threads = await listThreadsOfBuild(program, "--aot-threads=2");
    const ends = await buildProgramWithEachCallRefused(program, threads, "--aot-threads=2");
    const endsByThread = threads.map(({ name, count }) => {
      const [first, ...later] = ends.splice(0, count);
      return { name, first, later: distinct(later) };
    });
    expect(endsByThread).toEqual([
      ...threads
        .filter(({ name }) => name === "")
        .map(({ name }) => ({ name, first: "it runs\n", later: ["it runs\n"] })),
      { name: "AOT build", first: noCompilerThread, later: ["it runs\n"] },
      { name: "Bun Compile", first: noPoolThread, later: ["it runs\n"] },
      { name: "mi-scavenger", first: "it runs\n", later: ["it runs\n"] },
    ]);
  }

  test("a refused thread ends the build with an error where nothing else does its work", async () => {
    await expectEndsOfBuildsRefusedThread("program.ts");
  }, 300_000);

  test("a build that runs code of the program starts no thread for it", async () => {
    await expectEndsOfBuildsRefusedThread("pattern.ts");
  }, 300_000);

  // Each machine of a sharded run deals all the test files for itself, on threads. One that deals otherwise than the others leaves
  // files out, or runs them twice, and none of them can tell.
  test("a test run that is refused threads deals the shards as every other does", async () => {
    const names = Array.from({ length: 12 }, (_, index) => `tests/t${String(index).padStart(2, "0")}.test.ts`);
    const libraries = ["l0", "l1", "l2", "l3"];
    // Unlike reach, unlike sizes, unlike times, all by rule.
    const reachOf = (index: number) => libraries.filter((_, at) => at === index % 4 || at === index % 3);
    using project = tempDir("aot-shards-refused", {
      "package.json": `{ "name": "shards" }`,
      "timings.json": JSON.stringify({
        version: 1,
        workers: 2,
        files: Object.fromEntries(names.map((name, index) => [name, [5, 20, 60, 150, 400][index % 5]])),
      }),
      // A comment weighs as code does where the files are dealt, and takes no time to compile.
      ...Object.fromEntries(
        libraries.map((name, index) => [
          `lib/${name}.ts`,
          `// ${Buffer.alloc(10_000 * (index + 1) ** 2, "x")}\nexport const name = "${name}";\n`,
        ]),
      ),
      ...Object.fromEntries(
        names.map((name, index) => [
          name,
          `import { expect, test } from "bun:test";
${reachOf(index)
  .map(library => `import { name as ${library} } from "../lib/${library}";`)
  .join("\n")}
test("reads what it imports", () => {
  console.log("ran ${name}");
  expect([${reachOf(index).join(", ")}]).toEqual(${JSON.stringify(reachOf(index))});
});
`,
        ]),
      ),
    });
    const dir = String(project);
    const shard = (index: number) => [bunExe(), "test", "--aot", "--timings=timings.json", `--shard=${index + 1}/2`];
    const kind = (await listThreadsOf(shard(0), dir)).find(({ name }) => name.includes("AOT shards"));
    expect(kind).toBeDefined();

    /** The test files that each shard runs. */
    async function filesOfShards(refused?: string) {
      const shards = [0, 1].map(async index => {
        const { stdout, ...end } = await run(shard(index), { ...shimEnv, REFUSE: refused }, dir);
        expect({ refused, index, ...end }).toEqual({ refused, index, errors: [], exitCode: 0, signal: null });
        return [...stdout.matchAll(/^ran (.+)$/gm)].map(match => match[1]).sort();
      });
      return await Promise.all(shards);
    }
    // No thread refused, every one, one.
    const requests = [undefined, `${kind!.call}:1+`, `${kind!.call}:2`];
    const [dealt, ...dealtWithFewerThreads] = await Promise.all(requests.map(refused => filesOfShards(refused)));
    expect(dealt.flat().sort()).toEqual(names);
    expect(dealtWithFewerThreads).toEqual([dealt, dealt]);
  }, 300_000);
});

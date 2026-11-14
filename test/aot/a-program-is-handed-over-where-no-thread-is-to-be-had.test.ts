import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test --aot` writes the program that it has built into a file without a name and starts Bun again on it. On Linux several threads copy
// a program of 16 MB or more into a mapping of the file. A container's limit of processes counts threads, and the run's other processes
// use it up as well: where the system gives no thread at that moment, the thread that asked copies everything. It used to stop with
// `panic: failed to spawn thread`.
//
// No limit that is set beforehand gets there: the build needs more threads than the copy, and says so and ends. So a shim in front of
// libc refuses every thread from the moment the file is given its room.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const shim = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <unistd.h>

static int has_room;

int fallocate(int descriptor, int mode, off_t offset, off_t length)
{
    int (*real)(int, int, off_t, off_t) = dlsym(RTLD_NEXT, "fallocate");
    has_room = 1;
    return real(descriptor, mode, offset, length);
}

int pthread_create(pthread_t* thread, const pthread_attr_t* attributes, void* (*start)(void*), void* argument)
{
    int (*real)(pthread_t*, const pthread_attr_t*, void* (*)(void*), void*) = dlsym(RTLD_NEXT, "pthread_create");
    if (has_room) {
        static const char said[] = "shim: no thread\\n";
        (void)!write(2, said, sizeof(said) - 1);
        return EAGAIN;
    }
    return real(thread, attributes, start, argument);
}
`;

const count = 280;
const texts = Array.from({ length: count }, (_, index) => JSON.stringify(String(index).padStart(65536, "x")));

test.skipIf(!isLinux || !cc)(
  "the thread that asked copies the program",
  async () => {
    using dir = tempDir("a-program-is-handed-over", {
      "package.json": "{}",
      "shim.c": shim,
      "large.test.js": `
        import { test } from "bun:test";
        const texts = [\n${texts.join(",\n")}\n];
        test("it", () => { console.log("says|", texts.length, texts[process.argv.length % ${count}].length, texts.at(-1).slice(-5)); });`,
    });
    const folder = String(dir);
    const library = join(folder, "shim.so");
    const compiled = await run(
      [cc!, "-shared", "-fPIC", "-o", library, join(folder, "shim.c"), "-ldl"],
      folder,
      bunEnv,
    );
    expect(compiled).toMatchObject({ stderr: "", exitCode: 0 });

    const preloaded = bunEnv.LD_PRELOAD ? `${library}:${bunEnv.LD_PRELOAD}` : library;
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], folder, {
      ...bunEnv,
      LD_PRELOAD: preloaded,
    });
    expect({
      says: stdout.split("\n").filter(line => line.startsWith("says|")),
      // Otherwise the test has not been where it wants to be.
      wasRefusedAThread: stderr.includes("shim: no thread"),
      panic: stderr.split("\n").filter(line => line.includes("panic")),
      exitCode,
    }).toEqual({ says: [`says| ${count} 65536 xx${count - 1}`], wasRefusedAThread: true, panic: [], exitCode: 0 });
  },
  240_000,
);

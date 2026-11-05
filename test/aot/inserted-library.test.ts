import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isMacOS, tempDir } from "harness";
import { join, resolve } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// An ELF shared object with no code, no symbols and no dependencies.
function emptySharedObject() {
  const [segments, dynamic, hash, symbols, strings, size] = [0x40, 0xe8, 0x148, 0x158, 0x170, 0x178];
  const [load, dynamicSegment, stack, readWrite] = [1, 2, 0x6474e551, 6];
  const file = Buffer.alloc(size);
  file.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  file.writeUInt16LE(3, 16);
  file.writeUInt16LE(process.arch === "arm64" ? 183 : 62, 18);
  file.writeUInt32LE(1, 20);
  file.writeUInt32LE(segments, 32);
  file.writeUInt16LE(64, 52);
  file.writeUInt16LE(56, 54);
  file.writeUInt16LE(3, 56);
  [
    [load, 0, size, 0x10000],
    [dynamicSegment, dynamic, hash - dynamic, 8],
    [stack, 0, 0, 16],
  ].forEach(([type, offset, length, alignment], index) => {
    const header = segments + 56 * index;
    file.writeUInt32LE(type, header);
    file.writeUInt32LE(readWrite, header + 4);
    [offset, offset, offset, length, length, alignment].forEach((value, field) =>
      file.writeUInt32LE(value, header + 8 + 8 * field),
    );
  });
  [
    [4, hash],
    [5, strings],
    [6, symbols],
    [10, 1],
    [11, 24],
  ].forEach(([tag, value], index) => {
    file.writeUInt32LE(tag, dynamic + 16 * index);
    file.writeUInt32LE(value, dynamic + 16 * index + 8);
  });
  file.writeUInt32LE(1, hash);
  file.writeUInt32LE(1, hash + 4);
  return file;
}

// Lists the objects of the process from the last to the first. C libraries differ in the order: glibc and musl begin with the executable, bionic begins with the dynamic linker.
const listedInReverse = `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <link.h>
#include <stddef.h>

typedef int (*visitor)(struct dl_phdr_info *, size_t, void *);
struct list { struct dl_phdr_info objects[128]; size_t sizes[128]; int count; };

static int collect(struct dl_phdr_info *object, size_t size, void *data) {
  struct list *list = data;
  if (list->count == 128) return 0;
  list->objects[list->count] = *object;
  list->sizes[list->count++] = size;
  return 0;
}

int dl_iterate_phdr(visitor visit, void *data) {
  struct list list = { .count = 0 };
  ((int (*)(visitor, void *)) dlsym(RTLD_NEXT, "dl_iterate_phdr"))(collect, &list);
  int result = 0;
  while (!result && list.count--) result = visit(&list.objects[list.count], list.sizes[list.count], data);
  return result;
}
`;

const dir = tempDir("aot-inserted-library", {
  "main.ts": `
    import { readFileSync } from "node:fs";
    console.log("hello");
    if (process.platform === "linux") {
      const mapped = new Set(readFileSync("/proc/self/maps", "utf8").match(/inserted-\\d\\.so/g));
      for (const library of [...mapped].sort()) console.log(library);
    }
  `,
  "inserted-1.so": emptySharedObject(),
  "inserted-2.so": emptySharedObject(),
  "listed-in-reverse.c": listedInReverse,
});
afterAll(() => dir[Symbol.dispose]());

let built: Promise<void> | undefined;
const buildOnce = () =>
  (built ??= (async () => {
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "program"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
      stderr: expect.any(String),
      exitCode: 0,
    });
  })());

test.skipIf(!isMacOS && !isLinux)(
  "an executable runs its compiled code with libraries inserted by the loader",
  async () => {
    await buildOnce();
    const libraries = isMacOS
      ? ["/usr/lib/libz.1.dylib", "/usr/lib/libbz2.1.0.dylib"]
      : ["inserted-1.so", "inserted-2.so"];
    for (let count = 0; count <= libraries.length; count++) {
      const inserted = libraries.slice(0, count);
      const result = await run([join(String(dir), "program")], String(dir), {
        ...bunEnv,
        [isMacOS ? "DYLD_INSERT_LIBRARIES" : "LD_PRELOAD"]: count
          ? inserted.map(library => resolve(String(dir), library)).join(":")
          : undefined,
        BUN_JSC_crashIfInterpreterIsUsed: "1",
      });
      expect({ inserted, ...result }).toEqual({
        inserted,
        stdout: ["hello", ...(isLinux ? inserted : []), ""].join("\n"),
        stderr: "",
        exitCode: 0,
      });
    }
  },
  120_000,
);

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
// The sanitizer's run time takes the first object listed for the executable.
test.skipIf(!isLinux || isASAN || !cc)(
  "an executable runs its compiled code wherever the process lists it among its objects",
  async () => {
    await buildOnce();
    const library = join(String(dir), "listed-in-reverse.so");
    expect(await run([cc!, "-shared", "-fPIC", "-o", library, "listed-in-reverse.c", "-ldl"], String(dir))).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const result = await run([join(String(dir), "program")], String(dir), {
      ...bunEnv,
      LD_PRELOAD: library,
      BUN_JSC_crashIfInterpreterIsUsed: "1",
    });
    expect(result).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 });
  },
  120_000,
);

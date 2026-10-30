import { expect, test as testAnywhere } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

// Under LeakSanitizer, and without a list of suppressions, the build ends without a leak record, and the executable ends with
// none that `bun run` of the same program does not end with too. Each runs twice: as built, and with Malloc=1, which sends WTF's
// allocations to the allocator that LeakSanitizer tracks.

const programs: Record<string, Record<string, string>> = {
  "a line of output": {
    "entry.ts": `console.log("hello", 1 + 2);\n`,
  },
  "workers that end": {
    "entry.ts": `const url = new URL("./child.ts", import.meta.url).href;
for (let i = 0; i < 4; i++) {
  const worker = new Worker(url);
  const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve(), { once: true }));
  const answer: number = await new Promise(resolve => {
    worker.onmessage = event => resolve(event.data as number);
    worker.postMessage(i);
  });
  console.log(answer);
  await worker.terminate();
  await closed;
}
`,
    "child.ts": `declare var self: Worker;
self.onmessage = (event: MessageEvent) => {
  postMessage((event.data as number) * 2);
};
`,
  },
  "a server that answers and stops": {
    "entry.ts": `const server = Bun.serve({
  port: 0,
  fetch(request: Request) {
    return Response.json({ path: new URL(request.url).pathname });
  },
});
let length = 0;
for (let i = 0; i < 20; i++) {
  const response = await fetch(\`http://localhost:\${server.port}/a/\${i}\`);
  length += ((await response.json()) as { path: string }).path.length;
}
console.log(length);
await server.stop(true);
`,
  },
  "objects, timers and the platform's library": {
    "entry.ts": `class Point {
  constructor(
    public x: number,
    public name: string,
  ) {}
}
const points = new Map<string, Point>();
for (let i = 0; i < 1000; i++) points.set("k" + i, new Point(i, "v" + i));
await new Promise<void>(resolve => setTimeout(resolve, 5));
const text = JSON.stringify([...points.values()].slice(0, 3));
console.log(text.length, /v(\\d+)/.exec(text)?.[1], new Intl.NumberFormat("en").format(12345.5), crypto.randomUUID().length);
console.log(structuredClone({ list: [1, 2] }).list.length, new TextDecoder().decode(new TextEncoder().encode("é")));
`,
  },
};

const expected: Record<string, string> = {
  "a line of output": "hello 3\n",
  "workers that end": "0\n2\n4\n6\n",
  "a server that answers and stops": "90\n",
  "objects, timers and the platform's library": "61 0 12,345.5 36\n2 é\n",
};

const env = {
  ...bunEnv,
  Malloc: undefined,
  BUN_DESTRUCT_VM_ON_EXIT: "1",
  ASAN_OPTIONS: "allow_user_segv_handler=1:detect_leaks=1:abort_on_error=0",
  LSAN_OPTIONS: "malloc_context_size=30",
};
const envWithSystemMalloc = { ...env, Malloc: "1", LSAN_OPTIONS: "malloc_context_size=30:use_unaligned=1" };

/** The name of a function, without its return type, its arguments and what follows them. */
function getFunctionName(frame: string): string {
  if (frame.startsWith("<")) return frame;
  let depth = 0;
  let name = "";
  for (const character of frame) {
    if (character === "<" || character === "(") depth++;
    else if (character === ">" || character === ")") depth--;
    else if (depth === 0) name += character;
  }
  const words = name
    .replace(/ requires .*$/, "")
    .replace(/ const$/, "")
    .trim()
    .split(" ");
  return words.at(-2)?.endsWith("operator") ? words.slice(-2).join(" ") : words.at(-1)!;
}

const isAllocator = (frame: string) =>
  /^(malloc|calloc|realloc|posix_memalign|aligned_alloc|operator new|pas_|bmalloc_|__rust_|__rdl_|<(alloc|core|std)::)/.test(
    frame,
  ) || /^(WTF|bmalloc|std|alloc|core|hashbrown)::|\boperator new(\[\])?$/.test(getFunctionName(frame));

// Where a frame is, behind its function: an executable and an offset, or a file and a line. The path of the executable may have
// a space in it, and so may the path of a file that starts at the root. Any other path of a file is taken to have none.
const frameLocation = / \([^()]*\+0x[0-9a-f]+\)(?: \(BuildId: [0-9a-f]+\))?$| \/\S.*$| \S+$/;

/**
 * The functions that were called on the stack of a leak record, from the allocator outwards, as the symbolizer names them.
 *
 * A symbolizer that has the debug information of the executable writes a frame for each inlined function too, before the frame
 * of the function that it was inlined into and at the same address, and ends a frame with a file and a line. One that has the
 * table of symbols alone ends a frame with the executable and an offset. Both name the functions that were called alike.
 * Where scripts/runner.node.ts tests a Bun with AddressSanitizer, the first try of this file runs on a copy of it without
 * debug information: a symbolizer finds that under the build ID for `bun run`, and not for an executable, which has a build
 * ID of its own.
 */
function getCalledFunctions(record: string): string[] {
  const functions: string[] = [];
  let address: string | undefined;
  for (const [, at, frame] of record.matchAll(/^ +#\d+ (0x[0-9a-f]+) in (.+)$/gm)) {
    if (at === address) functions.pop();
    address = at;
    functions.push(frame.replace(frameLocation, ""));
  }
  return functions;
}

/** The first function that was called on the stack of a leak record that is neither an allocator nor a container. */
const getAllocatedBy = (record: string) =>
  getFunctionName(getCalledFunctions(record).find(frame => !isAllocator(frame)) ?? record);

/** The leak records of a report, by the function that allocated. */
function getLeakRecords(stderr: string): Map<string, string> {
  const report =
    /\n=+\n==\d+==ERROR: LeakSanitizer: detected memory leaks\n[^]*?\nSUMMARY: AddressSanitizer: .*\n/.exec(
      stderr,
    )?.[0] ?? "";
  expect(stderr.replace(report, "")).toBe("");
  const records = new Map<string, string>();
  for (const record of report.split(/\n(?=(?:Direct|Indirect) leak of )/).slice(1)) {
    const allocatedBy = getAllocatedBy(record);
    records.set(allocatedBy, (records.get(allocatedBy) ?? "") + record);
  }
  return records;
}

// What reads a report is held against text that a symbolizer wrote. That needs no compiler, so these tests run on every Bun.

// The two records of the report of a small program, built in a folder with a space in its name. One function allocated both.
const recordsOfOneFunction = [
  `Direct leak of 8 byte(s) in 1 object(s) allocated from:
    #0 0x5571954a7751 in operator new(unsigned long) (/tmp/with space/leak+0x121751) (BuildId: 0fe0b42cb3e09f5636078826755e831351eb6737)
    #1 0x5571954a8bcf in app::List::makePair() const /tmp/with space/leak.cpp:8:63
    #2 0x5571954a8bb0 in main /tmp/with space/leak.cpp:14:17
    #3 0x7f1699035ca7 in __libc_start_call_main csu/../sysdeps/nptl/libc_start_call_main.h:58:16
`,
  `Indirect leak of 8 byte(s) in 1 object(s) allocated from:
    #0 0x5571954644f8 in malloc (/tmp/with space/leak+0xde4f8) (BuildId: 0fe0b42cb3e09f5636078826755e831351eb6737)
    #1 0x5571954a8bdc in app::List::makePair() const /tmp/with space/leak.cpp:8:93
    #2 0x5571954a8bb0 in main /tmp/with space/leak.cpp:14:17
    #3 0x7f1699035ca7 in __libc_start_call_main csu/../sysdeps/nptl/libc_start_call_main.h:58:16

SUMMARY: AddressSanitizer: 16 byte(s) leaked in 2 allocation(s).
`,
];

testAnywhere("the records of one function stay together", () => {
  const report = `
=================================================================
==881==ERROR: LeakSanitizer: detected memory leaks

${recordsOfOneFunction.join("\n")}`;
  expect(getLeakRecords(report)).toEqual(new Map([["app::List::makePair", recordsOfOneFunction.join("")]]));
});

// Leak records as a symbolizer wrote them, cut down to the frames that decide the name. The first two are one record of a Bun
// built for release: of `bun run`, with debug information, and of an executable, without.
const writtenRecords: [what: string, allocatedBy: string, record: string][] = [
  [
    "functions were inlined and have frames",
    "WebCore::eventNames",
    `Direct leak of 416 byte(s) in 4 object(s) allocated from:
    #0 0x00000662ddc8 in malloc (/tmp/lane-asan/bun-asan-stripped+0x662ddc8) (BuildId: 39e2ae531a0ca5a60c21898cc251d33ea7fbc7f1)
    #1 0x00001ab9da8f in bmalloc::SystemHeap::malloc(unsigned long, bmalloc::FailureAction) /webkitbuild/vendor/WebKit/Source/bmalloc/bmalloc/SystemHeap.cpp:170:20
    #2 0x00001ab9da8f in pas_system_heap_malloc_untagged /webkitbuild/vendor/WebKit/Source/bmalloc/bmalloc/SystemHeap.cpp:319:24
    #8 0x0000114869e9 in WTF::fastMalloc(unsigned long) /webkitbuild/vendor/WebKit/Source/WTF/wtf/FastMalloc.cpp:345:20
    #9 0x000006fb77b7 in WebCore::EventNames::operator new(unsigned long) /workspace/bun/build/release-asan/unified/../../../src/jsc/bindings/webcore/EventNames.h:46:5
    #10 0x000006fb77b7 in std::unique_ptr<WebCore::EventNames, std::default_delete<WebCore::EventNames>> WebCore::EventNames::create<>() /workspace/bun/build/release-asan/unified/../../../src/jsc/bindings/webcore/EventNames.h:64:44
    #11 0x000006fb77b7 in WebCore::eventNames() /workspace/bun/build/release-asan/unified/../../../src/jsc/bindings/webcore/EventNames.cpp:42:23
    #12 0x000007a99bfb in Zig::setGlobalOnMessage(JSC::JSGlobalObject*, long, long, JSC::PropertyName) /workspace/bun/build/release-asan/../../src/jsc/bindings/ZigGlobalObject.cpp:1531:74
`,
  ],
  [
    "functions were inlined and have no frames",
    "WebCore::eventNames",
    `Direct leak of 416 byte(s) in 4 object(s) allocated from:
    #0 0x00000662ddc8 in malloc (/tmp/lane-asan/cap/workers/program+0x662ddc8) (BuildId: 39e2ae531a0ca5a60c21898cc251d33eae107c53)
    #1 0x00001ab9da8f in pas_system_heap_malloc_untagged (/tmp/lane-asan/cap/workers/program+0x1ab9da8f) (BuildId: 39e2ae531a0ca5a60c21898cc251d33eae107c53)
    #4 0x0000114869e9 in WTF::fastMalloc(unsigned long) (/tmp/lane-asan/cap/workers/program+0x114869e9) (BuildId: 39e2ae531a0ca5a60c21898cc251d33eae107c53)
    #5 0x000006fb77b7 in WebCore::eventNames() (/tmp/lane-asan/cap/workers/program+0x6fb77b7) (BuildId: 39e2ae531a0ca5a60c21898cc251d33eae107c53)
    #6 0x000007a99bfb in Zig::setGlobalOnMessage(JSC::JSGlobalObject*, long, long, JSC::PropertyName) (/tmp/lane-asan/cap/workers/program+0x7a99bfb) (BuildId: 39e2ae531a0ca5a60c21898cc251d33eae107c53)
`,
  ],
  [
    "an allocator of bmalloc and one of a class were called, as in a debug build",
    "Zig::GlobalObject::setConsole",
    `Indirect leak of 40 byte(s) in 1 object(s) allocated from:
    #0 0x00000dbec2a8 in malloc (/tmp/lane/p4/program+0xdbec2a8) (BuildId: 69fe649e153fc7867a6c4e30ba315fc6330868fb)
    #1 0x00002f2494fb in bmalloc::SystemHeap::malloc(unsigned long, bmalloc::FailureAction) (/tmp/lane/p4/program+0x2f2494fb) (BuildId: 69fe649e153fc7867a6c4e30ba315fc6330868fb)
    #2 0x00002f24a21a in pas_system_heap_malloc_untagged (/tmp/lane/p4/program+0x2f24a21a) (BuildId: 69fe649e153fc7867a6c4e30ba315fc6330868fb)
    #8 0x0000243df418 in WTF::fastMalloc(unsigned long) (/tmp/lane/p4/program+0x243df418) (BuildId: 69fe649e153fc7867a6c4e30ba315fc6330868fb)
    #9 0x0000100c84f4 in Bun::ConsoleObject::operator new(unsigned long) (/tmp/lane/p4/program+0x100c84f4) (BuildId: 69fe649e153fc7867a6c4e30ba315fc6330868fb)
    #10 0x0000100af03f in Zig::GlobalObject::setConsole(void*) (/tmp/lane/p4/program+0x100af03f) (BuildId: 69fe649e153fc7867a6c4e30ba315fc6330868fb)
`,
  ],
  [
    "a container has a constraint",
    "Zig::GlobalObject::setConsole",
    `Indirect leak of 32 byte(s) in 1 object(s) allocated from:
    #7 0x000011486f50 in WTF::fastCompactMalloc(unsigned long) (/tmp/lane-asan/cap/line/program+0x11486f50) (BuildId: 39e2ae531a0ca5a60c21898cc251d33e44d419e4)
    #8 0x000007ad78cb in WTF::WeakPtrFactory<JSC::ConsoleClient, WTF::DefaultWeakPtrImpl>::initializeIfNeeded(JSC::ConsoleClient const&) const (/tmp/lane-asan/cap/line/program+0x7ad78cb) (BuildId: 39e2ae531a0ca5a60c21898cc251d33e44d419e4)
    #9 0x000007a992c7 in WTF::WeakPtr<JSC::ConsoleClient, WTF::DefaultWeakPtrImpl, WTF::RawPtrTraits<WTF::DefaultWeakPtrImpl>>::WeakPtr(JSC::ConsoleClient const*, WTF::EnableWeakPtrThreadingAssertions) requires !IsSmartPtr<T>::value (/tmp/lane-asan/cap/line/program+0x7a992c7) (BuildId: 39e2ae531a0ca5a60c21898cc251d33e44d419e4)
    #10 0x000007a838d9 in Zig::GlobalObject::setConsole(void*) (/tmp/lane-asan/cap/line/program+0x7a838d9) (BuildId: 39e2ae531a0ca5a60c21898cc251d33e44d419e4)
`,
  ],
  ["a file is in a folder with a space in its name", "app::List::makePair", recordsOfOneFunction[0]],
  [
    "an executable is in a folder with a space in its name",
    "app::List::makePair",
    `Direct leak of 8 byte(s) in 1 object(s) allocated from:
    #0 0x5565e71c5751 in operator new(unsigned long) (/tmp/with space/leak-stripped+0x121751) (BuildId: 0fe0b42cb3e09f5636078826755e831351eb6737)
    #1 0x5565e71c6bcf in app::List::makePair() const (/tmp/with space/leak-stripped+0x122bcf) (BuildId: 0fe0b42cb3e09f5636078826755e831351eb6737)
    #2 0x5565e71c6bb0 in main (/tmp/with space/leak-stripped+0x122bb0) (BuildId: 0fe0b42cb3e09f5636078826755e831351eb6737)
`,
  ],
  [
    "the path of a file does not start at the root",
    "duplocale",
    `Direct leak of 232 byte(s) in 1 object(s) allocated from:
    #0 0x55810dcf64e8 in malloc (/tmp/rel/locale+0xdd4e8) (BuildId: 7e949b90a30865a9828466a03b83560269adca36)
    #1 0x7f195d66ff89 in duplocale locale/duplocale.c:57:12
`,
  ],
];

testAnywhere.each(writtenRecords)(
  "a record has the name of the function that allocated where %s",
  (_, allocatedBy, record) => {
    expect(getAllocatedBy(record)).toBe(allocatedBy);
  },
);

test.skipIf(!isASAN).each(Object.keys(programs))(
  "%s",
  async name => {
    using dir = tempDir("no-leak-records", programs[name]);
    const executable = join(String(dir), "program");
    const { stderr: buildErrors, exitCode: buildExitCode } = await runCommand(
      [bunExe(), "build", "--compile", "--aot", ...Object.keys(programs[name]), "--outfile", executable],
      String(dir),
      env,
    );
    expect(buildErrors).not.toContain("LeakSanitizer");
    expect(buildExitCode).toBe(0);

    const withSystemMalloc = await runCommand(
      [bunExe(), "build", "--compile", "--aot", ...Object.keys(programs[name]), "--outfile", executable + "-2"],
      String(dir),
      envWithSystemMalloc,
    );
    expect(withSystemMalloc.stderr).not.toContain("LeakSanitizer");
    expect(withSystemMalloc.exitCode).toBe(0);

    for (const runEnv of [env, envWithSystemMalloc]) {
      const compiled = await runCommand([executable], String(dir), runEnv);
      expect(compiled.stdout).toBe(expected[name]);
      const records = getLeakRecords(compiled.stderr);
      if (records.size === 0) {
        expect(compiled.exitCode).toBe(0);
        continue;
      }
      const plain = await runCommand([bunExe(), "run", "entry.ts"], String(dir), runEnv);
      expect(plain.stdout).toBe(expected[name]);
      const plainRecords = getLeakRecords(plain.stderr);
      expect(
        [...records].filter(([allocatedBy]) => !plainRecords.has(allocatedBy)).map(([, record]) => record),
      ).toEqual([]);
      expect(compiled.exitCode).toBe(plain.exitCode);
    }
  },
  240_000,
);

import { expect, test as testAnywhere } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

// Under LeakSanitizer, and without a list of suppressions, the build ends without a leak record, and the executable ends with
// none that `bun run` of the same program does not end with too. Each runs twice: as built, and with Malloc=1, which sends WTF's
// allocations to the allocator that LeakSanitizer tracks.

// A record is known by the names on its stack, and a symbolizer takes them from the debug information: inlined functions have no
// other name. CI starts this file with a copy of Bun without it. For that copy the symbolizer reads the debug information of the
// whole Bun, which has the same build ID. An executable has a build ID of its own, so what it is a copy of has to hold it.
const bun = [bunExe().replace(/-stripped$/, ""), bunExe()].find(path => existsSync(path))!;

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
  "workers that serve their default export": {
    "entry.ts": `const url = new URL("./child.ts", import.meta.url).href;
for (let i = 0; i < 2; i++) {
  const worker = new Worker(url);
  const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve(), { once: true }));
  console.log(await new Promise(resolve => worker.addEventListener("message", event => resolve(event.data), { once: true })));
  await worker.terminate();
  await closed;
}
`,
    "child.ts": `export default {
  port: 0,
  fetch() {
    return new Response("served");
  },
};
setTimeout(() => postMessage("serves"), 20);
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
  "workers that serve their default export": "serves\nserves\n",
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

/** Without the line that names the port of a default export that is served. */
const getLines = (stdout: string) => stdout.replace(/^Started (development )?server: .*\n/gm, "");

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
    .replace(/(?: (?:const|volatile|&&?))+$/, "")
    .trim()
    .split(" ");
  // `operator new`, and a conversion to a type of several words: `operator unsigned long`.
  const operator = words.findIndex(word => /(?:^|::)operator$/.test(word));
  return words.slice(operator < 0 ? -1 : operator).join(" ");
}

const isAllocator = (frame: string) =>
  /^(malloc|calloc|realloc|posix_memalign|aligned_alloc|operator new|pas_|bmalloc_|__rust_|__rdl_|__rustc::|<(alloc|core|std)::)/.test(
    frame,
  ) || /^(WTF|bmalloc|std|alloc|core|hashbrown)::|\boperator new(\[\])?$/.test(getFunctionName(frame));

// Where a frame is, behind its function: an executable and an offset, or a file and a line. The path of the executable may have
// a space in it, and so may the path of a file that starts at the root. Any other path of a file is taken to have none.
const frameLocation = / \([^()]*\+0x[0-9a-f]+\)(?: \(BuildId: [0-9a-f]+\))?$| \/\S.*$| \S+$/;

/**
 * The functions that were called on the stack of a leak record, from the allocator outwards, as the symbolizer names them.
 *
 * A symbolizer that has the debug information of the executable writes a frame for each inlined function too, before the frame
 * of the function that it was inlined into and at the same address. Those frames are left out. The name of a function that was
 * called is the same with the debug information and without it. The name of an inlined one may be its last word alone: a Bun
 * built for release has `alloc` for `std::sys::alloc::unix::alloc`, which no list of allocators can tell from another `alloc`.
 * What a failure prints, and what LeakSanitizer holds a list of suppressions against, still has every frame.
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

// The records of the report of a small program, built in a folder with a space in its name. One function allocated the first
// and the last of them.
const recordsOfTwoFunctions = [
  `Direct leak of 64 byte(s) in 1 object(s) allocated from:
    #0 0x55cb5bcc04f8 in malloc (/tmp/with space/leak+0xde4f8) (BuildId: afca4ac47c124a34d173acca8497565626d6c484)
    #1 0x55cb5bd04cd5 in app::List::makePair() const /tmp/with space/leak.cpp:7:9
    #2 0x55cb5bd04c64 in main /tmp/with space/leak.cpp:17:10
    #3 0x7fe37e235ca7 in __libc_start_call_main csu/../sysdeps/nptl/libc_start_call_main.h:58:16
`,
  `Direct leak of 32 byte(s) in 1 object(s) allocated from:
    #0 0x55cb5bcc04f8 in malloc (/tmp/with space/leak+0xde4f8) (BuildId: afca4ac47c124a34d173acca8497565626d6c484)
    #1 0x55cb5bd04d05 in app::List::makeLabel() const /tmp/with space/leak.cpp:10:56
    #2 0x55cb5bd04c6d in main /tmp/with space/leak.cpp:18:10
    #3 0x7fe37e235ca7 in __libc_start_call_main csu/../sysdeps/nptl/libc_start_call_main.h:58:16
`,
  `Direct leak of 16 byte(s) in 1 object(s) allocated from:
    #0 0x55cb5bcc04f8 in malloc (/tmp/with space/leak+0xde4f8) (BuildId: afca4ac47c124a34d173acca8497565626d6c484)
    #1 0x55cb5bd04cdf in app::List::makePair() const /tmp/with space/leak.cpp:8:9
    #2 0x55cb5bd04c64 in main /tmp/with space/leak.cpp:17:10
    #3 0x7fe37e235ca7 in __libc_start_call_main csu/../sysdeps/nptl/libc_start_call_main.h:58:16

SUMMARY: AddressSanitizer: 112 byte(s) leaked in 3 allocation(s).
`,
];

testAnywhere("the records of one function stay together", () => {
  const [first, between, last] = recordsOfTwoFunctions;
  const report = `
=================================================================
==23888==ERROR: LeakSanitizer: detected memory leaks

${recordsOfTwoFunctions.join("\n")}`;
  expect(getLeakRecords(report)).toEqual(
    new Map([
      ["app::List::makePair", first + last],
      ["app::List::makeLabel", between],
    ]),
  );
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
  ["a file is in a folder with a space in its name", "app::List::makePair", recordsOfTwoFunctions[0]],
  [
    "an executable is in a folder with a space in its name",
    "app::List::makePair",
    `Direct leak of 64 byte(s) in 1 object(s) allocated from:
    #0 0x55894de5c4f8 in malloc (/tmp/with space/leak-stripped+0xde4f8) (BuildId: afca4ac47c124a34d173acca8497565626d6c484)
    #1 0x55894dea0cd5 in app::List::makePair() const (/tmp/with space/leak-stripped+0x122cd5) (BuildId: afca4ac47c124a34d173acca8497565626d6c484)
    #2 0x55894dea0c64 in main (/tmp/with space/leak-stripped+0x122c64) (BuildId: afca4ac47c124a34d173acca8497565626d6c484)
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
  [
    "the function is a member for what is const and volatile",
    "app::Text::peek",
    `Direct leak of 32 byte(s) in 1 object(s) allocated from:
    #0 0x55b8dc5954f8 in malloc (/tmp/quals/text+0xde4f8) (BuildId: b70713946b9f6a9f254a1a73de5b0ee8189e4a16)
    #1 0x55b8dc5d9d45 in app::Text::peek() const volatile /tmp/quals/text.cpp:7:87
    #2 0x55b8dc5d9c96 in main /tmp/quals/text.cpp:16:10
`,
  ],
  [
    "the function is a member for rvalues",
    "app::Text::take",
    `Direct leak of 24 byte(s) in 1 object(s) allocated from:
    #0 0x55b8dc5954f8 in malloc (/tmp/quals/text+0xde4f8) (BuildId: b70713946b9f6a9f254a1a73de5b0ee8189e4a16)
    #1 0x55b8dc5d9d25 in app::Text::take() && /tmp/quals/text.cpp:6:75
    #2 0x55b8dc5d9c82 in main /tmp/quals/text.cpp:15:17
`,
  ],
  [
    "the function is a member for lvalues that are const",
    "app::Text::copy",
    `Direct leak of 16 byte(s) in 1 object(s) allocated from:
    #0 0x55b8dc5954f8 in malloc (/tmp/quals/text+0xde4f8) (BuildId: b70713946b9f6a9f254a1a73de5b0ee8189e4a16)
    #1 0x55b8dc5d9d05 in app::Text::copy() const & /tmp/quals/text.cpp:5:80
    #2 0x55b8dc5d9c6e in main /tmp/quals/text.cpp:14:10
`,
  ],
  [
    "the function converts to a type of two words",
    "app::Id::operator unsigned long",
    `Direct leak of 24 byte(s) in 1 object(s) allocated from:
    #0 0x55f0dd7f34f8 in malloc (/tmp/conv/id+0xde4f8) (BuildId: caab9c535e49b890b36b56634b306bec21bc68af)
    #1 0x55f0dd837ce5 in app::Id::operator unsigned long() const /tmp/conv/id.cpp:5:103
    #2 0x55f0dd837c60 in main /tmp/conv/id.cpp:11:39
`,
  ],
  [
    "inlined functions of Rust have their last word for a name",
    "<bun_runtime::server::NewServer<false, true>>::init",
    `Direct leak of 3080704 byte(s) in 2 object(s) allocated from:
    #0 0x000006a15ac8 in malloc crtstuff.c
    #1 0x00000ccd40ac in alloc /opt/rust/toolchains/nightly-2026-09-15-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/std/src/sys/alloc/unix.rs:31:18
    #4 0x00000ccd40ac in <std::alloc::System as core::alloc::global::GlobalAlloc>::alloc /opt/rust/toolchains/nightly-2026-09-15-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/core/src/alloc/global.rs:361:20
    #15 0x00000bf87591 in request_pool /workspace/bun/src/runtime/server/mod.rs:3516:22
    #16 0x00000bf87591 in <bun_runtime::server::NewServer<false, true>>::init /workspace/bun/src/runtime/server/mod.rs:2205:27
    #17 0x00000c7501f9 in serve /workspace/bun/src/runtime/api/BunObject.rs:1142:26
`,
  ],
  [
    "the allocator of Rust was called, as in a debug build",
    "<bun_collections::hive_array::Fallback<bun_runtime::server::request_context::RequestContext<bun_runtime::server::NewServer<false, true>, false, true, false>, 2048>>::new_boxed",
    `Direct leak of 1540352 byte(s) in 1 object(s) allocated from:
    #0 0x00000e3f43a8 in malloc crtstuff.c
    #4 0x0000167814a2 in <std::alloc::System as core::alloc::global::GlobalAlloc>::alloc /opt/rust/toolchains/nightly-2026-09-15-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/core/src/alloc/global.rs:361:20
    #5 0x00001a0f3ec0 in __rustc::__rust_alloc /workspace/bun/src/runtime/bin_entry/mod.rs:53:15
    #6 0x000016779f77 in alloc::alloc::alloc /opt/rust/toolchains/nightly-2026-09-15-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/alloc/src/alloc.rs:131:9
    #10 0x000019af2e77 in alloc::boxed::box_new_uninit /opt/rust/toolchains/nightly-2026-09-15-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/alloc/src/boxed.rs:251:18
    #12 0x0000191a2836 in <bun_collections::hive_array::Fallback<bun_runtime::server::request_context::RequestContext<bun_runtime::server::NewServer<false, true>, false, true, false>, 2048>>::new_boxed /workspace/bun/src/collections/hive_array.rs:594:25
    #13 0x000019d0318c in <bun_runtime::server::NewServer<false, true> as bun_runtime::server::ServerPools<false, true>>::request_pool::{closure#0} /workspace/bun/src/runtime/server/mod.rs:3522:29
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
      [bun, "build", "--compile", "--aot", ...Object.keys(programs[name]), "--outfile", executable],
      String(dir),
      env,
    );
    expect(buildErrors).not.toContain("LeakSanitizer");
    expect(buildExitCode).toBe(0);

    const withSystemMalloc = await runCommand(
      [bun, "build", "--compile", "--aot", ...Object.keys(programs[name]), "--outfile", executable + "-2"],
      String(dir),
      envWithSystemMalloc,
    );
    expect(withSystemMalloc.stderr).not.toContain("LeakSanitizer");
    expect(withSystemMalloc.exitCode).toBe(0);

    for (const runEnv of [env, envWithSystemMalloc]) {
      const compiled = await runCommand([executable], String(dir), runEnv);
      expect(getLines(compiled.stdout)).toBe(expected[name]);
      const records = getLeakRecords(compiled.stderr);
      if (records.size === 0) {
        expect(compiled.exitCode).toBe(0);
        continue;
      }
      const plain = await runCommand([bun, "run", "entry.ts"], String(dir), runEnv);
      expect(getLines(plain.stdout)).toBe(expected[name]);
      const plainRecords = getLeakRecords(plain.stderr);
      expect(
        [...records].filter(([allocatedBy]) => !plainRecords.has(allocatedBy)).map(([, record]) => record),
      ).toEqual([]);
      expect(compiled.exitCode).toBe(plain.exitCode);
    }
  },
  240_000,
);

// Plain Bun serves the default export of an entry point from the evaluation of a module, an executable from a function of its own. The list names both.
test.skipIf(!isASAN)(
  "the list of suppressions hides for an executable what it hides for plain Bun",
  async () => {
    const name = "workers that serve their default export";
    using dir = tempDir("no-leak-records", programs[name]);
    const executable = join(String(dir), "program");
    const withList = {
      ...env,
      LSAN_OPTIONS: `malloc_context_size=30:print_suppressions=0:suppressions=${join(import.meta.dir, "..", "leaksan.supp")}`,
    };
    const build = await runCommand(
      [bun, "build", "--compile", "--aot", ...Object.keys(programs[name]), "--outfile", executable],
      String(dir),
      env,
    );
    expect(build.exitCode).toBe(0);
    const plain = await runCommand([bun, "run", "entry.ts"], String(dir), withList);
    const compiled = await runCommand([executable], String(dir), withList);
    expect(getLines(compiled.stdout)).toBe(expected[name]);
    const plainRecords = getLeakRecords(plain.stderr);
    expect(
      [...getLeakRecords(compiled.stderr)]
        .filter(([allocatedBy]) => !plainRecords.has(allocatedBy))
        .map(([, record]) => record),
    ).toEqual([]);
    expect(compiled.exitCode).toBe(plain.exitCode);
  },
  240_000,
);

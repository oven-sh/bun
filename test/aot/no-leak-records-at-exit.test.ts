import { expect } from "bun:test";
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

function getFunctionName(frame: string): string {
  if (frame.startsWith("<")) return frame;
  let depth = 0;
  let name = "";
  for (const character of frame) {
    if (character === "<" || character === "(") depth++;
    else if (character === ">" || character === ")") depth--;
    else if (depth === 0) name += character;
  }
  return name
    .replace(/ const$/, "")
    .trim()
    .split(" ")
    .at(-1)!;
}

const isAllocator = (frame: string) =>
  /^(malloc|calloc|realloc|posix_memalign|aligned_alloc|operator new|pas_|bmalloc_|__rust_|__rdl_|<(alloc|core|std)::)/.test(
    frame,
  ) || /^(WTF|std|alloc|core|hashbrown)::/.test(getFunctionName(frame));

/** Each leak record of a report, by the first function on its stack that is neither an allocator nor a container. */
function getLeakRecords(stderr: string): Map<string, string> {
  const report =
    /\n=+\n==\d+==ERROR: LeakSanitizer: detected memory leaks\n[^]*?\nSUMMARY: AddressSanitizer: .*\n/.exec(
      stderr,
    )?.[0] ?? "";
  expect(stderr.replace(report, "")).toBe("");
  const records = new Map<string, string>();
  for (const record of report.split(/\n(?=(?:Direct|Indirect) leak of )/).slice(1)) {
    const frames = Array.from(
      record.matchAll(/^ +#\d+ 0x[0-9a-f]+ in (.+?)(?: \/\S+| \(\S+\+0x[0-9a-f]+\).*)?$/gm),
      match => match[1],
    );
    records.set(getFunctionName(frames.find(frame => !isAllocator(frame)) ?? record), record);
  }
  return records;
}

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

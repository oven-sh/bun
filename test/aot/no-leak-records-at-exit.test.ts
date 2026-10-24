import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

// Under LeakSanitizer the build and the executable both end without a leak record, and without a list of suppressions: a record
// that is suppressed still starts the symbolizer, which takes seconds to read a Bun with debug information, at every exit.
// What the run time keeps for the life of the process has to be reachable or come from the allocator LeakSanitizer does not track.

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
      { ...env, Malloc: "1", LSAN_OPTIONS: "malloc_context_size=30:use_unaligned=1" },
    );
    expect(withSystemMalloc.stderr).not.toContain("LeakSanitizer");
    expect(withSystemMalloc.exitCode).toBe(0);

    const { stdout, stderr, exitCode } = await runCommand([executable], String(dir), env);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected[name]);
    expect(exitCode).toBe(0);
  },
  240_000,
);

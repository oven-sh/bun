import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const testFile = (name: string) => `
import { expect, test } from "bun:test";
import { increment } from "./counter";
test("${name}", () => {
  expect(increment()).toBe(2);
  expect((globalThis as any).leftBehind).toBeUndefined();
  (globalThis as any).leftBehind = "${name}";
});`;

const files = {
  "counter.ts": `let count = 0;\nexport function increment(): number { return ++count; }`,
  "preload.ts": `import { increment } from "./counter";\nincrement();`,
  "a.test.ts": testFile("a"),
  "b.test.ts": testFile("b"),
  "c.test.ts": testFile("c"),
};

async function runTests(flags: string[], moreFiles: Record<string, string> = {}) {
  using dir = tempDir("bun-test-isolate-compiled", { ...files, ...moreFiles });
  const cmd = [bunExe(), "test", "--aot", "--preload", "./preload.ts", ...flags];
  const { stdout, stderr, exitCode } = await run(cmd, String(dir), { ...bunEnv, BUN_AOT_VERBOSE: "1" });
  const output = stdout + stderr;
  return {
    compiledPreloads: output
      .split("\n")
      .filter(line => line.startsWith("[aot] module: ") && line.endsWith("preload.ts")).length,
    summary: output.match(/^ \d+ (pass|fail)$/gm),
    typeErrors: output.split("warn: TS2322").length - 1,
    exitCode,
  };
}

test("--isolate gives each compiled test file fresh module state", async () => {
  expect(await runTests(["--isolate"])).toEqual({
    compiledPreloads: 3,
    summary: [" 3 pass", " 0 fail"],
    typeErrors: 0,
    exitCode: 0,
  });
});

test("without --isolate compiled test files share module state", async () => {
  expect(await runTests([])).toEqual({
    compiledPreloads: 1,
    summary: [" 1 pass", " 2 fail"],
    typeErrors: 0,
    exitCode: 1,
  });
});

test("--parallel runs compiled test files in worker processes", async () => {
  const { summary, exitCode } = await runTests(["--parallel=2"]);
  expect({ summary, exitCode }).toEqual({ summary: [" 3 pass", " 0 fail"], exitCode: 0 });
});

test("--rerun-each runs a compiled test file again over the module state of the runs before", async () => {
  expect(await runTests(["--rerun-each=2"])).toEqual({
    compiledPreloads: 1,
    summary: [" 1 pass", " 5 fail"],
    typeErrors: 0,
    exitCode: 1,
  });
});

test("--rerun-each with --isolate gives each compiled test file fresh module state, and not each run", async () => {
  expect(await runTests(["--rerun-each=2", "--isolate"])).toEqual({
    compiledPreloads: 3,
    summary: [" 3 pass", " 3 fail"],
    typeErrors: 0,
    exitCode: 1,
  });
});

test.each(["--isolate", "--parallel=2"])("a type error is a warning under %s, and the file runs", async flag => {
  const withTypeError = {
    "typed-wrong.ts": `export const size: number = "text";`,
    "wrong.test.ts": `import { expect, test } from "bun:test";\nimport { size } from "./typed-wrong";\nconst n: number = "text";\ntest("wrong", () => { expect([n, size]).toEqual(["text", "text"]); });`,
  };
  expect(await runTests([flag], withTypeError)).toEqual({
    compiledPreloads: 4,
    summary: [" 4 pass", " 0 fail"],
    typeErrors: 2,
    exitCode: 0,
  });
});

test.each(["--isolate", "--parallel=2"])("a test file that cannot be compiled fails alone under %s", async flag => {
  const withoutItsImport = {
    "wrong.test.ts": `import { test } from "bun:test";\nimport { nothing } from "./nowhere";\ntest("wrong", () => { nothing(); });`,
  };
  // The preload runs before the file fails to load, as under plain `bun test`: once for each of the four.
  expect(await runTests([flag], withoutItsImport)).toEqual({
    compiledPreloads: 4,
    summary: [" 3 pass", " 1 fail"],
    typeErrors: 0,
    exitCode: 1,
  });
});

test.each([{ flags: [] }, { flags: ["--isolate"] }, { flags: ["--isolate", "--parallel=2"] }])(
  "a test file that cannot be compiled is counted as plain counts one that does not load: $flags",
  async ({ flags }) => {
    using dir = tempDir("bun-test-counts-a-broken-file", {
      "good.test.ts": `import { expect, test } from "bun:test";\ntest("runs", () => { expect(1).toBe(1); });`,
      "broken.test.ts": `import { test } from "bun:test";\ntest("never runs", () => {});\nconst a = 1;\nconst a = 2;`,
    });
    const counts = async (...more: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...more, ...flags], String(dir), bunEnv);
      return { counts: (stdout + stderr).match(/^ \d+ (pass|fail|errors?)$/gm), exitCode };
    };
    const plain = await counts();
    expect(plain).toEqual({ counts: [" 1 pass", " 1 fail", " 1 error"], exitCode: 1 });
    expect(await counts("--aot")).toEqual(plain);
  },
);

test.each([
  { run: "every test file", paths: [], passes: 3 },
  { run: "the other test files", paths: ["./uses-helper.test.ts", "./reads.test.ts"], passes: 2 },
])("a global declaration in one test file stops no other file: $run", async ({ paths, passes }) => {
  using dir = tempDir("bun-test-isolate-compiled", {
    "tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
    "helper.ts": `export function readSize(text: string): number { const { size } = JSON.parse(text); return size; }`,
    "declares.test.ts": `
import { expect, test } from "bun:test";
declare global { interface JSON { parse<T = unknown>(text: string): T } }
test("declares", () => { expect(JSON.parse<{ size: number }>('{"size":1}').size).toBe(1); });`,
    "uses-helper.test.ts": `
import { expect, test } from "bun:test";
import { readSize } from "./helper";
test("uses the helper", () => { expect(readSize('{"size":2}')).toBe(2); });`,
    "reads.test.ts": `
import { expect, test } from "bun:test";
test("reads", () => { expect(JSON.parse('{"size":3}').size).toBe(3); });`,
  });
  const cmd = [bunExe(), "test", "--aot", "--isolate", ...paths];
  const { stdout, stderr, exitCode } = await run(cmd, String(dir), bunEnv);
  const output = stdout + stderr;
  expect(output.match(/^ \d+ (pass|fail)$/gm)).toEqual([` ${passes} pass`, " 0 fail"]);
  expect(output).not.toContain("error: TS");
  expect(output.match(/^warn: .*$/gm)).toEqual([
    expect.stringContaining("Files with type errors are compiled without their types: 2 in this run"),
    expect.stringContaining("TS2339"),
    expect.stringContaining("TS2571"),
  ]);
  expect(exitCode).toBe(0);
});

test("a typed file takes no type from a file with type errors for a fact", async () => {
  using dir = tempDir("bun-test-isolate-compiled", {
    "tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
    "mistyped.ts": `
export const size: number = "text";
export const point: { x: number; y: number } = { x: "a", y: 2 };
export class Pair { left: number = "l"; right: number = 2; sum(): number { return this.left + this.right; } }
export function make(): number[] { return ["a", "b"]; }
export function give(): number { const it: number = "given"; return it; }
export interface Shape { side: number }
export const shape: Shape = { side: "wide" };
export let counter: number = 0;
export function bump(): void { counter = "bumped"; }`,
    "clean.ts": `
import { size, point, Pair, make, give, shape, counter, bump, type Shape } from "./mistyped";
export function add(a: number): number { return size + a; }
export function both(): number { return point.x + point.y; }
export function pair(): number { const p = new Pair(); return p.left + p.right; }
export function pairSum(): number { return new Pair().sum(); }
export function total(): number { let t = 0; for (const n of make()) t += n; return t; }
export function twice(): number { return give() * 2; }
export function side(s: Shape): number { return s.side + 1; }
export function ofShape(): number { return side(shape); }
export function bumped(): number { bump(); return counter + 1; }
export class Wide extends Pair { wide(): number { return this.left + 1; } }`,
    "a.test.ts": `
import { test } from "bun:test";
import { add, both, pair, pairSum, total, twice, ofShape, bumped, Wide } from "./clean";
test("values", () => {
  for (let i = 0; i < 3; i++)
    console.log(JSON.stringify([add(1), both(), pair(), pairSum(), total(), twice(), ofShape(), bumped(), new Wide().wide()]));
});`,
  });
  const values = `["text1","a2","l2","l2","0ab",null,"wide1","bumped1","l1"]\n`.repeat(3);
  for (const flags of [[], ["--aot"]]) {
    const { stdout, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    expect({ stdout: stdout.slice(stdout.indexOf("[")), exitCode }).toEqual({ stdout: values, exitCode: 0 });
  }
});

test("what node:http keeps of a response is prepared by the instance of the file that looks", async () => {
  const file = `
import { expect, test } from "bun:test";
import http from "node:http";
test("headers", done => {
  const server = http.createServer((req: any, res: any) => {
    res.setHeader("x-a", "1");
    const key = Object.getOwnPropertySymbols(res).find(symbol => String(symbol) === "Symbol(kOutHeaders)")!;
    const headers = res[key];
    expect(Object.keys(headers)).toEqual(["x-a"]);
    expect(res.getHeaderNames()).toEqual(["x-a"]);
    res.end("x");
  });
  server.listen(0, async () => {
    const response = await fetch("http://127.0.0.1:" + (server.address() as any).port + "/");
    expect(response.headers.get("x-a")).toBe("1");
    await response.text();
    server.close();
    done();
  });
});`;
  using dir = tempDir("bun-test-isolate-compiled", {
    "tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
    "a.test.ts": file,
    "b.test.ts": file,
  });
  const cmd = [bunExe(), "test", "--aot", "--isolate", "--timeout=60000"];
  const { stdout, stderr, exitCode } = await run(cmd, String(dir), bunEnv);
  const summary = (stdout + stderr).match(/^ \d+ (pass|fail)$/gm);
  expect({ summary, exitCode, said: exitCode === 0 ? "" : stdout + stderr }).toEqual({
    summary: [" 2 pass", " 0 fail"],
    exitCode: 0,
    said: "",
  });
});

test("method calls on strings stay cached in later test files", async () => {
  const readsStrings = (name: string) => `
import { expect, test } from "bun:test";
import { sliced } from "./reads";
test("${name}", () => { expect(sliced(JSON.parse('["abc","defg","hi"]'))).toBe(20_000); });`;
  using dir = tempDir("bun-test-isolate-compiled", {
    "reads.ts": `export function sliced(values: any[]): number {
  let sum = 0;
  for (let i = 0; i < 10_000; i++) sum += values[i % 3].slice(1).length;
  return sum;
}`,
    "a.test.ts": readsStrings("a"),
    "b.test.ts": readsStrings("b"),
    "c.test.ts": readsStrings("c"),
  });
  const countsPath = join(String(dir), "counts");
  const env = { ...bunEnv, [runtimeEnvironment.countsPath]: countsPath };
  const { exitCode } = await run([bunExe(), "test", "--aot", "--isolate"], String(dir), env);
  expect(exitCode).toBe(0);
  let operations = 0;
  for (const line of readFileSync(countsPath, "utf8").split("\n")) {
    const [count, name] = line.split("\t");
    if (name?.startsWith("operation:")) operations += Number(count);
  }
  expect(operations).toBeGreaterThan(0);
  expect(operations).toBeLessThan(1_000);
});

// The frame of the runner's own function may still name the global of the file before the last, as it does in plain Bun: each build lays that frame out anew.
// So the file that is asked about hangs a mark on its global, another file follows, and the last one counts the marks.
const mark = `(globalThis as any).mark = new BigInt64Array(1);`;
const fileThatDoesNothing = `
import { expect, test } from "bun:test";
test("nothing", () => { expect(1).toBe(1); });`;
const lastFile = (imports: string) => `
import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
${imports}
Bun.gc(true);
const { globalObjectCount, objectTypeCounts } = heapStats();
test("the global of the marked file is gone", () => {
  expect(objectTypeCounts.BigInt64Array ?? 0).toBe(0);
  expect(globalObjectCount).toBeLessThanOrEqual(2);
});`;

test("the global of a finished test file is gone once another file has run", async () => {
  // A function that is renamed at run time names its frames by its function object, which each call writes down for the collector.
  const { summary, exitCode } = await runTests(["--isolate", "./d.test.ts", "./e.test.ts", "./f.test.ts"], {
    "named.ts": `
export function make(label: string) {
  return function inner(depth: number): string {
    return depth ? inner(depth - 1) : String(new Error(label).stack).split("\\n")[1];
  };
}
export function rename(target: any, name: string) {
  target.displayName = name;
}`,
    "d.test.ts": `
import { expect, test } from "bun:test";
import { make, rename } from "./named";
${mark}
test("frames are named by the function object", () => {
  const made = [make("one"), make("two"), make("three")];
  for (const each of made) rename(JSON.parse("[0]")[0] ? {} : each, "renamed");
  for (let i = 0; i < 50; i++) for (const each of made) expect(each(i & 7)).toContain("renamed");
});`,
    "e.test.ts": fileThatDoesNothing,
    "f.test.ts": lastFile(`import "./named";`),
  });
  expect({ summary, exitCode }).toEqual({ summary: [" 3 pass", " 0 fail"], exitCode: 0 });
});

test("heapStats() does not keep the test file that called it", async () => {
  using dir = tempDir("bun-test-isolate-heap-stats", {
    "d.test.ts": `
import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
${mark}
heapStats();
test("nothing", () => { expect(1).toBe(1); });`,
    "e.test.ts": fileThatDoesNothing,
    "f.test.ts": lastFile(""),
  });
  const cmd = [bunExe(), "test", "--aot", "--isolate", "./d.test.ts", "./e.test.ts", "./f.test.ts"];
  // Collections between the two files would write over the stack that heapStats() left behind.
  const env = { ...bunEnv, BUN_GARBAGE_COLLECTOR_LEVEL: "0" };
  const { stdout, stderr, exitCode } = await run(cmd, String(dir), env);
  expect((stdout + stderr).match(/^ \d+ (pass|fail)$/gm)).toEqual([" 3 pass", " 0 fail"]);
  expect(exitCode).toBe(0);
});

test("a regular expression with named groups does not keep the test file that matched with it", async () => {
  // Every realm that writes the same pattern gets the same RegExp of the VM, which remembers the Structure of its last `groups` object.
  const { summary, exitCode } = await runTests(["--isolate", "./d.test.ts", "./e.test.ts", "./f.test.ts"], {
    "dates.ts": `
export const pattern = /(?<year>\\d{4})-(?<month>\\d\\d)/;
export function yearOf(text: string): string {
  return pattern.exec(text)!.groups!.year;
}`,
    "d.test.ts": `
import { expect, test } from "bun:test";
import { yearOf } from "./dates";
${mark}
test("matches", () => { expect(yearOf("2026-10")).toBe("2026"); });`,
    "e.test.ts": `
import { expect, test } from "bun:test";
import { pattern } from "./dates";
test("only writes the pattern", () => { expect(pattern.flags).toBe(""); });`,
    "f.test.ts": lastFile(`import "./dates";`),
  });
  expect({ summary, exitCode }).toEqual({ summary: [" 3 pass", " 0 fail"], exitCode: 0 });
});

test.skipIf(isWindows)("a read that never ends does not keep the test file that began it", async () => {
  const { summary, exitCode } = await runTests(["--isolate", "./d.test.ts", "./e.test.ts", "./f.test.ts"], {
    "d.test.ts": `
import { expect, test } from "bun:test";
import { constants, openSync } from "node:fs";
import { join } from "node:path";
${mark}
test("reads a pipe that nobody writes", async () => {
  const path = join(import.meta.dir, "never-written");
  expect(Bun.spawnSync(["mkfifo", path]).exitCode).toBe(0);
  Bun.file(openSync(path, constants.O_RDWR | constants.O_NONBLOCK)).stream().getReader().read();
  await Bun.sleep(5);
});`,
    "e.test.ts": `
import { expect, test } from "bun:test";
test("nothing", () => { expect(1).toBe(1); });`,
    "f.test.ts": lastFile(""),
  });
  expect({ summary, exitCode }).toEqual({ summary: [" 3 pass", " 0 fail"], exitCode: 0 });
});

test.skipIf(!isLinux)("process.stdout and process.stderr give their descriptors back with the test file", async () => {
  const countsDescriptors = `
import { expect, test } from "bun:test";
import { appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
test("counts", () => {
  process.stdout.write("");
  process.stderr.write("");
  appendFileSync(join(import.meta.dir, "counts"), readdirSync("/proc/self/fd").length + "\\n");
  expect(1).toBe(1);
});`;
  const { summary, exitCode } = await runTests(["--isolate", "./d.test.ts", "./e.test.ts", "./f.test.ts"], {
    "d.test.ts": countsDescriptors,
    "e.test.ts": countsDescriptors,
    "f.test.ts": `
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
test("as many in the second file as in the first", () => {
  const [first, second] = readFileSync(join(import.meta.dir, "counts"), "utf8").trim().split("\\n");
  expect(second).toBe(first);
});`,
  });
  expect({ summary, exitCode }).toEqual({ summary: [" 3 pass", " 0 fail"], exitCode: 0 });
});

test("what a test file's close handlers write to process.stdout is still printed", async () => {
  using dir = tempDir("bun-test-isolate-last-words", {
    "d.test.ts": `
import { expect, test } from "bun:test";
test("leaves a connection open", async () => {
  process.stdout.write("");
  const nothing = () => {};
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: nothing } });
  await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    socket: { data: nothing, close: () => void process.stdout.write("the connection was closed\\n") },
  });
  expect(1).toBe(1);
});`,
    "e.test.ts": `
import { expect, test } from "bun:test";
test("nothing", () => { expect(1).toBe(1); });`,
  });
  const cmd = [bunExe(), "test", "--aot", "--isolate", "./d.test.ts", "./e.test.ts"];
  const { stdout, exitCode } = await run(cmd, String(dir), bunEnv);
  expect(stdout).toContain("the connection was closed");
  expect(exitCode).toBe(0);
});

test("bun:sql does not keep the test file that loaded it", async () => {
  const { summary, exitCode } = await runTests(["--isolate", "./d.test.ts", "./e.test.ts", "./f.test.ts"], {
    "d.test.ts": `
import { SQL } from "bun";
import { expect, test } from "bun:test";
${mark}
test("loads both adapters", () => {
  expect(typeof new SQL("postgres://localhost:1/nothing").close).toBe("function");
  expect(typeof new SQL("mysql://localhost:1/nothing").close).toBe("function");
});`,
    "e.test.ts": `
import { expect, test } from "bun:test";
test("nothing", () => { expect(1).toBe(1); });`,
    "f.test.ts": lastFile(""),
  });
  expect({ summary, exitCode }).toEqual({ summary: [" 3 pass", " 0 fail"], exitCode: 0 });
});

test("a stand-in does not keep the test file that read it", async () => {
  const { summary, exitCode } = await runTests(["--isolate", "./d.test.ts", "./e.test.ts", "./f.test.ts"], {
    "d.test.ts": `
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
${mark}
const hidden = (text: string) => new Function(JSON.parse(JSON.stringify(text)))();
test("reads what no code that the compiler can follow reads", () => {
  // A member that the host makes, a getter of the library, and the error of a call.
  const sql = (Bun as any)["s" + "ql".slice(0)];
  expect(Reflect.ownKeys(sql).includes("unsafe")).toBe(false);
  expect(typeof hidden('return process.getBuiltinModule("node:fs").promises')).toBe("function");
  expect(() => sql("select 1")).toThrow();
  expect(existsSync(".")).toBe(true);
});`,
    "e.test.ts": fileThatDoesNothing,
    "f.test.ts": lastFile(""),
  });
  expect({ summary, exitCode }).toEqual({ summary: [" 3 pass", " 0 fail"], exitCode: 0 });
});

import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// What the loader makes to load, link and run an ES module of the program goes when no graph is being loaded any more:
// behind a hundred and twenty modules a program holds a handful of records.
const counts = `
import { heapStats } from "bun:jsc";
const turn = () => new Promise(resolve => setTimeout(resolve, 1));
// A word of the stack that nothing reads any more may name a record, which names those of the modules it imports.
export async function counts() {
  let least = [Infinity, Infinity, Infinity];
  for (let attempt = 0; attempt < 6; attempt++) {
    await turn();
    Bun.gc(true);
    const all = heapStats().objectTypeCounts;
    const now = ["CompiledModuleRecord", "ModuleRegistryEntry", "Promise"].map(name => all[name] ?? 0);
    least = least.map((count, index) => Math.min(count, now[index]));
  }
  return least.join(" ");
}
// For an entry point that has not come to its first await.
export function countsNow() {
  Bun.gc(true);
  const all = heapStats().objectTypeCounts;
  return ["CompiledModuleRecord", "ModuleRegistryEntry", "Promise"].map(name => all[name] ?? 0).join(" ");
}
`;

type Shape = {
  /** The text of the entry point behind its imports: it adds to \`sum\`. */
  entry: (n: number) => string;
  /** The text runs in front of the first await of the entry point, while the host evaluates it. \`before\` is counted in front of it, with no turn. */
  runsInFrontOfFirstAwait?: boolean;
  files: (i: number) => Record<string, string>;
  shared?: Record<string, string>;
  /** More flags for the build. */
  flags?: string[];
  sum: (n: number) => number;
};

const sumOfAll = (n: number) => (n * (n - 1)) / 2;
const feature = (i: number) => ({
  [`feature${i}.ts`]: `import { left } from "./left${i}.ts";\nimport { right } from "./right${i}.ts";\nexport function run() { return left + right; }\n`,
  [`left${i}.ts`]: `export const left = ${i};\n`,
  [`right${i}.ts`]: `export const right = 0;\n`,
});
const cases = (n: number, arm: (i: number) => string) =>
  `switch (index) {\n${Array.from({ length: n }, (_, i) => `    case ${i}: ${arm(i)}`).join("\n")}\n  }`;
// Where a require() runs such a module, the loader takes every step of the import() before the require() returns: the load settles there, where no record is retired.
const importsWhileItRuns = (i: number) => ({
  [`running${i}.ts`]: `import("./other${i}.ts");\nexport function run() { return ${i}; }\n`,
  [`other${i}.ts`]: `export const other = ${i};\n`,
});
const required = (n: number) => `
function required(index: number) {
  ${cases(n, i => `return require("./running${i}.ts").run();`)}
  return 0;
}
`;
const requireEach = (n: number) => `${required(n)}for (let index = 0; index < ${n}; index++) sum += required(index);\n`;
// One call of importEach() is an import() of every module, and each adds its number when it runs.
const addsWhenItRuns = (i: number) => ({
  [`adds${i}.ts`]: `(globalThis as any).added = ((globalThis as any).added ?? 0) + ${i};\nexport {};\n`,
});
const importEach = (n: number) => `
function imported(index: number) {
  ${cases(n, i => `return import("./adds${i}.ts");`)}
}
(globalThis as any).importEach = () => {
  for (let index = 0; index < ${n}; index++) imported(index);
};
`;

const shapes: Record<string, Shape> = {
  "one import() after the other": {
    entry: n => `
async function later(index: number) {
  ${cases(n, i => `return (await import("./feature${i}.ts")).run();`)}
  return 0;
}
for (let index = 0; index < ${n}; index++) sum += await later(index);
`,
    files: feature,
    sum: sumOfAll,
  },
  "every import() at once, of modules that share an import": {
    entry: n => `
const features = await Promise.all([${Array.from({ length: n }, (_, i) => `import("./shared${i}.ts")`).join(", ")}]);
for (const feature of features) sum += feature.run();
`,
    files: i => ({
      [`shared${i}.ts`]: `import { zero } from "./common.ts";\nimport { own } from "./own${i}.ts";\nexport function run() { return zero + own; }\n`,
      [`own${i}.ts`]: `export const own = ${i};\n`,
    }),
    shared: { "common.ts": "export const zero = 0;\n" },
    sum: sumOfAll,
  },
  "a require() of a module while an import() of another waits": {
    entry: n => `
function required(index: number) {
  ${cases(n, i => `return require("./feature${i}.ts").run();`)}
  return 0;
}
async function imported(index: number) {
  ${cases(n, i => `return (await import("./beside${i}.ts")).beside;`)}
  return 0;
}
for (let index = 0; index < ${n}; index++) {
  const waits = imported(index);
  sum += required(index);
  sum += await waits;
}
`,
    files: i => ({
      ...feature(i),
      [`beside${i}.ts`]: `import "./below${i}.ts";\nexport const beside = 0;\n`,
      [`below${i}.ts`]: `export const below = ${i};\n`,
    }),
    sum: sumOfAll,
  },
  "a require() of a module that an import() in flight will come to": {
    entry: n => `
function required(index: number) {
  ${cases(n, i => `return require("./left${i}.ts").left;`)}
  return 0;
}
async function imported(index: number) {
  ${cases(n, i => `return (await import("./feature${i}.ts")).run();`)}
  return 0;
}
for (let index = 0; index < ${n}; index++) {
  const waits = imported(index);
  await null;
  sum += required(index) - index;
  sum += await waits;
}
`,
    files: feature,
    sum: sumOfAll,
  },
  "an import() in a function that a job resumes while another graph is being loaded": {
    entry: n => `
async function first(index: number) {
  ${cases(n, i => `return (await import("./feature${i}.ts")).run();`)}
  return 0;
}
async function second(index: number) {
  await null;
  await null;
  ${cases(n, i => `return (await import("./deep${i}.ts")).deep;`)}
  return 0;
}
for (let index = 0; index < ${n}; index++) {
  const [one, other] = await Promise.all([first(index), second(index)]);
  sum += one + other;
}
`,
    files: i => ({
      ...feature(i),
      [`deep${i}.ts`]: `import { middle } from "./middle${i}.ts";\nexport const deep = middle;\n`,
      [`middle${i}.ts`]: `import { bottom } from "./bottom${i}.ts";\nexport const middle = bottom;\n`,
      [`bottom${i}.ts`]: `export const bottom = 0;\n`,
    }),
    sum: sumOfAll,
  },
  // No load settles behind the require(), so nothing asks again there: the records go when the VM is idle.
  "a require() of a module that calls import() while it runs": {
    entry: requireEach,
    files: importsWhileItRuns,
    sum: sumOfAll,
  },
  // The entry point has not run to its end when the records are counted, so the load of the host has not settled either.
  "the same require() in the body of the entry point, which awaits behind it": {
    entry: requireEach,
    runsInFrontOfFirstAwait: true,
    files: importsWhileItRuns,
    sum: sumOfAll,
  },
  // The import() of outer takes no step of the loader, and the require() returns under the evaluation of outer.
  "the same require() in the body of a module that an import() evaluates": {
    entry: n => `
async function later(index: number) {
  ${cases(n, i => `return (await import("./outer${i}.ts")).run();`)}
  return 0;
}
for (let index = 0; index < ${n}; index++) sum += await later(index);
`,
    files: i => ({
      ...importsWhileItRuns(i),
      [`outer${i}.ts`]: `const running = require("./running${i}.ts");\nexport function run() { return running.run(); }\n`,
    }),
    sum: sumOfAll,
  },
  // Each call is the only one of its timer: the records of one go before the next call.
  "the same require(), each in a timer of its own": {
    entry: n => `${required(n)}await new Promise<void>(resolve => {
  let index = 0;
  const next = () => {
    if (index === ${n}) return resolve();
    sum += required(index++);
    setTimeout(next, 0);
  };
  setTimeout(next, 0);
});
`,
    files: importsWhileItRuns,
    sum: sumOfAll,
  },
  // The require() ends with the error of the module, behind the loads that have settled inside it. The module that failed keeps its record, with the error.
  "a require() of a module that throws behind its import() calls": {
    entry: n => `${importEach(n)}try {
  require("./throws.ts");
} catch {
  sum += (globalThis as any).added;
}
`,
    files: addsWhenItRuns,
    shared: { "throws.ts": `(globalThis as any).importEach();\nthrow new Error("behind the import() calls");\n` },
    sum: sumOfAll,
  },
  // The host evaluates a file that is not in the executable, and no require() of the program is on the stack where the loads settle.
  "a require() of a file on disk that calls import() on modules of the program": {
    entry: n => `${importEach(n)}require(process.cwd() + "/disk/calls.mjs");
sum += (globalThis as any).added;
`,
    files: addsWhenItRuns,
    shared: { "disk/calls.mjs": `globalThis.importEach();\nexport {};\n` },
    flags: ["--aot-allow-code-from-disk"],
    sum: sumOfAll,
  },
  // No require(): the body has the host run the jobs that wait, and the load settles under the evaluation of its module.
  "an import() whose jobs the body that called it has the host run": {
    entry: n => `
async function later(index: number) {
  ${cases(n, i => `return (await import("./drains${i}.ts")).run();`)}
  return 0;
}
for (let index = 0; index < ${n}; index++) sum += await later(index);
`,
    files: i => ({
      [`drains${i}.ts`]: `import { drainMicrotasks } from "bun:jsc";\nimport("./other${i}.ts");\ndrainMicrotasks();\nexport function run() { return ${i}; }\n`,
      [`other${i}.ts`]: `export const other = ${i};\n`,
    }),
    sum: sumOfAll,
  },
};

for (const [name, shape] of Object.entries(shapes)) {
  test(
    name,
    async () => {
      const n = 120;
      const files: Record<string, string> = { "counts.ts": counts, ...shape.shared };
      for (let i = 0; i < n; i++) Object.assign(files, shape.files(i));
      const first = shape.runsInFrontOfFirstAwait ? "countsNow()" : "await counts()";
      files["main.ts"] =
        `import { counts, countsNow } from "./counts.ts";\nlet sum = 0;\nconst before = ${first};\n${shape.entry(n)}\nconsole.log(sum);\nconsole.log(before);\nconsole.log(await counts());\n`;
      using dir = tempDir("aot-records-of-modules-that-have-run", files);
      const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", ...(shape.flags ?? []), "main.ts", "--outfile", executable],
        String(dir),
      );
      expect({
        stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
        exitCode: built.exitCode,
      }).toEqual({ stderr: [], exitCode: 0 });
      const ran = await run([executable], String(dir));
      expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const [sum, before, after] = ran.stdout.trim().split("\n");
      expect(Number(sum)).toBe(shape.sum(n));
      // The entry point waits at an await of its own, so it has a record. The bounds leave room for what the last graphs made.
      const [records, entries, promises] = after!.split(" ").map(Number);
      const promisesBefore = Number(before!.split(" ")[2]);
      expect({
        n,
        records: records! <= 12,
        entries: entries! <= 12,
        promises: promises! <= promisesBefore + 40,
        after,
      }).toEqual({
        n,
        records: true,
        entries: true,
        promises: true,
        after,
      });
    },
    // A build that allows code from disk takes several times as long.
    shape.flags ? 600_000 : 240_000,
  );
}

// Each test of a file is a call from the host, and the next one begins when the VM has been idle.
test("the same require() in a test of bun test --aot, counted in a later test", async () => {
  const n = 40;
  const files: Record<string, string> = {};
  for (let i = 0; i < n; i++) Object.assign(files, importsWhileItRuns(i));
  files["records.test.ts"] = `
import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
${required(n)}
test("the calls", () => {
  let sum = 0;
  for (let index = 0; index < ${n}; index++) sum += required(index);
  expect(sum).toBe(${sumOfAll(n)});
});
test("a later test", () => {
  Bun.gc(true);
  const all = heapStats().objectTypeCounts;
  console.log("left:", all.CompiledModuleRecord ?? 0, all.ModuleRegistryEntry ?? 0);
});
`;
  using dir = tempDir("aot-records-behind-a-test", files);
  // Over layers the realm of the test file has more than one program.
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" };
  const ran = await run([bunExe(), "test", "--aot", "./records.test.ts"], String(dir), env);
  const left = ran.stdout.match(/^left: (\d+) (\d+)$/m);
  expect({
    summary: ran.stderr.match(/^ \d+ (pass|fail)$/gm),
    records: Number(left?.[1]) <= 12,
    entries: Number(left?.[2]) <= 12,
    left: left?.[0],
    exitCode: ran.exitCode,
  }).toEqual({
    summary: [" 2 pass", " 0 fail"],
    records: true,
    entries: true,
    left: left?.[0],
    exitCode: 0,
  });
  // A run over layers builds the library anew.
}, 600_000);

// CommonJS interop in `bun build` output: the cost of a read through the
// helpers the bundler prints, and the cost of building what they read from.
//
// Read rows time one read of a CommonJS export:
//   named         import { read } from "./lib.cjs"                  (__toESM)
//   named-tsc     the same, from the output of tsc: `__esModule` is the first key
//   named-fn      the same, from a module.exports that is a function
//   two-modes     the same, after a .mjs file imported the module too
//   star          the name through `export * from`                  (__reExport, then __toESM)
//   consumer      require("./lib.js").read, where lib.js is an ES module
//                 built with --format=cjs                           (__toCommonJS)
//   reexport-cjs  require("./out.cjs").read, where out.cjs re-exports the
//                 names of bundled CommonJS modules                 (__toCommonJS, then __toESM)
// Each runs with 1 module and 1 name read, and with 40 modules whose 840 names
// are all read first. The second is what an application looks like to an
// inline cache.
//
// Start-up rows build 600 importers of one module with 300 names. They report
// the median time to the end of the entry, which depends on when the collector
// runs, and the heap after a collection:
//   importers-obj   module.exports is an object: one cached namespace
//   importers-fn    module.exports is a function: __toESM does not cache it,
//                   so each import statement builds a namespace
//   importers-star  600 `export * from` statements: one __reExport call each
//
// The given bun binary builds the bundles. Each runtime then runs them, so a
// change to the helpers shows up under node too.
// Usage: bun run.ts <bun-binary> [runtime ...]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [bun, ...rest] = process.argv.slice(2);
if (!bun) {
  console.error("usage: bun run.ts <bun-binary> [runtime ...]");
  process.exit(1);
}
const runtimes = rest.length ? rest : [bun, ...(Bun.which("node") ? ["node"] : [])];
const RUNS = 5;
const STARTUP_RUNS = 15;
const NAMES = 20;
const IMPORTERS = 600;
const IMPORTER_NAMES = 300;

const range = <T>(n: number, each: (i: number) => T) => Array.from({ length: n }, (_, i) => each(i));
const names = (i: number) => range(NAMES, k => `fn${i}_${k}`);
const root = mkdtempSync(join(tmpdir(), "cjs-interop-"));

function spawn(cmd: string[], cwd?: string) {
  const result = Bun.spawnSync({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    console.error(`${cmd.join(" ")} failed:\n` + result.stderr.toString());
    process.exit(1);
  }
  return result.stdout.toString();
}
const build = (cwd: string, args: string[]) => spawn([bun, "build", "--target=node", ...args], cwd);
// node needs a flag before `gc()` exists.
const runtimeArgs = runtimes.map(runtime =>
  spawn([runtime, "-e", "process.stdout.write(typeof Bun)"]) === "object" ? [] : ["--expose-gc"],
);

const assign = (target: string, i: number) =>
  names(i)
    .map((name, k) => `${target}.${name} = function (v) { return v + ${k}; };`)
    .join("\n") + `\n${target}.read = function (v) { return v; };\n`;
const libs = {
  // The body is inside a function, so the bundler keeps the __commonJS wrapper.
  plain: (i: number) => `(function () {\n${assign("exports", i)}})();\n`,
  tsc: (i: number) =>
    `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n${assign("exports", i)}`,
  fn: (i: number) => `function main(v) { return v; }\n${assign("main", i)}module.exports = main;\n`,
};
const esmLib = (i: number) =>
  names(i)
    .map((name, k) => `export function ${name}(v) { return v + ${k}; }`)
    .join("\n") + `\nexport function read(v) { return v; }\n`;

// `read(i)` is how module i's `read` is spelled at the call site.
function driver(modules: number, read: (i: number) => string, other: (i: number, name: string) => string) {
  const hot = modules > 1 ? 7 : 0;
  const warm =
    modules > 1
      ? range(modules, i => [...names(i).map(name => other(i, name)), read(i)].map(f => `  sink += ${f}(0);`)).flat()
      : [];
  return `
let sink = 0;
function warm() {
${warm.join("\n")}
}
for (let i = 0; i < 2000; i++) warm();
function hot(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += ${read(hot)}(1);
  return sum;
}
if (hot(200000) !== 200000) throw new Error("wrong sum");
let reads = 0, elapsed = 0;
const start = performance.now();
while (elapsed < 300) {
  sink += hot(1000000);
  reads += 1000000;
  elapsed = performance.now() - start;
}
console.log(JSON.stringify({ ns: (elapsed * 1e6) / reads }));
`;
}

type Row = { label: object; file: string; runs: number; samples: Record<string, number>[][] };
const rows: Row[] = [];
const row = (label: object, file: string, runs: number) =>
  rows.push({ label, file, runs, samples: runtimes.map(() => []) });

for (const modules of [1, 40]) {
  for (const shape of ["named", "named-tsc", "named-fn", "two-modes", "star", "consumer", "reexport-cjs"]) {
    const cwd = join(root, `${shape}-${modules}`);
    mkdirSync(cwd, { recursive: true });
    const write = (name: string, text: string) => writeFileSync(join(cwd, name), text);
    const importNames = (i: number, from: string) =>
      `import { ${names(i).join(", ")}, read as read${i} } from "${from}";`;
    const readsNames = driver(
      modules,
      i => `read${i}`,
      (_, name) => name,
    );
    let file = join(cwd, "out.mjs");
    if (shape === "consumer") {
      range(modules, i => write(`lib${i}.mjs`, esmLib(i)));
      build(cwd, ["--format=cjs", "--outdir=out", ...range(modules, i => `lib${i}.mjs`)]);
      file = join(cwd, "consumer.cjs");
      write(
        "consumer.cjs",
        range(modules, i => `const lib${i} = require("./out/lib${i}.js");`).join("\n") +
          driver(
            modules,
            i => `lib${i}.read`,
            (i, name) => `lib${i}.${name}`,
          ),
      );
    } else if (shape === "reexport-cjs") {
      range(modules, i => write(`lib${i}.cjs`, libs.plain(i)));
      write(
        "entry.mjs",
        range(modules, i => `export { ${names(i).join(", ")}, read as read${i} } from "./lib${i}.cjs";`).join("\n"),
      );
      build(cwd, ["--format=cjs", "--outfile=out.cjs", "entry.mjs"]);
      file = join(cwd, "consumer.cjs");
      write(
        "consumer.cjs",
        `const lib = require("./out.cjs");` +
          driver(
            modules,
            i => `lib.read${i}`,
            (_, name) => `lib.${name}`,
          ),
      );
    } else if (shape === "two-modes") {
      range(modules, i => write(`lib${i}.cjs`, libs.plain(i)));
      write(
        "dep.mjs",
        range(modules, i => `import { read as read${i} } from "./lib${i}.cjs";`).join("\n") +
          `\nexport const first = [${range(modules, i => `read${i}`).join(", ")}];\n`,
      );
      write(
        "entry.js",
        `import { first } from "./dep.mjs";\n` +
          range(modules, i => importNames(i, `./lib${i}.cjs`)).join("\n") +
          readsNames +
          `if (first.length !== ${modules}) throw new Error("dep.mjs did not load");\n`,
      );
      build(cwd, ["--format=esm", `--outfile=${file}`, "entry.js"]);
    } else {
      const lib = shape === "named-tsc" ? libs.tsc : shape === "named-fn" ? libs.fn : libs.plain;
      range(modules, i => write(`lib${i}.cjs`, lib(i)));
      if (shape === "star") range(modules, i => write(`star${i}.mjs`, `export * from "./lib${i}.cjs";\n`));
      const from = (i: number) => (shape === "star" ? `./star${i}.mjs` : `./lib${i}.cjs`);
      write("entry.mjs", range(modules, i => importNames(i, from(i))).join("\n") + readsNames);
      build(cwd, ["--format=esm", `--outfile=${file}`, "entry.mjs"]);
    }
    row({ shape, modules }, file, RUNS);
  }
}

const importerNames = range(IMPORTER_NAMES, k => `fn${k}`);
const report = `
const ms = performance.now() - globalThis.start;
let heap_bytes;
if (typeof Bun !== "undefined") {
  Bun.gc(true);
  heap_bytes = (await import("bun:jsc")).heapStats().heapSize;
} else if (globalThis.gc) {
  gc();
  heap_bytes = (await import("node:v8")).getHeapStatistics().used_heap_size;
}
console.log(JSON.stringify({ ms, heap_bytes }));
`;
for (const shape of ["importers-obj", "importers-fn", "importers-star"]) {
  const cwd = join(root, shape);
  mkdirSync(cwd, { recursive: true });
  const write = (name: string, text: string) => writeFileSync(join(cwd, name), text);
  const target = shape === "importers-fn" ? "main" : "exports";
  write(
    "lib.cjs",
    `(function () {\n` +
      (shape === "importers-fn" ? `function main(v) { return v; }\nmodule.exports = main;\n` : "") +
      importerNames.map((name, k) => `${target}.${name} = function (v) { return v + ${k}; };`).join("\n") +
      `\n})();\n`,
  );
  write("start.mjs", `globalThis.start = performance.now();\n`);
  range(IMPORTERS, i =>
    write(
      `importer${i}.mjs`,
      shape === "importers-star"
        ? `export * from "./lib.cjs";\nexport const own${i} = ${i};\n`
        : `import { fn0, fn1 } from "./lib.cjs";\nexport const own${i} = [fn0, fn1];\n`,
    ),
  );
  write(
    "entry.mjs",
    `import "./start.mjs";\n` +
      range(IMPORTERS, i => `import * as importer${i} from "./importer${i}.mjs";`).join("\n") +
      `\nglobalThis.keep = [${range(IMPORTERS, i => `importer${i}`).join(", ")}];\n` +
      report,
  );
  const file = join(cwd, "out.mjs");
  build(cwd, ["--format=esm", `--outfile=${file}`, "entry.mjs"]);
  row({ shape, importers: IMPORTERS, names: IMPORTER_NAMES }, file, STARTUP_RUNS);
}

// Runs are interleaved across rows and runtimes so drift hits them equally.
for (let run = 0; run < STARTUP_RUNS; run++) {
  for (const { file, runs, samples } of rows) {
    if (run >= runs) continue;
    runtimes.forEach((runtime, r) => samples[r].push(JSON.parse(spawn([runtime, ...runtimeArgs[r], file]))));
  }
}
rmSync(root, { recursive: true, force: true });

for (const { label, samples } of rows) {
  const each = (key: string, pick: (sorted: number[]) => number) =>
    Object.fromEntries(
      runtimes.map((runtime, r) => [runtime, +pick(samples[r].map(s => s[key]).sort((a, b) => a - b)).toFixed(2)]),
    );
  const min = (sorted: number[]) => sorted[0];
  const median = (sorted: number[]) => sorted[sorted.length >> 1];
  console.log(
    JSON.stringify(
      "ns" in samples[0][0]
        ? { ...label, ns_per_read_min: each("ns", min) }
        : { ...label, startup_ms_median: each("ms", median), heap_bytes_min: each("heap_bytes", min) },
    ),
  );
}

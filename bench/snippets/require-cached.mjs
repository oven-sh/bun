// A resolution that is repeated, per entry point and per kind of specifier: require(), require.resolve(), import(),
// import.meta.resolve(), Bun.resolveSync().
//
//   HOOK=1     every call goes through a Module._resolveFilename override that calls the original
//   WORKERS=8  no mitata: that many worker threads run the same loop at once, prints ns per call
//   BUN_FEATURE_FLAG_DISABLE_RESOLUTION_MEMO=1   Bun without its memo of resolver answers
//
// Run `bun install` in bench/ first. A run that has to install mitata by itself has a package manager, and then Bun
// remembers no answer for a package name.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainThread, Worker, workerData } from "node:worker_threads";
import { bench, group, run } from "../runner.mjs";

const dir = workerData?.dir ?? mkdtempSync(join(tmpdir(), "require-cached-"));
if (isMainThread) {
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(dir, "small"));
  writeFileSync(join(dir, "child.cjs"), "module.exports = { value: 1 };");
  writeFileSync(join(dir, "child.mjs"), "export default 1;");
  // Not Latin-1: the specifier is a 16-bit string.
  writeFileSync(join(dir, "\u5b50.cjs"), "module.exports = 1;");
  if (process.platform !== "win32") writeFileSync(join(dir, "a:b.cjs"), "module.exports = 1;");
  const exports = { ".": "./index.js", "./feature": "./lib/feature.js" };
  writeFileSync(join(dir, "node_modules", "pkg", "package.json"), JSON.stringify({ name: "pkg", exports }));
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1;");
  mkdirSync(join(dir, "node_modules", "pkg", "lib"));
  writeFileSync(join(dir, "node_modules", "pkg", "lib", "feature.js"), "module.exports = 2;");
  for (let i = 0; i < 10_000; i++) writeFileSync(join(dir, `many-${i}.cjs`), `module.exports = ${i};`);
}

if (process.env.HOOK) {
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    return resolveFilename.call(this, request, parent, isMain, options);
  };
}

const require = createRequire(join(dir, "index.cjs"));
const absolute = require.resolve("./child.cjs");

const workers = Number(process.env.WORKERS || 0);
if (workers || !isMainThread) {
  if (isMainThread) {
    const results = await Promise.all(
      Array.from({ length: workers }, () => {
        const worker = new Worker(new URL(import.meta.url), { workerData: { dir } });
        return new Promise((resolve, reject) => worker.once("message", resolve).once("error", reject));
      }),
    );
    const mean = key => (results.reduce((sum, result) => sum + result[key], 0) / results.length).toFixed(0);
    console.log(`${workers} workers: require("./child.cjs") ${mean("relative")} ns, require("pkg") ${mean("bare")} ns`);
  } else {
    const time = specifier => {
      let best = Infinity;
      for (let pass = 0; pass < 40; pass++) {
        const start = process.hrtime.bigint();
        for (let i = 0; i < 50_000; i++) require(specifier);
        best = Math.min(best, Number(process.hrtime.bigint() - start) / 50_000);
      }
      return best;
    };
    const { parentPort } = await import("node:worker_threads");
    parentPort.postMessage({ relative: time("./child.cjs"), bare: time("pkg") });
  }
} else {
  group("require", () => {
    bench(`require("./child.cjs")`, () => require("./child.cjs"));
    bench(`require("pkg")`, () => require("pkg"));
    bench(`require("/absolute/child.cjs")`, () => require(absolute));
    bench(`require("node:fs")`, () => require("node:fs"));
    bench(`require("fs")`, () => require("fs"));
  });

  group("require.resolve", () => {
    bench(`require.resolve("./child.cjs")`, () => require.resolve("./child.cjs"));
    bench(`require.resolve("pkg")`, () => require.resolve("pkg"));
    bench(`require.resolve("pkg/feature"), through "exports"`, () => require.resolve("pkg/feature"));
    bench(`require.resolve("./\u5b50.cjs"), a 16-bit string`, () => require.resolve("./\u5b50.cjs"));
    bench(`require.resolve("fs")`, () => require.resolve("fs"));
  });

  const fromFile = pathToFileURL(join(dir, "index.mjs")).href;
  group("import", () => {
    bench(`import("/absolute/child.mjs")`, () => import(join(dir, "child.mjs")));
    if (globalThis.Bun) {
      bench(`import.meta.resolve("./child.mjs", parent)`, () => import.meta.resolve("./child.mjs", fromFile));
      bench(`Bun.resolveSync("./child.cjs", dir)`, () => Bun.resolveSync("./child.cjs", dir));
      process.chdir(dir);
      bench(`Bun.resolveSync("./child.cjs", ".")`, () => Bun.resolveSync("./child.cjs", "."));
    }
  });

  // What Bun's resolution memo looks up and never keeps.
  group("never remembered", () => {
    bench(`require.resolve("./child.cjs?query")`, () => require.resolve("./child.cjs?query"));
    if (process.platform !== "win32") bench(`require.resolve("./a:b.cjs")`, () => require.resolve("./a:b.cjs"));
    if (globalThis.Bun) {
      const blob = URL.createObjectURL(new Blob(["export default 1;"], { type: "text/javascript" }));
      bench(`Bun.resolveSync(blob: URL, dir)`, () => Bun.resolveSync(blob, dir));
    }
    bench(`require.resolve("pkg", { paths: [dir] })`, () => require.resolve("pkg", { paths: [dir] }));
  });

  // A working set of K modules, required in turn. 10,000 is more than the resolution memo holds.
  group("round robin", () => {
    for (const count of [1, 10, 100, 1000, 10_000]) {
      const specifiers = Array.from({ length: count }, (_, i) => `./many-${i}.cjs`);
      let next = 0;
      bench(`${count} modules`, () => require(specifiers[next++ % count]));
    }
  });

  // A lookup that fails makes the resolver read that directory again. Each pair that the resolution memo keeps then
  // runs the resolver once more.
  group("failed lookup", () => {
    const missing = () => {
      try {
        require.resolve("./small/missing.cjs");
      } catch {}
    };
    bench(`require.resolve("./small/missing.cjs")`, missing);
    bench(`require.resolve("./small/missing.cjs"), then require("./child.cjs")`, () => {
      missing();
      require("./child.cjs");
    });
    const specifiers = Array.from({ length: 100 }, (_, i) => `./many-${i}.cjs`);
    bench(`require.resolve("./small/missing.cjs"), then 100 modules`, () => {
      missing();
      for (const specifier of specifiers) require(specifier);
    });
  });

  await run();

  // Each pair is resolved twice and never again: the second resolution is the one that the memo keeps. No mitata,
  // which would resolve a pair more often.
  {
    const count = 10_000;
    const specifiers = Array.from({ length: count }, (_, i) => `./many-${i}.cjs`);
    let best = Infinity;
    for (let round = 0; round < 20; round++) {
      const from = createRequire(join(dir, `from-${round}.cjs`));
      const start = process.hrtime.bigint();
      for (const specifier of specifiers) (from.resolve(specifier), from.resolve(specifier));
      best = Math.min(best, Number(process.hrtime.bigint() - start) / (2 * count));
    }
    console.log(`each of ${count} pairs resolved twice: ${best.toFixed(0)} ns per resolution`);
  }
}

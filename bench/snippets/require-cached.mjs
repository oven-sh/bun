// require() and require.resolve() of a module that is already loaded, per kind of specifier.
//
//   HOOK=1     every call goes through a Module._resolveFilename override that calls the original
//   WORKERS=8  no mitata: that many worker threads run the same loop at once, prints ns per call
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMainThread, Worker, workerData } from "node:worker_threads";
import { bench, group, run } from "../runner.mjs";

const dir = workerData?.dir ?? mkdtempSync(join(tmpdir(), "require-cached-"));
if (isMainThread) {
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(dir, "small"));
  writeFileSync(join(dir, "child.cjs"), "module.exports = { value: 1 };");
  writeFileSync(join(dir, "node_modules", "pkg", "package.json"), `{ "name": "pkg", "main": "index.js" }`);
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1;");
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
    bench(`require.resolve("fs")`, () => require.resolve("fs"));
  });

  // A working set of K modules, required in turn. 10,000 is more than the resolution memo holds.
  group("round robin", () => {
    for (const count of [1, 10, 100, 1000, 10_000]) {
      const specifiers = Array.from({ length: count }, (_, i) => `./many-${i}.cjs`);
      let next = 0;
      bench(`${count} modules`, () => require(specifiers[next++ % count]));
    }
  });

  // A lookup that fails makes the resolver read that directory again, and the resolution memo starts over.
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
  });

  await run();
}

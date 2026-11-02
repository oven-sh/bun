// Bench for a loaded module's own source map (--enable-source-maps,
// process.setSourceMapsEnabled(), module.setSourceMapsSupport()). Ported from
// Node's benchmark/module/module-require-source-map.js. Compare against a
// baseline build, and against Node, by running:
//
//   bun run build:release bench/sourcemap/own-source-map-bench.mjs
//   node --enable-source-maps bench/sourcemap/own-source-map-bench.mjs
//
// Started with the switch off, it runs each class of module with the switch
// off and then on. Started with --enable-source-maps, it runs with the switch
// on only. Each run is a process of its own, with three phases, the last one
// in Bun only:
//
//   load                    require() or import() of N modules
//   first stack after load  each module throws once, then every .stack is read
//   a collection is the     N more modules each return an unread error from a
//   first reader            closure that dies, then Bun.gc(true) is timed
//
// Before the timed load, another set of the same class is loaded and not
// timed. That warms up the process and puts the files of 4 KiB or more
// ("inline", "over 4 KiB") in Bun's transpiler cache, so a timed load of such
// a file is a cache hit. BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 turns it off.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [flag = "bench", count = "1000", only, setting] = process.argv.slice(2);
const N = Number(count);
const require = createRequire(import.meta.url);

// Node's modules have 40 methods. 36 keep a module with the two functions that
// this bench adds under 4 KiB, as Node's is, unless its map is inline.
const classes = {
  "none": { methods: 36, map: "none" },
  "inline": { methods: 36, map: "inline" },
  "external": { methods: 36, map: "external" },
  "over 4 KiB": { methods: 60, map: "external" },
  "import()": { methods: 36, map: "external", esm: true },
};

function moduleSource(i, { methods, esm }) {
  const body = [];
  for (let m = 0; m < methods; m++) {
    body.push(`  method${m}(input) { return [].concat(input).map((item) => ({ item, m: ${m}, service: ${i} })); }`);
  }
  const exported = esm ? "export " : "";
  return `'use strict';
${exported}class Service${i} {
  constructor(options = {}) { this.options = { retries: 3, ...options }; }
${body.join("\n")}
}
${exported}function helper${i}(list) { return list.filter(Boolean).slice(0, ${i % 7}); }
${exported}function boom() { throw new Error("boom ${i}"); }
${exported}function unread() {
  function thrower() { try { return new Error("unread ${i}"); } finally {} }
  try { return thrower(); } finally {}
}
${esm ? "" : `module.exports = { Service${i}, helper${i}, boom, unread };\n`}`;
}

function sourceMapFor(file, i, source) {
  const mappings = "AAAA;" + "AACA,MAAM;".repeat(source.split("\n").length - 2);
  const sources = [`../src/${i}.ts`];
  return JSON.stringify({ version: 3, file, sources, sourcesContent: [source], names: [], mappings });
}

function createModules(dir, spec) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (let i = 0; i < N; i++) {
    const file = `${i}.${spec.esm ? "mjs" : "js"}`;
    const source = moduleSource(i, spec);
    let trailer = "";
    if (spec.map === "inline") {
      const data = Buffer.from(sourceMapFor(file, i, source)).toString("base64");
      trailer = `//# sourceMappingURL=data:application/json;base64,${data}\n`;
    } else if (spec.map === "external") {
      fs.writeFileSync(path.join(dir, `${file}.map`), sourceMapFor(file, i, source));
      trailer = `//# sourceMappingURL=${file}.map\n`;
    }
    fs.writeFileSync(path.join(dir, file), source + trailer);
    files.push(path.join(dir, file));
  }
  return files;
}

// Writes a set of N modules of the class `name` to `dir` and loads it.
async function load(name, dir) {
  const files = createModules(dir, classes[name]);
  const modules = [];
  const start = performance.now();
  for (const file of files) modules.push(classes[name].esm ? await import(pathToFileURL(file).href) : require(file));
  return [modules, performance.now() - start];
}

async function run(name, on) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "own-source-map-bench-"));
  const print = (phase, ms, unit) =>
    console.log(
      `[${flag}] switch ${on ? "on " : "off"} ${name.padEnd(10)} ${phase.padEnd(32)} ${ms.toFixed(2).padStart(8)} ms` +
        `  (${N} ${unit}, ${Math.round((N / ms) * 1000)} per second)`,
    );
  let sink = 0;
  process.setSourceMapsEnabled(on);
  try {
    await load(name, path.join(root, "warm-up"));
    const [modules, ms] = await load(name, path.join(root, "timed"));
    print("load", ms, classes[name].esm ? "imports" : "requires");
    const thrown = [];
    for (const module of modules) {
      try {
        module.boom();
      } catch (error) {
        thrown.push(error);
      }
    }
    let start = performance.now();
    for (const error of thrown) sink += error.stack.length;
    print("first stack after load", performance.now() - start, "stacks");
    if (typeof Bun !== "undefined") {
      const [fresh] = await load(name, path.join(root, "unread"));
      // What is garbage by now is not for the timed collection.
      Bun.gc(true);
      const unread = fresh.map(module => module.unread());
      start = performance.now();
      Bun.gc(true);
      print("a collection is the first reader", performance.now() - start, "errors");
      sink += unread.length;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return sink;
}

if (only) {
  await run(only, setting === "on");
} else {
  for (const name of Object.keys(classes)) {
    for (const on of process.sourceMapsEnabled ? ["on"] : ["off", "on"]) {
      const args = [...process.execArgv, fileURLToPath(import.meta.url), flag, count, name, on];
      const { status } = spawnSync(process.execPath, args, { stdio: "inherit" });
      if (status !== 0) process.exit(status ?? 1);
    }
  }
}

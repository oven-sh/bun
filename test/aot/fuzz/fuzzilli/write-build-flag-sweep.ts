// An everyday program is built with the flags that people pass to `bun build --compile --aot`: the flags, times the program. Each cell holds one of each and is built alone.
//
//   bun write-build-flag-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<flags>--<program>.js, .mjs or .ts
//   bun write-build-flag-sweep.ts count
//   bun write-build-flag-sweep.ts named <pattern> <folder> [most]
//
// The first line of a cell, `// Flags: --minify`, names the flags that its build takes. None of them changes what a program prints: the programs print numbers, texts and records, never the name or the text of
// a function.
import { mkdirSync, writeFileSync } from "fs";
import { everydayAwaitingProgram, everydayAwaitingProgramCount } from "../../harness/everyday-awaiting-program-cases";
import {
  everydayGatheringProgram,
  everydayGatheringProgramCount,
} from "../../harness/everyday-gathering-program-cases";
import { everydayProgram, everydayProgramCount } from "../../harness/everyday-program-cases";

const flags: [string, string][] = [
  ["minify", "--minify"],
  ["minify-syntax", "--minify-syntax"],
  ["minify-whitespace", "--minify-whitespace"],
  ["minify-identifiers", "--minify-identifiers"],
  ["minify-and-keep-names", "--minify --keep-names"],
  ["production", "--production"],
  ["an-inline-sourcemap", "--sourcemap=inline"],
  ["an-external-sourcemap", "--sourcemap=external"],
  ["a-linked-sourcemap", "--sourcemap=linked"],
  ["no-sourcemap", "--sourcemap=none"],
  ["minify-and-a-sourcemap", "--minify --sourcemap=external"],
  ["the-target-bun", "--target=bun"],
  ["the-format-esm", "--format=esm"],
  ["a-banner", "--banner=//banner"],
  ["a-footer", "--footer=//footer"],
  ["a-metafile", "--metafile=meta.json"],
  ["a-metafile-in-markdown", "--metafile-md=meta.md"],
  ["bytecode", "--bytecode"],
  ["obfuscate", "--obfuscate"],
  ["obfuscate-and-minify", "--obfuscate --minify"],
  ["no-function-source", "--no-compile-function-source"],
  ["a-huge-heap", "--aot-huge-heap"],
  ["an-inspector", "--compile-inspector"],
  ["no-dotenv", "--no-compile-autoload-dotenv"],
  ["no-bunfig", "--no-compile-autoload-bunfig"],
  ["tsconfig-at-run-time", "--compile-autoload-tsconfig"],
  ["package-json-at-run-time", "--compile-autoload-package-json"],
  ["no-code-from-strings", "--disallow-code-generation-from-strings"],
  ["no-code-from-strings-at-all", "--disallow-code-generation-from-strings=strict"],
  ["code-from-disk-allowed", "--aot-allow-code-from-disk"],
  ["in-place", "--compile-in-place"],
  ["packages-bundled", "--packages=bundle"],
  ["packages-external", "--packages=external"],
  ["an-external-nobody-imports", "--external=nobody-imports-this"],
  ["a-condition", "--conditions=made-up"],
  ["a-root", "--root=."],
  ["a-public-path", "--public-path=/made-up/"],
  ["a-define-nobody-reads", "--define=NOBODY_READS_THIS=1"],
  ["debugger-dropped", "--drop=debugger"],
  ["the-environment-kept-out", "--env=disable"],
  ["the-environment-inlined", "--env=inline"],
  ["dce-annotations", "--emit-dce-annotations"],
  ["namespace-objects-without-setters", "--no-deprecated-namespace-object-setters"],
  ["arguments-for-the-executable", "--compile-exec-argv=--smol"],
  ["one-thread", "--aot-threads=1"],
  ["four-threads", "--aot-threads=4"],
  ["checked-first", "--check"],
  ["hardened-by-proof-checks", "--aot-harden=proof-checks"],
  ["hardened-against-told-ranges", "--aot-harden=ignore-told-ranges"],
  ["hardened-both-ways", "--aot-harden=proof-checks,ignore-told-ranges"],
  ["hardened-and-minified", "--aot-harden=proof-checks --minify"],
  ["hardened-with-a-huge-heap", "--aot-harden=proof-checks --aot-huge-heap"],
  ["explained", "--explain"],
  ["explained-in-json", "--explain=json"],
  ["its-guards-explained", "--explain=guards"],
  ["its-allocations-explained", "--explain=allocations"],
  ["bytecode-of-one-level", "--bytecode --bytecode-depth=1"],
  ["bytecode-not-optimized", "--bytecode --no-optimize-bytecode"],
  ["bytecode-and-minify", "--bytecode --minify"],
  ["a-jit-policy", "--compile-jit-policy=2"],
  ["an-entry-naming", "--entry-naming=[name].[ext]"],
  ["a-chunk-naming", "--chunk-naming=[name]-[hash].[ext]"],
  ["an-asset-naming", "--asset-naming=[name].[ext]"],
  ["splitting", "--splitting"],
  ["the-react-compiler", "--react-compiler"],
  ["fast-refresh", "--react-fast-refresh"],
  ["dotenv-at-run-time", "--compile-autoload-dotenv"],
  ["bunfig-at-run-time", "--compile-autoload-bunfig"],
  ["no-tsconfig", "--no-compile-autoload-tsconfig"],
  ["no-package-json", "--no-compile-autoload-package-json"],
  ["unresolved-allowed", "--allow-unresolved=*"],
  ["css-chunking", "--css-chunking"],
  ["obfuscate-and-no-function-source", "--obfuscate --no-compile-function-source"],
  ["an-inspector-and-a-sourcemap", "--compile-inspector --sourcemap=inline"],
  ["production-and-a-sourcemap", "--production --sourcemap=linked"],
];

// What the flags work on: several files that take things from each other, and syntax that a minifier rewrites.
const written: { name: string; text: string }[] = [
  {
    name: "names-and-a-default-imported.mjs",
    text:
      [
        'import shelf, { width, area } from "./shelf.mjs";',
        'console.log("SAID", shelf, width, area());',
        "// @filename: ./shelf.mjs",
        "export const width = 3;",
        "export function area() {",
        "  return width * 3;",
        "}",
        "export default 7;",
      ].join("\n") + "\n",
  },
  {
    name: "a-file-imported-at-run-time.mjs",
    text:
      [
        'const { width, widen } = await import("./shelf.mjs");',
        "widen();",
        'const again = await import("./shelf.mjs");',
        'console.log("SAID", width, again.width, Object.keys(again).sort().join());',
        "// @filename: ./shelf.mjs",
        "export let width = 0;",
        "export function widen() {",
        "  width++;",
        "}",
      ].join("\n") + "\n",
  },
  {
    name: "an-es-file-required-through-a-helper.cjs",
    text:
      [
        "const helped = one => (one && one.__esModule ? one : { default: one });",
        'const taken = helped(require("./shelf.mjs"));',
        'console.log("SAID", taken.default, taken.width, Object.keys(taken).sort().join());',
        "// @filename: ./shelf.mjs",
        "export const width = 3;",
        "export default 7;",
      ].join("\n") + "\n",
  },
  {
    name: "stars-handed-on.mjs",
    text:
      [
        'import * as all from "./barrel.mjs";',
        'console.log("SAID", Object.keys(all).sort().join(), all.width, all.depth);',
        "// @filename: ./barrel.mjs",
        'export * from "./shelf.mjs";',
        'export * from "./deep.mjs";',
        "// @filename: ./shelf.mjs",
        "export const width = 3;",
        "// @filename: ./deep.mjs",
        "export const depth = 2;",
      ].join("\n") + "\n",
  },
  {
    name: "two-files-that-import-each-other.mjs",
    text:
      [
        'import { even } from "./even.mjs";',
        'console.log("SAID", even(10), even(7));',
        "// @filename: ./even.mjs",
        'import { odd } from "./odd.mjs";',
        "export function even(n) {",
        "  return n === 0 ? true : odd(n - 1);",
        "}",
        "// @filename: ./odd.mjs",
        'import { even } from "./even.mjs";',
        "export function odd(n) {",
        "  return n === 0 ? false : even(n - 1);",
        "}",
      ].join("\n") + "\n",
  },
  {
    name: "json-imported.mjs",
    text:
      [
        'import data from "./data.json";',
        'console.log("SAID", data.rows.length, data.rows.map(row => row.size).join(), data.name);',
        "// @filename: ./data.json",
        '{ "name": "ash", "rows": [{ "size": 3 }, { "size": 8 }] }',
      ].join("\n") + "\n",
  },
  {
    name: "an-enum-and-a-namespace.ts",
    text:
      [
        "enum Wood {",
        "  Ash,",
        "  Elm = 4,",
        "  Oak,",
        "}",
        "namespace Sizes {",
        "  export const small = 3;",
        "  export function twice(n: number) {",
        "    return n * 2;",
        "  }",
        "}",
        'console.log("SAID", Wood.Oak, Wood[4], Sizes.twice(Sizes.small), Object.keys(Wood).join());',
        "export {};",
      ].join("\n") + "\n",
  },
  {
    name: "a-class-with-private-parts.mjs",
    text:
      [
        "class Shelf {",
        "  static #made = 0;",
        "  #rows = [];",
        "  static {",
        "    Shelf.#made = 10;",
        "  }",
        "  get size() {",
        "    return this.#rows.length;",
        "  }",
        "  set first(value) {",
        "    this.#rows[0] = value;",
        "  }",
        "  #add(value) {",
        "    this.#rows.push(value);",
        "    return ++Shelf.#made;",
        "  }",
        "  add(...values) {",
        "    return values.map(value => this.#add(value));",
        "  }",
        "  static has(one) {",
        "    return #rows in one;",
        "  }",
        "}",
        "const shelf = new Shelf();",
        "const made = shelf.add(3, 8);",
        "shelf.first = 5;",
        'console.log("SAID", made.join(), shelf.size, Shelf.has(shelf), Shelf.has({}));',
      ].join("\n") + "\n",
  },
  {
    name: "things-taken-apart.mjs",
    text:
      [
        'const rows = JSON.parse(\'[{"name":"ash","size":3,"tags":["a","b"]},{"name":"elm"}]\');',
        'let out = "";',
        'for (const { name, size = 1, tags: [first = "none", ...others] = [], ...rest } of rows)',
        '  out += [name, size, first, others.length, Object.keys(rest).length].join() + ";";',
        'const [, second = { name: "no" }, third = { name: "no" }] = rows;',
        'console.log("SAID", out, second.name, third.name);',
      ].join("\n") + "\n",
  },
  {
    name: "a-generator-and-labels.mjs",
    text:
      [
        "function* upTo(limit) {",
        "  for (let i = 0; i < limit; i++) {",
        "    const back = yield i;",
        "    if (back) i += back;",
        "  }",
        '  return "done";',
        "}",
        "const walker = upTo(10);",
        "const seen = [walker.next().value, walker.next(2).value, walker.next().value];",
        "let pairs = 0;",
        "outer: for (const a of upTo(4)) {",
        "  for (const b of upTo(4)) {",
        "    if (b > a) continue outer;",
        "    if (a + b > 4) break outer;",
        "    pairs++;",
        "  }",
        "}",
        'console.log("SAID", seen.join(), pairs, [...upTo(3)].join());',
      ].join("\n") + "\n",
  },
  {
    name: "code-that-never-runs-and-constants.mjs",
    text:
      [
        "const debug = false;",
        'const mode = "fast";',
        "function pick(n) {",
        "  debugger;",
        '  if (debug) return "debug";',
        '  if (typeof missing !== "undefined") return "there";',
        "  switch (mode) {",
        '    case "slow":',
        "      return n;",
        '    case "fast":',
        "      n *= 2;",
        "    default:",
        "      n += 1;",
        "  }",
        '  return n > 4 ? (n, "big") : (void 0 ?? "small");',
        "}",
        'console.log("SAID", pick(1), pick(3), 1 + 2 + "3" + 4 * 5, `${mode}-${1 + 1}`, !0 + !1);',
      ].join("\n") + "\n",
  },
  {
    name: "a-finally-and-a-closure-a-turn.mjs",
    text:
      [
        "function leave(n) {",
        "  try {",
        '    if (n > 1) throw new RangeError("big");',
        '    return "tried";',
        "  } catch (error) {",
        '    return error.name + ":" + error.message;',
        "  } finally {",
        "    n = -1;",
        "  }",
        "}",
        "const later = [];",
        "for (let i = 0; i < 3; i++) later.push(() => i * 2);",
        "var late = [];",
        "for (var j = 0; j < 3; j++) late.push(() => j);",
        'console.log("SAID", leave(1), leave(2), later.map(f => f()).join(), late.map(f => f()).join());',
      ].join("\n") + "\n",
  },
];

// Those, and eight of each family, spread over it.
const programs = [
  ...written,
  ...Array.from({ length: 8 }, (_, step) => everydayProgram((5 + step * 20011) % everydayProgramCount)),
  ...Array.from({ length: 8 }, (_, step) =>
    everydayGatheringProgram((5 + step * 20011) % everydayGatheringProgramCount),
  ),
  ...Array.from({ length: 8 }, (_, step) => everydayAwaitingProgram((5 + step * 20011) % everydayAwaitingProgramCount)),
];

const all = flags.length * programs.length;

function write(at: number): { name: string; text: string } {
  const [named, taken] = flags[at % flags.length];
  const { name, text } = programs[Math.floor(at / flags.length)];
  return { name: `${named}--${name}`, text: `// Flags: ${taken}\n${text}` };
}

const pad = (at: number) => String(at).padStart(4, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laidOut = 0;
  for (let at = 0; at < all && laidOut < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laidOut++;
  }
  console.log(laidOut);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}

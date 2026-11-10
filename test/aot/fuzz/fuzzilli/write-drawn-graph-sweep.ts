// Draws graphs of four to ten files, CommonJS and ES mixed, without a ring and without a load at run time: each file loads some of those behind it, by a statement or by require(), and hands on one text made of theirs.
// Only the entry prints, one line, so in which order the files run is not a matter of time. The number of a program is the seed of its draw: the same number is the same program.
// The second million are the graphs of the first with loads at run time besides: some files hold an import() in a function that nobody calls, or begin one; what those come to is sorted and printed in a second line.
// The third million are the graphs of the first with names handed on besides: some files hand on what a file behind them exports (by a star, by name, or member by member in a CommonJS file), and who loads them reads that
// through them too. The fourth million have both.
//
//   bun write-drawn-graph-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<files>-files--<commonjs>-commonjs--<loads>-loads--<entry>.mjs or .cjs
//   bun write-drawn-graph-sweep.ts count
//   bun write-drawn-graph-sweep.ts named <pattern> <folder> [most]
import { mkdirSync, writeFileSync } from "fs";

const plain = 1_000_000;
const all = 4 * plain;

function drawer(seed: number) {
  let state = (seed * 2654435761 + 12345) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  return { below: (end: number) => Math.floor(next() * end), chance: (of: number) => next() < of };
}

const builtIns = ["node:crypto", "node:os", "node:path", "node:events"];

function write(seed: number): { name: string; text: string } {
  const draw = drawer(seed % plain);
  const kind = Math.floor(seed / plain);
  const besides = kind & 1 ? drawer((plain + (seed % plain)) ^ 0x5bd1e995) : undefined;
  const through = kind & 2 ? drawer(seed % plain ^ 0x2545f491) : undefined;
  let atRunTime = 0;
  const count = 4 + draw.below(7);
  const isCommonJS = Array.from({ length: count }, () => draw.chance(0.5));
  const path = (at: number) => (at === 0 ? "main" : "m" + at) + (isCommonJS[at] ? ".cjs" : ".mjs");
  // Each file loads up to three of those behind it, and each but the entry is loaded by one in front of it.
  const loads: Set<number>[] = Array.from({ length: count }, () => new Set());
  for (let at = 0; at < count - 1; at++)
    for (let turn = draw.below(4); turn > 0; turn--) loads[at].add(at + 1 + draw.below(count - at - 1));
  for (let at = 1; at < count; at++) if (!loads.some(set => set.has(at))) loads[draw.below(at)].add(at);
  // Which of the files that a file loads it hands on, and how. A name is handed on one step: who loads the file reads it through the file.
  const handedOn: [number, number][][] = loads.map((set, at) =>
    at === 0 || !through ? [] : [...set].filter(() => through.chance(0.4)).map(to => [to, through.below(2)]),
  );
  const files = loads.map((set, at) => {
    const lines: string[] = [];
    const parts: string[] = [];
    const closes: string[] = [];
    for (const [to, way] of handedOn[at]) {
      if (isCommonJS[at]) closes.push(`module.exports.t${to} = require("./${path(to)}").t${to};`);
      else lines.push(way ? `export * from "./${path(to)}";` : `export { t${to} } from "./${path(to)}";`);
    }
    for (const to of [...set].sort((a, b) => (draw.chance(0.2) ? b - a : a - b))) {
      const [from, text] = [`"./${path(to)}"`, "t" + to];
      const way = draw.below(4);
      const more = handedOn[to].map(([name]) => name);
      const member = (of: string) => parts.push(`${of}.${text}`, ...more.map(name => `${of}.t${name}`));
      const names = (as: string) => [text, ...more.map(name => `t${name}${as}h${to}_${name}`)].join(", ");
      const named = () => parts.push(text, ...more.map(name => `h${to}_${name}`));
      if (isCommonJS[at]) {
        if (way === 0) (lines.push(`const { ${names(": ")} } = require(${from});`), named());
        else (lines.push(`const r${to} = require(${from});`), member("r" + to));
      } else if (way === 0 && at === 0) lines.push(`import ${from};`);
      else if (way === 1) (lines.push(`import * as n${to} from ${from};`), member("n" + to));
      else if (isCommonJS[to] && way === 2) (lines.push(`import r${to} from ${from};`), member("r" + to));
      else (lines.push(`import { ${names(" as ")} } from ${from};`), named());
    }
    if (draw.chance(0.15)) {
      const builtIn = builtIns[draw.below(builtIns.length)];
      lines.push(isCommonJS[at] ? `const b${at} = require("${builtIn}");` : `import b${at} from "${builtIn}";`);
      parts.push(`typeof b${at}`);
    }
    if (besides?.chance(0.35)) {
      atRunTime++;
      const way = at === count - 1 ? 2 : besides.below(3);
      const from = way === 2 ? '"node:os"' : `"./${path(at + 1 + besides.below(count - at - 1))}"`;
      if (way === 0) (lines.push(`const later${at} = () => import(${from});`), parts.push(`typeof later${at}`));
      else lines.push(`(globalThis.waits ??= []).push(import(${from}).then(names => "m${at}>" + Object.keys(names).sort().slice(0, 3).join("+")));`); // prettier-ignore
    }
    const made = parts.length ? `"${at ? "m" + at : "end "}(" + [${parts.join(", ")}].join() + ")"` : `"m${at}"`;
    if (at === 0) lines.push(`console.log(${made});`);
    if (at === 0 && besides) lines.push('Promise.all(globalThis.waits ?? []).then(all => console.log("later (" + all.sort().join() + ")"));'); // prettier-ignore
    if (at === 0) return lines.join("\n");
    if (!isCommonJS[at]) lines.push(`export const t${at} = ${made};`);
    else lines.push(draw.chance(0.3) ? `module.exports = { t${at}: ${made} };` : `exports.t${at} = ${made};`);
    return [...lines, ...closes].join("\n");
  });
  const edges = loads.reduce((sum, set) => sum + set.size, 0);
  return {
    name: `${count}-files--${isCommonJS.filter(Boolean).length}-commonjs--${edges}-loads--${besides ? atRunTime + "-at-run-time--" : ""}${through ? handedOn.flat().length + "-handed-on--" : ""}${isCommonJS[0] ? "a-commonjs-entry.cjs" : "an-es-entry.mjs"}`,
    text:
      [
        `// @entry: ./${path(0)}`,
        files[0],
        ...files.slice(1).flatMap((text, at) => [`// @filename: ./${path(at + 1)}`, text]),
      ].join("\n") + "\n",
  };
}

const pad = (at: number) => String(at).padStart(6, "0");
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

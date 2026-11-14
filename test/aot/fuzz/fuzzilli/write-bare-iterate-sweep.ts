// The least programs that go through something: what it is, times how it is gone through, times what is done in an iteration, times what changes meanwhile, times how often, with nothing beside.
//
//   bun write-bare-iterate-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<thing>--<way>--<deed>--<change>--<often>.mjs, .cjs or .ts
//   bun write-bare-iterate-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `it` is the thing.
const things: [name: string, text: string][] = [
  ["list", "const it = [3, 1, 2];"],
  ["doubles", "const it = [0.5, 1.5, -0, 2];"],
  ["texts", "const it = ['a', 'b', 'c'];"],
  ["objects", "const it = [{ x: 1 }, { x: 2 }, { x: 3 }];"],
  ["holes", "const it = [1, , 3];"],
  ["of-both", "const it = [1, 'b', null, 2.5, undefined];"],
  ["empty", "const it = [];"],
  ["pairs", "const it = [[1, 2], [3, 4]];"],
  ["map", "const it = new Map([[1, 'a'], ['k', 2]]);"],
  ["set", "const it = new Set([1, 'b', 2.5]);"],
  ["text", "const it = 'a\\u00e9\\u{1F600}b';"],
  ["words", "const it = new Int32Array([5, 6, 7]);"],
  ["floats", "const it = new Float64Array([0.5, NaN]);"],
  ["generator", "const it = (function* () {\n  yield 1;\n  yield 2.5;\n  yield 'c';\n})();"],
  ["iterable", "const it = {\n  *[Symbol.iterator]() {\n    yield 1;\n    yield 2;\n  },\n};"],
  [
    "by-hand",
    "let left = 3;\nconst it = {\n  [Symbol.iterator]() {\n    return this;\n  },\n  next() {\n    return left-- > 0 ? { value: left, done: false } : { value: 'end', done: true };\n  },\n  return() {\n    out.push('R');\n    return {};\n  },\n};",
  ],
  ["values-of-map", "const it = new Map([[1, 'a'], [2, 'b']]).values();"],
  ["entries-of-list", "const it = ['x', 'y'].entries();"],
  ["arguments", "const it = (function () {\n  return arguments;\n})(4, 5, 6);"],
  ["heir", "const it = new (class extends Array {})(1, 2, 3);"],
  ["object", "const it = { a: 1, b: 2, 3: 'c' };"],
  ["nothing", "const it = null;"],
  ["iterator-helper", "const it = [1, 2, 3].values().map(x => x * 2);"],
];
// DO is done with `x`; `k` counts where it can.
const ways: [name: string, text: string][] = [
  ["of", "for (const x of it) {\n  DO\n}"],
  ["of-let", "for (let x of it) {\n  DO\n}"],
  ["of-outer", "let x;\nfor (x of it) {\n  DO\n}\nout.push('last', show(x));"],
  ["in", "for (const x in it) {\n  DO\n}"],
  ["counted", "for (let k = 0; k < it.length; k++) {\n  const x = it[k];\n  DO\n}"],
  ["down", "for (let k = it.length - 1; k >= 0; k--) {\n  const x = it[k];\n  DO\n}"],
  ["each", "it.forEach(x => {\n  DO\n});"],
  ["spread", "for (const x of [...it]) {\n  DO\n}"],
  ["from", "Array.from(it, x => {\n  DO\n});"],
  ["destructured", "const [x, ...others] = it;\n{\n  DO\n}\nout.push(others.length);"],
  ["pairs", "for (const [x, y] of it) {\n  DO\n  out.push(show(y));\n}"],
  [
    "hand",
    "const steps = it[Symbol.iterator]();\nfor (let r = steps.next(); !r.done; r = steps.next()) {\n  const x = r.value;\n  DO\n}",
  ],
  ["keys", "for (const x of Object.keys(it)) {\n  DO\n}"],
  ["entries", "for (const [, x] of Object.entries(it)) {\n  DO\n}"],
  ["reduced", "it.reduce((all, x) => {\n  DO\n  return all;\n}, 0);"],
  ["mapped", "it.map(x => {\n  DO\n  return x;\n});"],
  ["delegated", "for (const x of (function* () {\n  yield* it;\n})()) {\n  DO\n}"],
  ["twice", "for (const x of it) for (const y of it) {\n  DO\n  if (out.length > 60) throw new RangeError('long');\n}"],
];
const deeds: [name: string, text: string][] = [["shown", "out.push(show(x));"], ["summed", "sum += +x || 0;"], ["counted", "sum++;"], ["text", "text += show(x);"], ["kept", "kept.push(x);"], ["field", "out.push(show(x?.x));"], ["if", "if (x === 2 || x === 'b') out.push('found');"], ["closure", "kept.push(() => x);"], ["throws", "if (x === 1 || x === 'a') throw new EvalError('e');\nout.push(show(x));"], ["caught", "try {\n  if (x === 1) null.x;\n  out.push(show(x));\n} catch {\n  out.push('c');\n}"]]; // prettier-ignore
// Stands behind the deed.
const changes: [name: string, text: string][] = [["nothing", ""], ["breaks", "break;"], ["breaks-later", "if (++turns === 2) break;"], ["continues", "if (++turns === 1) continue;\nout.push('-');"], ["pushed", "if (++turns < 3) it.push?.(9);"], ["popped", "if (++turns === 1) it.pop?.();"], ["removed", "if (++turns === 1) it.delete?.(1);"], ["added", "if (++turns < 4) it.add?.('n' + turns);"], ["stored", "if (++turns === 1) put(it);"], ["emptied", "cut(it);"], ["returns", "if (++turns === 2) return;"]]; // prettier-ignore
const often: [name: string, text: string][] = [["once", "attempt(run);"], ["three", "for (let n = 0; n < 3; n++) attempt(run);"], ["many", "for (let n = 0; n < 200; n++) {\n  out.length = 0;\n  attempt(run);\n}"]]; // prettier-ignore
const total = things.length * ways.length * deeds.length * changes.length * often.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const way = pick(ways);
  const thing = pick(things);
  const deed = pick(deeds);
  const change = pick(changes);
  const time = pick(often);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const isLoop = /^(let x;\n)?(for|const steps)/.test(way[1]);
  const behind = isLoop ? change[1] : change[1].replaceAll("break;", "return;").replaceAll("continue;", "return;");
  const isAlone = way[0] === "destructured";
  const step = `${deed[1]}${change[1] ? "\n" + (isAlone ? behind.replaceAll("return;", "out.push('r');") : behind) : ""}`;
  const body = `${thing[1]}\nlet turns = 0;\n${within(way[1], "DO", step)}`;
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    "const kept = [];",
    "let sum = 0;",
    "let text = '';",
    "const show = x => (Object.is(x, -0) ? '-0' : typeof x === 'function' ? 'f' : x && typeof x === 'object' ? JSON.stringify(x) : String(x));",
    "const attempt = call => {\n  try {\n    call();\n  } catch (error) {\n    out.push(error.name);\n  }\n};",
    ...(/cut\(/.test(body) ? ["const cut = list => {\n  if (Array.isArray(list)) list.length = 1;\n};"] : []),
    ...(/put\(/.test(body) ? ["const put = list => {\n  if (Array.isArray(list)) list[2] = 'st';\n};"] : []),
    `function run() {\n${indent(body, "  ")}\n}`,
    time[1],
    "console.log(out.join(' ').slice(0, 900), sum, text.slice(0, 200), kept.length, kept.slice(0, 20).map(x => show(typeof x === 'function' ? x() : x)).join());",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${thing[0]}--${way[0]}--${deed[0]}--${change[0]}--${time[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}

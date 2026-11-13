// Counted loops of all shapes, one behind and inside the other, over the same few lists, views and grids: bounds, steps, places, sums, stores, and what changes a list or a bound on the way.
//
//   bun write-random-mixed-loop-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<seed>-<loops>-<statements>.mjs, .cjs or .ts
import { mkdirSync, writeFileSync } from "node:fs";

// `L`, `M` are lists, `I`, `J` places, `X`, `Y` values, `G` a grid, `W` a view.
const statements = [
  "s += X;", "s = (s + X) | 0;", "d += X * Y;", "d += X;", "L[I] = X;", "L[I] += Y;", "L[I] = L[J];", "L[I]++;", "L[I] = (X + Y) | 0;", "L[I] = X * 0.5;",
  "if (X > Y) s++;", "if (X > Y) s++;\nelse d--;", "most = Math.max(most, X);", "if (X < least) least = X;", "const kept = L[I];\nL[I] = L[J];\nL[J] = kept;", "M.push(X);\nif (M.length > 12) M.length = 5;",
  "s ^= X;", "s = Math.imul(s, 31) + X;", "d = d * 0.5 + X;", "counts[X & 3]++;", "counts[(I) & 3] += Y;", "if (X === undefined) continue;", "if (s > 1e6) break;", "if (X === 3) break;", "if ((I) & 1) continue;",
  "s += half(X);", "s += add(X, Y);", "d += Math.sqrt(Math.abs(X));", "d += Math.floor(X / 3);", "isOver = X > 3 && Y < 2;", "s += X >>> 1;", "s += X % 7;", "s += (X / 2) | 0;", "L[I] = L[(I) - 1] + X;", "W[I] = X;", "s -= W[I];",
  "W[I] += X;", "d -= W[J] * 0.25;", "G[I & 1][J & 3] = X;", "s += G[I & 1][J & 3];", "for (const item of L) s = (s + item) | 0;", "text += X;\ntext = text.slice(-9);", "s = ~s;", "s = -s;", "s = s > 1000 ? 1 : s * 2;", "last = X;",
  "most = X > most ? X : most;", "s += L.length;", "n2 = L.length - 1;", "L[L.length - 1] = X;", "L[L.length] = X;\nif (L.length > 14) L.length = 6;", "s += X === Y ? 1 : 2;", "s += X == null ? 3 : 0;", "s |= X;", "s &= 0xffff;", "s <<= 1;",
  "s = (s + X * Y) & 0xff;", "d = Math.min(d, X) + i;", "s += i;", "d += i / 4;", "L[I] = -(X);", "L[I] ||= X;", "L[I] ??= Y;", "s += [X, Y][i & 1];", "s += Math.abs(X);", "d += Math.round(Y);", "s += L.indexOf(X);", "box.v += X;", "s += box.v;", "box.l[I] = X;", "s += box.l[J];",
]; // prettier-ignore
const changes = [
  "if (i === 2) L.length = 3;", "if (i === 1) L[1] = 0.5;", "if (i === 2) L[0] = 'k';", "if (i === 1) delete L[1];", "if (i === 2) L = M;", "if (i === 2) L = L.slice();", "if (i === 1) L.push(7, 8);", "if (i === 3) W = new Uint8Array(6);", "if (i === 2) n = 3;", "grow();",
  "if (i === 2) shorten(L);", "if (i === 1) L[9] = 1;", "if (i === 2) L[0] = undefined;", "if (i === 3) L[2] = 2 ** 31;", "if (i === 2) L.sort((one, two) => one - two);", "if (i === 1) L.reverse();", "if (i === 2) L.unshift(i);", "if (i === 3) box.l = L;", "if (i === 2) W.fill(i);", "if (i === 1) G[0] = G[1];",
]; // prettier-ignore
const heads = [
  "for (let i = 0; i < n; i++)", "for (let i = 0; i < L.length; i++)", "for (let i = 0; i + 1 < L.length; i++)", "for (let i = 0; i <= n - 1; i++)", "for (let i = 1; i < L.length; i += 2)", "for (let i = L.length - 1; i >= 0; i--)", "for (let i = n; i-- > 0; )", "for (let i = 0; i < L.length && i < M.length; i++)",
  "for (let i = 0; i !== 5; i++)", "for (let i = 0, j = L.length - 1; i < j; i++, j--)", "for (let i = 0; i * i < n; i++)", "for (let i = 1; i < 20; i <<= 1)", "for (let i = 0; i < Math.min(L.length, 7); i++)", "for (let i = 0; i < W.length; i++)", "for (let i = 0; i < 4; i++)", "for (let i = 0; i < 70; i++)", "for (let i = 0.5; i < n; i++)",
  "for (let i = 2; i < n; ++i)", "for (let i = n2; i < n; i++)", "for (let i = 0; i < n >> 1; i++)", "for (let i = 0; i < box.l.length; i++)", "for (var i = 0; i < n; i++)", "for (let i = -2; i < 3; i++)", "for (let i = 0; i < G.length; i++)",
]; // prettier-ignore
const places = [
  "i",
  "i",
  "i",
  "i + 1",
  "i - 1",
  "n - 1 - i",
  "i * 2",
  "i >> 1",
  "i & 3",
  "(i * 5) % 7",
  "i ^ 1",
  "L.length - 1 - i",
  "at[i & 3]",
  "i + n2",
  "0",
  "2",
];
const values = [
  "L[I]",
  "L[I]",
  "M[I]",
  "W[I]",
  "L[J]",
  "i",
  "s",
  "d",
  "3",
  "0.5",
  "-1",
  "L[I] + M[J]",
  "L[I] * 2",
  "n",
  "G[I & 1][J & 3]",
  "counts[I & 3]",
  "L.length",
  "box.v",
  "box.l[I]",
  "L[I] - i",
  "(L[I] | 0)",
  "at[i & 3]",
  "most",
];
const lists = [
  "[1, 2, 3, 4, 5, 6, 7]", "[0.5, 1.5, 2, 3.25, 4]", "[3, 1, 0.5, 2]", "[1, , 3, , 5]", "new Array(8).fill(0)", "Array.from({ length: 9 }, (_, k) => k * 2)", "Array.from({ length: 6 }, (_, k) => k / 2)", "[]", "[1, 'a', 2]", "new Int32Array([5, 4, 3, 2, 1])", "new Float64Array([0.5, 1, 2])", "given", "given.slice()",
  "JSON.parse('[4,5,6,7]')", "[9, 8, 7, 6, 5, 4, 3, 2, 1, 0]", "new Array(5)", "[2 ** 31, -5, 7, NaN, -0]", "[...given, 1]",
]; // prettier-ignore
const views = ["new Uint8Array(8)", "new Int32Array([1, 2, 3, 4, 5, 6])", "new Float64Array([0.5, 1.5, 2.5, 3.5])", "new Uint8ClampedArray(4)", "new Float32Array(5)", "new Uint32Array([4294967295, 1, 2, 3])", "new Int8Array([-1, 2, -3, 4, 5])"]; // prettier-ignore
const tails = [
  "while (L.length < 6 && s < 99) {\n  L.push(s++);\n}", "let k = 0;\ndo {\n  s += k;\n} while (++k < n);", "let low = 0;\nlet high = L.length;\nwhile (low < high) {\n  const middle = (low + high) >> 1;\n  if (L[middle] < 3) low = middle + 1;\n  else high = middle;\n}\ns += low;",
]; // prettier-ignore

function write(seed: number): { name: string; text: string } {
  let state = (seed * 2654435761 + 99991) >>> 0 || 1;
  const random = (below: number): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % below;
  };
  for (let turn = 0; turn < 8; turn++) random(2);
  const pick = <T>(from: readonly T[]): T => from[random(from.length)];
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const isTyped = seed % 3 === 1;
  const isCommon = !isTyped && seed % 5 === 0;
  let count = 0;
  let loops = 0;
  // The counters of the loops around, the nearest first.
  const fill = (text: string, counters: string[]): string => {
    const list = () => (random(3) ? "xs" : "ys");
    let filled = text;
    const first = list();
    const second = random(2) ? first : list();
    filled = filled.replaceAll(/\b[XY]\b/g, () => pick(values));
    filled = filled.replaceAll(/\b[IJ]\b/g, () => pick(places));
    filled = filled.replaceAll(/\bL\b/g, first).replaceAll(/\bM\b/g, second).replaceAll(/\bW\b/g, "bytes").replaceAll(/\bG\b/g, "grid"); // prettier-ignore
    return filled.replaceAll(/\bi\b/g, () => (counters.length > 1 && random(3) === 0 ? pick(counters) : counters[0]));
  };
  const draw = (depth: number, counters: string[]): string => {
    const parts: string[] = [];
    for (let at = 1 + random(4); at > 0; at--) {
      count++;
      if (depth < 2 && random(4) === 0) parts.push(loop(depth + 1, counters));
      else if (random(9) === 0) parts.push(fill(pick(changes), counters));
      else {
        const text = fill(pick(statements), counters);
        parts.push(/^const /m.test(text) ? `{\n${indent(text, "  ")}\n}` : text);
      }
    }
    return parts.join("\n");
  };
  const loop = (depth: number, counters: string[]): string => {
    loops++;
    if (random(14) === 0) return `{\n${indent(fill(pick(tails), counters.length ? counters : ["n"]), "  ")}\n}`;
    const counter = "ijk"[depth];
    const head = fill(pick(heads).replaceAll(/\bj\b/g, "back"), ["COUNTER"]).replaceAll("COUNTER", counter);
    const body = draw(depth, [counter, ...counters]);
    // A list that the loop may grow does not bound the loop alone.
    const grows = ["xs", "ys", "box.l"].some(list => head.includes(`${list}.length`) && (body.includes(`${list}[`) || /push|unshift|grow|= (xs|ys)/.test(body))); // prettier-ignore
    return `${head} {\n${grows ? `  if (${counter} > 40) break;\n` : ""}${indent(body, "  ")}\n}`;
  };
  const functions = 1 + random(2);
  const bodies: string[] = [];
  for (let at = 0; at < functions; at++) {
    const parts = Array.from({ length: 1 + random(3) }, () => loop(0, []));
    const type = (text: string) => (isTyped ? `: ${text}` : "");
    const isGivenList = random(3) === 0;
    bodies.push(
      [
        `function work${at}(n${type("number")}, given${type("number[]")}${isGivenList ? `, xs${type("number[]")}` : ""}) {`,
        `  let s${type("number")} = 0;`,
        `  let d${type("number")} = 0.5;`,
        "  let most = 0;",
        "  let least = 9;",
        "  let n2 = 1;",
        "  let isOver = false;",
        "  let last;",
        '  let text = "";',
        ...(isGivenList ? [] : [`  let xs${type("number[]")} = ${pick(lists)};`]),
        `  let ys${type("number[]")} = ${pick(lists)};`,
        `  let bytes = ${pick(views)};`,
        "  const grid = [[1, 2, 3, 4], [0.5, 1, 2, 3]];",
        "  const counts = [0, 0, 0, 0];",
        "  const at = [2, 0, 1, 3];",
        `  const box = { v: ${pick(["0", "0.5"])}, l: ${pick(lists)} };`,
        "  const grow = () => void (xs.length < 9 && xs.push?.(n));",
        indent(parts.join("\n"), "  "),
        "  out.push([s, d, most, least, n2, isOver, last, text, xs, ys, bytes, grid, counts, box.v, box.l].map(show).join(' '));",
        "  return s;",
        "}",
      ].join("\n"),
    );
    bodies.push(
      isGivenList
        ? `const call${at} = (n, given) => work${at}(n, given, ${pick(lists)});`
        : `const call${at} = work${at};`,
    );
  }
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Array.isArray(value) ? "[" + Array.from({ length: Math.min(value.length, 16) }, (_, k) => (k in value ? show(value[k]) : "hole")) + "]" : ArrayBuffer.isView(value) ? "<" + Array.from(value).map(show) + ">" : Object.is(value, -0) ? "-0" : String(value).slice(0, 24));',
    "const out = [];",
    "const half = value => value / 2;",
    "function add(one, two) {\n  return one + two;\n}",
    "const shorten = list => {\n  if (Array.isArray(list)) list.length = 2;\n};",
    ...bodies,
    "for (const n of [5, 8]) {",
    ...Array.from(
      { length: functions },
      (_, at) =>
        `  try {\n    call${at}(n, n > 5 ? [0.5, 1, 2, 3] : [4, 3, 2, 1, 0]);\n  } catch (error) {\n    out.push(error.name);\n  }`,
    ),
    "}",
    'console.log(out.join("\\n").slice(0, 3000));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return { name: `${loops}-${count}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`, text: lines.join("\n") + "\n" };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? 100), Number(process.argv[5] ?? 1)]; // prettier-ignore
mkdirSync(folder, { recursive: true });
for (let step = 0; step < count; step++) {
  const seed = from + step * stride;
  const program = write(seed);
  writeFileSync(`${folder}/${padNumber(seed)}-${program.name}`, program.text);
}
console.log(count);

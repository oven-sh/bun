// Where an index lies: the formula of the index, times the test in front of the access, times the list, times the access, times the loop, times what changes a variable of the formula in between, times the kind of the function.
// Every program calls its function with sizes and offsets in front of, at and behind the ends of the list.
//
//   bun write-index-formula-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<index>--<test>--<list>--<access>--<loop>--<event>.ts or .mjs
//   bun write-index-formula-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `i` and `j` are counters, `n`, `w` and `k` parameters, `off` and `p` variables, `len` a length that was read in front of the loop, `a` the list.
const indexes: [name: string, text: string][] = [
  ["i", "i"], ["next", "i + 1"], ["previous", "i - 1"], ["plus-parameter", "i + k"], ["minus-parameter", "i - k"], ["from-parameter", "k - i"], ["from-the-end", "n - 1 - i"], ["length-from-the-end", "a.length - 1 - i"], ["old-length-from-the-end", "len - 1 - i"], ["twice", "i * 2"], ["twice-and-one", "i * 2 + 1"], ["row", "i * w + j"], ["row-brackets", "(i + 1) * w + j - w"], ["half", "i >> 1"], ["half-floor", "Math.floor(i / 2)"], ["half-bits", "(i / 2) | 0"], ["masked", "i & 7"], ["remainder", "i % w"], ["remainder-of-length", "i % a.length"], ["wrapped", "(i + off) % a.length"], ["wrapped-back", "(i - off + a.length) % a.length"], ["least", "Math.min(i, a.length - 1)"], ["greatest", "Math.max(i - 1, 0)"], ["clamped", "Math.min(Math.max(i - off, 0), len - 1)"], ["absolute", "Math.abs(i - 4)"], ["other", "i ^ 1"], ["not", "~i"], ["chosen", "i & 1 ? i : j"], ["offset", "off + i"], ["offset-alone", "off"], ["pointer", "p"], ["pointer-stepped", "p++"], ["pointer-stepped-first", "++p"], ["pointer-back", "--p"], ["middle", "(off + n) >> 1"], ["middle-unsigned", "(i + n) >>> 1"], ["of-a-list", "at[i & 3]!"], ["of-itself", "a[i & 3]!"], ["code", '"acegik".charCodeAt(i) - 97'], ["fraction", "i - 0.5"], ["unsigned", "(i - 1) >>> 0"], ["shifted", "i << 1"], ["minus", "-i"], ["sum", "i + j"], ["difference", "i - j"],
]; // prettier-ignore
const tests: [name: string, text: string][] = [
  ["none", "ACCESS"],
  ["below-length", "if (x < a.length) {\nACCESS\n}"],
  ["below-old-length", "if (x < len) {\nACCESS\n}"],
  ["not-negative", "if (x >= 0) {\nACCESS\n}"],
  ["both", "if (x >= 0 && x < a.length) {\nACCESS\n}"],
  ["both-of-old", "if (x >= 0 && x < len) {\nACCESS\n}"],
  ["out-continues", "if (x < 0 || x >= a.length) continue;\nACCESS"],
  ["out-breaks", "if (x >= n) break;\nACCESS"],
  ["in", "if (x in a) {\nACCESS\n}"],
  ["below-parameter", "if (x < n && x > -1) {\nACCESS\n}"],
  ["unsigned", "if (x >>> 0 < a.length) {\nACCESS\n}"],
];
const lists: [name: string, text: string, type: string][] = [
  ["bytes", "new Uint8Array(8).fill(3)", "Uint8Array"],
  ["int32s", "Int32Array.of(1, 2, 3, 4, 5, 6, 7, 8)", "Int32Array"],
  ["doubles", "new Float64Array(8).fill(0.5)", "Float64Array"],
  ["floats", "new Float32Array(7)", "Float32Array"],
  ["part", "new Int32Array(16).fill(9).subarray(2, 9)", "Int32Array"],
  ["growing-view", "new Uint8Array(new ArrayBuffer(6, { maxByteLength: 24 }))", "Uint8Array"],
  ["integers", "[1, 2, 3, 4, 5, 6, 7, 8]", "number[]"],
  ["numbers", "[0.5, 1.5, 2, 3, 4]", "number[]"],
  ["filled", "new Array(n).fill(1)", "number[]"],
  ["made", "Array.from({ length: n }, (_, at) => at * 2)", "number[]"],
  ["empty", "[]", "number[]"],
  ["no-bytes", "new Uint8Array(0)", "Uint8Array"],
  ["of-size", "new Float64Array(n)", "Float64Array"],
  ["holes", "[1, , 3, 4, , 6]", "any"],
];
// `x` is the index.
const accesses: [name: string, text: string][] = [
  ["read", "sum += a[x] ?? 100;"],
  ["read-twice", "sum += (a[x] ?? 0) + (a[x + 1] ?? 7);"],
  ["store", "a[x] = i;"],
  ["add", "a[x] += 2;\nsum++;"],
  ["step", "a[x]++;"],
  ["compared", "if (a[x] === 3) sum += 5;\nelse sum += 9;"],
  ["nothing", "sum += a[x] === undefined ? 1000 : 1;"],
  ["swapped", "const spare = a[x];\na[x] = a[0];\na[0] = spare;"],
  ["copied", "b[x] = a[x];"],
  ["into", "a[x] = b[x & 3];"],
  ["double", "sum += a[x] * 0.5;"],
  ["found", "sum += at[a[x] & 3] ?? 50;"],
];
const loops: [name: string, text: string][] = [
  ["up-to-parameter", "for (let i = 0; i < n; i++) {\nTURN\n}"],
  ["up-to-length", "for (let i = 0; i < a.length; i++) {\nTURN\n}"],
  ["up-to-old-length", "for (let i = 0; i < len; i++) {\nTURN\n}"],
  ["up-to-written", "for (let i = 0; i < 6; i++) {\nTURN\n}"],
  ["from-below", "for (let i = -2; i < n; i++) {\nTURN\n}"],
  ["through-the-end", "for (let i = 0; i <= a.length; i++) {\nTURN\n}"],
  ["down", "for (let i = n - 1; i >= 0; i--) {\nTURN\n}"],
  ["down-past", "for (let i = n; i >= -1; i--) {\nTURN\n}"],
  ["by-two", "for (let i = 0; i < n; i += 2) {\nTURN\n}"],
  ["by-parameter", "for (let i = 0; i < n; i += step) {\nTURN\n}"],
  ["while", "let i = 0;\nwhile (i < a.length) {\nTURN\ni++;\n}"],
  ["do", "let i = k;\ndo {\nTURN\n} while (++i < n);"],
  ["nest", "for (let i = 0; i < w; i++) {\nfor (j = 0; j < w; j++) {\nTURN\n}\n}"],
  ["triangle", "for (let i = 0; i < n; i++) {\nfor (j = 0; j < i; j++) {\nTURN\n}\n}"],
  ["over-a-list", "for (const i of [0, 3, 1, 7, 9]) {\nTURN\n}"],
];
const events: [name: string, text: string][] = [
  ["nothing", ""],
  ["nothing-again", ""],
  ["offset-grows", "off++;"],
  ["offset-set", "if (i === 2) off = k;"],
  ["offset-back", "off -= 2;"],
  ["pointer-set", "if (i === 1) p = n;"],
  ["parameter-grows", "if (i === 2) n += 1;"],
  ["parameter-shrinks", "n--;"],
  ["width", "if (i === 1) w = 2;"],
  ["list-grows", "if (Array.isArray(a) && a.length < 12) a.push(i);"],
  ["list-shrinks", "if (Array.isArray(a)) a.pop();"],
  ["list-cut", "if (Array.isArray(a) && i === 1) a.length = 2;"],
  ["view-grows", "if (i === 1) resize(16);"],
  ["view-shrinks", "if (i === 1) resize(2);"],
  ["other-list", "if (i === 2) a = b;"],
  ["counter", "if (k === 3 && i === 1) j++;"],
];
const functions = ["plain", "plain", "async", "generator", "captured", "field"] as const;
const total = indexes.length * tests.length * lists.length * accesses.length * loops.length * events.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = Number((BigInt(cell) * 829348951n) % BigInt(total));
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const event = pick(events);
  const index = pick(indexes);
  const loop = pick(loops);
  const access = pick(accesses);
  const list = pick(lists);
  const test = pick(tests);
  const kind = pick(functions);
  const isTyped = cell % 2 === 0;
  const t = (type: string) => (isTyped ? type : "");
  const plain = (text: string) => (isTyped ? text : text.replaceAll("]!", "]"));
  const wait =
    kind === "async" ? "await null;" : kind === "generator" ? "yield i;" : kind === "captured" ? "touch();" : "";
  const turn = ["if (--fuel < 0) break;", `const x = ${index[1]};`, test[1].replace("ACCESS", () => access[1]), event[1], wait].filter(text => text).join("\n"); // prettier-ignore
  const head = kind === "async" ? "async function run" : kind === "generator" ? "function* run" : "function run";
  const source = list[1].startsWith("new Uint8Array(new") ? "new Uint8Array(new (ArrayBuffer as any)(6, { maxByteLength: 24 }))" : list[1]; // prettier-ignore
  const made = isTyped ? source : list[1];
  const type = list[0] === "holes" || event[0] === "other-list" ? "any" : list[2];
  const body = [
    ...(kind === "field" ? [`const holder${t(`: { a: ${type} }`)} = { a: ${made} };`, "let a = holder.a;"] : [`let a${t(`: ${type}`)} = ${made};`]), // prettier-ignore
    `const b${t(": any")} = [5, 6, 7];`,
    "const at = [0, 2, 9, -1];",
    "const len = a.length;",
    "let off = k;",
    "let p = 0;",
    "let j = 1;",
    "let sum = 0;",
    "let fuel = 50;",
    `const resize = (size${t(": number")}) => {\n  if (ArrayBuffer.isView(a) && (a.buffer${t(" as any")}).resizable) (a.buffer${t(" as any")}).resize(size);\n};`,
    ...(kind === "captured" ? ["const touch = () => {\n  if (off > 40) off = 0;\n  return a.length + p + n;\n};"] : []),
    plain(loop[1].replace("TURN", () => turn)),
    `${kind === "generator" ? "yield" : "return"} [sum, off, p, n, a.length, a.length < 1000 ? Array.from(a${t(" as any")}).join() : "long", b.length < 1000 ? Array.from(b).join() : "long"].join("|");`,
  ]; // prettier-ignore
  const call = (given: string) => (kind === "async" ? `await run(${given})` : kind === "generator" ? `[...run(${given})].pop()` : `run(${given})`); // prettier-ignore
  const lines = [
    `${head}(n${t(": number")}, w${t(": number")}, k${t(": number")}, step = 1)${t(kind === "async" ? ": Promise<any>" : ": any")} {`,
    ...body.join("\n").split("\n").map(line => "  " + line),
    "}",
    "const hidden = JSON.parse(\"[5,3,1,20,-3,0]\");",
    ...["8, 3, 0", "5, 2, 3", "12, 4, -2", "3, 20, 1, 2", "hidden[0], hidden[1], hidden[2]", "hidden[3], hidden[1], hidden[4], 3", "0, 1, hidden[5]"].map(given => `console.log(${call(given)});`),
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return { name: `${index[0]}--${test[0]}--${list[0]}--${access[0]}--${loop[0]}--${event[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.join("\n") + "\n" }; // prettier-ignore
}

const padNumber = (index: number) => String(index).padStart(9, "0");
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

// One call of a built-in, asked again behind a change: the call, times what its receiver is, times what is done around it. A call may be kept only for as long as nothing that it reads has changed, its result is its caller's own, and what it does to its receiver is not left out.
//
//   bun write-builtin-use-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<receiver>--<call>--<around>.mjs or .ts
//   bun write-builtin-use-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// The receivers: how one is made, and how it is changed. `r` is the receiver, `k` a number, `f` a function that is called back.
const receivers: [name: string, made: string, change: string, calls: string[]][] = [
  [
    "list",
    "[3, 1, 2, 5]",
    "r[1] = 9;",
    ["r.at(1)", "r.at(-k)", "r.concat([k])", "r.copyWithin(0, k)", "r.entries().next().value", "r.every(f)", "r.fill(k, 2)", "r.filter(f)", "r.find(f)", "r.findIndex(f)", "r.findLast(f)", "r.findLastIndex(f)", "r.flat()", "r.flatMap(x => [x, k])", "r.forEach(f)", "r.includes(9)", "r.indexOf(9)", "r.join(k)", "r.keys().next().value", "r.lastIndexOf(1)", "r.map(f)", "r.pop()", "r.push(k)", "r.reduce((a, b) => a + b)", "r.reduceRight((a, b) => a - b)", "r.reverse()", "r.shift()", "r.slice(k)", "r.some(f)", "r.sort()", "r.sort((a, b) => b - a)", "r.splice(1, 1)", "r.splice(k, 0, 7)", "r.toReversed()", "r.toSorted()", "r.toSpliced(1, 1)", "r.toString()", "r.unshift(k)", "r.values().next().value", "r.with(1, k)", "[...r]", "Array.from(r)", "Array.from(r, f)", "Array.of(...r)", "Array.isArray(r)", "r.length", "Math.max(...r)", "Object.keys(r)", "Object.entries(r)", "JSON.stringify(r)", "String(r)", "structuredClone(r)", "new Set(r).size", "r.hasOwnProperty(1)", "Object.hasOwn(r, k)", "1 in r"],
  ],
  [
    "text",
    '"a-b-c"',
    'r = r + "-d";',
    ["r.at(k)", "r.charAt(k)", "r.charCodeAt(k)", "r.codePointAt(k)", 'r.concat("x")', 'r.endsWith("d")', 'r.includes("d")', 'r.indexOf("-", k)', 'r.lastIndexOf("-")', 'r.localeCompare("a-b-c")', "r.match(/b/)", "[...r.matchAll(/-/g)].length", "r.normalize()", "r.padEnd(9, k)", "r.padStart(9)", "r.repeat(2)", 'r.replace("-", k)', 'r.replace(/-/g, "+")', 'r.replaceAll("-", "")', "r.search(/c/)", "r.slice(k)", "r.slice(-k)", 'r.split("-")', 'r.startsWith("a")', "r.substring(1, 3)", "r.toLowerCase()", "r.toUpperCase()", "r.trim()", "r.trimEnd()", "r[k]", "r.length", "[...r].length", "Number(r)", "parseInt(r)", "encodeURIComponent(r)", "JSON.stringify(r)", "r.codePointAt(0)", "r.isWellFormed()", "r.substr(1, 2)", "/b/.test(r)", "/(b)-(c)/.exec(r)"],
  ],
  [
    "map",
    "new Map([[1, 2], [2, 3]])",
    "r.set(1, 9);",
    ["r.get(k)", "r.has(k)", "r.size", "r.set(k, 4)", "r.delete(k)", "[...r]", "[...r.keys()]", "[...r.values()]", "[...r.entries()]", "r.forEach(f)", "r.clear()", "new Map(r).size", "r.keys().next().value", "Object.fromEntries(r)", "Array.from(r)", "Array.from(r.values(), f)", "Map.groupBy([1, 2, 3], x => x % k).size"],
  ],
  [
    "set",
    "new Set([1, 2, 3])",
    "r.add(9);",
    ["r.has(9)", "r.size", "r.add(k)", "r.delete(k)", "[...r]", "[...r.entries()].length", "r.forEach(f)", "r.clear()", "r.union(new Set([7])).size", "r.intersection(new Set([9])).size", "r.difference(new Set([1])).size", "r.isSubsetOf(new Set([1, 2, 3]))", "r.values().next().value", "Array.from(r, f)", "Math.max(...r)"],
  ],
  [
    "object",
    "{ a: 1, b: 2 }",
    "r.b = 9;",
    ["Object.keys(r)", "Object.values(r)", "Object.entries(r)", "Object.assign({}, r)", "Object.assign(r, { c: k })", "({ ...r })", "JSON.stringify(r)", "Object.getOwnPropertyNames(r)", 'Object.hasOwn(r, "b")', '"b" in r', "Object.freeze(r)", "Object.isFrozen(r)", "Object.getPrototypeOf(r) === Object.prototype", "Object.create(r).b", "structuredClone(r)", "Reflect.ownKeys(r)", 'Reflect.get(r, "b")', 'Reflect.set(r, "b", k)', 'Reflect.deleteProperty(r, "a")', 'Object.getOwnPropertyDescriptor(r, "b")', 'Object.defineProperty(r, "d", { value: k, enumerable: true })', "Object.fromEntries(Object.entries(r))", "Object.seal(r)", "Object.preventExtensions(r)", "r.hasOwnProperty('b')", "r.toString()", "Object.is(r.b, 9)", "Object.entries(r).map(([x, y]) => x + y)"],
  ],
  [
    "typed-list",
    "new Int32Array([3, 1, 2])",
    "r[1] = 9;",
    ["r.at(1)", "r.fill(k, 2)", "r.filter(f)", "r.find(f)", "r.findIndex(f)", "r.includes(9)", "r.indexOf(9)", "r.join()", "r.map(f)", "r.reduce((a, b) => a + b)", "r.reverse()", "r.set([7], 1)", "r.slice(k)", "r.sort()", "r.subarray(1)", "r.subarray(1)[0]", "r.toReversed()", "r.toSorted()", "r.with(0, k)", "[...r]", "Array.from(r)", "new Float64Array(r)", "r.length", "r.byteLength", "r.every(f)", "r.some(f)", "r.forEach(f)", "r.copyWithin(0, 1)", "r.lastIndexOf(9)", "new Uint8Array(r.buffer)[4]", "r.keys().next().value", "r.entries().next().value", "Math.max(...r)", "new DataView(r.buffer).getInt32(4, true)"],
  ],
  [
    "number",
    "12.5",
    "r = r + 1;",
    ["Math.abs(r)", "Math.ceil(r)", "Math.floor(r)", "Math.round(r)", "Math.trunc(r)", "Math.sqrt(r)", "Math.sign(r)", "Math.min(r, 3)", "Math.max(r, 99)", "Math.pow(r, 2)", "Math.hypot(r, 2)", "Math.imul(r, 3)", "Math.clz32(r)", "Math.fround(r)", "Math.log2(r)", "Number.isInteger(r)", "Number.isSafeInteger(r)", "Number.isNaN(r)", "isFinite(r)", "r.toFixed(1)", "r.toString(2)", "r.toPrecision(3)", "String(r)", "parseFloat(r)", "parseInt(r)", "r.toExponential(1)", "Number(r)", "BigInt(Math.trunc(r))", "Math.cbrt(r)", "Math.atan2(r, k)", "new Date(r).getTime()", "String.fromCharCode(r + 60)", "[r, 1, 20].sort()"],
  ],
  [
    "expression",
    "/(b)-?/g",
    'r.lastIndex = 2;',
    ['r.test("a-b-b-")', 'r.exec("a-b-b-")?.index', '"a-b-b-".replace(r, "x")', '"a-b-b-".match(r)', '[..."a-b-b-".matchAll(r)].length', '"a-b-b-".split(r)', '"a-b-b-".search(r)', "r.lastIndex", "r.source", "r.flags", "r.global", "r.toString()", "new RegExp(r).lastIndex", 'r[Symbol.replace]("b-", "")', 'r.exec("bb")'],
  ],
  [
    "buffer",
    "new ArrayBuffer(8)",
    "new Uint8Array(r)[1] = 9;",
    ["new Uint8Array(r)[1]", "r.slice(0, 4)", "new Uint8Array(r.slice(0, 4))[1]", "r.byteLength", "new Uint16Array(r)", "[...new Uint8Array(r)]", "new DataView(r).getUint16(0)", "new DataView(r).setUint8(0, k)", "new Uint8Array(r, 1, 2).length", "ArrayBuffer.isView(r)", "new Uint8Array(r).fill(k)", "new Uint8Array(r).subarray(1)", "Buffer.from(r).toString('hex')", "new Float64Array(r)[0]"],
  ],
  [
    "date",
    "new Date(86400000)",
    "r.setTime(5000);",
    ["r.getTime()", "r.valueOf()", "+r", "r.toISOString()", "r.getUTCFullYear()", "r.getUTCDate()", "r.setUTCHours(k)", "JSON.stringify(r)", "new Date(r).getTime()", "r.getUTCDay()", "Date.UTC(1970, k)", "r.toJSON()"],
  ],
]; // prettier-ignore
// `E` is the call, `MAKE` makes a receiver, `CHANGE` changes it.
const around: [name: string, text: string][] = [
  ["twice", "let r = MAKE;\nconst first = E;\nconst second = E;\nnote(first, second, r);"],
  ["changed-between", "let r = MAKE;\nconst first = E;\nCHANGE\nconst second = E;\nnote(first, second, r);"],
  ["loop", "let r = MAKE;\nfor (let i = 0; i < 4; i++) {\n  note(E);\n  if (i === 1) {\n    CHANGE\n  }\n}\nnote(r);"],
  ["unread", "let r = MAKE;\nE;\nnote(r);"],
  ["own-result", "let r = MAKE;\nconst first = E;\nif (typeof first === \"object\" && first !== null) {\n  try {\n    first.tag = 1;\n    first[0] = 77;\n  } catch (error) {\n    note(error.name);\n  }\n}\nnote(first, E, r);"],
  ["same-result", "let r = MAKE;\nconst first = E;\nnote(first === E, first === r, r);"],
  ["through-a-function", "let r = MAKE;\nconst ask = () => E;\nconst change = () => {\n  CHANGE\n};\nnote(ask());\nchange();\nnote(ask(), r);"],
  ["on-one-side", "let r = MAKE;\nconst first = E;\nif (k > 1) {\n  CHANGE\n}\nnote(first, E, r);"],
  ["in-a-try", "let r = MAKE;\nlet seen = 0;\ntry {\n  seen = 1;\n  note(E);\n  seen = 2;\n  if (k > 1) throw new Error(\"left\");\n  CHANGE\n} catch (error) {\n  note(seen, error.name);\n}\nnote(E, r);"],
  ["two-names", "let r = MAKE;\nconst other = r;\nconst first = E;\n{\n  let kept = r;\n  r = other;\n  CHANGE\n  kept = r;\n  note(kept === other);\n}\nnote(first, E);"],
  ["given", "function ask(r) {\n  const first = E;\n  CHANGE\n  return [first, E, r];\n}\nfor (let i = 0; i < 3; i++) note(...ask(MAKE));"],
  ["frozen", "let r = MAKE;\nif (typeof r === \"object\" && !ArrayBuffer.isView(r)) Object.freeze(r);\nnote(E, r);"],
]; // prettier-ignore
const calls = receivers.flatMap(([name, made, change, texts]) => texts.map(text => ({ name, made, change, text })));
const total = calls.length * around.length * 8;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const call = pick(calls);
  const place = pick(around);
  const isParsed = rest & 1;
  const inFunction = rest & 2;
  // What is handed over counts how often it is asked for a number.
  const isCounted = rest & 4;
  const [one, two] = isCounted ? ["counted(1)", "counted(2)"] : ["1", "2"];
  const made = isParsed && /^(\[[\d, ]+\]|"[^"]*"|-?[\d.]+)$/.test(call.made) ? `JSON.parse(${JSON.stringify(call.made)})` : call.made; // prettier-ignore
  const text = place[1].replaceAll("CHANGE", () => call.change).replaceAll("MAKE", () => made).replaceAll(/\bE\b/g, () => (call.text.startsWith("{") ? `(${call.text})` : call.text)); // prettier-ignore
  const steps = ["try {", ...text.split("\n").map(line => "  " + line), "} catch (error) {", '  note("threw", error?.name);', "}"]; // prettier-ignore
  const lines = [
    "const notes = [];",
    'const show = (value, depth = 0) => (typeof value === "function" ? "function" : typeof value === "bigint" ? value + "n" : typeof value !== "object" || value === null ? (Object.is(value, -0) ? "-0" : String(value)) : depth > 2 ? "deep" : value instanceof Map || value instanceof Set ? "{" + [...value].map(one => show(one, depth + 1)).join() + "}" : value instanceof Date ? "date" + value.getTime() : value instanceof RegExp ? String(value) + value.lastIndex : value instanceof ArrayBuffer ? "bytes" + new Uint8Array(value).join() : (Array.isArray(value) ? "[" : "{") + Reflect.ownKeys(value).map(key => String(key) + ":" + show(value[key], depth + 1)).join());',
    'const note = (...values) => {\n  notes.push(values.map(one => show(one)).join("|"));\n};',
    "let calls = 0;",
    "const counted = n => ({\n  valueOf() {\n    calls++;\n    return n;\n  },\n});",
    "const f = x => {\n  calls++;\n  return x > 1;\n};",
    ...(inFunction ? ["function run(k) {", ...steps.map(line => "  " + line), "}", `run(${one});`, `run(${two});`] : [`for (const k of [${one}, ${two}]) {`, ...steps.map(line => "  " + line), "}"]), // prettier-ignore
    'console.log(notes.join("\\n"), calls);',
  ];
  return { name: `${call.name}--${call.text.replaceAll(/[^a-zA-Z0-9]+/g, "-").slice(0, 50)}--${place[0]}--${isParsed ? "parsed" : "written"}${isCounted ? "-counted" : ""}.mjs`, text: lines.join("\n") + "\n" }; // prettier-ignore
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

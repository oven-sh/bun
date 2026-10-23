// bun held-across-suspensions.ts <folder> [--count=<programs>] [--seed=<number>] [--cases=<cases in a program>] writes <folder>/<n>.ts
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

interface Birth {
  name: string;
  text: string;
  before?: string;
}

const births: Birth[] = [
  { name: "object", text: `{ a: seed, b: "t" + seed }` },
  { name: "nested-object", text: `{ inner: { n: seed, deeper: { m: seed + 1 } }, list: [seed, seed + 1] }` },
  { name: "copy-with-more", text: `{ ...{ a: seed, b: [seed] }, extra: seed + 0.5 }` },
  { name: "copy-in-a-holder", text: `{ tally: { ...{ tries: seed, last: "l" + seed }, tries: seed + 1 }, verdict: seed % 3 }` },
  { name: "object-of-doubles", text: `{ x: seed / 3, y: seed * 1.5, z: -0 }` },
  { name: "object-with-many-fields", text: `{ a: seed, b: seed + 1, c: "c" + seed, d: [seed], e: { f: seed }, g: seed / 7, h: null, i: undefined, j: true, k: seed + 2, l: "l", m: seed + 3 }` },
  { name: "object-with-a-computed-key", text: `{ ["k" + (seed % 4)]: seed, [seed % 5]: "index" }` },
  { name: "object-without-a-prototype", text: `Object.assign(Object.create(null), { a: seed })` },
  { name: "integers", text: `[seed, seed + 1, seed + 2]` },
  { name: "doubles", text: `[seed + 0.5, seed * 1.25, seed / 3]` },
  { name: "objects-in-an-array", text: `[{ n: seed }, { n: seed + 1 }, { n: seed + 2 }]` },
  { name: "mixed-array", text: `[seed, "s" + seed, seed / 3, null, { n: seed }, [seed]]` },
  { name: "array-with-a-hole", text: `[seed, , seed + 2]` },
  { name: "array-that-grew", text: `Array.from({ length: 5 + (seed % 40) }, (_, at) => ({ at, of: seed }))` },
  { name: "mapped-array", text: `[seed, seed + 1, seed + 2].map(each => "m" + each)` },
  { name: "empty-array", text: `[]` },
  { name: "joined-text", text: `"left" + seed + "right".repeat(1 + (seed % 3))` },
  { name: "slice-of-a-text", text: `("abcdefghijklmnopqrstuvwxyz" + seed).slice(seed % 5, 12 + (seed % 9))` },
  { name: "template", text: "`<${seed}|${seed / 4}|${\"x\".padStart(seed % 6, \"-\")}>`" },
  { name: "one-character", text: `String.fromCharCode(97 + (seed % 26))` },
  { name: "long-text", text: `("w" + seed).repeat(300)` },
  { name: "text-of-a-number", text: `String(seed * 1000003)` },
  { name: "integer", text: `(seed * 7) | 0` },
  { name: "large-integer", text: `seed * 4294967311` },
  { name: "double", text: `seed / 3` },
  { name: "not-a-number", text: `seed / 0 - seed / 0` },
  { name: "minus-zero", text: `-0 * seed` },
  { name: "bigint", text: `BigInt(seed) ** 5n + 12345678901234567890n` },
  { name: "small-bigint", text: `BigInt(seed)` },
  { name: "symbol", text: `Symbol("s" + seed)` },
  { name: "boolean", text: `seed % 2 === 0` },
  { name: "closure", text: `(captured => () => "closed over " + captured.n)({ n: seed })` },
  { name: "closure-over-the-seed", text: `() => seed + 1` },
  { name: "bound-function", text: `function (this: { n: number }, more: number) { return this.n + more; }.bind({ n: seed }, 2)` },
  { name: "instance", text: `new Point(seed, seed + 0.5)`, before: `class Point {\n  x: number;\n  y: number;\n  label: string;\n  constructor(x: number, y: number) {\n    this.x = x;\n    this.y = y;\n    this.label = "p" + x;\n  }\n}` },
  { name: "instance-of-a-subclass", text: `new Leaf(seed)`, before: `class Branch {\n  below: { n: number }[] = [];\n  constructor(public n: number) {\n    this.below.push({ n });\n  }\n}\nclass Leaf extends Branch {\n  tip = "tip" + this.n;\n}` },
  { name: "instance-with-a-private-field", text: `new Sealed(seed)`, before: `class Sealed {\n  #secret: { n: number };\n  constructor(n: number) {\n    this.#secret = { n };\n  }\n  toJSON() {\n    return "sealed " + this.#secret.n;\n  }\n}` },
  { name: "made-by-a-function", text: `new (Made as any)(seed)`, before: `function Made(this: any, n: number) {\n  this.n = n;\n  this.list = [n, n + 1];\n}` },
  { name: "map", text: `new Map([[seed, { n: seed }], [seed + 1, { n: seed + 1 }]])` },
  { name: "map-with-object-keys", text: `new Map([[{ key: seed }, "value" + seed]])` },
  { name: "set", text: `new Set(["a" + seed, "b" + seed])` },
  { name: "date", text: `new Date(seed * 86400000)` },
  { name: "regular-expression", text: `new RegExp("a{" + (seed % 4) + "}", "g")` },
  { name: "error", text: `new RangeError("wrong " + seed)` },
  { name: "error-with-a-cause", text: `new Error("outer " + seed, { cause: { n: seed } })` },
  { name: "bytes", text: `new Uint8Array([seed, seed + 1, seed + 2])` },
  { name: "floats", text: `new Float64Array([seed / 3, seed + 0.5])` },
  { name: "view-into-a-buffer", text: `new Uint16Array(new ArrayBuffer(16), 4, 2 + (seed % 3)).fill(seed)` },
  { name: "buffer", text: `Buffer.from("bytes" + seed)` },
  { name: "settled-promise", text: `Promise.resolve({ n: seed })` },
  { name: "iterator-of-an-array", text: `[seed, seed + 1, seed + 2].values()` },
  { name: "iterator-of-a-map", text: `new Map([[seed, "v" + seed]]).entries()` },
  { name: "started-generator", text: `counting(seed)`, before: `function counting(from: number) {\n  const made = (function* () {\n    const kept = { n: from };\n    while (true) yield kept.n++;\n  })();\n  made.next();\n  return made;\n}` },
  { name: "wrapped-text", text: `Object("wrapped" + seed)` },
  { name: "proxy", text: `new Proxy({ n: seed }, {})` },
  { name: "frozen-object", text: `Object.freeze({ n: seed, list: Object.freeze([seed]) })` },
  { name: "object-with-an-accessor", text: `{ base: seed, get twice() { return this.base * 2; } }` },
  { name: "object-or-null", text: `seed % 3 === 0 ? null : { n: seed }` },
  { name: "number-or-text", text: `seed % 2 === 0 ? seed / 3 : "text" + seed` },
  { name: "array-or-object", text: `seed % 2 === 0 ? [seed, seed + 1] : { n: seed }` },
  { name: "integer-or-undefined", text: `seed % 4 === 0 ? undefined : seed` },
  { name: "parsed", text: `JSON.parse('{"n":' + seed + ',"list":[' + seed + ',{"deep":"d' + seed + '"}]}')` },
  { name: "parts-of-a-text", text: `("a,b," + seed + ",c").split(",")` },
  { name: "match", text: `/(\\d+)-(?<word>\\w+)/.exec("x " + seed + "-word y")` },
  { name: "entries", text: `Object.entries({ a: seed, b: "b" + seed })` },
  { name: "ring", text: `ringOf(seed)`, before: `function ringOf(n: number) {\n  const first: { n: number; next: any } = { n, next: null };\n  const second = { n: n + 1, next: first };\n  first.next = second;\n  return first;\n}` },
];

interface Holder {
  name: string;
  body(parts: { V: string; W: string; S: (answer: string) => string; type: string; id: number }): string;
  beside?(parts: { V: string; type: string; id: number }): string;
  parameters?: (parts: { V: string; type: string }) => { declared: string; passed: string };
  isNoArrow?: boolean;
}

const holders: Holder[] = [
  { name: "constant", body: ({ V, S }) => `const held = ${V};\nconst answer = ${S("1")};\nreturn show(held) + answer;` },
  { name: "two-constants", body: ({ V, W, S }) => `const held = ${V};\nconst other = ${W};\nconst answer = ${S("1")};\nreturn show(held) + answer + show(other);` },
  { name: "variable-in-a-loop", body: ({ V, W, S, type }) => `let held: ${type} = ${V};\nlet text = "";\nfor (let turn = 0; turn < 3; turn++) {\n  const answer = ${S("turn")};\n  text += show(held) + answer;\n  held = ${W};\n}\nreturn text + show(held);` },
  { name: "parameter", parameters: ({ V, type }) => ({ declared: `held: ${type}`, passed: V }), body: ({ S }) => `const answer = ${S("1")};\nreturn show(held) + answer;` },
  { name: "rest-parameter", parameters: ({ V, type }) => ({ declared: `...all: ${type}[]`, passed: `${V}, ${V}` }), body: ({ S }) => `const answer = ${S("1")};\nreturn show(all) + answer;` },
  { name: "parameter-with-a-default", parameters: ({ V, type }) => ({ declared: `held: ${type} = ${V}`, passed: "" }), body: ({ S }) => `const answer = ${S("1")};\nreturn show(held) + answer;` },
  { name: "arguments-object", isNoArrow: true, parameters: ({ V, type }) => ({ declared: `_unused?: ${type}`, passed: V }), body: ({ S }) => `const answer = ${S("1")};\nreturn show(arguments[1]) + answer + arguments.length;` },
  { name: "taken-out-of-an-object", body: ({ V, W, S }) => `const { held, ...rest } = { held: ${V}, other: seed, more: ${W} };\nconst answer = ${S("1")};\nreturn show(held) + answer + show(rest);` },
  { name: "taken-out-of-an-array", body: ({ V, W, S }) => `const [first, , ...others] = [${V}, 0, ${W}, seed];\nconst answer = ${S("1")};\nreturn show(first) + answer + show(others);` },
  { name: "read-by-a-closure", body: ({ V, S }) => `const held = ${V};\nconst read = () => held;\nconst answer = ${S("1")};\nreturn show(read()) + answer;` },
  { name: "stored-by-a-closure", body: ({ V, W, S, type }) => `let held: ${type} = ${V};\nconst store = (next: ${type}) => {\n  held = next;\n};\nconst first = ${S("1")};\nconst before = show(held);\nstore(${W});\nconst second = ${S("2")};\nreturn before + first + show(held) + second;` },
  { name: "closures-of-a-loop", body: ({ V, S }) => `const readers: (() => string)[] = [];\nfor (let turn = 0; turn < 3; turn++) {\n  const held = ${V};\n  readers.push(() => show(held) + turn);\n  if (${S("turn")} !== turn) return "wrong answer";\n}\nreturn readers.map(read => read()).join();` },
  { name: "variable-of-a-walk", body: ({ V, W, S }) => `let text = "";\nfor (const held of [${V}, ${W}]) {\n  const answer = ${S("1")};\n  text += show(held) + answer;\n}\nreturn text;` },
  { name: "pairs-of-a-walk", body: ({ V, W, S }) => `let text = "";\nfor (const [at, held] of [${V}, ${W}].entries()) {\n  const answer = ${S("at")};\n  text += show(held) + answer;\n}\nreturn text;` },
  { name: "walk-over-a-map", body: ({ V, W, S }) => `let text = "";\nfor (const [key, held] of new Map([["first" + seed, ${V}], ["second", ${W}]])) {\n  const answer = ${S("1")};\n  text += key + show(held) + answer;\n}\nreturn text;` },
  { name: "walk-over-the-names", body: ({ V, W, S }) => `let text = "";\nconst holder: Record<string, unknown> = { first: ${V}, second: ${W} };\nfor (const name in holder) {\n  const answer = ${S("1")};\n  text += name + show(holder[name]) + answer;\n}\nreturn text;` },
  { name: "operands-of-a-call", body: ({ V, W, S }) => `return three(${V}, ${S("1")}, ${W});` },
  { name: "operands-of-two-calls", body: ({ V, W, S }) => `return three(${V}, ${S("1")}, three(${W}, ${S("2")}, ${V}));` },
  { name: "operands-of-a-construction", body: ({ V, W, S }) => `return show(new Three(${V}, ${S("1")}, ${W}));` },
  { name: "half-built-array", body: ({ V, W, S }) => `return show([${V}, ${S("1")}, ${W}]);` },
  { name: "half-built-object", body: ({ V, W, S }) => `return show({ first: ${V}, second: ${S("1")}, third: ${W} });` },
  { name: "half-built-nested-object", body: ({ V, W, S }) => `return show({ outer: { first: ${V}, second: ${S("1")} }, list: [${W}, ${S("2")}] });` },
  { name: "half-spread-array", body: ({ V, W, S }) => `return show([...[${V}], ${S("1")}, ...[${W}, seed]]);` },
  { name: "half-spread-call", body: ({ V, W, S }) => `return three(...([${V}, ${S("1")}, ${W}] as [unknown, number, unknown]));` },
  { name: "half-built-template", body: ({ V, W, S }) => "return `${show(" + V + ")}|${" + S("1") + "}|${show(" + W + ")}`;" },
  { name: "receiver-of-a-call", body: ({ V, S }) => `return boxed(${V}).with(${S("1")});` },
  { name: "left-of-a-sum", body: ({ V, S }) => `return show(${V}) + ${S("1")};` },
  { name: "left-of-an-assignment", body: ({ V, S }) => `let text = show(${V});\ntext += ${S("1")};\nreturn text;` },
  { name: "place-of-an-assignment", body: ({ V, S }) => `const holder = { field: show(${V}), list: [seed / 3, seed] };\nholder.field += ${S("1")};\nholder.list[seed % 2] += ${S("2")};\nreturn show(holder);` },
  { name: "number-left-of-an-assignment", body: ({ S }) => `let whole = seed | 0;\nlet part = seed / 3;\nlet huge = BigInt(seed) << 70n;\nwhole += ${S("1")};\npart *= ${S("2")};\nhuge += BigInt(${S("3")});\nreturn whole + " " + part + " " + huge;` },
  { name: "used-in-finally", body: ({ V, S }) => `const held = ${V};\nlet text = "";\ntry {\n  text += ${S("1")};\n} finally {\n  text += show(held);\n}\nreturn text;` },
  { name: "result-that-waits-for-finally", beside: ({ V, id }) => `function late${id}(seed: number) {\n  return show(${V});\n}`, body: ({ S, id }) => `try {\n  return late${id}(seed);\n} finally {\n  if (${S("1")} !== 1) trail.push("wrong answer");\n}` },
  { name: "caught", body: ({ V, S }) => `try {\n  throw ${V};\n} catch (caught) {\n  const answer = ${S("1")};\n  return show(caught) + answer;\n}` },
  { name: "thrown-through-finally", body: ({ V, S }) => `try {\n  try {\n    throw ${V};\n  } finally {\n    if (${S("1")} !== 1) trail.push("wrong answer");\n  }\n} catch (caught) {\n  return show(caught);\n}` },
  { name: "field-of-a-local-object", body: ({ V, S }) => `const box = { held: ${V}, n: seed };\nconst answer = ${S("1")};\nreturn show(box.held) + box.n + answer;` },
  { name: "element-of-a-local-array", body: ({ V, W, S }) => `const list = [${V}, ${W}];\nconst answer = ${S("1")};\nreturn show(list[answer]) + list.length;` },
  { name: "born-on-one-path", body: ({ V, S, type }) => `let held: ${type} | null = null;\nif (seed % 2) held = ${V};\nconst answer = ${S("1")};\nreturn (held === null ? "none" : show(held)) + answer;` },
  { name: "born-on-one-path-in-a-loop", body: ({ V, S, type }) => `let held: ${type} | null = null;\nlet text = "";\nfor (let turn = 0; turn < 4; turn++) {\n  if ((seed + turn) % 3 === 0) held = ${V};\n  const answer = ${S("turn")};\n  text += (held === null ? "none" : show(held)) + answer;\n}\nreturn text;` },
  { name: "one-of-two-kinds", body: ({ V, S, type }) => `const held: ${type} | number[] = seed % 2 ? ${V} : [seed, seed + 1];\nconst answer = ${S("1")};\nreturn show(held) + answer;` },
  { name: "subject-of-a-switch", body: ({ V, S }) => `const held = ${V};\nswitch (${S("seed % 3")}) {\n  case 0:\n    return "zero" + show(held);\n  case 1:\n    return "one" + show(held);\n  default:\n    return "more" + show(held);\n}` },
  { name: "behind-a-condition", body: ({ V, W, S }) => `const held = ${V};\nreturn ${S("seed % 2")} ? show(held) : show(${W}) + show(held);` },
  { name: "many-variables", body: ({ V, W, S }) => `const a = seed | 0, b = seed / 3, c = "c" + seed, d = ${V}, e = [seed], f = { n: seed }, g = seed % 2 === 0, h = ${W}, i = BigInt(seed), j = seed * 4294967311, k = c + c, l = null, m = b * 2, n = a + 1;\nconst answer = ${S("1")};\nreturn [a, b, c, show(d), show(e), show(f), g, show(h), i, j, k, l, m, n, answer].join();` },
  { name: "waits-many-times", body: ({ V, S }) => `const held = ${V};\nlet sum = 0;\nfor (let turn = 0; turn < 12; turn++) sum += ${S("turn")};\nreturn show(held) + sum;` },
  { name: "handed-to-a-function-that-waits", beside: ({ type, id }) => `async function inner${id}(held: ${type}, wait: () => Promise<number>) {\n  const answer = await wait();\n  return show(held) + answer;\n}`, body: ({ V, S, id }) => `const held = ${V};\nconst first = ${S("1")};\nreturn show(held) + first + show(startedOnly(inner${id}(held, () => Promise.resolve(2))));` },
];

interface Kind {
  name: string;
  isGenerator: boolean;
  isAsync: boolean;
  isArrow?: boolean;
  declare(parts: { id: number; parameters: string; body: string }): string;
}

const indented = (text: string, by = "  ") => text.split("\n").map(line => (line ? by + line : line)).join("\n"); // prettier-ignore

const kinds: Kind[] = [
  { name: "async-function", isGenerator: false, isAsync: true, declare: ({ id, parameters, body }) => `async function waits${id}(${parameters}): Promise<string> {\n${indented(body)}\n}` },
  { name: "async-arrow", isGenerator: false, isAsync: true, isArrow: true, declare: ({ id, parameters, body }) => `const waits${id} = async (${parameters}): Promise<string> => {\n${indented(body)}\n};` },
  { name: "async-method", isGenerator: false, isAsync: true, declare: ({ id, parameters, body }) => `const owner${id} = {\n  async waits(${parameters}): Promise<string> {\n${indented(body, "    ")}\n  },\n};\nconst waits${id} = (...all: Parameters<typeof owner${id}.waits>) => owner${id}.waits(...all);` },
  { name: "async-method-of-a-class", isGenerator: false, isAsync: true, declare: ({ id, parameters, body }) => `class Owner${id} {\n  kept = { n: ${id} };\n  async waits(${parameters}): Promise<string> {\n${indented(body, "    ")}\n  }\n}\nconst waits${id} = (...all: Parameters<Owner${id}["waits"]>) => new Owner${id}().waits(...all);` },
  { name: "generator", isGenerator: true, isAsync: false, declare: ({ id, parameters, body }) => `function* waits${id}(${parameters}): Generator<number, string, number> {\n${indented(body)}\n}` },
  { name: "generator-method", isGenerator: true, isAsync: false, declare: ({ id, parameters, body }) => `const owner${id} = {\n  *waits(${parameters}): Generator<number, string, number> {\n${indented(body, "    ")}\n  },\n};\nconst waits${id} = (...all: Parameters<typeof owner${id}.waits>) => owner${id}.waits(...all);` },
  { name: "async-generator", isGenerator: true, isAsync: true, declare: ({ id, parameters, body }) => `async function* waits${id}(${parameters}): AsyncGenerator<number, string, number> {\n${indented(body)}\n}` },
];

interface Suspension {
  name: string;
  for: "async" | "generator" | "async-generator";
  text(answer: string): string;
}

const suspensions: Suspension[] = [
  { name: "a-job", for: "async", text: answer => `(await afterAJob(${answer}))` },
  { name: "a-timer", for: "async", text: answer => `(await afterATimer(${answer}))` },
  { name: "an-immediate", for: "async", text: answer => `(await afterAnImmediate(${answer}))` },
  { name: "a-thenable", for: "async", text: answer => `(await thenable(${answer}))` },
  { name: "a-plain-value", for: "async", text: answer => `(queueMicrotask(meanwhile), await ${answer.includes(" ") ? `(${answer})` : answer})` },
  { name: "a-settled-promise", for: "async", text: answer => `(queueMicrotask(meanwhile), await Promise.resolve(${answer}))` },
  { name: "a-rejection", for: "async", text: answer => `(await afterAJob(${answer}, true).catch((reason: number) => reason))` },
  { name: "another-function-that-waits", for: "async", text: answer => `(await (async (value: number) => (await afterAJob(0)) + value)(${answer}))` },
  { name: "all-of-two", for: "async", text: answer => `(await Promise.all([afterAJob(${answer}), afterATimer(0)]))[0]` },
  { name: "a-yield", for: "generator", text: answer => `(yield ${answer})` },
  { name: "a-yield-of-another-generator", for: "generator", text: answer => `(yield* passing(${answer}))` },
  { name: "a-yield", for: "async-generator", text: answer => `(yield ${answer})` },
  { name: "a-job", for: "async-generator", text: answer => `(await afterAJob(${answer}))` },
  { name: "a-yield-and-a-job", for: "async-generator", text: answer => `((yield ${answer}) + (await afterAJob(0)))` },
];

const disturbances: { name: string; text: string }[] = [
  { name: "nothing", text: `` },
  { name: "a-collection", text: `Bun.gc(true);` },
  { name: "a-collection-and-new-objects", text: `Bun.gc(true);\nchurn(40);\nBun.gc(true);` },
  { name: "new-objects", text: `churn(150);` },
  { name: "a-deep-recursion", text: `deep(400, 1.5, "d");\nBun.gc(true);` },
  { name: "two-collections", text: `Bun.gc(true);\nBun.gc(true);` },
];

const heats = ["once", "again-and-again", "many-at-once"] as const;
const places = ["here", "in-a-function"] as const;

export interface Combination {
  birth: Birth;
  holder: Holder;
  kind: Kind;
  suspension: Suspension;
  disturbance: (typeof disturbances)[number];
  heat: (typeof heats)[number];
  place: (typeof places)[number];
}

export function pickCombination(pick: <T>(items: readonly T[]) => T): Combination {
  const holder = pick(holders);
  const kind = pick(kinds.filter(kind => !(holder.isNoArrow && kind.isArrow)));
  const wanted = kind.isGenerator ? (kind.isAsync ? "async-generator" : "generator") : "async";
  return { birth: pick(births), holder, kind, suspension: pick(suspensions.filter(each => each.for === wanted)), disturbance: pick(disturbances), heat: pick(heats), place: pick(places) };
}

export const nameOf = ({ birth, holder, kind, suspension, disturbance, heat, place }: Combination) => [birth.name, place, holder.name, kind.name, suspension.name, disturbance.name, heat].join("--");

const head = `declare const Bun: { gc(isFull: boolean): void };
declare const Buffer: { from(text: string): Uint8Array };
declare function setImmediate(run: () => void): void;
const trail: string[] = [];
let meanwhile: () => void = () => {};
function show(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.length > 40 ? JSON.stringify(value.slice(0, 20)) + ".." + value.length + ".." + JSON.stringify(value.slice(-8)) : JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "symbol") return "symbol " + value.description;
  if (typeof value === "function") return "function answering " + show(value(), depth + 1);
  if (depth > 4) return "..";
  if (Array.isArray(value)) {
    let text = "[";
    for (let at = 0; at < value.length; at++) text += (at ? "," : "") + (at in value ? show(value[at], depth + 1) : "hole");
    const match = value as unknown as { index?: number; groups?: unknown };
    return text + "]" + (match.index === undefined ? "" : "@" + match.index + show(match.groups, depth + 1));
  }
  if (value instanceof Map) return "map" + show([...value], depth + 1);
  if (value instanceof Set) return "set" + show([...value], depth + 1);
  if (value instanceof Date) return "date " + value.getTime();
  if (value instanceof RegExp) return "pattern " + value.source + " " + value.flags + " " + value.lastIndex;
  if (value instanceof Error) return value.name + ": " + value.message + (value.cause === undefined ? "" : " because " + show(value.cause, depth + 1));
  if (ArrayBuffer.isView(value)) return value.constructor.name + " " + value.byteOffset + " " + Array.prototype.join.call(value, ",");
  if (value instanceof Promise) return "promise";
  if (value instanceof String) return "wrapped " + value;
  const object = value as Record<string, unknown> & { next?: () => unknown; toJSON?: () => unknown };
  if (typeof object.toJSON === "function") return "json " + show(object.toJSON(), depth + 1);
  if (typeof object.next === "function") return "iterator at " + show(object.next(), depth + 1);
  let text = "{";
  for (const name of Object.keys(object)) text += (text.length > 1 ? "," : "") + name + ":" + show(object[name], depth + 1);
  return text + "}";
}
function churn(count: number) {
  const kept: unknown[] = [];
  for (let at = 0; at < count; at++) kept.push({ a: -at, b: "churn" + at }, [-at, -at - 1, -at - 2], [at + 0.25], "churn".slice(at % 3) + at, { n: -at }, { inner: { n: -at }, list: [-at] });
  return kept.length;
}
function deep(levels: number, part: number, text: string): number {
  const here = { levels, part, text };
  return levels === 0 ? 0 : 1 + deep(levels - 1, part * 1.01, text) + (here.levels - levels);
}
function afterAJob(answer: number, isRejected = false) {
  return new Promise<number>((resolve, reject) =>
    queueMicrotask(() => {
      meanwhile();
      (isRejected ? reject : resolve)(answer);
    }),
  );
}
function afterATimer(answer: number) {
  return new Promise<number>(resolve =>
    setTimeout(() => {
      meanwhile();
      resolve(answer);
    }, 0),
  );
}
function afterAnImmediate(answer: number) {
  return new Promise<number>(resolve =>
    setImmediate(() => {
      meanwhile();
      resolve(answer);
    }),
  );
}
function thenable(answer: number): PromiseLike<number> {
  return {
    then(resolve: any) {
      meanwhile();
      return resolve(answer);
    },
  };
}
function* passing(answer: number): Generator<number, number, number> {
  const kept = { answer };
  const sent = yield kept.answer;
  return sent + kept.answer - answer;
}
function three(first: unknown, second: number, third: unknown) {
  return show(first) + second + show(third);
}
class Three {
  constructor(
    public first: unknown,
    public second: number,
    public third: unknown,
  ) {}
}
function boxed(held: unknown) {
  return {
    held,
    with(answer: number) {
      return show(this.held) + answer;
    },
  };
}
function startedOnly(promise: Promise<string>) {
  promise.then(text => trail.push("inner " + text));
  return "started";
}
function drive(made: Generator<number, string, number>) {
  let step = made.next();
  while (!step.done) {
    meanwhile();
    step = made.next(step.value);
  }
  return step.value;
}
async function driveAsync(made: AsyncGenerator<number, string, number>) {
  let step = await made.next();
  while (!step.done) {
    meanwhile();
    step = await made.next(step.value);
  }
  return step.value;
}
function mixed(text: string, into: number) {
  for (let at = 0; at < text.length; at++) into = (Math.imul(into, 31) + text.charCodeAt(at)) | 0;
  return into;
}
`;

function caseOf(combination: Combination, id: number) {
  const { birth, holder, kind, suspension, disturbance, heat, place } = combination;
  const type = `Held${id}`;
  const V = place === "here" ? `(${birth.text})` : `born${id}(seed)`;
  const more = holder.parameters?.({ V, type });
  const body = holder.body({ V, W: `again${id}(seed + 1)`, S: suspension.text, type, id });
  const call = (seed: string) => `waits${id}(${[seed, more?.passed.replace(/\bseed\b/g, seed)].filter(Boolean).join(", ")})`;
  const run = (seed: string) => (kind.isGenerator ? (kind.isAsync ? `await driveAsync(${call(seed)})` : `drive(${call(seed)})`) : `await ${call(seed)}`);
  const started = (seed: string) => (kind.isGenerator ? (kind.isAsync ? `driveAsync(${call(seed)})` : `Promise.resolve().then(() => drive(${call(seed)}))`) : call(seed));
  const lines = [
    `// ${id}: ${nameOf(combination)}`,
    `function born${id}(seed: number) {\n  return ${birth.text};\n}`,
    `const again${id} = born${id};`,
    `type ${type} = ReturnType<typeof born${id}>;`,
    holder.beside?.({ V, type, id }) ?? "",
    kind.declare({ id, parameters: ["seed: number", more?.declared].filter(Boolean).join(", "), body }),
    `async function case${id}() {`,
    `  meanwhile = () => {${disturbance.text ? "\n" + indented(disturbance.text, "    ") + "\n  " : ""}};`,
    heat === "once"
      ? `  console.log("${id}", ${run(String(3 + id))});`
      : heat === "again-and-again"
        ? `  let sum = 0;\n  let last = "";\n  for (let seed = 1; seed <= 12; seed++) sum = mixed((last = ${run("seed")}), sum);\n  console.log("${id}", sum, last);`
        : `  const all: Promise<string>[] = [];\n  for (let seed = 1; seed <= 8; seed++) all.push(${started("seed")});\n  let sum = 0;\n  const texts = await Promise.all(all);\n  for (const text of texts) sum = mixed(text, sum);\n  console.log("${id}", sum, texts[texts.length - 1]);`,
    `}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function programOf(combinations: Combination[]) {
  const before = [...new Set(combinations.map(each => each.birth.before).filter(Boolean))].join("\n");
  return `${head}${before}\n${combinations.map((each, at) => caseOf(each, at + 1)).join("\n")}\n${combinations.map((_, at) => `await case${at + 1}();`).join("\n")}\nawait new Promise(resolve => setTimeout(resolve, 5));\nconsole.log(trail.sort().join("\\n"));\n`;
}

export interface Large {
  kind: Kind;
  disturbance: (typeof disturbances)[number];
  heat: (typeof heats)[number];
  parts: { birth: Birth; holder: Holder; suspension: Suspension; place: (typeof places)[number] }[];
}

export function pickLarge(pick: <T>(items: readonly T[]) => T, count: number): Large {
  const kind = pick(kinds);
  const ways = suspensions.filter(each => each.for === (kind.isGenerator ? (kind.isAsync ? "async-generator" : "generator") : "async"));
  const fitting = holders.filter(holder => !holder.parameters);
  return { kind, disturbance: pick(disturbances), heat: pick(heats), parts: Array.from({ length: count }, () => ({ birth: pick(births), holder: pick(fitting), suspension: pick(ways), place: pick(places) })) };
}

export const nameOfLarge = ({ kind, disturbance, heat, parts }: Large) => [`${parts.length}-in-one`, kind.name, disturbance.name, heat, ...parts.map(part => `${part.birth.name}.${part.holder.name}.${part.suspension.name}`)].join("--");

export function largeProgramOf(large: Large) {
  const { kind, disturbance, heat, parts } = large;
  const before = [...new Set(parts.map(each => each.birth.before).filter(Boolean))].join("\n");
  const beside: string[] = [];
  const blocks = parts.map(({ birth, holder, suspension, place }, at) => {
    const id = at + 2;
    const type = `Held${id}`;
    const V = place === "here" ? `(${birth.text})` : `born${id}(seed)`;
    beside.push(`function born${id}(seed: number) {\n  return ${birth.text};\n}\nconst again${id} = born${id};\ntype ${type} = ReturnType<typeof born${id}>;`, holder.beside?.({ V, type, id }) ?? "");
    const body = holder
      .body({ V: "BORN_HERE", W: `again${id}(seed + 1)`, S: suspension.text, type, id })
      .replace(/\breturn ([^\n]*);$/gm, `{\n  texts.push($1);\n  break part${id};\n}`)
      .replaceAll("BORN_HERE", () => V);
    return `part${id}: {\n${indented(body)}\n}`;
  });
  const whole = `const texts: string[] = [];\n${blocks.join("\n")}\nreturn texts.join("|");`;
  const one: Combination = { birth: parts[0].birth, holder: { name: "large", body: () => whole }, kind, suspension: parts[0].suspension, disturbance, heat, place: "in-a-function" };
  return `${head}${before}\n${beside.filter(Boolean).join("\n")}\n${caseOf(one, 1)}\nawait case1();\nawait new Promise(resolve => setTimeout(resolve, 5));\nconsole.log(trail.sort().join("\\n"));\n`;
}

export const tsconfig = JSON.stringify({ compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", noEmit: true, strict: true, types: [] } });

export function testPrograms() {
  const cases: Combination[] = [];
  for (let at = 0; at < births.length * 2; at++) {
    const holder = holders[at % holders.length];
    const fitting = kinds.filter(kind => !(holder.isNoArrow && kind.isArrow));
    const kind = fitting[(at * 3 + (at >> 3)) % fitting.length];
    const ways = suspensions.filter(each => each.for === (kind.isGenerator ? (kind.isAsync ? "async-generator" : "generator") : "async"));
    cases.push({ birth: births[(at * 5) % births.length], holder, kind, suspension: ways[(at >> 1) % ways.length], disturbance: disturbances[1 + (at % (disturbances.length - 1))], heat: heats[at % heats.length], place: places[(at >> 2) % places.length] });
  }
  const programs: { name: string; text: string }[] = [];
  for (let at = 0; at < cases.length; at += 4) programs.push({ name: cases.slice(at, at + 4).map(each => `${each.birth.name} as ${each.holder.name}`).join(", "), text: programOf(cases.slice(at, at + 4)) }); // prettier-ignore
  for (let at = 0; at < kinds.length; at++) {
    let turn = at * 7;
    const large = pickLarge(items => items[turn++ % items.length], 12 + at * 4);
    programs.push({ name: `${large.parts.length} values held in one ${large.kind.name}`, text: largeProgramOf({ ...large, kind: kinds[at], parts: large.kind === kinds[at] ? large.parts : pickLarge(items => (items === (kinds as readonly unknown[]) ? (kinds[at] as never) : items[turn++ % items.length]), 12 + at * 4).parts }) });
  }
  return programs;
}

if (import.meta.main) {
  const option = (name: string) => process.argv.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
  const folder = process.argv[2];
  mkdirSync(folder, { recursive: true });
  let state = Number(option("seed") ?? 1);
  const pick = <T>(items: readonly T[]) => items[(state = (Math.imul(state, 1103515245) + 12345) >>> 0) % items.length >>> 0 || 0];
  for (let at = 0; at < Number(option("count") ?? 20); at++) writeFileSync(join(folder, `${at}.ts`), programOf(Array.from({ length: Number(option("cases") ?? 4) }, () => pickCombination(pick)))); // prettier-ignore
}

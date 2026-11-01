// bun many-of-one-thing.ts <folder> [--count=<programs>] [--seed=<number>] writes <folder>/<n>.js
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const upTo = (count: number) => Array.from({ length: count }, (_, at) => at);
const list = (count: number, each: (at: number) => string, between = ", ") => upTo(count).map(each).join(between);

const valueOf = (at: number, seed = "s") => [`${seed} + ${at}`, `(${seed} + ${at}) / 4`, `"t${at}" + ${seed}`, `{ n: ${seed} + ${at} }`, `[${seed}, ${at}]`, `${seed} % 2 === ${at % 2}`, `BigInt(${seed} + ${at})`, `null`][at % 8];

/** The `at`-th order of the names. */
function orderOf(names: string[], at: number): string[] {
  const left = [...names];
  const order: string[] = [];
  for (let size = left.length; size > 0; at = Math.floor(at / size), size--) order.push(...left.splice(at % size, 1));
  return order;
}

interface Thing {
  name: string;
  largest: number;
  /** From this count on the program departs from plain Bun today. */
  failsTodayFrom?: number;
  /** Declares `run<id>(s)`, which answers with something that `show` prints. */
  text(count: number, id: number): string;
  isAsync?: boolean;
}

const things: Thing[] = [
  { name: "variables-across-a-call", largest: 4097, text: (n, id) => `function run${id}(s) {\n  ${list(n, at => `const v${at} = ${valueOf(at)};`, "\n  ")}\n  touch();\n  return [${list(n, at => `v${at}`)}];\n}` },
  { name: "numbers-across-a-call", largest: 4097, text: (n, id) => `function run${id}(s) {\n  ${list(n, at => `const v${at} = ${at % 2 ? `(s + ${at}) / 4` : `(s + ${at}) | 0`};`, "\n  ")}\n  touch();\n  return ${list(n, at => `v${at}`, " + ")};\n}` },
  { name: "variables-stored-again-in-a-loop", largest: 1025, text: (n, id) => `function run${id}(s) {\n  ${list(n, at => `let v${at} = s + ${at};`, "\n  ")}\n  for (let turn = 0; turn < 3; turn++) {\n    touch();\n    ${list(n, at => `v${at} += v${(at + 1) % n} & 3;`, "\n    ")}\n  }\n  return ${list(n, at => `v${at}`, " + ")};\n}` },
  { name: "parameters", largest: 2049, text: (n, id) => `function many${id}(${list(n, at => `p${at}`)}) {\n  touch();\n  return [arguments.length, ${list(n, at => `p${at}`, " + ")}];\n}\nfunction run${id}(s) {\n  return [many${id}(${list(n, at => `s + ${at}`)}), many${id}(s), many${id}(${list(n + 3, at => `s + ${at}`)})];\n}` },
  { name: "parameters-of-every-kind", largest: 513, text: (n, id) => `function many${id}(${list(n, at => `p${at}`)}) {\n  touch();\n  return [${list(n, at => `p${at}`)}];\n}\nfunction run${id}(s) {\n  return many${id}(${list(n, at => valueOf(at))});\n}` },
  { name: "parameters-with-defaults", largest: 513, text: (n, id) => `function many${id}(p0, ${list(n - 1, at => `p${at + 1} = p${at} + 1`)}) {\n  return p${n - 1};\n}\nfunction run${id}(s) {\n  return [many${id}(s), many${id}(s, 100)];\n}` },
  { name: "a-spread-call", largest: 65537, text: (n, id) => `function taking${id}(...all) {\n  return all.length + all[all.length - 1];\n}\nfunction run${id}(s) {\n  const given = Array.from({ length: ${n} }, (_, at) => s + at);\n  try {\n    return [taking${id}(...given), Math.max(...given), taking${id}.apply(null, given)];\n  } catch (error) {\n    return error instanceof RangeError ? "fine" : String(error);\n  }\n}` },
  { name: "arguments-of-built-ins", largest: 2049, text: (n, id) => `function run${id}(s) {\n  const grown = [];\n  grown.push(${list(n, at => `s + ${at}`)});\n  return [Math.max(${list(n, at => `s + ${at}`)}), String.fromCharCode(${list(n, at => `65 + ((s + ${at}) % 26)`)}).length, grown.length, [].concat(${list(n, at => (at % 2 ? `[s, ${at}]` : `${at}`))}).length, new Array(${list(n, at => `${at}`)}).length];\n}` },
  { name: "members-of-a-literal", largest: 4097, text: (n, id) => `function run${id}(s) {\n  const made = { ${list(n, at => `m${at}: ${valueOf(at)}`)} };\n  touch();\n  return [Object.keys(made).length, made.m0, made.m${n - 1}, made.m${n >> 1}, made];\n}` },
  { name: "orders-of-the-same-members", largest: 4097, failsTodayFrom: 4097, text: (n, id) => `function run${id}(s) {\n  const made = [\n    ${list(n, at => `{ ${orderOf(["a", "b", "c", "d", "e", "f", "g"], at).map((name, place) => `${name}: s + ${at + place}`).join(", ")} }`, ",\n    ")},\n  ];\n  let sum = 0;\n  for (const each of made) sum += each.a * 2 + each.g + Object.keys(each)[3].charCodeAt(0);\n  return [made.length, sum, Object.keys(made[${n - 1}]).join(""), made[${n >> 1}]];\n}` },
  { name: "elements-of-a-literal", largest: 16385, text: (n, id) => `function run${id}(s) {\n  const whole = [${list(n, at => `s + ${at}`)}];\n  const parts = [${list(n, at => `(s + ${at}) / 4`)}];\n  const mixed = [${list(Math.min(n, 2049), at => (at % 9 === 8 ? "" : valueOf(at)))}];\n  touch();\n  return [whole.length, whole[${n - 1}], parts[${n - 1}], mixed.length, mixed[${Math.min(n, 2049) - 1}], whole.reduce((sum, each) => sum + each, 0)];\n}` },
  { name: "constant-elements", largest: 65537, text: (n, id) => `function run${id}(s) {\n  const table = [${list(n, at => `${(at * 7919) % 65521}`)}];\n  return [table.length, table[s % ${n}], table[${n - 1}]];\n}` },
  { name: "entries-of-a-map", largest: 4097, text: (n, id) => `function run${id}(s) {\n  const map = new Map([${list(n, at => `["k${at}", ${at}]`)}]);\n  const set = new Set([${list(n, at => `${at % 2 ? `"e${at}"` : at}`)}]);\n  return [map.size, map.get("k" + (s % ${n})), set.size, set.has(${n - (n % 2 ? 1 : 2)})];\n}` },
  { name: "fields-of-a-class", largest: 2049, text: (n, id) => `class Wide${id} {\n  ${list(n, at => `f${at} = ${valueOf(at, "base")};`, "\n  ")}\n}\nfunction run${id}(s) {\n  base = s;\n  const made = new Wide${id}();\n  touch();\n  return [made.f0, made.f${n - 1}, made.f${n >> 1}, Object.keys(made).length];\n}` },
  { name: "fields-stored-by-a-constructor", largest: 2049, text: (n, id) => `class Wide${id} {\n  constructor(s) {\n    ${list(n, at => `this.f${at} = ${at % 2 ? `(s + ${at}) / 4` : `s + ${at}`};`, "\n    ")}\n  }\n  sum() {\n    return ${list(n, at => `this.f${at}`, " + ")};\n  }\n}\nfunction run${id}(s) {\n  let sum = 0;\n  for (let turn = 0; turn < 20; turn++) sum += new Wide${id}(s + turn).sum();\n  return sum;\n}` },
  { name: "methods-of-a-class", largest: 2049, text: (n, id) => `class Wide${id} {\n  ${list(n, at => `m${at}(s) {\n    return s + ${at};\n  }`, "\n  ")}\n}\nfunction run${id}(s) {\n  const made = new Wide${id}();\n  return [made.m0(s), made.m${n - 1}(s), made["m" + (s % ${n})](s)];\n}` },
  { name: "classes-at-one-call", largest: 513, text: (n, id) => `${list(n, at => `class Kind${id}_${at} {\n  constructor(s) {\n    this.${at % 3 ? "a" : "b"} = s;\n    this.own${at % 5} = ${at};\n  }\n  area() {\n    return this.own${at % 5} + ${at};\n  }\n}`, "\n")}\nconst kinds${id} = [${list(n, at => `Kind${id}_${at}`)}];\nfunction run${id}(s) {\n  let sum = 0;\n  for (let at = 0; at < ${n * 3}; at++) sum += new kinds${id}[(s + at) % ${n}](at).area();\n  return sum;\n}` },
  { name: "a-chain-of-parents", largest: 257, text: (n, id) => `class Level${id}_0 {\n  f0 = 0;\n  up() {\n    return 0;\n  }\n}\n${list(n - 1, at => `class Level${id}_${at + 1} extends Level${id}_${at} {\n  f${at + 1} = ${at + 1};\n  up() {\n    return super.up() + 1;\n  }\n}`, "\n")}\nfunction run${id}(s) {\n  const made = new Level${id}_${n - 1}();\n  return [made.up(), made.f0, made.f${n - 1}, Object.keys(made).length + s];\n}` },
  { name: "cases-of-a-switch", largest: 4097, text: (n, id) => `function pick${id}(s) {\n  switch (s) {\n    ${list(n, at => `case ${at}:\n      return ${(at * 31) % 1009};`, "\n    ")}\n    default:\n      return -1;\n  }\n}\nfunction run${id}(s) {\n  let sum = 0;\n  for (let at = -2; at < ${n + 2}; at++) sum += pick${id}(at);\n  return [sum, pick${id}(s), pick${id}("0"), pick${id}(0.5)];\n}` },
  { name: "scattered-cases", largest: 2049, text: (n, id) => `function pick${id}(s) {\n  switch (s) {\n    ${list(n, at => `case ${(at * 2654435761) % 4294967296 | 0}:\n      return ${at};`, "\n    ")}\n    default:\n      return -1;\n  }\n}\nfunction run${id}(s) {\n  return [pick${id}(0), pick${id}(${(((n - 1) * 2654435761) % 4294967296) | 0}), pick${id}(s)];\n}` },
  { name: "text-cases", largest: 2049, text: (n, id) => `function pick${id}(s) {\n  switch (s) {\n    ${list(n, at => `case "c${at}":\n      return ${at};`, "\n    ")}\n    default:\n      return -1;\n  }\n}\nfunction run${id}(s) {\n  return [pick${id}("c0"), pick${id}("c" + ${n - 1}), pick${id}("c" + (s % ${n})), pick${id}(s)];\n}` },
  { name: "cases-that-fall-through", largest: 1025, text: (n, id) => `function pick${id}(s) {\n  let sum = 0;\n  switch (s) {\n    ${list(n, at => `case ${at}:\n      sum += ${at};${at % 7 === 6 ? "\n      break;" : ""}`, "\n    ")}\n  }\n  return sum;\n}\nfunction run${id}(s) {\n  let sum = 0;\n  for (let at = 0; at < ${n}; at++) sum += pick${id}(at);\n  return sum + s;\n}` },
  { name: "else-ifs", largest: 1025, text: (n, id) => `function pick${id}(s) {\n  ${list(n, at => `if (s === ${at}) return ${(at * 17) % 257};`, "\n  else ")}\n  return -1;\n}\nfunction run${id}(s) {\n  return [pick${id}(0), pick${id}(${n - 1}), pick${id}(${n}), pick${id}(s)];\n}` },
  { name: "statements-in-a-loop", largest: 16385, text: (n, id) => `function run${id}(s) {\n  let t = s;\n  for (let turn = 0; turn < 3; turn++) {\n    if (t === -1) break;\n    ${list(n, at => `t = (Math.imul(t, 31) + ${at}) | 0;`, "\n    ")}\n    if (t === -2) continue;\n  }\n  return t;\n}` },
  { name: "calls-in-a-row", largest: 4097, text: (n, id) => `function step${id}(t, k) {\n  return (Math.imul(t, 31) + k) | 0;\n}\nfunction run${id}(s) {\n  let t = s;\n  ${list(n, at => `t = step${id}(t, ${at});`, "\n  ")}\n  return t;\n}` },
  { name: "terms-of-a-sum", largest: 4097, text: (n, id) => `function run${id}(s) {\n  return [${list(n, at => `s + ${at}`, " + ")}, ${list(n, at => `"p${at % 10}"`, " + ")} + s, ${list(n, at => `(s ^ ${at})`, " | ")}];\n}` },
  { name: "nested-parentheses", largest: 513, text: (n, id) => `function run${id}(s) {\n  return ${"(".repeat(n)}s${list(n, at => ` + ${at})`, "")};\n}` },
  { name: "nested-conditions", largest: 513, text: (n, id) => `function pick${id}(s) {\n  return ${list(n, at => `s === ${at} ? ${at * 3}`, " : ")} : -1;\n}\nfunction run${id}(s) {\n  return [pick${id}(0), pick${id}(${n - 1}), pick${id}(${n}), pick${id}(s)];\n}` },
  { name: "nested-calls", largest: 513, text: (n, id) => `function one${id}(value) {\n  return value + 1;\n}\nfunction run${id}(s) {\n  return ${`one${id}(`.repeat(n)}s${")".repeat(n)};\n}` },
  { name: "ands-and-ors", largest: 2049, text: (n, id) => `function run${id}(s) {\n  return [${list(n, at => `s + ${at + 1}`, " && ")}, ${list(n, at => `(s === ${-at - 1})`, " || ")}, ${list(n, at => (at === n - 1 ? "s" : "null"), " ?? ")}];\n}` },
  { name: "parts-of-a-template", largest: 2049, text: (n, id) => `function run${id}(s) {\n  const text = \`${list(n, at => `\${${at % 3 === 0 ? `s + ${at}` : at % 3 === 1 ? `"x${at}"` : `(s + ${at}) / 4`}}`, "|")}\`;\n  return [text.length, text.slice(-12)];\n}` },
  { name: "optional-links", largest: 1025, text: (n, id) => `function run${id}(s) {\n  const ring = { n: s, next: null, none: undefined };\n  ring.next = ring;\n  return [ring${"?.next".repeat(n)}?.n, ring${".next".repeat(n)}.n, ring${"?.next".repeat(n >> 1)}?.none${"?.next".repeat(n >> 1)}];\n}` },
  { name: "nested-blocks", largest: 257, text: (n, id) => `function run${id}(s) {\n  let t = s;\n  ${list(n, at => `{ const b${at} = t + ${at}; t = b${at} & 1023;`, " ")} ${"}".repeat(n)}\n  return t;\n}` },
  { name: "nested-loops", largest: 65, text: (n, id) => `function run${id}(s) {\n  let t = s;\n  ${list(n, at => `for (let i${at} = 0; i${at} < 1; i${at}++) {`, " ")} t += ${n}; ${"}".repeat(n)}\n  return t;\n}` },
  { name: "nested-handlers", largest: 257, text: (n, id) => `function run${id}(s) {\n  let t = s;\n  ${list(n, at => `try {`, " ")} throw new Error("inner"); ${list(n, at => (at === n - 1 ? `} catch (error) { t += 1; }` : at % 2 ? `} finally { t += ${at}; }` : `} catch (error) { t += 1; throw error; }`), " ")}\n  return t;\n}` },
  { name: "handlers-in-a-row", largest: 1025, text: (n, id) => `function run${id}(s) {\n  let t = s;\n  ${list(n, at => `try {\n    if ((s + ${at}) % 3 === 0) fail();\n    t += 1;\n  } catch (error) {\n    t += 2;\n  }`, "\n  ")}\n  return t;\n}` },
  { name: "labels", largest: 257, text: (n, id) => `function run${id}(s) {\n  let t = s;\n  ${list(n, at => `l${at}: {`, " ")} if (s >= 0) break l${n >> 1}; t += 1000; ${list(n, at => `t += ${n - 1 - at < n >> 1 ? 1 : 0}; }`, " ")}\n  return t;\n}` },
  { name: "nested-functions", largest: 257, text: (n, id) => `function run${id}(s) {\n  ${list(n, at => `const c${at} = s + ${at}; return (function () {`, " ")} return ${list(n, at => `c${at}`, " + ")}; ${"})();".repeat(n)}\n}` },
  { name: "closures-over-one-variable-each", largest: 2049, text: (n, id) => `function run${id}(s) {\n  ${list(n, at => `let v${at} = s + ${at};`, "\n  ")}\n  const all = [${list(n, at => `() => v${at}++`)}];\n  let sum = 0;\n  for (const each of all) sum += each() + each();\n  return [sum, v0, v${n - 1}];\n}` },
  { name: "one-closure-over-many-variables", largest: 2049, text: (n, id) => `function run${id}(s) {\n  ${list(n, at => `let v${at} = ${valueOf(at)};`, "\n  ")}\n  const read = () => [${list(n, at => `v${at}`)}];\n  v0 = "stored";\n  touch();\n  return read();\n}` },
  { name: "names-of-an-object-pattern", largest: 1025, text: (n, id) => `function run${id}(s) {\n  const { ${list(n, at => `m${at}${at % 4 === 3 ? ` = ${at}` : ""}`)}, ...rest } = { ${list(n, at => (at % 4 === 3 ? `x${at}: 0` : `m${at}: s + ${at}`))} };\n  return [${list(n, at => `m${at}`, " + ")}, Object.keys(rest).length];\n}` },
  { name: "places-of-an-array-pattern", largest: 1025, text: (n, id) => `function run${id}(s) {\n  const [${list(n, at => (at % 5 === 4 ? "" : `e${at}${at % 5 === 3 ? ` = ${at}` : ""}`))}, ...rest] = Array.from({ length: ${n + 2} }, (_, at) => (at % 5 === 3 ? undefined : s + at));\n  return [${list(n, at => (at % 5 === 4 ? "0" : `e${at}`), " + ")}, rest.length];\n}` },
  { name: "functions-that-call-the-next", largest: 2049, text: (n, id) => `${list(n, at => `function hop${id}_${at}(s) {\n  return ${at === n - 1 ? "s" : `hop${id}_${at + 1}(s + 1)`};\n}`, "\n")}\nfunction run${id}(s) {\n  return hop${id}_0(s);\n}` },
  { name: "constants-of-every-kind", largest: 2049, text: (n, id) => `function run${id}(s) {\n  const all = [${list(n, at => [`${at}.${at + 1}`, `"text ${at}"`, `${at}${at}${at}n`, `/a{${at % 50}}b${at}/`, `${at * 4294967311}`, `-${at}.5e${at % 300}`][at % 6])}];\n  return [all.length, all[s % ${n}], all[${n - 1}], all[${n >> 1}]];\n}` },
  { name: "a-long-text", largest: 1048577, text: (n, id) => `function run${id}(s) {\n  const text = "${"abcdefghij".repeat(Math.ceil(n / 10)).slice(0, n)}";\n  return [text.length, text[s % ${n}], text.slice(-3), (text + s).length];\n}` },
  { name: "a-long-name", largest: 65537, text: (n, id) => `function run${id}(s) {\n  const made = { ${"n".repeat(n)}: s, ${"n".repeat(n)}m: s + 1 };\n  return [made.${"n".repeat(n)}, made.${"n".repeat(n)}m, Object.keys(made)[1].length];\n}` },
  { name: "nested-literals", largest: 513, text: (n, id) => `function run${id}(s) {\n  const deep = ${"[".repeat(n)}s${"]".repeat(n)};\n  const held = ${"{ in: ".repeat(n)}s${" }".repeat(n)};\n  let levels = 0;\n  for (let at = deep; Array.isArray(at); at = at[0]) levels++;\n  for (let at = held; typeof at === "object"; at = at.in) levels++;\n  return levels;\n}` },
  { name: "variables-across-a-yield", largest: 2049, text: (n, id) => `function* waits${id}(s) {\n  ${list(n, at => `const v${at} = ${valueOf(at)};`, "\n  ")}\n  const sent = yield 1;\n  return [sent, ${list(n, at => `v${at}`)}];\n}\nfunction run${id}(s) {\n  const made = waits${id}(s);\n  made.next();\n  Bun.gc(true);\n  touch();\n  return made.next("sent").value;\n}` },
  { name: "variables-across-an-await", largest: 2049, isAsync: true, text: (n, id) => `async function run${id}(s) {\n  ${list(n, at => `const v${at} = ${valueOf(at)};`, "\n  ")}\n  await new Promise(resolve => setTimeout(resolve, 0));\n  Bun.gc(true);\n  return [${list(n, at => `v${at}`)}];\n}` },
  { name: "yields", largest: 2049, text: (n, id) => `function* steps${id}(s) {\n  let t = s;\n  ${list(n, at => `t += yield t + ${at};`, "\n  ")}\n  return t;\n}\nfunction run${id}(s) {\n  const made = steps${id}(s);\n  let step = made.next();\n  let count = 0;\n  while (!step.done) {\n    count++;\n    step = made.next(count & 3);\n  }\n  return [count, step.value];\n}` },
  { name: "awaits", largest: 1025, isAsync: true, text: (n, id) => `async function run${id}(s) {\n  let t = s;\n  ${list(n, at => `t += await ${at % 3 ? at : `Promise.resolve(${at})`};`, "\n  ")}\n  return t;\n}` },
  { name: "modules-worth-of-functions", largest: 4097, text: (n, id) => `${list(n, at => `function small${id}_${at}(s) {\n  return s ${["+", "-", "^", "|"][at % 4]} ${at};\n}`, "\n")}\nconst table${id} = [${list(n, at => `small${id}_${at}`)}];\nfunction run${id}(s) {\n  let t = s;\n  for (const each of table${id}) t = each(t) & 65535;\n  return t;\n}` },
];

const counts = [2, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255, 256, 257, 511, 512, 513, 1023, 1024, 1025, 2047, 2048, 2049, 4095, 4096, 4097, 8191, 8192, 8193, 16383, 16384, 16385, 32767, 32768, 32769, 65535, 65536, 65537, 1048575, 1048576, 1048577];

export interface Combination {
  thing: Thing;
  count: number;
}

export function pickCombination(pick: <T>(items: readonly T[]) => T): Combination {
  const thing = pick(things);
  return { thing, count: pick(counts.filter(count => count <= thing.largest && count < (thing.failsTodayFrom ?? Infinity))) };
}

export const nameOf = ({ thing, count }: Combination) => `${count}-${thing.name}`;

const head = `let base = 0;
let touched = 0;
function touch() {
  touched++;
}
function fail() {
  throw new Error("failed");
}
function mixed(text, into) {
  for (let at = 0; at < text.length; at++) into = (Math.imul(into, 31) + text.charCodeAt(at)) | 0;
  return into;
}
function show(value, depth = 0) {
  if (typeof value === "string") return JSON.stringify(value.length > 60 ? value.slice(0, 30) + ".." + value.length : value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (value === null || typeof value !== "object") return String(value);
  if (value instanceof RegExp) return String(value);
  if (depth > 3) return "..";
  const parts = Array.isArray(value) ? Array.from(value, each => show(each, depth + 1)) : Object.keys(value).map(name => name + ":" + show(value[name], depth + 1));
  const text = parts.join();
  return (Array.isArray(value) ? "[" : "{") + (text.length > 200 ? text.slice(0, 80) + ".." + parts.length + ".." + mixed(text, 0) + ".." + text.slice(-40) : text) + (Array.isArray(value) ? "]" : "}");
}
`;

export function programOf(combinations: Combination[]) {
  return `${head}${combinations.map(({ thing, count }, at) => `// ${at + 1}: ${count} ${thing.name}\n${thing.text(count, at + 1)}\nfor (const s of [3, 4, 1000003]) console.log("${at + 1}", show(${thing.isAsync ? "await " : ""}run${at + 1}(s)));`).join("\n")}\nconsole.log(touched);\n`;
}

export function testPrograms() {
  return things.map((thing, at) => {
    const fitting = counts.filter(count => count <= Math.min(thing.largest, 1025));
    const combination = { thing, count: fitting[fitting.length - 1 - (at % 3)] };
    return { name: nameOf(combination), text: programOf([combination]), failsToday: undefined as string | undefined };
  }).concat(
    things
      .filter(thing => thing.failsTodayFrom !== undefined)
      .flatMap(thing => [
        { name: nameOf({ thing, count: thing.failsTodayFrom! - 1 }), text: programOf([{ thing, count: thing.failsTodayFrom! - 1 }]), failsToday: undefined },
        { name: nameOf({ thing, count: thing.failsTodayFrom! }), text: programOf([{ thing, count: thing.failsTodayFrom! }]), failsToday: "the build refuses it" },
      ]),
  );
}

if (import.meta.main) {
  const option = (name: string) => process.argv.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
  const folder = process.argv[2];
  mkdirSync(folder, { recursive: true });
  let state = Number(option("seed") ?? 1);
  const pick = <T>(items: readonly T[]) => items[((state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 8) % items.length];
  for (let at = 0; at < Number(option("count") ?? 20); at++) writeFileSync(join(folder, `${at}.js`), programOf([pickCombination(pick)]));
}

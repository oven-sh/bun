// bun many-of-one-thing.ts <folder> [--count=<programs>] [--seed=<number>] writes <folder>/<n>.js
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const upTo = (count: number) => Array.from({ length: count }, (_, at) => at);
const list = (count: number, each: (at: number) => string, between = ", ") => upTo(count).map(each).join(between);

const valueOf = (at: number, seed = "s") => [`${seed} + ${at}`, `(${seed} + ${at}) / 4`, `"t${at}" + ${seed}`, `{ n: ${seed} + ${at} }`, `[${seed}, ${at}]`, `${seed} % 2 === ${at % 2}`, `BigInt(${seed} + ${at})`, `null`][at % 8];

/** The `at`-th permutation of the names. */
function orderOf(names: string[], at: number): string[] {
  const left = [...names];
  const order: string[] = [];
  for (let size = left.length; size > 0; at = Math.floor(at / size), size--) order.push(...left.splice(at % size, 1));
  return order;
}

interface Thing {
  name: string;
  largest: number;
  /** From this count on the program differs from plain Bun today. */
  failsTodayFrom?: number;
  /** Declares `run<id>(s)`, which returns something that `show` prints. */
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
  { name: "values-inserted-by-splice", largest: 257, text: (n, id) => `function run${id}(s) {\n  const grown = [s, s + 1];\n  const taken = grown.splice(1, 0, ${list(n, at => `s + ${at}`)});\n  return [grown.length, grown[1], grown[${n}], grown[${n + 1}], taken.length];\n}` },
  { name: "lists-joined-by-concat", largest: 257, text: (n, id) => `function run${id}(s) {\n  const joined = [s].concat(${list(n, at => (at % 3 === 2 ? `s + ${at}` : `[s + ${at}]`))});\n  const text = "".concat(${list(n, at => (at % 2 ? `"p${at % 10}"` : `s + ${at}`))});\n  return [joined.length, joined[${n}], text.length, text.slice(-6)];\n}` },
  { name: "parts-of-a-key", largest: 257, text: (n, id) => `const table${id} = { ${"k".repeat(n)}: "found", k: "short" };\nfunction look${id}(${list(n, at => `p${at}`)}) {\n  return table${id}[${list(n, at => `p${at}`, " + ")}];\n}\nfunction run${id}(s) {\n  return [look${id}(${list(n, () => `"k"`)}), look${id}(${list(n, at => (at ? `""` : `"k"`))}), look${id}(${list(n, () => `s`)})];\n}` },
  { name: "elements-searched", largest: 1025, text: (n, id) => `function run${id}(s) {\n  return [[${list(n, at => `${at * 3}`)}].includes(s), [${list(n, at => `${at * 3}`)}].indexOf(${(n - 1) * 3}), [${list(n, at => `"w${at}"`)}].includes("w" + (s % ${n + 1})), [${list(n, at => `${at}.5`)}].lastIndexOf(s + 0.5)];\n}` },
  { name: "bytes-copied-between-views", largest: 65537, text: (n, id) => `function run${id}(s) {\n  const from = new Uint8Array(${n}).fill(s & 255);\n  from[${n - 1}] = 7;\n  const into = new Uint8Array(${n});\n  into.set(from);\n  const cut = from.slice(0, ${n});\n  const part = from.subarray(0, ${n});\n  into.copyWithin(0, 1, ${n});\n  return [into[0], into[${n - 1}], into[${Math.max(n - 2, 0)}], cut[${n - 1}], part.length, new Float64Array(${n}).fill(s / 4)[${n - 1}]];\n}` },
  { name: "turns-of-a-short-loop", largest: 1025, text: (n, id) => `function run${id}(s) {\n  const all = [${list(n, at => `s + ${at}`)}];\n  let sum = 0;\n  for (let i = 0; i < ${n}; i++) sum += all[i];\n  for (let i = ${n - 1}; i >= 0; i--) sum ^= all[i];\n  return sum;\n}` },
  { name: "short-loops-in-a-row", largest: 257, text: (n, id) => `function run${id}(s) {\n  const all = [s, s + 1, s + 2, s + 3];\n  let sum = 0;\n  ${list(n, at => `for (let i = 0; i < ${2 + (at % 3)}; i++) sum += all[i] * ${at};`, "\n  ")}\n  return sum;\n}` },
  { name: "lists-indexed-in-one-loop", largest: 257, text: (n, id) => `function sum${id}(${list(n, at => `l${at}`)}) {\n  let sum = 0;\n  for (let i = 0; i < l0.length; i++) sum += ${list(n, at => `l${at}[i]`, " + ")};\n  return sum;\n}\nfunction run${id}(s) {\n  return [sum${id}(${list(n, at => `[s, ${at}, 2]`)}), sum${id}(${list(n, at => (at === n - 1 ? `[s]` : `[s, ${at}]`))})];\n}` },
  { name: "functions-that-forward-all-they-get", largest: 513, text: (n, id) => `${list(n, at => `function pass${id}_${at}(...all) {\n  return ${at === n - 1 ? "all.length + all[0] + all[1]" : `pass${id}_${at + 1}(...all)`};\n}`, "\n")}\n${list(n, at => `function hand${id}_${at}(a, b) {\n  return ${at === n - 1 ? "a - b" : `hand${id}_${at + 1}(a, b)`};\n}`, "\n")}\nfunction run${id}(s) {\n  return [pass${id}_0(s, 2, 3), hand${id}_0(s, 1), hand${id}_0(s / 4, 1)];\n}` },
  { name: "variables-joined-after-a-condition", largest: 1025, text: (n, id) => `function run${id}(s) {\n  ${list(n, at => `let v${at};`, " ")}\n  if (s & 1) {\n    ${list(n, at => `v${at} = s + ${at};`, " ")}\n  } else {\n    ${list(n, at => `v${at} = ${at % 4 === 3 ? `(s - ${at}) / 4` : `s - ${at}`};`, " ")}\n  }\n  return ${list(n, at => `v${at}`, " + ")};\n}` },
  { name: "strings-built-side-by-side", largest: 257, text: (n, id) => `function run${id}(s) {\n  ${list(n, at => `let t${at} = "";`, " ")}\n  for (let i = 0; i < 6; i++) {\n    ${list(n, at => `t${at} += ${at % 2 ? `"x" + i` : `i + s`};`, " ")}\n  }\n  return [t0, t${n - 1}, ${list(n, at => `t${at}.length`, " + ")}];\n}` },
  { name: "appends-to-one-string", largest: 4097, text: (n, id) => `function run${id}(s) {\n  let text = "";\n  ${list(n, at => (at % 5 === 4 ? `if (s & 1) text += "odd";` : `text += ${at % 2 ? `"p${at % 10}"` : `s + ${at}`};`), "\n  ")}\n  return [text.length, text.slice(0, 8), text.slice(-8)];\n}` },
  { name: "members-of-parsed-text", largest: 1025, text: (n, id) => `function run${id}(s) {\n  const text = '{${list(n, at => `"m${at}":${at % 3 ? at : `"t${at}"`}`, ",")}}';\n  const one = JSON.parse(text);\n  const many = JSON.parse("[" + text + "," + text + "]");\n  return [Object.keys(one).length, one.m0, one.m${n - 1}, many[1].m${n >> 1}, JSON.stringify(one).length + s];\n}` },
  { name: "texts-parsed-in-one-function", largest: 65, text: (n, id) => `function run${id}(s) {\n  return [${list(n, at => `JSON.parse('{"a${at}":' + s + ',"b":[${at}]}').a${at}`)}];\n}` },
  { name: "fields-walked-by-name", largest: 1025, text: (n, id) => `function run${id}(s) {\n  const made = { ${list(n, at => `m${at}: s + ${at}`)} };\n  let names = 0;\n  let sum = 0;\n  for (const name in made) {\n    names += name.length;\n    sum += made[name];\n  }\n  for (const [name, value] of Object.entries(made)) sum -= value + name.length;\n  return [names, sum, Object.values(made).length, { ...made, m0: 1 }.m${n - 1}];\n}` },
  { name: "pushes-onto-a-fresh-list", largest: 4097, text: (n, id) => `function run${id}(s) {\n  const one = [];\n  for (let i = 0; i < ${n}; i++) one.push(s + i);\n  const two = [];\n  for (let i = 0; i < ${n}; i++) two[i] = (s + i) / 4;\n  const three = new Array(${n}).fill(s);\n  three.length = ${n >> 1};\n  one.length = 0;\n  return [one.length, two[${n - 1}], three.length, new Array(${n}).length];\n}` },
  { name: "top-level-variables", largest: 8193, text: (n, id) => `${list(n, at => `let g${id}_${at} = ${at};`, "\n")}\nfunction run${id}(s) {\n  g${id}_0 += s;\n  g${id}_${n - 1} += 1;\n  return [g${id}_0, g${id}_${n >> 1}, g${id}_${n - 1}];\n}` },
  { name: "strings-one-variable-may-hold", largest: 2049, text: (n, id) => `function word${id}(s) {\n  ${list(n, at => `if (s === ${at}) return "w${at}";`, "\n  ")}\n  return "none";\n}\nfunction run${id}(s) {\n  const word = word${id}(s % ${n + 1});\n  return [word, word === "w3", word.length, word${id}(${n - 1})];\n}` },
  { name: "symbols-and-patterns-one-variable-may-hold", largest: 513, text: (n, id) => `const marks${id} = [${list(n, at => `Symbol("s${at}")`)}];\nfunction pattern${id}(s) {\n  ${list(Math.min(n, 129), at => `if (s === ${at}) return /a${at}+/;`, "\n  ")}\n  return /none/;\n}\nfunction run${id}(s) {\n  const held = { [marks${id}[s % ${n}]]: s };\n  return [marks${id}[s % ${n}].description, held[marks${id}[s % ${n}]], pattern${id}(s % ${n}).test("a" + (s % ${n})), pattern${id}(3).source];\n}` },
  { name: "groups-nested-in-a-pattern", largest: 1025, text: (n, id) => `function run${id}(s) {\n  const found = /${"(".repeat(n)}a${")".repeat(n)}b/.exec("xab" + s);\n  const quiet = /${"(?:".repeat(n)}a${")+".repeat(n)}b/.test("aab" + s);\n  return [found.length, found[${n}], found.index, quiet];\n}` },
  { name: "alternatives-of-a-pattern", largest: 1025, text: (n, id) => `function run${id}(s) {\n  const pattern = /^(?:${list(n, at => `w${at}x`, "|")})$/;\n  return [pattern.test("w" + (s % ${n + 1}) + "x"), pattern.test("w${n - 1}x"), pattern.test("w${n}x"), "w0x w${n - 1}x".replace(/${list(n, at => `w${at}x`, "|")}/g, "-")];\n}` },
  { name: "long-elements-joined", largest: 65537, text: (n, id) => `function run${id}(s) {\n  const piece = "ab".repeat(${Math.ceil(n / 2)}).slice(0, ${n}) + s;\n  const joined = [piece, piece, piece, piece].join();\n  const spaced = Array.from({ length: 40 }, () => piece).join("--");\n  return [joined.length, joined.slice(-5), spaced.length, spaced[${n}]];\n}` },
  { name: "a-long-key-made-at-run-time", largest: 65537, text: (n, id) => `function run${id}(s) {\n  const name = "n".repeat(${n - 1}) + (s & 1);\n  const table = {};\n  table[name] = s;\n  table["n".repeat(${n - 1}) + "x"] = 1;\n  return [table[name], table["n".repeat(${n - 1}) + (s & 1)], name in table, table["n".repeat(${n})], Object.keys(table).length];\n}` },
  { name: "variables-stored-under-a-handler", largest: 1025, text: (n, id) => `function run${id}(s) {\n  ${list(n, at => `let v${at} = ${at};`, " ")}\n  try {\n    ${list(n, at => `v${at} = s + ${at};${at === n >> 1 ? " if (s & 1) fail();" : ""}`, " ")}\n  } catch (error) {\n    return ["caught", ${list(n, at => `v${at}`, " + ")}];\n  }\n  return ${list(n, at => `v${at}`, " + ")};\n}` },
  { name: "loops-around-an-object", largest: 33, text: (n, id) => `function run${id}(s) {\n  let last = null;\n  let sum = 0;\n  ${list(n, at => `for (let i${at} = 0; i${at} < ${at < 3 ? 2 : 1}; i${at}++) {`, " ")}\n  const made = { a: s + i0, b: i${n - 1} };\n  sum += made.a + made.b;\n  if (sum === s * 3 + 1) last = made;\n  ${"}".repeat(n)}\n  return [sum, last];\n}` },
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
  return `${head}${combinations.map(({ thing, count }, at) => `// ${at + 1}: ${count} ${thing.name}\n${thing.text(count, at + 1)}\nfor (const s of [3, 4, 1000003, 2147483000, 2147483647]) console.log("${at + 1}", show(${thing.isAsync ? "await " : ""}run${at + 1}(s)));`).join("\n")}\nconsole.log(touched);\n`;
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

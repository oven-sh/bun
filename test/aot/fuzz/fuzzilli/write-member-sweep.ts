// One program for each member of every object that the host brings: `Bun`, `process`, the globals, the `node:` and `bun:` modules, and what hangs below them, two steps deep.
// A program asks one question of one member and does nothing else with it: `typeof holder.member`, `"member" in holder`, or, once for each holder, its own keys.
// A build leaves out what a program does not reach, and a member that is only asked for is reached by nothing else: the executable has to answer as `bun <file>` does.
//
//   bun write-member-sweep.ts <folder>      writes <folder>/<n>-<question>-<path>.mjs; the Bun that runs this file says which members there are
import { mkdirSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

const out = process.argv[2];
mkdirSync(out, { recursive: true });

/** What answers differently from run to run or from file to file, ends the process when it is read, or waits for input. */
const leftOut =
  /^(?:argv\d?|execArgv|execPath|pid|ppid|title|env|main|origin|stdin|mainModule|_\w+|\$\w*|cwd|debugPort|report|constructor|caller|callee|arguments)$/;
const isName = (key: string) => /^[A-Za-z_$][\w$]*$/.test(key);
const step = (path: string, key: string) => (isName(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`);
const canHold = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";

type Holder = { head: string; path: string; value: object; depth: number };
const holders: Holder[] = [];
const seen = new Set<object>([globalThis, Object.prototype, Function.prototype]);
function add(head: string, path: string, value: unknown, depth: number) {
  if (!canHold(value) || seen.has(value)) return;
  seen.add(value);
  holders.push({ head, path, value, depth });
}

for (const name of Object.getOwnPropertyNames(globalThis).sort())
  if (isName(name) && !leftOut.test(name) && name !== "globalThis" && name !== "self") {
    let value: unknown;
    try {
      value = (globalThis as any)[name];
    } catch {}
    add("", name, value, name === "Bun" || name === "process" ? 0 : 1);
  }
for (const name of [...builtinModules].sort()) {
  if (name.startsWith("_") || name.includes("/_") || /^(?:bun:main|bun:wrap|bun:internal)/.test(name)) continue;
  const specifier = name.includes(":") ? name : `node:${name}`;
  let namespace: any;
  try {
    namespace = await import(specifier);
  } catch {
    continue;
  }
  if (canHold(namespace.default)) add(`import held from ${JSON.stringify(specifier)};\n`, "held", namespace.default, 0);
  holders.push({
    head: `import * as held from ${JSON.stringify(specifier)};\n`,
    path: "held",
    value: namespace,
    depth: 2,
  });
}

let count = 0;
const write = (question: string, holder: Holder, text: string, key = "") =>
  writeFileSync(
    join(
      out,
      `${String(++count).padStart(5, "0")}-${question}-${`${holder.head.match(/"([^"]+)"/)?.[1] ?? ""}-${holder.path}-${key}`.replace(/[^\w$]+/g, "-").slice(0, 90)}.mjs`,
    ),
    `${holder.head}${text}\n`,
  );
for (let at = 0; at < holders.length; at++) {
  const holder = holders[at];
  let keys: string[] = [];
  try {
    keys = Object.getOwnPropertyNames(holder.value).filter(key => !leftOut.test(key) && !/^\d+$/.test(key));
  } catch {}
  if (keys.length > 400) continue;
  write("keys", holder, `console.log(Object.keys(${holder.path}).sort().join());`);
  write("names", holder, `console.log(Object.getOwnPropertyNames(${holder.path}).sort().join());`);
  for (const key of keys) {
    write("typeof", holder, `console.log(typeof ${step(holder.path, key)});`, key);
    write("in", holder, `console.log(${JSON.stringify(key)} in ${holder.path});`, key);
    if (holder.depth >= 2) continue;
    let value: unknown;
    try {
      value = (holder.value as any)[key];
    } catch {}
    add(holder.head, step(holder.path, key), value, holder.depth + 1);
  }
}
console.log(`${holders.length} holders, ${count} programs`);

// A holder of members (a global of the host or of the language, an object that hangs on one, what a library module exports) goes into hands that the compiler cannot follow, and a store under a hidden key may have hit the global
// of its name. Long afterwards, behind six calls found one after the other, the program names every own member of the holder. The members are those that the running Bun lists.
import { spawnSync } from "bun";
import { bunEnv, bunExe } from "harness";
import { builtinModules } from "node:module";

export interface Holder {
  name: string;
  setup: string;
  expression: string;
}

const globals = ["process", "Bun", "globalThis", "console", "Buffer", "crypto", "performance", "navigator", "Intl", "WebAssembly", "Reflect", "JSON", "Math", "Atomics", "Symbol", "Object", "Array", "Promise", "Error", "Response", "Request", "Blob", "URL", "Headers", "AbortSignal", "ReadableStream", "Temporal"];
const inner = ["process.versions", "process.release", "process.features", "process.config", "crypto.subtle", "import.meta", "Bun.s3", "Bun.redis", "Bun.dns", "Bun.unsafe", "Bun.password", "Bun.semver", "Bun.hash", "Bun.inspect"];
const modules = builtinModules.filter(name => !name.startsWith("_") && !name.includes("test") && !/(^|:)(ffi|repl)$/.test(name));

export const holders: Holder[] = [
  ...[...globals, ...inner].map(expression => ({ name: expression, setup: "", expression })),
  ...[...new Set(modules)].map(specifier => ({ name: specifier, setup: `import holder from ${JSON.stringify(specifier)};`, expression: "holder" })),
];

// Reading these starts something, or answers what differs between a run from the sources and an executable.
const leftOut = new Set(["process.stdin", "process.mainModule", "process.binding", "process._linkedBinding", "process.exitCode", "globalThis.onmessage", "globalThis.onerror"]);

const lister = `
const listed = {};
for (const { name, setup, expression } of JSON.parse(process.env.HOLDERS)) {
  let holder;
  try { holder = setup ? (await import(name)).default : expression === "import.meta" ? import.meta : (0, eval)(expression); } catch { continue; }
  if (holder === null || (typeof holder !== "object" && typeof holder !== "function")) continue;
  listed[name] = Object.getOwnPropertyNames(holder).filter(key => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)).sort();
}
console.log(JSON.stringify(listed));
process.exit(0);
`;

let listed: Record<string, string[]> | undefined;
function membersOf(holder: Holder): string[] {
  listed ??= JSON.parse(spawnSync([bunExe(), "-e", lister], { env: { ...bunEnv, HOLDERS: JSON.stringify(holders) } }).stdout.toString()) as Record<string, string[]>;
  return (listed[holder.name] ?? []).filter(member => !leftOut.has(`${holder.name}.${member}`));
}

export const textOf = (holder: Holder) => `${holder.setup}
const functionNobodyKnows = globalThis[process.argv[2] ?? "Boolean"];
globalThis[process.argv[3] ?? "nothing"] = functionNobodyKnows(1);
functionNobodyKnows(${holder.expression});
function late(read) { const h0 = { next: read }; const h1 = { next: () => h0.next() }; const h2 = { next: () => h1.next() }; const h3 = { next: () => h2.next() }; const h4 = { next: () => h3.next() }; const h5 = { next: () => h4.next() }; return h5.next(); }
function describe(v) { return typeof v === "function" ? "function:" + v.length : typeof v === "object" && v !== null ? "object:" + Object.prototype.toString.call(v) : typeof v; }
function attempt(name, read) { let s; try { s = describe(late(read)); } catch (e) { s = "THROWS " + e.name + " " + String(e.message).slice(0, 70); } console.log(name, s); }
${membersOf(holder)
  .map(member => `attempt(${JSON.stringify(member)}, () => ${holder.expression}.${member});`)
  .join("\n")}
process.exit(0);
`;

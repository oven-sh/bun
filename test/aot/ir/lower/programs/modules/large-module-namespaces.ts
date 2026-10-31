// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 7

// FILE: main.ts
// Module namespace objects as values: with one name, with thirty, with none, with `export *` of another module and of two, with a default, got by `import * as` and by `import()`:
// their keys in order, what the names yield, that they cannot be written, and that a name that is not exported is not there.
import * as many from "./many.ts";
import * as one from "./one.ts";
import * as none from "./none.ts";
import * as starred from "./starred.ts";
import * as changing from "./changing.ts";
const lines: string[] = [];
function describe(what: string, ns: Record<string, unknown>): void {
  const keys = Object.keys(ns);
  lines.push(what + ": " + keys.length + " names: " + keys.join() + " | " + keys.map((k) => typeof ns[k] === "function" ? "f" + (ns[k] as () => unknown)() : typeof ns[k] === "object" ? "{" + Object.keys(ns[k] as object).join() + "}" : String(ns[k])).join());
  lines.push(what + ": " + ("missing" in ns) + " " + String(ns.missing) + " " + keys.every((k) => k in ns) + " " + Object.getOwnPropertyNames(ns).join());
  try { (ns as any).added = 1; lines.push(what + ": written"); } catch (error) { lines.push(what + ": " + (error as Error).constructor.name); }
}
for (const [what, ns] of [["many", many], ["one", one], ["none", none], ["starred", starred], ["changing", changing]] as [string, Record<string, unknown>][]) describe(what, ns);
changing.bump(); changing.bump();
lines.push("changing.count " + changing.count + " " + (changing as Record<string, unknown>)["count"]);
lines.push("spread " + Object.keys({ ...many }).length + " " + JSON.stringify({ ...one }));
const late = await import("./late.ts");
describe("late", late as Record<string, unknown>);
lines.push("the same again " + ((await import("./late.ts")) === late) + " " + ((await import("./many.ts")) === many));
console.log(lines.join("\n"));

// FILE: changing.ts
export let count = 0;
export function bump(): number { return ++count; }

// FILE: late.ts
export const first = 1, second = 2, third = 3;
export default function named(): string { return "default"; }
export * as inner from "./one.ts";

// FILE: many.ts
export function zeta(): number { return 0; }
export const alpha = 1;
export const mu = 2;
export function beta(): number { return 3; }
export const omega = 4;
export const gamma = 5;
export function nu(): number { return 6; }
export const delta = 7;
export const xi = 8;
export function epsilon(): number { return 9; }
export const pi = 10;
export const eta = 11;
export function rho(): number { return 12; }
export const theta = 13;
export const sigma = 14;
export function iota(): number { return 15; }
export const tau = 16;
export const kappa = 17;
export function upsilon(): number { return 18; }
export const lambda = 19;
export const phi = 20;
export function a1(): number { return 21; }
export const a10 = 22;
export const a2 = 23;
export function Z(): number { return 24; }
export const _u = 25;
export const $d = 26;
export function chi(): number { return 27; }
export const psi = 28;
export const omicron = 29;

// FILE: none.ts
const hidden = 1;
if (hidden !== 1) throw new Error("never");
export {};

// FILE: one.ts
export const only = "one";

// FILE: starred.ts
export * from "./one.ts";
export * from "./changing.ts";
export const own = "own";
export default "the default";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

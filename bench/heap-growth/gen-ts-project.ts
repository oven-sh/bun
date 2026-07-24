#!/usr/bin/env bun
// Generate a synthetic TypeScript project to give tsc a realistically large
// heap. Modules import only from lower indices (DAG) to avoid circular type
// inference. Each module defines interfaces, classes, functions with generics.
import { mkdirSync, writeFileSync, rmSync } from "fs";

const N = parseInt(process.argv[2] ?? "2000", 10);
const K = 5;
const dir = process.argv[3] ?? "./ts-large";
try { rmSync(dir + "/src", { recursive: true }); } catch {}
mkdirSync(dir + "/src", { recursive: true });

for (let i = 0; i < N; i++) {
  const deps: number[] = [];
  for (let j = 1; j <= K && i - j * 7 >= 0; j++) deps.push(i - j * 7);
  let s = "";
  for (const d of deps) s += `import { C${d}, type T${d}, f${d} } from "./m${d}";\n`;
  const depT = deps.length ? deps.map(d => `T${d}`).join(" | ") : "never";
  s += `export interface T${i} { id: number; name: string; tags: string[]; `;
  if (deps.length) s += `parent: ${depT}; `;
  s += `meta: Record<string, number>; }\n`;
  s += `export class C${i}<X = T${i}> {\n`;
  s += `  private items: X[] = [];\n`;
  if (deps.length) s += `  readonly prev = new C${deps[0]}();\n`;
  s += `  add(x: X): this { this.items.push(x); return this; }\n`;
  s += `  get(i: number): X | undefined { return this.items[i]; }\n`;
  s += `  map<R>(fn: (x: X, i: number) => R): R[] { return this.items.map(fn); }\n`;
  s += `  filter(fn: (x: X) => boolean): X[] { return this.items.filter(fn); }\n`;
  s += `  reduce<R>(fn: (a: R, x: X) => R, init: R): R { return this.items.reduce(fn, init); }\n`;
  s += `}\n`;
  s += `export function f${i}<X extends { id: number }>(x: X): X & { stamp: number } {\n`;
  s += `  return { ...x, stamp: ${i} };\n}\n`;
  s += `export const v${i}: T${i} = { id: ${i}, name: "m${i}", tags: ["a","b","c"], `;
  if (deps.length) s += `parent: {} as ${depT}, `;
  s += `meta: { k: ${i} } };\n`;
  if (deps.length) s += `void [${deps.map(d => `f${d}(v${i})`).join(", ")}];\n`;
  writeFileSync(`${dir}/src/m${i}.ts`, s);
}
let idx = "";
for (let i = 0; i < N; i++) idx += `export * from "./m${i}";\n`;
writeFileSync(`${dir}/src/index.ts`, idx);
writeFileSync(`${dir}/tsconfig.json`, JSON.stringify({
  compilerOptions: {
    target: "es2022", module: "esnext", moduleResolution: "bundler",
    strict: true, noEmit: true, skipLibCheck: true,
  },
  include: ["src"],
}, null, 2));
console.log(`wrote ${N} modules to ${dir}`);

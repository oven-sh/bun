// The diagnostics of typescript-go and of tsc 6.0.2 for TypeScript-only syntax in a.js, with the text each one covers.
// usage: bun ts8-spans.mjs [parsediag binary] > ts8-spans.txt
import { spawnSync } from "node:child_process";
const inputs = [
  "let f: (a: number) => void",
  "function f(a?: number, ...b: string[]): void {}",
  "declare function f(a: number): void;",
  "function f<T, U>(a) {}",
  "x = <T,>(a) => c",
  "class A<T> extends B<T> implements C, D {}",
  "class A { public readonly x: number = 1 }",
  "class A { constructor(private readonly x, public y) {} }",
  "class A { foo?(): void {} }",
  "class A { abstract foo(): void; }",
  "abstract class A {}",
  "declare class A { x: number }",
  "declare const x: number, y",
  "interface A { f(a: number): void }",
  "type A<T> = T",
  "enum E { A }",
  "declare enum E { A }",
  "namespace N { export const x = 1 }",
  "module M.N {}",
  "declare namespace N {}",
  "import x = require('y');",
  "export import a = b.c;",
  "export = x;",
  "import type { a } from 'b';",
  "import { type a, b } from 'c';",
  "export type { a };",
  "export { type a, b };",
  "x = (a)!;",
  "x = a.b!.c;",
  "x = y as T as U",
  "x = y satisfies T",
  "try {} catch (e: unknown) {}",
  "function f(this: Window) {}",
  "class A { get x(): number { return 1 } set x(v: number) {} }",
  "x = { m<T>(a: T): T { return a } }",
  "@dec export class A {}",
  "export @dec class A {}",
  "@a export @b class A {}",
  "@a export default @b class A {}",
  "export @a default class A {}",
  "class A { @dec constructor() {} }",
  "x = function (a: number): void {}",
  "x = async (a: number): Promise<void> => {}",
  "for (const x: number of y) ;",
  "class A { declare x; accessor y; static z; async m() {} }",
  "export default class<T> {}",
  "var x!: number",
  "class A { x!: number }",
  "function f(a, b?) {}",
  "x = a as const",
];
const names = ["a.js"];
const lines = [];
inputs.forEach((text, i) => lines.push(JSON.stringify({ id: `${i}`, name: "a.js", text })));
const go = spawnSync(process.argv[2] ?? "/tmp/rr/parsediag", ["-max", "16"], { input: lines.join("\n") + "\n" });
const goRows = go.stdout.toString().trim().split("\n").map(l => JSON.parse(l));
const tscOut = spawnSync("node", ["-e", `
const ts = require("/workspace/wt/parser/node_modules/typescript"); const path = require("path");
const inputs = ${JSON.stringify(inputs)};
const out = [];
for (const src of inputs) {
  const name = "a.js";
  const options = { allowJs: true, checkJs: true, noEmit: true, target: 99, module: 99, jsx: 1, noLib: true, types: [] };
  const host = ts.createCompilerHost(options, true);
  host.getSourceFile = (f, lang) => path.basename(f) === name ? ts.createSourceFile(f, src, lang, true) : undefined;
  host.fileExists = f => path.basename(f) === name; host.readFile = f => path.basename(f) === name ? src : undefined;
  const program = ts.createProgram([name], options, host);
  const sf = program.getSourceFile(name);
  out.push({ parse: sf.parseDiagnostics.map(d => [d.code, d.start, d.length]), all: program.getSyntacticDiagnostics(sf).map(d => [d.code, d.start, d.length]) });
}
console.log(JSON.stringify(out));`]);
const tscRows = JSON.parse(tscOut.stdout.toString());
inputs.forEach((src, i) => {
  const g = goRows.find(r => String(r.id) === String(i));
  const fmt = d => `TS${d[0]} ${JSON.stringify(src.slice(d[1], d[1] + d[2]))}@${d[1]}`;
  const gjs = (g.js ?? []).map(fmt).join("  "), gp = g.d.map(fmt).join("  ");
  const t = tscRows[i];
  const tp = new Set(t.parse.map(d => d.join(":")));
  const tjs = t.all.filter(d => !tp.has(d.join(":"))).map(fmt).join("  ");
  console.log(`${JSON.stringify(src)}\n   typescript-go: ${gp ? "PARSE " + gp + " | " : ""}${gjs || "-"}${gjs === tjs ? "\n   tsc 6.0.2:     same" : "\n   tsc 6.0.2:     " + (t.parse.length ? "PARSE " + t.parse.map(fmt).join("  ") + " | " : "") + (tjs || "-")}`);
});

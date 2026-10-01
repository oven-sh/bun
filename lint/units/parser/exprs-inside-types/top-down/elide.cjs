// Does tsc 6.0.2 keep an import that is used only by an expression inside type syntax?
// Emit of a two-file program (full checker), and of transpileModule (one file, no checker).
const ts = require("/workspace/wt/parser/node_modules/typescript");
const cases = [
  `import { x } from "./y"; export {}`,
  `import { x } from "./y"; export let v: typeof x;`,
  `import { x } from "./y"; export type A = { [x]: 1 };`,
  `import { x } from "./y"; export interface I { [x](): void }`,
  `import { x } from "./y"; export let g: (a = x) => void;`,
  `import { x } from "./y"; export type A = { get p() { return x } };`,
  `import { x } from "./y"; export type A = { a: number = x };`,
];
for (const src of cases) {
  const files = { "/a.ts": src, "/y.ts": "export const x: unique symbol = Symbol();" };
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, noLib: true, types: [], noEmitOnError: false };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (f, v) => (files[f] !== undefined ? ts.createSourceFile(f, files[f], v, true) : undefined);
  host.fileExists = f => files[f] !== undefined; host.readFile = f => files[f];
  let out = ""; host.writeFile = (f, t) => { if (f.endsWith("a.js")) out = t; };
  ts.createProgram(["/a.ts"], options, host).emit();
  const iso = ts.transpileModule(src, { compilerOptions: options }).outputText;
  console.log(src + "\n   program: " + out.replace(/\s+/g, " ").trim() + "\n   transpileModule: " + iso.replace(/\s+/g, " ").trim());
}

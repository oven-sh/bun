const ts = require("/workspace/wt/parser/node_modules/typescript");
const cases = [
 'import { foo } from "./x"; type T = { [foo]: string }; export let t: T;',
 'import { foo } from "./x"; type T = { [foo.bar]: string }; export let t: T;',
 'import { foo } from "./x"; interface I { [foo](): void } export let t: I;',
 'import { foo } from "./x"; type T = typeof foo; export let t: T;',
 'import { foo } from "./x"; type T = { a: foo }; export let t: T;',
 'import { foo } from "./x"; let g: (a = foo) => void; export { g };',
 'import { foo } from "./x"; let g: (@foo a) => void; export { g };',
 'import { foo } from "./x"; type T = { a: number = foo }; export let t: T;',
 'import { foo } from "./x"; type T = { get x() { return foo } }; export let t: T;',
 'import { foo } from "./x"; function f<T extends +foo>() {} export { f };',
 'import { foo } from "./x"; type T = import("./y", { with: { type: foo } }); export let t: T;',
 'import { foo } from "./x"; interface I extends foo {} export let t: I;',
 'import { foo } from "./x"; interface I extends foo.bar<string> {} export let t: I;',
 'import { foo } from "./x"; class C implements foo {} export { C };',
 'import { foo } from "./x"; let g: ({ [foo]: a }: any) => void; export { g };',
 'import { foo } from "./x"; let g: ({ a = foo }: any) => void; export { g };',
 'import { foo } from "./x"; declare function f(a = foo): void; export {};',
 'import { foo } from "./x"; function f(a = foo): void; function f() {} export { f };',
 'import { foo } from "./x"; abstract class C { abstract m(a = foo): void } export { C };',
 'import { foo } from "./x"; class C { declare p = foo; } export { C };',
 'import { foo } from "./x"; declare const c = foo; export {};',
 'import { foo } from "./x"; class C { [foo]: string; } export { C };',
 'import { foo } from "./x"; class C { declare [foo]: string; } export { C };',
 'import { foo } from "./x"; declare class C { [foo]: string; } export {};',
 'import { foo } from "./x"; abstract class C { abstract [foo]: string; } export { C };',
 'import { foo } from "./x"; class C { [foo](): void; [foo]() {} } export { C };',
];
const fs = require("fs");
fs.writeFileSync("/tmp/eit/elide.json", JSON.stringify(cases.map((text, i) => ({ id: "X" + i, text }))));
const libDir = require("path").dirname(require.resolve("/workspace/wt/parser/node_modules/typescript/lib/lib.d.ts"));
for (const [i, text] of cases.entries()) {
  const tm = ts.transpileModule(text, { compilerOptions: { target: 99, module: 99, experimentalDecorators: true } }).outputText.replace(/\s+/g, " ").trim();
  const tmv = ts.transpileModule(text, { compilerOptions: { target: 99, module: 99, experimentalDecorators: true, verbatimModuleSyntax: true } }).outputText.replace(/\s+/g, " ").trim();
  // full program with a real ./x module that exports a value
  const files = { "/a.ts": text, "/x.ts": "export const foo: unique symbol = Symbol(); export declare namespace foo { const bar: unique symbol; interface bar<T> {} }" };
  let out = "";
  const host = ts.createCompilerHost({});
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (f, l) => files[f] !== undefined ? ts.createSourceFile(f, files[f], l, true) : orig(f, l);
  host.fileExists = f => files[f] !== undefined || fs.existsSync(f);
  host.readFile = f => files[f] ?? fs.readFileSync(f, "utf8");
  host.writeFile = (f, t) => { if (f.endsWith("a.js")) out = t; };
  host.getCurrentDirectory = () => "/";
  const prog = ts.createProgram(["/a.ts"], { target: 99, module: 99, moduleResolution: 100, skipLibCheck: true, types: [], experimentalDecorators: true, noEmitOnError: false }, host);
  prog.emit();
  console.log("X" + i, JSON.stringify(text));
  console.log("    transpileModule:", JSON.stringify(tm.includes('from "./x"') ? "KEEPS import" : "drops import"), "| program emit:", out.includes('from "./x"') ? "KEEPS import" : "drops import");
}

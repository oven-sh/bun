const tsPath = process.argv[2];
const ts = (await import(tsPath)).default;
const cases = [
  [`a.d.ts`, `declare class C { m(...a: any[], ): void }`],
  [`a.d.ts`, `export class C { m(...a: any[], ): void }`],
  [`a.d.ts`, `export function f(...a: any[], ): void;`],
  [`a.ts`, `declare class C { m(...a: any[], ): void }`],
  [`a.ts`, `class C { m(...a: any[], ): void {} }`],
  [`a.d.ts`, `export const x: number;`],
  [`a.d.ts`, `const x;`],
  [`a.d.ts`, `using x: T;`],
  [`a.d.ts`, `export {}; await using x: T;`],
  [`a.d.ts`, `global {}`],
  [`a.ts`, `global {}`],
  [`a.d.ts`, `module "m" {}`],
  [`a.ts`, `module "m" {}`],
  [`a.d.ts`, `break;`],
  [`a.d.ts`, `return;`],
  [`a.d.ts`, `declare const x: number;`],
  [`a.d.ts`, `declare namespace N { declare const y: number; }`],
  [`a.d.ts`, `export default class C { m(): void }`],
  [`a.d.ts`, `export default function f(): void;`],
  [`a.d.ts`, `export default abstract class C { abstract m(): void }`],
  [`a.d.ts`, `import a = require("b"); export import c = a.d;`],
  [`a.d.ts`, `export as namespace X;`],
  [`a.d.ts`, `export = x;`],
  [`a.d.ts`, `class C { x = 1; m() {} }`],
  [`a.d.ts`, `export class C { declare x: number; }`],
  [`a.d.ts`, `@d export class C {}`],
  [`a.d.mts`, `export const x: number;`],
  [`a.d.cts`, `export const x: number;`],
  [`a.d.css.ts`, `export const x: number;`],
  [`a.d.css.mts`, `export const x: number;`],
  [`d.ts`, `export const x: number;`],
  [`.d.ts`, `export const x: number;`],
  [`dir.d.ts/a.ts`, `export const x: number;`],
];
for (const [name, src] of cases) {
  const fileName = "/" + name;
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, true);
  const parse = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}+${d.length}`);
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true, noResolve: true, types: [], noEmit: true, strict: false, experimentalDecorators: false };
  const host = { getSourceFile: f => (f === fileName ? sf : undefined), getDefaultLibFileName: () => "lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: f => f, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: f => f === fileName, readFile: () => undefined };
  let rest = [];
  try {
    const program = ts.createProgram([fileName], options, host);
    const NOISE = new Set([2304, 2552, 2503, 2307, 2318, 2792, 2583, 2591, 2580, 2584, 2868, 2867, 2882, 2686, 2879, 17004, 6142, 7026, 2875, 2874, 2300, 2451]);
    rest = [...program.getSemanticDiagnostics(sf)].filter(d => !NOISE.has(d.code)).map(d => `TS${d.code}@${d.start}+${d.length} ${ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 90)}`);
  } catch (e) { rest = ["program threw " + e.message.slice(0, 80)]; }
  console.log(`${name.padEnd(14)} decl=${sf.isDeclarationFile ? 1 : 0} parse=[${parse.join(",")}] check=[${rest.join(" ; ")}]   <= ${JSON.stringify(src)}`);
}
console.log("ts version", ts.version);

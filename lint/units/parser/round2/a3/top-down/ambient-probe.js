const t = new Bun.Transpiler({ loader: "ts" });
const cases = process.argv.slice(2).length ? process.argv.slice(2) : [
  `export const version: string;\nexport const render: number;\nexport const hydrate: number;\n`,
  `import { Key, ReactPortal } from "react";\nexport const version: string;\nexport const render: number;\nexport const hydrate: number;\n`,
  `import { Key, ReactPortal } from "react";\nexport function createPortal(children: any, key?: Key | null): ReactPortal;\nexport const version: string;\nexport const render: number;\nexport const hydrate: number;\n`,
  `export function f(a: number): void;\nexport const version: string;\n`,
  `export function f(): void;\nexport const version: string;\n`,
  `function f(a: number): void;\nconst version: string;\n`,
  `declare function f(a: number): void;\ndeclare const version: string;\n`,
  `export class C { m(a: number): void; x: number }\nexport const version: string;\n`,
  `export namespace N { const a: number; function g(b: string): void; }\nexport const version: string;\n`,
  `export function f(arguments: number): void;\nexport const version: string;\n`,
];
for (const src of cases) {
  let r; try { r = JSON.stringify(t.transformSync(src)); } catch (e) { r = "ERR " + JSON.stringify((e?.errors ?? [e]).map(x => String(x?.message ?? x))); }
  console.log(JSON.stringify(src).slice(0, 150), "\n   =>", r);
}

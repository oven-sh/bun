// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.tsx
// `@jsx ns.h` stands beside `ns.s`, where `const ns = require(..)` holds an ES module.
/** @jsxRuntime classic */
/** @jsx ns.h */
export {};
const ns = require("./lib");
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
console.log(<div a="1">x</div>, ns.s);

// FILE: lib.ts
export function h(tag: any, props: any, ...children: any[]) {
  return [typeof tag === "string" ? tag : typeof tag, props && Object.keys(props).join(), children.flat().join("|")].join(":");
}
export const Fragment = "fragment";
export const s = "s";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

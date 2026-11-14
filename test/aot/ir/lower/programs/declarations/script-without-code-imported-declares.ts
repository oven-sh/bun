// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// Nothing is left of shims.ts at run time, so whether it is a script is a question for the checker alone: `declare module` in it declares a module and adds to none, and its interface is global, as for tsc and `bun check`.
import "./shims";
import { third } from "untyped-thirds";
import thing from "./one.thing";

const size: Size = { width: 9 };
console.log(third(size.width), typeof thing);

// FILE: node_modules/untyped-thirds/index.js
exports.third = n => n / 3;

// FILE: node_modules/untyped-thirds/package.json
{ "name": "untyped-thirds", "version": "1.0.0", "main": "index.js" }

// FILE: one.thing
thing
// FILE: shims.ts
interface Size {
  width: number;
}
declare module "untyped-thirds" {
  export function third(n: number): number;
}
declare module "*.thing" {
  const path: string;
  export default path;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "auto", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": false, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [ "main.ts" ] }

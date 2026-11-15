// RUN: lower

// What `types` of an imported file's tsconfig.json names is declared.

// FILE: app/main.ts
import { known, type Size } from "../lib/index";
const size: Size = 1;
console.log(known, size);

// FILE: app/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true}}

// FILE: lib/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":["widget"],"strict":true}}

// FILE: lib/index.ts
import type * as kit from "widget-kit";
export type Size = ReturnType<typeof kit.size>;
export const known: boolean = typeof WIDGET_VERSION === "number";

// FILE: node_modules/@types/widget/package.json
{"name":"@types/widget","version":"1.0.0","types":"index.d.ts"}

// FILE: node_modules/@types/widget/index.d.ts
declare const WIDGET_VERSION: number;
declare module "widget-kit" {
  export function size(): number;
}

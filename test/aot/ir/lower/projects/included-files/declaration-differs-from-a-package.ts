// RUN: lower
// DIAGNOSTIC: TS2717 src/options.ts:4

// The error is at the program's own file.

// FILE: src/main.ts
import "./options";
import type { Options } from "schema";
const options: Options = { known: 1 };
console.log(options.known);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[],"skipLibCheck":true},"include":["src","tests"]}

// FILE: node_modules/schema/package.json
{"name":"schema","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/schema/index.js

// FILE: node_modules/schema/index.d.ts
export interface Options {
  known?: number;
}

// FILE: node_modules/published/package.json
{"name":"published","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/published/index.js

// FILE: node_modules/published/index.d.ts
export {};
declare module "schema" {
  interface Options {
    extra?: string;
  }
}

// FILE: src/aaa.d.ts
import "published";
export {};

// FILE: src/options.ts
export {};
declare module "schema" {
  interface Options {
    extra?: string | number;
  }
}

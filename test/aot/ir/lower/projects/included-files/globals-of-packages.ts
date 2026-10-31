// RUN: lower

// Globals of a package that only another file of the project imports are declared.

// FILE: test/uses.ts
const a: FromScript = { a: 1 };
const b: FromSubpath = { b: "x" };
const c: FromFolder = { c: true };
export const sum = a.a + b.b.length + Number(c.c);

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true},"include":["test"]}

// FILE: node_modules/@types/shapes/package.json
{"name":"@types/shapes","version":"1.0.0","types":"index.d.ts"}

// FILE: node_modules/@types/shapes/index.d.ts
interface FromScript {
  a: number;
}
declare module "shapes" {
  export const made: FromScript;
}

// FILE: node_modules/@types/shapes/register.d.ts
declare global {
  interface FromSubpath {
    b: string;
  }
}
export {};

// FILE: node_modules/@types/shapes/folder/index.d.ts
interface FromFolder {
  c: boolean;
}

// FILE: node_modules/@types/shapes/module.d.ts
interface NotGlobal {
  d: number;
}
export const one: NotGlobal;

// FILE: node_modules/shapes/package.json
{"name":"shapes","version":"1.0.0","main":"index.js"}

// FILE: node_modules/shapes/index.js
exports.made = { a: 1 };

// FILE: node_modules/shapes/register.js

// FILE: node_modules/shapes/folder/index.js

// FILE: node_modules/shapes/module.js
exports.one = { d: 1 };

// FILE: test/utils/setup.ts
import "shapes";
import "shapes/register";
import "shapes/folder";
import "shapes/module";

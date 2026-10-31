// RUN: lower

// A relative import without an extension is found in an ES module under Node16, as Bun finds it.

// FILE: main.ts
import { value } from "./src/value";
import { inFolder } from "./src/folder";
console.log(value, inFolder);

// FILE: package.json
{"name":"under-node16","type":"module"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2023","module":"Node16","moduleResolution":"Node16","noEmit":true,"types":[],"strict":true}}

// FILE: src/value.ts
export const value: number = 1;

// FILE: src/folder/index.ts
export const inFolder: string = "folder";

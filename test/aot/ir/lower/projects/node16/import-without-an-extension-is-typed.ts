// RUN: lower
// DIAGNOSTIC: TS2322 main.ts:2

// FILE: main.ts
import { value } from "./src/value";
const text: string = value;
console.log(text);

// FILE: package.json
{"name":"under-node16","type":"module"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2023","module":"Node16","moduleResolution":"Node16","noEmit":true,"types":[],"strict":true}}

// FILE: src/value.ts
export const value: number = 1;

// FILE: src/folder/index.ts
export const inFolder: string = "folder";

// RUN: lower
// DIAGNOSTIC: TS100150 main.ts:1

// FILE: main.ts
import { value } from "./src/nowhere";
console.log(value);

// FILE: package.json
{"name":"under-node16","type":"module"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2023","module":"Node16","moduleResolution":"Node16","noEmit":true,"types":[],"strict":true}}

// FILE: src/value.ts
export const value: number = 1;

// FILE: src/folder/index.ts
export const inFolder: string = "folder";

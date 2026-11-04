// RUN: lower
// DIAGNOSTIC: TS6263 inner/lib.ts:1

// FILE: main.ts
import "./inner/lib.ts";

// FILE: tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"allowArbitraryExtensions":true}}

// FILE: inner/tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true}}

// FILE: inner/lib.ts
import text from "./note.txt";
const t: "declared" = text;
console.log(typeof t);

// FILE: inner/note.txt
words

// FILE: inner/note.d.txt.ts
declare const text: "declared";
export default text;

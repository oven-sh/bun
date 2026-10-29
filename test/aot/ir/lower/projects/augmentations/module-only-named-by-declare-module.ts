// RUN: lower
// ENTRY: src/middleware/nonce/uses.ts

// A module that is only named by `declare module` is found without a neighbor that imports it.

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true},"include":["src"]}

// FILE: src/index.ts
export { read } from "./context";
export type { Variables } from "./context";

// FILE: src/context.ts
export interface Variables {}
const store: object = { nonce: "n" };
export function read<Key extends keyof Variables>(key: Key): Variables[Key] | undefined {
  return (store as Variables)[key];
}

// FILE: src/middleware/nonce/index.ts
export const name = "nonce";
declare module "../.." {
  interface Variables {
    nonce?: string;
  }
}

// FILE: src/middleware/nonce/uses.ts
import { name } from ".";
import { read } from "../../context";
declare module "../.." {
  interface Variables {
    other?: string;
  }
}
console.log(name, read("nonce"), read("other"));

// FILE: src/imports-it.ts
import { read } from ".";
console.log(typeof read);

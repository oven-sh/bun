// RUN: lower
// LINK: node_modules/member -> packages/member

// A package of a workspace is found through its link, by its real path.

// FILE: src/main.ts
console.log(typeof fromMember);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: packages/member/package.json
{"name":"member","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: packages/member/index.js
exports.value = 1;

// FILE: packages/member/index.d.ts
export declare const value: number;
declare global {
  var fromMember: number | undefined;
}

// FILE: node_modules/placeholder/package.json
{"name":"placeholder","version":"1.0.0"}

// FILE: tests/setup.ts
import { value } from "member";
import { value as again } from "member/index.js";
export const both = [value, again];

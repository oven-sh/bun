// RUN: lower

// Folders of one name in different places each find their own copy of a package.

// FILE: src/main.ts
console.log(typeof fromLeftTwin, typeof fromRightTwin);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: tests/left/shared/node_modules/twin/package.json
{"name":"twin","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: tests/left/shared/node_modules/twin/index.js
exports.value = 1;

// FILE: tests/left/shared/node_modules/twin/index.d.ts
export declare const value: number;
declare global {
  var fromLeftTwin: number | undefined;
}

// FILE: tests/right/shared/node_modules/twin/package.json
{"name":"twin","version":"2.0.0","main":"index.js","types":"index.d.ts"}

// FILE: tests/right/shared/node_modules/twin/index.js
exports.value = 1;

// FILE: tests/right/shared/node_modules/twin/index.d.ts
export declare const value: number;
declare global {
  var fromRightTwin: number | undefined;
}

// FILE: tests/left/shared/uses.ts
import { value } from "twin";
export const left = value;

// FILE: tests/right/shared/uses.ts
import { value } from "twin";
export const right = value;

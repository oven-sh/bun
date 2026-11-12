// RUN: lower
// LINK: tests/node_modules -> store

// FILE: src/main.ts
console.log(typeof fromLinkedFolder);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: store/linked/package.json
{"name":"linked","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: store/linked/index.js
exports.value = 1;

// FILE: store/linked/index.d.ts
export declare const value: number;
declare global {
  var fromLinkedFolder: number | undefined;
}

// FILE: tests/nested/deeper/setup.ts
import { value } from "linked";
export const one = value;

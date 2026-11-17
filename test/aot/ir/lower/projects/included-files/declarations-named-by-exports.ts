// RUN: lower

// FILE: src/main.ts
console.log(typeof fromMapped, typeof fromMappedSub);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: node_modules/mapped/package.json
{"name":"mapped","version":"1.0.0","exports":{".":{"types":"./types/main.d.ts","custom":"./custom.js","default":"./index.js"},"./sub":{"types":"./types/sub.d.ts","default":"./sub.js"}}}

// FILE: node_modules/mapped/index.js
exports.value = 1;

// FILE: node_modules/mapped/custom.js
exports.value = 2;

// FILE: node_modules/mapped/sub.js
exports.value = 3;

// FILE: node_modules/mapped/types/main.d.ts
export declare const value: number;
declare global {
  var fromMapped: number | undefined;
}

// FILE: node_modules/mapped/types/sub.d.ts
export declare const value: number;
declare global {
  var fromMappedSub: number | undefined;
}

// FILE: tests/setup.ts
import { value } from "mapped";
import { value as sub } from "mapped/sub";
export const both = [value, sub];

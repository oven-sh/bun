// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// CHECK-LABEL: function {{*}}name="sum"
// CHECK-LABEL: function {{*}}name="sum"

// FILE: main.ts
// A class and a typedef of a js module are imported as types in typescript.
import type { Level, Pair } from "./library.js";

function sum(pair: Pair, level: Level): number {
  return pair.first + pair.second + level;
}
console.log(sum({ first: 1, second: 2, sum: () => 3 }, 2));

// FILE: library.js
export class Pair {
  /** @param {number} first */
  constructor(first) {
    this.first = first;
    this.second = 2;
  }
  sum() {
    return this.first + this.second;
  }
}
/** @typedef {number} Level */
export const Level = { Low: 1, High: 2 };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": true }, "files": [] }

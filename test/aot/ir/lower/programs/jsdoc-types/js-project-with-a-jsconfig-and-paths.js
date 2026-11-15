// RUN: lower
// OPTIONS: builtin-modules
// CWD: js-project-with-a-jsconfig-and-paths
// STATISTIC: SourceFilesInferred = 3

// FILE: js-project-with-a-jsconfig-and-paths/main.js
import { next } from "@lib/counter.js";
import { next as sameNext } from "./lib/counter.js";
import { Pixel, sum } from "shapes";

/** @import { Point } from "shapes" */

/** @type {Point} */
const point = { x: 1, y: 2 };

/** @type {Point} */
const parsed = JSON.parse('{"x":"1","y":2}');

let total = 0;
for (let i = 0; i < 2000; i++) total += sum(point) + sum(new Pixel(i, 1));
console.log("2000 rounds: " + total);
console.log(next(), sameNext(), next === sameNext, sum(parsed), typeof parsed.x);

// FILE: js-project-with-a-jsconfig-and-paths/lib/counter.js
let count = 0;

/** @returns {number} */
export function next() {
  return ++count;
}

// FILE: js-project-with-a-jsconfig-and-paths/lib/shapes.js
/** @typedef {{ x: number, y: number }} Point */

/**
 * @param {Point} p
 * @returns {number}
 */
export function sum(p) {
  return p.x + p.y;
}

export class Pixel {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

// FILE: js-project-with-a-jsconfig-and-paths/jsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": true, "paths": { "@lib/*": [ "./lib/*" ], "shapes": [ "./lib/shapes.js" ] } }, "files": [] }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": true }, "files": [] }

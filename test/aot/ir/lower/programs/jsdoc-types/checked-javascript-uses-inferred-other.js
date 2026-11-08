// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.js
// Checked javascript uses what is inferred from other javascript files.
import { Bare, Grown, Tagged, variadic } from "./esm.js";
import both from "./both.cjs";
import Main from "./assigned.cjs";

console.log(variadic(), variadic(1, 2, 3));
console.log(new Grown().extra());
console.log(new Tagged(1).next(), new Bare(2).n + 1);
console.log(both(), both.extra + 1, Main.helper());

// FILE: assigned.cjs
class Main {}
module.exports = Main;
module.exports.helper = function () {
  return "helper";
};

// FILE: both.cjs
exports = module.exports = function main() {
  return "main";
};
exports.extra = 1;

// FILE: esm.js
export function variadic() {
  return arguments.length;
}

export class Grown {
  constructor() {
    this.x = 1;
  }
}
/** @returns {number} */
Grown.prototype.extra = function () {
  return this.x + 1;
};

/**
 * @constructor
 * @param {number} n
 */
export function Tagged(n) {
  this.n = n;
}
/** @returns {number} */
Tagged.prototype.next = function () {
  return this.n + 1;
};

/** @param {number} n */
export function Bare(n) {
  this.n = n;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": true }, "files": [] }

// `module.exports.x`, `this.x`, a variable that holds `exports`, getters onto other modules.
declare const console: { log(...values: unknown[]): void };
import { report, pattern } from "./user.cjs";
import theDefault, { s, g } from "./forEs.js";
import * as forEs from "./forEs.js";
console.log(report(), pattern);
console.log(s, g(1), forEs.s, forEs.g(2), theDefault, forEs.default);

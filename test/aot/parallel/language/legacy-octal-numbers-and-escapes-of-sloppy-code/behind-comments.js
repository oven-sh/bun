// A JSDoc comment with an import, a type or an await in it makes no code strict.
/** @import { Stats } from "node:fs" */
/** @type {{ [await 1]: string }} */
var record = {};
/** @type {number} */
var typed = 015;
globalThis.legacyOctalBehindComments = [typed, /** @type {string} */ ("\6"), Object.keys(record).length, 08];

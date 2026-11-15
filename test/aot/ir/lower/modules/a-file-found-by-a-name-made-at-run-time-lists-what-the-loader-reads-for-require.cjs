// The loader of the run time reads `__esModule` and "module.exports" off an ES module to find what `require` answers, by whatever name it came to the module.
// So a file that a name made at run time may find lists both, also where the answer is read under one name and looked at no further. `other` is read by an import statement alone.
// RUN: link
// CHECK: path="{{*}}/tray.mjs"{{*}}IsFoundByName]{{*}}exports=[{name="__esModule" variable=[[mark]]}, {name="label" variable=[[label]]}, {name="module.exports" variable=[[served]]}]

// FILE: main.cjs
const { seen } = require("./beside.mjs");
exports.load = name => require(name).label;
console.log(seen, "./tray.mjs");

// FILE: beside.mjs
import { other } from "./tray.mjs";
export const seen = other;

// FILE: tray.mjs
const served = { label: "of module.exports" };
export const other = "other";
export const label = "of the namespace";
export const __esModule = true;
export { served as "module.exports" };

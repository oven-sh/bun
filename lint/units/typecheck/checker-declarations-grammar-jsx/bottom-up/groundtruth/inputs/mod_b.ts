import { T, v as require } from "./mod_a";
import * as ns from "./mod_a";
import type Def, { T as T2 } from "./mod_a";
import eq = require("./mod_a");
export { T, missing } from "./mod_a";
export * from "./mod_a";
export { "str" as z };
var exports = 1;
class Object {}
const T = 1;
namespace Inner { import x from "./mod_a"; export { x }; }
export default 1;
export default 2;
declare module "./mod_a" { export const aug: number; import z from "q"; }
import("./mod_a", {}, 3);

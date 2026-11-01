import { one, two } from "./exports.cjs";
import * as all from "./exports.cjs";
console.log("called", one(), two, all.one(), all.default.two);

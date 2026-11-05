import "./lamp.mjs";
import { first, wire, scale } from "./dial.mjs";
import * as whole from "./dial.mjs";
export * from "./dial.mjs";
export { wire as thread } from "./dial.mjs";
globalThis.ran.push("panel " + first + wire + scale + Object.keys(whole));

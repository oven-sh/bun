import "./lamp.mjs";
import { coil, scale } from "./dial.mjs";
export * from "./dial.mjs";
globalThis.ran.push("panel " + coil + scale);

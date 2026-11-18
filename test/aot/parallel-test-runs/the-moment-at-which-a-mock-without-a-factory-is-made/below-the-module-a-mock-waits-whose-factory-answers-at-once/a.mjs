import { x } from "./b.mjs";
globalThis.runsOfA = (globalThis.runsOfA ?? 0) + 1;
export const y = x + 1;

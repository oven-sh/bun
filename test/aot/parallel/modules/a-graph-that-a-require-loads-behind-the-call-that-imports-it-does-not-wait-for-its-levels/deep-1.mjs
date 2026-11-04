import { name as below } from "./deep-2.mjs";
globalThis.ran.push("deep-1");
export const name = "deep-1" + ">" + below;

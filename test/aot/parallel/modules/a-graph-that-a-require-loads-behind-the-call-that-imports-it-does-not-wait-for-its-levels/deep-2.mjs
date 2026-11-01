import { name as below } from "./deep-3.mjs";
globalThis.ran.push("deep-2");
export const name = "deep-2" + ">" + below;

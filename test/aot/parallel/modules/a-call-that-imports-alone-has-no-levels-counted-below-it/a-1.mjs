import { name as below } from "./a-2.mjs";
globalThis.ran.push("a-1");
export const name = "a-1" + ">" + below;

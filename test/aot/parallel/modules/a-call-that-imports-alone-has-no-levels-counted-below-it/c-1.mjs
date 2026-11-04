import { name as below } from "./c-2.mjs";
globalThis.ran.push("c-1");
export const name = "c-1" + ">" + below;

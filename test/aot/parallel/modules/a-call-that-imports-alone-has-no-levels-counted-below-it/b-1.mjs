import { name as below } from "./b-2.mjs";
globalThis.ran.push("b-1");
export const name = "b-1" + ">" + below;

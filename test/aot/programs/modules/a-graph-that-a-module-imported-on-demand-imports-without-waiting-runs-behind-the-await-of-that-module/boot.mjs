import { idle } from "./idle.mjs";
import { one } from "./file.cjs";
console.log("boot runs", idle(one));
export const loaded = import("./upper.mjs").then(() => console.log("boot then upper"));
console.log("boot ends");

import { shared } from "./shared-by-both.mjs";
import { run } from "./feature.mjs";
console.log("one runs");
export const total = shared + run();

import { run } from "./feature.mjs";
import { shared } from "./shared-by-both.mjs";
console.log("two runs");
export const total = shared - run();

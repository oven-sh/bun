import { early } from "./first.mjs";
export function declared(width) { return "declared " + helper(width); }
function helper(width) { return width * 2; }
console.log(early, declared(1));

import { count } from "./other.cjs";
import whole, { first } from "./running.cjs";
console.log("imported-by-a-required-module: importer runs", count, first, typeof whole);
export const seen = count + first;

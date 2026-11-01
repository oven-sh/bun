import whole, { first } from "./running.cjs";
import { count } from "./other.cjs";
console.log("required-and-imported-first: importer runs", count, first, typeof whole);
export const seen = count + first;

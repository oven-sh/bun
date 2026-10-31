import { count } from "./other.cjs";
import whole, { first } from "./main.cjs";
console.log("the entry point: importer runs", count, first, typeof whole);
export const seen = count + first;

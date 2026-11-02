import { count } from "./other.cjs";
import whole, { first } from "./running.cjs";
console.log("required: importer runs", count, first, typeof whole);
export const seen = count + first;

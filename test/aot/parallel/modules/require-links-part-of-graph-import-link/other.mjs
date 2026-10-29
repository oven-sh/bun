import { base, list } from "./file.cjs";
import { value } from "./part.mjs";
import { below } from "./below-part.mjs";
console.log("other runs", list.join());
export const other = base + value + below;

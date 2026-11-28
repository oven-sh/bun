import { createRequire } from "node:module";
export const describe = meta => typeof meta.url;
const load = createRequire(import.meta.url);
import.meta.mark = 1;
console.log(load("./ferry.cjs").deck, import.meta.mark);

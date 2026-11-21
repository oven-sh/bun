import { createRequire } from "node:module";
export const describe = meta => typeof meta.url;
import.meta.mark = 1;
console.log(createRequire(import.meta.url)("./ferry.cjs").deck, import.meta.mark);

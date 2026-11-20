import * as all from "./lib.cjs";
import lib from "./lib.cjs";
export const through = turns => { let s = 0; for (let i = 0; i < turns; i++) s = (s + all.add(i, 2) + all.low(i) + lib.add(i, 3) + all.default.low(i)) | 0; return s; };

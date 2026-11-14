import * as s from "./s.mjs";
import * as c from "./c.mjs";
import * as m from "./m.mjs";
console.log("SAID other runs");
export const other = () => [s.sF?.(), c.cF?.(), m.mF?.(), s.sName, c.cName, m.mName, s.sHit?.(), c.cHit?.(), m.mHit?.()].join();

import "./first.cjs";
import * as a from "./a.cjs";
import * as b from "./b.cjs";
import "./x.mjs";
import * as c from "./c.cjs";
import "./f.cjs";
export * from "./g.cjs";
import "./two-below.mjs";
console.log("main", a.parent(), b.parent(), c.parent());

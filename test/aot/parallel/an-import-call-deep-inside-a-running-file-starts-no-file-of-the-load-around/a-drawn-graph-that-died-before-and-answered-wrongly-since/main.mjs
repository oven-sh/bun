import { t1 } from "./m1.mjs";
import { t2 } from "./m2.cjs";
import "./m6.cjs";
import { t8 } from "./m8.mjs";
const later0 = () => import("./m1.mjs");
console.log("end (" + [t1, t2, t8, typeof later0].join() + ")");
Promise.all(globalThis.waits ?? []).then(all => console.log("later (" + all.sort().join() + ")"));

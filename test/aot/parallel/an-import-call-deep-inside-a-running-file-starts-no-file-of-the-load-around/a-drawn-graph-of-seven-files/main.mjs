import { t1 } from "./m1.cjs";
import { t2 } from "./m2.mjs";
import * as n4 from "./m4.mjs";
console.log("end (" + [t1, t2, n4.t4].join() + ")");
Promise.all(globalThis.waits ?? []).then(all => console.log("later (" + all.sort().join() + ")"));

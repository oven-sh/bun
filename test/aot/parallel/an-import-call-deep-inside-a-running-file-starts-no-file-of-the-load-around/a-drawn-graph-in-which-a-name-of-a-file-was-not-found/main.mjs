import * as n4 from "./m4.mjs";
import r1 from "./m1.cjs";
console.log("end (" + [n4.t4, r1.t1].join() + ")");
Promise.all(globalThis.waits ?? []).then(all => console.log("later (" + all.sort().join() + ")"));

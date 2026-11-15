import { t1 } from "./m1.cjs";
console.log("end (" + [t1].join() + ")");
Promise.all(globalThis.waits ?? []).then(all => console.log("later (" + all.sort().join() + ")"));

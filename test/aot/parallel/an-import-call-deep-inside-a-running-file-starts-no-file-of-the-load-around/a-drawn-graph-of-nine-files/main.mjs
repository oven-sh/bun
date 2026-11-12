import "./m1.cjs";
const later0 = () => import("./m3.mjs");
console.log("end (" + [typeof later0].join() + ")");
Promise.all(globalThis.waits ?? []).then(all => console.log("later (" + all.sort().join() + ")"));

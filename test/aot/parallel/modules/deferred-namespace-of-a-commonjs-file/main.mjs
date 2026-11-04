import defer * as later from "./stores.cjs";
import * as now from "./stores.cjs";
import defer * as alone from "./alone.cjs";
console.log(later[Symbol.toStringTag], now[Symbol.toStringTag], later === now);
console.log(typeof later.then, typeof now.then, later.value, now.value);
console.log(Object.keys(later).join(), Object.keys(now).join(), "then" in later, "then" in now);
console.log((await later) === later, await now);
console.log(Object.prototype.toString.call(alone), alone.value, alone.default.value, Object.keys(alone).join());

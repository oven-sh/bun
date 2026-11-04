// A function that the initializer calls reads a member of a built-in object for the first time. The member is read where the call stood as well, so the built-in object gets its key when it did before.
// STATISTIC: InitializersDeferred >= 1
import { read } from "./m.mjs";
const names = () => Object.getOwnPropertyNames(Reflect).join();
const before = names();
Object.freeze(Reflect);
const o = read();
const after = names();
console.log(before === after, before.length, typeof o.m0, typeof o.m1, typeof o.m2);
console.log(before);

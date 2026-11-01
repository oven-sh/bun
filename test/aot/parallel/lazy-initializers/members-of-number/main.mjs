// A function that the initializer calls reads a member of a built-in object for the first time. The member is read where the call stood as well, so the built-in object gets its key when it did before.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
// STATISTIC: InitializersDeferred >= 1
import { read } from "./m.mjs";
const names = () => Object.getOwnPropertyNames(Number).join();
const before = names();

const o = read();
const after = names();
console.log(before === after, before.length, typeof o.m0, typeof o.m1, typeof o.m2);
console.log(before);

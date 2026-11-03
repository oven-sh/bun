import { half } from "./typed.ts";
const given = JSON.parse('[3, 3.5, "7", null, 3e10]');
for (const value of [...given, undefined, -0, { valueOf() { return 5; } }]) console.log(half(value));
console.log(half(given[0] | 0));

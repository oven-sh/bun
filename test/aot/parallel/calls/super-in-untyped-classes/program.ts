// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
for (let round = 0; round < 2; round++) { for (const line of m.all()) console.log(line); console.log(m.targets().join("\n")); }
console.log(m.swapped().join("\n")); console.log(m.swapped().join("\n"));
console.log(m.log.join());
export {};

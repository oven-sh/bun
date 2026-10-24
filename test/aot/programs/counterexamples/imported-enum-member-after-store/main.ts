// A member of an imported enum is read from the object, as in plain Bun: only the flow analysis may prove it constant.
declare const console: { log(...a: unknown[]): void };
import { E } from "./a";
const o: any = E;
o.A = 9;
console.log(E.A, E["A"], o.A, o === E);

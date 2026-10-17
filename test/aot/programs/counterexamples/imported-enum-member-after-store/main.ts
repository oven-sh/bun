// A member of an imported enum is the constant that the bundler inlines, whatever is stored on the object.
declare const console: { log(...a: unknown[]): void };
import { E } from "./a";
const o: any = E;
o.A = 9;
console.log(E.A, E["A"], o.A, o === E);

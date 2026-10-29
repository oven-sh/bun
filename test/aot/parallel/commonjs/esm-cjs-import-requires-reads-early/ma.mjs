import x, { first } from "./mb.cjs";
let seen;
try {
  seen = typeof x + ":" + Object.keys(x).join() + ":" + first;
} catch (error) {
  seen = error.name;
}
export const early = seen;
export const late = () => typeof x + ":" + Object.keys(x).join() + ":" + first + ":" + (x === globalThis.exportsOfMb);

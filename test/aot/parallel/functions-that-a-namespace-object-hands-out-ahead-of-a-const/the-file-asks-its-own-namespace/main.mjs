// The reference is `bun <file>`: a bundle has no dead zones, and the executable that `bun build --compile` makes without --aot reads undefined.
import * as self from "./main.mjs";
const member = Object.values(self)[0];
let seen = "none";
try { seen = String(member()); } catch (e) { seen = e.name; }
const late = 5;
console.log(seen);
export function readLate() {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return late + work;
}

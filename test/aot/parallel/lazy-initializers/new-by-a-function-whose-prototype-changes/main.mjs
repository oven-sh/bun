// What the initializer reads is not the same at all times. The variable holds what was there where the declaration stands.
import { read } from "./m.mjs";
import { F } from "./f.mjs";
const before = F.prototype;
F.prototype = { late: true };
console.log(Object.getPrototypeOf(read().made) === before, read().made.late);

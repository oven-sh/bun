// m.mjs has begun and not finished while what it imports runs, and that imports it back: its bindings are in their dead zone.
import { f, s, C } from "./m.mjs";
console.log("main:", typeof f, typeof s, typeof C);

// A private field helper that only a function that nobody calls would assign is never made. Calls of it build and throw as in bun run.
import { __classPrivateFieldGet } from "./helpers.mjs";
var _A_x;
class A { constructor(v) { _A_x.set(this, v); } get x() { return __classPrivateFieldGet(this, _A_x, "f"); } }
_A_x = new WeakMap();
try { let s = 0; for (let i = 0; i < 300; i++) s += new A(i).x; console.log(s); } catch (e) { console.log(e.name, typeof __classPrivateFieldGet); }

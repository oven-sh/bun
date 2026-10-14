import { nextTurns } from "../host.ts";
let sink;
class K { x; y; z; constructor(x) { this.x = x; this.y = x + 1; this.z = x + 2; } get value() { return this.x; } set value(v) { this.x = v; } m() { return this.x + this.y; } static s(v) { return v + 1; } static count = 3; }
class Sub extends K { w; constructor(x) { super(x); this.w = x; } m() { return super.m() + this.w; } }
class Fields { a = 1; b = 2; c = "x"; d = true; }
class Priv { #x; constructor(x) { this.#x = x; } get() { return this.#x; } set(v) { this.#x = v; } #hidden() { return this.#x + 1; } viaHidden() { return this.#hidden(); } has(o) { return #x in o; } }
function f109(i, pad0) { if (pad0 < 0) { let t0 = pad0|0; t0 = ((t0 ^ 5) * 3)|0; t0 = ((t0 ^ 6) * 3)|0; t0 = ((t0 ^ 7) * 3)|0; t0 = ((t0 ^ 8) * 3)|0; t0 = ((t0 ^ 9) * 3)|0; t0 = ((t0 ^ 10) * 3)|0; t0 = ((t0 ^ 11) * 3)|0; t0 = ((t0 ^ 12) * 3)|0; t0 = ((t0 ^ 13) * 3)|0; t0 = ((t0 ^ 14) * 3)|0; t0 = ((t0 ^ 15) * 3)|0; t0 = ((t0 ^ 16) * 3)|0; t0 = ((t0 ^ 17) * 3)|0; t0 = ((t0 ^ 18) * 3)|0; t0 = ((t0 ^ 19) * 3)|0; t0 = ((t0 ^ 20) * 3)|0; t0 = ((t0 ^ 21) * 3)|0; t0 = ((t0 ^ 22) * 3)|0; t0 = ((t0 ^ 23) * 3)|0; t0 = ((t0 ^ 24) * 3)|0; t0 = ((t0 ^ 25) * 3)|0; t0 = ((t0 ^ 26) * 3)|0; t0 = ((t0 ^ 27) * 3)|0; t0 = ((t0 ^ 28) * 3)|0; sink = t0; }  return new K(i); }
function bench(n) {
    if (n < 0) {
        let t = n | 0;
        t = ((t ^ 5) * 3) | 0;
        t = ((t ^ 6) * 3) | 0;
        t = ((t ^ 7) * 3) | 0;
        t = ((t ^ 8) * 3) | 0;
        t = ((t ^ 9) * 3) | 0;
        t = ((t ^ 10) * 3) | 0;
        t = ((t ^ 11) * 3) | 0;
        t = ((t ^ 12) * 3) | 0;
        t = ((t ^ 13) * 3) | 0;
        t = ((t ^ 14) * 3) | 0;
        t = ((t ^ 15) * 3) | 0;
        t = ((t ^ 16) * 3) | 0;
        t = ((t ^ 17) * 3) | 0;
        t = ((t ^ 18) * 3) | 0;
        t = ((t ^ 19) * 3) | 0;
        t = ((t ^ 20) * 3) | 0;
        t = ((t ^ 21) * 3) | 0;
        t = ((t ^ 22) * 3) | 0;
        t = ((t ^ 23) * 3) | 0;
        t = ((t ^ 24) * 3) | 0;
        t = ((t ^ 25) * 3) | 0;
        t = ((t ^ 26) * 3) | 0;
        t = ((t ^ 27) * 3) | 0;
        t = ((t ^ 28) * 3) | 0;
        sink = t;
    }
    let s = 0;
    for (let i = 0; i < n; i++) {
        sink = f109(i, 1);
    }
    return s;
}
sink = [bench, f109];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check, typeof sink);

"use strict";
let seen;
function R(n) { seen = this; this.id = 1; this.n = n; this.more = 2; }
Object.defineProperty(R.prototype, "n", { get() { return 7; }, configurable: true });
function read(r) { return [r.id, r.n, r.more].join(); }
try {
    new R(2);
    console.log("no error");
} catch (e) {
    console.log(e.name, read(seen), Object.keys(seen).join());
}

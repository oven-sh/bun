class K { constructor(n) { this.n = n; this.m = 2; } [Symbol.iterator]() { return this; } next() { return { done: false, value: 7 }; } return() { this.n = "text"; return {}; } }
function read(o) { return o.n + 1; }
const k = new K(1);
const out = [read(k), read(new K(5))];
let got; try { got = (() => { for (const v of k) { break; } return 7; })(); } catch (error) { got = error.name; }
out.push(String(got), read(k), read(new K(5)), Object.keys(k).join());
console.log(out.join(" | "));

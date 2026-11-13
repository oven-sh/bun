"use strict";
(function () {
let depth = 0; let last = 0;      
 
  
function V(a, b) { V.fill.apply(this, arguments); (this.constructor === V) && this.init.apply(this, arguments); }

V.fill = function () {  };
V.prototype.init = function (x, y) { if (x === undefined) x = 0; if (y === undefined) y = 0; this.x = x; this.y = y; };

function sum(v) { return v.x * 2 + v.y * 0.5; }
function show(v) { console.log(typeof v.x, typeof v.y, v.x === undefined, v.y === undefined, String(v.x), String(v.y), String(sum(v))); }
function make(a) { depth++; return a === 0 ? new V(0.5, 1.5) : a === 1 ? new V() : a === 2 ? new V(undefined, 2) : a === 3 ? new V(2, -0) : new V(NaN, -0); }

try {
const one = make(0);
for (let a = 0; a < 5; a++) show(make(a));
let total = 0; for (let i = 0; i < 40; i++) { const v = make(i % 5); total += sum(v); v.x += 0.5; total += v.x - v.y; } console.log(String(total));
try { V.prototype.init.apply = V.prototype.init; } catch (e) { console.log("broken", e.constructor.name); }
for (let a = 0; a < 5; a++) show(make(a));
total = 0; for (let i = 0; i < 40; i++) { const v = make(i % 5); total += sum(v); v.x += 0.5; total += v.x - v.y; } console.log(String(total));
show(one);
} catch (e) { console.log("out", typeof e === "string" ? e : e.constructor.name); }

})();

"use strict";
// The property is laid on the class object while the class is being defined, and counted up behind that.
class Base { static { Base.hits = 0; } } class Heir extends Base {} const all = [Base, Heir], at = JSON.parse("[0,1,100,3]");
function warm(b, n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; for (let i = 0; i < n; i++) b.hits = b.hits + 1; return b.hits; }
function read(h, n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let sum = 0; for (let i = 0; i < n; i++) sum += h.hits; return sum; }
const before = read(all[at[1]], at[3]); console.log(before, warm(all[at[0]], at[2]), read(all[at[1]], at[3]));

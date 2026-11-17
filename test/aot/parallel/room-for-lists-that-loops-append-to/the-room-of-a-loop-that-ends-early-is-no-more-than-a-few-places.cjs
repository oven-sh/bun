// STATISTIC: ClampedCapacitiesReserved >= 1
"use strict";
// Each of these loops has a bound of 150,000,000 and ends at its third turn by something other than the count. Whoever reserves by the bound holds 1.2 GB.
function breaks(n) { const got = [0]; for (let j = 1; j <= n; j++) { got[j] = j; if (j === 3) break; } return got; }
function throws(n, l) { const got = [0]; try { for (let j = 1; j <= n; j++) got.push(l[j].x); } catch (e) { } return got; }
function calls(n, stop) { const got = []; try { for (let j = 0; j < n; j++) got.push(stop(j)); } catch (e) { } return got; }
function throwsOut(n, l, keep) { const got = [l.length]; keep.push(got); for (let j = 1; j <= n; j++) got.push(l[j].x); }
function storesAndThrowsOut(n, l, keep) { const got = [l.length]; keep.push(got); for (let j = 1; j <= n; j++) got[j] = l[j].x; }
const kept = [];
for (let r = 0; r < 6; r++) kept.push(breaks(150000000), throws(150000000, [{ x: 0 }, { x: 1 }, { x: 2 }]), calls(150000000, (j) => { if (j === 3) throw new Error("enough"); return j; }));
for (let r = 0; r < 6; r++) { try { throwsOut(150000000, [{ x: 0 }, { x: 1 }, { x: 2 }], kept); } catch (e) { } try { storesAndThrowsOut(150000000, [{ x: 0 }, { x: 1 }, { x: 2 }], kept); } catch (e) { } }
const resident = process.memoryUsage().rss;
console.log(kept.map((l) => l.length).join(), resident < 400 * 1024 * 1024 ? "little is resident" : "MUCH IS RESIDENT: " + Math.round(resident / 1048576) + " MB");

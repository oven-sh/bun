// STATISTIC: CallsInlined >= 3
// Functions of twenty to a hundred operations that one call of a loop alone enters: state in objects, arrays and views, early returns, throws, missing arguments.
const out = [];
const wheel = { slots: new Array(64).fill(0), at: 0 };
function tick() { wheel.at = (wheel.at + 1) & 63; wheel.slots[wheel.at]++; return wheel.slots[wheel.at]; }
function turn(turns) { let t = 0; for (let k = 0; k < turns; k++) t += tick() & 1; return t; }
const ring = { data: new Float64Array(16), at: 0, sum: 0 };
function push(x) { ring.sum += x - ring.data[ring.at]; ring.data[ring.at] = x; ring.at = (ring.at + 1) & 15; return ring.sum; }
function feed(turns) { let t = 0; for (let k = 0; k < turns; k++) t += push(k & 15) & 1; return t; }
const stat = { min: Infinity, max: -Infinity, sum: 0, n: 0 };
function add(x, scale) { if (scale === undefined) scale = 1; if (x < stat.min) stat.min = x; if (x > stat.max) stat.max = x; if (x === 77) return; stat.sum += x * scale; stat.n++; if (stat.n > 5000) throw new RangeError("full"); }
function gather(turns) { try { for (let k = 0; k < turns; k++) add((k * 7919) & 1023); } catch (e) { out.push(e.message); } }
for (const turns of [0, 1, 3, 100, 3000]) { out.push(turn(turns), feed(turns), ring.sum); gather(turns); out.push(JSON.stringify(stat)); }
out.push(wheel.at, wheel.slots.slice(0, 5).join(), ring.at);
console.log(out.join());

// STATISTIC: StoresHeardUnderTextsThatBodyWrites >= 1
function add(a, b) { return a + b; }
function scale(a, s) { return a * s; }
const N = Object.freeze({ zero: 0 });
function fill() { try { for (const [k, v] of [["add", add], ["scale", scale]]) N[k] = v; return "stored"; } catch (e) { return e.constructor.name; } }
console.log(fill(), N.add, N.scale, Object.keys(N).join());

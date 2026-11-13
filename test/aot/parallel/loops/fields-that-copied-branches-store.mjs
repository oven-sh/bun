// STATISTIC: CarriedSlotsMergedAtJoins >= 2
// Functions whose branches store fields of an object that a constant of the file holds, called in loops: both arms store, one arm stores, the store is reset, the loop leaves in the middle, another name stores,
// the constant is read before it is initialized, a field becomes an accessor, the object is frozen.
const show = x => Object.is(x, -0) ? "-0" : String(x);
const out = [];
function wrap(dx) { p.x += dx; if (p.x > 10) p.x = -0; }
function early(turns) { for (let k = 0; k < turns; k++) wrap(k); }
for (const turns of [0, 3]) { try { early(turns); out.push("early " + turns); } catch (e) { out.push(e.name); } }
const p = { x: 0, y: 0 };
for (const turns of [0, 1, 4, 9, 100]) { early(turns); out.push(show(p.x)); }
const odd = { count: 0, sum: 0.5, last: "none" };
function count(k) { if (k & 1) odd.count++; }
function choose(k) { if (k & 2) odd.sum += k; else odd.sum -= 0.25; }
function both(k) { if (k & 1) { odd.count += 2; odd.sum *= 1.5; } else if (k === 8) odd.last = "eight"; }
function runCount(turns) { for (let k = 0; k < turns; k++) count(k); }
function runChoose(turns) { for (let k = 0; k < turns; k++) choose(k); }
function runBoth(turns) { for (let k = 0; k < turns; k++) both(k); }
for (const turns of [0, 1, 2, 9, 17]) { runCount(turns); runChoose(turns); runBoth(turns); out.push(odd.count + " " + show(odd.sum) + " " + odd.last); }
const other = odd;
function leaves(turns, stop) { for (let k = 0; k < turns; k++) { count(k); choose(k); if (k === stop) return k; if (k === stop + 2) throw new Error(odd.count + " at " + k); } return -1; }
for (const stop of [0, 5, -2, 50]) { try { out.push(leaves(20, stop)); } catch (e) { out.push(e.message); } out.push(odd.count + " " + show(odd.sum)); }
function beside(turns, stop) { for (let k = 0; k < turns; k++) { count(k); if (k === stop) other.count = -7; if (other.count > 1000) break; } }
beside(30, 6); out.push(odd.count);
const flags = { on: false, hits: 0 };
function toggle() { flags.on = !flags.on; if (flags.on) flags.hits++; }
for (let k = 0; k < 101; k++) toggle();
out.push(flags.on + " " + flags.hits);
const text = { value: 0 };
function mixed(k) { if (k === 3) text.value += "t"; else if (k & 1) text.value += k; }
function runMixed(turns) { for (let k = 0; k < turns; k++) mixed(k); }
runMixed(3); out.push(text.value); runMixed(9); out.push(text.value);
const grown = { n: 2147483640 };
function grow(k) { if (k & 1) grown.n += 3; }
function runGrow(turns) { for (let k = 0; k < turns; k++) grow(k); }
runGrow(12); out.push(grown.n); grown.n = Number.MAX_SAFE_INTEGER - 2; runGrow(12); out.push(grown.n);
Object.defineProperty(odd, "count", { get() { return 4; }, set(v) { out.push("set " + v); }, configurable: true });
runCount(4); out.push(odd.count);
Object.freeze(p);
try { early(3); out.push("frozen"); } catch (e) { out.push(e.name); }
out.push(show(p.x));
console.log(out.join());

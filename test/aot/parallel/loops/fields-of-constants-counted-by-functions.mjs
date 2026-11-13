// STATISTIC: UnrolledLoopStoresSunk >= 1
// Functions that count in the fields of an object that a constant of the file holds, called in loops: before the constant is initialized, beside other names of the object, with breaks and throws, frozen, and
// with an accessor in the place of a field.
const show = x => Object.is(x, -0) ? "-0" : String(x);
const out = [];
function inc(x) { state.count++; state.total += x; }
function run(turns) { for (let k = 0; k < turns; k++) inc(k & 3); }
for (const turns of [0, 1, 9]) { try { run(turns); out.push("run " + turns); } catch (e) { out.push(e.name); } }
const state = { count: 0, total: 0 };
const tell = () => out.push(show(state.count) + " " + show(state.total));
for (const turns of [0, 1, 7, 8, 9, 1000]) { run(turns); tell(); }
const alias = state;
function watched(turns, stop) { for (let k = 0; k < turns; k++) { inc(k); if (k === stop) alias.total = -0; if (alias.count === 1030) break; } }
watched(40, 3); tell();
function thrown(turns, stop) { try { for (let k = 0; k < turns; k++) { inc(1); if (k === stop) throw 0; } } catch { tell(); } }
thrown(30, 20);
for (const start of [0.5, -0, NaN, 2 ** 53 - 4]) { state.count = start; state.total = start; run(17); tell(); }
state.count = 0; state.total = 0;
class Store { constructor() { this.hits = 0; this.bytes = 0; } record(size) { if (size & 1) this.hits++; this.bytes += size; } }
const store = new Store();
function record(size) { store.record(size); }
function load(turns) { for (let k = 0; k < turns; k++) record(k & 1023); }
for (const turns of [0, 5, 3000]) { load(turns); out.push(store.hits + " " + store.bytes); }
const other = { count: 0 };
function add(x) { other.count += x; }
function sum(turns) { for (let k = 0; k < turns; k++) add(k); out.push(show(other.count)); }
sum(9); other.count = "t"; sum(3); other.count = 1; sum(3);
const guarded = { count: 1 };
function raise() { guarded.count++; }
function climb(turns) { for (let k = 0; k < turns; k++) raise(); out.push(show(guarded.count)); }
climb(12);
Object.defineProperty(guarded, "count", { get() { return 7; }, set(v) { out.push("set " + v); }, configurable: true });
climb(2);
Object.freeze(guarded);
try { climb(1); } catch (e) { out.push(e.name); }
console.log(out.join());

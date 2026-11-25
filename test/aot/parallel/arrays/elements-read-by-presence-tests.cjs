// `x in m ? m[x] : ..` looks an element of an ordinary object up once in a loop. Changes between the test and the read, holes, names and numbers that are no index count.
// STATISTIC: ElementsReadByPresenceTests >= 1
let calls = 0;
function memo(f) { const m = {}; return x => (x in m ? m[x] : (m[x] = (calls++, f(x)))); }
const squares = memo(x => x * x), halves = memo(x => x / 2), mixed = memo(x => (x & 1 ? "t" + x : x === 4 ? undefined : { x }.x));
function repeat(turns) { let n = 0; for (let k = 0; k < turns; k++) n += squares(k & 31); return n; }
function fractions(turns) { let n = 0; for (let k = 0; k < turns; k++) n += halves(k & 7); return n; }
function texts(turns) { let n = ""; for (let k = 0; k < turns; k++) n += mixed(k & 7) + ","; return n; }
console.log(repeat(1000), repeat(0), repeat(40), fractions(50), texts(20), calls);
function changing(f) { const m = {}; return x => { if (x in m) { if (x === 3) delete m[x]; if (x === 5) m[x] += 100; if (x === 7) m[3] = 0.5; return m[x]; } return (m[x] = f(x)); }; }
const changed = changing(x => x + 1);
function changes(turns) { let n = 0; for (let k = 0; k < turns; k++) { const v = changed(k & 7); n += v === undefined ? 100000 : v; } return n; }
console.log(changes(60), changes(200), changes(9));
function replacing(f) { const m = {}; return x => (x in m ? (m[x & 1] = x, m[x]) : (m[x] = f(x))); }
const replaced = replacing(x => x * 10);
function replaces(turns) { let n = 0; for (let k = 0; k < turns; k++) n += replaced(k % 3); return n; }
console.log(replaces(60), replaces(7));
function negated(f) { const m = {}; return x => { if (!(x in m)) { calls++; m[x] = f(x); } return m[x]; }; }
const other = negated(x => -x);
function others(turns) { let n = 0; for (let k = 0; k < turns; k++) n += other(k & 15); return n; }
console.log(others(100), calls);
function keyed(f) { const m = {}; return x => (x in m ? m[x] : (m[x] = (calls++, f(x)))); }
const far = keyed(x => x);
function positions(turns) { let n = 0; for (let k = 0; k < turns; k++) n += far((k & 3) * 1000003 - 2); return n; }
console.log(positions(40), calls);

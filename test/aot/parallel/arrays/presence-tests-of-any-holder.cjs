// `x in m ? m[x] : ..` over holders of every kind: holes, elements of doubles, deletes, names, parents, proxies and accessors answer as two lookups do.
let calls = 0;
function memo(f, m) { return x => (x in m ? m[x] : (m[x] = (calls++, f(x)))); }
function memoByStatements(f, m) { return x => { if (x in m) { if (calls === 6) delete m[x]; return m[x]; } calls++; return (m[x] = f(x)); }; }
function memoNegated(f, m) { return x => { if (!(x in m)) { calls++; m[x] = f(x); } return m[x]; }; }
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "{" + v.x + "}" : String(v));
function repeat(f, turns) { let n = 0; for (let k = 0; k < turns; k++) n += f(k & 31); return n; }
function list(f, turns) { const out = []; for (let k = 0; k < turns; k++) out.push(show(f(k % 7))); return out.join(); }
const plain = memo(x => x * x, {});
console.log(repeat(plain, 1000), repeat(plain, 0), repeat(plain, 40), calls);
const makers = [memo, memoByStatements, memoNegated];
const values = [x => x * x, x => x / 2, x => "v" + x, x => undefined, x => ({ x }), x => -0, x => NaN];
const holders = () => [{}, [], [1.5, 2.5], [, 7], Object.create({ 3: "above" }), Object.create(null), { 70000: 1 }, Object.freeze({ 1: 4 }), new Uint8Array(4), new Proxy({}, { has(t, k) { calls += 100; return k in t; } }), Object.defineProperty({}, 2, { get() { return ++calls; }, configurable: true }), (function () { return arguments; })(8, 9), new String("text")];
for (const make of makers) for (const value of values) { calls = 0; console.log(holders().map(m => { try { return list(make(value, m), 20); } catch (error) { return error.constructor.name; } }).join(" "), calls); }
const changed = {}; const changing = memo(x => x, changed);
function change(turns) { let n = 0; for (let k = 0; k < turns; k++) { if (k === 20) Object.setPrototypeOf(changed, { 5: 1000 }); if (k === 24) delete changed[4]; if (k === 30) changed[3] = 0.5; if (k === 40) changed[1000000] = 1; n += changing(k & 7); } return n; }
console.log(change(64), change(64), Object.keys(changed).join());

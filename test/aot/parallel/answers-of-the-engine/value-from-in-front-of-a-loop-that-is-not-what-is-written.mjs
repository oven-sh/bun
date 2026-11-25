// A value that no turn changes is tested and converted in front of the loop. Where it is not what the source says every turn does what is written: an object is converted anew in each turn, a BigInt and a symbol throw in the first turn and not where there is none.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Box { x; constructor(x) { this.x = x; } }
class Other { y; x; constructor(x) { this.y = 0; this.x = x; } }
function nameOf(thrown) { return thrown.name; }
function tell(f) { try { report(f()); } catch (thrown) { report(nameOf(thrown)); } }
function remainders(u, n) { let s = 0; for (let j = 0;j < n; j++) s = s + j % u; return s; }
function products(k, n) { let s = 0; for (let j = 0;j < n; j++) s = s + j * k; return s; }
function bits(k, n) { let s = 0; for (let j = 0;j < n; j++) s = s ^ j & k; return s; }
function bound(limit) { let c = 0; for (let j = 0;j < limit; j++) { c++; if (c > 20) break; } return c; }
function fields(o, n) { let s = 0; for (let j = 0;j < n; j++) s = s + o.x * j; return s; }
function elements(a, u, n) { for (let i = 0;i < a.length; i++) { for (let j = 0;j < n; j++) a[i] = a[i] + j % u; } return a[a.length - 1]; }
function joined(t, n) { let s = ""; for (let j = 0;j < n; j++) s = s + t; return s; }
let calls = 0;
const counted = { valueOf() { calls++; return 3; } };
tell(() => remainders(3, 10));
tell(() => remainders(2.5, 10));
tell(() => remainders(0, 3));
tell(() => remainders(-3, 10));
tell(() => remainders(NaN, 3));
tell(() => remainders(1 / 0, 5));
tell(() => remainders(4294967296, 5));
tell(() => remainders("3", 10));
tell(() => remainders(true, 4));
tell(() => remainders(null, 2));
tell(() => remainders(undefined, 2));
tell(() => remainders(counted, 10));
report(calls);
tell(() => remainders(counted, 0));
report(calls);
tell(() => remainders(10n, 0));
tell(() => remainders(10n, 1));
tell(() => remainders(Symbol(), 0));
tell(() => remainders(Symbol(), 1));
tell(() => products(2, 5));
tell(() => products(2.5, 5));
tell(() => products(-0, 1));
tell(() => products(-1, 1));
tell(() => products("2", 5));
tell(() => products(counted, 4));
report(calls);
tell(() => bits(6, 9));
tell(() => bits(6.9, 9));
tell(() => bits(4294967302, 9));
tell(() => bits("6", 9));
tell(() => bits(counted, 4));
report(calls);
tell(() => bound(3));
tell(() => bound(2.5));
tell(() => bound(NaN));
tell(() => bound(1 / 0));
tell(() => bound("4"));
tell(() => bound(counted));
report(calls);
tell(() => bound(undefined));
tell(() => fields(new Box(2), 4));
tell(() => fields(new Other(2), 4));
tell(() => fields({ x: 2 }, 4));
tell(() => fields({ x: "2" }, 4));
tell(() => fields({}, 2));
tell(() => fields(5, 2));
tell(() => elements(new Int32Array(3), 3, 7));
tell(() => elements(new Int32Array(3), 2.5, 7));
tell(() => elements(new Int32Array(3), 0, 2));
tell(() => elements([0, 0, 0], 3, 7));
tell(() => elements(new Float64Array(3), 2.5, 7));
tell(() => elements(new Int32Array(0), 3, 7));
tell(() => joined("ab", 3));
tell(() => joined(1, 3));
tell(() => joined(counted, 2));
report(calls);
report("end");

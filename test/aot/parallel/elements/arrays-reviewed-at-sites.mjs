const show = v => Object.is(v, -0) ? '-0' : typeof v === 'object' && v ? JSON.stringify(v) : typeof v === 'bigint' ? v + 'n' : typeof v === 'symbol' ? 'sym' : typeof v === 'function' ? 'fn' : String(v);
const lines = [];
const say = (...a) => { lines.push(a.map(show).join(' ')); };
const tried = f => { try { return f(); } catch (e) { return e.constructor.name + ': ' + e.message; } };
function make00(i, n) { const a = []; for (let j = 0; j < n; j++) a[j] = i; return a; }
function make01(i, n) { const a = []; for (let j = 0; j < n; j++) a[j] = i + 0.5; return a; }
function make02(i, n) { const a = []; for (let j = 0; j < n; j++) a[j] = 's' + i; return a; }
function make03(i, n) { const a = []; for (let j = 0; j < n; j++) a[j] = i % 3 ? i : i + 0.5; return a; }
function make04(i, n) { const a = []; for (let j = 0; j < n; j++) a[j] = undefined; return a; }
function make10(i, n) { const a = new Array(n); for (let j = 0; j < n; j++) a[j] = i; return a; }
function make11(i, n) { const a = new Array(n); for (let j = 0; j < n; j++) a[j] = i + 0.5; return a; }
function make12(i, n) { const a = new Array(n); for (let j = 0; j < n; j++) a[j] = 's' + i; return a; }
function make13(i, n) { const a = new Array(n); for (let j = 0; j < n; j++) a[j] = i % 3 ? i : i + 0.5; return a; }
function make14(i, n) { const a = new Array(n); for (let j = 0; j < n; j++) a[j] = undefined; return a; }
function make20(i, n) { const a = Array(n); for (let j = 0; j < n; j++) a[j] = i; return a; }
function make21(i, n) { const a = Array(n); for (let j = 0; j < n; j++) a[j] = i + 0.5; return a; }
function make22(i, n) { const a = Array(n); for (let j = 0; j < n; j++) a[j] = 's' + i; return a; }
function make23(i, n) { const a = Array(n); for (let j = 0; j < n; j++) a[j] = i % 3 ? i : i + 0.5; return a; }
function make24(i, n) { const a = Array(n); for (let j = 0; j < n; j++) a[j] = undefined; return a; }
let total = 0;
for (const make of [make00, make01, make02, make03, make04, make10, make11, make12, make13, make14, make20, make21, make22, make23, make24]) { let last; for (let i = 0; i < 20000; i++) { last = make(i % 100, i % 7); total += last.length; } say(total, last, make(1, 0), make(2, 1), make(3, 40)); }
console.log(lines.join('\n'));

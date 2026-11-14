// Every call in sight passes one number, and some callers are not in sight.
// STATISTIC: ParametersReplacedByConstants >= 1
const show = v => Object.is(v, -0) ? "-0" : Array.isArray(v) ? v.join() : String(v);
function turned(s, n) { const t = new Array(4); for (let r = 1; r < 4; r++) { for (let c = 0; c < 4; c++) t[c] = s[r][(c + r) % n]; for (let c = 0; c < n; c++) s[r][c] = t[c]; } return s; }
function rest(a, n) { return a % n + "," + a / n; }
function zero(a, n) { return 1 / n + a; }
function negative(a, n) { return a % n; }
function stepped(a, n) { n++; return n + a; }
function replaced(a, n) { if (a > 2) n = a; return n; }
function held(a, n) { const g = () => n; n = n + 1; return g() + a; }
function listed(a, n) { arguments[1] = 9; return n + "," + arguments.length; }
function kinds(a, n) { switch (n) { case 4: return "four" + a; case 5: return "five" + a; default: return typeof n + n; } }
function recursive(a, n) { return a > 0 ? recursive(a - 1, n) + n : n; }
function* steps(a, n) { for (let i = 0; i < n; i++) yield a + i; }
class Box { constructor(n) { this.n = n; this.at = []; for (let i = 0; i < n; i++) this.at[i] = i * n; } over(a, n) { return this.n * n + a; } static of(n) { return new Box(n); } }
const s = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]];
for (let k = 0; k < 5; k++) console.log(turned(s, 4).join(" | "));
for (const a of [0, 1, 3, 7, -5, 2.5, "8"]) console.log(rest(a, 4), show(zero(a, 0)), show(negative(a, -3)), stepped(a, 4), replaced(a, 4), held(a, 4), listed(a, 4), kinds(a, 4));
console.log(recursive(5, 4), [...steps(3, 4)].join(), Box.of(3).at.join(), new Box(3).over(2, 7));
for (const n of [5, 4.5, "4", undefined, -0, NaN, null, 4n]) console.log([rest, zero, stepped, replaced, held, listed, kinds].map(f => { try { return show(f.call(null, 3, n)) + " " + show([1, 2].map(x => Reflect.apply(f, null, [x, n]))); } catch (e) { return e.name; } }).join(" ; "));
console.log([1, 2, 3].map(rest).join(), [1, 2, 3].map(kinds).join(), [...steps.call(null, 1, 2)].join());

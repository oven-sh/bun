// The truth of a remainder, of numbers and of everything else.
let asked = "";
const objects = [{ valueOf() { asked += "v"; return 6; } }, { toString() { asked += "s"; return "4"; } }, { [Symbol.toPrimitive](hint) { asked += hint; return 9n; } }, { valueOf() { asked += "t"; throw new RangeError("thrown"); } }];
const values = [0, -0, 1, 2, 3, -3, 4, 6, 7, 0.5, 1.5, -1.5, 2147483647, -2147483648, 2147483648, 9007199254740992, NaN, Infinity, -Infinity, 1e-320, "", "6", "x", "0", true, false, null, undefined, 0n, 3n, 6n, -6n, [], [4], ...objects, Symbol.iterator];
function show(v) { return Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v ? "o" : typeof v === "symbol" ? "y" : String(v); }
function attempt(f, a, b) { try { return f(a, b) ? "T" : "F"; } catch (e) { return e.name[0] + e.message.length; } }
const not = (n, x) => !(n % x);
const twice = (n, x) => !!(n % x);
const chosen = (n, x) => (n % x ? 1 : 0);
const both = (n, x) => n % x && x % n;
function branch(n, x) { if (n % x) return true; return false; }
function negated(n, x) { if (!(n % x)) return false; return true; }
function loop(n, x) { let k = 0; while (n % x) { n++; if (++k > 5) break; } return k; }
function used(n, x) { const r = n % x; if (r) return r; return 0; }
function ored(n, x) { return !(n % x || x % 2); }
function caught(n, x) { try { return !(n % x); } catch (e) { return e; } finally { asked += "."; } }
const forms = { not, twice, chosen, both, branch, negated, loop, used, ored, caught };
for (const name in forms) {
  for (const a of values) {
    let line = "";
    asked = "";
    for (const b of values) line += attempt(forms[name], a, b) + " ";
    let sum = 0;
    for (const c of line + asked) sum = (sum * 31 + c.charCodeAt(0)) | 0;
    console.log(name, show(a), sum, line.slice(0, 60), asked.length);
  }
}
const factors = n => { const out = []; for (let i = 1; i <= n; i++) if (not(n, i)) out.push(i); return out; };
console.log(factors(60).join(), factors(97).join(), [1, 2, 3, 4, 5, 6].filter(x => !(x % 3)).join(), [1.5, "4", null, 6n === 6n].filter(x => x % 2).join());

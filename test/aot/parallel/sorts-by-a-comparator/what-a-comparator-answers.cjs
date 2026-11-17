// A comparator answers booleans, NaN, nothing, big integers, symbols, texts and objects with conversions of their own.
const z = JSON.parse("[0]")[0], out = [], say = (f) => { try { return String(f()); } catch (e) { return e.name + ":" + e.message; } };
const mk = (n, g) => { const l = []; for (let i = 0; i < n; i++) l.push(g(i)); return l; }, show = (l) => l.length + "[" + Array.from({ length: Math.min(l.length, 40) }, (_, i) => (i in l ? (Object.is(l[i], -0) ? "-0" : typeof l[i] === "object" && l[i] ? l[i].k + "#" + l[i].id : String(l[i])) : "_")).join() + "]";
const table = { up: (a, b) => a - b, down: (a, b) => b - a, k: (a, b) => a.k - b.k, none: () => 0 }, name = (s) => JSON.parse('["' + s + '"]')[0];
const sizes = [2, 7, 11, 12, 13, 24, 63, 64, 65, 130];
const answers = { bool: (a, b) => a > b, nan: () => NaN, undef: () => undefined, big: (a, b) => BigInt(a - b), sym: () => Symbol("s"), text: (a, b) => String(a - b), obj: (a, b) => ({ valueOf: () => a - b }), prim: (a, b) => ({ [Symbol.toPrimitive]: (h) => (out.push(h), a - b) }), half: (a, b) => (a - b) / 1e9, minus: () => -0, inf: (a, b) => (a < b ? -Infinity : Infinity), bad: () => ({ valueOf() { throw new RangeError("v"); } }), nul: () => null };
for (const n of [3, 12, 20]) for (const k of Object.keys(answers)) { const l = mk(n, (i) => i * 7 % n); out.push(k + n + say(() => show(l.sort(answers[name(k)]))) + show(l)); }
console.log(out.join("\n"));

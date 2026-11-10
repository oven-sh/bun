// Lists of fractions, of whole numbers and of both are summed, taken apart, multiplied, compared and cut to bits, inside, at and past their ends, with holes, minus zero, NaN, infinities, numbers past 32 and 53 bits, a name on the prototype and a text.
"use strict";
const out = [], any = x => [x][JSON.parse("0")], q = x => typeof x + ":" + (Object.is(x, -0) ? "-0" : String(x));
const make = () => [[0.5, 1.5, 2.5, 3.5], [0, 1, 2, 0.5, 3], [171.5, 182, 165.25, 190], [1, 2, 3], [-0.5, -1.5], [0.1, 0.2, 0.3, 1e21, 0.4]];
const T = {
    sum(l) { let s = 0; for (let i = 0; i < l.length; i++) s += l[i]; return s; },
    past(l) { let s = 0; for (let i = 0; i <= l.length; i++) s += l[i]; return s; },
    less(l) { let s = 0; for (let i = 0; i < l.length; i++) s += l[i] - 1; return s; },
    product(l) { let s = 0; for (let i = 0; i < l.length; i++) s += l[i] * l[l.length - 1 - i]; return s; },
    apart(l) { let m = 1e9; for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) { const d = Math.abs(l[i] - l[j]); if (d < m) m = d; } return m; },
    over(l) { let c = 0; for (let i = 0; i < l.length; i++) if (l[i] > 1.5) c++; return c; },
    bits(l) { let s = 0; for (let i = 0; i < l.length; i++) s = (s + (l[i] | 0) * 3 + (l[i] >>> 1)) | 0; return s; },
    whole(l) { let s = 0; for (let i = 0; i < l.length; i++) s += Number.isInteger(l[i] * 1) ? 1 : 2; return s; },
    sign(l) { let s = ""; for (let i = 0; i < l.length; i++) s += q(l[i] * 1) + q(-l[i]); return s; }
};
const all = lists => { for (const n of Object.keys(T)) for (const l of lists) { try { out.push(q(T[n](l))); } catch (e) { out.push(e.name); } } };
for (let r = 0; r < 60; r++) { out.length = 0; all(make()); }
for (const change of [l => { l[1] = 2; }, l => { l[0] = -0; }, l => { l[0] = 2 ** 31; }, l => { l[0] = 2 ** 60; }, l => { l[1] = NaN; }, l => { l.push(Infinity, -Infinity); }, l => { delete l[0]; }, l => { l.length = 1; }, l => { l[1] = any("x"); }, l => { l[1] = any(3n); }, l => { Object.freeze(l); }]) { const lists = make(); lists.forEach(change); all(lists); all(lists); }
const holed = make(), between = Object.create(Array.prototype); holed.forEach(l => { delete l[1]; Object.setPrototypeOf(l, between); }); between[1] = 7.25; all(holed); delete between[1]; all(holed);
console.log(out.join("|"));

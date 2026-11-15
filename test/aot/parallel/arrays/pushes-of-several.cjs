// Two to four values of every kind are pushed at once onto lists of every kind.
"use strict";
const out = [], hide = v => [v][JSON.parse("0")], two = (a, x, y) => a.push(x, y), three = (a, x, y, z) => a.push(x, y, z), four = (a, x, y, z, w) => a.push(x, y, z, w), show = a => a.length + "[" + Array.from({ length: Math.min(a.length, 24) }, (_, i) => (i in a ? typeof a[i] + String(a[i]?.v ?? (Object.is(a[i], -0) ? "-0" : a[i])) : "_")).join() + "]";
const vs = [1, -0, 1.5, NaN, 2 ** 31, "t", null, undefined, true, { v: 7 }]; for (const t of ["[]", "[1]", "[1.5]", "[\"a\"]", "[1,null]"]) for (const x of vs) for (const y of vs) { const a = JSON.parse(t); a.push(0); a.pop(); out.push(hide(two)(a, x, y), show(a)); hide(three)(a, y, x, 1); hide(four)(a, 1, x, 2, y); out.push(show(a)); }
let h = 7; for (const x of out) for (const c of String(x)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; console.log(out.length, h, out.slice(0, 30).join("|"));

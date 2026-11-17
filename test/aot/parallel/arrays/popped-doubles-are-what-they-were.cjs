// Whole numbers popped off lists of doubles are used as keys, indexes, cases and members.
"use strict";
const out = [], hide = v => [v][JSON.parse("0")], pop = a => a.pop(), show = a => a.length + "[" + Array.from({ length: a.length }, (_, i) => (i in a ? (Object.is(a[i], -0) ? "-0" : typeof a[i] + a[i]) : "_")).join() + "]";
const a = JSON.parse("[1.5]"); for (const v of [2, 3, 2 ** 31, -1, 0.1]) { a.push(v); const r = hide(pop)(a); out.push(r === v, [10, 20, 30, 40][r], new Map([[v, "m"]]).get(r), ({ [v]: "k" })[r], r | 0, JSON.stringify(r), r.toString(2).length, Number.isInteger(r), [v].includes(r), [v].indexOf(r)); switch (r) { case 2: out.push("two"); break; case 3: out.push("three"); break; default: out.push("-"); } }
console.log(out.join(" "));

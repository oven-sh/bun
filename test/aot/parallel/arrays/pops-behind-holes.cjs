// Holes at the end of a list of doubles are popped, with and without a number above.
"use strict";
const out = [], hide = v => [v][JSON.parse("0")], pop = a => a.pop(), show = a => a.length + "[" + Array.from({ length: a.length }, (_, i) => (i in a ? (Object.is(a[i], -0) ? "-0" : typeof a[i] + a[i]) : "_")).join() + "]";
const a = JSON.parse("[1.5,2.5,3.5]"); a.length = 5; out.push(String(hide(pop)(a)), show(a)); delete a[3]; out.push(String(hide(pop)(a)), show(a)); const above = Object.create(Array.prototype, { 2: { value: "up" } }), b = Object.setPrototypeOf([1.5, 2.5, , ], above); out.push(String(hide(pop)(b)), show(b)); const c = JSON.parse("[1.5,2.5]"); delete c[1]; out.push(String(hide(pop)(c)), show(c));
console.log(out.join(" "));

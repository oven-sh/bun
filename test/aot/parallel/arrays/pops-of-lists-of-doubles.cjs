// A list of doubles is popped and made longer again: a hole lies where the number was.
"use strict";
const out = [], hide = v => [v][JSON.parse("0")], pop = a => a.pop(), show = a => a.length + "[" + Array.from({ length: a.length }, (_, i) => (i in a ? (Object.is(a[i], -0) ? "-0" : typeof a[i] + a[i]) : "_")).join() + "]";
for (const t of ["[1.5,2.5,3.5]", "[0.5]", "[2.0,4.0,1.5]"]) { const a = JSON.parse(t); out.push(hide(pop)(a)); a.length++; out.push(show(a), a.length - 1 in a, a[a.length - 1]); hide(pop)(a); out.push(show(a)); a.length += 2; out.push(show(a)); }
console.log(out.join(" "));

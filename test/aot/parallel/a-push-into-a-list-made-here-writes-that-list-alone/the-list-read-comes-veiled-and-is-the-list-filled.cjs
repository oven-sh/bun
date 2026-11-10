"use strict";
// Nothing is known of the list that is read: it is tested in front of the loop. The list that is filled is known to be a list, comes from in front too, and is the same list.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
function handed(d, out) { let s = 0; for (let i = 0; i < d.length && i < 300; i++) { out.push(i); s = (s + d[i]) | 0; } return s + " " + d.length; }
function halves(d, out) { let s = 0; for (let i = 0; i < d.length && i < 300; i++) { out.push(i + 0.5); s += d[i]; } return s + " " + d.length; }
function texts(d, out) { let s = 0; for (let i = 0; i < d.length && i < 300; i++) { out.push("x"); s += d[i]; } return String(s).length + " " + d.length; }
function popped(d, out) { let s = 0; for (let i = 0; i < d.length; i++) { s = (s + d[i]) | 0; out.pop(); } return s + " " + d.length; }
function shifted(d, out) { let s = 0; for (let i = 0; i < d.length; i++) { s = (s + d[i]) | 0; out.shift(); } return s + " " + d.length; }
for (let round = 0; round < 3; round++) {
    const make = n => { const list = []; for (let i = 0; i < n; i++) list.push(i * 3); return list; };
    for (const run of [handed, halves, texts, popped, shifted]) { const one = make(40); said.push(run(veil(one), one), run(veil(make(40)), make(3)), one.length); }
}
console.log(said.join(" "));

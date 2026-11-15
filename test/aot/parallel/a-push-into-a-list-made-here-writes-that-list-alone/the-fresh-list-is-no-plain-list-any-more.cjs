"use strict";
// The list made here is frozen, sealed, given a setter above it, made sparse, or has its push replaced before or in the loop: the push then throws, runs other code, or goes another way, while a list from in front is read.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
function fill(d, prepare) { const out = []; prepare(out); let s = 0, thrown = ""; try { for (let i = 0; i < d.length; i++) { s = (s + d[i]) | 0; out.push(d[i]); } } catch (error) { thrown = error.constructor.name; } return s + " " + out.length + " " + thrown; }
function late(d, at, change) { const out = []; let s = 0, thrown = ""; try { for (let i = 0; i < d.length; i++) { if (i === at) change(out, d); s = (s + d[i]) | 0; out.push(d[i]); } } catch (error) { thrown = error.constructor.name; } return s + " " + out.length + " " + d.length + " " + thrown; }
for (let round = 0; round < 3; round++) {
    const make = () => JSON.parse("[" + Array.from({ length: 40 }, (_, i) => i * 7 & 255).join() + "]");
    let hits = 0;
    for (const prepare of veil([out => {}, out => Object.freeze(out), out => Object.seal(out), out => Object.preventExtensions(out), out => { out[5000] = 1; }, out => { out.push = function (x) { hits++; return 0; }; }, out => Object.setPrototypeOf(out, { push(x) { hits++; } }), out => Object.defineProperty(out, "length", { writable: false })])) said.push(fill(make(), prepare));
    for (const change of veil([(out, d) => Object.freeze(out), (out, d) => { d.length = 12; }, (out, d) => { d[20] = 0.5; }, (out, d) => { d.push(1, 2, 3); }, (out, d) => { out.push = x => { d.length = 15; return 0; }; }])) said.push(late(make(), 9, change));
    said.push(hits);
}
console.log(said.join(" "));

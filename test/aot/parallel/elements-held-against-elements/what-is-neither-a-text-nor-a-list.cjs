"use strict";
function shared(a, b) { const row = [0]; let n = 0; for (let i = 0; i < a.length; i++) { for (let j = 0; j < b.length; j++) { row[j + 1] = row[j] + (a[i] === b[j] ? 1 : 0); } n += row[b.length]; } return n; }
let asked = 0;
const watched = new Proxy(["a", "b"], { get(target, key, receiver) { asked++; return Reflect.get(target, key, receiver); } });
const withGetter = { length: 2, get 0() { asked += 100; return "a"; }, 1: "r" };
const sparse = ["a", , "r"];
const all = ["harbor", new String("harbor"), Buffer.from("ab"), new Uint16Array([97, 7]), watched, withGetter, sparse, { length: 1, 0: "h" }, (function () { return arguments; })("a", "h"), 7, true, Symbol.iterator];
let said = "";
for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) said += " " + shared(all[x], all[y]);
console.log(said, asked);
for (const bad of [null, undefined]) { for (const other of ["ab", ["a"]]) { try { console.log(shared(bad, other)); } catch (e) { console.log(e instanceof TypeError, e.message); } try { console.log(shared(other, bad)); } catch (e) { console.log(e instanceof TypeError, e.message); } } }

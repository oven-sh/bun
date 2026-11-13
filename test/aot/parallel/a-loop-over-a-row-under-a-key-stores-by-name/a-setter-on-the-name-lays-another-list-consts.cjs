"use strict";
// `for (..; i < data[w].length; ..) { acc.total = acc.total + data[w][i]; }`: the row under the key is read once in front, and a store by name into a slot of a record of the program ends nothing that is remembered of it:
// the read answers for a plain object of the host alone, which has no such slot. Whatever is handed, the answer is plain's. HERE: a setter on `total` lays another list under the key.
const zero = JSON.parse("0"), made = () => JSON.parse('{"rows":[1,2,3,4,5,6,7,8,9,10,11,12],"other":[100,200,300],"total":0}');
let counted = 0;
const held = made(), beside = { kept: 0, get total() { return this.kept; }, set total(v) { this.kept = v; counted++; if (counted === 4) held.rows = [50, 60, 70, 80, 90, 100]; } };
const data = [held][zero], w = ["rows"][zero], acc = [beside][zero];
function row() { let s = 0; for (let i = 0; i < data[w].length; i++) { acc.total = acc.total + data[w][i]; s = s + 1; s = s + data[w][i]; } return s; }
const tried = (run) => { try { return String(run()); } catch (error) { return error.name; } };
console.log(tried(() => row()), counted, tried(() => row()), counted, JSON.stringify(held).length);

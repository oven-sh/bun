"use strict";
// `for (..; i < data[w].length; ..) { acc.total = acc.total + data[w][i]; }`: the row under the key is read once in front, and a store by name into a slot of a record of the program ends nothing that is remembered of it:
// the read answers for a plain object of the host alone, which has no such slot. Whatever is handed, the answer is plain's. HERE: `acc` IS `data` and the store lays another list under the key.
const zero = JSON.parse("0"), made = () => JSON.parse('{"rows":[1,2,3,4,5,6,7,8,9,10,11,12],"other":[100,200,300],"total":0}');
let counted = 0;
const held = made(), beside = held;
function row(data, w, acc) { let s = 0; for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; if (i === 3) acc.rows = [7, 7, 7, 7, 7, 7]; } return s; }
const tried = (run) => { try { return String(run()); } catch (error) { return error.name; } };
console.log(tried(() => row([held][zero], ["rows"][zero], [beside][zero])), counted, tried(() => row([held][zero], ["rows"][zero], [beside][zero])), counted, JSON.stringify(held).length);

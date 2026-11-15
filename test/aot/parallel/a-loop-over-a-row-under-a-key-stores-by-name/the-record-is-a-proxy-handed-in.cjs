"use strict";
// `for (..; i < data[w].length; ..) { acc.total = acc.total + data[w][i]; }`: the row under the key is read once in front, and a store by name into a slot of a record of the program ends nothing that is remembered of it:
// the read answers for a plain object of the host alone, which has no such slot. Whatever is handed, the answer is plain's. HERE: `acc` is a proxy whose trap lays another list.
const zero = JSON.parse("0"), made = () => JSON.parse('{"rows":[1,2,3,4,5,6,7,8,9,10,11,12],"other":[100,200,300],"total":0}');
let counted = 0;
const held = made(), beside = new Proxy({ total: 0 }, { set(target, name, value) { counted++; target[name] = value; if (counted === 4) held.rows = [50, 60, 70, 80, 90, 100]; return true; } });
function row(data, w, acc) { let s = 0; for (let i = 0; i < data[w].length; i++) { acc.total = acc.total + data[w][i]; s = s + 1; s = s + data[w][i]; } return s; }
const tried = (run) => { try { return String(run()); } catch (error) { return error.name; } };
console.log(tried(() => row([held][zero], ["rows"][zero], [beside][zero])), counted, tried(() => row([held][zero], ["rows"][zero], [beside][zero])), counted, JSON.stringify(held).length);

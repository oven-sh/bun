// STATISTIC: ReceiversReadOffVariablesToldApartInFrontOfLoops >= 1
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const parsed = JSON.parse('{"numbers":[1.5,2,3.25,4],"whole":[1,2,3,4],"texts":["a","b","c","d"],"mixed":[1,"b",3.5,null],"holes":[1,2,3,4]}');
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
let table; let reads = 0;
function sum(turns) { let s = 0; for (let i = 0; i < turns; i++) s += table[i]; return s; }
table = new Proxy([1, 2, 3, 4], { get(target, key) { reads++; return target[key]; } }); say(unseen(sum)(4), reads);
class Padded extends Array {} table = Padded.from([1.5, 2, 3]); say(unseen(sum)(3)); Padded.prototype[3] = 9; say(unseen(sum)(4));
table = Object.setPrototypeOf([1, , 3], { 1: 50, __proto__: Array.prototype }); say(unseen(sum)(3));

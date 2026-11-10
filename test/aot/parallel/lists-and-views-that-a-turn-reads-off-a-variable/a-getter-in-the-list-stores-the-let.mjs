// STATISTIC: ReceiversReadOffVariablesToldApartInFrontOfLoops >= 1
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const parsed = JSON.parse('{"numbers":[1.5,2,3.25,4],"whole":[1,2,3,4],"texts":["a","b","c","d"],"mixed":[1,"b",3.5,null],"holes":[1,2,3,4]}');
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
let table = [1.5, 2, 3.25, 4];
Object.defineProperty(table, 1, { get() { table = parsed.texts; return 7; } });
function sum(turns) { let s = 0; for (let i = 0; i < turns; i++) s += table[i]; return s; }
say(unseen(sum)(4)); say(unseen(sum)(4));

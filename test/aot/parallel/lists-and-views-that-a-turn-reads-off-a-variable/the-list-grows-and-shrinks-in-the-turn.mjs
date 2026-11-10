// STATISTIC: ReceiversReadOffVariablesToldApartInFrontOfLoops >= 1
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const parsed = JSON.parse('{"numbers":[1.5,2,3.25,4],"whole":[1,2,3,4],"texts":["a","b","c","d"],"mixed":[1,"b",3.5,null],"holes":[1,2,3,4]}');
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
const table = parsed.numbers;
function sum() { let s = 0; for (let i = 0; i < table.length; i++) { s += table[i]; if (i === 1 && table.length < 7) table.push(10, 20); if (i === 4) table.length = 5; } return s; }
say(unseen(sum)(), table.length, unseen(sum)(), table.length);

// STATISTIC: VariableReceiverGuardsHoisted >= 1
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const parsed = JSON.parse('{"numbers":[1.5,2,3.25,4],"whole":[1,2,3,4],"texts":["a","b","c","d"],"mixed":[1,"b",3.5,null],"holes":[1,2,3,4]}');
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
const table = parsed.whole;
const sameList = unseen(table);
function sum() { let s = 0; for (let i = 0; i < table.length; i++) { s += table[i]; if (i === 0) sameList[2] = 0.5; if (i === 1) sameList[3] = "x"; } return s; }
say(unseen(sum)(), unseen(sum)());

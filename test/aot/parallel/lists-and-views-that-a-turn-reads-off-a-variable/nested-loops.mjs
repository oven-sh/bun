const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const parsed = JSON.parse('{"numbers":[1.5,2,3.25,4],"whole":[1,2,3,4],"texts":["a","b","c","d"],"mixed":[1,"b",3.5,null],"holes":[1,2,3,4]}');
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
let table = parsed.numbers; const rows = JSON.parse("[[1,2],[3,4],[5,6]]");
function nested() { let s = 0; for (let r = 0; r < rows.length; r++) { for (let i = 0; i < 2; i++) s += rows[r][i] * table[i]; if (r === 0) table = parsed.whole; if (r === 1) table = parsed.texts; } return s; }
say(unseen(nested)());

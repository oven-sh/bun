// STATISTIC: ReceiversReadOffVariablesToldApartInFrontOfLoops >= 1
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
var table = JSON.parse("[1.5,2,3.25,4]");
function sum(turns) { var s = 0; for (var i = 0; i < turns; i++) s += table[i]; return s; }
function sumAndStore(turns) { var s = 0; for (var i = 0; i < turns; i++) { s += table[i]; if (i === 1) table = "wxyz"; } return s; }
console.log(unseen(sum)(4), unseen(sumAndStore)(4), unseen(sum)(4));

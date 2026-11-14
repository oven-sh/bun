// STATISTIC: VariableReceiverGuardsHoisted >= 1
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const parsed = JSON.parse('{"numbers":[1.5,2,3.25,4],"texts":["a","b","c","d"]}');
function early() { try { return unseen(sum)(1); } catch (error) { return error.constructor.name; } }
function sum(turns) { let s = 0; for (let i = 0; i < turns; i++) s += table[i]; return s; }
const first = unseen(early)();
const table = parsed.numbers;
console.log(first, unseen(sum)(4), unseen(sum)(5));

// STATISTIC: ReceiversReadOffVariablesToldApartInFrontOfLoops >= 1
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const parsed = JSON.parse('{"numbers":[1.5,2,3.25,4],"whole":[1,2,3,4],"texts":["a","b","c","d"],"mixed":[1,"b",3.5,null],"holes":[1,2,3,4]}');
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
let table = parsed.numbers;
function sum(turns) { let s = 0; for (let i = 0; i < turns; i++) s += table[i] * 2; return s; }
const kinds = [parsed.numbers, parsed.whole, parsed.texts, parsed.mixed, new Float64Array([1.5, 2, 3]), new Uint8Array([1, 2, 3, 4]), Buffer.from([9, 8, 7, 6]), new Uint8ClampedArray([5, 6, 7, 8]), "1234", { 0: 1, 1: 2, 2: 3, 3: 4 }, [1, , 3, 4], Object.freeze([1, 2, 3, 4]), new Int16Array([-1, -2, -3, -4])];
const said = []; for (const kind of kinds) { table = kind; said.push(unseen(sum)(4), unseen(sum)(5)); } say(said.join(" "));
for (const nothing of [undefined, null]) { table = nothing; try { say(unseen(sum)(1)); } catch (error) { say(error.constructor.name); } say(unseen(sum)(0)); }

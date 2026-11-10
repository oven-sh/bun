// Helpers without loops of their own are called in loops with what stays the same through the turns: constants of the file and values from in front of the loop. All come out of a text at run time:
// fractions, whole numbers, -0, NaN by way of null and undefined, texts, booleans, objects with valueOf that count their calls, big integers, symbols. Each loop has its own function.
const given = JSON.parse(process.env.NOTHING_SET_HERE || '{"n":[0.5,1.25,2.75,3,7,-5,0],"t":["3","x",""],"o":[null,true,false]}');
const low = given.n[0], high = given.n[1], share = given.n[2], three = given.n[3], seven = given.n[4], below = given.n[5], zero = given.n[6];
const digits = given.t[0], letter = given.t[1], empty = given.t[2], nothing = given.o[0], yes = given.o[1], no = given.o[2], missing = given.o[3];
let asked = 0;
const counting = given.n.length ? { valueOf() { asked++; return 2; } } : 0, big = given.n.length ? 2n : 0, mark = given.n.length ? Symbol("m") : 0;
function blend(a, b, c) { return a + b * c; }
const spread = (a, b, c) => a * b - b / c + (c - a) * (a | 0);
const shown = x => typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(Math.round(x * 1000) / 1000)) : typeof x + ":" + String(x).slice(0, 20);
function fractions() { let sum = 0; for (let i = 0; i < 40; i++) sum += blend(low, high, share); return sum; }
function wholes() { let sum = 0; for (let i = 0; i < 40; i++) sum += blend(three, seven, below); return sum; }
function mixedNumbers() { let sum = 0; for (let i = 0; i < 40; i++) sum += spread(low, seven, below); return sum; }
function minusZero() { let last = 1; for (let i = 0; i < 40; i++) last = spread(zero, below, seven) * zero * below; return last; }
function aText() { let sum = 0; for (let i = 0; i < 40; i++) sum += blend(low, digits, share); return sum; }
function aTextInFront() { let sum = ""; for (let i = 0; i < 4; i++) sum += blend(letter, high, share); return sum; }
function anEmptyText() { let sum = 0; for (let i = 0; i < 40; i++) sum += spread(empty, high, share); return sum; }
function aNull() { let sum = 0; for (let i = 0; i < 40; i++) sum += blend(low, nothing, share); return sum; }
function booleans() { let sum = 0; for (let i = 0; i < 40; i++) sum += spread(yes, no, yes); return sum; }
function anUndefined() { let sum = 0; for (let i = 0; i < 40; i++) sum += blend(low, missing, share); return sum; }
function anObject() { let sum = 0; for (let i = 0; i < 40; i++) sum += blend(low, counting, share); return sum; }
function bigIntegers() { let sum = 0n; for (let i = 0; i < 40; i++) sum += blend(big, big, big); return sum; }
function aBigIntegerAmongNumbers() { let sum = 0; for (let i = 0; i < 40; i++) sum += blend(low, big, share); return sum; }
function aSymbol() { let sum = 0; for (let i = 0; i < 40; i++) sum += blend(low, mark, share); return sum; }
function noTurn() { let sum = 0; for (let i = 0; i < zero; i++) sum += blend(low, mark, big); return sum; }
function fromInFront(a, b, c, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += spread(a, b, c); return sum; }
function madeInFront(row, turns) { const a = row[0], b = row[1], c = row[2]; let sum = 0; for (let i = 0; i < turns; i++) sum += blend(a, b, c) - spread(c, b, a); return sum; }
for (const run of [fractions, wholes, mixedNumbers, minusZero, aText, aTextInFront, anEmptyText, aNull, booleans, anUndefined, anObject, bigIntegers, aBigIntegerAmongNumbers, aSymbol, noTurn]) {
  for (let again = 0; again < 2; again++) { try { console.log(run.name, shown(run()), asked); } catch (error) { console.log(run.name, error.constructor.name, asked); } }
}
for (const row of [[0.5, 1.25, 2.75], [3, 7, -5], ["3", 2, 4], [null, true, 2], [undefined, 1, 1], [counting, counting, 3], [1, 2, 0], [2n, 3n, 4n], [1, 2n, 3], [mark, 1, 2], [0.5, 1.25, 2.75]]) {
  for (const run of [() => fromInFront(row[0], row[1], row[2], 30), () => madeInFront(row, 30), () => fromInFront(row[0], row[1], row[2], 0)]) {
    try { console.log(shown(run()), asked); } catch (error) { console.log(error.constructor.name, asked); }
  }
}

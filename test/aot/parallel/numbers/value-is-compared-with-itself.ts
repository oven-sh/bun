// `x !== x` and `x === x` of a value of which nothing is known: NaN made in three ways, every other kind of value, an object whose valueOf would tell if it were asked
function differs(x: any) { return x !== x; }
function equals(x: any) { return x === x; }
let asked = 0;
const outside: any[] = JSON.parse('[0, -0, 1.5, "", "NaN", null, true, [], {}]');
outside.push(NaN, 0 / 0, Number("x"), undefined, BigInt(1), Symbol.iterator, differs, { valueOf() { asked++; return NaN; } });
function deed(x: unknown) { return String(differs(x)) + " " + String(equals(x)); }
console.log(deed(1), deed(NaN));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn & 1 ? NaN : turn);
console.log(log);
for (let i = 0; i < outside.length; i++) console.log(i, deed(outside[i]));
console.log(asked);

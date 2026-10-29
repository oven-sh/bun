// String(x) of values that nobody followed: strings of every kind, numbers, symbols, objects with their own conversions, and what throws.
const values = JSON.parse('["text","",5,1.5,null,true,[1,2],{"a":1}]');
values.push(undefined, Symbol("s"), Symbol.iterator, 10n, "ro" + values[0] + "pe", new String("wrapped"), { toString() { return "mine"; } }, { valueOf() { return 7; }, toString: null }, { [Symbol.toPrimitive](hint) { return hint; } }, () => 1, new Date(0).getTime(), -0, NaN, Object.create(null), { toString() { throw new RangeError("no"); } }, { toString() { return {}; } });
function text(x) { return String(x); }
function inside(x) { try { return String(x); } catch (error) { return "caught " + error.name; } }
const ask = f => values.map(value => { try { const s = f(value); return typeof s + ":" + s; } catch (error) { return "throws " + error.name; } }).join("|");
let a, b;
for (let round = 0; round < 40; round++) { a = ask(text); b = ask(inside); }
console.log(a); console.log(b);
console.log(String(), String("a", "b"), [1, "x", null].map(String).join(), String.call({}, 5), Reflect.apply(String, undefined, [Symbol("t")]));

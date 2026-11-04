// undefined, a function and a symbol. A function that has got a toJSON has a text.
function holder(value) { return { first: 1, value, last: 2 }; }
function plain() { return 1; }
function withText() { return 2; }
withText.toJSON = () => "text of a function";
class Kind { static toJSON() { return "text of a class"; } }
const values = [undefined, plain, () => 3, Symbol("s"), Symbol.iterator, withText, Kind, null];
for (const value of values) console.log(JSON.stringify(holder(value)), JSON.stringify([value]), JSON.stringify(value));

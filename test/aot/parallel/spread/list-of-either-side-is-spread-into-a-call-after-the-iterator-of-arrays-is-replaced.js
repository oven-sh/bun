// a list made on one side and a list that was handed in on the other are spread into a call, and the list that was handed in gets an iterator of its own later
function collect() { let out = String(arguments.length) + ":"; for (let i = 0; i < arguments.length; i++) out += String(arguments[i]) + ","; return out; }
function subject(c, x, given) { return collect(...(c ? [x] : given)); }
function deed(c, x, given) { return subject(c, x, given); }
const given = [7, 8];
console.log(deed(true, 1, given), deed(false, 1, given), deed(0, "a", [undefined]), deed("x", null, given));
let lengths = 0;
for (let i = 0; i < 300; i++) lengths += subject(i % 3, i, given).length;
console.log(String(lengths));
Object.defineProperty(given, Symbol.iterator, { value: function* () { yield "replaced"; yield this.length; } });
console.log(deed(JSON.parse("1"), 1, given), deed(JSON.parse("0"), 1, given));

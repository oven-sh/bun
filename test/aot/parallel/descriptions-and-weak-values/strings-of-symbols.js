// symbol.toString(): the string is kept in the cell. Symbols of every kind, one and many at a site, in and out of loops.
const one = Symbol("one");
const list = [Symbol("a"), Symbol(""), Symbol(), Symbol("two words"), Symbol("\u{1F600} \u00e9"), Symbol.for("registered"), Symbol.for(""), Symbol.iterator, Symbol.toPrimitive, Symbol("x".repeat(300)), Symbol(undefined), Symbol(12)];
function ofOne(turns) { let n = 0, last = ""; for (let i = 0; i < turns; i++) { last = one.toString(); n += last.length; } return n + " " + last; }
function ofMany(turns) { let n = 0, text = ""; for (let i = 0; i < turns; i++) { const s = list[i % list.length].toString(); n += s.length; if (i < list.length) text += s.slice(0, 30) + "|"; } return n + " " + text; }
function ofUnknown(value) { return typeof value === "symbol" ? value.toString() : "no symbol"; }
function ofAny(value) { try { return value.toString(); } catch (e) { return e.name + " " + e.message; } }
function same(value) { return value.toString() === value.toString() && value.toString() === String(value) && `${value.toString()}` === Object(value).toString(); }
console.log(ofOne(3), ofOne(1000));
console.log(ofMany(list.length), ofMany(1000));
console.log(list.map(ofUnknown).map(s => s.slice(0, 30)).join("|"), ofUnknown("text"));
console.log(list.map(same).join());
console.log([Object(one), one, null, undefined, 5, "t", [1, [2]], { toString() { return "own"; } }, Object.create(null), Symbol.prototype].map(ofAny).join("|"));
for (const wrong of [null, undefined, {}, "text", 5, Symbol.prototype]) { try { console.log(Symbol.prototype.toString.call(wrong)); } catch (e) { console.log(e.name, e.message); } }
console.log(Symbol.prototype.toString.call(one), Symbol.prototype.toString.call(Object(one)), one.toString.call(list[0]));
class Kept { constructor(s) { this.s = s; } text() { return this.s.toString(); } }
const kept = list.map(s => new Kept(s)); let sum = 0; for (let turn = 0; turn < 50; turn++) for (const k of kept) sum += k.text().length; console.log(sum);
console.log(one.description, list[2].description, list[1].description, one.valueOf() === one);
let made = 0; for (let i = 0; i < 2000; i++) made += Symbol("s" + (i % 7)).toString().length; console.log(made);

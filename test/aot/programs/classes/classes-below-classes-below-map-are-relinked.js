// A class below a class below Map; methods are overridden at each level; the classes and their prototype objects are relinked afterwards.
const lines = [];
class Top extends Map { read(k) { return this.get(k); } kind() { return "top"; } }
class Mid extends Top { kind() { return "mid>" + super.kind(); } }
class Low extends Mid { get(k) { return "low:" + super.get(k); } kind() { return "low>" + super.kind(); } }
class Side extends Top { read(k) { return "side:" + super.read(k); } }
const objects = [new Top([["a", 1]]), new Mid([["a", 2]]), new Low([["a", 3]]), new Side([["a", 4]]), new Map([["a", 5]])];
function use(o) { return (o.read ? o.read("a") : "-") + "," + (o.kind ? o.kind() : "-") + "," + (o instanceof Top) + (o instanceof Mid) + (o instanceof Low); }
let text = ""; for (let i = 0; i < 500; i++) text = use(objects[i % 5]) + (i % 100 === 0 ? "|" + text.slice(0, 40) : "");
lines.push(text, objects.map(use).join(" "));
Object.setPrototypeOf(Mid.prototype, Side.prototype); lines.push(objects.map(use).join(" "));
Object.setPrototypeOf(Mid, Side); lines.push(use(new Mid([["a", 6]])), use(new Low([["a", 7]])));
Top.prototype.read = function () { return "patched"; }; lines.push(objects.map(use).join(" "));
Object.setPrototypeOf(Top.prototype, Object.prototype);
lines.push(objects.map((o) => { try { return use(o); } catch (error) { return error.constructor.name; } }).join(" "));
Object.setPrototypeOf(Top, Set);
try { const odd = new Top(["a"]); lines.push(odd instanceof Top, Object.prototype.toString.call(odd), Set.prototype.has.call(odd, "a")); } catch (error) { lines.push(error.constructor.name); }
console.log(lines.join("\n"));

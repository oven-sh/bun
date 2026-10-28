// Objects of a class below Map get own members that hide the methods, another prototype, and the class and Map.prototype are changed.
const lines = [];
class Defaults extends Map { getOr(key, fallback) { return this.get(key) ?? fallback; } count() { return this.size; } }
function use(d) { return [d.getOr("a", 9), d.getOr("b", 9), d.count()].join(); }
const plain = new Defaults([["a", 1]]);
lines.push(use(plain));
const hidden = new Defaults([["a", 1]]);
hidden.get = () => 42;
lines.push(use(hidden));
const ownMethod = new Defaults([["a", 1]]);
ownMethod.getOr = () => "own";
lines.push(use(ownMethod));
const relinked = new Defaults([["a", 1]]);
Object.setPrototypeOf(relinked, { getOr() { return "relinked"; }, count() { return -1; } });
lines.push(use(relinked));
const fake = Object.setPrototypeOf(new Map([["a", 5]]), Defaults.prototype);
lines.push(use(fake));
const notAMap = Object.create(Defaults.prototype);
try { lines.push(use(notAMap)); } catch (error) { lines.push(error.constructor.name); }
const constructed = Reflect.construct(Map, [[["a", 6]]], Defaults);
lines.push(use(constructed), constructed instanceof Defaults);
class Other extends Map { getOr() { return "other"; } count() { return -2; } }
const crossed = Reflect.construct(Defaults, [[["a", 7]]], Other);
lines.push(use(crossed), crossed instanceof Defaults, crossed instanceof Other);
class Below extends Defaults { get(key) { return "below:" + super.get(key); } }
lines.push(use(new Below([["a", 8]])));
let sum = 0; const all = [plain, hidden, ownMethod, relinked, fake, constructed, crossed, new Below([["a", 8]])];
for (let i = 0; i < 800; i++) sum += String(all[i & 7].getOr("a", 9)).length;
lines.push(sum);
Defaults.prototype.getOr = function () { return "patched"; };
lines.push(use(plain), use(fake));
delete Defaults.prototype.getOr;
try { lines.push(use(plain)); } catch (error) { lines.push(error.constructor.name); }
Object.setPrototypeOf(Defaults.prototype, { get() { return "cut"; }, getOr(k) { return this.get(k); }, count() { return 0; } });
lines.push(use(plain));
console.log(lines.join("\n"));

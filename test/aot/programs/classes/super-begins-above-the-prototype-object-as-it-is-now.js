// `super.name` in a method begins to look above the prototype object of the method's class, as that object is linked at this moment, whoever the receiver is.
const box = JSON.parse(process.argv[9] ?? "[0]");
function hidden(value) { box[0] = value; return box[0]; }
const log = [];
class Base { read() { return "Base.read"; } get size() { return "Base.size"; } only() { return "Base.only"; } static make() { return "Base.make"; } }
class Middle extends Base { read() { return "Middle.read < " + super.read(); } }
class Leaf extends Middle {
  read() { return "Leaf.read < " + super.read(); }
  get size() { return "Leaf.size < " + super.size; }
  only() { return "Leaf.only < " + super.only(); }
  missing() { return "Leaf.missing < " + typeof super.nothing; }
  store(value) { super.stored = value; return Object.keys(this).join(); }
  arrow() { return (() => "arrow < " + super.read())(); }
  static make() { return "Leaf.make < " + super.make(); }
}
class Alone { static make() { return "Alone.make"; } read() { return "Alone.read < " + typeof super.read + " " + typeof super.toString; } }
class BelowNull extends null { static create() { return Object.create(BelowNull.prototype); } read() { try { return String(super.read); } catch (e) { return e.name; } } }
function Old() {}
Old.prototype.read = function () { return "Old.read"; };
class OverOld extends Old { read() { return "OverOld.read < " + super.read(); } }
function factory(tag) { return class extends Base { read() { return tag + ".read < " + super.read(); } }; }
const Made = [factory("first"), factory("second")];
function all(title) {
  const leaf = hidden(new Leaf());
  const lines = [leaf.read(), leaf.size, leaf.only(), leaf.missing(), leaf.store(1), leaf.arrow(), hidden(Leaf).make(), hidden(new Alone()).read(), hidden(BelowNull.create()).read(), hidden(new OverOld()).read(),
    hidden(new Made[0]()).read(), hidden(new Made[1]()).read(), Leaf.prototype.read.call(hidden({})), Leaf.prototype.read.call(hidden(new Alone()))];
  return title + ": " + lines.join(" | ");
}
function round(title) { let last = ""; for (let i = 0; i < 60; i++) last = all(title); log.push(last); }
round("as declared");
Object.setPrototypeOf(Leaf.prototype, Base.prototype);
round("Leaf.prototype hangs below Base.prototype");
Object.setPrototypeOf(Leaf.prototype, { read() { return "a literal's read"; }, get size() { return "a literal's size"; }, only() { return "a literal's only"; } });
round("Leaf.prototype hangs below a literal");
Object.setPrototypeOf(Leaf.prototype, null);
try { round("Leaf.prototype hangs below nothing"); } catch (e) { log.push("below nothing: " + e.name); }
Object.setPrototypeOf(Leaf.prototype, Middle.prototype);
Middle.prototype.read = function () { return "Middle's new read"; };
Base.prototype.nothing = "something";
Object.setPrototypeOf(Leaf, Alone);
try { round("as declared again, with a new Middle.read and Base.nothing, Leaf below Alone"); } catch (e) { log.push("again: " + e.name); }
Object.setPrototypeOf(Alone.prototype, new Proxy({}, { get(target, key) { return typeof key === "string" ? "proxy " + key : undefined; } }));
Object.setPrototypeOf(Made[0].prototype, Old.prototype);
Object.setPrototypeOf(OverOld.prototype, Base.prototype);
try { round("Alone below a proxy, the first made class below Old, OverOld below Base"); } catch (e) { log.push("proxy: " + e.name); }
console.log(log.join("\n"));

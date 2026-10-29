// `super.name` is asked of the run time once for each class it is read from, not at every read. What was learnt ends when the member is replaced, when the name arrives nearer by, and when the home object gets another prototype.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const asked = () => count("operationAOTGetSuperBase") + count("operationAOTSuperGet") + count("operationAOTGetSuperPropertyById");
class Base {
  x = 1; y = 2;
  sum() { return this.x + this.y; }
  label() { return "base"; }
  get twice() { return this.x * 2; }
  static make(v) { return "made " + v; }
  static kind = "a base";
}
class Middle extends Base { label() { return "middle of " + super.label(); } }
class Leaf extends Middle {
  w = 3;
  sum() { return super.sum() + this.w; }
  label() { return "leaf of " + super.label(); }
  get twice() { return super.twice + 1; }
  missing() { return super.nothingOfThatName; }
  field() { return super.x; }
  viaArrow() { return (() => super.sum())(); }
  static make(v) { return super.make(v) + "!"; }
  static kindOfParent() { return super.kind; }
}
const base = { hello() { return "hello from " + this.name; }, name: "base" };
const literal = { __proto__: base, name: "literal", hello() { return super.hello() + "."; } };
const leaf = new Leaf();
function many(read, turns) { let last; for (let i = 0; i < turns; i++) last = read(); return last; }
const reads = {
  sum: () => leaf.sum(), label: () => leaf.label(), missing: () => leaf.missing(), field: () => leaf.field(), viaArrow: () => leaf.viaArrow(),
  make: () => Leaf.make(1), kindOfParent: () => Leaf.kindOfParent(), hello: () => literal.hello(),
};
let most = 0;
const results = [];
for (const name of Object.keys(reads)) {
  const before = asked();
  results.push(many(reads[name], 500));
  most = Math.max(most, asked() - before);
}
console.log(results.join(" | "));
console.log(most <= 12 ? "no data property was asked of the run time more than twelve times" : "the run time was asked " + most + " times in 500 reads of one `super.name`");
console.log(many(() => leaf.twice, 50), many(() => new Leaf().twice, 50));

// The receiver of a getter is `this`, not the object the search starts at.
Object.defineProperty(Base.prototype, "who", { get() { return this === leaf ? "the leaf" : this === Middle.prototype ? "the prototype" : "another"; }, configurable: true });
class Asker extends Base { ask() { return super.who; } }
console.log(many(() => new Asker().ask(), 50), many(() => Asker.prototype.ask.call(leaf), 50));

// The member is replaced, hidden, deleted.
Base.prototype.sum = function () { return 100; };
console.log(many(reads.sum, 50), many(reads.viaArrow, 50));
Middle.prototype.sum = function () { return 200; };
console.log(many(reads.sum, 50), many(reads.viaArrow, 50));
delete Middle.prototype.sum;
console.log(many(reads.sum, 50));
delete Base.prototype.sum;
let message = "";
try { leaf.sum(); } catch (error) { message = error instanceof TypeError ? "TypeError" : String(error); }
console.log(message);
Middle.prototype.nothingOfThatName = "something";
console.log(many(reads.missing, 50));
Object.defineProperty(Middle.prototype, "nothingOfThatName", { get() { return "from a getter of " + this.w; }, configurable: true });
console.log(many(reads.missing, 50));
Base.make = v => "remade " + v;
console.log(many(reads.make, 50));
Base.kind = "changed";
console.log(many(reads.kindOfParent, 50));
base.hello = function () { return "goodbye from " + this.name; };
console.log(many(reads.hello, 50));

// The home object gets another prototype.
Object.setPrototypeOf(literal, { hello() { return "another hello"; } });
console.log(many(reads.hello, 50));
Object.setPrototypeOf(Leaf.prototype, { label() { return "a stranger"; }, sum() { return 7; } });
console.log(many(reads.label, 50), many(reads.sum, 50));
Object.setPrototypeOf(Leaf, { make(v) { return "by a stranger " + v; } });
console.log(many(reads.make, 50), many(reads.kindOfParent, 50));
Object.setPrototypeOf(literal, null);
try { literal.hello(); message = "no error"; } catch (error) { message = error instanceof TypeError ? "TypeError" : String(error); }
console.log(message);
Object.setPrototypeOf(literal, new Proxy({}, { get(target, key, receiver) { return () => "a proxy was asked for " + String(key) + " on behalf of " + receiver.name; } }));
console.log(many(reads.hello, 5));
if (typeof gc === "function") gc(); else if (typeof Bun !== "undefined") Bun.gc(true);
console.log(many(() => new Middle().label(), 100), many(reads.label, 100));

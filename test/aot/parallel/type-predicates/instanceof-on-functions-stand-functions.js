// Constructor functions that stand under other functions (Object.setPrototypeOf(Below, Above), as node's streams do), asked with instanceof from inside and outside: the answer follows
// Symbol.hasInstance wherever it appears on the chain of functions, the prototype property, and the chain of the value, whenever any of them changes.
function Root() { if (!(this instanceof Root)) return { refusedBy: "Root" }; this.root = 1; }
function Middle() { if (!(this instanceof Middle)) return { refusedBy: "Middle" }; Root.call(this); this.middle = 1; }
function Leaf() { if (!(this instanceof Leaf)) return { refusedBy: "Leaf" }; Middle.call(this); this.leaf = 1; }
function OnlyBase() { if (!(this instanceof OnlyBase)) return "called without new"; this.base = 1; }
function Heir() { OnlyBase.call(this); this.heir = 1; }
function Alone() { this.alone = 1; }
for (const [below, above] of [[Middle, Root], [Leaf, Middle], [Heir, OnlyBase]]) { Object.setPrototypeOf(below.prototype, above.prototype); Object.setPrototypeOf(below, above); }
const all = { Root, Middle, Leaf, OnlyBase, Heir, Alone };
function ask(v) { let line = ""; for (const name in all) line += v instanceof all[name] ? "1" : "0"; return line; }
function askEach(v) { return [v instanceof Root, v instanceof Middle, v instanceof Leaf, v instanceof OnlyBase, v instanceof Heir, v instanceof Alone].map(Number).join(""); }
function attempt(run) { try { return run(); } catch (e) { return e.constructor.name; } }
function make() { return [() => new Root(), () => new Middle(), () => new Leaf(), () => new Heir(), () => new Alone(), () => Root(), () => Middle(), () => Leaf(), () => ({}), () => null, () => 5, () => Object.create(Leaf.prototype), () => Object.create(null), () => Leaf, () => Leaf.prototype].map(attempt); }
function round(title) { let line = ""; for (let i = 0; i < 40; i++) line = make().map(v => (typeof v === "string" ? v : "") + ask(v) + "/" + askEach(v)).join(" "); console.log(title + ": " + line); }
round("as made");
console.log(OnlyBase(), typeof OnlyBase.call({}), Heir.prototype instanceof OnlyBase);
Object.defineProperty(Root, Symbol.hasInstance, { value: v => v === 5, configurable: true }); round("the top function answers for itself and for all below");
delete Root[Symbol.hasInstance]; round("no longer");
Object.defineProperty(Middle, Symbol.hasInstance, { value: () => true, configurable: true }); round("the middle one says yes");
delete Middle[Symbol.hasInstance]; round("no longer");
const between = Object.create(Root, { [Symbol.hasInstance]: { value: () => false, configurable: true } }); Object.setPrototypeOf(Middle, between); round("an object between two functions says no");
delete between[Symbol.hasInstance]; round("it says nothing");
Object.setPrototypeOf(Middle, Function.prototype); round("the middle one stands alone");
Object.setPrototypeOf(Middle, Root); round("and under the top again");
Object.setPrototypeOf(Leaf, null); let thrown; try { ({}) instanceof Leaf; thrown = "no"; } catch (e) { thrown = e.constructor.name; } console.log("a function under nothing:", thrown, new (Object.setPrototypeOf(Leaf, Middle))() instanceof Leaf);
const oldPrototype = Middle.prototype; Middle.prototype = { fresh: true }; round("another prototype property");
Middle.prototype = oldPrototype; round("the old one again");
Object.setPrototypeOf(Leaf.prototype, Root.prototype); round("the chain of the values skips the middle");
Object.setPrototypeOf(Leaf.prototype, Middle.prototype); round("and has it again");
Object.defineProperty(OnlyBase, Symbol.hasInstance, { value: () => true, configurable: true }); console.log(attempt(() => OnlyBase.call(5) === undefined), 5 instanceof OnlyBase, 5 instanceof Heir); round("the base that makes nothing says yes");
delete OnlyBase[Symbol.hasInstance]; console.log(new OnlyBase().base, ask(new OnlyBase())); round("and now it has made one");

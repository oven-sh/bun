// `for (name in object)` over what constructor functions and classes make: own names, names stored later, names that are inherited, deleted, hidden or not enumerable.
const lines = [];
function say(label, value) { lines.push(label + ": " + value); }
function namesOf(object) { const names = []; for (const name in object) names.push(name); return names.join(","); }

function Node(start) { this.type = ""; this.start = start; this.end = 0; }
const plain = new Node(1);
say("born", namesOf(plain));
const grown = new Node(2);
grown.body = [1, 2];
grown["computed" + grown.start] = true;
say("grown", namesOf(grown));

Node.prototype.inherited = function () { return "inherited " + this.start; };
say("with an inherited name", namesOf(new Node(3)));
let called = "";
for (const name in new Node(4)) { const value = new Node(4)[name]; if (typeof value === "function") called += value.call({ start: name }); }
say("called", called);

Object.defineProperty(Node.prototype, "hidden", { value: 1, enumerable: false, configurable: true, writable: true });
say("a hidden name above", namesOf(new Node(5)));
const shadowing = new Node(6);
shadowing.hidden = 2;
say("an own name over a hidden one", namesOf(shadowing));
const shrunk = new Node(7);
delete shrunk.type;
say("shrunk", namesOf(shrunk));

class Base { constructor() { this.a = 1; } method() { return "method"; } get getter() { return "getter"; } static fixed = 1; }
class Derived extends Base { b = 2; constructor() { super(); this.c = 3; } other() {} }
say("class", namesOf(new Base()));
say("derived", namesOf(new Derived()));
Base.prototype.late = 4;
say("derived with a late name above", namesOf(new Derived()));

const chain = Object.create(new Derived());
chain.own = 5;
say("below an instance", namesOf(chain));

function Changing() { this.x = 1; }
const changed = new Changing();
Object.setPrototypeOf(changed, { fromAnother: 1, toString() { return "mine"; } });
say("another prototype", namesOf(changed));
let found = "";
for (const name in changed) found += typeof changed[name] + " ";
say("kinds", found);

function Numbered() { this[1] = "one"; this.z = "z"; this[0] = "zero"; }
say("indexes first", namesOf(new Numbered()));

function During() { this.first = 1; this.second = 2; this.third = 3; }
const during = new During();
const seen = [];
for (const name in during) { seen.push(name); if (name === "first") { delete during.second; during.fourth = 4; } }
say("changed on the way", seen.join(","));

class List extends Array { constructor() { super(); this.extra = 1; } }
const list = new List(); list.push(7, 8);
say("below Array", namesOf(list));
class Failure extends Error { constructor() { super("no"); this.code = 1; } }
say("below Error", namesOf(new Failure()));
console.log(lines.join("\n"));

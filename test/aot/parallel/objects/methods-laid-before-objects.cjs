// Methods that a file lays on a prototype before anything can use the function need no guard. Every other order keeps it.
const out = [];
function say(...values) { out.push(values.join(" ")); }
function attempt(label, body) { try { say(label, body()); } catch (error) { say(label, error.constructor.name); } }
const no = process.argv.length > 100;

function Node(value, next) { this.value = value; this.next = next; }
Node.prototype.get = function () { return this.value; };
Node.prototype.add = function (by) { this.value += by; return this; };
Node.prototype.toString = function () { return "Node " + this.get(); };
function sum(node, times) { let total = 0; for (let i = 0; i < times; i++) { total += node.add(1).get(); node = node.next; } return total; }
const ring = new Node(1, null); ring.next = new Node(10, ring);
say(sum(ring, 50), String(ring), String(ring.next));

// A method that is laid behind the first object.
function Early(value) { this.value = value; }
Early.prototype.first = function () { return "first " + this.value; };
const early = new Early(3);
attempt("early", () => early.second());
Early.prototype.second = function () { return "second " + this.value; };
attempt("early", () => early.second());
attempt("early", () => early.first());

// A method that only some path lays, one that is replaced, one that is deleted.
function Maybe(value) { this.value = value; }
if (no) Maybe.prototype.seldom = function () { return "seldom"; };
Maybe.prototype.twice = function () { return "one"; };
Maybe.prototype.gone = function () { return "there"; };
const maybe = new Maybe(1);
attempt("maybe", () => maybe.seldom());
attempt("maybe", () => maybe.twice());
Maybe.prototype.twice = function () { return "two"; };
attempt("maybe", () => maybe.twice());
attempt("maybe", () => maybe.gone());
delete Maybe.prototype.gone;
attempt("maybe", () => maybe.gone());

// The parent of a prototype that is set later.
function Above() { this.kind = "above"; }
function Below() { this.kind = "below"; }
Below.prototype.own = function () { return "own " + this.kind; };
attempt("below", () => new Below().shared());
Object.setPrototypeOf(Below.prototype, Above.prototype);
attempt("below", () => new Below().own());
Above.prototype.shared = function () { return "shared " + this.kind; };
attempt("below", () => new Below().shared());
attempt("above", () => new Above().shared());

// An object of its own that hides the method, and an object that is made without the function.
const hiding = new Node(5, null); hiding.get = () => "hidden";
attempt("hiding", () => hiding.get());
const made = Object.create(Node.prototype); made.value = 8;
attempt("made", () => made.add(1).get());
attempt("call", () => Node.prototype.get.call({ value: "borrowed" }));
let total = 0;
for (let i = 0; i < 200; i++) total += [ring, hiding, made][i % 3].add(1).value;
say(total);
console.log(out.join("\n"));

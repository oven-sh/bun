function Link(name) { this.name = name; this.ref = null; }
function Leaf(value) { this.value = value; }
function Word(name) { this.name = name; }
function Pair(name, parts) { this.name = name; this.parts = parts; }
function follow(value) { while (value instanceof Link && value.ref !== null) value = value.ref; return value; }
function Checker() { this.trail = []; }
Checker.prototype.bind = function (link, to) { link.ref = to; this.trail.push(link); };
Checker.prototype.undo = function (length) { while (this.trail.length > length) this.trail.pop().ref = null; };
Checker.prototype.isSame = function (one, other) {
  one = follow(one); other = follow(other);
  if (one === other) return true;
  if (one instanceof Link) { this.bind(one, other); return true; }
  if (other instanceof Link) { this.bind(other, one); return true; }
  if (one instanceof Leaf) return other instanceof Leaf && one.value === other.value;
  if (one instanceof Pair) {
    if (!(other instanceof Pair) || one.name !== other.name || one.parts.length !== other.parts.length) return false;
    for (var i = 0; i < one.parts.length; i++) if (!this.isSame(one.parts[i], other.parts[i])) return false;
    return true;
  }
  return one instanceof Word && other instanceof Word && one.name === other.name;
};
function copy(value, map) {
  if (value instanceof Link) { var link = map.get(value); if (!link) map.set(value, link = new Link(value.name)); return link; }
  if (value instanceof Pair) { var parts = new Array(value.parts.length); for (var i = 0; i < parts.length; i++) parts[i] = copy(value.parts[i], map); return new Pair(value.name, parts); }
  return value;
}
function Reader(text) { this.words = text.split(" "); this.links = {}; this.at = 0; }
Reader.prototype.next = function () {
  var word = this.words[this.at++];
  if (word >= "a") { var parts = []; while (this.words[this.at] !== ")") parts.push(this.next()); this.at++; return new Pair(word, parts); }
  return word === "?" ? this.links[word] || (this.links[word] = new Link(word)) : word < "0" ? new Word(word) : new Leaf(word);
};
function show(value) { value = follow(value); return value instanceof Pair ? value.name + "(" + value.parts.map(show) + ")" : value instanceof Link ? "_" + value.name : value instanceof Leaf ? String(value.value) : value instanceof Word ? value.name : typeof value; }
var checker = new Checker(), texts = ["f 1 g 2 ) )", "f ? g 2 ) )", "f 1 ? )", "f 1 ! )", "?", "3", "!"], out = [];
function round() {
  var row = "";
  for (var one of texts) for (var other of texts) { var left = copy(new Reader(one).next(), new Map()), right = new Reader(other).next(); row += checker.isSame(left, right) ? show(left) : "-"; checker.undo(0); }
  return row;
}
for (var turn = 0; turn < 30; turn++) out.push(round());
console.log(new Set(out).size, out[0]);
var odd = [Object.create(Pair.prototype), Object.create(Link.prototype), Object.assign(Object.create(Pair.prototype), { parts: [new Leaf("1")], name: "f" }), Object.setPrototypeOf(new Link("l"), Pair.prototype), Object.setPrototypeOf(new Pair("f", [new Leaf("1")]), Leaf.prototype), Object.freeze(new Pair("f", [])),
  new Proxy(new Pair("f", [new Leaf("1")]), { get: function (target, key) { return key === "name" ? "g" : target[key]; } }), Object.defineProperty(new Pair("f", []), "name", { get: function () { return "h"; } }), { name: "f", parts: [] }, null, undefined, 3, "text", Symbol.iterator, Pair, [], Object.setPrototypeOf(new Leaf(2), null)];
var deleted = new Pair("f", [new Leaf("1")]); delete deleted.name; odd.push(deleted);
var linked = new Link("x"); linked.ref = Object.create(Link.prototype); odd.push(linked);
function each(action) { return odd.map(function (one) { try { return String(action(one)); } catch (error) { return error.constructor.name; } }).join(" "); }
function oddRound() { var pair = new Reader("f 1 )").next(); return [each(function (one) { var same = checker.isSame(one, pair); checker.undo(0); return same; }), each(function (one) { var same = checker.isSame(pair, one); checker.undo(0); return same; }), each(function (one) { return show(copy(one, new Map())); })].join("\n"); }
function tried(action) { try { return action(); } catch (error) { return error.constructor.name; } }
console.log(oddRound());
Object.defineProperty(Pair, Symbol.hasInstance, { value: function (value) { return typeof value === "object" && value !== null && !(value instanceof Link); }, configurable: true });
console.log(tried(round), oddRound());
delete Pair[Symbol.hasInstance];
console.log(tried(round) === out[0]);
Object.setPrototypeOf(Word.prototype, Link.prototype);
console.log(tried(round), oddRound());
Object.setPrototypeOf(Word.prototype, Object.prototype);
Link.prototype = { other: 1 };
console.log(tried(round), oddRound());

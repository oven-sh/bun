// One place in the code adds a field, or a run of fields, to objects whose keys differ from call to call. The order of the keys of each object is the order in which it got them.
var unseen = new Function("x", "return x");
function Node(kind) { this.kind = kind; this.pos = 0; }
function Token(kind) { this.kind = kind; this.text = ""; }
function addOne(node, value) { node.late = value; return node; }
function addRun(node, a, b, c) { node.first = a; node.second = b; node.third = c; return node; }
function show(object) {
  var names = [];
  for (var name in object) names.push(name);
  return Object.keys(object).join(",") + " | " + names.join(",") + " | " + JSON.stringify(object);
}
function attempt(work) { try { return show(work()); } catch (error) { return error.name; } }
function plain() { return new Node(1); }
function withEarlier() { var node = new Node(2); node.earlier = 1; return node; }
function withSecond() { var node = new Node(3); node.second = "already"; return node; }
function withLate() { var node = new Node(4); node.late = "already"; node.after = 1; return node; }
function withExtra(name) { var node = new Node(5); node[unseen(name)] = "extra"; return node; }
function withDeleted() { var node = new Node(6); node.late = 1; node.first = 2; delete node.late; return node; }
function withDeletedFirstKey() { var node = new Node(7); delete node.kind; return node; }
function token() { return new Token(8); }
function frozen() { return Object.freeze(new Node(9)); }
function sealed() { return Object.seal(new Node(10)); }
function notExtensible() { return Object.preventExtensions(new Node(11)); }
function redefined() { var node = new Node(12); Object.defineProperty(node, "late", { value: "fixed", writable: false, enumerable: true, configurable: true }); return node; }
function hidden() { var node = new Node(13); Object.defineProperty(node, "second", { value: "hidden", writable: true, enumerable: false, configurable: true }); return node; }
function withAccessor() { var node = new Node(14); var kept; Object.defineProperty(node, "late", { get: function () { return kept; }, set: function (v) { kept = "set " + v; }, enumerable: true, configurable: true }); return node; }
var makers = [plain, withEarlier, withSecond, withLate, function () { return withExtra("zeta"); }, function () { return withExtra("alpha"); }, withDeleted, withDeletedFirstKey, token, frozen, sealed, notExtensible, redefined, hidden, withAccessor];
for (var round = 0; round < 4; round++) {
  for (var i = 0; i < makers.length; i++) {
    // The same maker several times in a row, then the next: the place sees each kind of object again right after it has seen it, and right after another.
    for (var again = 0; again < 3; again++) {
      console.log(round, i, again, "one", attempt(function () { return addOne(makers[i](), round); }));
      console.log(round, i, again, "run", attempt(function () { return addRun(makers[i](), 1, 2, 3); }));
      console.log(round, i, again, "both", attempt(function () { return addRun(addOne(makers[i](), round), 1, 2, 3); }));
      console.log(round, i, again, "other way", attempt(function () { return addOne(addRun(makers[i](), 1, 2, 3), round); }));
    }
  }
}
// A prototype gets a setter under the name after the place has run hot.
Object.defineProperty(unseen(Node).prototype, "late", { set: function (v) { this.viaSetter = v; }, get: function () { return "inherited"; }, configurable: true });
console.log(show(addOne(plain(), 1)), show(addOne(withEarlier(), 2)), show(addOne(token(), 3)));
delete unseen(Node).prototype.late;
console.log(show(addOne(plain(), 1)), show(addOne(withEarlier(), 2)));

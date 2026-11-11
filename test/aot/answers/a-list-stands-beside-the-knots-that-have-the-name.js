// answers: without-library
// # `var thing = flag ? knot : list; thing.beside`: a knot or a list is expected. No typed form serves a list, so none was built for the knot either, though no list has a `beside` of its own making.
// # At an access, of a set that holds layouts beside objects without one, the one layout that has the name asked is expected. What else arrives fails the test and is read by name: a list, a list with the name laid on it, a proxy, an object made below a knot, a literal, a function, a text, a number, undefined, null.
// # f1 = besideOf
// # RUN(TYPED): walk f1 mechanisms=all
// # TYPED-LABEL: code f1:Body
// # TYPED: key="beside" receivers=[L0]
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 19 of 19 of 19
// # CHECK-NEXT: exited with 0
function Knot(mark) { this.mark = mark; this.beside = null; this.weight = mark * 2; }
function besideOf(flag, knot, list) { var thing = flag ? knot : list; return thing.beside; }
function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
var first = new Knot(1), second = new Knot(2);
second.beside = first;
globalThis.seen = second;
Reflect.ownKeys(second);
for (var round = 0; round < 4; round++) report(besideOf(true, round & 1 ? second : first, [round]) === (round & 1 ? first : null));
report(String(besideOf(false, first, [1, 2])));
var marked = [4];
marked.beside = second;
report(besideOf(false, first, marked) === second);
var asked = [];
var below = Object.create(second);
var emptied = new Knot(3);
delete emptied.beside;
var parsed = JSON.parse('{"beside":7}');
var withGetter = Object.defineProperty(JSON.parse("{}"), ["be", "side"].join(""), { get: function () { asked.push("getter"); return 13; } });
var strangers = [new Proxy(second, { get: function (target, name) { asked.push(String(name)); return 11; } }), below, emptied, parsed, withGetter, function () {}, marked, "text", 5, undefined, null];
for (var which = 0; which < strangers.length; which++) { var stranger = strangers[which]; report(tell(function () { var found = besideOf(true, stranger, [0]); return found === first ? "first" : found === second ? "second" : found; })); }
report(asked.join());
report("end");

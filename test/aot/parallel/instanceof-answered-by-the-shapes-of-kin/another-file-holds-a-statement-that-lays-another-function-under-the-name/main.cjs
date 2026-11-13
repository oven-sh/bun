// Whether a function calls itself as `this.alike(..)` is read off its own defining statement: a statement in another file, which never runs, lays another function under the same name and changes nothing.
// STATISTIC: InstanceOfMissesDecidedByHierarchy >= 7
// The test in a return is none of them: the one in the condition answers it.
function Atom(name) { this.name = name; }
function Num(value) { this.value = value; }
function Struct(name, args) { this.name = name; this.args = args; }
function Machine() { this.steps = 0; }
Machine.prototype.alike = function (a, b) {
  this.steps++; log += "f";
  if (a instanceof Num) return b instanceof Num && a.value === b.value;
  if (a instanceof Struct) {
    if (!(b instanceof Struct) || a.name !== b.name || a.args.length !== b.args.length) return false;
    for (var i = 0; i < a.args.length; i++) { if (due === this.steps) { due = -1; deed(this, a, b, i); } var got = this.alike(a.args[i], b.args[i]); log += got ? "+" : "-"; if (!got) return false; }
    return a instanceof Struct;
  }
  if (a instanceof Atom) return b instanceof Atom && a.name === b.name;
  return false;
};
var words = JSON.parse('["a", 1, ["f", "b", 2, ["g", "c", 3]], ["h", "c"], 4, ["f", "b", 2, ["g", "c", 4]]]');
function read(word) {
  if (typeof word === "number") return new Num(word);
  if (typeof word === "string") return new Atom(word);
  return new Struct(word[0], word.slice(1).map(read));
}
var terms = words.map(read), twins = words.map(read), machine = new Machine(), said = [];
var first = Machine.prototype.alike, named = function (text) { return JSON.parse('"' + text + '"'); };
var log = "", due = -1, lay = Object[named("setPrototypeOf")], set = Reflect[named("set")], define = Object[named("defineProperty")], create = Object[named("create")];
var other = function (a, b) { this.steps += 100; log += "o"; return first.call(this, a, b); };
var deeds = { quiet: function () {}, done: function (self, a, b, i) {  } };
var deed = deeds[JSON.parse('["quiet"]')[0]];
require("./beside.cjs")(Machine);
for (var turn = 0; turn < 90; turn++) {
  if (turn === 40) due = 17;
  if (turn === 70) machine = { steps: 0, alike: function () { this.steps += 1000; return true; }, borrowed: first };
  var count = 0;
  for (var i = 0; i < terms.length; i++) for (var j = 0; j < twins.length; j++) if (turn < 70 ? machine.alike(terms[i], twins[j]) : machine.borrowed(terms[i], twins[j])) count++, log += "!";
  var answer = count + ":" + machine.steps + ":" + log; log = "";
  machine.steps = 0;
  if (said[said.length - 1] !== answer) { said.push(turn, answer); for (var part of (turn + ":" + answer).split(":")) console.log("SAID " + part); }
}
console.log("SAID end");

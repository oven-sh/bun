// Objects that start without keys and get them from stores: in the order of the text, in another order, from several functions, with some stores left out.
const lines = [];
function show(label, object) {
  const walked = [];
  for (const key in object) walked.push(key);
  lines.push(label + " " + Object.keys(object).join() + " | " + walked.join() + " | " + JSON.stringify(object));
}
const asWritten = {};
asWritten.zebra = 1;
asWritten.apple = "a";
asWritten.mango = true;
asWritten.berry = null;
show("as written", asWritten);

function fill(object, order) {
  for (const step of order) {
    if (step === 0) object.zebra = step;
    else if (step === 1) object.apple = step;
    else if (step === 2) object.mango = step;
    else object.berry = step;
  }
  return object;
}
for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [1, 3], [2], [], [2, 0, 2, 0, 3], [1, 0, 3, 2]]) show("by steps " + order.join(""), fill({}, order));

function first(object) { object.second = 2; }
function second(object) { object.first = 1; }
function third(object) { object.third = 3; }
for (const calls of [[first, second, third], [third, second, first], [second, first], [third]]) {
  const made = {};
  for (const call of calls) call(made);
  show("by calls", made);
}

const partly = { given: 1 };
partly.later = 2;
if (lines.length > 1000) partly.never = 3;
partly.last = 4;
show("behind a member", partly);

const removed = {};
removed.one = 1;
removed.two = 2;
delete removed.one;
removed.three = 3;
removed.one = 4;
show("with a delete", removed);

const defined = {};
defined.one = 1;
Object.defineProperty(defined, "hidden", { value: 2, enumerable: false });
defined.two = 3;
Object.defineProperty(defined, "got", { get() { return 4; }, enumerable: true });
defined.three = 5;
show("with definitions", defined);
lines.push(Object.getOwnPropertyNames(defined).join());

class Holder { constructor() { this.inside = 1; } }
const held = new Holder();
held.zulu = 1;
held.alpha = 2;
show("an instance", held);
const other = new Holder();
other.alpha = 2;
other.zulu = 1;
show("an instance the other way", other);

const indexed = {};
indexed.name = 1;
indexed[2] = "two";
indexed.again = 2;
indexed[0] = "zero";
show("with indices", indexed);
console.log(lines.join("\n"));

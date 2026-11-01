// A loop that pushes may keep the length of its list in a register. Whoever looks at the list sees the right length: behind the loop, on every way out of it, and in it.
const say = (name, ...values) => console.log(name, values.map(value => (typeof value === "object" ? JSON.stringify(value) : String(value))).join(" "));
const tail = list => list.length + ":" + list[0] + ":" + list[list.length - 1];

function integers(limit) {
  const list = [];
  for (let k = 0; k < limit; k++) list.push(k);
  return list;
}
function fractions(limit) {
  const list = [];
  for (let k = 0; k < limit; k++) list.push(k + 0.5);
  return list;
}
function texts(limit, text) {
  const list = [];
  for (let k = 0; k < limit; k++) list.push(text);
  return list;
}
function objects(limit) {
  const list = [];
  for (let k = 0; k < limit; k++) list.push({ k });
  return list;
}
for (const limit of [0, 1, 2, 7, 100, 5000]) say("counted " + limit, tail(integers(limit)), tail(fractions(limit)), tail(texts(limit, "t")), objects(limit).length);

function leftByBreakBeforeThePush(limit, stop) {
  const list = [];
  for (let k = 0; k < limit; k++) {
    if (k === stop) break;
    list.push(k);
  }
  return tail(list);
}
function leftByBreakBehindThePush(limit, stop) {
  const list = [];
  for (let k = 0; k < limit; k++) {
    list.push(k);
    if (k === stop) break;
  }
  return tail(list);
}
function leftByReturn(limit, stop) {
  const list = [];
  for (let k = 0; k < limit; k++) {
    if (k === stop) return "early " + tail(list);
    list.push(k * 2);
  }
  return "late " + tail(list);
}
for (const stop of [0, 1, 5, 99, 100, 1000]) say("left at " + stop, leftByBreakBeforeThePush(100, stop), leftByBreakBehindThePush(100, stop), leftByReturn(100, stop));

function leftByThrow(list, limit, stop) {
  for (let k = 0; k < limit; k++) {
    if (k === stop) throw new Error("at " + k + " with " + list.length);
    list.push(k);
  }
}
for (const stop of [0, 3, 64]) {
  const list = [];
  try {
    leftByThrow(list, 100, stop);
  } catch (error) {
    say("thrown", error.message, tail(list));
  }
}
function caughtInside(limit, stop) {
  const list = [];
  let seen = -1;
  try {
    for (let k = 0; k < limit; k++) {
      list.push(k);
      if (k === stop) null.x;
    }
  } catch {
    seen = list.length;
  } finally {
    seen = seen * 1000 + list.length;
  }
  return seen;
}
say("caught inside", caughtInside(50, 0), caughtInside(50, 20), caughtInside(50, 60));

function lengthReadInTheLoop(limit) {
  const list = [];
  let total = 0;
  for (let k = 0; k < limit; k++) {
    total += list.length;
    list.push(k);
    total += list.length;
  }
  return total + ":" + list.length;
}
function resultOfThePush(limit) {
  const list = [];
  let total = 0;
  for (let k = 0; k < limit; k++) total += list.push(k);
  return total + ":" + list.length;
}
say("read in the loop", lengthReadInTheLoop(0), lengthReadInTheLoop(1), lengthReadInTheLoop(333), resultOfThePush(0), resultOfThePush(333));

function moreThanWasCounted(limit) {
  const list = [];
  for (let k = 0; k < limit; k++) {
    list.push(k);
    if (k % 3 === 0) list.push(-k);
    if (k === 10) limit += 25;
  }
  return tail(list);
}
say("more than was counted", moreThanWasCounted(5), moreThanWasCounted(11), moreThanWasCounted(400));

function underTwoNames(a, b, limit) {
  let total = 0;
  for (let k = 0; k < limit; k++) {
    a.push(k);
    total += b.length;
  }
  return total;
}
function pushedUnderTwoNames(a, b, limit) {
  for (let k = 0; k < limit; k++) {
    a.push(k);
    b.push(-k);
  }
  return a.length + ":" + b.length;
}
{
  const one = [];
  say("two names", underTwoNames(one, one, 40), underTwoNames(one, [], 40), underTwoNames([], one, 40), one.length);
  const same = [];
  say("pushed under two names", pushedUnderTwoNames(same, same, 30), pushedUnderTwoNames(same, [], 30), tail(same));
}

function intoGiven(list, limit) {
  for (let k = 0; k < limit; k++) list.push(k);
  return list.length;
}
function refused(list, limit) {
  try {
    return "no error " + intoGiven(list, limit);
  } catch (error) {
    return error.constructor.name + " " + list.length;
  }
}
say("refused", refused(Object.freeze([1, 2]), 3), refused(Object.freeze([1, 2]), 0), refused(Object.seal([1]), 2), refused(Object.preventExtensions([]), 1));
{
  const fixed = [1, 2, 3];
  Object.defineProperty(fixed, "length", { writable: false });
  say("length that cannot be written", refused(fixed, 2), refused(fixed, 0), fixed.join());
}

function ontoLiteral(limit) {
  const list = [1, 2, 3];
  for (let k = 0; k < limit; k++) list.push(k);
  return list;
}
function ontoLiteralOfTexts(limit) {
  const list = ["a", "b"];
  for (let k = 0; k < limit; k++) list.push("c");
  return list;
}
for (const limit of [0, 1, 0, 9, 0]) say("onto a literal " + limit, ontoLiteral(limit).join(), ontoLiteralOfTexts(limit).join());

function anotherListInside(count) {
  let into = [];
  for (let i = 0; i < count; i++) {
    if (i === 5) into = [];
    into.push(i * 2);
  }
  return tail(into);
}
say("another list inside", anotherListInside(3), anotherListInside(9), anotherListInside(66));

function shownToAFunction(limit, show) {
  const list = [];
  let total = 0;
  for (let k = 0; k < limit; k++) {
    list.push(k);
    if (k % 16 === 15) total += show(list);
  }
  return total + ":" + list.length;
}
say("shown to a function", shownToAFunction(100, list => list.length), shownToAFunction(100, list => list.pop()), shownToAFunction(100, list => ((list.length = 2), 1)), shownToAFunction(100, list => list.push(7, 8, 9)));

function cutInTheLoop(limit) {
  const list = [];
  for (let k = 0; k < limit; k++) {
    list.push(k);
    if (k % 10 === 9) list.length = 3;
  }
  return tail(list);
}
function poppedInTheLoop(limit) {
  const list = [];
  let total = 0;
  for (let k = 0; k < limit; k++) {
    list.push(k);
    list.push(k + 1);
    total += list.pop();
  }
  return total + ":" + tail(list);
}
function storedBeyondTheEnd(limit) {
  const list = [];
  for (let k = 0; k < limit; k++) {
    list.push(k);
    if (k === 4) list[list.length + 2] = -1;
  }
  return list.length + ":" + (6 in list) + ":" + list[7];
}
say("changed in the loop", cutInTheLoop(5), cutInTheLoop(47), poppedInTheLoop(25), storedBeyondTheEnd(3), storedBeyondTheEnd(12));

function rows(height, width) {
  const all = [];
  const flat = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push(x * y);
      flat.push(x + y);
    }
    all.push(row);
  }
  return all.length + ":" + all.map(row => row.length).join() + ":" + tail(flat);
}
say("loops in loops", rows(0, 3), rows(3, 0), rows(4, 5));

function* yieldedBetween(limit) {
  const list = [];
  for (let k = 0; k < limit; k++) {
    list.push(k);
    if (k % 4 === 3) yield list.length;
  }
  return tail(list);
}
{
  const seen = [];
  const run = yieldedBetween(10);
  for (let step = run.next(); ; step = run.next()) {
    seen.push(step.value);
    if (step.done) break;
  }
  say("yielded between", seen.join());
}

class Stack extends Array {
  top() {
    return this[this.length - 1];
  }
}
function ontoSubclass(limit) {
  const list = new Stack();
  for (let k = 0; k < limit; k++) list.push(k);
  return list.length + ":" + list.top();
}
say("a subclass", ontoSubclass(0), ontoSubclass(70));

// Long enough for the loop to ask whether it should stop, and for collections while the list grows.
function sumOf(list, read) {
  let total = 0;
  for (let k = 0; k < list.length; k++) total += read(list[k]);
  return total;
}
{
  const many = integers(1_300_000);
  say("long", many.length, sumOf(many, value => value));
  const made = objects(400_000);
  say("long, of objects", made.length, sumOf(made, value => value.k));
  const named = [];
  for (let k = 0; k < 300_000; k++) named.push("n" + k);
  say("long, of texts", named.length, sumOf(named, value => value.length));
}
function movedFromAnotherList(source) {
  const list = [];
  const limit = source.length;
  for (let k = 0; k < limit; k++) {
    list.push(source[k]);
    source[k] = null;
  }
  return list;
}
{
  let total = 0;
  for (let round = 0; round < 6; round++) {
    const moved = movedFromAnotherList(objects(120_000));
    if (round % 2) Bun.gc(true);
    total += sumOf(moved, value => value.k) + moved.length;
  }
  say("moved from another list", total);
}

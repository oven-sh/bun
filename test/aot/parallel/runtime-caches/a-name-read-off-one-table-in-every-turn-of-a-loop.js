// `table.name` in a loop that does nothing else to objects, off a table that stays the same object. Between the calls, and in the middle of a loop through a getter, the table changes in every way it can.
function sumOf(table, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + table.step + (i & 1)) | 0;
  return sum;
}
// The same loop for whatever is no plain table: objects of classes, functions, lists, and what is no object.
function sumOfAny(value, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + value.pace + (i & 1)) | 0;
  return sum;
}
// And for the object that finds everything above itself.
function sumOfHeir(heir, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + heir.step + (i & 1)) | 0;
  return sum;
}
function lengthsOfHeir(heir, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += heir.text.length;
  return sum;
}
function kindsOfHeir(heir, turns) {
  let found = 0;
  let missing = 0;
  for (let i = 0; i < turns; i++) {
    if (heir.maybe === undefined) missing++;
    else found++;
  }
  return found + "/" + missing;
}
// Here what is called in every turn changes what the read finds.
function sumWhileChanged(heir, turns, change) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    change(i);
    sum = (sum + heir.level) | 0;
  }
  return sum;
}
// And for the table whose getter changes it.
function sumOfTurning(table, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + table.step + (i & 1)) | 0;
  return sum;
}
function kindsOfAny(value, turns) {
  let found = 0;
  let missing = 0;
  for (let i = 0; i < turns; i++) {
    if (value.maybe === undefined) missing++;
    else found++;
  }
  return found + "/" + missing;
}
function lengthsOf(table, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += table.text.length;
  return sum;
}
function kindsOf(table, turns) {
  let found = 0;
  let missing = 0;
  for (let i = 0; i < turns; i++) {
    if (table.maybe === undefined) missing++;
    else found++;
  }
  return found + "/" + missing;
}
function attempt(mark, run) {
  try {
    console.log(mark + ":", run());
  } catch (error) {
    console.log(mark + ":", error.constructor.name);
  }
}
// The text is put together when the program runs, so nobody knows ahead of time what the tables look like.
const quote = String.fromCharCode(Date.now() > 0 ? 34 : 39);
function parsed(text) {
  return JSON.parse(text.split("'").join(quote));
}

const plain = parsed("{'step': 2, 'text': 'four', 'maybe': 1}");
for (let i = 0; i < 200; i++) sumOf(plain, 10), lengthsOf(plain, 10), kindsOf(plain, 10);
attempt("own value", () => sumOf(plain, 1000));
attempt("own text", () => lengthsOf(plain, 1000));
attempt("own, is there", () => kindsOf(plain, 1000));
attempt("no turn", () => sumOf(plain, 0));

plain.step = 5;
attempt("another value in the same place", () => sumOf(plain, 1000));
plain.step = 1.5;
attempt("a fraction", () => sumOf(plain, 1000));
plain.step = "7";
attempt("a string", () => sumOf(plain, 3));
plain.step = 2;

delete plain.maybe;
attempt("deleted", () => kindsOf(plain, 1000));
for (let i = 0; i < 200; i++) kindsOf(plain, 10);
attempt("still deleted", () => kindsOf(plain, 1000));
const farAbove = {};
Object.setPrototypeOf(plain, Object.create(Object.create(farAbove)));
attempt("under a longer chain", () => kindsOf(plain, 1000));
for (let i = 0; i < 200; i++) kindsOf(plain, 10);
farAbove.maybe = 3;
attempt("found far above", () => kindsOf(plain, 1000));
delete farAbove.maybe;
attempt("gone again", () => kindsOf(plain, 1000));
plain.maybe = null;
attempt("back as null", () => kindsOf(plain, 1000));

const above = { step: 3, text: "ab", maybe: undefined };
const heir = Object.create(above);
for (let i = 0; i < 200; i++) sumOfHeir(heir, 10), lengthsOfHeir(heir, 10), kindsOfHeir(heir, 10);
attempt("inherited", () => sumOfHeir(heir, 1000));
attempt("inherited text", () => lengthsOfHeir(heir, 1000));
attempt("inherited undefined", () => kindsOfHeir(heir, 1000));
above.step = 4;
attempt("changed above", () => sumOfHeir(heir, 1000));
above.text = "abcdef";
attempt("text changed above", () => lengthsOfHeir(heir, 1000));
above.step = 2.25;
attempt("a fraction above", () => sumOfHeir(heir, 1000));
above.step = { valueOf() { return 6; } };
attempt("an object above", () => sumOfHeir(heir, 1000));
const nameOfStep = "step" + (Date.now() > 0 ? "" : "s");
heir[nameOfStep] = 9;
attempt("hidden by an own one", () => sumOfHeir(heir, 1000));
delete heir[nameOfStep];
above.step = 4;
attempt("seen again", () => sumOfHeir(heir, 1000));
Object.setPrototypeOf(heir, { step: 11, text: "x", maybe: 0 });
attempt("another prototype", () => sumOfHeir(heir, 1000));
attempt("another prototype, text", () => lengthsOfHeir(heir, 1000));
attempt("another prototype, is there", () => kindsOfHeir(heir, 1000));
Object.setPrototypeOf(heir, null);
attempt("no prototype", () => sumOfHeir(heir, 3));
attempt("no prototype, text", () => lengthsOfHeir(heir, 3));

const changing = { level: 0 };
const nameOfLevel = "level" + (Date.now() > 0 ? "" : "s");
const heirOfChanging = Object.create(changing);
for (let i = 0; i < 200; i++) sumWhileChanged(heirOfChanging, 10, () => {});
attempt("left alone by the call", () => sumWhileChanged(heirOfChanging, 1000, () => {}));
attempt("changed above by the call", () => sumWhileChanged(heirOfChanging, 1000, i => { changing.level = i & 3; }));
attempt("hidden by the call", () => sumWhileChanged(heirOfChanging, 1000, i => { if (i === 500) heirOfChanging[nameOfLevel] = 7; }));
attempt("uncovered by the call", () => sumWhileChanged(heirOfChanging, 1000, i => { if (i === 500) delete heirOfChanging[nameOfLevel]; }));

// The getter runs in the middle of the loop and changes what the turns behind it find.
const turning = parsed("{'other': 0, 'step': 1}");
for (let i = 0; i < 200; i++) sumOfTurning(turning, 10);
attempt("before it has a getter", () => sumOfTurning(turning, 10));
let calls = 0;
Object.defineProperty(turning, "step", {
  configurable: true,
  get() {
    calls++;
    if (calls === 5) Object.defineProperty(turning, "step", { value: 100, writable: true, configurable: true });
    return 1;
  },
});
attempt("a getter that becomes a value", () => sumOfTurning(turning, 10) + " after " + calls);
attempt("the value it became", () => sumOfTurning(turning, 10) + " after " + calls);
for (let i = 0; i < 200; i++) sumOfTurning(turning, 10);
let reads = 0;
Object.defineProperty(turning, "step", {
  configurable: true,
  get() {
    return ++reads;
  },
});
attempt("a value that becomes a getter", () => sumOfTurning(turning, 10) + " after " + reads);

const counted = { count: 0 };
const watched = new Proxy(parsed("{'pace': 1}"), {
  get(target, key) {
    counted.count++;
    return target[key];
  },
});
attempt("a proxy", () => sumOfAny(watched, 50) + " after " + counted.count);

// One site, many kinds of table, one after the other and in turns.
const shapes = [
  parsed("{'pace': 1}"),
  parsed("{'a': 0, 'pace': 2}"),
  parsed("{'a': 0, 'b': 0, 'pace': 3}"),
  Object.create({ pace: 4 }),
  Object.assign(Object.create(null), { pace: 5 }),
  Object.assign(() => {}, { pace: 6 }),
  Object.assign([], { pace: 7 }),
  new (class { pace = 8; })(),
  new (class { get pace() { return 9; } })(),
];
const many = {};
for (let i = 0; i < 40; i++) many["k" + i] = i;
many.pace = 10;
shapes.push(many);
for (let round = 0; round < 3; round++) attempt("shapes " + round, () => shapes.map(shape => sumOfAny(shape, 100)).join());

attempt("null", () => sumOf(null, 3));
attempt("undefined", () => sumOf(undefined, 3));
attempt("null, no turn", () => sumOf(null, 0));
attempt("a number", () => sumOfAny(5, 3));
attempt("a string", () => lengthsOf("abc", 3));
attempt("a string, many turns", () => kindsOfAny("abc", 1000));
attempt("a big integer", () => kindsOfAny(5n, 1000));
attempt("a symbol", () => sumOfAny(Symbol.iterator, 3));

Object.freeze(plain);
attempt("frozen", () => sumOf(plain, 1000));

// A turn now and then runs other code, which changes what the turns behind it find. The read stands in front of that code, so its own turn still has the old value.
function weigh(table, list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += table.step * list[i];
  return sum;
}
function lastSeen(table, list) {
  let last = -1;
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    last = table.step;
    sum += list[i] * 2;
  }
  return last + " " + sum;
}
const weighed = parsed("{'step': 2}");
const numbers = [];
for (let i = 0; i < 100; i++) numbers.push(i & 7);
for (let i = 0; i < 200; i++) weigh(weighed, numbers), lastSeen(weighed, numbers);
attempt("only numbers", () => weigh(weighed, numbers));
attempt("only numbers, the last one seen", () => lastSeen(weighed, numbers));
function withOneObject(at, act) {
  const list = numbers.slice();
  list[at] = { valueOf() { act(); return 1; } };
  return list;
}
attempt("stored to half way", () => weigh(weighed, withOneObject(50, () => { weighed.step = 1000; })));
weighed.step = 2;
attempt("stored to in the first turn", () => weigh(weighed, withOneObject(0, () => { weighed.step = 1000; })));
weighed.step = 2;
attempt("stored to in the last turn", () => weigh(weighed, withOneObject(99, () => { weighed.step = 1000; })) + " " + weighed.step);
weighed.step = 2;
attempt("deleted half way", () => weigh(weighed, withOneObject(50, () => { delete weighed.step; })));
weighed.step = 2;
attempt("given a getter half way", () => weigh(weighed, withOneObject(50, () => { Object.defineProperty(weighed, "step", { get() { return 3; }, configurable: true }); })));
delete weighed.step;
weighed.step = 2;
attempt("the last one seen, stored to half way", () => lastSeen(weighed, withOneObject(50, () => { weighed.step = 77; })));
weighed.step = 2;
attempt("the last one seen, stored to in the last turn", () => lastSeen(weighed, withOneObject(99, () => { weighed.step = 77; })));
weighed.step = 2;
attempt("the last one seen, no turn", () => lastSeen(weighed, []));
attempt("thrown out of half way", () => weigh(weighed, withOneObject(50, () => { throw new RangeError("stop"); })));
attempt("as before", () => weigh(weighed, numbers));

// One name read at several places of a turn, and two names off one table.
function twice(table, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + table.step + table.step * 2 + table.width) | 0;
  return sum;
}
const wide = parsed("{'step': 1, 'width': 10}");
attempt("two names, the first loop of all", () => twice(wide, 100000));
wide.width = 20;
attempt("two names, one stored to", () => twice(wide, 1000));
delete wide.width;
attempt("two names, one gone", () => twice(wide, 3));

// A table in a table: what the outer one holds is the same in every turn too.
function inner(holder, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + holder.table.step) | 0;
  return sum;
}
const holder = parsed("{'table': {'step': 4}}");
attempt("a table in a table", () => inner(holder, 1000));
holder.table = parsed("{'other': 0, 'step': 5}");
attempt("another table in the table", () => inner(holder, 1000));
holder.table = null;
attempt("no table in the table", () => inner(holder, 3));
attempt("no table in the table, no turn", () => inner(holder, 0));

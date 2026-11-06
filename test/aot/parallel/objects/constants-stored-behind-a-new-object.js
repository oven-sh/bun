// `const E = {}; E.A = 0; E.B = 1;`: a read of E.A is 0 only where nothing can come between the birth of the object and the store.
const lines = [];
const say = (...values) => lines.push(values.map(value => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value))).join(" "));

// Plain.
const Plain = {};
Plain.A = 0;
Plain.B = 1;
Plain.C = "c";
Plain.D = true;
Plain.E = null;
Plain.F = undefined;
Plain.G = -0;
Plain.H = NaN;
Plain.I = 1.5;
Plain.J = 10n;
function readPlain() {
  say(Plain.A, Plain.B, Plain.C, Plain.D, Plain.E, Plain.F, Plain.G, Plain.H, Plain.I, Plain.J);
}
readPlain();
function pick(x) {
  switch (x) {
    case Plain.A: return "A";
    case Plain.B: return "B";
    case Plain.C: return "C";
    case Plain.I: return "I";
    default: return "none";
  }
}
say(pick(0), pick(1), pick("c"), pick(1.5), pick(2), pick(-0), pick("0"));

// With the numbers mapped back to the names.
const Both = {};
Both[Both["Up"] = 0] = "Up";
Both[Both["Down"] = 1] = "Down";
Both[Both["Left"] = 2] = "Left";
function readBoth(n) {
  say(Both.Up, Both.Down, Both.Left, Both[n], Both[Both.Left], Object.keys(Both).join());
}
readBoth(1);

// A read between the stores sees what is there.
const Early = {};
Early.a = 1;
Early.b = Early.c;
Early.c = 2;
say(Early.a, Early.b, Early.c);

// A function that runs between the stores sees what is there, and later the rest.
const Peeked = {};
function peek() {
  return Peeked.first + "|" + Peeked.second;
}
Peeked.first = 1;
say(peek());
Peeked.second = 2;
say(peek());

// A getter in a key runs between the stores.
const Keyed = {};
const key = { toString() { say("key", Keyed.x, Keyed.y); return "z"; } };
Keyed.x = 1;
Keyed[key] = 3;
Keyed.y = 2;
function readKeyed() {
  say(Keyed.x, Keyed.y, Keyed.z);
}
readKeyed();

// A computed key that names a member.
const name = ["m", "n"][lines.length % 2 === 7 ? 0 : 1];
const Named = {};
Named.m = 1;
Named[name] = 5;
Named.n = 2;
Named[name] = 6;
function readNamed() {
  say(Named.m, Named.n);
}
readNamed();

// Keys that are numbers and no indexes.
const Odd = {};
Odd.a = 1;
Odd[-1] = "minus";
Odd[1.5] = "half";
Odd[4294967295] = "large";
Odd.b = 2;
function readOdd() {
  say(Odd.a, Odd.b, Odd[-1], Odd[1.5], Odd[4294967295], Object.keys(Odd).join());
}
readOdd();

// Stored again later, by a function.
const Again = {};
Again.n = 1;
Again.m = 2;
function readAgain() {
  return Again.n + "," + Again.m;
}
function bump() {
  Again.n = 7;
}
say(readAgain());
bump();
say(readAgain());

// Stored twice in a row.
const Twice = {};
Twice.v = 1;
Twice.v = 2;
function readTwice() {
  say(Twice.v);
}
readTwice();

// Stored again under a condition.
const Maybe = {};
Maybe.v = 1;
if (lines.length > 3) Maybe.v = 3;
function readMaybe() {
  say(Maybe.v);
}
readMaybe();

// A throw halfway.
const Half = {};
function fail() {
  throw new Error("halfway");
}
function readHalf() {
  say(Half.one, Half.two);
}
try {
  Half.one = 1;
  fail();
  Half.two = 2;
} catch (error) {
  say(error.message);
}
readHalf();

// Deleted, redefined, frozen.
const Deleted = {};
Deleted.a = 1;
Deleted.b = 2;
function readDeleted() {
  say(Deleted.a, Deleted.b, "a" in Deleted);
}
readDeleted();
delete Deleted.a;
readDeleted();

const Redefined = {};
Redefined.a = 1;
function readRedefined() {
  say(Redefined.a);
}
readRedefined();
Object.defineProperty(Redefined, "a", { get() { return "got"; } });
readRedefined();

const Frozen = {};
Frozen.a = 1;
Object.freeze(Frozen);
try {
  Frozen.a = 2;
} catch (error) {
  say(error.constructor.name);
}
function readFrozen() {
  say(Frozen.a, Object.isFrozen(Frozen));
}
readFrozen();

// Made again and again, alike and not alike.
function makeAlike(x) {
  const made = {};
  made.kind = 7;
  made.x = x;
  return made;
}
function makeEither(flag) {
  const made = {};
  if (flag) made.tag = 1;
  else made.tag = 2;
  return made;
}
function readMade(list) {
  say(list.map(made => made.kind + ":" + made.x).join());
}
readMade([makeAlike(1), makeAlike(2)]);
say(makeEither(true).tag, makeEither(false).tag);

// A literal with some members, the rest behind it.
const Mixed = { a: 1 };
Mixed.b = 2;
Mixed.a = 3;
function readMixed() {
  const { a, b } = Mixed;
  say(a, b, JSON.stringify(Mixed), JSON.stringify({ ...Mixed }), JSON.stringify(Object.assign({}, Mixed)));
}
readMixed();

// The object is seen through another variable between the stores.
var alias;
const Seen = (alias = {});
Seen.a = 1;
const before = alias.b;
Seen.b = 2;
function readSeen() {
  say(before, Seen.a, Seen.b, alias.b);
}
readSeen();

// In a function that runs once, as bundlers wrap files.
const wrapped = (() => {
  const Inner = {};
  Inner.X = 10;
  Inner.Y = 20;
  return function (v) {
    switch (v) {
      case Inner.X: return "X";
      case Inner.Y: return "Y";
    }
    return "neither";
  };
})();
say(wrapped(10), wrapped(20), wrapped(30));

console.log(lines.join("\n"));

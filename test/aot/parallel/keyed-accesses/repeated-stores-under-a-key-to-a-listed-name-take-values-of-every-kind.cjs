// `holder[key] = value`, over and over, where a literal or a class lists the name: the values are now of the kind that the program stores by name and now of another.
const hide = value => new CustomEvent("hidden", { detail: value }).detail;
function write(base, key, value) {
  base[key] = value;
}
class Strict {
  static write(base, key, value) {
    base[key] = value;
  }
}
const strictWrite = Strict.write;
function attempt(store, base, key, value) {
  try {
    store(base, key, value);
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
}

class Point {
  constructor(x) {
    this.x = x;
    this.y = x + 1;
  }
  sum() {
    return this.x + this.y;
  }
}
class Pair {
  constructor(x) {
    this.left = "left " + x;
    this.x = "x " + x;
  }
  sum() {
    return this.left + this.x;
  }
}
class Far extends Point {
  constructor(x) {
    super(x);
    this.z = x + 2;
  }
  sum() {
    return super.sum() + this.z;
  }
}
function first() {
  return "first";
}
function second() {
  return "second";
}
const counting = start => () => "counted " + start++;
const naming = name => () => "named " + name;

class Holder {
  constructor() {
    this.other = 1;
    this.kept = new Point(1);
    this.run = first;
  }
}
class Wide {
  constructor() {
    for (let i = 0; i < 3; i++) this.other = i;
    this.a0 = 0;
    this.a1 = 1;
    this.a2 = 2;
    this.a3 = 3;
    this.a4 = 4;
    this.a5 = 5;
    this.a6 = 6;
    this.a7 = 7;
    this.b0 = "0";
    this.b1 = "1";
    this.b2 = "2";
    this.b3 = "3";
    this.b4 = "4";
    this.b5 = "5";
    this.b6 = "6";
    this.b7 = "7";
    this.kept = new Point(1);
    this.run = first;
  }
}
class Sometimes {
  constructor(has) {
    this.other = 1;
    if (has) this.kept = new Point(1);
    this.run = first;
  }
}
const makers = {
  literal: () => ({ other: 1, kept: new Point(1), run: first }),
  instance: () => new Holder(),
  "instance with many fields": () => new Wide(),
  "literal with a function that holds a count": () => ({ other: 1, kept: new Point(1), run: counting(100) }),
};
// What the program reads by name, as it reads it where it knows the kinds.
const text = value => (typeof value === "function" ? "function " + value.name : typeof value + " " + String(value));
function run(holder) {
  try {
    return holder.run();
  } catch (error) {
    return error.constructor.name;
  }
}
function sum(holder) {
  try {
    return holder.kept.x + " " + holder.kept.sum();
  } catch (error) {
    return error.constructor.name;
  }
}
function describe(holder) {
  const kept = holder.kept;
  return [
    kept instanceof Point || kept instanceof Pair ? kept.constructor.name : text(kept),
    sum(holder),
    run(holder),
    holder.other,
  ].join(" | ");
}

const unread = process.env.NAME_OF_NO_VARIABLE;
const no = Boolean(unread);
const keptKey = unread || "kept";
const keptJoined = ["ke", "pt"].join("");
const runKey = unread || "run";

const values = {
  "a point": i => new Point(i),
  "a hidden point": i => hide(new Point(i)),
  "a pair": i => hide(new Pair(i)),
  "a point of a class below": i => hide(new Far(i)),
  "an object of no class": i => hide({ x: i, sum: () => "own sum" }),
  "an object that a text held": i => JSON.parse('{"x":' + i + "}"),
  "a list": i => hide([i, i + 1]),
  "a text": i => hide("text " + i),
  "a written text": () => hide("written"),
  "a number": i => hide(i),
  "a fraction": i => hide(i + 0.5),
  "a large integer": i => hide(BigInt(i)),
  "a symbol": () => hide(Symbol.for("stored")),
  true: () => hide(true),
  undefined: () => undefined,
  null: () => hide(null),
  first: () => first,
  second: () => hide(second),
  "a function that holds a count": i => hide(counting(i)),
  "a function that holds a name": i => hide(naming("name " + i)),
  "a bound function": () => hide(second.bind(null)),
  "a class": () => hide(Pair),
  "a function of the engine": () => hide(Math.max),
};

for (const [name, make] of Object.entries(makers)) {
  const say = (...parts) => console.log(name + ":", ...parts);
  // Sixty stores of one kind into one holder, so that whatever is remembered about the key is about that kind.
  const warm = (store, key, kind) => {
    const holder = make();
    for (let i = 0; i < 60; i++) store(holder, key, values[kind](i));
    return holder;
  };

  for (const store of [write, strictWrite]) {
    for (const key of [keptKey, runKey]) {
      for (const usual of key === keptKey
        ? ["a point", "a hidden point", "a pair", "a list", "a text"]
        : ["first", "second", "a function that holds a count"]) {
        say("sixty times", usual, "under", key, "|", describe(warm(store, key, usual)));
        for (const kind of Object.keys(values)) {
          warm(store, key, usual);
          const fresh = make();
          store(fresh, key, values[kind](7));
          const once = describe(fresh);
          store(fresh, key, values[usual](8));
          store(fresh, key, values[usual](9));
          say(" ", usual, "then", kind, "|", once, "| and back |", describe(fresh));
        }
      }
    }
  }

  let holder = make();
  const seen = [];
  for (let i = 0; i < 40; i++) {
    write(holder, keptKey, i & 1 ? new Point(i) : hide(new Pair(i)));
    write(holder, runKey, i & 2 ? first : hide(second));
    if (i > 35) seen.push(describe(holder));
  }
  say("in turns", seen.join(" / "));

  const one = make();
  const other = make();
  for (let i = 0; i < 60; i++) {
    write(one, keptKey, new Point(i));
    write(other, keptJoined, new Point(-i));
  }
  say("each its own", describe(one), "/", describe(other));

  let kept = 0;
  holder = make();
  for (let round = 0; round < 10; round++) {
    for (let i = 0; i < 300; i++) write(holder, keptKey, new Point(round * 1000 + i));
    Bun.gc(round & 1 ? true : false);
    const garbage = [];
    for (let i = 0; i < 1500; i++) garbage.push({ i, text: "garbage " + i });
    if (holder.kept.x === round * 1000 + 299 && holder.kept.sum() === 2 * (round * 1000 + 299) + 1) kept++;
  }
  say("new points across collections", kept);

  for (const limit of ["preventExtensions", "seal", "freeze"]) {
    warm(write, keptKey, "a point");
    warm(strictWrite, keptKey, "a point");
    holder = Object[limit](make());
    say(
      limit,
      attempt(write, holder, keptKey, new Point(5)),
      attempt(strictWrite, holder, keptKey, new Point(6)),
      describe(holder),
      "|",
      describe(warm(write, keptKey, "a point")),
    );
  }

  warm(write, keptKey, "a point");
  holder = make();
  Object.defineProperty(holder, keptKey, { writable: false });
  say(
    "read-only",
    attempt(write, holder, keptKey, new Point(5)),
    attempt(strictWrite, holder, keptKey, new Point(6)),
    describe(holder),
  );
  Object.defineProperty(holder, keptKey, { writable: true });
  say("writable again", attempt(write, holder, keptKey, new Point(5)), describe(holder));

  warm(write, keptKey, "a point");
  holder = make();
  const heard = [];
  Object.defineProperty(holder, keptKey, {
    get: () => "from the getter",
    set: value => void heard.push(value.x),
    configurable: true,
  });
  for (let i = 0; i < 3; i++) write(holder, keptKey, new Point(i));
  say("an accessor", heard.join(), describe(holder));
  Object.defineProperty(holder, keptKey, {
    value: new Point(40),
    writable: true,
    configurable: true,
    enumerable: true,
  });
  for (let i = 0; i < 60; i++) write(holder, keptKey, new Point(i));
  say("data again", describe(holder), Object.keys(holder).length);

  warm(write, keptKey, "a point");
  holder = make();
  say("deleted", delete holder[keptKey], keptKey in holder, describe(holder));
  for (let i = 0; i < 60; i++) write(holder, keptKey, new Point(i));
  say("stored again", describe(holder), Object.keys(holder).at(-1));

  warm(write, keptKey, "a point");
  const below = Object.create(make());
  write(below, keptKey, new Point(70));
  say("an object below", Object.hasOwn(below, keptKey), describe(below), "|", describe(Object.getPrototypeOf(below)));
}

// One class, whose instances have the name from their birth or get it later.
for (const store of [write, strictWrite]) {
  const has = new Sometimes(!no);
  for (let i = 0; i < 60; i++) store(has, keptKey, new Point(i));
  const lacks = new Sometimes(no);
  console.log("lacks the name:", keptKey in lacks, Object.keys(lacks).join());
  store(lacks, keptKey, new Point(7));
  console.log(
    "has got it:",
    keptKey in lacks,
    Object.keys(lacks).join(),
    describe(lacks),
    "|",
    Object.keys(has).join(),
    describe(has),
  );
  for (let i = 0; i < 60; i++) store(lacks, keptKey, new Point(i));
  console.log("and keeps it:", Object.keys(lacks).join(), describe(lacks), JSON.stringify(lacks));
}

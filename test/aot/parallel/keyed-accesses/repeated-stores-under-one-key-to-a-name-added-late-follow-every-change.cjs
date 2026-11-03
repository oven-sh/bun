// `holder[key] = value`, over and over, where the name was added to a literal or an instance behind its back.
class Holder {
  constructor(other) {
    this.other = other;
    this.count = 0;
  }
}
function write(base, key, value) {
  base[key] = value;
}
class Strict {
  static write(base, key, value) {
    base[key] = value;
  }
}
const strictWrite = Strict.write;
function repeatStrictly(base, key, rounds = 60) {
  for (let i = 0; i < rounds; i++) strictWrite(base, key, i);
  return base[key];
}
function repeat(base, key, rounds = 60) {
  for (let i = 0; i < rounds; i++) write(base, key, i);
  return base[key];
}
function attempt(store, base, key, value) {
  try {
    store(base, key, value);
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
}
const makers = {
  literal: () => ({ other: 1 }),
  instance: () => new Holder(1),
  "field that takes another kind of value": () => {
    const holder = new Holder(1);
    holder.count = { no: "number" };
    return holder;
  },
};

const key = process.env.NAME_OF_NO_VARIABLE || "keptHere";
const sameText = ["ke", "ptHere"].join("");
const otherKey = process.env.NAME_OF_NO_VARIABLE || "keptThere";
const countKey = ["co", "unt"].join("");
const symbol = Symbol("kept");

for (const [name, make] of Object.entries(makers)) {
  const say = (...values) => console.log(name + ":", ...values);

  let holder = make();
  say("filled", repeat(holder, key), repeat(holder, sameText), repeat(holder, symbol), holder[key], holder[symbol]);
  say("in strict code", repeatStrictly(holder, key), repeatStrictly(holder, symbol), holder[key]);
  say("the field beside it", repeat(holder, countKey), holder.count, holder.other, Object.keys(holder).join());

  const twin = make();
  say("a twin has none", twin[key], key in twin, repeat(twin, key, 3), holder[key], twin[key]);
  for (let i = 0; i < 60; i++) {
    write(holder, key, i);
    write(twin, key, -i);
  }
  say("each its own", holder[key], twin[key]);

  for (let i = 0; i < 60; i++) {
    write(holder, key, i);
    write(holder, otherKey, i * 2);
  }
  say("two names in turns", holder[key], holder[otherKey], Object.keys(holder).join());

  let kept = 0;
  for (let round = 0; round < 12; round++) {
    for (let i = 0; i < 300; i++) write(holder, key, { round, i, filler: [round, i, "text " + i] });
    Bun.gc(round & 1 ? true : false);
    const garbage = [];
    for (let i = 0; i < 1500; i++) garbage.push({ i, text: "garbage " + i });
    const value = holder[key];
    if (value.round === round && value.i === 299 && value.filler[2] === "text 299") kept++;
  }
  say("new objects across collections", kept);

  holder = make();
  repeat(holder, key);
  Object.defineProperty(holder, key, { writable: false });
  say("read-only", attempt(write, holder, key, "no"), attempt(strictWrite, holder, key, "no"), holder[key]);
  Object.defineProperty(holder, key, { writable: true });
  say("writable again", repeat(holder, key), holder[key]);

  let heard = [];
  Object.defineProperty(holder, key, {
    get: () => "from the getter",
    set: value => void heard.push(value),
    configurable: true,
  });
  say("an accessor", repeat(holder, key, 3), heard.join());
  Object.defineProperty(holder, key, { value: "data again", writable: true, configurable: true, enumerable: true });
  say("data again", holder[key], repeat(holder, key), holder[key]);

  say("deleted", delete holder[key], key in holder, holder[key]);
  say("added again", repeat(holder, key), Object.keys(holder).join());
  delete holder[otherKey];
  write(holder, "before", 1);
  delete holder[key];
  write(holder, "between", 2);
  say("added behind others", repeat(holder, key), holder.before, holder.between, Object.keys(holder).join());

  holder = make();
  repeat(holder, key);
  Object.preventExtensions(holder);
  say("not extensible", repeat(holder, key), attempt(strictWrite, holder, otherKey, 1), otherKey in holder);
  Object.seal(holder);
  say("sealed", repeat(holder, key), attempt(strictWrite, holder, key, "yes"), holder[key]);
  Object.freeze(holder);
  say("frozen", attempt(write, holder, key, "no"), attempt(strictWrite, holder, key, "no"), holder[key]);
  const free = make();
  say("another is not frozen", repeat(free, key), attempt(strictWrite, free, key, "yes"), free[key]);

  holder = make();
  repeat(holder, key);
  heard = [];
  const above = Object.create(Object.getPrototypeOf(holder), {
    [key]: { set: value => void heard.push(value), configurable: true },
  });
  Object.setPrototypeOf(holder, above);
  say("its own under a setter above", repeat(holder, key), heard.length);
  delete holder[key];
  say("the setter above", repeat(holder, key, 3), heard.join(), Object.hasOwn(holder, key));

  const below = Object.create(make());
  repeat(Object.getPrototypeOf(below), key);
  say("an object below", repeat(below, key), Object.hasOwn(below, key), Object.getPrototypeOf(below)[key]);

  holder = make();
  for (let i = 0; i < 40; i++) write(holder, "name" + i, i);
  let sum = 0;
  for (let round = 0; round < 5; round++) for (let i = 0; i < 40; i++) write(holder, "name" + i, i + round);
  for (let i = 0; i < 40; i++) sum += holder["name" + i];
  say("forty names", sum, Object.keys(holder).length);
}

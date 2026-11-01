// object[head + tail]: what is found under a key that was just joined from two parts is remembered by the parts and by the shape of the object.
// Every read here is repeated, so that the later ones find what the first ones remembered, and then the object or something above it changes.
const never = process.argv.length > 1000;
const unknown = new Function("value", "return value;" + (never ? " " : ""));
const text = (...codes) => unknown(String.fromCharCode(...codes));
const log = [];
const show = value =>
  typeof value === "function"
    ? "function " + value.name
    : typeof value === "bigint"
      ? value + "n"
      : Object.is(value, -0)
        ? "-0"
        : typeof value === "object" && value
          ? JSON.stringify(value)
          : String(value);

// The object is anything.
function read(object, head, tail) {
  let seen = [];
  for (let i = 0; i < 5; i++) seen.push(object[head + tail]);
  for (const each of seen) if (!Object.is(each, seen[0])) return "DIFFERENT ANSWERS " + seen.map(show).join();
  return seen[0];
}
// The object is an object.
function readOfRecord(record, head, tail) {
  let last;
  for (let i = 0; i < 5; i++) last = record[`${head}${tail}`];
  return last;
}
function note(label, ...values) {
  log.push(label + ": " + values.map(show).join(" "));
}

const on = text(111, 110);
const tails = [text(65), text(66), text(67), text(68), text(69), text(70), text(71), text(72), text(73)];

// Fields of a literal, each kept in its own way.
{
  const record = {
    onA: 1,
    onB: 1.5,
    onC: "text",
    onD: true,
    onE: null,
    onF: undefined,
    onG: { inner: 1 },
    onH: -0,
    onI: 2 ** 40,
  };
  note("fields", ...tails.map(tail => readOfRecord(record, on, tail)));
  note("fields of anything", ...tails.map(tail => read(record, on, tail)));
  // A field takes a value of another kind.
  record.onA = "now a text";
  record.onB = 7;
  record.onC = 0.25;
  record.onD = { now: "an object" };
  record.onE = 12n;
  record.onF = false;
  record.onG = NaN;
  note("fields stored to", ...tails.map(tail => readOfRecord(record, on, tail)));
  record.onA = undefined;
  record.onG = 2147483648;
  note("fields stored to again", ...tails.map(tail => read(record, on, tail)));
  delete record.onB;
  note("a field removed", ...tails.map(tail => readOfRecord(record, on, tail)));
  record.onB = "back";
  note("a field put back", ...tails.map(tail => readOfRecord(record, on, tail)));
  Object.defineProperty(record, "onC", {
    get() {
      return "from a getter";
    },
    configurable: true,
  });
  note("a field made a getter", ...tails.map(tail => readOfRecord(record, on, tail)));
  Object.defineProperty(record, "onC", { value: "a value again" });
  note("a getter made a field", ...tails.map(tail => read(record, on, tail)));
  Object.freeze(record);
  note("frozen", ...tails.map(tail => read(record, on, tail)));
}

// One pair, objects of several shapes in turns.
{
  const shapes = [
    { onA: 1 },
    { other: 0, onA: 2 },
    { onA: "three", other: 0 },
    { other: 0 },
    Object.assign(Object.create(null), { onA: 5 }),
    new (class {
      onA = 6;
    })(),
    [7],
    new Map(),
  ];
  const seen = [];
  for (let round = 0; round < 6; round++) for (const shape of shapes) seen.push(shape[on + tails[0]]);
  note("shapes in turns", ...seen);
}

// Objects that are filled by key.
{
  const filled = {};
  const bare = Object.create(null);
  for (let i = 0; i < 40; i++) {
    filled[on + i] = i;
    bare["k" + i] = -i;
  }
  let sum = 0;
  for (let round = 0; round < 4; round++)
    for (let i = 0; i < 44; i++) sum += (filled[on + i] ?? 1000) + (bare["k" + i] ?? 100000);
  note("filled by key", sum);
  for (let i = 0; i < 40; i += 3) {
    delete filled[on + i];
    delete bare["k" + i];
  }
  sum = 0;
  for (let round = 0; round < 4; round++)
    for (let i = 0; i < 44; i++) sum += (filled[on + i] ?? 1000) + (bare["k" + i] ?? 100000);
  note("some removed", sum);
  for (let i = 0; i < 40; i += 3) {
    bare["k" + i] = 1;
    filled[on + i] = 2;
  }
  sum = 0;
  for (let round = 0; round < 4; round++)
    for (let i = 0; i < 44; i++) sum += (filled[on + i] ?? 1000) + (bare["k" + i] ?? 100000);
  note("put back in another order", sum);
  // A literal that gets more names than it was written with.
  const grown = { onA: 1 };
  note("before it grows", read(grown, on, tails[1]), read(grown, on, tails[0]));
  grown[on + tails[1]] = "added";
  grown[on + tails[2]] = "added too";
  note(
    "grown",
    read(grown, on, tails[0]),
    read(grown, on, tails[1]),
    read(grown, on, tails[2]),
    read(grown, on, tails[3]),
  );
  delete grown.onB;
  note("shrunk", read(grown, on, tails[0]), read(grown, on, tails[1]), read(grown, on, tails[2]));
}

// Nothing is found, and then something is.
{
  class Base {}
  class Derived extends Base {
    own = 1;
  }
  const object = new Derived();
  const literal = { own: 1 };
  note("absent", read(object, on, tails[0]), readOfRecord(literal, on, tails[0]));
  Base.prototype.onA = "on the class above";
  note("found two above", read(object, on, tails[0]), readOfRecord(literal, on, tails[0]));
  Derived.prototype.onA = "on the class";
  note("found one above", read(object, on, tails[0]));
  delete Derived.prototype.onA;
  delete Base.prototype.onA;
  note("absent again", read(object, on, tails[0]), readOfRecord(literal, on, tails[0]));
  // An object that stands above others gets the name, and loses it.
  const above = { unrelated: 1 };
  const below = Object.create(Object.create(above));
  note("absent below", read(below, on, tails[0]), read(Object.create(null), on, tails[0]));
  above.onA = "two above";
  note("found above", read(below, on, tails[0]));
  delete above.onA;
  note(
    "absent a third time",
    read(below, on, tails[0]),
    read(object, on, tails[0]),
    readOfRecord(literal, on, tails[0]),
  );
  Object.defineProperty(above, "onA", {
    get() {
      return "a getter two above";
    },
    configurable: true,
  });
  note("a getter above", read(below, on, tails[0]));
  Object.setPrototypeOf(literal, { onA: "on a new prototype" });
  note("another prototype", readOfRecord(literal, on, tails[0]));
  Object.setPrototypeOf(literal, null);
  note("no prototype", readOfRecord(literal, on, tails[0]));
  object.onA = "own";
  note("own", read(object, on, tails[0]));
}

// Methods and accessors above the object.
{
  let calls = 0;
  class Listener {
    onA() {
      return "A of " + this.name;
    }
    onB() {
      return "B of " + this.name;
    }
    get onC() {
      return "C, call " + ++calls;
    }
    static onD() {
      return "static D";
    }
    constructor(name) {
      this.name = name;
    }
    handle(tail) {
      let last;
      for (let i = 0; i < 4; i++) last = this[on + tail];
      return typeof last === "function" ? last.call(this) : last;
    }
  }
  const listener = new Listener("first");
  note(
    "methods",
    listener.handle(tails[0]),
    listener.handle(tails[1]),
    listener.handle(tails[2]),
    listener.handle(tails[3]),
    read(Listener, on, tails[3])(),
  );
  Listener.prototype.onA = function replaced() {
    return "replaced A of " + this.name;
  };
  note("a method replaced", listener.handle(tails[0]), new Listener("second").handle(tails[0]));
}

// Bases that are no ordinary objects.
{
  const len = text(108, 101, 110),
    gth = text(103, 116, 104);
  note(
    "length",
    read([1, 2, 3], len, gth),
    read("four", len, gth),
    read(function (a, b) {}, len, gth),
    read(new Uint8Array(6), len, gth),
    read({}, len, gth),
  );
  note(
    "primitives",
    read(5, text(116, 111, 70, 105), text(120, 101, 100)),
    read(true, text(118, 97, 108), text(117, 101, 79, 102)),
    read(Symbol.iterator, text(100, 101, 115, 99), text(114, 105, 112, 116, 105, 111, 110)),
    read(3n, on, tails[0]),
  );
  for (const nothing of [null, undefined]) {
    try {
      note("did not throw", read(nothing, on, tails[0]));
    } catch (error) {
      note("of " + nothing, error instanceof TypeError);
    }
  }
  // The text of an index.
  const list = ["zero", "one", "two"];
  list[12] = "twelve";
  const one = text(49),
    two = text(50),
    empty = text();
  note(
    "indices",
    read(list, one, empty),
    read(list, empty, two),
    read(list, one, two),
    read(list, two, one),
    read("abc", empty, one),
    read({ 12: "named twelve" }, one, two),
    read(list, 1, empty),
    read(list, empty, 2),
    read(new Float64Array([0.5, 1.5]), empty, one),
  );
  const asked = [];
  const proxy = new Proxy(
    { onA: "of the target" },
    {
      get(target, key, receiver) {
        asked.push(key);
        return Reflect.get(target, key, receiver);
      },
    },
  );
  note("proxy", read(proxy, on, tails[0]), read(proxy, on, tails[1]), asked.join());
  note("above a proxy", read(Object.create(proxy), on, tails[0]), asked.length);
  note(
    "arguments and globals",
    read(globalThis, text(77, 97), text(116, 104)) === Math,
    read(
      (function () {
        return arguments;
      })(1, 2),
      len,
      gth,
    ),
  );
}

// Parts that are no strings.
{
  const record = {
    k1: "one",
    "k-1": "minus one",
    "k1.5": "one and a half",
    ktrue: "yes",
    knull: "null",
    kundefined: "undefined",
    k10: "ten",
    "1k": "k behind",
    kNaN: "not a number",
    k0: "zero",
  };
  note(
    "parts",
    ...[1, -1, 1.5, true, null, undefined, 10n, NaN, 0, -0].map(part => readOfRecord(record, "k", unknown(part))),
    readOfRecord(record, unknown(1), "k"),
  );
}

// One part is written in the program.
{
  function readWritten(record, tail) {
    let seen = [];
    for (let i = 0; i < 4; i++)
      seen.push(
        record["on" + tail],
        record[`at${tail}`],
        record[tail + "Changed"],
        record["k" + tail],
        record["" + tail],
        record[tail + ""],
      );
    return seen.slice(-6);
  }
  function storeWritten(record, tail, value) {
    for (let i = 0; i < 4; i++) {
      record["on" + tail] = value + i;
      record[tail + "Changed"] = value - i;
    }
  }
  function hasWritten(record, tail) {
    let count = 0;
    for (let i = 0; i < 4; i++)
      count +=
        ("on" + tail in record ? 1 : 0) +
        (tail + "Changed" in record ? 10 : 0) +
        (Object.hasOwn(record, "at" + tail) ? 100 : 0);
    return count;
  }
  function removeWritten(record, tail) {
    let removed = 0;
    for (let i = 0; i < 3; i++) removed += delete record["on" + tail] ? 1 : 0;
    return removed;
  }
  const record = { onA: 1, atA: 2, AChanged: 3, kA: 4, A: 5, onB: "b" };
  note(
    "written parts",
    ...readWritten(record, tails[0]),
    ...readWritten(record, tails[1]),
    ...readWritten(record, tails[2]),
  );
  storeWritten(record, tails[0], 100);
  storeWritten(record, tails[2], 200);
  note(
    "stored under written parts",
    ...readWritten(record, tails[0]),
    ...readWritten(record, tails[2]),
    hasWritten(record, tails[0]),
    hasWritten(record, tails[1]),
    hasWritten(record, tails[3]),
  );
  note(
    "removed under written parts",
    removeWritten(record, tails[0]),
    ...readWritten(record, tails[0]),
    hasWritten(record, tails[0]),
  );
  note(
    "numbers beside written parts",
    ...[0, 1, 2, 3].map(i => ({ item0: "zero", item1: "one", item2: "two" })["item" + unknown(i)]),
  );
  // The same text as a value of its own.
  const written = "on";
  note(
    "the text itself",
    written + tails[0] === on + tails[0],
    ("on" + tails[0]).length,
    record["on" + tails[1]],
    [written, "on"].join(),
  );
}

// Values that lie outside the cell, and many shapes under one pair.
{
  const source = {};
  for (let i = 0; i < 30; i++) source["name" + i] = i * 3;
  const parsed = JSON.parse(unknown(JSON.stringify(source)));
  let sum = 0;
  for (let round = 0; round < 5; round++) for (let i = 0; i < 32; i++) sum += parsed["name" + i] ?? -1;
  note("parsed", sum);
  const many = [];
  for (let i = 0; i < 12; i++) {
    const object = JSON.parse(
      unknown("{" + Array.from({ length: i }, (_, j) => `"pad${j}":0,`).join("") + `"onA":${i}}`),
    );
    many.push(object);
  }
  sum = 0;
  for (let round = 0; round < 5; round++)
    for (const object of many) sum = sum * 3 + object[on + tails[0]] + (object["on" + tails[1]] === undefined ? 1 : 0);
  note("many shapes", sum % 1000003);
}

// Shapes and strings die, and others are made where they were.
{
  let wrong = 0;
  for (let round = 0; round < 30; round++) {
    const objects = [];
    for (let i = 0; i < 60; i++) {
      const object = {};
      object["shape" + round + "x" + i] = 0;
      object[on + tails[i % 3]] = round * 100 + i;
      objects.push(object);
    }
    for (let again = 0; again < 4; again++) {
      for (let i = 0; i < objects.length; i++) {
        for (let t = 0; t < 3; t++) {
          const found = objects[i][on + tails[t]];
          if (found !== (t === i % 3 ? round * 100 + i : undefined)) wrong++;
        }
      }
    }
    if (round % 2) Bun.gc(round % 4 === 1);
  }
  note("wrong after collections", wrong);
}

console.log(log.join("\n"));

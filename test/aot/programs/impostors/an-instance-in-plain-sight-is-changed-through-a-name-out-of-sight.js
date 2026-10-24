class Meter {
  constructor(level) {
    this.level = level;
    this.unit = "m";
  }
  describe() {
    return this.level + this.unit;
  }
}

class Other {
  describe() {
    return "other";
  }
}

function read(meter) {
  return meter.describe() + " " + meter.level + " " + meter.unit;
}

function store(meter, level) {
  meter.level = level;
  return meter.level;
}

function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

let warm = "";
for (let i = 0; i < 2000; i++) {
  const meter = new Meter(i);
  store(meter, i + 1);
  warm = read(meter);
}
console.log("2000 honest meters:", warm);

const shelf = JSON.parse("{}");

const ways = {
  "an object that came out of JSON.parse": meter => {
    shelf.kept = meter;
    return shelf.kept;
  },
  "a Map": meter => new Map([["kept", meter]]).get(JSON.parse('"kept"')),
  "Object.values": meter => Object.values({ kept: meter })[0],
  "the arguments object": meter =>
    (function () {
      return arguments[0];
    })(meter),
  "a callback of forEach": meter => {
    let seen;
    [meter].forEach(value => (seen = value));
    return seen;
  },
  "a weak reference": meter => new WeakRef(meter).deref(),
  "a generator": meter =>
    (function* () {
      yield meter;
    })().next().value,
  "Reflect.apply": meter => Reflect.apply(value => value, undefined, [meter]),
  "a bound function": meter => (value => value).bind(null, meter)(),
  "a getter": meter =>
    ({
      get kept() {
        return meter;
      },
    })[JSON.parse('"kept"')],
  "a thrown value": meter => {
    try {
      throw meter;
    } catch (caught) {
      return caught;
    }
  },
  "a sort comparator": meter => {
    let seen;
    [meter, meter].sort(a => ((seen = a), 0));
    return seen;
  },
};

const changes = {
  "gets another prototype": alias => Object.setPrototypeOf(alias, Other.prototype),
  "loses its prototype": alias => Object.setPrototypeOf(alias, null),
  "gets a method of its own": alias => {
    alias.describe = () => "own";
  },
  "gets a method of its own under a computed name": alias => {
    alias[JSON.parse('"describe"')] = () => "own by name";
  },
  "has a field turned into a getter": alias =>
    Object.defineProperty(alias, "level", { get: () => "got", configurable: true }),
  "has a field deleted": alias => delete alias.level,
  "has a field of another kind stored": alias => {
    alias.level = { toString: () => "object" };
  },
  "is frozen": alias => Object.freeze(alias),
  "has a field made read-only": alias => Object.defineProperty(alias, "level", { writable: false }),
  "gets one more field": alias => {
    alias.extra = 1;
  },
};

for (const [way, hand] of Object.entries(ways)) {
  for (const [change, apply] of Object.entries(changes)) {
    const meter = new Meter(5);
    const before = read(meter);
    apply(hand(meter));
    console.log(
      way + ", " + change + ":",
      before,
      "->",
      attempt(() => read(meter)),
      "| stored",
      attempt(() => store(meter, 9)),
      "->",
      attempt(() => read(meter)),
      "| keys",
      Object.keys(meter).join(),
    );
  }
}

const again = new Meter(1);
console.log("honest again:", read(again), store(again, 2), read(again));

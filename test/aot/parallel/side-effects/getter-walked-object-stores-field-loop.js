// A for..in loop reads a field of another object in front of and behind `walked[key]`, and a getter of the walked object stores to that field
const counter = { reads: 0 };

class WithOwnAccessor {
  constructor() {
    this.first = 1;
    Object.defineProperty(this, "counted", { get() { counter.reads++; return "own accessor"; }, enumerable: true, configurable: true });
    this.last = 2;
  }
}

function defineLater(object, key) {
  Object.defineProperty(object, key, { get() { counter.reads++; return "defined later"; }, enumerable: true, configurable: true });
  return object;
}

const objects = {
  getterInTheMiddle: { first: 1, get counted() { counter.reads++; return "counted"; }, last: 2 },
  getterFirst: { get counted() { counter.reads++; return "counted"; }, last: 2 },
  getterLast: { first: 1, get counted() { counter.reads++; return "counted"; } },
  twoGetters: { get one() { counter.reads++; return 1; }, between: 0, get two() { counter.reads += 2; return 2; } },
  onlyValues: { first: 1, last: "text" },
  setterAlone: { first: 1, set counted(value) { counter.reads++; }, last: 2 },
  definedOverAField: defineLater({ first: 1, counted: 0, last: 2 }, "counted"),
  definedUnderANewName: defineLater({ first: 1, last: 2 }, "counted"),
  instance: new WithOwnAccessor(),
  belowALiteral: Object.create({ first: 1, get counted() { counter.reads++; return "inherited"; } }),
  parsed: defineLater(JSON.parse('{"first":1,"last":2}'), "counted"),
  becomesAValue: { first: 1, get counted() { counter.reads++; Object.defineProperty(this, "counted", { value: "a value now", enumerable: true }); return "was a getter"; }, last: 2 },
  removesTheNext: { first: 1, get counted() { counter.reads++; delete this.last; return "removed the next"; }, last: 2 },
  addsAName: { first: 1, get counted() { counter.reads++; this.added = 3; return "added a name"; }, last: 2 },
  proxy: new Proxy({ first: 1, last: 2 }, { get(target, key) { counter.reads++; return target[key]; } }),
};

const arrivals = {
  outOfATrap: object => new Proxy({}, { get: () => object }).anything,
  outOfAReviver: object => JSON.parse("[0]", () => object),
  outOfAMap: object => new Map([["key", object]]).get("key"),
  asWritten: object => object,
};

function walk(walked) {
  let line = "";
  for (const key in walked) {
    const before = counter.reads;
    const value = walked[key];
    line += ` ${key}:${before}>${counter.reads}=${value}`;
  }
  return line;
}

function walkAndAsk(walked) {
  let line = "";
  for (const key in walked) {
    const before = counter.reads;
    const has = key in walked;
    const hasOwn = Object.hasOwn(walked, key);
    const value = Reflect.get(walked, key);
    line += ` ${key}:${before}>${counter.reads}=${has},${hasOwn},${value}`;
  }
  return line;
}

for (const name in objects) {
  for (const arrival in arrivals) {
    for (let round = 0; round < 2; round++) {
      console.log(name, arrival, round, walk(arrivals[arrival](objects[name])));
      console.log(name, arrival, round, walkAndAsk(arrivals[arrival](objects[name])));
    }
  }
}

for (const name in objects) {
  for (const handed of [new Proxy({}, { get: () => objects[name] }).anything, JSON.parse("[0]", () => objects[name])]) {
    let line = "";
    for (const key in handed) {
      const before = counter.reads;
      const value = handed[key];
      line += ` ${key}:${before}>${counter.reads}=${value}`;
    }
    console.log(name, "at the top level", line);
  }
}

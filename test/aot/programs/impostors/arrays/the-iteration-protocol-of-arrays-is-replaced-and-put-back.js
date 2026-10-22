const iteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());

function* replacedIterator() {
  yield "replaced";
}

function replacedNext() {
  if (this.finished) return { done: true, value: undefined };
  this.finished = true;
  return { done: false, value: "replaced" };
}

const observers = {
  forOf(list) {
    for (const value of list) return value;
  },
  forOfInALoop(list) {
    let first;
    for (let turn = 0; turn < 2; turn++) for (const value of list) first ??= value;
    return first;
  },
  spread: list => [...list][0],
  spreadIntoACall: list => String(...list),
  pattern(list) {
    const [first] = list;
    return first;
  },
  patternWithARest(list) {
    const [...rest] = list;
    return rest[0];
  },
  parameterPattern: ([first]) => first,
  from: list => Array.from(list)[0],
  set: list => [...new Set(list)][0],
  delegate(list) {
    function* all() {
      yield* list;
    }
    return all().next().value;
  },
  byHand: list => list[Symbol.iterator]().next().value,
  reflected: list => Reflect.get(list, Symbol.iterator).call(list).next().value,
  literal() {
    const [first] = ["original", "second"];
    return first;
  },
  spreadOfALocal() {
    const inner = ["original"];
    return [...inner][0];
  },
  swap() {
    let a = "second";
    let b = "original";
    [a, b] = [b, a];
    return a;
  },
  restArguments: (...values) => { for (const value of values) return typeof value === "string" ? value : value[0]; },
};

const changes = {
  "Array.prototype[Symbol.iterator] is stored to": [Array.prototype, Symbol.iterator, holder => { holder[Symbol.iterator] = replacedIterator; }],
  "Array.prototype[Symbol.iterator] is set by Reflect": [Array.prototype, Symbol.iterator, holder => Reflect.set(holder, Symbol.iterator, replacedIterator)],
  "Array.prototype[Symbol.iterator] is defined": [Array.prototype, Symbol.iterator, holder => { Object.defineProperty(holder, Symbol.iterator, { value: replacedIterator }); }],
  "Array.prototype[Symbol.iterator] becomes a getter": [Array.prototype, Symbol.iterator, holder => { Object.defineProperty(holder, Symbol.iterator, { get: () => replacedIterator, configurable: true }); }],
  "the next of array iterators is stored to": [iteratorPrototype, "next", holder => { holder.next = replacedNext; }],
  "the next of array iterators is set by Reflect": [iteratorPrototype, "next", holder => Reflect.set(holder, "next", replacedNext)],
  "the next of array iterators is defined": [iteratorPrototype, "next", holder => { Object.defineProperty(holder, "next", { value: replacedNext }); }],
  "Array.prototype.values is stored to": [Array.prototype, "values", holder => { holder.values = replacedIterator; }],
};

for (const name in observers) for (let i = 0; i < 1000; i++) observers[name](["original", "second"]);

function observe() {
  const answers = {};
  for (const name in observers) {
    try {
      answers[name] = observers[name](["original", "second"]);
    } catch (error) {
      answers[name] = "threw";
    }
  }
  return answers;
}

for (const label in changes) {
  const [holder, key, change] = changes[label];
  const descriptor = Object.getOwnPropertyDescriptor(holder, key);
  try {
    change(holder);
  } catch {}
  const during = observe();
  try {
    Object.defineProperty(holder, key, descriptor);
  } catch {}
  const after = observe();
  const expected = key === "values" ? "original" : during.reflected;
  for (const name in observers) {
    const isRight = during[name] === expected && after[name] === "original";
    console.log((isRight ? "ok " : "WRONG ") + label + ", " + name + (isRight ? ": as the protocol says, and the original afterwards" : ": " + during[name] + " where a call by hand saw " + expected + ", afterwards " + after[name]));
  }
}

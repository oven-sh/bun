function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function drain(iterator) {
  const seen = [];
  for (const value of iterator) seen.push(value);
  return seen;
}

function step(iterator) {
  return iterator.next();
}

function spread(iterator) {
  return [...iterator];
}

function firstOf(iterator) {
  const [first] = iterator;
  return first;
}

for (let i = 0; i < 1000; i++) {
  drain([1, 2].values());
  step([1, 2].values());
  spread([1, 2].values());
  firstOf([1, 2].values());
}

attempt("stepped past the end", () => {
  const iterator = [1, 2].values();
  return [step(iterator), step(iterator), step(iterator), step(iterator)];
});

attempt("the array grows after the end was seen", () => {
  const list = [1, 2];
  const iterator = list.values();
  const before = drain(iterator);
  list.push(3, 4);
  return [before, step(iterator), drain(iterator), spread(iterator), firstOf(iterator)];
});

attempt("the array grows just before the end is seen", () => {
  const list = [1, 2];
  const iterator = list.values();
  step(iterator);
  step(iterator);
  list.push(3);
  return [step(iterator), step(iterator), step(iterator)];
});

attempt("the array shrinks under the iterator and grows again", () => {
  const list = [1, 2, 3, 4];
  const iterator = list.values();
  step(iterator);
  step(iterator);
  list.length = 1;
  const ended = step(iterator);
  list.push(5, 6, 7, 8);
  return [ended, step(iterator), drain(iterator)];
});

attempt("a loop is left and the iterator is walked again", () => {
  const iterator = [1, 2, 3, 4].values();
  for (const value of iterator) if (value === 2) break;
  return drain(iterator);
});

attempt("a pattern takes one and a loop takes the others", () => {
  const iterator = [1, 2, 3].values();
  return [firstOf(iterator), drain(iterator), firstOf(iterator)];
});

attempt("two loops share one iterator", () => {
  const iterator = [1, 2, 3, 4].values();
  const seen = [];
  for (const outer of iterator) {
    for (const inner of iterator) {
      seen.push(outer + ":" + inner);
      if (inner === 3) break;
    }
  }
  return seen;
});

attempt("entries and keys past the end", () => {
  const entries = ["a"].entries();
  const keys = ["a"].keys();
  return [step(entries), step(entries), step(entries), step(keys), step(keys), step(keys)];
});

attempt("an iterator over an array-like", () => {
  const like = { length: 2, 0: "a", 1: "b" };
  const iterator = Array.prototype.values.call(like);
  const before = drain(iterator);
  like.length = 4;
  return [before, step(iterator)];
});

attempt("an iterator over a typed array that loses its buffer", () => {
  const list = new Uint8Array([1, 2, 3]);
  const iterator = list.values();
  step(iterator);
  list.buffer.transfer();
  return step(iterator);
});

attempt("an exhausted iterator over a typed array that loses its buffer", () => {
  const list = new Uint8Array([1]);
  const iterator = list.values();
  const before = drain(iterator);
  list.buffer.transfer();
  return [before, step(iterator)];
});

attempt("an iterator with its own next", () => {
  const iterator = [1, 2].values();
  let calls = 0;
  iterator.next = () => ({ done: calls++ > 0, value: "own" });
  return [drain(iterator), calls];
});

attempt("an iterator with its own return", () => {
  const iterator = [1, 2].values();
  const log = [];
  iterator.return = () => {
    log.push("return");
    return {};
  };
  return [firstOf(iterator), log, drain(iterator), log];
});

attempt("next borrowed for something else", () => [1].values().next.call({}));
attempt("next borrowed for a Set's iterator", () => [1].values().next.call(new Set([1]).values()));
attempt("next borrowed for another array's iterator", () => [1].values().next.call([9].values()));
attempt("the iterator of an iterator is itself", () => {
  const iterator = [1].values();
  return iterator[Symbol.iterator]() === iterator;
});
attempt("an exhausted string iterator", () => {
  const iterator = "ab"[Symbol.iterator]();
  return [drain(iterator), step(iterator), drain(iterator)];
});
attempt("an exhausted Set iterator after an addition", () => {
  const set = new Set([1]);
  const iterator = set.values();
  const before = drain(iterator);
  set.add(2);
  return [before, step(iterator), drain(iterator)];
});
attempt("an exhausted Map iterator after an addition", () => {
  const map = new Map([[1, 1]]);
  const iterator = map.keys();
  const before = drain(iterator);
  map.set(2, 2);
  return [before, step(iterator), drain(iterator)];
});

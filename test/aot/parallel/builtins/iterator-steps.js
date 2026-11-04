// `[...iterator]`, `f(...iterator)`, `iterator.reduce(f)`, `iterator.map(f)`: where nobody knows the iterator, one of the engine's is stepped without a call of `next`.
// Every other iterator, and one of the engine's with a `next` of its own, is asked as the language says, in the same order and with the same words where it fails.
// STATISTIC: IteratorsSteppedWithoutCall >= 8
const lines = [];
const show = (name, make) => {
  let answer;
  try {
    answer = JSON.stringify(make());
  } catch (error) {
    answer = error.constructor.name + ": " + error.message;
  }
  lines.push(name + ": " + answer);
};
const spread = it => [...it];
const count = (...all) => all.length + ":" + all.join();
const called = it => count(...it);
const consumers = {
  spread,
  called,
  reduce: it => it.reduce((sum, v) => sum + "|" + v, ""),
  reduceFromFirst: it => it.reduce((sum, v) => sum + "|" + v),
  some: it => it.some(v => String(v).includes("2")),
  every: it => it.every(v => !String(v).includes("2")),
  find: it => it.find(v => String(v).includes("2")),
  toArray: it => it.toArray(),
  forEach: it => {
    const seen = [];
    it.forEach((v, i) => seen.push(i + "=" + v));
    return seen;
  },
  map: it => it.map(v => "<" + v + ">").toArray(),
  filter: it => spread(it.filter((v, i) => i % 2 === 0)),
  take: it => it.take(2).toArray(),
  drop: it => spread(it.drop(2)),
  flatMap: it => it.flatMap(v => [v, v]).toArray(),
  from: it => Array.from(it),
};
function* generated() {
  yield 1;
  yield 2;
  yield 3;
}
const makers = {
  mapValues: () => new Map([["a", 1], ["b", 2], ["c", 3]]).values(),
  mapKeys: () => new Map([["a", 1], ["b2", 2], ["c", 3]]).keys(),
  mapEntries: () => new Map([["a", 1], ["b", 2], ["c", 3]]).entries(),
  setValues: () => new Set([1.5, "2", null]).values(),
  setEntries: () => new Set([1, 2]).entries(),
  listValues: () => [1, , 2.5, "x2"].values(),
  listKeys: () => ["p", "q", "r"].keys(),
  listEntries: () => ["p", "q2"].entries(),
  bytes: () => new Uint8Array([7, 2, 9]).values(),
  arrayLike: () => Array.prototype.values.call({ length: 2, 0: "zero", 1: "2nd" }),
  generator: () => generated(),
  text: () => "a2😀"[Symbol.iterator](),
  matches: () => "a1 b2".matchAll(/[a-z]\d/g).map(m => m[0]),
  empty: () => new Map().values(),
};
for (const [made, make] of Object.entries(makers)) {
  for (const [consumer, consume] of Object.entries(consumers)) {
    show(made + " " + consumer, () => consume(make()));
    show(made + " " + consumer + ", started", () => {
      const it = make();
      it.next();
      return [consume(it), it.next()];
    });
  }
}

// The table changes under the walk.
for (const [consumer, walk] of Object.entries({
  reduce: (it, f) => it.reduce((all, v) => (f(v), all + v), ""),
  some: (it, f) => it.some(v => (f(v), false)),
  map: (it, f) => it.map(v => (f(v), v)).toArray(),
})) {
  const map = new Map([[1, "a"], [2, "b"], [3, "c"]]);
  show("grown and cut under " + consumer, () => [walk(map.keys(), key => {
    if (key === 1) map.delete(2);
    if (key < 5) map.set(key + 10, "late");
    if (key === 11) map.clear();
  }), [...map]]);
}

// A `next` that is not the engine's, on an iterator that is.
const log = [];
const answering = answer => {
  const it = new Map([["a", 1]]).values();
  it.next = function () {
    log.push("next");
    return answer();
  };
  return it;
};
const watched = (done, value) => ({
  get done() {
    log.push("done");
    return done;
  },
  get value() {
    log.push("value");
    return value;
  },
});
for (const [consumer, consume] of Object.entries(consumers)) {
  show("no object for an answer, " + consumer, () => consume(answering(() => 7)));
  let turns = 0;
  log.length = 0;
  show("an answer that is watched, " + consumer, () => [consume(answering(() => watched(turns++ < 2 ? 0 : "yes", turns))), log.join()]);
}
const borrowed = new Map([["a", 1]]).values();
borrowed.next = new Set([1]).values().next;
for (const [consumer, consume] of Object.entries(consumers)) show("a Set's next on a Map's iterator, " + consumer, () => consume(borrowed));
const plain = { next: new Map([["a", 1]]).values().next, [Symbol.iterator]() { return this; } };
show("a Map's next on a plain object, spread", () => spread(plain));
show("a Map's next on a plain object, called", () => called(plain));
show("a Map's next on a plain object, reduce", () => Iterator.prototype.reduce.call(plain, (a, b) => a + b, 0));
show("a Map's next on a number, some", () => Iterator.prototype.some.call(5, () => true));

class Countdown extends Iterator {
  constructor(from) {
    super();
    this.from = from;
  }
  next() {
    return this.from > 0 ? { done: false, value: this.from-- } : { done: true, value: "never seen" };
  }
}
for (const [consumer, consume] of Object.entries(consumers)) show("a class below Iterator, " + consumer, () => consume(new Countdown(3)));

const detached = new Uint8Array(new ArrayBuffer(4)).values();
detached.next();
const view = new Uint8Array(4);
const overDetached = view.values();
overDetached.next();
view.buffer.transfer();
show("the bytes are gone, spread", () => spread(overDetached));
show("the bytes are there, reduce", () => detached.reduce((a, b) => a + b, 1));
console.log(lines.join("\n"));

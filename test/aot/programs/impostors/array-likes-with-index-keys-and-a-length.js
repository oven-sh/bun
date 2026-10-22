function show(value) {
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return value.constructor.name + "[" + parts.join(", ") + "]";
  }
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

function attempt(label, run) {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "-> threw", error.constructor.name + ":", error.message);
  }
}

function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function last(list) {
  return list[list.length - 1];
}

function countPresent(list) {
  let count = 0;
  for (let i = 0; i < list.length; i++) if (i in list) count++;
  return count;
}

function doubled(list) {
  const result = [];
  for (let i = 0; i < list.length; i++) result.push(list[i] * 2);
  return result;
}

function store(list, index, value) {
  list[index] = value;
  return list.length;
}

const make = () => ({ [0]: 123, [1]: 456, length: 3 });

for (let i = 0; i < 2000; i++) {
  sum([1, 2, 3]);
  last([1, 2, 3]);
  countPresent([1, 2, 3]);
  doubled([1, 2, 3]);
  store([1, 2, 3], 3, 4);
}

attempt("sum of an array", () => sum([123, 456, 0]));
attempt("sum of the array-like", () => sum(make()));
attempt("sum of an array again", () => sum([123, 456, 0]));
attempt("last of the array-like", () => last(make()));
attempt("present in the array-like", () => countPresent(make()));
attempt("doubled array-like", () => doubled(make()));
attempt("a store past the length of an array", () => store([1, 2, 3], 5, 9));
attempt("a store past the length of the array-like", () => store(make(), 5, 9));
attempt("keys", () => Object.keys(make()));
attempt("keys after a store", () => {
  const list = make();
  store(list, 2, 789);
  return Object.keys(list);
});
attempt("JSON", () => JSON.stringify(make()));
attempt("isArray", () => Array.isArray(make()));
attempt("spread", () => [...make()]);
attempt("for-of", () => {
  const seen = [];
  for (const value of make()) seen.push(value);
  return seen;
});
attempt("destructured as a list", () => {
  const [first] = make();
  return first;
});
attempt("destructured as an object", () => {
  const { 0: first, 2: third, length } = make();
  return [first, third, length];
});

attempt("Array.from(array-like)", () => Array.from(make()));
attempt("Array.from(array-like, double)", () => Array.from(make(), value => value * 2));
attempt("map.call", () => Array.prototype.map.call(make(), value => value * 2));
attempt("filter.call", () => Array.prototype.filter.call(make(), () => true));
attempt("forEach.call", () => {
  const seen = [];
  Array.prototype.forEach.call(make(), (value, index) => seen.push(index));
  return seen;
});
attempt("join.call", () => Array.prototype.join.call(make()));
attempt("slice.call", () => Array.prototype.slice.call(make()));
attempt("concat.call", () => Array.prototype.concat.call(make(), [1]).length);
attempt("includes.call undefined", () => Array.prototype.includes.call(make(), undefined));
attempt("indexOf.call undefined", () => Array.prototype.indexOf.call(make(), undefined));
attempt("push.call", () => {
  const list = make();
  return [Array.prototype.push.call(list, 789), list];
});
attempt("pop.call", () => {
  const list = make();
  return [Array.prototype.pop.call(list), list];
});
attempt("reverse.call", () => Array.prototype.reverse.call(make()));
attempt("sort.call", () => Array.prototype.sort.call({ 0: 3, 1: 1, 2: 2, length: 3 }));
attempt("Math.max.apply", () => Math.max.apply(null, make()));
attempt("Reflect.apply", () => Reflect.apply((a, b, c) => [a, b, c], null, make()));
attempt("Array.apply", () => Array.apply(null, { length: 3 }));

const lengths = [3, 0, -1, 2.7, "2", "x", NaN, null, undefined, true, -0, 2 ** 32, 2 ** 53, Infinity];
for (const length of lengths) {
  attempt("Array.from({ length: " + show(length) + " })", () => Array.from({ length }));
  attempt("sum({ length: " + show(length) + " }) is NaN or 0", () => (typeof length === "number" && length > 1000 ? "skipped" : sum({ length })));
}

attempt("Array.from({ length: 3 }) against Array(3)", () => [0 in Array.from({ length: 3 }), 0 in Array(3)]);
attempt("Array.from({ length: 3 }, index)", () => Array.from({ length: 3 }, (_, index) => index * 2));
attempt("Array.from({ length: 3 }).map", () => Array.from({ length: 3 }).map((_, index) => index));
attempt("Array(3).map", () => Array(3).map((_, index) => index));
attempt("sum(Array.from({ length: 3 }))", () => sum(Array.from({ length: 3 })));
attempt("sum(Array.from({ length: 3 }, index))", () => sum(Array.from({ length: 3 }, (_, index) => index)));
attempt("sum(Array(3))", () => sum(Array(3)));

attempt("a length that counts its reads", () => {
  let reads = 0;
  const list = {
    0: 1,
    1: 2,
    get length() {
      reads++;
      return 2;
    },
  };
  return [sum(list), reads, Array.from(list), reads];
});
attempt("a length that shrinks", () => {
  let length = 4;
  const list = {
    0: 1,
    1: 2,
    2: 3,
    3: 4,
    get length() {
      return length--;
    },
  };
  return sum(list);
});
attempt("a length with valueOf", () => {
  const log = [];
  const length = {
    valueOf() {
      log.push("valueOf");
      return 2;
    },
  };
  return [Array.from({ 0: "a", 1: "b", length }), sum({ 0: 1, 1: 2, length }), log];
});
attempt("elements that are getters", () => {
  const log = [];
  const list = {
    get 0() {
      log.push(0);
      return 1;
    },
    get 1() {
      log.push(1);
      return 2;
    },
    length: 2,
  };
  return [sum(list), Array.from(list), log];
});
attempt("elements inherited from the prototype", () => sum(Object.create({ 0: 10, 1: 20 }, { length: { value: 2 } })));
attempt("iterable and array-like: the iterator wins", () =>
  Array.from({
    0: "by index",
    length: 1,
    *[Symbol.iterator]() {
      yield "by iterator";
    },
  }),
);

class Foo extends Array {}
attempt("Foo.from({ length: 2 })", () => Foo.from({ length: 2 }));
attempt("Array.from.call(Object, array-like)", () => Array.from.call(Object, make()));
attempt("Array.from.call(function)", () => {
  function Plain(length) {
    this.given = length;
  }
  return Array.from.call(Plain, make());
});

attempt("a string", () => [sum("12"), last("abc"), countPresent(Object("abc")), Array.from("ab")]);
attempt("a typed array", () => [sum(new Uint8Array([250, 10])), store(new Uint8Array(2), 5, 9), doubled(new Uint8Array([200]))]);
attempt("arguments", () => (function () { return [sum(arguments), last(arguments), Array.from(arguments)]; })(1, 2, 3));
attempt("a function", () => [sum(function (a, b) {}), last(function (a) {})]);

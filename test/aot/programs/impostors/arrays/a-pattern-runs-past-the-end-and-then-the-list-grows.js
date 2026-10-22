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

function aDefaultGrows(list) {
  const [a, b = list.push("x", "y", "z"), c, d = "default d"] = list;
  return [a, b, c, d];
}

function aDefaultGrowsBeforeARest(list) {
  const [a, b = list.push("x", "y", "z"), ...rest] = list;
  return [a, b, rest];
}

function aDefaultStoresAhead(list) {
  const [a, b = (list[2] = "stored"), c] = list;
  return [a, b, c];
}

function aDefaultSetsTheLength(list) {
  const [a, b = (list.length = 4), c, d] = list;
  return [a, b, c, d, 2 in list];
}

function aSetterGrows(list) {
  const target = {
    set grow(value) {
      list.push("x", "y", "z");
    },
  };
  let a, c;
  [a, target.grow, c] = list;
  return [a, c];
}

function aSetterGrowsEarly(list) {
  const target = {
    set grow(value) {
      list.push("x", "y");
    },
  };
  let b, c, d;
  [target.grow, b, c, d] = list;
  return [b, c, d];
}

function aNestedPatternGrows(list) {
  const [a, [b] = [list.push("x", "y", "z")], c] = list;
  return [a, b, c];
}

function aParameterDefaultGrows([a, b = a.push("x", "y"), c], list) {
  return [b, c];
}

function anEmptyListGrows(list) {
  const [a = list.push("x", "y"), b, c = "default c"] = list;
  return [a, b, c];
}

function shrinksAndGrows(list) {
  const [a, b = ((list.length = 0), list.push("p", "q", "r", "s")), c, d] = list;
  return [a, b, c, d];
}

function twoPatterns(list) {
  const [a, b = list.push("x", "y", "z")] = list;
  const [c, d, e] = list;
  return [a, b, c, d, e];
}

const uses = { aDefaultGrows, aDefaultGrowsBeforeARest, aDefaultStoresAhead, aDefaultSetsTheLength, aSetterGrows, aSetterGrowsEarly, aNestedPatternGrows, anEmptyListGrows, shrinksAndGrows, twoPatterns };

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([1, [2], 3, 4, 5]);

const makers = {
  "five elements": () => [1, [2], 3, 4, 5],
  "one element": () => [1],
  "no elements": () => [],
  "one element and a hole": () => [1, ,],
  "one element and undefined": () => [1, undefined],
  "one double": () => [1.5],
  "one string": () => ["one"],
  "a subclass with one element": () => new (class extends Array {})(1).fill(1),
  "an array-like iterated as an array": () => ({ length: 1, 0: 1, push: Array.prototype.push, [Symbol.iterator]: Array.prototype.values }),
};

for (const name in makers) {
  for (const use in uses) {
    const list = makers[name]();
    attempt(name + ", " + use, () => uses[use](list));
    console.log("  left " + describe(list));
  }
}

function aDefaultThatLooksPure(list, factor) {
  const [a, b = factor * 2, c, d = "default d"] = list;
  return [a, b, c, d];
}

function aDefaultThatReadsAMember(list, holder) {
  const [a, b = holder.fallback, c] = list;
  return [a, b, c];
}

function intoMembers(list, target) {
  [target.a, target.b, target.c] = list;
  return [target.a, target.c];
}

function aDefaultThatConcatenates(list, suffix) {
  const [a, b = "b" + suffix, ...rest] = list;
  return [a, b, rest];
}

for (let i = 0; i < 1000; i++) {
  aDefaultThatLooksPure([1], 2);
  aDefaultThatReadsAMember([1], { fallback: 2 });
  intoMembers([1], { a: 0, b: 0, c: 0 });
  aDefaultThatConcatenates([1], "!");
}

attempt("a factor whose valueOf grows the list", () => {
  const list = [1];
  return aDefaultThatLooksPure(list, { valueOf: () => list.push("x", "y", "z") });
});
attempt("a member whose getter grows the list", () => {
  const list = [1];
  return aDefaultThatReadsAMember(list, { get fallback() { return list.push("x", "y", "z"); } });
});
attempt("a member whose setter grows the list", () => {
  const list = [1];
  return intoMembers(list, { a: 0, set b(value) { list.push("x", "y", "z"); }, c: 0 });
});
attempt("a proxy whose set trap grows the list", () => {
  const list = [1];
  return intoMembers(list, new Proxy({}, { set(target, key, value) { if (key === "b") list.push("x", "y", "z"); target[key] = value; return true; } }));
});
attempt("a suffix whose toString grows the list", () => {
  const list = [1];
  return aDefaultThatConcatenates(list, { toString: () => String(list.push("x", "y", "z")) });
});
attempt("the same functions with plain values again", () => [aDefaultThatLooksPure([1], 2), aDefaultThatReadsAMember([1], { fallback: 2 }), intoMembers([1], { a: 0, b: 0, c: 0 }), aDefaultThatConcatenates([1], "!")]);

attempt("a parameter pattern", () => {
  const inner = [];
  return aParameterDefaultGrows([inner], inner);
});

function growingView() {
  const buffer = new ArrayBuffer(1, { maxByteLength: 8 });
  const view = new Uint8Array(buffer);
  view[0] = 7;
  return view;
}

attempt("a typed array that grows", () => {
  const view = growingView();
  const [a, b = (view.buffer.resize(4), view.fill(9), "grown"), c, d] = view;
  return [a, b, c, d];
});

attempt("a typed array that grows before a rest", () => {
  const view = growingView();
  const [a, b = (view.buffer.resize(4), "grown"), ...rest] = view;
  return [a, b, rest];
});

attempt("a Set that grows", () => {
  const set = new Set([1]);
  const [a, b = set.add(2).add(3).size, c] = set;
  return [a, b, c];
});

attempt("a Map that grows", () => {
  const map = new Map([[1, 1]]);
  const [a, b = map.set(2, 2).size, c] = map;
  return [a, b, c];
});

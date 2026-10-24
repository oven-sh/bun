// Object.fromEntries of pairs that are written in the call: computed keys, equal keys, __proto__, order of evaluation, holes, spreads and pairs that are no lists.
const log = [];
const note = (label, value) => (log.push(label), value);
const show = (label, object) => {
  const own = Reflect.ownKeys(object).map(key => `${String(key)}=${JSON.stringify(Object.getOwnPropertyDescriptor(object, key))}`);
  console.log(label, own.join(" "), "|", Object.getPrototypeOf(object) === Object.prototype, "|", log.splice(0).join());
};
const attempt = (label, run) => {
  try {
    show(label, run());
  } catch (error) {
    console.log(label, "throws", error.constructor.name, error.message.replace(/ \(evaluating.*$/, ""), "|", log.splice(0).join());
  }
};

attempt("two names", () => Object.fromEntries([["x", note("x", 1)], ["y", note("y", 2)]]));
attempt("order of evaluation", () => Object.fromEntries([[note("k1", "a"), note("v1", 1)], [note("k2", "b"), note("v2", 2)]]));
attempt("a name twice", () => Object.fromEntries([["a", 1], ["b", 2], ["a", 3]]));
attempt("a name twice, by a variable", () => { const k = "a"; return Object.fromEntries([[k, 1], ["b", 2], [k, 3]]); });
attempt("__proto__ is an own property", () => Object.fromEntries([["__proto__", { inherited: 1 }], ["b", 2]]));
attempt("__proto__ by a variable", () => { const k = ["__pro", "to__"].join(""); return Object.fromEntries([[k, null]]); });
attempt("indexes come first", () => Object.fromEntries([["b", 1], [2, "two"], ["a", 2], ["1", "one"], [0, "zero"]]));
attempt("numbers that are no indexes", () => Object.fromEntries([[1.5, 1], [-1, 2], [4294967295, 3], [4294967294, 4], [1e21, 5], [-0, 6], [NaN, 7]]));
attempt("symbols", () => Object.fromEntries([[Symbol.iterator, 1], ["a", 2], [Symbol.for("shared"), 3], [Symbol.toStringTag, "Tag"]]));
attempt("keys that are no strings", () => Object.fromEntries([[null, 1], [undefined, 2], [true, 3], [10n, 4], [[1, 2], 5], [{}, 6]]));
attempt("names of Object.prototype", () => Object.fromEntries([["toString", 1], ["constructor", 2], ["hasOwnProperty", 3], ["valueOf", 4]]));
attempt("more than two in a pair", () => Object.fromEntries([["a", note("v", 1), note("third", 2), note("fourth", 3)], ["b", note("w", 4)]]));
attempt("a pair of one", () => Object.fromEntries([["a"], ["b", 2]]));
attempt("an empty pair", () => Object.fromEntries([[], ["b", 2]]));
attempt("a hole for the key", () => Object.fromEntries([[, 1], ["b", 2]]));
attempt("a hole for the value", () => Object.fromEntries([["a", , 3]]));
attempt("a hole for a pair", () => Object.fromEntries([["a", 1], , ["b", 2]]));
attempt("a spread in a pair", () => Object.fromEntries([[...["a", 1]], ["b", 2]]));
attempt("a spread of pairs", () => Object.fromEntries([...[["a", 1]], ["b", 2]]));
attempt("no pair", () => Object.fromEntries([]));
attempt("a string for a pair", () => Object.fromEntries(["ab", ["c", 1]]));
attempt("a number for a pair", () => Object.fromEntries([["a", 1], 5]));
attempt("two arguments", () => Object.fromEntries([["a", 1]], note("second", 2)));
attempt("no argument", () => Object.fromEntries());

const keyThat = (label, text) => ({ toString: () => note(label, text) });
attempt("keys are converted behind every expression", () => Object.fromEntries([[keyThat("convert a", "a"), note("v1", 1)], [keyThat("convert b", "b"), note("v2", 2)]]));
attempt("Symbol.toPrimitive of a key", () => Object.fromEntries([[{ [Symbol.toPrimitive]: hint => note("hint " + hint, "p") }, note("v", 1)]]));
attempt("a key that cannot be converted", () => Object.fromEntries([["a", note("v1", 1)], [{ toString() { note("convert"); throw new RangeError("no key"); } }, note("v2", 2)], [keyThat("never", "c"), note("v3", 3)]]));
attempt("a value that throws", () => Object.fromEntries([[keyThat("never", "a"), note("v1", 1)], ["b", (() => { throw new RangeError("no value"); })()], ["c", note("never", 3)]]));
attempt("a key without a primitive", () => Object.fromEntries([[Object.create(null), 1]]));

const functions = Object.fromEntries([["arrow", () => 1], ["plain", function () {}], ["named", function own() {}], ["klass", class {}]]);
console.log("functions get no name from the key", Object.keys(functions).map(key => JSON.stringify(functions[key].name)).join());

const made = [1, 2, 3].map(n => Object.fromEntries([["n", n], ["square", n * n]]));
made[0].extra = true;
delete made[1].n;
console.log("each evaluation makes its own", JSON.stringify(made), made[0] !== made[1]);

function withConditions(flag, other) {
  return Object.fromEntries([["a", flag ? note("yes", 1) : note("no", 2)], [flag ? "b" : "c", other ?? note("default", 0)], ["d", flag && other]]);
}
attempt("conditions among the values", () => withConditions(true, undefined));
attempt("conditions among the values, the other way", () => withConditions(false, 7));

function* yields() {
  return Object.fromEntries([["first", yield 1], ["second", yield 2]]);
}
const generator = yields();
generator.next();
generator.next("one");
console.log("values that are yielded", JSON.stringify(generator.next("two").value));

(async () => {
  const awaited = Object.fromEntries([["a", await Promise.resolve(1)], [await Promise.resolve("b"), 2]]);
  console.log("values that are awaited", JSON.stringify(awaited));
})();

{
  const Object = { fromEntries: list => "a function of the program: " + list.length };
  console.log("another Object", Object.fromEntries([["a", 1], ["b", 2]]));
}
function shadowed(Object) {
  return Object.fromEntries([["a", 1]]);
}
console.log("a parameter named Object", shadowed({ fromEntries: list => list[0].join("=") }));
const { fromEntries } = Object;
attempt("the function in a variable", () => fromEntries([["a", 1], ["b", 2]]));
attempt("called with call", () => Object.fromEntries.call(null, [["a", 1]]));
attempt("an optional call", () => Object.fromEntries?.([["a", 1]]));
attempt("by a computed name", () => Object["fromEntries"]([["a", 1], ["b", note("b", 2)]]));
attempt("through globalThis", () => globalThis.Object.fromEntries([["a", 1]]));

const list = [["a", 1], ["b", 2]];
attempt("a list that somebody else holds", () => Object.fromEntries(list));
const pair = ["a", 1];
attempt("a pair that somebody else holds", () => Object.fromEntries([pair, ["b", 2]]));

const frozen = Object.freeze(Object.fromEntries([["a", 1]]));
console.log("frozen at once", Object.isFrozen(frozen), JSON.stringify(frozen));
const nested = Object.fromEntries([["inner", Object.fromEntries([["deep", Object.fromEntries([["x", 1]])]])], ["list", [Object.fromEntries([["y", 2]])]]]);
console.log("one in another", JSON.stringify(nested));
let reads = 0;
for (let turn = 0; turn < 2000; turn++) {
  const point = Object.fromEntries([["x", turn], ["y", turn + 1]]);
  reads += point.x + point.y + ("z" in point ? 1 : 0);
}
console.log("read by name", reads);

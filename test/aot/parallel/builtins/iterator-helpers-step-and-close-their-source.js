// The helpers of Iterator.prototype close and step the underlying iterator by hand too.
const log = [];
function source(results, options = {}) {
  let index = 0;
  const made = {
    __proto__: Iterator.prototype,
    next() {
      log.push("next " + arguments.length);
      return index < results.length ? results[index++] : { done: true };
    },
  };
  if (!options.withoutReturn)
    made.return = function () {
      log.push("return " + arguments.length);
      if (options.returnThrows) throw new Error("from return");
      return "returnResult" in options ? options.returnResult : {};
    };
  return made;
}
function attempt(name, work) {
  log.length = 0;
  let outcome;
  try {
    outcome = "returned " + JSON.stringify(work());
  } catch (error) {
    outcome = "threw " + (error && error.name) + ": " + (error && error.message);
  }
  console.log(name + " | " + outcome + " | " + log.join(", "));
}
const three = () => [
  { done: false, value: 1 },
  { done: false, value: 2 },
  { done: false, value: 3 },
];
const fail = () => {
  throw new RangeError("from callback");
};
const uses = {
  map: (it, f) => [...it.map(f ?? (v => v * 2))],
  filter: (it, f) => [...it.filter(f ?? (v => v & 1))],
  take: it => [...it.take(2)],
  drop: it => [...it.drop(1)],
  flatMap: (it, f) => [...it.flatMap(f ?? (v => [v, v]))],
  some: (it, f) => it.some(f ?? (v => v === 2)),
  every: (it, f) => it.every(f ?? (v => v < 2)),
  find: (it, f) => it.find(f ?? (v => v === 2)),
  reduce: (it, f) => it.reduce(f ?? ((a, v) => a + v), 0),
  forEach: (it, f) => it.forEach(f ?? (() => {})),
  toArray: it => it.toArray(),
};
for (const [name, use] of Object.entries(uses)) {
  attempt(name + ": three", () => use(source(three())));
  attempt(name + ": callback throws", () => use(source(three()), fail));
  attempt(name + ": callback throws, return throws", () => use(source(three(), { returnThrows: true }), fail));
  attempt(name + ": callback throws, no return", () => use(source(three(), { withoutReturn: true }), fail));
  attempt(name + ": return answers 1", () => use(source(three(), { returnResult: 1 })));
  for (const result of [undefined, null, 1, "text"])
    attempt(name + ": next answers " + String(result), () => use(source([result])));
}
for (const name of ["map", "filter", "take", "drop", "flatMap"]) {
  attempt(name + ": left early", () => {
    const helper = source(three())[name](name === "take" || name === "drop" ? 1 : v => (name === "flatMap" ? [v] : v));
    helper.next();
    return helper.return();
  });
  attempt(name + ": closed before the first step", () =>
    source(three())
      [name](name === "take" || name === "drop" ? 1 : v => v)
      .return(),
  );
  attempt(name + ": left early, return answers 1", () => {
    const helper = source(three(), { returnResult: 1 })[name](
      name === "take" || name === "drop" ? 1 : v => (name === "flatMap" ? [v] : v),
    );
    helper.next();
    return helper.return();
  });
}
for (const bad of [-1, NaN, "x"])
  for (const name of ["take", "drop"]) attempt(name + "(" + bad + ")", () => source(three())[name](bad));
for (const name of ["map", "filter", "flatMap", "some", "every", "find", "reduce", "forEach"])
  attempt(name + "(no function)", () => source(three())[name](1));

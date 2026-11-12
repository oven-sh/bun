// Spreads of iterators of arrays: begun, ended, over holes and accessors, with members replaced.
const show = list => list.length + ":" + list.map(value => (Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + value + "]" : String(value))).join();
const arrays = {
  empty: () => [],
  integers: () => [3, 4, 5],
  doubles: () => [1.5, -0, NaN],
  texts: () => ["a", "b"],
  holes: () => [1, , 3],
  holesAtEnd: () => [1, 2, ,],
  doubleHoles: () => [1.5, , 2.5],
  large: () => Array.from({ length: 70 }, (_, i) => i),
  accessor: () => Object.defineProperty([1, 2, 3], 1, { get: () => "accessor" }),
  frozen: () => Object.freeze([1, 2]),
  sparse: () => {
    const list = [1];
    list[5000] = 2;
    return list;
  },
  heir: () => new (class extends Array {})(1, 2, 3),
  bytes: () => new Uint8Array([7, 8]),
  arguments: () =>
    (function () {
      return arguments;
    })(5, 6),
};
const methods = ["keys", "values", "entries"];
const starts = { empty: () => [], integer: () => [0], double: () => [0.5], text: () => ["x"] };
const spread = (start, iterator) => [...start, ...iterator];
for (let round = 0; round < 8; round++) {
  const lines = [];
  for (const name in arrays) {
    for (const method of methods) {
      for (const start in starts) {
        const array = arrays[name]();
        const iterator = Array.prototype[method].call(array);
        const list = spread(starts[start](), iterator);
        lines.push([name, method, start, name === "sparse" ? list.length + " " + list[2] + " " + list.at(-1) : show(list), JSON.stringify(iterator.next()), show(spread([1], iterator))].join(" "));
        list.push("end");
      }
      const array = arrays[name]();
      const begun = Array.prototype[method].call(array);
      begun.next();
      if (name !== "sparse") lines.push([name, method, "begun", show(spread([], begun))].join(" "));
    }
  }
  const grown = [1, 2];
  const late = grown.values();
  grown.push(3);
  lines.push(show(spread([], late)));
  const shrunk = [1, 2, 3].values();
  lines.push(show([shrunk.next().value, ...shrunk, ...shrunk]));
  const own = [1, 2, 3].keys();
  let left = 2;
  own.next = () => ({ done: !left--, value: "own" });
  lines.push(show(spread([], own)));
  const above = Object.setPrototypeOf([1, , 3], { __proto__: Array.prototype, 1: "of the prototype" });
  for (const method of methods) lines.push(show(spread([], Array.prototype[method].call(above))));
  if (round >= 5) console.log(lines.join("\n"));
}

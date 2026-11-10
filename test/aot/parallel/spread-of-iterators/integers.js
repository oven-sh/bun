// Spreads of iterators into arrays of every kind of storage.
const kinds = { empty: () => [], integers: () => [1, 2], doubles: () => [1.5, 2], mixed: () => [1, "a"], holes: () => [, 1], nan: () => [NaN] };
const iterables = {
  keys: () => [7, 8, 9].keys(), none: () => [].keys(), set: () => new Set([1, 2]).values(), doubles: () => [1.5, 2.5].values(), mixed: () => [1, "b", null].values(),
  generator: function* () { yield 1; yield 2; }, large: () => Array(50).fill(3).keys(), negative: () => [-1, 0, -0].values(), text: () => "ab"[Symbol.iterator](), objects: () => [{}, []].values(),
};
for (let round = 0; round < 20; round++) {
  const lines = [];
  for (const kind in kinds) for (const name in iterables) {
    const before = kinds[kind]();
    const spread = [...before, ...iterables[name](), ...iterables[name]()];
    spread.push(4);
    lines.push(kind + " " + name + " " + spread.length + " " + spread.map(x => (Object.is(x, -0) ? "-0" : String(x))).join() + " " + (0 in spread) + " " + Array.isArray(spread));
  }
  if (round === 19) console.log(lines.join("\n"));
}

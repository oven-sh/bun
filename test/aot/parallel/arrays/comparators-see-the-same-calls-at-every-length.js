// Env: BUN_JSC_useDFGJIT=0
// Plain Bun's optimizing tiers sort a list of up to 16 values by another order of calls than its own run time does. Without them there is one order.
// The comparator is called with the same pairs in the same order as in plain Bun, for every length up to several runs, every kind of storage and every shape of input.
function mix(hash, value) {
  return (Math.imul(hash ^ value, 16777619) + 1) | 0;
}
const shapes = {
  rising: (i, n) => i,
  falling: (i, n) => n - i,
  equal: (i, n) => 7,
  random: (i, n) => (Math.imul(i + 1, 2654435761) >>> 8) % 1000,
  fewValues: (i, n) => (Math.imul(i + 3, 40503) >>> 4) % 4,
  risingThenFalling: (i, n) => (i < n / 2 ? i : n - i),
  longRunsOfTen: (i, n) => (i % 10) + ((i / 10) | 0) * ((i / 10) & 1 ? -3 : 5),
  sawtooth: (i, n) => i % 9,
  nearlyRising: (i, n) => (i % 13 === 12 ? i - 20 : i),
};
const kinds = {
  integers: key => key,
  fractions: key => key + 0.5,
  objects: key => ({ key }),
  texts: key => "k" + String(1000 + key),
  mixedNumbers: key => (key & 1 ? key : key + 0.25),
};
const keyOf = value =>
  typeof value === "object" ? value.key : typeof value === "string" ? Number(value.slice(1)) : value;
const lengths = [];
for (let n = 0; n <= 70; n++) lengths.push(n);
lengths.push(100, 127, 128, 129, 200, 333, 700);
for (const [kindName, make] of Object.entries(kinds)) {
  for (const [shapeName, shape] of Object.entries(shapes)) {
    let calls = 0;
    let order = 0;
    let results = 0;
    for (const n of lengths) {
      const list = [];
      for (let i = 0; i < n; i++) list.push(make(shape(i, n)));
      const byKey = (a, b) => {
        calls++;
        order = mix(mix(order, keyOf(a) * 4), keyOf(b) * 4);
        return keyOf(a) - keyOf(b);
      };
      const copy = list.toSorted(byKey);
      for (let i = 0; i < n; i++) results = mix(results, keyOf(copy[i]) * 4);
      list.sort(byKey);
      for (let i = 0; i < n; i++) results = mix(results, keyOf(list[i]) * 4);
      // An answer that is no number, and an order that is none.
      const odd = list.slice().sort((a, b) => {
        calls++;
        order = mix(mix(order, keyOf(b) * 4), keyOf(a) * 4);
        const difference = keyOf(b) - keyOf(a);
        return calls % 5 === 0
          ? difference < 0
          : calls % 7 === 0
            ? String(difference)
            : calls % 11 === 0
              ? NaN
              : calls % 13 === 0
                ? { valueOf: () => difference }
                : difference;
      });
      for (let i = 0; i < n; i++) results = mix(results, keyOf(odd[i]) * 4);
    }
    console.log(kindName, shapeName, calls, order, results);
  }
}

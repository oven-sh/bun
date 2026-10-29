// A frozen object of one of many shapes is spread behind other properties: the run time copies it by a plan, as it copies the same object before it is frozen, and collects no names.
// COUNTER: CopiesCollectedByName = 0
// COUNTER: CopiesByOrdinaryLookups = 0
function makeSources() {
  return [
    { a: 1, b: "x", c: true }, { a: 2, c: false, z: 1 }, { q: 1, a: 3 }, { a: 4, r: 2, s: 3 }, { t: 1, a: 5 }, { u: 1, v: 2, a: 6 },
    { w: 1, a: 7 }, { a: 8, x1: 1 }, { a: 9, x2: 1 }, { a: 10, x3: 1 }, { a: 11, x4: 1 }, { a: 12, x5: 1 },
  ];
}
let kept = null;
function spreadBehind(sources, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const made = { port: i, host: "h", ...sources[i % sources.length] };
    sum += made.a + made.port;
    kept = made;
  }
  return sum;
}
console.log(spreadBehind(makeSources(), 240), spreadBehind(makeSources().map(source => Object.freeze(source)), 240), spreadBehind(makeSources().map(source => Object.seal(source)), 240), spreadBehind(makeSources().map(source => Object.preventExtensions(source)), 240), JSON.stringify(kept), Object.isFrozen(kept));

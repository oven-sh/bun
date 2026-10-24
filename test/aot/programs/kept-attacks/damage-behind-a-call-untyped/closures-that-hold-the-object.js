// No types are written. A factory returns closures over one object. One closure reads it, calls another one that was handed in from outside, and reads it again.
function makeCounter(start) {
  const state = { count: start, step: 1 };
  return {
    state,
    run(between) {
      const before = state.count + state.step;
      between(state);
      state.count += state.step;
      return before + " " + state.count + "," + state.step;
    },
  };
}

const ways = [
  () => {},
  state => delete state.step,
  state => (state.step = "s"),
  state => Object.defineProperty(state, "count", { get: () => -7, set() {} }),
  state => Object.freeze(state),
];

for (let round = 0; round < 500; round++) {
  const way = round % 100 === 99 ? (round + 1) / 100 : 0;
  const counter = makeCounter(round);
  let line;
  try {
    line = counter.run(ways[way % ways.length]);
  } catch (error) {
    line = error.name + " " + counter.state.count;
  }
  if (way || round === 0) console.log(round + ": " + line);
}

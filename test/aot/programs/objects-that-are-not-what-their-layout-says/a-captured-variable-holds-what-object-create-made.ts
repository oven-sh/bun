interface Counter { count: number; step: number }
function make(): { bump(): number; read(): string; literal(): Counter } {
  const state = Object.create({ step: 2 }) as Counter;
  state.count = 1;
  return {
    bump() { state.count += state.step; return state.count; },
    read() { return Object.keys(state).join() + " " + state.step; },
    literal() { return { count: state.count, step: state.step }; },
  };
}
const counter = make();
console.log(counter.bump(), counter.bump(), counter.read(), JSON.stringify(counter.literal()));

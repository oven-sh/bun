class Counter {
  constructor(list) {
    this.list = list;
    this.sum = 0;
    this.count = 1;
  }
}
class Window {
  constructor(list) {
    this.list = list;
    this.count = 0.5;
  }
}
class Total {
  constructor(list) {
    this.list = list;
    this.sum = 2.5;
  }
}
function step(state) {
  for (let i = 0; i < 3; i++) state.count += 0.5;
  for (let i = 0; i < state.list.length; i++) {
    state.sum = (state.sum + 1) | 0;
    state.count = (state.count * 31 + state.list[i >> 1]) | 0;
  }
  return state.sum + state.count;
}
const parse = value => JSON.parse("0", () => value);
const state = parse({ list: [1, 2, 3, 18], sum: 0, count: 1, last: 0 });
console.log(step(state));
console.log(state.sum, state.count);
const windows = [];
for (const each of windows) console.log(typeof new Counter(each), typeof new Window(each), typeof new Total(each));

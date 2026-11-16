"use strict";

// A loop steps a field of an object that nothing else is known of by one.
class State {
  constructor(line) {
    this.line = line;
  }
}

const statements = new Map();
for (let i = 0; i < 200; i += 10) statements.set(i, { line: i });
for (const i of [2147483645, 2147483647, 2147483648, -2147483648, -2147483649]) statements.set(i, { line: i });

function run(state, last) {
  const found = [];
  while (state.line != null) {
    if (!(state.line <= last)) break;
    const statement = statements.get(state.line++);
    if (statement == null) continue;
    found.push(statement.line);
    if (statement.line === 150) state.line = null;
  }
  return `${found.join()} ${state.line}`;
}

function runBack(state, first) {
  let found = 0;
  while (state.line != null && state.line >= first) {
    if (statements.has(state.line--)) found++;
  }
  return `${found} ${state.line}`;
}

const states = [new State(0), { line: 0 }, { name: "a", line: 0 }, { line: 0, name: "b" }];
globalThis.states = states;
for (const state of states) {
  for (const [first, last] of [[0, 90], [0, 300], [-5, 12], [0.5, 12], [2147483640, 2147483655], [2147483647, 2147483650], [-2147483652, -2147483640], [9007199254740990, 9007199254740992 - 2], [NaN, 4], ["7", 20], [null, 4], [undefined, 4]]) {
    state.line = first;
    const forward = run(state, last);
    state.line = first;
    const back = first > 1e15 ? "" : runBack(state, first - 8);
    console.log(String(first), forward, "|", back);
  }
}

const frozen = Object.freeze({ line: 3 });
try {
  console.log(run(frozen, 9));
} catch (error) {
  console.log(error.name, frozen.line);
}
let reads = 0;
const accessor = {
  get line() {
    reads++;
    return reads < 12 ? reads : null;
  },
  set line(value) {},
};
console.log(run(accessor, 100), reads);

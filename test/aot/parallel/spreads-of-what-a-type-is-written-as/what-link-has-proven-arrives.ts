type State = { a: number; b: number };
function widen(state: State, c: number) { return { ...state, c }; }
const narrow: State = { a: 1, b: 2 };
const written = { a: 0, b: 0, c: 0 };
let state: State = narrow;
let total = 0;
for (let i = 0; i < 4000; i++) { const wide = widen(i & 1 ? state : narrow, i); state = wide; total += wide.a + wide.b + wide.c; }
console.log(total, written.c, JSON.stringify(state), Object.keys(state).join());

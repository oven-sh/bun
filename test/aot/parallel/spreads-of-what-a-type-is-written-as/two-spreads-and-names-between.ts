type State = { a: number; b: number };
type More = { b: number; d: number };
function one(state: State, more: More, a: number) { return { z: 0, ...state, a, ...more, e: 5 }; }
function two(state: State, more: More) { return { ...state, ...more }; }
(globalThis as any).keep = [one, two];
const [both, first]: [typeof one, typeof two] = (globalThis as any).keep;
(globalThis as any).literal = [{ z: 0, a: 0, b: 0, d: 0, e: 0 }, { a: 0, b: 0, d: 0 }];
let text = "";
for (let i = 0; i < 2000; i++) text = JSON.stringify(both({ a: i, b: 2 }, { b: 3, d: 4 }, 6)) + Object.keys(first({ a: 1, b: i }, { d: 4, b: 3 })).join();
console.log(text);

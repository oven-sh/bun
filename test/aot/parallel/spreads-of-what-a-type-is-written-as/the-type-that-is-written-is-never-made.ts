type State = { a: number; b: number };
function written(state: State, c: number) { return { ...state, c }; }
(globalThis as any).keep = written;
const widen: typeof written = (globalThis as any).keep;
(globalThis as any).literal = { a: 0, b: 0, c: 0 };
const wider = { a: 1, b: 2, d: 4 };
const widest = { a: 5, b: 6, d: 7, e: 8 };
let text = "";
for (let i = 0; i < 3000; i++) text = JSON.stringify(widen(i & 1 ? wider : widest, i & 3));
console.log(text, JSON.stringify(widen(wider, 9)), Object.keys(widen(widest, 1)).join());

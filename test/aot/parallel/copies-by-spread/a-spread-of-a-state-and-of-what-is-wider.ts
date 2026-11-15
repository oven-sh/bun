type State = { a: number; b: number };
function widen(state: State, c: number) { return { ...state, c }; }
(globalThis as any).keep = widen;
const s: State = { a: 1, b: 2 };
const t = { a: 3, b: 4, c: 5 };
let total = 0;
for (let i = 0; i < 3000000; i++) { const w = widen((i & 1023) === 0 ? t : s, i); total += w.a + w.c; }
console.log(total);

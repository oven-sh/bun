type State = { a: number; b: number };
type Other = { x: string; y: string };
function written(state: State | Other, c: number) { return { ...state, c }; }
(globalThis as any).keep = written;
const widen: typeof written = (globalThis as any).keep;
(globalThis as any).literal = [{ a: 0, b: 0, c: 0 }, { x: "", y: "", c: 0 }];
const list: (State | Other)[] = [{ a: 1, b: 2 }, { x: "p", y: "q" }, { a: 3, b: 4 }];
const texts: string[] = [];
for (let i = 0; i < 3000; i++) { const wide = widen(list[i % 3], i % 2); if (i < 6) texts.push(JSON.stringify(wide)); }
console.log(texts.join(" "));

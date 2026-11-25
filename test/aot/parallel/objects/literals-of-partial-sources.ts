// { ...a, ...b, ...c } in a loop, where some sources bring names that the literal has no field for.
const a = { color: "red", size: 1 }, b: any[] = [{ size: 2 }, { color: "blue" }, { weight: 3 }, {}, undefined, { size: 4, weight: 5 }], c: any[] = [{ font: "x" }, { size: 9 }, null, { color: "c", font: "y" }];
function keysOf(n: number) { const out: string[] = []; for (let i = 0; i < n; i++) { const m = { ...a, ...b[i % 6], ...c[i & 3] }; out.push(Object.keys(m).join() + " " + Object.values(m).join()); } return out; }
function sumOf(n: number) { let s = 0; for (let i = 0; i < n; i++) { const m = { ...a, ...b[i % 3], ...c[i & 1] }; s += m.size + m.color.length + (m.weight || 0) + (m.font ? m.font.length : 0); } return s; }
function keptOf(n: number) { const all: any[] = []; for (let i = 0; i < n; i++) all.push({ ...a, size: i, ...b[i % 3], ...c[i & 1], last: i }); return all; }
function fewer(n: number) { let s = ""; for (let i = 0; i < n; i++) { const m: any = { ...a, ...b[i % 3] }; for (const key in m) s += key[0]; delete m.color; s += Object.keys(m).length; } return s; }
for (const line of keysOf(24)) console.log(line);
console.log(sumOf(60), JSON.stringify(keptOf(12)), fewer(9));
Object.defineProperty(b[0], "late", { get() { return 7; }, enumerable: true, configurable: true });
b[1].size = 6;
delete b[2].weight;
console.log(keysOf(12).join(";"), sumOf(60), JSON.stringify(keptOf(6)), fewer(6));
export {};

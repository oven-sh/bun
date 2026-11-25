function make() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let total = 1; return { read: () => total, lay: (v: number) => { total = v; } }; }
function run(one: ReturnType<typeof make>, two: ReturnType<typeof make>, n: number) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const a = one.read(); two.lay(two.read() + n); return [a, one.read(), two.read()].join(); }
const boxes = [make(), make()], at = JSON.parse("[0,1]");
console.log(run(boxes[at[0]], boxes[at[1]], 5), run(boxes[at[0]], boxes[at[1]], 7));

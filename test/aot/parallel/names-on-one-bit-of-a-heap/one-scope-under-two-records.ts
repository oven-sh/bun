function make() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let total = 1, other = 0; return { read: () => total, lay: (v: number) => { total = v; }, pad: (v: number) => { other = v; return other; } }; }
function run(one: ReturnType<typeof make>, same: ReturnType<typeof make>, n: number) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const a = one.read(); same.pad(n); same.lay(a + n); return [a, one.read(), same.read()].join(); }
const box = make(), boxes = [box, make()], at = JSON.parse("[0,0]");
console.log(run(boxes[at[0]], boxes[at[1]], 5), run(boxes[at[0]], boxes[at[1]], 7));

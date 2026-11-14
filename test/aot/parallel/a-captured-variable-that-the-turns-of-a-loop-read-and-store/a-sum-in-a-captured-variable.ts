const n = (value: number) => Number(process.argv[8] ?? value);
function make(list: number[]) { let total = 0; return { add() { for (let i = 0; i < list.length; i++) total += list[i]; }, get: () => total, set(to: any) { total = to; } }; }
const m = make([1, 2, 3.5, n(4)]);
m.add(); console.log(m.get()); m.set(2147483647); m.add(); console.log(m.get()); m.set("x"); m.add(); console.log(m.get());

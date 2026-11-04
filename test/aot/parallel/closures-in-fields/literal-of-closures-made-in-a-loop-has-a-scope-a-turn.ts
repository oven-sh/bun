// Each turn of the loop has its own binding, and the object of that turn keeps it.
type Cell = { get: () => number; set: (v: number) => void };
function cells(count: number): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < count; i++) {
    let held = i * 3;
    out.push({ get: () => held, set: (v: number) => { held = v; } });
  }
  return out;
}
function run(list: Cell[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].get();
  return total;
}
const list = cells(30);
console.log(run(list));
list[4].set(1000);
Bun.gc(true);
console.log(run(list), list[4].get(), list[5].get());

// The literal lists a closure that it was handed, beside one of its own. What the first captures is the scope of whoever made it.
type Holder = { get: () => number; own: () => number };
function hold(k: number, from: Holder | undefined): Holder {
  let m = k;
  const own = () => m++;
  return from ? { get: from.own, own } : { get: own, own };
}
function run(list: Holder[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].get() * 100 + list[i].own();
  return total;
}
const list: Holder[] = [];
for (let i = 0; i < 20; i++) list.push(hold(50 + i, i ? list[i - 1] : undefined));
console.log(run(list), run(list), list[4].get(), list[4].own(), list[4].get === list[3].own);

// One function object under two names: the program can tell, so it is made where it is written.
type Two = { get: () => number; alias: () => number; other: () => number };
function make(k: number): Two {
  let n = k;
  const get = () => n++;
  return { get, alias: get, other: () => n + 1 };
}
function run(list: Two[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].get() + list[i].alias() * 10 + list[i].other() * 100;
  return total;
}
const list: Two[] = [];
for (let i = 0; i < 20; i++) list.push(make(i));
console.log(run(list), list[2].get === list[2].alias, list[2].get !== list[2].other, list[2].other === list[2].other);

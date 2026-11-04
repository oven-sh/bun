// A getter laid under another name and a freeze change the object and none of its closures, made or not.
type Box = { get: () => number; bump: () => number };
function make(k: number): Box {
  let n = k;
  const box: Box = { get: () => n, bump: () => ++n };
  if (k % 5 === 3) Object.defineProperty(box, "shown", { get: () => "box " + n });
  if (k % 5 === 4) Object.freeze(box);
  return box;
}
function run(list: Box[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].bump() + list[i].get();
  return total;
}
const list: Box[] = [];
for (let i = 0; i < 20; i++) list.push(make(i));
console.log(run(list), run(list), (list[3] as any).shown, Object.isFrozen(list[4]), list[4].get(), list[3].get === list[3].get);

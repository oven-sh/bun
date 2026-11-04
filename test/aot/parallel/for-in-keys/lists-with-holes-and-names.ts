// A for-in over lists with holes, with an index on the chain above, with a named property, and over a list that is frozen: the keys are texts, in the order of the language.
function walk(list: number[]) {
  let text = "";
  for (const i in list) text += typeof i + i + "=" + list[i as any] + " ";
  return text;
}
function deed() {
  const holes = [1, , 3] as number[];
  const deleted = [1, 2, 3];
  delete deleted[1];
  const below = [1, , 3] as number[];
  Object.setPrototypeOf(below, Object.assign(Object.create(Array.prototype), { 1: 20 }));
  const named = Object.assign([1, 2], { name: 9 }) as number[];
  const long = new Array(5) as number[];
  long[3] = 4;
  return [walk(holes), walk(deleted), walk(below), walk(named), walk(long), walk(Object.freeze([7, 8]) as number[]), walk([1.5, 2.5]), walk([])].join("| ");
}
console.log(deed());
for (let round = 0; round < 3; round++) console.log(walk([round, round + 1, round + 2]), "#", deed());

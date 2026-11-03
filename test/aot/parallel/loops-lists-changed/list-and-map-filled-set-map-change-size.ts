// A new list and a new map are filled by loops that walk a set and a map. One turn of each loop takes members out of what is walked, or puts members in.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function work(members: Set<number>, index: Map<number, number>, at: number, grows: boolean): number {
  const copy: number[] = [];
  const turned = new Map<number, number>();
  let turn = 0;
  for (const member of members) {
    if (turn++ === at) {
      if (grows) for (let k = 0; k < 20; k++) members.add(1000 + k);
      else members.clear();
    }
    copy.push(member * 2);
  }
  turn = 0;
  for (const [key, value] of index) {
    if (turn++ === at) {
      if (grows) for (let k = 0; k < 20; k++) index.set(1000 + k, k);
      else index.delete(key + 1);
    }
    turned.set(value, key);
  }
  return copy.length * 10000 + turned.size * 100 + members.size + index.size;
}
let total = 0;
for (let i = 0; i < 400; i++)
  total = mix(
    total,
    work(
      new Set([i, i + 1, i + 2, i + 3]),
      new Map([
        [i, 1],
        [i + 1, 2],
        [i + 2, 3],
      ]),
      i % 6,
      (i & 8) === 0,
    ),
  );
console.log(total);

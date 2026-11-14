function tally(list: number[], weights: Map<number, number>): string {
  let sum = 0;
  let found = 0;
  for (let i = 0; i < list.length; i++) sum += weights.get(list[i]) ?? 100;
  for (const element of list) if (weights.has(element)) found++;
  return `${sum} ${found}`;
}

function total(list: number[], weights: Map<any, number>): string {
  let sum = 0;
  let found = 0;
  for (let i = 0; i < list.length; i++) sum += weights.get(list[i]) ?? 100;
  for (const element of list) if (weights.has(element)) found++;
  return `${sum} ${found}`;
}

function run(list: number[], end: number): string {
  const counts = new Map<any, number>();
  const kept: any[] = [];
  let said = "";
  for (let i = 0; i < end; i++) {
    const element = list[i];
    counts.set(element, (counts.get(element) ?? 0) + 1);
    kept.push(element);
    said += `${Object.is(element, -0) ? "-0" : element},`;
    if (i === 2) list[4] = 0.5;
  }
  return `${said} ${[...counts].map(([key, count]) => `${key}:${count}`).join(" ")} ${kept.length}`;
}

const ids: number[] = [];
for (let i = 0; i < process.argv.length + 18; i++) ids.push((i * 7919) | 0);
const ranks = new Map<number, number>();
for (let i = 0; i < ids.length; i += 2) ranks.set(ids[i], i);
ranks.set(2147483647, 1000);
const holes = ids.slice(0, 5);
holes.length = 7;
console.log(tally(ids, ranks), tally([2147483647, -2147483648, 0], ranks), tally(holes, ranks), tally([], ranks));

const weights = new Map<any, number>([[1, 1], [2147483647, 2], [-2147483648, 4], [0, 8], [0.5, 16], [undefined, 32]]);
console.log(total([1, 2147483647, -2147483648, 1, 7], weights));
console.log(total([3, 1, , 0] as number[], weights), total([0.5, 1], weights), total([-0, 7], weights), total([], weights));
console.log(run([1, 2147483647, -2147483648, 1, 7], 7));
console.log(run([3, 3, , 3] as number[], 4));
console.log(run([-0, 0], 2));
console.log(run([], 1));

/* Output:
1090 10 1100 2 406 3 0 0
108 4
141 3 17 2 108 1 0 0
1,2147483647,-2147483648,1,0.5,undefined,undefined, 1:2 2147483647:1 -2147483648:1 0.5:1 undefined:2 7
3,3,undefined,3, 3:3 undefined:1 4
-0,0, 0:2 2
undefined, undefined:1 1
*/

// An array that typed code hands to a built-in comes out of it, in a callback whose parameter is typed by its context alone, as the array that went in.
interface Row {
  name: string;
  n: number;
}
const rows: Row[] = [
  { name: "Ada", n: 1 },
  { name: "Bo", n: 2 },
];
function total(list: Row[]): number {
  let sum = 0;
  for (const row of list) sum += row.n;
  return sum;
}

console.log(await Promise.resolve(rows).then(list => list[0]!).then(row => row.name));
await Promise.resolve(rows).then(list => console.log(list[0]!.name, list.length, list === rows, total(list)));
await Promise.resolve(rows).then(list => {
  list.push({ name: "Cy", n: 3 });
});
console.log(rows.length, total(rows));

const kept: Row[][] = [];
await Promise.resolve(rows).then(list => {
  kept.push(list);
});
console.log(kept[0] === rows, kept[0]![2]!.name);

await Promise.resolve([rows, rows.slice(1)]).then(lists => console.log(lists.map(total).join(), lists[1]![0]!.name));
await Promise.resolve([] as Row[]).then(list => console.log(list.length, list[0]?.name));
await Promise.resolve(rows).then(list => console.log(list.map(row => row.name).join(), list.filter(row => row.n > 1).length));

const resolvesWithText: Row[] = Object.assign([] as Row[], {
  then(resolve: (value: unknown) => void) {
    resolve("no list");
  },
});
await Promise.resolve(resolvesWithText).then(list => console.log(typeof list, list.length, list[0]?.name));

const resolvesWithNumbers: Row[] = Object.assign([] as Row[], {
  then(resolve: (value: unknown) => void) {
    resolve([1, 2, 3]);
  },
});
await Promise.resolve(resolvesWithNumbers).then(list => console.log(Array.isArray(list), list.length, list[0]?.name, String(list[1])));

const loose: any = { name: "Di", n: 4, extra: true };
const mixed: Row[] = [rows[0]!, loose];
await Promise.resolve(mixed).then(list => console.log(list.map(row => row.name + row.n).join(), total(list), list[1] === loose));

const resolvesWithPlainObjects: Row[] = Object.assign([] as Row[], {
  then(resolve: (value: unknown) => void) {
    resolve(JSON.parse('[{"name":"Zo","n":9}]'));
  },
});
await Promise.resolve(resolvesWithPlainObjects).then(list => console.log(Array.isArray(list), list.length, list[0]?.name, list[0]!.n + 1));
await Promise.all([Promise.resolve(rows[0]!), Promise.resolve(rows[1]!)]).then(([a, b]) => console.log(a.name, b.n, a === rows[0]));

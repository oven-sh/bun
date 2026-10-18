interface Row {
  name: string;
  count: number;
}

const rows: Row[] = [
  { name: "Ada", count: 1 },
  { name: "Bo", count: 2 },
];

let sum = 0;
for (const row of rows) sum += row.count;
console.log(sum);

await Promise.resolve(rows[0]!).then((row: Row) => console.log(row.name));

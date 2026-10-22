// An async callback of a built-in whose parameter has the type written that its context gives it anyway. A written parameter type is tested on entry, whoever calls: a value of another kind rejects the promise that the callback returns.
interface Row {
  name: string;
  n: number;
}
const rows: Row[] = [
  { name: "Ada", n: 1 },
  { name: "Bo", n: 2 },
];
function label(row: Row): string {
  return row.name + ":" + row.n;
}

await Promise.resolve(rows[0]!).then(async (row: Row) => console.log(row.name, row.n + 1, row === rows[0], label(row)));
const seen: string[] = [];
await Promise.all(
  rows.map(row =>
    Promise.resolve(row).then(async (got: Row) => {
      seen.push(got.name);
      await null;
      seen.push(String(got.n));
    }),
  ),
);
console.log(seen.join());

const resolvesWithNumber: Row = Object.assign({ name: "sly", n: 0 }, {
  then(resolve: (value: unknown) => void) {
    resolve(7);
  },
});
try {
  await Promise.resolve(resolvesWithNumber).then(async (got: Row) => console.log(typeof got, got.name));
} catch (e) {
  console.log("a number for a Row:", (e as Error).constructor.name);
}

let kept: Row | undefined;
await Promise.resolve(rows[1]!).then(async (got: Row) => {
  kept = got;
});
console.log(kept === rows[1], kept!.name, label(kept!));
console.log(await Promise.resolve(rows[0]!).then(async (got: Row): Promise<string> => got.name + got.n));

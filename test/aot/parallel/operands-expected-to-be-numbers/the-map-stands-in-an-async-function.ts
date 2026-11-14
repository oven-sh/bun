interface Crate { id: number; label: string; weight: number; stock: number }
const crates: Crate[] = [];
const at = Number(process.argv[2] ?? 12);
let calls = 0;
const odd: any = { valueOf() { calls++; crates.length = at + 6; return 1; } };
for (let id = 1; id <= 40; id++) crates.push({ id, label: `Crate ${id}`, weight: 3 + id * 5, stock: id === at ? (odd as number) : id % 7 });
(globalThis as any).keep?.(crates);
async function listedLater() {
  await null;
  const made = crates.map((crate) => ({ id: crate.id, inStock: crate.stock > 0 }));
  await null;
  return made;
}
const table = { listedLater };
let sum = 0;
for (let round = 0; round < 3; round++) {
  const made = await table[process.argv.length > 99 ? ("other" as "listedLater") : "listedLater"]();
  sum += made.length;
  console.log(round, made.length, crates.length, calls, JSON.stringify(made.slice(Math.max(0, at - 3), at + 2)));
}
console.log(sum);
